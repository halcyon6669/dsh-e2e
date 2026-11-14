/**
 * dsh-e2e — where cases and reports live on disk.
 *
 * Both the agent tools and the panel need the same answers to "which directory
 * holds the cases", "may I write this path", and "where does a report go". Two
 * copies of that logic drift, and the copy that drifts is always the one guarding
 * a write. So it lives here once.
 *
 * Path handling is the security-relevant part: the panel takes a path from a
 * browser and writes a file. Every path is resolved and then checked to be inside
 * a configured case root, so `../../../etc/passwd` fails before any I/O happens.
 */
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { loadCaseDirectory, endpointPrefix } from './case.js'
import { describeSteps, hasAssertions } from './plan.js'
import { isRegistryFileName } from './registry.js'
import { renderMarkdown } from './report.js'

export class StoreError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'StoreError'
    Object.assign(this, details)
  }
}

/**
 * Where a case goes when nothing is configured: `<dataDir>/cases`.
 *
 * A plugin whose panel opens on an empty screen with "no case directory is
 * configured" is a plugin nobody uses. This directory is created on demand, and
 * `src/host.js` seeds it from the packaged examples the first time it is empty, so
 * the first thing the panel shows is a case that actually runs.
 */
export function defaultCaseDir({ state = {} } = {}) {
  const base = (state && state.dataDir) || process.cwd()
  return resolve(join(base, 'cases'))
}

/** Every directory a case may be read from or written to. */
export function caseRoots({ config = {}, state = {} } = {}) {
  const roots = []
  if (config.caseDir) roots.push(resolve(config.caseDir))
  if (Array.isArray(config.caseDirs)) for (const dir of config.caseDirs) roots.push(resolve(dir))
  if (roots.length === 0 && state && state.lastCaseDir) roots.push(resolve(state.lastCaseDir))
  if (roots.length === 0) {
    const fallback = defaultCaseDir({ state })
    try {
      mkdirSync(fallback, { recursive: true })
      roots.push(fallback)
    } catch {
      /* an unwritable data dir is reported by the first real read or write */
    }
  }
  return roots
}

/** The report directory: explicit config wins, then the plugin's data dir. */
export function reportRoot({ config = {}, state = {} } = {}) {
  return resolve(config.reportDir || join((state && state.dataDir) || process.cwd(), 'reports'))
}

/**
 * True when `candidate` is `root` itself or sits below it. `relative` is the only
 * reliable way to answer this on Windows, where case-insensitive drive letters
 * and `\` vs `/` make string prefix checks lie.
 */
