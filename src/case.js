/**
 * dsh-e2e — case loading, validation and variable interpolation.
 *
 * A case is data, never code: the runner only ever performs the fixed set of
 * actions a case names (start the service, run setup SQL, send a request, read
 * logs, query the database, assert). That is what keeps the tool safe to hand to
 * an agent.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve, isAbsolute } from 'node:path'
import crypto from 'node:crypto'
import { readYamlFile } from './yaml.js'

export class CaseError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'CaseError'
    Object.assign(this, details)
  }
}

const SUPPORTED_KEYS = new Set([
  'id',
  'caseId',
  'title',
  'description',
  'tags',
  'group',
  'endpoint',
  'scenario',
  'priority',
  'env',
  'setup',
  'request',
  'expect',
  'browser',
  'teardown',
])

/**
 * The scenarios a case may declare. `normal` is the path a user takes when
 * nothing goes wrong; `error` is everything else — validation, authorisation,
 * conflict, boundary. The point of the field is the *gap* it exposes: a suite
 * where every case is `normal` has never tested a failure, and that is invisible
 * without it.
 */
const SCENARIOS = new Set(['normal', 'error'])

/** Triage levels. Order matters: it is the sort order of "run the important ones first". */
const PRIORITIES = new Set(['high', 'medium', 'low'])

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE'])

const ENV_KEYS = new Set([
  'target',
  'baseUrl',
  'healthPath',
  'projectPath',
  'configurationName',
  'profile',
  'insecureTls',
  'database',
  'databases',
  'mocks',
  'startTimeoutMs',
  'keepServiceRunning',
  'serviceRequired',
])

/**
 * Fields a case may NOT carry, because they describe where a database lives
 * rather than what the case asserts. Keeping them out is the point of the
 * registry: a case file is copied between machines and pasted into issues, so it
 * must not hold a host, a user or a password.
 */
const DATABASE_CONNECTION_KEYS = new Set(['host', 'port', 'user', 'password', 'kind', 'jdbcUrl', 'jdbc-url', 'url'])

const DATABASE_REF_KEYS = new Set(['name', 'schema', 'description'])

/**
 * Loads one case file. `dir` is the directory containing it, used to resolve the
 * relative SQL and stub files the case names.
 */
export async function loadCaseFile(path, options = {}) {
  const absolute = resolve(options.baseDir || process.cwd(), path)
  const raw = await readYamlFile(absolute)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CaseError(`${absolute} must contain a single YAML mapping, not ${Array.isArray(raw) ? 'a list' : typeof raw}`)
  }
  const caseDir = join(absolute, '..')
  const definition = await normalizeCase(raw, caseDir, absolute)
  return { definition, path: absolute, dir: caseDir }
}

/** Loads every `*.yaml` / `*.yml` in a directory, sorted by id for stable runs. */
export async function loadCaseDirectory(dir) {
  const absolute = resolve(dir)
  let entries
  try {
    entries = await readdir(absolute, { withFileTypes: true })
  } catch (error) {
    throw new CaseError(`cannot read case directory ${absolute}: ${error.message}`)
  }
  const files = entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort()
  const loaded = []
  const failures = []
  for (const file of files) {
    try {
      loaded.push(await loadCaseFile(join(absolute, file)))
    } catch (error) {
      failures.push({ file, error: error.message })
    }
  }
  loaded.sort((a, b) => String(a.definition.id).localeCompare(String(b.definition.id)))
  return { cases: loaded, failures, dir: absolute }
}

