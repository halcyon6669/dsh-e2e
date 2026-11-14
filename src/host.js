/**
 * dsh-e2e — implementation half.
 *
 * Mounts the tool set and the panel API. The state here is deliberately tiny: the
 * tool layer and the panel both derive everything else from the case files, the
 * registry and the live run.
 *
 * One thing happens at mount that is not a derivation: if the case directory is
 * empty, the packaged examples are copied into it (and the example registry next
 * to it, where the lookup will find it). A panel that opens on "no case directory
 * is configured" teaches nobody what a case looks like.
 */
import { copyFile, mkdir, readdir, readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTools } from './tools.js'
import { createPanel, PLUGIN_VERSION } from './panel.js'
import { caseRoots } from './store.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXAMPLES = join(HERE, '..', 'examples')

/**
 * Copies the packaged examples into an empty case directory. Never overwrites: a
 * file the user has edited is theirs, and a seed that clobbers it would be a data
 * loss bug dressed up as a convenience.
 */
async function seedExamples(caseDir) {
  const seeded = { dir: caseDir, cases: [], registry: null, error: null }
  try {
    const existing = await readdir(caseDir).catch(() => [])
    if (existing.some((name) => /\.ya?ml$/i.test(name))) return seeded
    const examples = await readdir(EXAMPLES).catch(() => [])
    for (const name of examples) {
      if (!/\.ya?ml$/i.test(name)) continue
      if (name === 'e2e.registry.yml' || name === 'e2e.registry.yaml') continue
      await copyFile(join(EXAMPLES, name), join(caseDir, name))
      seeded.cases.push(name)
    }
    // The registry is looked up in the case directory and then its parent, so a
    // copy next to the cases is what makes the seeded cases resolvable at all.
    const registrySource = join(EXAMPLES, 'e2e.registry.yml')
    const registryTarget = join(caseDir, 'e2e.registry.yml')
    const already = await readFile(registryTarget, 'utf8').catch(() => null)
    if (already === null) {
      await copyFile(registrySource, registryTarget)
      seeded.registry = basename(registryTarget)
    }
  } catch (error) {
    seeded.error = String((error && error.message) || error)
  }
  return seeded
}

