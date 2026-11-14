/**
 * dsh-e2e — the registry of databases and targets.
 *
 * A case file names *what* it wants to test, never *where* the thing lives. It
 * says `target: record` and `database: iam_db`; the connection details — host,
 * port, user, password — live here, outside the case, so that:
 *
 *   - a case is portable. The same file runs against your laptop and a shared
 *     test box, because only the registry changes;
 *   - no credential is ever committed next to an assertion. A case file is the
 *     thing people copy between repositories and paste into issues;
 *   - rotating a password is one edit in one place instead of a sweep through
 *     every YAML that mentions it.
 *
 * Three sources, later wins: the plugin config, a registry file next to the
 * cases, then `${env:...}` expansion of whatever came out of both. A database
 * may also be imported from dsh-db-mcp's own registry, which already holds the
 * connections you registered there — that is why `from: db-mcp` exists instead
 * of making you retype a password you already stored once.
 */
import { createDecipheriv } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { readYamlFile } from './yaml.js'

export class RegistryError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'RegistryError'
    Object.assign(this, details)
  }
}

/** Names a case may put in `env.database` / `env.databases`. */
const DATABASE_KEYS = new Set(['name', 'schema', 'description', 'from', 'id', 'kind', 'host', 'port', 'database', 'user', 'password', 'connectTimeoutMs', 'statementTimeoutMs'])
const TARGET_KEYS = new Set(['projectPath', 'configurationPath', 'configurationName', 'baseUrl', 'healthPath', 'insecureTls', 'profile', 'startTimeoutMs', 'description'])
const REGISTRY_FILE_NAMES = ['e2e.registry.yml', 'e2e.registry.yaml']

/**
 * Whether a file name is this plugin's registry rather than a case.
 *
 * The registry usually sits in the case directory — that is where the lookup
 * starts — so anything that enumerates cases must skip it, or the registry shows
 * up as a broken case in the list and in every "N failures" count.
 */
export function isRegistryFileName(name) {
  return REGISTRY_FILE_NAMES.includes(String(name).toLowerCase())
}

const KIND_ALIASES = new Map([
  ['postgres', 'postgresql'],
  ['postgresql', 'postgresql'],
  ['pg', 'postgresql'],
  ['opengauss', 'opengauss'],
  ['open-gauss', 'opengauss'],
  ['gaussdb', 'gaussdb'],
  ['gauss', 'gaussdb'],
])

/**
 * Expands `${env:NAME}` and `${env:NAME:-fallback}`. A missing variable with no
 * fallback is left as the literal text so the failure names itself later, rather
 * than turning into the string "undefined" and reaching a login attempt.
 */
export function expandEnv(value, env = process.env, missing = []) {
  if (typeof value === 'string') {
    return value.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (whole, name, fallback) => {
      const found = env[name]
      if (found !== undefined && found !== '') return found
      if (fallback !== undefined) return fallback
      missing.push(name)
      return whole
    })
  }
  if (Array.isArray(value)) return value.map((item) => expandEnv(item, env, missing))
  if (value && typeof value === 'object') {
    const result = {}
    for (const [key, item] of Object.entries(value)) result[key] = expandEnv(item, env, missing)
    return result
  }
  return value
}

/** Where a registry file could be, most specific first. */
function registryCandidates(options) {
  const { config = {}, caseDir } = options
  const candidates = []
  if (config.registryFile) candidates.push(isAbsolute(config.registryFile) ? config.registryFile : resolve(config.registryFile))
  if (caseDir) {
    candidates.push(join(caseDir, REGISTRY_FILE_NAMES[0]))
    candidates.push(join(caseDir, REGISTRY_FILE_NAMES[1]))
    candidates.push(join(caseDir, '..', REGISTRY_FILE_NAMES[0]))
    candidates.push(join(caseDir, '..', REGISTRY_FILE_NAMES[1]))
  }
  if (config.runtimeDir) candidates.push(join(config.runtimeDir, REGISTRY_FILE_NAMES[0]))
  return candidates
}

