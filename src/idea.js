/**
 * dsh-e2e — client for the JetBrains IDE MCP server.
 *
 * The IDE does not speak the newer streamable-HTTP transport; it serves the
 * 2024-11-05 "HTTP+SSE" flavour: one long-lived `GET /sse` stream that first
 * announces a `POST /message?sessionId=…` endpoint, then carries every
 * JSON-RPC response back on the same stream. That is why this is hand-written
 * instead of reusing a generic MCP client.
 *
 * Verified against IntelliJ IDEA 2025.2.3 with the bundled MCP Server 2026.3
 * plugin on port 64342 (brave mode on, no authorization token).
 */
import http from 'node:http'

const PROTOCOL_VERSION = '2025-06-18'
const CLIENT_INFO = { name: 'dsh-e2e', version: '0.1.0' }

export class IdeaMcpError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'IdeaMcpError'
    Object.assign(this, details)
  }
}

/**
 * One MCP session against the IDE. Keep it for the whole case run: opening a
 * session per tool call is slow and the IDE logs a connection per session.
 */
export class IdeaClient {
  constructor(options = {}) {
    this.host = options.host || '127.0.0.1'
    this.port = Number(options.port || 64342)
    this.projectPath = options.projectPath || ''
    this.timeoutMs = Number(options.timeoutMs || 60000)
    this.sessionId = null
    this.endpointPath = null
    this.nextId = 1
    this.pending = new Map()
    this.request = null
    this.response = null
    this.buffer = ''
    this.closed = false
    this.serverInfo = null
    this.toolNames = []
  }

  get baseUrl() {
    return `http://${this.host}:${this.port}`
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const request = http.request(
        `${this.baseUrl}/sse`,
        { method: 'GET', headers: { accept: 'text/event-stream', 'cache-control': 'no-cache' } },
        (response) => {
          if (response.statusCode !== 200) {
            reject(new IdeaMcpError(`the IDE MCP endpoint answered HTTP ${response.statusCode} on ${this.baseUrl}/sse`, { statusCode: response.statusCode }))
            response.resume()
            return
          }
          this.response = response
          response.setEncoding('utf8')
          response.on('data', (chunk) => this.#onData(chunk))
          response.on('end', () => this.#failAll(new IdeaMcpError('the IDE closed the MCP event stream')))
          response.on('error', (error) => this.#failAll(error))
        },
      )
      request.on('error', (error) => {
        reject(
          new IdeaMcpError(
            `cannot reach the IDE MCP server at ${this.baseUrl}: ${error.message}. Is IntelliJ IDEA running with Settings > Tools > MCP Server enabled?`,
            { cause: error },
          ),
        )
      })
      request.setTimeout(this.timeoutMs, () => {
        request.destroy(new IdeaMcpError(`the IDE did not open an event stream within ${this.timeoutMs}ms`))
      })
      this.request = request
      request.end()
      this.onEndpoint = resolve
      this.onEndpointError = reject
      setTimeout(() => {
        if (!this.endpointPath && !this.closed) {
          reject(new IdeaMcpError(`the IDE did not announce an MCP message endpoint within ${this.timeoutMs}ms`))
        }
      }, this.timeoutMs).unref?.()
    })
    await this.#initialize()
    return this
  }

  #onData(chunk) {
    this.buffer += chunk
    for (;;) {
      const match = /\r?\n\r?\n/.exec(this.buffer)
      if (!match) return
      const raw = this.buffer.slice(0, match.index)
      this.buffer = this.buffer.slice(match.index + match[0].length)
      this.#onEvent(raw)
    }
  }

