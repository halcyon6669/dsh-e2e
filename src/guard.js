import { readFile } from 'node:fs/promises'

/**
 * dsh-e2e — environment guard.
 *
 * The tool starts real services and writes to real databases, so the one thing it
 * must never do is point at production. This refuses to run unless the target is
 * a loopback/private host, refuses obviously production host and database names,
 * and refuses to write unless the case opted into writes explicitly.
 */

const PRODUCTION_HINTS = [
  'prod',
  'production',
  'live',
  'prd',
  'online',
  'master',
  'release',
  '生产',
]

const ALLOWED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^\[::1\]$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
]

export class GuardError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'GuardError'
    Object.assign(this, details)
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function looksLikeProduction(value) {
  const text = String(value || '').toLowerCase()
  return PRODUCTION_HINTS.some((hint) => text.includes(hint))
}

/**
 * The same base-URL rules checkTargets applies to a run, applied to a project
 * the panel is about to create. The wordings are verbatim the runner's, so a
 * refusal at creation time and a refusal at run time read as one voice — a
 * project that would fail every case should not be creatable without a fight.
 * Returns the problems; an empty array means the URL passed.
 */
export function auditBaseUrl(baseUrl, { allowRemote = false } = {}) {
  const problems = []
  const host = hostOf(baseUrl)
  if (!baseUrl) problems.push('the project has no base URL: a project is, in the end, a service to test against')
  else if (!host) problems.push(`the target base URL is not a URL: ${baseUrl}`)
  else if (!allowRemote && !ALLOWED_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
    problems.push(`the target points at ${host}, which is not loopback or a private address (pass allowRemote to override)`)
  }
  if (looksLikeProduction(baseUrl)) {
    problems.push(`the target base URL looks like a production endpoint: ${baseUrl}`)
  }
  return problems
}

/**
 * Validates everything a run is about to touch. `allowRemote` exists for the rare
 * case of a shared test server; it still rejects production-looking names.
 *
 * It checks the *resolved* environment, not the case: the case only names a
 * database, so the host that actually gets dialled — and whether it is production
 * — is only knowable after the registry lookup. Checking the raw YAML would mean
 * checking nothing.
 *
 * Async because a write can hide in a `sqlFile`: the statements are read from
 * disk here so `allowWrites` covers fixture files too, not only inline SQL.
 * A guard that only inspects inline SQL is a guard an author walks past without
 * noticing.
 */
export async function checkTargets(definition, resolved, options = {}) {
  const { allowRemote = false, allowWrites = false, idePort = 64342 } = options
  const problems = []

  const baseUrl = (resolved && resolved.target && resolved.target.baseUrl) || definition.env.baseUrl
  const host = hostOf(baseUrl)
  if (!baseUrl) problems.push('the case has no base URL: set env.baseUrl or give its target one in the registry')
  else if (!host) problems.push(`the target base URL is not a URL: ${baseUrl}`)
  else if (!allowRemote && !ALLOWED_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
    problems.push(`the target points at ${host}, which is not loopback or a private address (pass allowRemote to override)`)
  }
  if (looksLikeProduction(baseUrl)) {
    problems.push(`the target base URL looks like a production endpoint: ${baseUrl}`)
  }

  const databases = (resolved && resolved.databases) || {}
  const statements = await collectSql(definition)
  const hasWriteStatements = statements.some((statement) => isWriteStatement(statement))
  if (Object.keys(databases).length > 0) {
    for (const [name, database] of Object.entries(databases)) {
      const dbHost = database.host || '127.0.0.1'
      if (!allowRemote && !ALLOWED_HOST_PATTERNS.some((pattern) => pattern.test(dbHost))) {
        problems.push(
          `database "${name}" (${database.source || 'registry'}) points at ${dbHost}, which is not loopback or a private address`,
        )
      }
      if (looksLikeProduction(database.database) || looksLikeProduction(database.host)) {
        problems.push(`database "${name}" looks like a production database: ${dbHost}/${database.database || ''}`)
      }
    }
    if (hasWriteStatements && !allowWrites) {
      problems.push('the case contains INSERT/UPDATE/DELETE statements but database writes are disabled (pass allowWrites to override)')
    }
  } else if (hasWriteStatements) {
    problems.push('the case contains setup/teardown SQL but names no database to run it against')
  }

  if (!Number.isInteger(idePort) || idePort < 1 || idePort > 65535) {
    problems.push(`the IDE MCP port ${idePort} is not a valid TCP port`)
  }

  // A browser block navigates somewhere. If it is an absolute URL it bypasses
  // `baseUrl` entirely, so it has to be checked with the same rules — otherwise
  // "the page under test" is an unguarded hole in a guard whose whole job is to
  // keep the tool off production.
  const browserUrl = definition.browser ? absoluteBrowserUrl(definition) : null
  if (browserUrl) {
    const browserHost = hostOf(browserUrl)
    if (!browserHost) {
      problems.push(`the browser block points at ${browserUrl}, which is not a URL`)
    } else if (!allowRemote && !ALLOWED_HOST_PATTERNS.some((pattern) => pattern.test(browserHost))) {
      problems.push(
        `the browser block points at ${browserHost}, which is not loopback or a private address (pass allowRemote to override)`,
      )
    }
    if (looksLikeProduction(browserUrl)) {
      problems.push(`the browser block looks like a production page: ${browserUrl}`)
    }
  }

  return problems
}