/**
 * Loads the registry. A missing registry file is not an error — a case with no
 * database and a fully specified `env` needs none. It only becomes an error when
 * something actually asks for a name that is not there.
 */
export async function loadRegistry(options = {}) {
  const { config = {}, caseDir } = options
  const env = options.env || process.env
  const sources = []
  const missingEnv = []

  const targets = {}
  const databases = {}

  // 1. The plugin config, so a profile can carry a shared test fleet.
  if (config.targets && typeof config.targets === 'object') {
    for (const [name, value] of Object.entries(config.targets)) targets[name] = { ...value, __source: 'plugin config' }
  }
  if (config.databases && typeof config.databases === 'object') {
    for (const [name, value] of Object.entries(config.databases)) databases[name] = { ...value, __source: 'plugin config' }
  }

  // 2. A registry file beside the cases, so a repository can carry its own.
  let filePath = null
  for (const candidate of registryCandidates(options)) {
    try {
      await readFile(candidate)
      filePath = candidate
      break
    } catch (error) {
      if (error && error.code === 'ENOENT') continue
      throw new RegistryError(`cannot read registry file ${candidate}: ${error.message}`)
    }
  }

  let raw = null
  if (filePath) {
    try {
      raw = await readYamlFile(filePath)
    } catch (error) {
      throw new RegistryError(`${filePath}: ${error.message}`, { file: filePath })
    }
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      if (raw.targets && typeof raw.targets === 'object') {
        for (const [name, value] of Object.entries(raw.targets)) targets[name] = { ...value, __source: filePath }
      }
      if (raw.databases && typeof raw.databases === 'object') {
        for (const [name, value] of Object.entries(raw.databases)) databases[name] = { ...value, __source: filePath }
      }
      sources.push(filePath)
    } else if (raw !== null && raw !== undefined) {
      throw new RegistryError(`${filePath} must contain a mapping with "targets" and/or "databases"`, { file: filePath })
    }
  }

  // Environment expansion runs last, over whatever the two layers produced.
  const expandedTargets = {}
  for (const [name, value] of Object.entries(targets)) {
    expandedTargets[name] = expandEnv(value, env, missingEnv)
  }
  const expandedDatabases = {}
  for (const [name, value] of Object.entries(databases)) {
    expandedDatabases[name] = expandEnv(value, env, missingEnv)
  }

  if (missingEnv.length > 0) {
    throw new RegistryError(
      `the registry references environment variable(s) that are not set: ${[...new Set(missingEnv)].join(', ')}. ` +
        `Set them, or give a fallback in the registry (${'${env:NAME:-value}'}).`,
      { missingEnv: [...new Set(missingEnv)] },
    )
  }

  return {
    targets: expandedTargets,
    databases: expandedDatabases,
    file: filePath,
    sources,
    env,
  }
}

/** The names a case may use, for error messages and for the listing tool. */
export function knownNames(registry, section) {
  const names = Object.keys((registry && registry[section]) || {})
  return names.length > 0 ? names.sort() : []
}

function describeAvailable(registry, section) {
  const names = knownNames(registry, section)
  const where = registry && registry.file ? `the registry at ${registry.file}` : 'the registry'
  if (names.length === 0) {
    return `${where} defines no ${section} at all — add a "${section}:" section to it, or set config.${section} on the plugin`
  }
  return `${where} defines ${names.join(', ')}`
}

/**
 * Resolves one database reference to a full connection. `schema` from the case
 * wins over the registry's, because which schema a case reads is part of what
 * the case asserts; where the server is is not.
 */
