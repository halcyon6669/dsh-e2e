/**
 * dsh-e2e — Host half entry.
 *
 * Kept thin on purpose: the Cordis entry is imported once per process, so the
 * implementation lives in ./src/host.js and is reloaded by the reload endpoint
 * during development.
 *
 * Reloading needs more than a query string on the entry module. `import()`
 * caching is keyed on the resolved URL of EVERY module in the graph, so bumping
 * `?v=` on host.js alone re-runs host.js against the still-cached copies of
 * ./src/report.js and friends — a reload that silently keeps the old code. A
 * module resolve hook appends the generation to every file under this package,
 * so the whole graph is re-read.
 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import { registerHooks } from 'node:module'

const API_PREFIX = '/plugins/e2e/api'
const RELOAD_PATH = `${API_PREFIX}/reload`

export const inject = ['webServer']

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/**
 * Cache-busts this package's own modules. `registerHooks` is process-wide, so the
 * hook stays scoped to files under the plugin directory and leaves every other
 * module in the process untouched.
 */
function installReloadHook() {
  if (typeof registerHooks !== 'function') return () => {}
  const rootUrl = new URL('.', import.meta.url).href
  let generation = 0
  const hook = {
    resolve(specifier, context, nextResolve) {
      const result = nextResolve(specifier, context)
      if (generation === 0 || typeof result.url !== 'string') return result
      if (!result.url.startsWith(rootUrl)) return result
      // The entry module already carries its own ?v=; give it the generation too
      // so a reload never reuses a previous generation's URL.
      return { ...result, url: `${result.url}${result.url.includes('?') ? '&' : '?'}dshE2eGen=${generation}` }
    },
  }
  registerHooks(hook)
  return (next) => {
    generation = next
  }
}

export function apply(ctx, config = {}) {
  const dir = (config && config.runtimeDir) || join(dshHome(), 'e2e')
  const setGeneration = installReloadHook()
  let generation = 0
  let hostPromise = null
  let hostRef = null

  function loadHost() {
    if (!hostPromise) {
      generation += 1
      setGeneration(generation)
      const specifier = new URL(`./src/host.js?v=${generation}`, import.meta.url)
      hostPromise = import(specifier.href).then(async (module) => {
        hostRef = await module.createHost({ dir, config, ctx })
        return hostRef
      })
      hostPromise.catch(() => {
        hostPromise = null
      })
    }
    return hostPromise
  }

  async function unloadHost() {
    const previous = hostRef
    hostRef = null
    hostPromise = null
    if (previous && typeof previous.dispose === 'function') {
      try {
        await previous.dispose()
      } catch {
        /* nothing left to do at reload time */
      }
    }
  }

  // Warm the implementation so a broken edit fails at mount time, not on the
  // first tool call, but never block the loader on it.
  loadHost().catch(() => {})

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: RELOAD_PATH,
      handler: async (request, response) => {
        const send = (status, body) => {
          response.writeHead(status, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          response.end(JSON.stringify(body))
        }
        if ((request.method || 'GET').toUpperCase() !== 'POST') {
          return send(405, { ok: false, error: 'POST required' })
        }
        const origin = request.headers.origin
        if (origin) {
          try {
            if (new URL(origin).host !== request.headers.host) return send(403, { ok: false, error: 'cross-origin reload rejected' })
          } catch {
            return send(403, { ok: false, error: 'unreadable origin' })
          }
        }
        hostPromise = null
        await unloadHost()
        try {
          const host = await loadHost()
          return send(200, { ok: true, generation, tools: host.toolNames, dir })
        } catch (error) {
          return send(500, { ok: false, error: String((error && error.message) || error) })
        }
      },
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: async (request, response) => {
        let host
        try {
          host = await loadHost()
        } catch (error) {
          response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          response.end(JSON.stringify({ ok: false, error: `host module failed to load: ${(error && error.message) || error}` }))
          return
        }
        await host.handle(request, response)
      },
    }),
  )

  // Unregister the tools and stop following any run log when the plugin unloads.
  ctx.effect(() => () => {
    void unloadHost()
  })
}
