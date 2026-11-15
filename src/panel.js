/**
 * dsh-e2e — the panel's HTTP API.
 *
 * The panel is a browser surface, so everything here is a request handler over
 * `webServer`. Three rules shape it:
 *
 *   1. Every path from the browser is resolved against a configured root before
 *      any I/O. The panel can write a case file, which makes it an arbitrary-file
 *      writer unless the path is checked — `../../.ssh/authorized_keys` must fail
 *      before `open()`.
 *   2. A run is a long operation (start a JVM, wait for readiness, hit the
 *      service). It is started as a job and polled, never held open on one request
 *      that a browser will abandon.
 *   3. The API answers the same shapes the tools do, so the panel and the agent
 *      never disagree about what a run produced.
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCaseFile, CaseError, withCaseId } from './case.js'
import { runCase, redactReport } from './runner.js'
import { renderSummary } from './report.js'
import { auditBaseUrl, checkTargets } from './guard.js'
import { resolveEnvironment, describeEnvironment } from './resolve.js'
import { loadRegistry, describeDatabase, knownNames, resolveTarget, addTarget, removeTarget, RegistryError } from './registry.js'
import { generateCase, explainFailure, GenerateError } from './ai.js'
import { listProjects } from './projects.js'
import { describeSteps, hasAssertions } from './plan.js'
import { applyFields, assertEditable, formFields } from './edit.js'
import {
  StoreError,
  caseRoots,
  defaultCaseDir,
  deleteCase,
  isInside,
  listCasesIn,
  listReports,
  nextCaseId,
  readReport,
  reportRoot,
  resolveCasePath,
  writeReport,
} from './store.js'

const MAX_BODY_BYTES = 1024 * 1024

/**
 * The version the panel reports is the package's own version, read once at load
 * time. Hard-coding it in here means the number in `/bootstrap` drifts from
 * `package.json` the first time anyone bumps the version — and a version field
 * that lies is worse than no version field.
 */
const PLUGIN_VERSION = await readPluginVersion()
export { PLUGIN_VERSION }