export function isInside(root, candidate) {
  const from = resolve(root)
  const to = resolve(candidate)
  if (from === to) return true
  const rel = relative(from, to)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Resolves a user-supplied case path against the configured roots.
 *
 * An absolute path is accepted only when it is inside a root — otherwise the
 * panel would be an arbitrary-file writer. A relative path is tried against each
 * root in turn, and must exist in one of them.
 */
export async function resolveCasePath(input, roots, options = {}) {
  const name = String(input || '').trim()
  if (!name) throw new StoreError('no case path given')
  if (roots.length === 0) {
    throw new StoreError('no case directory is configured, so there is nowhere to read a case from; set config.caseDir on the plugin')
  }
  const allowMissing = options.allowMissing === true

  const candidates = isAbsolute(name) ? [resolve(name)] : roots.map((root) => resolve(root, name))
  let firstError = null
  for (const candidate of candidates) {
    if (!roots.some((root) => isInside(root, candidate))) continue
    try {
      await stat(candidate)
      return candidate
    } catch (error) {
      if (!firstError) firstError = error
      if (allowMissing && error.code === 'ENOENT') {
        // The parent must still be inside the root, which the check above proved.
        await mkdir(dirname(candidate), { recursive: true })
        return candidate
      }
    }
  }
  const where = roots.join(', ')
  throw new StoreError(
    `${name} is not a case inside ${where}` +
      (firstError && firstError.code === 'ENOENT' ? ' (no such file)' : ''),
    { roots },
  )
}

/**
 * What the panel's case list shows: identity plus a light summary, never the body.
 *
 * The registry file lives in this same directory — the lookup starts here — so it
 * is filtered out. It parses as YAML but not as a case, and reporting it as a
 * broken case would put a permanent red mark on a perfectly healthy folder.
 */
export async function listCasesIn(dir) {
  const { cases, failures } = await loadCaseDirectory(dir)
  const listed = cases.map((entry) => ({
    id: entry.definition.id,
    caseId: entry.definition.caseId,
    caseIdDerived: entry.definition.caseIdDerived === true,
    title: entry.definition.title,
    tags: entry.definition.tags,
    description: entry.definition.description,
    endpoint: entry.definition.endpoint,
    group: entry.definition.group || '',
    scenario: entry.definition.scenario,
    priority: entry.definition.priority,
    file: entry.path,
    name: relative(dir, entry.path).split('\\').join('/'),
    target: entry.definition.env.target || entry.definition.env.baseUrl || null,
    configuration: entry.definition.env.configurationName || null,
    // What the case will actually do, in order. The list shows the count so a
    // one-request skeleton and a five-step scenario are visibly different sizes
    // of thing; `asserts` separates "a plan" from "a test", which is the
    // difference between a green suite and a green-looking one.
    steps: describeSteps(entry.definition),
    asserts: hasAssertions(entry.definition),
    databases: Object.entries(entry.definition.env.databases || {}).map(([key, ref]) => ({
      name: key,
      database: ref.name || key,
      schema: ref.schema || null,
    })),
  }))
  return {
    dir,
    cases: listed,
    groups: groupByEndpoint(listed),
    failures: failures.filter((failure) => !isRegistryFileName(failure.file)),
  }
}

/**
 * Groups cases by the *use case* they belong to, which is how a suite is read:
 * "Blog", "Knowledge Graph", "Checkout" — the thing a person asked for, not the
 * route that happens to implement it. A use case spans endpoints (reading a post
 * is a GET on two different routes), and one endpoint can serve several, so this
 * cannot be derived from the request and is an authored field.
 *
 * A case that names no group falls back to its endpoint, and one with neither
 * lands in a group named after its own id rather than in a silent "other"
 * bucket — the odd one out should be visible, not hidden.
 */
export function groupByEndpoint(cases) {
  const groups = new Map()
  for (const item of cases) {
    const key = item.group || item.endpoint || `(no group) ${item.caseId}`
    if (!groups.has(key)) {
      groups.set(key, {
        group: item.group || null,
        endpoint: item.group ? null : item.endpoint || null,
        cases: [],
        counts: { total: 0, passed: 0, failed: 0, notRun: 0, normal: 0, error: 0 },
      })
    }
    const group = groups.get(key)
    group.cases.push(item)
    group.counts.total += 1
    if (item.scenario === 'error') group.counts.error += 1
    else group.counts.normal += 1
  }
  // Priority first, then the authored order: an urgent failing case should be at
  // the top of its group without anyone having to sort the list by hand.
  const weight = { high: 0, medium: 1, low: 2 }
  for (const group of groups.values()) {
    group.cases.sort((a, b) => {
      const byPriority = (weight[a.priority] ?? 1) - (weight[b.priority] ?? 1)
      return byPriority !== 0 ? byPriority : String(a.caseId).localeCompare(String(b.caseId))
    })
  }
  // Sorted by name, not by insertion order. Insertion order is whatever the case
  // files happen to be named, which would make the group list reshuffle when an
  // unrelated file is renamed.
  return [...groups.values()].sort((a, b) => {
    const left = a.group || a.endpoint || '\uffff'
    const right = b.group || b.endpoint || '\uffff'
    return String(left).localeCompare(String(right))
  })
}

/**
 * The next free number for an endpoint, so a new case can be named before it is
 * written: `REG-001`, `REG-002`, …
 *
 * Numbers are taken from existing `caseId`s with the same prefix, never reused —
 * a case that was deleted leaves its number retired, which keeps every report and
 * ticket that quotes `REG-003` pointing at the thing it meant.
 */
export async function nextCaseId(dir, endpoint) {
  const prefix = endpointPrefix(endpoint)
  let highest = 0
  let taken = new Set()
  try {
    const { cases } = await loadCaseDirectory(dir)
    for (const entry of cases) {
      const caseId = String(entry.definition.caseId || '')
      taken.add(caseId)
      const match = new RegExp(`^${prefix}-(\\d+)$`).exec(caseId)
      if (match) highest = Math.max(highest, Number(match[1]))
    }
  } catch {
    /* an unreadable directory just means the first number is free */
  }
  let next = highest + 1
  while (taken.has(`${prefix}-${String(next).padStart(3, '0')}`)) next += 1
  return `${prefix}-${String(next).padStart(3, '0')}`
}

/** Writes both halves of a report and returns their paths. */
export async function writeReport(report, options = {}) {
  const dir = options.reportDir || reportRoot(options)
  await mkdir(dir, { recursive: true })
  const base = `${report.runId}__${String(report.caseId).replace(/[^\w.-]+/g, '_')}`
  const jsonPath = join(dir, `${base}.json`)
  const mdPath = join(dir, `${base}.md`)
  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8')
  await writeFile(mdPath, renderMarkdown(report), 'utf8')
  return { jsonPath, mdPath, dir }
}

/** The newest reports first, for the panel's run history. */
export async function listReports(options = {}) {
  const dir = options.reportDir || reportRoot(options)
  let names = []
  try {
    names = await readdir(dir)
  } catch (error) {
    if (error.code === 'ENOENT') return { dir, reports: [] }
    throw new StoreError(`cannot read the report directory ${dir}: ${error.message}`)
  }
  const jsonNames = names.filter((name) => name.endsWith('.json'))
  const reports = []
  for (const name of jsonNames) {
    const path = join(dir, name)
    try {
      const info = await stat(path)
      let summary = null
      try {
        const parsed = JSON.parse(await readFile(path, 'utf8'))
        summary = {
          runId: parsed.runId,
          caseId: parsed.caseId,
          title: parsed.title,
          verdict: parsed.verdict,
          startedAt: parsed.startedAt,
          durationMs: parsed.durationMs,
          checks: Array.isArray(parsed.checks) ? parsed.checks.length : 0,
          failed: Array.isArray(parsed.failedChecks) ? parsed.failedChecks.length : 0,
        }
      } catch {
        /* a half-written report is not worth failing the listing over */
      }
      reports.push({
        name,
        path,
        // The same run writes `<run>.md` and `<run>.json`. Handing the panel both
        // paths keeps the `.json` → `.md` rewrite out of the browser, where a
        // rename convention that drifts from this one would fail silently.
        markdownPath: path.replace(/\.json$/i, '.md'),
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
        summary,
      })
    } catch {
      /* it vanished between readdir and stat */
    }
  }
  reports.sort((left, right) => String(right.modifiedAt).localeCompare(String(left.modifiedAt)))
  return { dir, reports }
}

/** Reads one report, JSON or markdown, by path. Refuses anything outside the report root. */
export async function readReport(input, options = {}) {
  const dir = options.reportDir || reportRoot(options)
  const name = String(input || '').trim()
  if (!name) throw new StoreError('no report path given')
  const candidate = isAbsolute(name) ? resolve(name) : resolve(dir, name)
  if (!isInside(dir, candidate)) {
    throw new StoreError(`${name} is not a report inside ${dir}`)
  }
  const text = await readFile(candidate, 'utf8')
  if (candidate.endsWith('.json')) {
    return { path: candidate, format: 'json', report: JSON.parse(text) }
  }
  return { path: candidate, format: 'markdown', markdown: text }
}

/** Deletes one case file. Refuses anything outside the case roots. */
export async function deleteCase(input, roots) {
  const path = await resolveCasePath(input, roots)
  await unlink(path)
  return path
}