export async function resolveDatabase(registry, name, options = {}) {
  const entry = registry && registry.databases ? registry.databases[name] : null
  if (!entry) {
    throw new RegistryError(`unknown database "${name}": ${describeAvailable(registry, 'databases')}`, { name })
  }
  if (typeof entry !== 'object' || Array.isArray(entry)) {
    throw new RegistryError(`databases.${name} in the registry must be a mapping, not ${Array.isArray(entry) ? 'a list' : typeof entry}`)
  }
  const unknown = Object.keys(entry).filter((key) => !DATABASE_KEYS.has(key) && !key.startsWith('__'))
  if (unknown.length > 0) {
    throw new RegistryError(`databases.${name} has unknown field(s) ${unknown.join(', ')}; allowed: ${[...DATABASE_KEYS].join(', ')}`)
  }

  let base
  if (entry.from) {
    base = await importFromSource(registry, entry, name)
  } else {
    base = {
      kind: normalizeKind(entry.kind, name),
      host: entry.host ? String(entry.host) : '127.0.0.1',
      port: Number(entry.port || 5432),
      database: entry.database ? String(entry.database) : '',
      user: entry.user ? String(entry.user) : '',
      password: entry.password === undefined || entry.password === null ? '' : String(entry.password),
      connectTimeoutMs: entry.connectTimeoutMs === undefined ? undefined : Number(entry.connectTimeoutMs),
      statementTimeoutMs: entry.statementTimeoutMs === undefined ? undefined : Number(entry.statementTimeoutMs),
    }
  }

  if (!base.database) {
    throw new RegistryError(`databases.${name} does not name a database to connect to (field "database")`)
  }
  if (!base.user) {
    throw new RegistryError(`databases.${name} does not name a user to connect as (field "user")`)
  }

  return {
    name,
    registryName: name,
    // Say both where the entry is declared and where the credential came from: when
    // a password is wrong, the fix is in dsh-db-mcp, not in this file.
    source: entry.from ? `db-mcp:${entry.id || name}` : entry.__source || 'registry',
    declaredIn: entry.__source || (entry.from ? `db-mcp:${entry.id || name}` : 'registry'),
    kind: base.kind,
    host: base.host,
    port: base.port,
    database: base.database,
    user: base.user,
    password: base.password,
    schema: options.schema !== undefined && options.schema !== null && options.schema !== '' ? String(options.schema) : entry.schema ? String(entry.schema) : '',
    connectTimeoutMs: base.connectTimeoutMs,
    statementTimeoutMs: base.statementTimeoutMs,
    description: entry.description ? String(entry.description) : '',
  }
}

function normalizeKind(kind, name) {
  if (!kind) return 'postgresql'
  const normalized = KIND_ALIASES.get(String(kind).toLowerCase())
  if (!normalized) {
    throw new RegistryError(
      `databases.${name}.kind is "${kind}", which this build cannot open: it speaks the PostgreSQL wire protocol ` +
        `(postgresql, openGauss, GaussDB). Assert a database it cannot reach through the service's own endpoint instead.`,
    )
  }
  return normalized
}

/**
 * Resolves one target: where the service lives and which run configuration
 * starts it. Kept separate from databases because a case usually needs both and
 * neither belongs in the case file.
 */
export function resolveTarget(registry, name, options = {}) {
  const entry = name ? registry && registry.targets && registry.targets[name] : null
  if (name && !entry) {
    throw new RegistryError(`unknown target "${name}": ${describeAvailable(registry, 'targets')}`, { name })
  }
  const source = entry && typeof entry === 'object' ? entry : {}
  const unknown = Object.keys(source).filter((key) => !TARGET_KEYS.has(key) && !key.startsWith('__'))
  if (unknown.length > 0) {
    throw new RegistryError(`targets.${name} has unknown field(s) ${unknown.join(', ')}; allowed: ${[...TARGET_KEYS].join(', ')}`)
  }
  const pick = (key) => (options[key] !== undefined && options[key] !== null && options[key] !== '' ? options[key] : source[key])
  return {
    name: name || null,
    source: source.__source || (name ? 'registry' : 'case'),
    projectPath: pick('projectPath') ? String(pick('projectPath')) : '',
    configurationName: pick('configurationName') ? String(pick('configurationName')) : '',
    baseUrl: pick('baseUrl') ? String(pick('baseUrl')) : '',
    healthPath: pick('healthPath') ? String(pick('healthPath')) : null,
    insecureTls: pick('insecureTls') === true,
    profile: pick('profile') ? String(pick('profile')) : '',
    startTimeoutMs: pick('startTimeoutMs') ? Number(pick('startTimeoutMs')) : null,
  }
}

