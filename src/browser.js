/**
 * dsh-e2e — the browser half of a run.
 *
 * A backend case proves what a service answered. That is not the same question
 * as "what did the user see", and for a page that renders a form, a list, or an
 * error banner, only the second question matters — a 200 with an empty table is
 * a bug that every HTTP assertion in this tool will happily call green.
 *
 * This module drives Chrome over the DevTools protocol directly: no Playwright,
 * no Puppeteer, no npm install. The plugin's promise is zero runtime
 * dependencies (see README), and a test tool that needs a 300MB dependency tree
 * before it can take a screenshot is a test tool nobody runs on a laptop.
 *
 * What it drives: `--headless=new` Chrome, one target, one page. Enough for a
 * user journey, small enough to read in one sitting.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export class BrowserError extends Error {
  constructor(message, details) {
    super(message)
    this.name = 'BrowserError'
    this.details = details || null
  }
}

/**
 * Where Chrome lives on the machines this plugin runs on.
 *
 * A missing browser is not an error worth inventing a search order for beyond
 * this: `env.browserPath` (or `DSH_CHROME`) overrides everything, and the error
 * says exactly which variable to set. Silently skipping the browser steps would
 * turn "the page is blank" into a passing case.
 */
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

export function findBrowser(explicit) {
  const wanted = explicit || process.env.DSH_CHROME || process.env.CHROME_PATH
  if (wanted) {
    if (!existsSync(wanted)) {
      throw new BrowserError(`the browser at ${wanted} does not exist; unset env.browserPath to search the usual places`)
    }
    return wanted
  }
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate
  }
  throw new BrowserError(
    'no Chrome or Edge was found for the browser steps; set env.browserPath (or DSH_CHROME) to a browser executable',
    { searched: CHROME_CANDIDATES },
  )
}

/**
 * A minimal DevTools-protocol client.
 *
 * The protocol is request/response over a WebSocket, plus events. Node 24 ships
 * a global WebSocket, which is the only reason this file can exist without a
 * dependency — `undici` is part of the runtime.
 */
class Cdp {
  constructor(url, timeoutMs) {
    this.url = url
    this.timeoutMs = timeoutMs
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
    this.closed = null
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url)
      this.socket = socket
      const timer = setTimeout(() => {
        reject(new BrowserError(`the DevTools endpoint ${this.url} did not answer within ${this.timeoutMs}ms`))
      }, this.timeoutMs)
      socket.addEventListener('open', () => {
        clearTimeout(timer)
        resolve()
      })
      socket.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new BrowserError(`could not connect to the DevTools endpoint ${this.url}`))
      })
      socket.addEventListener('message', (event) => this.receive(event.data))
      socket.addEventListener('close', () => {
        this.closed = true
        for (const [, entry] of this.pending) {
          clearTimeout(entry.timer)
          entry.reject(new BrowserError('the browser closed the DevTools connection mid-command'))
        }
        this.pending.clear()
      })
    })
    return this
  }

  receive(raw) {
    let message
    try {
      message = JSON.parse(String(raw))
    } catch {
      return
    }
    if (message.id && this.pending.has(message.id)) {
      const entry = this.pending.get(message.id)
      this.pending.delete(message.id)
      clearTimeout(entry.timer)
      if (message.error) {
        entry.reject(new BrowserError(`${entry.method}: ${message.error.message}`, message.error))
      } else {
        entry.resolve(message.result)
      }
      return
    }
    if (message.method) {
      const handlers = this.listeners.get(message.method)
      if (handlers) for (const handler of handlers) handler(message.params, message.sessionId)
    }
  }

  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, [])
    this.listeners.get(method).push(handler)
    return () => {
      const list = this.listeners.get(method) || []
      const at = list.indexOf(handler)
      if (at >= 0) list.splice(at, 1)
    }
  }

  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new BrowserError('the browser is already closed'))
    const id = this.nextId++
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new BrowserError(`${method} did not answer within ${this.timeoutMs}ms`))
      }, this.timeoutMs)
      this.pending.set(id, { resolve, reject, timer, method })
      try {
        this.socket.send(JSON.stringify(payload))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new BrowserError(`${method} could not be sent: ${error.message}`))
      }
    })
  }

  close() {
    this.closed = true
    try {
      this.socket.close()
    } catch {}
  }
}