export async function normalizeCase(raw, caseDir, source) {
  const unknown = Object.keys(raw).filter((key) => !SUPPORTED_KEYS.has(key))
  if (unknown.length > 0) {
    throw new CaseError(`${source}: unknown top-level field(s) ${unknown.join(', ')}; allowed: ${[...SUPPORTED_KEYS].join(', ')}`)
  }
  if (!raw.id) throw new CaseError(`${source}: every case needs an "id"`)
  const env = raw.env && typeof raw.env === 'object' ? raw.env : {}
  const unknownEnv = Object.keys(env).filter((key) => !ENV_KEYS.has(key))
  if (unknownEnv.length > 0) {
    throw new CaseError(`${source}: unknown env field(s) ${unknownEnv.join(', ')}; allowed: ${[...ENV_KEYS].join(', ')}`)
  }

  const setup = await normalizeSetup(raw.setup, caseDir, source)
  const teardown = await normalizeTeardown(raw.teardown, caseDir, source)
  const request = normalizeRequest(raw.request, source)
  const expect = normalizeExpect(raw.expect, source)
  const browser = normalizeBrowser(raw.browser, source)

  const endpoint = normalizeEndpoint(raw.endpoint, request, source)
  const id = String(raw.id)
  // `caseId` is what a failure list, a report and a chat message quote, so it has
  // to survive a retitle. `id` does not: it is a slug of the title in practice,
  // and it changes when the title does. A case written by hand may leave it out;
  // then it is derived from the endpoint and the id, which is stable as long as
  // those two are, and `caseIdDerived` says so instead of pretending it was
  // authored. The scaffold and the panel always assign one up front.
  const caseId = raw.caseId ? requireString(raw.caseId, `${source}: caseId`) : deriveCaseId(endpoint, id)
  const caseIdDerived = !raw.caseId

  return {
    id,
    caseId,
    caseIdDerived,
    title: raw.title ? String(raw.title) : String(raw.id),
    description: raw.description ? String(raw.description) : '',
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    // The use case this case belongs to: "Blog", "Knowledge Graph", "Checkout".
    // Not derivable from the request — `POST /auth/register` belongs to
    // "Registration" on one service and to "Onboarding" on another. Left empty it
    // falls back to the endpoint when grouping, so a suite that never sets it
    // still reads as a list of routes rather than one anonymous heap.
    group: raw.group ? requireString(raw.group, `${source}: group`) : '',
    endpoint,
    scenario: normalizeScenario(raw.scenario, source),
    priority: normalizePriority(raw.priority, source),
    env: {
      // A target names where the service lives and which run configuration starts
      // it. The case may also spell those out inline, which is what a one-off
      // local run does; a target in the registry is what a team shares.
      target: env.target ? String(env.target) : null,
      baseUrl: env.baseUrl ? String(env.baseUrl) : null,
      healthPath: env.healthPath ? String(env.healthPath) : null,
      projectPath: env.projectPath ? String(env.projectPath) : '',
      configurationName: env.configurationName ? String(env.configurationName) : '',
      profile: env.profile ? String(env.profile) : '',
      insecureTls: env.insecureTls === true,
      // A database reference is a name plus, optionally, the schema this case
      // reads. Everything else — host, port, user, password — belongs to the
      // registry, so the case stays portable and credential-free.
      database: env.database ? normalizeDatabaseRef(env.database, `${source}: env.database`) : null,
      // A service can write to more than one database and both matter: the case
      // may assert on the same row in each one, which is how a "dual write
      // silently skipped the second database" bug gets caught.
      databases: normalizeDatabases(env.databases, env.database, source),
      mocks: env.mocks && typeof env.mocks === 'object' ? env.mocks : null,
      // Left null when the case says nothing, so a target in the registry can
      // supply it; the resolver falls back to two minutes.
      startTimeoutMs: env.startTimeoutMs === undefined ? null : Number(env.startTimeoutMs),
      keepServiceRunning: env.keepServiceRunning === true,
      serviceRequired: env.serviceRequired !== false,
    },
    setup,
    request,
    expect,
    browser,
    teardown,
    source,
    dir: caseDir,
  }
}

/**
 * A database *reference* names which database to use and, optionally, which
 * schema in it this case reads. It never carries a host, a user or a password:
 * those live in the registry (`e2e.registry.yml`) or come from the dsh-db-mcp
 * plugin's own datasource list, keyed by the same name. That is what lets a case
 * file be copied between machines, pasted into a ticket, or committed to a repo
 * without leaking credentials or pinning one developer's port numbers.
 */
function normalizeDatabaseRef(value, label) {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return { name: value.trim(), schema: null, description: '' }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new CaseError(`${label} must be a name, or a mapping with "name" and optional "schema"`)
  }
  const forbidden = Object.keys(value).filter((key) => DATABASE_CONNECTION_KEYS.has(key))
  if (forbidden.length > 0) {
    throw new CaseError(
      `${label} must not carry connection details (${forbidden.join(', ')}): a case names a database, it does not connect to one. ` +
        `Put the connection in e2e.registry.yml (or add it to the dsh-db-mcp plugin) and reference it by name here.`,
    )
  }
  const unknown = Object.keys(value).filter((key) => !DATABASE_REF_KEYS.has(key))
  if (unknown.length > 0) {
    throw new CaseError(`${label}: unknown field(s) ${unknown.join(', ')}; allowed: ${[...DATABASE_REF_KEYS].join(', ')}`)
  }
  const name = value.name === undefined || value.name === null ? 'default' : String(value.name).trim()
  if (!name) throw new CaseError(`${label}.name must not be empty`)
  return {
    name,
    schema: value.schema ? String(value.schema) : null,
    description: value.description ? String(value.description) : '',
  }
}