  #onEvent(raw) {
    let event = 'message'
    const dataLines = []
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith(':')) continue
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
    }
    const data = dataLines.join('\n')
    if (event === 'endpoint') {
      this.endpointPath = data.trim()
      const sessionMatch = /sessionId=([^&]+)/.exec(this.endpointPath)
      this.sessionId = sessionMatch ? decodeURIComponent(sessionMatch[1]) : null
      if (this.onEndpoint) {
        const resolve = this.onEndpoint
        this.onEndpoint = null
        this.onEndpointError = null
        resolve()
      }
      return
    }
    if (event === 'error') {
      this.#failAll(new IdeaMcpError(`the IDE MCP stream reported an error: ${data}`))
      return
    }
    if (event !== 'message' || !data) return
    let message
    try {
      message = JSON.parse(data)
    } catch {
      return
    }
    if (message.id !== undefined && this.pending.has(message.id)) {
      const { resolve, reject, timer } = this.pending.get(message.id)
      this.pending.delete(message.id)
      clearTimeout(timer)
      if (message.error) {
        reject(new IdeaMcpError(message.error.message || 'the IDE returned a JSON-RPC error', { rpcError: message.error }))
      } else {
        resolve(message.result)
      }
      return
    }
    // Server-initiated notifications (progress, logging) are ignored on purpose:
    // a case report must not depend on them.
  }

  #failAll(error) {
    this.closed = true
    for (const [, { reject, timer }] of this.pending) {
      clearTimeout(timer)
      reject(error)
    }
    this.pending.clear()
  }

  #post(payload) {
    return new Promise((resolve, reject) => {
      if (!this.endpointPath) {
        reject(new IdeaMcpError('the IDE MCP session has no message endpoint yet'))
        return
      }
      const url = new URL(this.endpointPath, this.baseUrl)
      const body = JSON.stringify(payload)
      const request = http.request(
        url,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
        },
        (response) => {
          response.resume()
          if (response.statusCode && response.statusCode >= 400) {
            reject(new IdeaMcpError(`the IDE rejected the MCP message with HTTP ${response.statusCode}`))
            return
          }
          resolve()
        },
      )
      request.on('error', (error) => reject(new IdeaMcpError(`failed to POST to the IDE MCP endpoint: ${error.message}`, { cause: error })))
      request.end(body)
    })
  }

  async #rpc(method, params, timeoutMs = this.timeoutMs) {
    const id = this.nextId++
    const settled = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new IdeaMcpError(`the IDE did not answer ${method} within ${timeoutMs}ms`, { method }))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
    })
    await this.#post({ jsonrpc: '2.0', id, method, params })
    return settled
  }

  async #initialize() {
    const result = await this.#rpc('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    })
    this.serverInfo = result && result.serverInfo ? result.serverInfo : null
    // The spec requires this notification before any other request.
    await this.#post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
  }

  async listTools() {
    const result = await this.#rpc('tools/list', {})
    const tools = result && Array.isArray(result.tools) ? result.tools : []
    this.toolNames = tools.map((tool) => tool.name)
    return tools
  }

  /**
   * Calls one IDE tool. Returns the flattened text plus the structured payload,
   * and raises when the tool itself reported a failure, so callers can decide
   * between "the case failed" and "the harness broke".
   */
  async callTool(name, args = {}, options = {}) {
    const result = await this.#rpc('tools/call', { name, arguments: args }, options.timeoutMs || this.timeoutMs)
    const content = result && Array.isArray(result.content) ? result.content : []
    const text = content
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
    const structured = result && result.structuredContent !== undefined ? result.structuredContent : null
    if (result && result.isError === true) {
      throw new IdeaMcpError(text || `the IDE tool ${name} reported an error`, { tool: name, text })
    }
    return { text, structured, raw: result }
  }

  close() {
    this.closed = true
    this.#failAll(new IdeaMcpError('the MCP session was closed by dsh-e2e'))
    try {
      if (this.response) this.response.destroy()
    } catch {
      /* ignore */
    }
    try {
      if (this.request) this.request.destroy()
    } catch {
      /* ignore */
    }
  }
}

/**
 * Best-effort probe used by the environment guard: the IDE may simply not be
 * running, which is a normal state to report rather than an exception.
 */
export async function probeIdea(host, port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const request = http.request(
      { host, port, path: '/sse', method: 'GET', headers: { accept: 'text/event-stream' } },
      (response) => {
        const status = response.statusCode || 0
        response.destroy()
        resolve({ reachable: true, statusCode: status, restricted: status === 401 })
      },
    )
    request.setTimeout(timeoutMs, () => request.destroy(new Error('timeout')))
    request.on('error', (error) => resolve({ reachable: false, error: error.message }))
    request.end()
  })
}