export async function createHost({ dir, config = {}, ctx }) {
  const state = {
    dataDir: dir,
    lastCaseDir: null,
    mountedAt: new Date().toISOString(),
    tools: [],
    error: null,
    seeded: null,
  }

  // Only seed when the plugin is left to choose its own directory. An explicit
  // config.caseDir is the user's folder and is never written to on mount.
  if (!config.caseDir && !(Array.isArray(config.caseDirs) && config.caseDirs.length > 0)) {
    try {
      await mkdir(join(dir, 'cases'), { recursive: true })
      state.seeded = await seedExamples(join(dir, 'cases'))
    } catch (error) {
      state.seeded = { error: String((error && error.message) || error) }
    }
  }

  let tools = null
  try {
    tools = createTools({ ctx, state, config })
    state.tools = tools.toolNames
  } catch (error) {
    state.error = String((error && error.message) || error)
    throw error
  }

  const panel = createPanel({ ctx, config, state })

  /**
   * Reports whether the browser half is actually being served. A client bundle
   * that is present on disk but absent from this graph never reaches the page,
   * and "the panel does not appear" is then a build fact rather than a UI bug —
   * so the answer belongs in /status instead of a debugging session.
   */
  function clientStatus() {
    const modules = ctx.get('clientModules')
    if (!modules || typeof modules.graph !== 'function') {
      return { available: false, reason: 'the Host has no clientModules service' }
    }
    try {
      const graph = modules.graph()
      const entries = Array.isArray(graph && graph.entries) ? graph.entries : []
      return {
        available: true,
        rev: graph && graph.rev,
        ids: entries.map((entry) => entry.id),
        registered: entries.some((entry) => entry.id === 'dsh-e2e'),
        bundlePath: typeof modules.clientPath === 'function' ? modules.clientPath('dsh-e2e') || null : null,
      }
    } catch (error) {
      return { available: false, reason: String((error && error.message) || error) }
    }
  }

  /**
   * Explains why the browser half is or is not in the graph. `resolveMeta` is a
   * silent function: a null result means "this package declares no web client",
   * which is indistinguishable from "the loader row is not resolvable". Repeating
   * its two steps here turns that silence into an answer.
   *
   * Computed once: none of these facts change while the Host runs, and a support
   * answer should not cost a filesystem walk per request.
   */
  let diagnosticsCache = null
  function clientDiagnostics() {
    if (diagnosticsCache) return diagnosticsCache
    const out = { entries: [], resolve: null }
    try {
      const loader = ctx.get('loader')
      if (loader && typeof loader.entries === 'function') {
        for (const entry of loader.entries()) {
          const name = entry && entry.options && entry.options.name
          if (typeof name !== 'string' || !/e2e/.test(name)) continue
          let baseUrl = null
          try {
            baseUrl = entry.parent && entry.parent.tree && entry.parent.tree.ctx.baseUrl
          } catch {}
          out.entries.push({
            name,
            disabled: entry.disabled === true,
            hasFiber: entry.fiber !== undefined,
            baseUrl: baseUrl || null,
          })
        }
      }
    } catch (error) {
      out.entriesError = String((error && error.message) || error)
    }
    // Read the manifest the way the registry does — by walking up from the
    // resolved module — rather than through `require.resolve('<pkg>/package.json')`.
    // The registry never uses the package specifier to find the manifest, and a
    // package whose `exports` map omits `./package.json` (which is legal, and which
    // this package used to do) makes the specifier route fail for a reason that has
    // nothing to do with the client half. Reporting that as "the panel is broken"
    // would be a false alarm.
    try {
      const manifestPath = join(HERE, '..', 'package.json')
      const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
      out.resolve = {
        manifestPath,
        name: pkg.name,
        client: pkg.dsh ? pkg.dsh.client || null : null,
        clientExport: pkg.exports && pkg.exports['./client'] ? pkg.exports['./client'] : null,
        clientFile: readFileSync(join(HERE, '..', 'client.js'), 'utf8').length,
      }
    } catch (error) {
      out.resolve = { error: String((error && error.message) || error) }
    }
    // The scan resolves the Loader row name through the Loader's own resolver and
    // then walks up from the resolved module to the nearest matching manifest. A
    // row whose name resolves to something that is not this package (a stale link,
    // a shadowing copy) silently yields no web half, so repeat both steps.
    try {
      const loader = ctx.get('loader')
      const internal = loader && loader.internal
      const baseUrl = 'file:///' + process.cwd().replace(/\\/g, '/').replace(/^\//, '') + '/'
      out.loaderInternal = {
        version: internal ? internal.version || null : null,
        hasResolveSync: Boolean(internal && typeof internal.resolveSync === 'function'),
      }
      if (internal && typeof internal.resolveSync === 'function') {
        const rowBase = out.entries[0] && out.entries[0].baseUrl ? out.entries[0].baseUrl : baseUrl
        const resolved =
          internal.version === 'v2'
            ? internal.resolveSync(rowBase, { specifier: 'dsh-e2e', attributes: {} })
            : internal.resolveSync('dsh-e2e', rowBase, {})
        out.loaderInternal.resolvedUrl = resolved && resolved.url ? resolved.url : null
        if (resolved && resolved.url) {
          let dir = dirname(fileURLToPath(resolved.url))
          const walk = []
          for (;;) {
            const candidate = join(dir, 'package.json')
            let name = null
            try {
              name = JSON.parse(readFileSync(candidate, 'utf8')).name || null
            } catch {}
            if (name) walk.push({ dir, name })
            if (name === 'dsh-e2e') break
            const parent = dirname(dir)
            if (parent === dir) break
            dir = parent
          }
          out.loaderInternal.nearest = walk.slice(0, 4)
        }
      }
    } catch (error) {
      out.loaderInternal = { error: String((error && error.message) || error) }
    }
    diagnosticsCache = out
    return out
  }

  /**
   * Re-announces this entry to the client-module registry.
   *
   * The registry scans each Loader entry once, when that entry is announced, and
   * caches the result. An entry whose browser half appeared *after* its scan
   * (which is exactly what happens when the bundle is added to an
   * already-installed plugin) stays absent from the graph forever — the panel
   * then never loads, and nothing anywhere says why. Announcing the entry again
   * is the registry's own invalidation path, so use it instead of asking the user
   * to restart the whole Host.
   */
  async function nudgeClientScan() {
    const modules = ctx.get('clientModules')
    if (!modules) return { nudged: false, reason: 'no clientModules service' }
    const registered = () => {
      try {
        const graph = modules.graph()
        const entries = Array.isArray(graph && graph.entries) ? graph.entries : []
        return entries.some((entry) => entry.id === 'dsh-e2e')
      } catch {
        return false
      }
    }
    if (registered()) return { nudged: false, reason: 'already registered' }
    const problems = []
    try {
      if (typeof ctx.emit === 'function' && ctx.fiber) ctx.emit('internal/plugin', ctx.fiber)
      else problems.push('this context exposes no fiber to announce')
    } catch (error) {
      problems.push(String((error && error.message) || error))
    }
    // The announcement is handled on a microtask, so let the queue drain before
    // deciding whether the fallback is needed.
    await new Promise((resolve) => setTimeout(resolve, 50))
    if (registered()) return { nudged: true, via: 'internal/plugin', problems }
    // Fallback for a registry that ignored the announcement: mark the name dirty
    // and run its own flush, which is the code path the announcement would take.
    try {
      if (modules.dirty && typeof modules.dirty.add === 'function') modules.dirty.add('dsh-e2e')
      if (typeof modules.flush === 'function') {
        modules.flush((error) => problems.push(String((error && error.message) || error)))
      } else {
        problems.push('clientModules exposes no flush to force a rescan')
      }
    } catch (error) {
      problems.push(String((error && error.message) || error))
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
    if (registered()) return { nudged: true, via: 'flush', problems }
    return { nudged: false, reason: 'the registry still has no row for dsh-e2e', problems }
  }

  const clientNudge = await nudgeClientScan()

  async function handle(request, response) {
    const url = new URL(request.url || '/', 'http://localhost')
    const path = url.pathname.replace(/^\/plugins\/e2e\/api/, '') || '/'
    if (path === '/status') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      response.end(
        JSON.stringify({
          ok: true,
          mountedAt: state.mountedAt,
          tools: state.tools,
          error: state.error,
          caseDir: config.caseDir || null,
          caseDirs: config.caseDirs || null,
          resolvedCaseDirs: caseRoots({ config, state }),
          seeded: state.seeded,
          reportDir: config.reportDir || join(dir, 'reports'),
          idePort: config.idePort || 64342,
          ideHost: config.ideHost || '127.0.0.1',
          dataDir: dir,
          client: clientStatus(),
          clientNudge,
          clientDiagnostics: clientDiagnostics(),
        }),
      )
      return
    }
    await panel.handle(request, response)
  }

  return {
    version: PLUGIN_VERSION,
    toolNames: state.tools,
    handle,
    async dispose() {
      if (tools) tools.dispose()
      tools = null
      panel.dispose()
    },
  }
}