/**
 * The URL the browser would actually open, or null when it is relative.
 *
 * A relative path is resolved against `baseUrl`, which is already being checked
 * above; resolving it here would mean re-implementing `joinUrl` and getting one
 * of the two slashes wrong.
 */
function absoluteBrowserUrl(definition) {
  const url = definition.browser && definition.browser.url
  if (!url || !/^[a-z][a-z0-9+.-]*:\/\//i.test(String(url))) return null
  return String(url)
}

/** Fails the run when the guard found anything; returns the accepted options. */
export async function enforceGuard(definition, resolved, options = {}) {
  const problems = await checkTargets(definition, resolved, options)
  if (problems.length > 0) {
    throw new GuardError(`refusing to run case "${definition.id}":\n- ${problems.join('\n- ')}`, { problems })
  }
  return {
    allowRemote: options.allowRemote === true,
    allowWrites: options.allowWrites === true,
  }
}

/**
 * Every SQL statement a case will run: inline statements plus the contents of
 * any `sqlFile`. Reading the files is the point — a `DELETE` sitting in a
 * fixture file must trip the same `allowWrites` check as one written inline.
 *
 * A file that cannot be read contributes a marker rather than throwing: the
 * guard's job is to report problems, and a missing fixture is reported when the
 * runner tries to run it.
 */
async function collectSql(definition) {
  const statements = []
  for (const block of [definition.setup, definition.teardown]) {
    if (!block) continue
    if (Array.isArray(block.sql)) statements.push(...block.sql)
    if (Array.isArray(block.sqlFiles)) {
      for (const file of block.sqlFiles) {
        try {
          statements.push(await readFile(file, 'utf8'))
        } catch {
          /* unreadable fixture: the runner reports it when it tries to run it */
        }
      }
    }
  }
  return statements
}

const WRITE_PATTERN = /^\s*(insert|update|delete|merge|truncate|drop|alter|create|replace|upsert)\b/i

export function isWriteStatement(sql) {
  return WRITE_PATTERN.test(stripComments(sql))
}

export function stripComments(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim()
}

/**
 * Redacts the values a report must never carry: tokens, passwords, phone numbers
 * and identity numbers, plus any header a case marked as secret.
 */
export function redact(value, options = {}) {
  const { secrets = [], extraPatterns = [] } = options
  let text = typeof value === 'string' ? value : JSON.stringify(value)
  if (typeof text !== 'string') return value
  for (const secret of secrets) {
    if (!secret) continue
    text = text.split(String(secret)).join('***')
  }
  for (const pattern of extraPatterns) {
    text = text.replace(pattern, '***')
  }
  text = text
    .replace(/((?:password|passwd|pwd|secret|token|authorization|api[-_]?key)\s*[:=]\s*)("?)([^\s",}]{4,})\2/gi, '$1$2***$2')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, 'Bearer ***')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '***JWT***')
    .replace(/\b1[3-9]\d{9}\b/g, (match) => `${match.slice(0, 3)}****${match.slice(7)}`)
    .replace(/\b\d{17}[\dXx]\b/g, (match) => `${match.slice(0, 4)}**********${match.slice(14)}`)
  return text
}
