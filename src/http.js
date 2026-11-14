/**
 * dsh-e2e — the request sender.
 *
 * Uses node:http / node:https directly rather than fetch so a case can talk to a
 * Spring Boot instance behind a self-signed keystore (`insecureTls: true`) and so
 * the report can carry the exact bytes that went out and came back.
 */
import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'

const BINARY = /^(image|audio|video|font)\//i

function isBinary(contentType) {
  return BINARY.test(String(contentType || ''))
}

/**
 * Sends one request and returns everything a report needs: the request as it was
 * actually sent, the status line, headers, timing, and a decoded body.
 */
export async function sendRequest(spec = {}) {
  const {
    method = 'GET',
    url,
    headers = {},
    body,
    timeoutMs = 30000,
    insecureTls = false,
    maxBodyBytes = 512 * 1024,
  } = spec

  const target = new URL(url)
  const isHttps = target.protocol === 'https:'
  const transport = isHttps ? https : http

  const payload = body === undefined || body === null ? null : Buffer.from(String(body), 'utf8')
  const outgoing = { ...headers }
  if (payload && !Object.keys(outgoing).some((key) => key.toLowerCase() === 'content-length')) {
    outgoing['content-length'] = String(payload.length)
  }

  const startedAt = Date.now()
  const result = await new Promise((resolve, reject) => {
    const request = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: method.toUpperCase(),
        headers: outgoing,
        rejectUnauthorized: isHttps ? !insecureTls : undefined,
        servername: isHttps ? target.hostname : undefined,
      },
      (response) => {
        const chunks = []
        let bytes = 0
        response.on('data', (chunk) => {
          bytes += chunk.length
          if (bytes <= maxBodyBytes) chunks.push(chunk)
        })
        response.on('end', () => {
          const buffer = Buffer.concat(chunks)
          const contentType = response.headers['content-type'] || ''
          let text = buffer.toString('utf8')
          let parsed = null
          let truncated = bytes > maxBodyBytes
          if (/json/i.test(contentType) || /^\s*[[{]/.test(text.slice(0, 1))) {
            try {
              parsed = JSON.parse(text)
            } catch {
              parsed = null
            }
          }
          if (isBinary(contentType)) {
            text = `<binary ${bytes} bytes, ${contentType}>`
            truncated = true
          }
          resolve({
            url: target.href,
            method: method.toUpperCase(),
            requestHeaders: outgoing,
            requestBody: payload ? payload.toString('utf8') : null,
            status: response.statusCode,
            statusText: response.statusMessage || '',
            headers: response.headers,
            contentType,
            bodyText: text,
            bodyJson: parsed,
            bodyBytes: bytes,
            truncated,
            durationMs: Date.now() - startedAt,
          })
        })
        response.on('error', reject)
      },
    )
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`the request did not complete within ${timeoutMs}ms`))
    })
    request.on('error', (error) => {
      reject(
        Object.assign(new Error(`request to ${target.href} failed: ${error.message}`), {
          code: error.code,
          durationMs: Date.now() - startedAt,
        }),
      )
    })
    if (payload) request.write(payload)
    request.end()
  })

  return result
}

/**
 * Polls a URL until it answers at all, which is the last resort readiness check
 * when neither actuator nor a log pattern is available.
 */
export async function waitForPort(url, options = {}) {
  const { timeoutMs = 60000, intervalMs = 1000, insecureTls = false, accept = () => true } = options
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const response = await sendRequest({ url, method: 'GET', timeoutMs: 5000, insecureTls })
      if (accept(response)) return { ok: true, response }
      lastError = new Error(`answered HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return { ok: false, error: lastError ? lastError.message : 'timed out' }
}