/** Reads the `DevTools listening on ws://…` line Chrome prints to stderr. */
function waitForDevToolsUrl(child, timeoutMs, getStderr) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      const text = getStderr()
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(text)
      if (match) {
        clearInterval(timer)
        resolve(match[1])
        return
      }
      if (child.exitCode !== null) {
        clearInterval(timer)
        reject(new BrowserError(`the browser exited (code ${child.exitCode}) before it printed a DevTools endpoint:\n${text.slice(-800)}`))
        return
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer)
        reject(new BrowserError(`the browser did not print a DevTools endpoint within ${timeoutMs}ms:\n${text.slice(-800)}`))
      }
    }, 100)
  })
}

/**
 * Runs one browser journey and returns what it saw.
 *
 * Everything captured lands on disk next to the report (screenshots as PNG), and
 * everything text-shaped goes into the return value: `console` lines, `checks`
 * produced by `assertText` / `assertVisible`, and the per-step `timeline`.
 */
export async function captureBrowser(options = {}) {
  const {
    url,
    steps = [],
    viewport = { width: 1280, height: 800 },
    outDir,
    timeoutMs = 30000,
    navigateTimeoutMs = 20000,
    browserPath,
    baseUrl,
    insecureTls = false,
    prefix = 'shot',
    maxScreenshots = 40,
  } = options

  if (!url) throw new BrowserError('the browser block needs a url')
  if (!outDir) throw new BrowserError('the browser block needs an output directory for screenshots')

  const target = /^[a-z]+:\/\//i.test(url) ? url : joinUrl(baseUrl, url)
  const executable = findBrowser(browserPath)
  const profileDir = join(tmpdir(), `dsh-e2e-chrome-${process.pid}-${Date.now()}`)
  mkdirSync(profileDir, { recursive: true })
  mkdirSync(outDir, { recursive: true })

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    `--window-size=${viewport.width},${viewport.height}`,
    ...(insecureTls ? ['--ignore-certificate-errors'] : []),
    'about:blank',
  ]

  const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8')
    if (stderr.length > 64000) stderr = stderr.slice(-32000)
  })
  child.stdout.on('data', () => {})

  const shots = []
  const consoleLines = []
  const checks = []
  const timeline = []
  let client = null
  let sessionId = null
  const startedAt = Date.now()
  const mark = (name, detail = {}) => timeline.push({ name, at: Date.now() - startedAt, ...detail })

  try {
    const wsUrl = await waitForDevToolsUrl(child, timeoutMs, () => stderr)
    client = await new Cdp(wsUrl, timeoutMs).connect()
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
    const attached = await client.send('Target.attachToTarget', { targetId, flatten: true })
    sessionId = attached.sessionId

    await client.send('Page.enable', {}, sessionId)
    await client.send('Runtime.enable', {}, sessionId)
    // `Log.enable` is what surfaces failed subresource loads. Without it a page
    // whose bundle 404s renders as an empty page and the screenshot is the only
    // warning anyone gets.
    await client.send('Log.enable', {}, sessionId)
    await client.send(
      'Emulation.setDeviceMetricsOverride',
      { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false },
      sessionId,
    )

    client.on('Runtime.consoleAPICalled', (params) => {
      const text = (params.args || [])
        .map((arg) => (arg.value !== undefined ? String(arg.value) : arg.description || arg.type))
        .join(' ')
      consoleLines.push({ level: params.type || 'log', text, at: Date.now() - startedAt })
    })
    client.on('Log.entryAdded', (params) => {
      const entry = params.entry || {}
      consoleLines.push({ level: entry.level || 'info', text: entry.text || '', url: entry.url || null, at: Date.now() - startedAt })
    })
    client.on('Runtime.exceptionThrown', (params) => {
      const detail = params.exceptionDetails || {}
      const text = (detail.exception && detail.exception.description) || detail.text || 'uncaught exception'
      consoleLines.push({ level: 'error', text: String(text).split('\n')[0], at: Date.now() - startedAt })
    })

    let loaded = null
    const waitForLoad = new Promise((resolve) => {
      loaded = resolve
    })
    const offLoad = client.on('Page.loadEventFired', () => {
      if (loaded) loaded(true)
    })

    mark('browser.navigate', { url: target })
    await client.send('Page.navigate', { url: target }, sessionId)
    const loadTimer = setTimeout(() => loaded && loaded(false), navigateTimeoutMs)
    const didLoad = await waitForLoad
    clearTimeout(loadTimer)
    offLoad()
    if (!didLoad) {
      checks.push({
        ok: false,
        label: 'browser page load',
        expected: `a load event within ${navigateTimeoutMs}ms`,
        actual: 'no load event',
        detail: target,
      })
    } else {
      mark('browser.loaded', { url: target })
    }

    let shotIndex = 0
    const takeShot = async (name) => {
      if (shots.length >= maxScreenshots) {
        throw new BrowserError(`the browser block asked for more than ${maxScreenshots} screenshots; that is a runaway loop, not a test`)
      }
      shotIndex += 1
      const { data } = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId)
      const safeName = String(name || `shot-${shotIndex}`)
        .replace(/[^\w.-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)
      const fileName = `${prefix}-${String(shotIndex).padStart(2, '0')}-${safeName || 'shot'}.png`
      const file = join(outDir, fileName)
      writeFileSync(file, Buffer.from(data, 'base64'))
      shots.push({ name: name || `shot ${shotIndex}`, file, fileName, at: Date.now() - startedAt })
      // `label`, not `name`: the timeline entry's own name is the step kind, and
      // spreading a second `name` over it renames every entry to the screenshot.
      mark('browser.screenshot', { label: name || `shot ${shotIndex}`, file: fileName })
      return file
    }

    /** Runs an expression in the page and returns its JSON-serialised value. */
    const evaluate = async (expression, label) => {
      const result = await client.send(
        'Runtime.evaluate',
        { expression, returnByValue: true, awaitPromise: true, userGesture: true },
        sessionId,
      )
      if (result.exceptionDetails) {
        const detail = result.exceptionDetails
        throw new BrowserError(
          `${label || 'the page expression'} threw: ${(detail.exception && detail.exception.description) || detail.text}`,
        )
      }
      return result.result ? result.result.value : undefined
    }

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

    for (const rawStep of steps) {
      const step = rawStep || {}
      if (step.screenshot) {
        await takeShot(step.screenshot)
        continue
      }
      if (step.click) {
        const selector = String(step.click)
        const found = await evaluate(`(() => {
          const node = document.querySelector(${JSON.stringify(selector)})
          if (!node) return false
          node.scrollIntoView({ block: 'center' })
          node.click()
          return true
        })()`, `click ${selector}`)
        if (!found) {
          checks.push({
            ok: false,
            label: `browser click ${selector}`,
            expected: 'an element to click',
            actual: 'no element matched',
            detail: target,
          })
        } else {
          mark('browser.click', { selector })
        }
        await sleep(step.settleMs || 150)
        continue
      }
      if (step.fill) {
        const { selector, value } = step.fill
        const text = String(value === undefined ? '' : value)
        const ok = await evaluate(`(() => {
          const node = document.querySelector(${JSON.stringify(selector)})
          if (!node) return false
          const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
          const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
          setter.call(node, ${JSON.stringify(text)})
          node.dispatchEvent(new Event('input', { bubbles: true }))
          node.dispatchEvent(new Event('change', { bubbles: true }))
          return true
        })()`, `fill ${selector}`)
        if (!ok) {
          checks.push({
            ok: false,
            label: `browser fill ${selector}`,
            expected: 'an input to fill',
            actual: 'no element matched',
            detail: target,
          })
        } else {
          // The value itself is deliberately not logged: a case that types a
          // password would otherwise write it into every report.
          mark('browser.fill', { selector, length: text.length })
        }
        continue
      }
      if (step.press) {
        const { selector, key } = step.press
        await evaluate(`(() => {
          const node = document.querySelector(${JSON.stringify(selector)})
          if (!node) return false
          node.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(String(key || 'Enter'))}, bubbles: true }))
          node.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(String(key || 'Enter'))}, bubbles: true }))
          return true
        })()`, `press ${key} in ${selector}`)
        mark('browser.press', { selector, key: key || 'Enter' })
        await sleep(step.settleMs || 150)
        continue
      }
      if (step.waitFor) {
        const selector = String(step.waitFor)
        const limit = Number(step.timeoutMs || 5000)
        const deadline = Date.now() + limit
        let seen = false
        while (Date.now() < deadline) {
          seen = await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, `waitFor ${selector}`)
          if (seen) break
          await sleep(100)
        }
        if (!seen) {
          checks.push({
            ok: false,
            label: `browser waitFor ${selector}`,
            expected: `the element within ${limit}ms`,
            actual: 'never appeared',
            detail: target,
          })
        } else {
          mark('browser.waitFor', { selector, waitedMs: Date.now() - (deadline - limit) })
        }
        continue
      }
      if (step.wait) {
        await sleep(Number(step.wait) || 0)
        mark('browser.wait', { ms: Number(step.wait) || 0 })
        continue
      }
      if (step.assertText) {
        const { selector, contains } = step.assertText
        const text = await evaluate(`(() => {
          const node = document.querySelector(${JSON.stringify(selector)})
          return node ? node.innerText || node.textContent || '' : null
        })()`, `assertText ${selector}`)
        const ok = text !== null && String(text).includes(String(contains))
        checks.push({
          ok,
          label: step.assertText.description || `browser text ${selector}`,
          expected: `contains ${JSON.stringify(String(contains))}`,
          actual: text === null ? 'no such element' : String(text).slice(0, 300),
          detail: target,
        })
        continue
      }
      if (step.assertVisible) {
        const selector = String(step.assertVisible)
        const visible = await evaluate(`(() => {
          const node = document.querySelector(${JSON.stringify(selector)})
          if (!node) return false
          const box = node.getBoundingClientRect()
          const style = window.getComputedStyle(node)
          return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
        })()`, `assertVisible ${selector}`)
        checks.push({
          ok: Boolean(visible),
          label: step.description || `browser visible ${selector}`,
          expected: 'a visible element',
          actual: visible ? 'visible' : 'missing or zero-sized',
          detail: target,
        })
        continue
      }
      throw new BrowserError(
        `unknown browser step ${JSON.stringify(rawStep)}; known steps: screenshot, click, fill, press, wait, waitFor, assertText, assertVisible`,
      )
    }

    return {
      url: target,
      viewport,
      screenshots: shots,
      console: consoleLines.slice(0, 500),
      checks,
      timeline,
      browser: executable,
    }
  } finally {
    if (client) client.close()
    if (child && child.exitCode === null) {
      child.kill()
      await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(), 2000)
        child.on('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
    // The profile directory holds a few MB of crash-recovery files per run; a
    // test tool that leaves one per run behind fills a disk in a month.
    try {
      const { rmSync } = await import('node:fs')
      rmSync(profileDir, { recursive: true, force: true })
    } catch {}
  }
}

/** Joins a base URL and a path without doubling or dropping the slash. */
function joinUrl(base, path) {
  if (!base) return String(path)
  const left = String(base).replace(/\/+$/, '')
  const right = String(path || '').replace(/^\/+/, '')
  return right ? `${left}/${right}` : left
}

export { joinUrl }