/**
 * `env.databases` is a named map used when the service writes to more than one
 * database. `env.database` stays as the unnamed default, so a single-database
 * case does not have to invent a name.
 *
 * Every value is a reference (name + optional schema), never a connection.
 */
function normalizeDatabases(map, fallback, source) {
  const result = {}
  if (map !== undefined && map !== null) {
    if (typeof map !== 'object' || Array.isArray(map)) {
      throw new CaseError(`${source}: env.databases must be a mapping of name -> database reference`)
    }
    for (const [key, value] of Object.entries(map)) {
      const ref = normalizeDatabaseRef(value, `${source}: env.databases.${key}`)
      result[key] = { ...ref, alias: key }
    }
  }
  if (Object.keys(result).length === 0 && fallback) {
    const ref = normalizeDatabaseRef(fallback, `${source}: env.database`)
    result.default = { ...ref, alias: 'default' }
  }
  return result
}

async function normalizeSetup(setup, caseDir, source) {
  if (!setup) return { sqlFiles: [], sql: [], http: [], capture: [], mocks: null }
  const result = { sqlFiles: [], sql: [], http: [], capture: [], mocks: null }
  if (typeof setup === 'string') {
    result.sqlFiles.push(await resolveFile(caseDir, setup, source))
    return result
  }
  if (typeof setup !== 'object') throw new CaseError(`${source}: setup must be a mapping or a file name`)
  if (setup.sqlFile) result.sqlFiles.push(await resolveFile(caseDir, setup.sqlFile, source))
  if (Array.isArray(setup.sqlFiles)) {
    for (const file of setup.sqlFiles) result.sqlFiles.push(await resolveFile(caseDir, file, source))
  }
  if (Array.isArray(setup.sql)) result.sql = setup.sql.map(String)
  else if (typeof setup.sql === 'string') result.sql = [setup.sql]
  result.http = normalizePrepRequests(setup.http, `${source}: setup.http`)
  result.capture = normalizeCaptures(setup.capture, `${source}: setup.capture`)
  if (setup.mocks) {
    result.mocks = {
      scenario: setup.mocks.scenario ? String(setup.mocks.scenario) : 'success',
      stubFile: setup.mocks.stubFile ? await resolveFile(caseDir, setup.mocks.stubFile, source) : null,
    }
  }
  return result
}

/**
 * `setup.capture` reads a value the service generated (a verification code, an
 * id, a token) out of the database and binds it to a case variable, so the
 * request under test can use it. Without this a case cannot verify anything the
 * server invents: the value does not exist until the service runs.
 *
 * Captures run after setup.sql and setup.http, because the value they read is
 * usually produced by one of those.
 */
function normalizeCaptures(list, label) {
  if (list === undefined || list === null) return []
  if (!Array.isArray(list)) throw new CaseError(`${label} must be a list`)
  return list.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new CaseError(`${label}[${index}] must be a mapping`)
    if (!entry.name) throw new CaseError(`${label}[${index}] needs a "name" to bind the value to`)
    if (!entry.sql) throw new CaseError(`${label}[${index}] needs a "sql" query`)
    return {
      name: String(entry.name),
      database: entry.database ? String(entry.database) : 'default',
      sql: String(entry.sql),
      column: entry.column ? String(entry.column) : null,
      required: entry.required !== false,
      description: entry.description ? String(entry.description) : '',
    }
  })
}

async function normalizeTeardown(teardown, caseDir, source) {
  if (!teardown) return { sqlFiles: [], sql: [], http: [], capture: [], mocks: null }
  if (typeof teardown === 'string') {
    return { sqlFiles: [await resolveFile(caseDir, teardown, source)], sql: [], http: [], capture: [], mocks: null }
  }
  const result = { sqlFiles: [], sql: [], http: [], capture: [], mocks: null }
  if (teardown.sqlFile) result.sqlFiles.push(await resolveFile(caseDir, teardown.sqlFile, source))
  if (Array.isArray(teardown.sqlFiles)) {
    for (const file of teardown.sqlFiles) result.sqlFiles.push(await resolveFile(caseDir, file, source))
  }
  if (Array.isArray(teardown.sql)) result.sql = teardown.sql.map(String)
  else if (typeof teardown.sql === 'string') result.sql = [teardown.sql]
  result.http = normalizePrepRequests(teardown.http, `${source}: teardown.http`)
  if (teardown.mocks === 'reset' || teardown.mocks === true) result.mocks = 'reset'
  return result
}