async function readPluginVersion() {
  try {
    const manifest = fileURLToPath(new URL('../package.json', import.meta.url))
    return JSON.parse(await readFile(manifest, 'utf8')).version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export class PanelError extends Error {
  constructor(message, status = 400, details = {}) {
    super(message)
    this.name = 'PanelError'
    this.status = status
    Object.assign(this, details)
  }
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  response.end(payload)
}

/**
 * Sends bytes rather than JSON.
 *
 * The one thing in this API that is not JSON is a screenshot, and it has to stay
 * bytes: a PNG base64'd into a JSON field turns a 60KB image into 80KB of text
 * that the browser has to decode before it can decode the image.
 */
function sendBytes(response, status, buffer, contentType) {
  response.writeHead(status, {
    'content-type': contentType,
    'content-length': buffer.length,
    // Screenshots are immutable once written — the file name carries the run id —
    // so the browser may keep them, and re-opening a report is instant.
    'cache-control': 'private, max-age=300',
  })
  response.end(buffer)
}

/**
 * Rewrites a validation message that names the temporary file back to the file
 * the author is actually editing.
 *
 * The save path validates through a temp file, so the YAML parser's message
 * quotes `<case>.yaml.tmp-1234-5678`. That file is deleted a moment later, which
 * makes the message useless twice over: it names a path that does not exist, and
 * it hides the name the author recognises.
 */
function describeAtPath(message, temporary, final) {
  return String(message).split(temporary).join(final)
}

/** Reads a JSON body with a hard cap, so a stuck upload cannot exhaust memory. */
async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new PanelError('request body is too large', 413)
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (error) {
    throw new PanelError(`request body is not JSON: ${error.message}`, 400)
  }
}

/**
 * The panel's write surface. Only a same-origin request may change anything: the
 * Web GUI is served from the same origin, so a cross-site form post is the only
 * realistic way this API gets abused, and rejecting a mismatched Origin closes it.
 * A missing Origin is allowed because non-browser clients (curl, the reload hook)
 * do not send one.
 */
function assertSameOrigin(request) {
  const origin = request.headers.origin
  if (!origin) return
  let host = ''
  try {
    host = new URL(origin).host
  } catch {
    throw new PanelError('unreadable Origin header', 403)
  }
  if (host !== request.headers.host) throw new PanelError('cross-origin request rejected', 403)
}

export function createPanel({ ctx, config = {}, state }) {
  const runs = new Map()
  let runSequence = 0
  // A batch is a run of runs: "Run all 62" has to survive the browser navigating
  // away, so the batch lives here and the page polls it like a single run.
  const batches = new Map()
  let batchSequence = 0

  const roots = () => caseRoots({ config, state })
  const reports = () => reportRoot({ config, state })

  /** Everything the panel needs to render itself, in one round trip. */
  async function bootstrap() {
    const dirs = roots()
    const registryInfo = { file: null, targets: [], databases: [], error: null }
    try {
      const registry = await loadRegistry({ config, caseDir: dirs[0] || null, env: process.env })
      registryInfo.file = registry.file
      registryInfo.targets = knownNames(registry, 'targets')
      const databases = []
      for (const name of knownNames(registry, 'databases')) {
        try {
          databases.push(await describeDatabase(registry, name))
        } catch (error) {
          databases.push({ name, error: error.message })
        }
      }
      registryInfo.databases = databases
    } catch (error) {
      registryInfo.error = error.message
    }

    const listing = []
    for (const dir of dirs) {
      try {
        listing.push(await listCasesIn(dir))
      } catch (error) {
        listing.push({ dir, cases: [], failures: [{ error: error.message }] })
      }
    }

    let history = { dir: reports(), reports: [] }
    try {
      history = await listReports({ config, state })
    } catch (error) {
      history = { dir: reports(), reports: [], error: error.message }
    }

    return {
      ok: true,
      plugin: {
        version: PLUGIN_VERSION,
        dataDir: state.dataDir,
        mountedAt: state.mountedAt,
      },
      caseDirs: dirs,
      cases: listing,
      registry: registryInfo,
      reports: history,
      ide: { host: config.ideHost || '127.0.0.1', port: Number(config.idePort || 64342) },
      runtimes: [...runs.values()].map((run) => summariseRun(run)),
    }
  }

  /** One case's source, for the editor. */
  async function readCase(file) {
    const path = await resolveCasePath(file, roots())
    const text = await readFile(path, 'utf8')
    let definition = null
    let error = null
    try {
      const loaded = await loadCaseFile(path)
      definition = {
        id: loaded.definition.id,
        caseId: loaded.definition.caseId,
        caseIdDerived: loaded.definition.caseIdDerived === true,
        title: loaded.definition.title,
        tags: loaded.definition.tags,
        description: loaded.definition.description,
        endpoint: loaded.definition.endpoint,
        group: loaded.definition.group || '',
        scenario: loaded.definition.scenario,
        priority: loaded.definition.priority,
        steps: describeSteps(loaded.definition),
        asserts: hasAssertions(loaded.definition),
        fields: formFields(loaded.definition),
        target: loaded.definition.env.target,
        databases: Object.entries(loaded.definition.env.databases || {}).map(([key, ref]) => ({
          name: key,
          database: ref.name,
          schema: ref.schema,
        })),
      }
    } catch (parseError) {
      // A case that does not load is still worth showing in the editor: the
      // author has to be able to see and fix what is on disk.
      error = parseError.message
    }
    return { path, file: basename(path), yaml: text, definition, error, history: await historyFor(definition, file) }
  }

  /**
   * Every run this case has on record, newest first.
   *
   * A passing case is not a case you have nothing to say about — the last
   * question anyone asks about a green test is "when did it last pass, and what
   * did it actually see?" That answer already exists on disk; the panel just
   * never asked for it.
   *
   * Matched on both `caseId` and `id`, for the same reason `latestByCase` does:
   * a case renamed since its last run keeps its caseId but not its id, and the
   * older reports still belong to it.
   */
  async function historyFor(definition, file) {
    const keys = new Set()
    if (definition) {
      if (definition.caseId) keys.add(String(definition.caseId))
      if (definition.id) keys.add(String(definition.id))
    }
    const fallback = basename(String(file || '')).replace(/\.ya?ml$/i, '')
    if (fallback) keys.add(fallback)
    let listed = []
    try {
      listed = (await listReports({ config, state })).reports
    } catch {
      return []
    }
    return listed
      .filter((item) => {
        const summary = item.summary || {}
        // `keys` holds the caseId, the file-level id, and the bare file stem.
        // Old reports predate the caseId field and recorded the id there, which
        // is why all three are in the set rather than just the caseId.
        return keys.has(String(summary.caseId))
      })
      .slice(0, 20)
      .map((item) => ({
        path: item.path,
        markdownPath: item.markdownPath,
        name: item.name,
        modifiedAt: item.modifiedAt,
        verdict: (item.summary && item.summary.verdict) || null,
        startedAt: (item.summary && item.summary.startedAt) || null,
        durationMs: (item.summary && item.summary.durationMs) || null,
        checks: (item.summary && item.summary.checks) || 0,
        failed: (item.summary && item.summary.failed) || 0,
      }))
  }

  /**
   * Saves a case. The YAML is validated by loading it through the real case
   * loader *before* it is written, so the editor cannot leave a file on disk that
   * the runner would refuse — a broken case on disk is worse than a rejected save.
   *
   * A case that has no `caseId` gets one assigned here, because this is the only
   * place that can see the other files in the directory: the number is minted from
   * what is already taken, and inserted textually so the author's comments survive.
   * Pass `assignCaseId: false` to keep the derived fallback instead.
   */
  async function saveCase(file, yaml, options = {}) {
    let text = String(yaml ?? '')
    if (!text.trim()) throw new PanelError('refusing to save an empty case')
    const path = await resolveCasePath(file, roots(), { allowMissing: true })
    const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
    await writeFile(tmp, text, 'utf8')
    let loaded
    try {
      loaded = await loadCaseFile(tmp)
    } catch (error) {
      const { unlink } = await import('node:fs/promises')
      await unlink(tmp).catch(() => {})
      const message = error instanceof CaseError ? error.message : `the case does not load: ${error.message}`
      throw new PanelError(describeAtPath(message, tmp, path), 422, { yaml: text })
    }

    let assigned = null
    if (options.assignCaseId !== false && loaded.definition.caseIdDerived) {
      assigned = await nextCaseId(dirname(path), loaded.definition.endpoint || loaded.definition.id)
      text = withCaseId(text, assigned)
      await writeFile(tmp, text, 'utf8')
      try {
        loaded = await loadCaseFile(tmp)
      } catch (error) {
        const { unlink } = await import('node:fs/promises')
        await unlink(tmp).catch(() => {})
        throw new PanelError(`cannot add caseId ${assigned}: ${error.message}`, 422, { yaml: text })
      }
    }

    // Two cases with the same id make every report ambiguous: a failure list can no
    // longer say which file failed. Checked here rather than in the loader because
    // only a directory listing can answer it.
    const duplicate = await findDuplicateCaseId(dirname(path), path, loaded.definition.caseId)
    if (duplicate) {
      const { unlink } = await import('node:fs/promises')
      await unlink(tmp).catch(() => {})
      throw new PanelError(
        `caseId ${loaded.definition.caseId} is already used by ${basename(duplicate)} in this folder; case ids have to be unique so a report can name one case`,
        422,
        { yaml: text, caseId: loaded.definition.caseId, duplicate },
      )
    }

    const { rename } = await import('node:fs/promises')
    await rename(tmp, path)
    return {
      path,
      file: basename(path),
      // Returned because the save may have added a line: the editor has to show
      // what is actually on disk, or the next save would drop the assigned id.
      yaml: text,
      caseId: loaded.definition.caseId,
      assigned,
    }
  }

  /** The other file in `dir` that already uses `caseId`, or null. */
  async function findDuplicateCaseId(dir, path, caseId) {
    if (!caseId) return null
    let listed
    try {
      listed = await listCasesIn(dir)
    } catch {
      return null
    }
    const hit = listed.cases.find((entry) => entry.caseId === caseId && resolve(entry.file) !== resolve(path))
    return hit ? hit.file : null
  }

  /**
   * Saves a form edit: the browser sends the fields, this side patches the text.
   *
   * The patching happens here and not in the browser for one reason: the file on
   * disk is the authority, and a browser that patched its own copy would save
   * whatever it last fetched — silently reverting anything changed elsewhere
   * since. Reading the file now, patching that, then handing the result to the
   * same `saveCase` the YAML view uses keeps one save path with one set of rules.
   */
  async function saveFields(file, fields) {
    assertEditable(fields)
    const path = await resolveCasePath(file, roots())
    const current = await readFile(path, 'utf8')
    const patched = applyFields(current, fields)
    return saveCase(path, patched)
  }

  /** Checks a case without running it: does it load, and would the guard allow it? */
  async function validateCase(file, yaml) {
    const text = yaml !== undefined && yaml !== null ? String(yaml) : null
    let loaded = null
    if (text !== null) {
      const path = await resolveCasePath(file, roots(), { allowMissing: true })
      const tmp = `${path}.check-${process.pid}-${Date.now()}`
      await writeFile(tmp, text, 'utf8')
      try {
        loaded = await loadCaseFile(tmp)
      } catch (error) {
        // Same rewrite as save: report against the file the author is editing.
        const message = error instanceof CaseError ? error.message : `the case does not load: ${error.message}`
        throw new PanelError(describeAtPath(message, tmp, path), 422, { yaml: text })
      } finally {
        const { unlink } = await import('node:fs/promises')
        await unlink(tmp).catch(() => {})
      }
    } else {
      const path = await resolveCasePath(file, roots())
      loaded = await loadCaseFile(path)
    }

    let resolved = null
    let environment = null
    let resolveError = null
    try {
      resolved = await resolveEnvironment(loaded.definition, { config, env: process.env })
      environment = describeEnvironment(resolved)
    } catch (error) {
      resolveError = error.message
    }

    let problems = []
    if (resolved) {
      problems = await checkTargets(loaded.definition, resolved, {
        allowRemote: false,
        allowWrites: false,
        idePort: Number(config.idePort || 64342),
      })
    }

    return {
      ok: !resolveError && problems.length === 0,
      caseId: loaded.definition.id,
      title: loaded.definition.title,
      environment,
      resolveError,
      problems,
      // `allowWrites` is off here on purpose: this is what the case looks like to a
      // run that has not opted into writes, which is the honest default answer.
      notes:
        problems.length === 0 && !resolveError
          ? []
          : ['a run also needs allowWrites when the case contains INSERT/UPDATE/DELETE'],
    }
  }

  function summariseRun(run) {
    return {
      id: run.id,
      caseId: run.caseId,
      file: run.file,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.finishedAt ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime() : null,
      verdict: run.verdict,
      error: run.error,
      reportPath: run.reportPath,
      checks: run.checks,
      failed: run.failed,
      warnings: run.warnings,
    }
  }

  /**
   * Resolves one case and checks it against the guard, without running it.
   *
   * Split out of `startRun` because a batch needs the same two decisions per case
   * and must be able to answer "this one is refused" without aborting the other
   * nineteen. Throws `PanelError(…, 422)` with the problems attached, which the
   * batch turns into a `refused` run record rather than an exception.
   */
  async function prepareRun(file, input = {}) {
    const path = await resolveCasePath(file, roots())
    const loaded = await loadCaseFile(path)
    state.lastCaseDir = loaded.dir

    let resolved
    try {
      resolved = await resolveEnvironment(loaded.definition, { config, env: process.env })
    } catch (error) {
      // Carry the loaded case along: a refusal still has to name the case it
      // refused, and re-reading the file to find out would be a second chance to
      // fail for an unrelated reason.
      throw new PanelError(error.message, 422, { verdict: 'refused', path, loaded })
    }

    const guardOptions = {
      allowRemote: input.allowRemote === true,
      allowWrites: input.allowWrites === true,
      idePort: Number(input.idePort || config.idePort || 64342),
    }
    const problems = await checkTargets(loaded.definition, resolved, guardOptions)
    if (problems.length > 0) {
      throw new PanelError(`refusing to run case "${loaded.definition.id}": ${problems.join('; ')}`, 422, {
        verdict: 'refused',
        problems,
        environment: describeEnvironment(resolved),
        path,
        loaded,
      })
    }
    return { path, loaded, resolved, guardOptions }
  }

  /** Creates the record the browser polls. Not started until `executeRun`. */
  function newRunRecord(path, loaded, batchId = null) {
    runSequence += 1
    const id = `panel-${Date.now()}-${runSequence}`
    const definition = loaded && loaded.definition ? loaded.definition : null
    const run = {
      id,
      caseId: definition ? definition.caseId || definition.id : path,
      file: path,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      verdict: null,
      error: null,
      reportPath: null,
      checks: 0,
      failed: 0,
      warnings: [],
      report: null,
      explanation: null,
      batchId,
    }
    runs.set(id, run)
    return run
  }

  /** The actual pipeline call, with every failure recorded on the run. */
  async function executeRun(run, loaded, resolved, guardOptions, input = {}) {
    try {
      const { report, secrets } = await runCase(loaded.definition, {
        ...guardOptions,
        resolved,
        config,
        // Screenshots land in `<reports>/shots` so the panel can serve them from
        // one place it already knows, and so a report and its pictures travel
        // together when the directory is copied off the machine.
        artifactDir: join(reportRoot({ config, state }), 'shots'),
        ideHost: config.ideHost || '127.0.0.1',
        ideTimeoutMs: config.ideTimeoutMs || 60000,
        keepServiceRunning: input.keepServiceRunning === true || config.keepServiceRunning === true,
        traceHeader: input.traceHeader ? String(input.traceHeader) : config.traceHeader || 'X-Trace-Id',
        maxBodyChars: config.maxBodyChars || 8000,
        logSettleMs: config.logSettleMs,
      })
      const safe = redactReport(report, secrets)
      const written = await writeReport(safe, { reportDir: config.reportDir, state })
      run.report = safe
      run.reportPath = written.mdPath
      run.jsonPath = written.jsonPath
      run.verdict = safe.verdict
      run.checks = safe.checks.length
      run.failed = safe.failedChecks.length
      run.warnings = safe.warnings || []
      run.summary = renderSummary(safe, { reportPath: written.mdPath })
    } catch (error) {
      run.verdict = 'failed'
      run.error = error.message
    } finally {
      run.status = 'finished'
      run.finishedAt = new Date().toISOString()
    }
    return run
  }

  /**
   * Starts a run in the background and returns its id immediately. A real case
   * takes seconds to minutes (a JVM starts, readiness is polled, the request goes
   * out); holding the HTTP request open for that would make the panel look frozen
   * and would die the moment the browser navigated away.
   */
  async function startRun(input = {}) {
    const file = input.file
    if (!file) throw new PanelError('pass the case file to run')
    const { path, loaded, resolved, guardOptions } = await prepareRun(file, input)
    const run = newRunRecord(path, loaded)

    // Deliberately not awaited: the caller gets the id and polls.
    void executeRun(run, loaded, resolved, guardOptions, input)

    return summariseRun(run)
  }

  /**
   * Runs a list of cases one after another, in the background.
   *
   * Sequential on purpose. Two cases against one service that share a database
   * would interleave their writes, and the failure that produces looks like a
   * flaky test rather than like a mistake in the runner. The cost is wall-clock
   * time; the alternative is a suite whose results depend on scheduling.
   *
   * A case the guard refuses does not stop the batch: it becomes a `refused` run
   * and the next one starts. Aborting would mean one missing credential hides
   * every later result, which is the opposite of what a "run all" is for.
   */
  async function startBatch(input = {}) {
    const files = Array.isArray(input.files) ? input.files.filter(Boolean) : []
    if (files.length === 0) throw new PanelError('pass the case files to run, as "files"')

    batchSequence += 1
    const batch = {
      id: `batch-${Date.now()}-${batchSequence}`,
      files,
      runIds: [],
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      allowWrites: input.allowWrites === true,
    }
    batches.set(batch.id, batch)

    void (async () => {
      for (const file of files) {
        let prepared
        try {
          prepared = await prepareRun(file, input)
        } catch (error) {
          // A refusal is a result, not an interruption: record it and carry on.
          // It goes through the same record shape as a real run, so a refused case
          // still shows the case it belongs to instead of the file name it was
          // asked for.
          const refused = newRunRecord(error.path || file, error.loaded || null, batch.id)
          refused.status = 'finished'
          refused.finishedAt = refused.startedAt
          refused.verdict = 'refused'
          refused.error = error.message
          refused.problems = error.problems || []
          batch.runIds.push(refused.id)
          continue
        }
        const run = newRunRecord(prepared.path, prepared.loaded, batch.id)
        batch.runIds.push(run.id)
        await executeRun(run, prepared.loaded, prepared.resolved, prepared.guardOptions, input)
      }
      batch.status = 'finished'
      batch.finishedAt = new Date().toISOString()
    })()

    return summariseBatch(batch)
  }

  function summariseBatch(batch) {
    const members = batch.runIds.map((id) => runs.get(id)).filter(Boolean)
    return {
      id: batch.id,
      status: batch.status,
      startedAt: batch.startedAt,
      finishedAt: batch.finishedAt,
      total: batch.files.length,
      finished: members.filter((run) => run.status === 'finished').length,
      passed: members.filter((run) => run.verdict === 'passed').length,
      failed: members.filter((run) => run.verdict === 'failed').length,
      refused: members.filter((run) => run.verdict === 'refused').length,
      runs: members.map(summariseRun),
    }
  }

  async function batchStatus(id) {
    const batch = batches.get(String(id))
    if (!batch) throw new PanelError(`no batch with id ${id}`, 404)
    return summariseBatch(batch)
  }

  async function runStatus(id) {
    const run = runs.get(String(id))
    if (!run) throw new PanelError(`no run with id ${id}`, 404)
    return {
      ...summariseRun(run),
      report: run.report,
      summary: run.summary || null,
      explanation: run.explanation,
    }
  }

  /** Asks the model why a finished run failed. Never touches the verdict. */
  async function explainRun(id) {
    const run = runs.get(String(id))
    if (!run) throw new PanelError(`no run with id ${id}`, 404)
    if (run.status !== 'finished') throw new PanelError('the run has not finished yet', 409)
    if (!run.report) throw new PanelError('this run produced no report to explain', 409)
    if (run.report.verdict === 'passed') {
      throw new PanelError('this run passed, so there is nothing to explain', 409)
    }
    if (run.explanation) return { explanation: run.explanation }
    const result = await explainFailure(ctx, run.report, {})
    run.explanation = result.explanation
    return result
  }

  /**
   * Create a project: one registry target, one case directory. The project is
   * not a row in a database — it is the thing a case names in `env.target`,
   * and the directory its YAML lives in — so creating it means writing the
   * registry (text insertion, comments preserved) and making the directory.
   *
   * The Base URL is not asked for: a local Spring project declares its port and
   * context path itself, so it is read from `src/main/resources/application.*`
   * via `guessBaseUrl`. An explicitly passed baseUrl still wins — the tools and
   * tests use that door — and the same base-URL rules a run applies are applied
   * to whatever ends up in the registry, so a project that would fail every
   * case cannot be born.
   */
  async function createProject(input = {}) {
    const name = String(input.name || '').trim()
    const projectPath = String(input.projectPath || '').trim()
    let baseUrl = String(input.baseUrl || '').trim()
    let derived = null
    if (!baseUrl) {
      if (!projectPath) {
        throw new PanelError(
          'a project needs a project path — the Base URL is read from the project\'s application configuration, so there is nothing to derive it from without one',
          422,
        )
      }
      const { guessBaseUrl } = await import('./scan.js')
      try {
        derived = await guessBaseUrl(projectPath)
      } catch (error) {
        throw new PanelError(`cannot read the project's server configuration: ${error.message}`, 422, { projectPath })
      }
      baseUrl = derived.baseUrl || ''
      if (!baseUrl) {
        throw new PanelError(
          `could not derive a Base URL from ${projectPath}: ${(derived.warnings || []).join('; ') || 'no server.port found'}`,
          422,
          { projectPath, warnings: derived.warnings },
        )
      }
    }
    const problems = auditBaseUrl(baseUrl, { allowRemote: input.allowRemote === true })
    if (problems.length > 0) throw new PanelError(`the project was refused: ${problems.join('; ')}`, 422, { problems })
    const root = roots()[0] || defaultCaseDir({ state })
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project'
    // A second project aimed at the same service is two registries describing
    // one thing; the panel would show both rows for every run.
    const existing = await loadRegistry({ config, caseDir: root, env: process.env })
    for (const [existingName, target] of Object.entries(existing.targets)) {
      let origin = null
      try { origin = new URL(target.baseUrl || '').origin } catch { /* malformed stays theirs */ }
      if (origin && origin === new URL(baseUrl).origin) {
        throw new PanelError(`a project for ${origin} already exists: ${existingName}; one service, one project`, 422, { origin, existingName })
      }
    }
    const caseDir = join(root, slug)
    await mkdir(caseDir, { recursive: true })
    const written = await addTarget({
      name: slug,
      baseUrl,
      configurationName: input.configurationName,
      projectPath: input.projectPath,
      targetCaseDir: caseDir,
      insecureTls: input.insecureTls === true,
      config,
      caseDir: root,
    })
    state.lastCaseDir = root
    return {
      ok: true,
      name: slug,
      baseUrl,
      derivedFrom: derived ? derived.source : null,
      registryFile: written.file,
      caseDir,
      created: written.created,
    }
  }

  /**
   * Delete a project: the registry target and the case directory it owned.
   *
   * This is the destructive half of "create project", so it is narrow on
   * purpose. The target is removed from the registry text (comments kept); the
   * case directory is removed only when it is the one the target names
   * (`caseDir` in the registry) or the slug-named directory under the panel's
   * case root — an unrelated directory that merely looks similar is never
   * touched. Reports are left alone: they are the run history of tests that
   * actually ran, and deleting a project should not rewrite history.
   */
  async function deleteProject(input = {}) {
    const name = String(input.name || '').trim()
    if (!name) throw new PanelError('a project name is needed to delete it', 422)
    const root = roots()[0] || defaultCaseDir({ state })
    const registry = await loadRegistry({ config, caseDir: root, env: process.env })
    if (!registry.targets || !registry.targets[name]) {
      throw new PanelError(`unknown project "${name}" — the registry does not define it`, 422, { name })
    }
    const target = await resolveTarget(registry, name, {})
    const removed = await removeTarget({ name, config, caseDir: root })

    // The directory that holds this project's cases: what the registry says,
    // falling back to the slug directory this panel's createProject makes.
    let caseDir = target.caseDir ? resolve(target.caseDir) : null
    if (!caseDir) {
      const candidate = resolve(join(root, name))
      if (candidate.toLowerCase() !== resolve(root).toLowerCase()) caseDir = candidate
    }
    let removedDir = null
    if (caseDir) {
      try {
        const entries = await readdir(caseDir)
        const hasCases = entries.some((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml'))
        if (!hasCases || input.force === true) {
          await rm(caseDir, { recursive: true, force: true })
          removedDir = caseDir
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw new PanelError(`the target was removed from ${removed.file}, but the case directory ${caseDir} could not be deleted: ${error.message}`, 500)
        }
      }
    }
    return { ok: true, name, registryFile: removed.file, removedDir, keptDir: caseDir && !removedDir ? caseDir : null }
  }

  async function generate(input = {}) {
    const dirs = roots()
    let targets = []
    let databases = []
    try {
      const registry = await loadRegistry({ config, caseDir: dirs[0] || null, env: process.env })
      targets = knownNames(registry, 'targets')
      databases = knownNames(registry, 'databases')
    } catch {
      /* generating without a registry still works: the model just gets less context */
    }
    let existingIds = []
    if (dirs.length > 0) {
      try {
        const listing = await listCasesIn(dirs[0])
        existingIds = listing.cases.map((item) => item.id)
      } catch {
        /* a case directory that does not exist yet is not a reason to refuse */
      }
    }
    const result = await generateCase(ctx, {
      description: input.description,
      hint: input.hint,
      targets,
      databases,
      existingIds,
      provider: input.provider,
      model: input.model,
    })
    return result
  }

  /**
   * Routes. Kept as a table rather than a chain of `if`s so the method, the
   * mutating bit and the handler sit on one line each — a route that changes state
   * is then visible at a glance.
   */
  const routes = [
    { method: 'GET', path: '/status', handler: async () => bootstrap() },
    { method: 'GET', path: '/bootstrap', handler: async () => bootstrap() },
    { method: 'GET', path: '/cases', handler: async (_body, url) => {
      const dirs = url.searchParams.get('dir') ? [resolve(url.searchParams.get('dir'))] : roots()
      const results = []
      for (const dir of dirs) {
        try {
          results.push(await listCasesIn(dir))
        } catch (error) {
          results.push({ dir, cases: [], groups: [], failures: [{ error: error.message }] })
        }
      }
      return { ok: true, dirs: results }
    } },
    { method: 'POST', path: '/next-case-id', mutate: true, handler: async (body) => nextId(body) },
    { method: 'GET', path: '/case', handler: async (_body, url) => readCase(url.searchParams.get('file')) },
    { method: 'POST', path: '/case', mutate: true, handler: async (body) => saveCase(body.file, body.yaml, { assignCaseId: body.assignCaseId !== false }) },
    { method: 'POST', path: '/case-fields', mutate: true, handler: async (body) => saveFields(body.file, body.fields) },
    { method: 'DELETE', path: '/case', mutate: true, handler: async (_body, url) => {
      const path = await deleteCase(url.searchParams.get('file'), roots())
      return { ok: true, path }
    } },
    { method: 'POST', path: '/validate', mutate: true, handler: async (body) => validateCase(body.file, body.yaml) },
    { method: 'GET', path: '/databases', handler: async () => {
      const registry = await loadRegistry({ config, caseDir: roots()[0] || null, env: process.env })
      const databases = []
      for (const name of knownNames(registry, 'databases')) {
        try {
          databases.push(await describeDatabase(registry, name))
        } catch (error) {
          databases.push({ name, error: error.message })
        }
      }
      return { ok: true, file: registry.file, targets: knownNames(registry, 'targets'), databases }
    } },
    { method: 'GET', path: '/reports', handler: async () => listReports({ config, state }) },
    { method: 'GET', path: '/projects', handler: async () => listProjects({ config, state, env: process.env }) },
    { method: 'POST', path: '/project', mutate: true, handler: async (body) => createProject(body) },
    { method: 'DELETE', path: '/project', mutate: true, handler: async (_body, url) => deleteProject({ name: url.searchParams.get('name') }) },
    {
      method: 'GET',
      path: '/shot',
      // The only binary route. A report names its screenshots by absolute path;
      // the browser cannot read a file path, so this serves the bytes. The path
      // is checked against the shots directory before any I/O — the same rule as
      // every other path in this file, and the reason it is not `/file?path=`.
      handler: async (_body, url) => {
        const shotsRoot = join(reportRoot({ config, state }), 'shots')
        const wanted = url.searchParams.get('path')
        if (!wanted) throw new PanelError('pass the screenshot path, as "path"', 422)
        const absolute = resolve(String(wanted))
        if (!isInside(shotsRoot, absolute)) {
          throw new PanelError(
            `${absolute} is not inside ${shotsRoot}; screenshots are only served from the report directory`,
            403,
          )
        }
        let bytes
        try {
          bytes = await readFile(absolute)
        } catch (error) {
          throw new PanelError(`cannot read ${absolute}: ${error.message}`, 404)
        }
        return { __raw: true, contentType: 'image/png', buffer: bytes }
      },
    },
    { method: 'GET', path: '/report', handler: async (_body, url) => {
      const wanted = url.searchParams.get('format') || 'markdown'
      const result = await readReport(url.searchParams.get('path'), { reportDir: config.reportDir, state })
      // Ask for markdown, get markdown. Asking for markdown and silently receiving
      // a JSON object with no `markdown` key is how a viewer renders "undefined".
      if (wanted === result.format) return result
      throw new PanelError(
        `${basename(result.path)} is a ${result.format} report, but ${wanted} was requested; ask for ${result.format}`,
        409,
        { path: result.path, format: result.format },
      )
    } },
    { method: 'POST', path: '/run', mutate: true, handler: async (body) => startRun(body) },
    { method: 'GET', path: '/run', handler: async (_body, url) => runStatus(url.searchParams.get('id')) },
    { method: 'POST', path: '/run-all', mutate: true, handler: async (body) => startBatch(body) },
    { method: 'GET', path: '/run-all', handler: async (_body, url) => batchStatus(url.searchParams.get('id')) },
    { method: 'POST', path: '/explain', mutate: true, handler: async (body) => explainRun(body.id) },
    { method: 'POST', path: '/generate', mutate: true, handler: async (body) => generate(body) },
    { method: 'POST', path: '/scan', mutate: true, handler: async (body) => scan(body) },
    { method: 'POST', path: '/scaffold', mutate: true, handler: async (body) => scaffold(body) },
  ]

  /**
   * Reads the project's Spring annotations and returns its endpoints.
   *
   * The panel calls this once when the author opens the scaffold panel; the result
   * is what makes "pick an endpoint" possible instead of "remember the path".
   */
  async function scan(input) {
    const projectPath = input.projectPath ? String(input.projectPath) : await defaultProjectPath()
    if (!projectPath) {
      throw new PanelError(
        'no project path to scan: pass one, or give the registry target a projectPath',
        422,
      )
    }
    try {
      const { scanProject } = await import('./scan.js')
      const result = await scanProject({
        projectPath,
        maxFiles: input.maxFiles,
        maxBytes: input.maxBytes,
      })
      return { ok: true, projectPath, ...result }
    } catch (error) {
      throw new PanelError(`cannot scan ${projectPath}: ${error.message}`, 422, { projectPath })
    }
  }

  /**
   * Turns one scanned endpoint into a case skeleton.
   *
   * Returns the YAML without writing it: the author edits it in the panel first.
   * Writing on generate would put a half-finished case on disk every time someone
   * clicked through the list.
   */
  async function scaffold(input) {
    const target = input.target ? String(input.target) : await defaultTargetName()
    if (!target) {
      throw new PanelError(
        'no target to put in the case: add a target to the registry, or pass one explicitly',
        422,
      )
    }
    try {
      const { generateFromSource } = await import('./scaffold.js')
      // The number is minted here, not by the generator: only this side can see
      // which numbers the case directory already uses. Minting it in the scaffold
      // would mean the scaffold had to read the disk, which it deliberately does
      // not (it is a pure endpoint → YAML function, and its tests rely on that).
      const caseId =
        input.caseId || (await nextCaseId(roots()[0] || defaultCaseDir({ state }), `${input.method || 'GET'} ${input.path}`))
      const result = await generateFromSource({
        projectPath: input.projectPath ? String(input.projectPath) : await defaultProjectPath(),
        path: input.path,
        method: input.method,
        target,
        database: input.database,
        schema: input.schema,
        id: input.id,
        caseId,
        scenario: input.scenario,
        priority: input.priority,
        expectStatus: input.expectStatus,
        expectBody: input.expectBody,
      })
      return { ok: true, target, caseId, ...result }
    } catch (error) {
      throw new PanelError(error.message, 422, { path: input.path, method: input.method })
    }
  }

  /**
   * The next free case id for an endpoint, so the panel can show it before the
   * author writes anything. `POST /next-case-id {endpoint}`.
   */
  async function nextId(input) {
    const endpoint = String(input.endpoint || '').trim()
    if (!endpoint) throw new PanelError('next-case-id needs an endpoint, like "POST /auth/register"', 422)
    const dir = roots()[0] || defaultCaseDir({ state })
    const caseId = await nextCaseId(dir, endpoint)
    return { ok: true, endpoint, caseId, dir }
  }

  /** The first registry target that names a project — the obvious thing to scan. */
  async function defaultProjectPath() {
    if (config.projectPath) return String(config.projectPath)
    try {
      const registry = await loadRegistry({ config, caseDir: roots()[0] || null, env: process.env })
      for (const name of knownNames(registry, 'targets')) {
        const target = await resolveTarget(registry, name, {})
        if (target && target.projectPath) return target.projectPath
      }
    } catch {
      /* no registry is a normal state, not an error worth reporting here */
    }
    return null
  }

  /** The first target name, used when the caller did not pick one. */
  async function defaultTargetName() {
    try {
      const registry = await loadRegistry({ config, caseDir: roots()[0] || null, env: process.env })
      const names = knownNames(registry, 'targets')
      return names.length > 0 ? names[0] : null
    } catch {
      return null
    }
  }

  async function handle(request, response) {
    const url = new URL(request.url || '/', 'http://localhost')
    const path = url.pathname.replace(/^\/plugins\/e2e\/api/, '') || '/'
    const method = (request.method || 'GET').toUpperCase()

    const route = routes.find((item) => item.path === path && item.method === method)
    if (!route) {
      const allowed = routes.filter((item) => item.path === path).map((item) => item.method)
      return sendJson(response, 404, {
        ok: false,
        error: allowed.length > 0 ? `${method} is not allowed on ${path}; use ${allowed.join(', ')}` : `unknown path ${path}`,
      })
    }

    try {
      if (route.mutate) assertSameOrigin(request)
      const body = route.mutate && method !== 'GET' ? await readJsonBody(request) : {}
      const result = await route.handler(body, url)
      // A handler may answer with bytes (`{ __raw: true }`) instead of a JSON
      // document. Everything else in this API is JSON, so the exception is
      // explicit rather than inferred from the response's shape.
      if (result && result.__raw) return sendBytes(response, 200, result.buffer, result.contentType)
      return sendJson(response, 200, result)
    } catch (error) {
      const status =
        error instanceof PanelError
          ? error.status
          : error instanceof CaseError || error instanceof RegistryError || error instanceof StoreError
            ? 422
            : error instanceof GenerateError
              ? 503
              : 500
      return sendJson(response, status, {
        ok: false,
        error: String((error && error.message) || error),
        details: error && (error.problems || error.details) ? error.problems || error.details : undefined,
        verdict: error && error.verdict ? error.verdict : undefined,
        environment: error && error.environment ? error.environment : undefined,
      })
    }
  }

  // `saveCase` and `validateCase` are exported on the returned object so the
  // offline tests can drive the real save path — the temp-file dance and the
  // error rewrite are exactly the parts that are wrong in ways only a real
  // round-trip shows.
  return {
    handle,
    bootstrap,
    listProjects: () => listProjects({ config, state, env: process.env }),
    saveCase,
    validateCase,
    startBatch,
    batchStatus,
    createProject,
    deleteProject,
    dispose() {
      runs.clear()
      batches.clear()
    },
  }
}
