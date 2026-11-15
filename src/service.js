/**
 * dsh-e2e — service lifecycle through the IDE.
 *
 * Starting a real Spring Boot service is the whole point of this tool, and the
 * only sanctioned way to do it here is the IDE's own run configuration: that is
 * how the developer runs it by hand, so the test exercises the same JVM, the same
 * working directory, and the same environment variables.
 *
 * Measured behaviour of the IDE MCP tools this relies on:
 *  - execute_run_configuration with waitForExit:false returns as soon as the JVM
 *    is up and hands back `fullOutputPath`, a file that keeps growing while the
 *    process lives. That file is the log source.
 *  - There is no stop_run_configuration. Stopping means finding the listener on
 *    the expected port and terminating that process tree.
 */
import { open, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { waitForPort } from './http.js'

const run = promisify(execFile)

export class ServiceError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'ServiceError'
    Object.assign(this, details)
  }
}

const READY_PATTERNS = [
  /Started\s+\S+\s+in\s+[\d.]+\s+seconds/i,
  /Tomcat started on port/i,
  /Netty started on port/i,
  /JVM running for/i,
  /Listening on\s+\S+/i,
]

/**
 * Lines that mean the opposite of ready.
 *
 * These are checked before the ready patterns, and the order is the whole
 * point: Spring's "port already in use" advice says *listening on port 8443*
 * inside the sentence that explains the start failed, so `/Listening on \S+/`
 * matched the failure notice and a server that never bound a socket was
 * reported ready. A run then measured a stale process, or nothing.
 *
 * Ordered most specific first, and the search is pattern-major, not line-major:
 * a Spring start failure prints a generic "Application failed to start due to
 * an exception" line *before* the stack trace that says which port was taken.
 * Reporting the generic line would tell the reader that something went wrong
 * while withholding the one fact that fixes it.
 */
const FATAL_PATTERNS = [
  /Port \d+ (?:was|is) already in use/i,
  /Address already in use/i,
  /BindException/i,
  /Web server failed to start/i,
  /Identify and stop the process that's listening on port/i,
  /APPLICATION FAILED TO START/i,
]

/**
 * The port the service actually bound, read out of its own startup line.
 *
 * Not the same as the port in the case's base URL: a run configuration can
 * listen wherever its own config says, and stopping the port the case expected
 * leaves the real process running to collide with the next run.
 */
const LISTENING_PORT_PATTERNS = [
  /(?:Tomcat|Netty) started on port(?:\(s\))?:?\s*(\d{2,5})/i,
  /Listening on\s+\S*:(\d{2,5})/i,
]

/**
 * Follows one IDE run-log file from a byte offset. Reads are non-destructive so
 * the same file can be re-read for a second assertion without losing lines.
 */
export class LogFollower {
  constructor(path) {
    this.path = path
    this.offset = 0
    this.remainder = ''
    this.lines = []
  }