/**
 * Setup/teardown requests prepare state through the service's own API instead of
 * SQL. This is how a case flips a feature flag, warms a cache, or — as in the
 * example cases here — puts the service into the mode the case is written for,
 * without the tool needing a driver for every database the service might use.
 */
function normalizePrepRequests(list, label) {
  if (list === undefined || list === null) return []
  if (!Array.isArray(list)) throw new CaseError(`${label} must be a list`)
  return list.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new CaseError(`${label}[${index}] must be a mapping`)
    if (!entry.path && !entry.url) throw new CaseError(`${label}[${index}] needs "path" (or an absolute "url")`)
    return {
      method: String(entry.method || 'POST').toUpperCase(),
      path: entry.path ? String(entry.path) : null,
      url: entry.url ? String(entry.url) : null,
      headers: entry.headers && typeof entry.headers === 'object' ? { ...entry.headers } : {},
      json: entry.json ?? null,
      bodyTemplate: entry.body_template ?? entry.bodyTemplate ?? null,
      expectStatus: entry.expect_status === undefined && entry.expectStatus === undefined ? null : Number(entry.expect_status ?? entry.expectStatus),
      bodyContains: entry.body_contains ? String(entry.body_contains) : entry.bodyContains ? String(entry.bodyContains) : null,
      bodyNotContains: entry.body_not_contains ? String(entry.body_not_contains) : entry.bodyNotContains ? String(entry.bodyNotContains) : null,
      description: entry.description ? String(entry.description) : '',
      timeoutMs: Number(entry.timeoutMs || 30000),
    }
  })
}

/**
 * The endpoint a case belongs to, as `METHOD /path`.
 *
 * This is the grouping key of the case list: every scenario of one endpoint sits
 * under one heading, so "this endpoint has three scenarios, one of them failing"
 * is a single line rather than three unrelated rows. When the case omits it, it
 * is derived from `request` — which is the truth anyway, because the request is
 * what actually gets sent. Writing it out is only useful when the request path
 * carries a variable (`/users/${id}`) and the author wants the group to read
 * `/users/:id`.
 */
function normalizeEndpoint(value, request, source) {
  if (value === undefined || value === null || value === '') {
    const path = request.path || pathOfUrl(request.url)
    return path ? `${request.method} ${path}` : null
  }
  if (typeof value !== 'string') {
    throw new CaseError(`${source}: endpoint must be a string like "POST /auth/register"`)
  }
  const text = value.trim()
  const match = /^([A-Za-z]+)\s+(\S.*)$/.exec(text)
  if (!match) {
    throw new CaseError(`${source}: endpoint "${text}" must start with an HTTP method, like "POST /auth/register"`)
  }
  const method = match[1].toUpperCase()
  if (!HTTP_METHODS.has(method)) {
    throw new CaseError(`${source}: endpoint "${text}" uses ${method}, which is not an HTTP method`)
  }
  return `${method} ${match[2].trim()}`
}

/** The path part of an absolute URL, so a case that only has `url` still groups. */
function pathOfUrl(url) {
  if (!url) return null
  try {
    return new URL(url).pathname
  } catch {
    return null
  }
}

function normalizeScenario(value, source) {
  if (value === undefined || value === null || value === '') return 'normal'
  const text = String(value).trim().toLowerCase()
  if (!SCENARIOS.has(text)) {
    throw new CaseError(`${source}: scenario must be one of ${[...SCENARIOS].join(', ')}, not "${value}"`)
  }
  return text
}

function normalizePriority(value, source) {
  if (value === undefined || value === null || value === '') return 'medium'
  const text = String(value).trim().toLowerCase()
  if (!PRIORITIES.has(text)) {
    throw new CaseError(`${source}: priority must be one of ${[...PRIORITIES].join(', ')}, not "${value}"`)
  }
  return text
}

/**
 * A case id a human can quote, derived from the endpoint: `POST /auth/register`
 * → `REG`. The scaffold uses it to mint `REG-001`, `REG-002` when it creates a
 * case, which is where an id is actually assigned — at creation, when the next
 * free number is knowable. A file written by hand falls back to its `id`.
 */