/**
 * dsh-db-mcp already stores the connections you registered in its panel, with the
 * passwords encrypted at rest. Reusing them means a case never has to hold a
 * credential, and there is one place to fix a connection instead of two.
 *
 * `~/.dsh/db-mcp/` is read directly: the two plugins share a profile directory,
 * and the alternative — asking the user to paste the same password twice — is
 * how credentials end up in a YAML file.
 */
async function importFromSource(registry, entry, name) {
  const from = String(entry.from)
  if (from !== 'db-mcp') {
    throw new RegistryError(`databases.${name}.from is "${from}"; the only importable source is "db-mcp"`)
  }
  const dir = registry.env && registry.env.DSH_DB_MCP_DIR ? registry.env.DSH_DB_MCP_DIR : join(homedir(), '.dsh', 'db-mcp')
  const id = entry.id ? String(entry.id) : name
  let catalog
  try {
    catalog = JSON.parse(await readFile(join(dir, 'datasources.json'), 'utf8'))
  } catch (error) {
    throw new RegistryError(`databases.${name} imports db-mcp:${id}, but ${join(dir, 'datasources.json')} could not be read: ${error.message}`)
  }
  const datasource = (catalog.datasources || []).find((item) => item.id === id)
  if (!datasource) {
    const available = (catalog.datasources || []).map((item) => item.id).join(', ') || 'none'
    throw new RegistryError(`databases.${name} imports db-mcp:${id}, which is not registered there; dsh-db-mcp has: ${available}`)
  }
  if (!['postgresql', 'postgres', 'opengauss', 'gaussdb', 'gauss'].includes(String(datasource.kind).toLowerCase())) {
    throw new RegistryError(
      `databases.${name} imports db-mcp:${id}, which is a "${datasource.kind}" source; this build opens PostgreSQL-wire databases only`,
    )
  }
  const config = datasource.config || {}
  return {
    kind: normalizeKind(datasource.kind, name),
    host: config.host ? String(config.host) : '127.0.0.1',
    port: Number(config.port || 5432),
    database: config.database ? String(config.database) : '',
    user: config.user ? String(config.user) : '',
    password: await readDbMcpPassword(dir, id),
    schema: config.schema ? String(config.schema) : '',
  }
}

async function readDbMcpPassword(dir, id) {
  let secrets
  try {
    secrets = JSON.parse(await readFile(join(dir, 'secrets.json'), 'utf8'))
  } catch {
    return ''
  }
  const entry = secrets && secrets.secrets ? secrets.secrets[id] : null
  const envelope = entry && entry.password ? String(entry.password) : ''
  if (!envelope || !envelope.startsWith('v1.')) return envelope
  let key
  try {
    key = Buffer.from((await readFile(join(dir, 'secret.key'), 'utf8')).trim(), 'base64url')
  } catch {
    return ''
  }
  if (key.length !== 32) return ''
  const parts = envelope.split('.')
  if (parts.length !== 4) return ''
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64url'))
    decipher.setAAD(Buffer.from(id, 'utf8'))
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    return ''
  }
}

/** What the listing tool shows: enough to identify the database, never a password. */
export async function describeDatabase(registry, name) {
  const entry = registry.databases[name]
  const resolved = await resolveDatabase(registry, name)
  return {
    name,
    source: resolved.source,
    kind: resolved.kind,
    host: resolved.host,
    port: resolved.port,
    database: resolved.database,
    user: resolved.user,
    schema: resolved.schema,
    passwordConfigured: Boolean(resolved.password),
    description: entry && entry.description ? String(entry.description) : '',
  }
}