  /** Appends whatever is new and returns the lines added by this call. */
  async poll(maxLines = 20000) {
    let info
    try {
      info = await stat(this.path)
    } catch {
      return []
    }
    if (info.size <= this.offset) return []
    const length = Math.min(info.size - this.offset, 8 * 1024 * 1024)
    const handle = await open(this.path, 'r')
    try {
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, this.offset)
      this.offset += bytesRead
      const text = this.remainder + buffer.subarray(0, bytesRead).toString('utf8')
      const parts = text.split(/\r?\n/)
      this.remainder = parts.pop() ?? ''
      const fresh = parts.filter((line) => line.length > 0)
      if (fresh.length > 0) {
        this.lines.push(...fresh)
        if (this.lines.length > maxLines) this.lines.splice(0, this.lines.length - maxLines)
      }
      return fresh
    } finally {
      await handle.close()
    }
  }

  /**
   * Waits until one of the readiness patterns shows up, or the deadline passes.
   *
   * A line that says the start failed ends the wait immediately with
   * `ok: false` and the offending line attached: waiting out the rest of the
   * timeout after the server has already given up buys nothing but a minute of
   * silence, and reporting those runs as ready is worse than either.
   */
  async waitForReady(timeoutMs, options = {}) {
    const deadline = Date.now() + timeoutMs
    const patterns = options.patterns || READY_PATTERNS
    const fatalPatterns = options.fatalPatterns || FATAL_PATTERNS
    let lastError = null
    while (Date.now() < deadline) {
      await this.poll(options.maxLines)
      // Pattern-major, so the most specific fatal line wins over the generic
      // "failed to start" that Spring prints above the cause.
      for (const pattern of fatalPatterns) {
        const failed = this.lines.find((line) => pattern.test(line))
        if (failed) return { ok: false, line: failed.trim(), fatal: true, error: failed.trim() }
      }
      const hit = this.lines.find((line) => patterns.some((pattern) => pattern.test(line)))
      if (hit) return { ok: true, line: hit.trim() }
      if (options.extraCheck) {
        const extra = await options.extraCheck().catch((error) => {
          lastError = error
          return null
        })
        if (extra) return { ok: true, line: extra }
      }
      await new Promise((resolve) => setTimeout(resolve, options.intervalMs || 500))
    }
    return { ok: false, error: lastError ? lastError.message : `no readiness line within ${timeoutMs}ms` }
  }

  /** The port this service said it is listening on, or null if it never said. */
  listeningPort() {
    for (const line of this.lines) {
      for (const pattern of LISTENING_PORT_PATTERNS) {
        const match = pattern.exec(line)
        if (match) return Number(match[1])
      }
    }
    return null
  }

  /** Lines matching a trace id (or every line when none is given). */
  matching(traceId, limit = 200) {
    if (!traceId) return this.lines.slice(-limit)
    const hits = this.lines.filter((line) => line.includes(traceId))
    return hits.length > 0 ? hits.slice(-limit) : []
  }
}

/**
 * Starts the named run configuration and returns a handle carrying the log
 * follower and the readiness result.
 */
export async function startService(idea, options = {}) {
  const {
    projectPath,
    configurationName,
    baseUrl,
    healthPath = null,
    timeoutMs = 120000,
    insecureTls = false,
    envs = null,
    programArguments = null,
  } = options

  if (!configurationName) {
    throw new ServiceError('env.configurationName is required: the case must name an IDE run configuration to start')
  }

  const configs = await idea.callTool('get_run_configurations', projectPath ? { projectPath } : {})
  const listed = configs.structured && Array.isArray(configs.structured.configurations) ? configs.structured.configurations : []
  const chosen = listed.find((entry) => entry && entry.name === configurationName)
  if (!chosen) {
    throw new ServiceError(
      `the IDE does not know a run configuration named "${configurationName}"; available: ${listed.map((entry) => entry.name).join(', ') || '(none)'}`,
      { available: listed.map((entry) => entry.name) },
    )
  }

  const args = { configurationName, waitForExit: false, projectPath }
  if (envs) args.envs = envs
  if (programArguments && chosen.supportsDynamicLaunchOverrides) args.programArguments = programArguments

  // A stale listener is the most common way a run goes wrong: the IDE reports a
  // start, the request reaches the *old* process, and every assertion describes
  // code that was never deployed. Refuse rather than report a mystery.
  const port = portOf(baseUrl)
  if (port) {
    const existing = await findListenerPid(port)
    if (existing) {
      throw new ServiceError(
        `port ${port} is already listening (pid ${existing}), so starting "${configurationName}" would either fail or ` +
          `leave the case talking to the old process. Stop it first, or set env.serviceRequired: false to test a ` +
          `service that is already running.`,
        { port, pid: existing },
      )
    }
  }

  const startedAt = Date.now()
  const launched = await idea.callTool('execute_run_configuration', args, { timeoutMs: 60000 })
  const structured = launched.structured || {}
  const fullOutputPath = structured.fullOutputPath || null
  if (!fullOutputPath) {
    throw new ServiceError(`the IDE started "${configurationName}" but returned no fullOutputPath, so its log cannot be followed`)
  }

  const follower = new LogFollower(fullOutputPath)
  const readiness = await follower.waitForReady(timeoutMs, {
    extraCheck: healthPath
      ? async () => {
          const probe = await waitForPort(new URL(healthPath, baseUrl).href, {
            timeoutMs: 1500,
            intervalMs: 500,
            insecureTls,
            accept: (response) => response.status === 200,
          })
          return probe.ok ? `health ${healthPath} answered 200` : null
        }
      : null,
  })

  return {
    configurationName,
    fullOutputPath,
    launchedAt: startedAt,
    startupMs: Date.now() - startedAt,
    supportsDynamicLaunchOverrides: chosen.supportsDynamicLaunchOverrides === true,
    readiness,
    follower,
    // The port the service says it bound, when it said one; the case's expected
    // port otherwise. Teardown stops *this* port, because a run configuration is
    // free to listen somewhere its case did not predict.
    port: follower.listeningPort() || port,
    output: launched.text,
  }
}