export function endpointPrefix(endpoint) {
  if (!endpoint) return 'CASE'
  const path = String(endpoint).split(/\s+/).slice(1).join(' ')
  // A path variable carries no meaning (`/users/{id}` → `ID`), so drop the last
  // segment when it is one and use the segment that names the resource.
  const segments = path.split('/').filter(Boolean).filter((part) => !/^[{}:<]/.test(part) && part !== ':id')
  const segment = segments.pop() || 'case'
  const letters = segment.replace(/[^A-Za-z]/g, '')
  if (letters.length === 0) return 'CASE'
  // Camel case gives the best abbreviation: resendActiveCode → RAC.
  const parts = segment.match(/[A-Z][a-z0-9]*|[a-z0-9]+/g) || []
  if (parts.length > 1) return parts.map((part) => part[0].toUpperCase()).join('').slice(0, 4)
  // Plural is dropped before abbreviating, so `/users` reads USER, not USE.
  const word = letters.length > 3 && /[^s]s$/.test(letters) ? letters.slice(0, -1) : letters
  // A short word is used whole (`test` → `TEST`); a longer one is cut to three
  // letters, because four letters of a long word reads like a typo
  // (`register` → `REGI`) while three reads like an abbreviation (`REG`).
  return word.length <= 4 ? word.toUpperCase() : word.slice(0, 3).toUpperCase()
}

/**
 * Inserts a `caseId:` line into case YAML that does not have one.
 *
 * Textual, not parse-and-dump: re-dumping the document would throw away every
 * comment in it, and the comments are where the author wrote down what the case is
 * supposed to prove. A one-line insertion after `id:` keeps the file exactly as it
 * was apart from the new line.
 *
 * Returns the original text untouched when a caseId is already present, so calling
 * this on every save is safe.
 */
export function withCaseId(yaml, caseId) {
  const text = String(yaml ?? '')
  if (!caseId) return text
  if (/^caseId\s*:/m.test(text)) return text
  const lines = text.split('\n')
  const idIndex = lines.findIndex((line) => /^id\s*:/.test(line))
  if (idIndex === -1) {
    // No `id:` to anchor to. Prepending would put the caseId above the comment
    // block that explains the file, which reads wrong, so it goes after the
    // leading comment block instead.
    let insertAt = 0
    while (insertAt < lines.length && /^\s*(#|$)/.test(lines[insertAt])) insertAt += 1
    lines.splice(insertAt, 0, `caseId: ${caseId}`)
    return lines.join('\n')
  }
  lines.splice(idIndex + 1, 0, `caseId: ${caseId}`)
  return lines.join('\n')
}

/**
 * A fallback id for a hand-written case that names none. It is derived, not
 * invented: `POST /auth/register` + `post-auth-register` → `REG-post-auth-register`.
 * `caseIdDerived` marks it so the panel can offer to assign a real number instead
 * of silently presenting a derived string as an authored one.
 */
export function deriveCaseId(endpoint, id) {
  return `${endpointPrefix(endpoint)}-${id}`
}

function requireString(value, label) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new CaseError(`${label} must be a string`)
  }
  const text = String(value).trim()
  if (!text) throw new CaseError(`${label} must not be empty`)
  return text
}

function normalizeRequest(request, source) {
  if (!request || typeof request !== 'object') {
    throw new CaseError(`${source}: a case needs a "request" mapping`)
  }
  const method = String(request.method || 'GET').toUpperCase()
  if (!request.path && !request.url) {
    throw new CaseError(`${source}: request needs "path" (or an absolute "url")`)
  }
  return {
    method,
    path: request.path ? String(request.path) : null,
    url: request.url ? String(request.url) : null,
    headers: request.headers && typeof request.headers === 'object' ? { ...request.headers } : {},
    bodyTemplate: request.body_template ?? request.bodyTemplate ?? null,
    bodyJson: request.json ?? null,
    variables: request.variables && typeof request.variables === 'object' ? { ...request.variables } : {},
    timeoutMs: Number(request.timeoutMs || 30000),
  }
}

/**
 * `expect.calls` are follow-up requests sent after the request under test, each
 * with its own assertions. They exist because some state is only observable
 * through the service itself: a dual-write service can report its own
 * consistency, and that report covers the database this tool cannot open
 * directly (Oracle has no driver here).
 */
