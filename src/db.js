/**
 * dsh-e2e — database access for setup, teardown and terminal-state assertions.
 *
 * Deliberately narrow: PostgreSQL-family only (PostgreSQL, openGauss/GaussDB),
 * because that is what the wire client supports. Setup and teardown may write;
 * an assertion statement is forced to be a read.
 */
import { readFile } from 'node:fs/promises'
import { PgClient } from './pg.js'
import { stripComments } from './guard.js'

export class DatabaseError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'DatabaseError'
    Object.assign(this, details)
  }
}

const READ_PATTERN = /^\s*(select|with|show|explain|values)\b/i

export function isReadOnly(sql) {
  return READ_PATTERN.test(stripComments(sql))
}

/** Opens a connection from the case's env.databases entry. */
export async function connectDatabase(config = {}) {
  const kind = String(config.kind || 'postgresql').toLowerCase()
  if (!['postgresql', 'postgres', 'opengauss', 'gaussdb'].includes(kind)) {
    throw new DatabaseError(
      `unsupported database kind "${kind}": this build speaks the PostgreSQL wire protocol only ` +
        `(PostgreSQL, openGauss/GaussDB). For a database it cannot reach directly, assert its state through the ` +
        `service's own endpoint in expect.response or a setup/teardown request, or point env.databases at a ` +
        `PostgreSQL-compatible copy of the data.`,
      { kind },
    )
  }
  const client = new PgClient({
    host: config.host || '127.0.0.1',
    port: Number(config.port || 5432),
    database: config.database || 'postgres',
    user: config.user || 'postgres',
    password: config.password || '',
    schema: config.schema || '',
    connectTimeoutMs: Number(config.connectTimeoutMs || 10000),
    statementTimeoutMs: Number(config.statementTimeoutMs || 30000),
    applicationName: 'dsh-e2e',
  })
  await client.connect()
  return client
}

/**
 * Runs one setup/teardown file. Statements are split on `;` at end of line so a
 * multi-statement fixture works without a second SQL parser, and a failure names
 * the statement that failed.
 */
export async function runSqlFile(client, path, options = {}) {
  const text = await readFile(path, 'utf8')
  return runSqlText(client, text, { ...options, source: path })
}

export async function runSqlText(client, text, options = {}) {
  const statements = splitStatements(text)
  const executed = []
  for (const statement of statements) {
    const sql = stripComments(statement)
    if (!sql) continue
    try {
      const rows = await client.query(statement)
      executed.push({ sql: preview(sql), ok: true, rows: rows.length })
    } catch (error) {
      if (options.ignoreErrors) {
        executed.push({ sql: preview(sql), ok: false, error: error.message })
        continue
      }
      throw new DatabaseError(`failed in ${options.source || 'inline SQL'}: ${error.message}`, { sql: preview(sql), executed })
    }
  }
  return executed
}

/** Runs an assertion query and refuses anything that is not a read. */
export async function runAssertionQuery(client, sql) {
  if (!isReadOnly(sql)) {
    throw new DatabaseError('assertion queries must be read-only (SELECT/WITH/SHOW/EXPLAIN); put writes in setup or teardown')
  }
  return client.query(sql)
}

function splitStatements(text) {
  const statements = []
  let current = ''
  let quote = null
  let dollarTag = null
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (dollarTag) {
      if (text.startsWith(dollarTag, index)) {
        current += dollarTag
        index += dollarTag.length - 1
        dollarTag = null
        continue
      }
      current += char
      continue
    }
    if (quote) {
      current += char
      if (char === quote) {
        if (text[index + 1] === quote) {
          current += text[index + 1]
          index += 1
        } else {
          quote = null
        }
      }
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      current += char
      continue
    }
    if (char === '$') {
      const match = /^\$[A-Za-z_]*\$/.exec(text.slice(index))
      if (match) {
        dollarTag = match[0]
        current += dollarTag
        index += dollarTag.length - 1
        continue
      }
    }
    if (char === ';') {
      statements.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) statements.push(current)
  return statements
}

function preview(sql, limit = 200) {
  const flat = String(sql).replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}