/** The port a base URL points at, defaulting by scheme. */
export function portOf(baseUrl) {
  try {
    const url = new URL(baseUrl)
    if (url.port) return Number(url.port)
    return url.protocol === 'https:' ? 443 : 80
  } catch {
    return null
  }
}

/**
 * Asks whether something is already serving the case's base URL.
 *
 * Starting a second copy of a service that is already up is not a test of the
 * code under test — it is a test of whether the port was free. The IDE reports
 * the start, the new JVM dies on the bind, and the request that follows reaches
 * the process that was already there, so every assertion describes a build
 * nobody started. Asking first turns that whole class of run into an honest
 * "used the service that was running".
 *
 * A health path is asked when the target names one; otherwise any answer at all
 * counts, because a 401 or a 404 from the server is still the server.
 */
export async function probeRunningService(baseUrl, options = {}) {
  const { healthPath = null, insecureTls = false, timeoutMs = 1500 } = options
  const port = portOf(baseUrl)
  if (!baseUrl) return { running: false, port, error: 'the target has no base URL to ask' }
  const url = healthPath ? new URL(healthPath, baseUrl).href : baseUrl
  const probe = await waitForPort(url, {
    timeoutMs,
    intervalMs: Math.max(250, Math.floor(timeoutMs / 4)),
    insecureTls,
    accept: (response) => (healthPath ? response.status === 200 : true),
  })
  if (!probe.ok) return { running: false, port, url, error: probe.error }
  return {
    running: true,
    port,
    url,
    status: probe.response ? probe.response.status : null,
    line: healthPath
      ? `health ${healthPath} answered ${probe.response ? probe.response.status : 200} before the run started`
      : `${url} answered before the run started`,
  }
}

/** Finds the PID listening on a port; the IDE itself does not expose one. */
export async function findListenerPid(port) {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await run('powershell', [
        '-NoProfile',
        '-Command',
        `$c = Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction SilentlyContinue; if ($c) { $c[0].OwningProcess }`,
      ])
      const pid = Number(String(stdout).trim())
      return Number.isInteger(pid) && pid > 0 ? pid : null
    } catch {
      return null
    }
  }
  try {
    const { stdout } = await run('sh', ['-c', `lsof -nP -iTCP:${Number(port)} -sTCP:LISTEN -t | head -n1`])
    const pid = Number(String(stdout).trim())
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

/**
 * Stops the service. A run launched through the IDE is a child of the IDE, so the
 * only reliable signal is the port going quiet again; the return value reports
 * what was observed rather than what was requested.
 */
export async function stopService(options = {}) {
  const { port, idea = null, sessionId = null, waitMs = 15000 } = options
  const attempts = []

  if (idea && sessionId) {
    try {
      await idea.callTool('xdebug_control_session', { sessionId, action: 'STOP', timeout: 10000 })
      attempts.push('xdebug_control_session(STOP)')
    } catch (error) {
      attempts.push(`xdebug_control_session(STOP) failed: ${error.message}`)
    }
  }

  const pid = port ? await findListenerPid(port) : null
  if (pid) {
    try {
      if (process.platform === 'win32') {
        await run('taskkill', ['/PID', String(pid), '/T', '/F'])
      } else {
        await run('kill', ['-TERM', String(pid)])
      }
      attempts.push(`terminated pid ${pid}`)
    } catch (error) {
      attempts.push(`terminating pid ${pid} failed: ${error.message}`)
    }
  } else {
    attempts.push('no listener found to terminate')
  }

  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    const still = port ? await findListenerPid(port) : null
    if (!still) return { stopped: true, attempts, pid }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return { stopped: false, attempts, pid, error: `port ${port} was still listening after ${waitMs}ms` }
}