function normalizeProbes(list, label) {
  if (list === undefined || list === null) return []
  if (!Array.isArray(list)) throw new CaseError(`${label} must be a list`)
  return list.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new CaseError(`${label}[${index}] must be a mapping`)
    if (!entry.path && !entry.url) throw new CaseError(`${label}[${index}] needs "path" (or an absolute "url")`)
    const json = Array.isArray(entry.json_expect) ? entry.json_expect : Array.isArray(entry.jsonExpect) ? entry.jsonExpect : []
    for (const item of json) {
      if (!item || typeof item !== 'object' || !item.path) throw new CaseError(`${label}[${index}]: every json_expect entry needs a "path"`)
    }
    return {
      method: String(entry.method || 'GET').toUpperCase(),
      path: entry.path ? String(entry.path) : null,
      url: entry.url ? String(entry.url) : null,
      headers: entry.headers && typeof entry.headers === 'object' ? { ...entry.headers } : {},
      json: entry.json ?? null,
      bodyTemplate: entry.body_template ?? entry.bodyTemplate ?? null,
      description: entry.description ? String(entry.description) : '',
      expectStatus: entry.expect_status === undefined && entry.expectStatus === undefined ? null : Number(entry.expect_status ?? entry.expectStatus),
      bodyContains: entry.body_contains ? String(entry.body_contains) : entry.bodyContains ? String(entry.bodyContains) : null,
      bodyNotContains: entry.body_not_contains ? String(entry.body_not_contains) : entry.bodyNotContains ? String(entry.bodyNotContains) : null,
      jsonExpect: json,
      timeoutMs: Number(entry.timeoutMs || 30000),
    }
  })
}

/**
 * The `browser` block: a user journey, checked the way a user would notice it.
 *
 * A backend case proves what the service *answered*. That is a different question
 * from "what did the page show": a 200 with an empty table passes every HTTP
 * assertion in this tool and is still a bug. The block exists so a case can walk
 * the page — fill a field, click a button, assert the text — and come back with a
 * screenshot as evidence.
 *
 * Steps are a small fixed vocabulary rather than free-form script: a test that
 * can run arbitrary JavaScript is a test whose failure you cannot interpret.
 */
function normalizeBrowser(browser, source) {
  if (!browser) return null
  if (typeof browser !== 'object' || Array.isArray(browser)) {
    throw new CaseError(`${source}: browser must be a mapping with a url and steps`)
  }
  const unknown = Object.keys(browser).filter(
    (key) => !['url', 'steps', 'viewport', 'timeoutMs', 'browserPath', 'insecureTls', 'prefix'].includes(key),
  )
  if (unknown.length > 0) {
    throw new CaseError(
      `${source}: unknown browser field(s) ${unknown.join(', ')}; allowed: url, steps, viewport, timeoutMs, browserPath, insecureTls, prefix`,
    )
  }
  if (!browser.url) throw new CaseError(`${source}: browser needs a "url" (an absolute URL or a path under env.baseUrl)`)
  if (typeof browser.url !== 'string') {
    // `url: 1` is truthy and would otherwise arrive at the browser as "1" — a
    // path that resolves to nothing and fails at navigate time, far from here.
    throw new CaseError(`${source}: browser.url must be a string, not ${JSON.stringify(browser.url)}`)
  }

  const viewport = browser.viewport
    ? { width: Number(browser.viewport.width), height: Number(browser.viewport.height) }
    : { width: 1280, height: 800 }
  for (const [key, value] of Object.entries(viewport)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new CaseError(`${source}: browser.viewport.${key} must be a positive number, not ${JSON.stringify(browser.viewport[key])}`)
    }
  }

  const rawSteps = browser.steps === undefined ? [] : browser.steps
  if (!Array.isArray(rawSteps)) throw new CaseError(`${source}: browser.steps must be a list`)

  const steps = rawSteps.map((entry, index) => {
    const at = `${source}: browser.steps[${index}]`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new CaseError(`${at} must be a mapping with exactly one step key`)
    }
    const keys = Object.keys(entry)
    if (keys.length !== 1) {
      throw new CaseError(
        `${at} has ${keys.length} keys (${keys.join(', ')}); each step is one action so the report can name it`,
      )
    }
    const kind = keys[0]
    const value = entry[kind]
    switch (kind) {
      case 'screenshot':
        return { screenshot: String(value) }
      case 'click':
        return requiresSelector(at, kind, value) ? { click: String(value) } : null
      case 'fill': {
        if (!value || typeof value !== 'object') throw new CaseError(`${at}.fill must be a mapping with selector and value`)
        if (!value.selector) throw new CaseError(`${at}.fill needs a "selector"`)
        if (value.value === undefined) throw new CaseError(`${at}.fill needs a "value" (use "" to clear a field)`)
        return { fill: { selector: String(value.selector), value: String(value.value) }, settleMs: settle(value.settleMs) }
      }
      case 'press': {
        if (!value || typeof value !== 'object') throw new CaseError(`${at}.press must be a mapping with selector and key`)
        if (!value.selector) throw new CaseError(`${at}.press needs a "selector"`)
        return { press: { selector: String(value.selector), key: String(value.key || 'Enter') }, settleMs: settle(value.settleMs) }
      }
      case 'wait':
        if (!Number.isFinite(Number(value))) throw new CaseError(`${at}.wait must be a number of milliseconds`)
        return { wait: Number(value) }
      case 'waitFor': {
        if (typeof value === 'string') return { waitFor: value }
        if (!value || typeof value !== 'object' || !value.selector) {
          throw new CaseError(`${at}.waitFor must be a selector, or a mapping with "selector" and optional "timeoutMs"`)
        }
        return { waitFor: String(value.selector), timeoutMs: value.timeoutMs === undefined ? undefined : Number(value.timeoutMs) }
      }
      case 'assertText': {
        if (!value || typeof value !== 'object' || !value.selector) {
          throw new CaseError(`${at}.assertText needs a "selector"`)
        }
        if (value.contains === undefined) {
          throw new CaseError(`${at}.assertText needs "contains" — an assertion that does not say what it expects cannot fail`)
        }
        return {
          assertText: { selector: String(value.selector), contains: String(value.contains), description: value.description ? String(value.description) : '' },
        }
      }
      // `assertVisible: '#id'` and `assertVisible: { selector, description }`.
      case 'assertVisible':
        if (typeof value === 'string') return { assertVisible: value }
        if (!value || typeof value !== 'object' || !value.selector) {
          throw new CaseError(`${at}.assertVisible must be a selector, or a mapping with "selector"`)
        }
        return { assertVisible: String(value.selector), description: value.description ? String(value.description) : '' }
      default:
        throw new CaseError(
          `${at} is "${kind}", which is not a browser step; allowed: screenshot, click, fill, press, wait, waitFor, assertText, assertVisible`,
        )
    }
  })
  if (steps.some((step) => step === null)) {
    throw new CaseError(`${source}: browser.steps could not be normalised`)
  }

  return {
    url: String(browser.url),
    steps,
    viewport,
    // Left null so the resolver's default applies; the browser block is often
    // written before anyone knows how slow the page is.
    timeoutMs: browser.timeoutMs === undefined ? null : Number(browser.timeoutMs),
    browserPath: browser.browserPath ? String(browser.browserPath) : null,
    insecureTls: browser.insecureTls === true,
    prefix: browser.prefix ? String(browser.prefix) : 'shot',
  }
}

