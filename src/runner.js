/**
 * dsh-e2e — the orchestrator.
 *
 * One case run is a fixed sequence, and the order is the design:
 *   guard → connect IDE → start the service (IDE run configuration) → wait for
 *   readiness → setup SQL → setup HTTP → capture generated values →
 *   send the request with a trace id → collect logs
 *   scoped to that trace id → read the database terminal state → assert →
 *   teardown SQL → stop the service → report.
 *
 * Teardown and stopping run even when an assertion failed, because a leaked
 * process or a dirty fixture turns the next run into a mystery.
 */
import crypto from 'node:crypto'
import { IdeaClient } from './idea.js'
import { buildVariables, interpolate, interpolateString } from './case.js'
import { enforceGuard, redact } from './guard.js'
import { resolveEnvironment, describeEnvironment } from './resolve.js'
import { startService, stopService } from './service.js'
import { sendRequest } from './http.js'
import { connectDatabase, runSqlFile, runSqlText, runAssertionQuery } from './db.js'
import { assertResponse, assertDatabase, assertLogs } from './assert.js'

export class RunError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'RunError'
    Object.assign(this, details)
  }
}

const SECRET_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key', 'token', 'x-auth-token'])

/**
 * Runs one case. `options` carries the runtime knobs the tool layer decided:
 * idePort, allowRemote, allowWrites, keepServiceRunning, traceHeader, plus the
 * plugin config the registry merge reads.
 *
 * The first thing it does is resolve names to connections: a case says "the
 * billing database, schema audit", and `resolveEnvironment` turns that into a
 * host, a port and a password from the registry (or from dsh-db-mcp). Everything
 * below works on the resolved environment, never on the raw case.
 */