/** `settleMs` is a knob, not a contract: absent means "the default pause". */
function settle(value) {
  if (value === undefined) return undefined
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) {
    throw new CaseError(`settleMs must be a non-negative number of milliseconds, not ${JSON.stringify(value)}`)
  }
  return number
}

/** Every step that takes a selector has to say which one. */
function requiresSelector(at, kind, value) {
  if (!value) throw new CaseError(`${at}.${kind} needs a CSS selector`)
  return true
}

function normalizeExpect(expect, source) {
  const result = {
    response: null,
    database: [],
    logs: null,
    calls: [],
    maxDurationMs: null,
  }
  if (!expect) return result
  if (typeof expect !== 'object') throw new CaseError(`${source}: expect must be a mapping`)

  result.calls = normalizeProbes(expect.calls, `${source}: expect.calls`)

  if (expect.response) {
    const response = expect.response
    result.response = {
      status: response.status === undefined ? null : Number(response.status),
      statusIn: Array.isArray(response.statusIn) ? response.statusIn.map(Number) : null,
      json: Array.isArray(response.json) ? response.json : [],
      schema: response.schema || null,
      bodyContains: response.body_contains ? String(response.body_contains) : response.bodyContains ? String(response.bodyContains) : null,
      bodyNotContains: response.body_not_contains ? String(response.body_not_contains) : null,
      maxDurationMs: response.maxDurationMs ? Number(response.maxDurationMs) : null,
    }
    for (const item of result.response.json) {
      if (!item || typeof item !== 'object' || !item.path) {
        throw new CaseError(`${source}: every expect.response.json entry needs a "path"`)
      }
    }
  }

  if (Array.isArray(expect.database)) {
    result.database = expect.database.map((item, index) => {
      if (!item || typeof item !== 'object' || !item.sql) {
        throw new CaseError(`${source}: expect.database[${index}] needs a "sql"`)
      }
      return {
        sql: String(item.sql),
        database: item.database ? String(item.database) : 'default',
        description: item.description ? String(item.description) : '',
        rowCount: item.rowCount === undefined ? null : Number(item.rowCount),
        rowCountAtLeast: item.rowCountAtLeast === undefined ? null : Number(item.rowCountAtLeast),
        rows: normalizeRowAssertions(item.rows, `${source}: expect.database[${index}].rows`),
        equals: item.equals && typeof item.equals === 'object' ? item.equals : null,
        notEmpty: item.notEmpty === true,
        empty: item.empty === true,
      }
    })
  }

  if (expect.logs) {
    result.logs = {
      traceId: expect.logs.traceId ? String(expect.logs.traceId) : null,
      mustContain: toList(expect.logs.must_contain ?? expect.logs.mustContain),
      mustNotContain: toList(expect.logs.must_not_contain ?? expect.logs.mustNotContain),
      regex: toList(expect.logs.regex),
      maxLines: Number(expect.logs.maxLines || 4000),
    }
  }

  if (expect.maxDurationMs) result.maxDurationMs = Number(expect.maxDurationMs)
  return result
}

/**
 * Per-row assertions on a query result. Each entry names a `path` into the
 * result set (`[0].valid_state`) and the expectation for that value.
 */
function normalizeRowAssertions(list, label) {
  if (list === undefined || list === null) return []
  if (!Array.isArray(list)) throw new CaseError(`${label} must be a list`)
  return list.map((item, index) => {
    if (!item || typeof item !== 'object') throw new CaseError(`${label}[${index}] must be a mapping`)
    if (!item.path) throw new CaseError(`${label}[${index}] needs a "path" like "[0].column"`)
    return { ...item, path: String(item.path) }
  })
}

function toList(value) {
  if (value === undefined || value === null) return []
  if (Array.isArray(value)) return value.map(String)
  return [String(value)]
}

async function resolveFile(caseDir, name, source) {
  const target = isAbsolute(name) ? name : join(caseDir, name)
  try {
    await readFile(target)
  } catch (error) {
    throw new CaseError(`${source}: cannot read ${target}: ${error.message}`)
  }
  return target
}

/**
 * `${...}` interpolation over a flat variable map plus a few generators. Values
 * that are not strings are left alone so YAML numbers stay numbers.
 */
export function interpolate(value, variables, options = {}) {
  if (typeof value === 'string') return interpolateString(value, variables, options)
  if (Array.isArray(value)) return value.map((item) => interpolate(item, variables, options))
  if (value && typeof value === 'object') {
    const result = {}
    for (const [key, item] of Object.entries(value)) result[key] = interpolate(item, variables, options)
    return result
  }
  return value
}

export function interpolateString(text, variables, options = {}) {
  const missing = options.missing || (() => {})
  return String(text).replace(/\$\{([^}]+)\}/g, (whole, expression) => {
    const key = expression.trim()
    if (Object.prototype.hasOwnProperty.call(variables, key)) {
      const value = variables[key]
      return value === undefined || value === null ? '' : String(value)
    }
    const generated = generate(key)
    if (generated !== undefined) return generated
    missing(key)
    return whole
  })
}

/** Built-in generators so a case can create unique data without extra plumbing. */
function generate(key) {
  switch (key) {
    case 'random.uuid':
      return crypto.randomUUID()
    case 'random.hex':
      return crypto.randomBytes(8).toString('hex')
    case 'random.int':
      return String(crypto.randomInt(100000, 999999))
    case 'now.iso':
      return new Date().toISOString()
    case 'now.epochMs':
      return String(Date.now())
    case 'now.traceId':
      return crypto.randomBytes(16).toString('hex')
    default:
      return undefined
  }
}

/**
 * Case-scoped variables: request.variables overrides env-provided defaults.
 *
 * Values are themselves interpolated, so a case can write
 * `user.name: e2e${random.hex}` and get a fresh name per run. Without this the
 * literal text `${random.hex}` reached the request body and every run reused the
 * same "unique" user, which defeats the point of having generators.
 *
 * Interpolation runs in declaration order, so a later variable may reference an
 * earlier one (`user.email: ${user.name}@example.test`).
 */
export function buildVariables(definition, extra = {}) {
  const variables = { 'case.id': definition.id, 'case.title': definition.title }
  for (const [key, value] of Object.entries(definition.request.variables || {})) {
    variables[key] = typeof value === 'string' ? interpolateString(value, variables) : value
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) variables[key] = value
  }
  return variables
}