export async function runCase(definition, options = {}) {
  const resolved = options.resolved || (await resolveEnvironment(definition, { config: options.config || {}, env: options.env }))
  const guard = await enforceGuard(definition, resolved, options)
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`
  const startedAt = Date.now()
  const steps = []
  const checks = []
  const warnings = []
  const evidence = {
    request: null,
    response: null,
    logs: null,
    database: [],
    // Every database assertion also records what was there *before* the request.
    // "expected 1 row, actual 0" is a verdict; "there were 0 rows before and 0
    // after" is a diagnosis, and the second one is what saves an hour.
    snapshots: [],
    setup: null,
    capture: null,
    teardownHttp: null,
    probes: [],
  }
  const secrets = Object.values(resolved.databases)
    .map((item) => item.password)
    .filter(Boolean)

  const traceId = crypto.randomBytes(16).toString('hex')
  const variables = buildVariables(definition, {
    'random.traceId': traceId,
    'run.id': runId,
  })
  const traceHeader = options.traceHeader || 'X-Trace-Id'
  const target = resolved.target

  let idea = null
  let service = null
  const connections = new Map()
  let fatal = null
  let teardownReport = null

  /** The default connection, or a named one; a case names its database per assertion. */
  const dbFor = (name) => connections.get(name || 'default') || connections.get('default') || null

  const step = (name, detail = {}) => steps.push({ name, at: Date.now() - startedAt, ...detail })

  try {
    // 1. Connect to the IDE. Without it there is no service to test.
    if (resolved.serviceRequired) {
      idea = new IdeaClient({
        host: options.ideHost || '127.0.0.1',
        port: Number(options.idePort || 64342),
        projectPath: target.projectPath,
        timeoutMs: Number(options.ideTimeoutMs || 60000),
      })
      await idea.connect()
      step('ide.connected', { serverInfo: idea.serverInfo })
    }

    // 2. Start the service through its run configuration and wait for readiness.
    if (idea && target.configurationName) {
      const envs = {}
      if (target.profile) envs.SPRING_PROFILES_ACTIVE = target.profile
      service = await startService(idea, {
        projectPath: target.projectPath,
        configurationName: target.configurationName,
        baseUrl: target.baseUrl,
        healthPath: target.healthPath || null,
        timeoutMs: target.startTimeoutMs,
        insecureTls: target.insecureTls,
        envs: Object.keys(envs).length > 0 ? envs : null,
      })
      step('service.started', {
        configurationName: service.configurationName,
        logPath: service.fullOutputPath,
        startupMs: service.startupMs,
        ready: service.readiness.ok,
        readinessLine: service.readiness.line || service.readiness.error,
      })
      checks.push({
        ok: service.readiness.ok,
        label: 'service readiness',
        expected: 'a startup line in the run log',
        actual: service.readiness.line || service.readiness.error,
        detail: service.fullOutputPath,
      })
    } else if (resolved.serviceRequired) {
      throw new RunError('the target names no run configuration: a case must name the IDE run configuration that starts the service')
    }

    // 3. Databases: connect every one the case names, so a dual-write service can
    //    be checked in both places it writes.
    for (const [name, config] of Object.entries(resolved.databases)) {
      try {
        connections.set(name, await connectDatabase(config))
        step('database.connected', {
          databaseName: name,
          source: config.source,
          kind: config.kind,
          host: config.host,
          port: config.port,
          database: config.database,
          schema: config.schema || '',
        })
      } catch (error) {
        if (name === 'default') throw error
        checks.push({ ok: false, label: `database ${name}`, expected: 'a connection', actual: error.message, detail: '' })
      }
    }
    const db = dbFor('default')

    // 4. Setup SQL — before the request, so the case starts from a known state.
    if (db && (definition.setup.sqlFiles.length > 0 || definition.setup.sql.length > 0)) {
      const executed = []
      for (const file of definition.setup.sqlFiles) executed.push(...(await runSqlFile(db, file)))
      for (const statement of definition.setup.sql) {
        executed.push(...(await runSqlText(db, interpolateString(statement, variables))))
      }
      step('setup.sql', { statements: executed.length, executed })
    }

    // 4b. Setup requests — state the service itself must establish (a feature
    //     flag, a warm cache, a mode switch). Runs through the same HTTP path as
    //     the case request, so it exercises the service, not a side door.
    if (definition.setup.http.length > 0) {
      const sent = await sendPrepRequests(definition.setup.http, { target, variables, traceHeader, traceId, guard })
      evidence.setup = sent
      step('setup.http', { requests: sent.length, failed: sent.filter((item) => item.error).length })
      const broken = sent.filter((item) => item.error)
      if (broken.length > 0) {
        checks.push({
          ok: false,
          label: 'setup request',
          expected: 'every setup request must succeed',
          actual: broken.map((item) => `${item.method} ${item.url}: ${item.error}`).join('; '),
          detail: '',
        })
        throw new RunError(`a setup request failed, so the case never reached the request under test: ${broken[0].error}`)
      }
    }

    // 4c. Captures — bind a value the service generated to a case variable. The
    //     value does not exist until the service ran, so it cannot live in the
    //     YAML: a verification code, a generated id, a signed token. Runs after
    //     setup.sql and setup.http because those usually produce the value.
    if (definition.setup.capture.length > 0) {
      const captured = []
      for (const capture of definition.setup.capture) {
        const target = dbFor(capture.database)
        if (!target) {
          throw new RunError(`setup.capture "${capture.name}" wants database "${capture.database}", which is not connected`)
        }
        const sql = interpolateString(capture.sql, variables)
        const rows = await runAssertionQuery(target, sql)
        const row = rows[0]
        const key = capture.column || (row ? Object.keys(row)[0] : null)
        const value = row && key ? row[key] : null
        if (value === null || value === undefined) {
          if (capture.required) {
            throw new RunError(
              `setup.capture "${capture.name}" found no value: the query returned ${rows.length} row(s)` +
                (rows.length > 0 ? ` and column "${key}" was empty` : '') +
                `\n  sql: ${sql}`,
            )
          }
          captured.push({ name: capture.name, value: null, column: key, rows: rows.length })
          continue
        }
        variables[capture.name] = String(value)
        captured.push({ name: capture.name, value: String(value), column: key, rows: rows.length })
      }
      evidence.capture = captured
      step('setup.capture', { captured: captured.map((item) => `${item.name}=${item.value}`) })
    }

    // 4d. Snapshot every database the case asserts on, *before* the request.
    //     The assertion tells you whether the expected row is there afterwards;
    //     only the "before" tells you whether the case changed anything at all.
    //     A case that passes because the row was already there is not testing
    //     what its author thinks it is testing, and nothing else in this tool
    //     can tell you that.
    for (const [index, expectation] of definition.expect.database.entries()) {
      const snapshotDb = dbFor(expectation.database)
      if (!snapshotDb) continue
      const sql = interpolateString(expectation.sql, variables)
      let rows = []
      let error = null
      try {
        rows = await runAssertionQuery(snapshotDb, sql)
      } catch (snapshotError) {
        // A query that fails before the request will fail after it too; the
        // assertion step is where that gets reported, so do not double-count it.
        error = snapshotError.message
      }
      evidence.snapshots.push({
        index,
        database: expectation.database,
        sql,
        before: rows.slice(0, 50),
        beforeCount: rows.length,
        beforeError: error,
      })
    }

    // 5. The request itself, carrying the trace id the log assertion will use.
    const requestSpec = buildRequest(definition, target, variables, traceHeader, traceId, guard)
    evidence.request = {
      method: requestSpec.method,
      url: requestSpec.url,
      headers: sanitizeHeaders(requestSpec.headers),
      body: requestSpec.body ?? null,
    }
    step('request.sent', { method: requestSpec.method, url: requestSpec.url })

    let response = null
    try {
      response = await sendRequest(requestSpec)
    } catch (error) {
      checks.push({ ok: false, label: 'request completed', expected: 'an HTTP response', actual: error.message, detail: error.code || '' })
      throw new RunError(`the request failed before any response arrived: ${error.message}`, { cause: error })
    }
    evidence.response = {
      status: response.status,
      statusText: response.statusText,
      headers: sanitizeHeaders(response.headers),
      body: truncate(response.bodyText, options.maxBodyChars || 8000),
      bodyJson: response.bodyJson === null ? null : truncateJson(response.bodyJson, options.maxBodyChars || 8000),
      durationMs: response.durationMs,
      truncated: response.truncated,
    }
    step('response.received', { status: response.status, durationMs: response.durationMs })

    checks.push(...assertResponse(definition.expect.response, response))

    // 6. Logs, scoped to this run's trace id so concurrent traffic cannot mask a
    //    missing line. Give the async pipeline a moment to flush first.
    if (definition.expect.logs && service) {
      await new Promise((resolve) => setTimeout(resolve, options.logSettleMs ?? 800))
      await service.follower.poll()
      const wanted = definition.expect.logs.traceId ? interpolateString(definition.expect.logs.traceId, variables) : traceId
      const scoped = service.follower.matching(wanted)
      const scopedOk = scoped.length > 0
      // A trace id is only usable if the service actually writes it. When nothing
      // carries it, the honest move is to widen to the lines written since the
      // request and say so loudly, rather than pass on a broader match silently.
      const lines = (scopedOk ? scoped : service.follower.lines).slice(-definition.expect.logs.maxLines)
      if (!scopedOk) {
        warnings.push(
          `no log line carried the trace id ${wanted}: the service does not put the ${traceHeader} header into its logs, ` +
            `so log assertions fall back to every line of this run and may match unrelated traffic. ` +
            `Add the header to the logging MDC (logback pattern %X{traceId}) to get per-case log evidence.`,
        )
      }
      evidence.logs = {
        path: service.fullOutputPath,
        traceId: wanted,
        traceIdPresent: scopedOk,
        totalLines: service.follower.lines.length,
        scopedLines: scoped.length,
        lines: lines.slice(-120),
      }
      step('logs.collected', { totalLines: service.follower.lines.length, scopedLines: scoped.length, scanned: lines.length, traceIdPresent: scopedOk })
      checks.push(...assertLogs(definition.expect.logs, lines, scopedOk ? wanted : null))
    }

    // 6b. Probe calls: follow-up requests that ask the service about its own
    //     state. Some of what a case must verify is only visible through the
    //     service — a dual-write service can report its own cross-database
    //     consistency, which covers the database this tool cannot open directly.
    for (const [index, probe] of definition.expect.calls.entries()) {
      const url = probe.url
        ? interpolateString(probe.url, variables)
        : joinUrl(target.baseUrl, interpolateString(probe.path, variables))
      const headers = {}
      for (const [key, value] of Object.entries(probe.headers)) headers[key] = interpolateString(String(value), variables)
      const hasTrace = Object.keys(headers).some((key) => key.toLowerCase() === traceHeader.toLowerCase())
      if (!hasTrace) headers[traceHeader] = `${traceId}-probe${index + 1}`
      let body
      if (probe.json !== null) body = interpolate(probe.json, variables)
      else if (probe.bodyTemplate !== null) body = interpolateString(probe.bodyTemplate, variables)
      if (body !== undefined && body !== null && !Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/json'
      }
      const label = probe.description || `${probe.method} ${url}`
      let response = null
      let error = null
      try {
        response = await sendRequest({
          method: probe.method,
          url,
          headers,
          body: typeof body === 'string' ? body : body === undefined ? undefined : JSON.stringify(body),
          timeoutMs: probe.timeoutMs,
          insecureTls: target.insecureTls,
        })
      } catch (requestError) {
        error = requestError.message
      }
      evidence.probes.push({
        description: label,
        method: probe.method,
        url,
        status: response ? response.status : null,
        body: response ? truncate(response.bodyText, options.maxBodyChars || 8000) : null,
        error,
      })
      step('probe.sent', { description: label, status: response ? response.status : null, error })
      if (error) {
        checks.push({ ok: false, label: `probe ${label}`, expected: 'an HTTP response', actual: error, detail: '' })
        continue
      }
      checks.push(
        ...assertResponse(
          {
            status: probe.expectStatus,
            statusIn: null,
            json: probe.jsonExpect,
            schema: null,
            bodyContains: probe.bodyContains,
            bodyNotContains: probe.bodyNotContains,
            maxDurationMs: null,
          },
          response,
        ).map((check) => ({ ...check, label: `probe ${label}: ${check.label}` })),
      )
    }

    // 7. Database terminal state, per named database.
    for (const expectation of definition.expect.database) {
      const target = dbFor(expectation.database)
      if (!target) {
        checks.push({
          ok: false,
          label: expectation.description || `database ${expectation.database}`,
          expected: `a configured database named "${expectation.database}"`,
          actual: `env.databases has ${[...connections.keys()].join(', ') || 'no databases'}`,
          detail: '',
        })
        continue
      }
      const sql = interpolateString(expectation.sql, variables)
      let rows = []
      let error = null
      try {
        rows = await runAssertionQuery(target, sql)
      } catch (queryError) {
        error = queryError.message
      }
      evidence.database.push({ database: expectation.database, sql, rows: rows.slice(0, 50), rowCount: rows.length, error })
      // The "before" half lives on evidence.snapshots; pair it up here so the
      // report holds one object per assertion rather than two lists that the
      // reader has to line up by position.
      const snapshot = evidence.snapshots.find((item) => item.index === index)
      if (snapshot) {
        snapshot.after = rows.slice(0, 50)
        snapshot.afterCount = rows.length
        snapshot.afterError = error
        snapshot.changed = snapshot.beforeCount !== snapshot.afterCount || JSON.stringify(snapshot.before) !== JSON.stringify(snapshot.after)
      }
      step('database.asserted', { database: expectation.database, sql: truncate(sql, 300), rows: rows.length, error })
      checks.push(...assertDatabase(expectation, rows, error))
    }

    if (definition.expect.maxDurationMs) {
      const total = Date.now() - startedAt
      checks.push({
        ok: total <= definition.expect.maxDurationMs,
        label: 'case duration',
        expected: `<= ${definition.expect.maxDurationMs}ms`,
        actual: `${total}ms`,
        detail: '',
      })
    }
  } catch (error) {
    fatal = error
  } finally {
    // Teardown must run even after a fatal error: a dirty fixture poisons the
    // next run, and a leaked service hides the port from it.
    teardownReport = { sql: [], mocks: null, service: null, errors: [] }
    if (definition.teardown.http.length > 0) {
      try {
        const sent = await sendPrepRequests(definition.teardown.http, { target, variables, traceHeader, traceId, guard })
        teardownReport.http = sent
        evidence.teardownHttp = sent
        step('teardown.http', { requests: sent.length, failed: sent.filter((item) => item.error).length })
        for (const item of sent) {
          if (item.error) teardownReport.errors.push(`teardown request ${item.method} ${item.url}: ${item.error}`)
        }
      } catch (error) {
        teardownReport.errors.push(`teardown requests: ${error.message}`)
      }
    }
    const teardownDb = dbFor('default')
    if (teardownDb && (definition.teardown.sqlFiles.length > 0 || definition.teardown.sql.length > 0)) {
      try {
        const executed = []
        for (const file of definition.teardown.sqlFiles) executed.push(...(await runSqlFile(teardownDb, file, { ignoreErrors: true })))
        for (const statement of definition.teardown.sql) {
          executed.push(...(await runSqlText(teardownDb, interpolateString(statement, variables), { ignoreErrors: true })))
        }
        teardownReport.sql = executed
        step('teardown.sql', { statements: executed.length })
      } catch (error) {
        teardownReport.errors.push(`teardown SQL: ${error.message}`)
      }
    }
    for (const [name, connection] of connections) {
      try {
        connection.close()
      } catch {
        /* the socket may already be gone */
      }
      connections.delete(name)
    }
    if (service && !resolved.keepServiceRunning && !options.keepServiceRunning) {
      const port = portOf(target.baseUrl)
      const stopped = await stopService({ port, idea })
      teardownReport.service = { port, ...stopped }
      step('service.stopped', { port, stopped: stopped.stopped })
      if (!stopped.stopped) teardownReport.errors.push(`the service on port ${port} did not stop: ${stopped.error || ''}`)
    } else if (service) {
      teardownReport.service = { port: portOf(target.baseUrl), stopped: false, kept: true }
    }
    if (idea) {
      try {
        idea.close()
      } catch {
        /* ignore */
      }
    }
  }

  const failed = checks.filter((check) => !check.ok)
  const verdict = fatal || failed.length > 0 ? 'failed' : 'passed'
  const report = {
    runId,
    // `caseId` is the stable, quotable name (`REG-002`); `id` is the file-level
    // slug. The report keeps both because a failure list sorts and groups by
    // caseId while the file on disk is still found by id.
    caseId: definition.caseId || definition.id,
    id: definition.id,
    caseIdDerived: definition.caseIdDerived === true,
    title: definition.title,
    description: definition.description,
    tags: definition.tags,
    endpoint: definition.endpoint || null,
    scenario: definition.scenario || null,
    priority: definition.priority || null,
    verdict,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    fatal: fatal ? { message: fatal.message, name: fatal.name, details: fatal.problems || null } : null,
    steps,
    checks,
    failedChecks: failed,
    warnings,
    evidence,
    teardown: teardownReport,
    traceId,
    source: definition.source,
    environment: {
      ...describeEnvironment(resolved),
      idePort: Number(options.idePort || 64342),
    },
  }
  return { report, secrets }
}

/**
 * Sends setup/teardown requests. These are preparatory, so they carry their own
 * trace id rather than the case's: a setup call that shows up in the case's log
 * window would be indistinguishable from the request under test.
 */
async function sendPrepRequests(list, context) {
  const { target, variables, traceHeader, traceId, guard } = context
  const results = []
  for (const [index, entry] of list.entries()) {
    const url = entry.url ? interpolateString(entry.url, variables) : joinUrl(target.baseUrl, interpolateString(entry.path, variables))
    const headers = {}
    for (const [key, value] of Object.entries(entry.headers)) headers[key] = interpolateString(String(value), variables)
    const hasTrace = Object.keys(headers).some((key) => key.toLowerCase() === traceHeader.toLowerCase())
    if (!hasTrace) headers[traceHeader] = `${traceId}-setup${index + 1}`
    let body
    if (entry.json !== null) {
      body = JSON.stringify(interpolate(entry.json, variables))
      if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json; charset=utf-8'
    } else if (entry.bodyTemplate !== null) {
      body = interpolateString(String(entry.bodyTemplate), variables)
      if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json; charset=utf-8'
    }
    const record = { method: entry.method, url, headers: sanitizeHeaders(headers), body: body ?? null, status: null, error: null, bodyText: null }
    try {
      const response = await sendRequest({
        method: entry.method,
        url,
        headers,
        body,
        timeoutMs: entry.timeoutMs,
        insecureTls: target.insecureTls,
        allowWrites: guard.allowWrites,
      })
      record.status = response.status
      record.bodyText = truncate(response.bodyText, 1000)
      if (entry.expectStatus !== null && response.status !== entry.expectStatus) {
        record.error = `expected HTTP ${entry.expectStatus}, got ${response.status}`
      } else if (entry.expectStatus === null && response.status >= 400) {
        record.error = `HTTP ${response.status}`
      }
    } catch (error) {
      record.error = error.message
    }
    results.push(record)
  }
  return results
}

function buildRequest(definition, target, variables, traceHeader, traceId, guard) {
  const request = definition.request
  const url = request.url ? interpolateString(request.url, variables) : joinUrl(target.baseUrl, interpolateString(request.path, variables))
  const headers = {}
  for (const [key, value] of Object.entries(request.headers)) {
    headers[key] = interpolateString(String(value), variables)
  }
  const hasTrace = Object.keys(headers).some((key) => key.toLowerCase() === traceHeader.toLowerCase())
  if (!hasTrace) headers[traceHeader] = traceId

  let body
  if (request.bodyJson !== null) {
    body = JSON.stringify(interpolate(request.bodyJson, variables))
    if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
      headers['content-type'] = 'application/json; charset=utf-8'
    }
  } else if (request.bodyTemplate !== null) {
    body = interpolateString(String(request.bodyTemplate), variables)
    if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
      headers['content-type'] = 'application/json; charset=utf-8'
    }
  }

  return {
    method: request.method,
    url,
    headers,
    body,
    timeoutMs: request.timeoutMs,
    insecureTls: target.insecureTls,
    allowWrites: guard.allowWrites,
  }
}

function joinUrl(base, path) {
  if (/^https?:\/\//i.test(path)) return path
  return `${String(base).replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`
}

function portOf(url) {
  try {
    const parsed = new URL(url)
    if (parsed.port) return Number(parsed.port)
    return parsed.protocol === 'https:' ? 443 : 80
  } catch {
    return 8080
  }
}

function sanitizeHeaders(headers) {
  const result = {}
  for (const [key, value] of Object.entries(headers || {})) {
    result[key] = SECRET_HEADERS.has(key.toLowerCase()) ? '***' : String(value)
  }
  return result
}

function truncate(text, limit) {
  const value = String(text ?? '')
  return value.length > limit ? `${value.slice(0, limit)}… (truncated, ${value.length} chars)` : value
}

function truncateJson(value, limit) {
  const text = JSON.stringify(value)
  if (!text || text.length <= limit) return value
  return { __truncated: true, chars: text.length, preview: text.slice(0, limit) }
}

/** Applies the same redaction to every string the report carries. */
export function redactReport(report, secrets = []) {
  const walk = (value) => {
    if (typeof value === 'string') return redact(value, { secrets })
    if (Array.isArray(value)) return value.map(walk)
    if (value && typeof value === 'object') {
      const result = {}
      for (const [key, item] of Object.entries(value)) result[key] = walk(item)
      return result
    }
    return value
  }
  return walk(report)
}
