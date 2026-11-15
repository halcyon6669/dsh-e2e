/**
 * dsh-e2e — the single YAML entry point.
 *
 * js-yaml is vendored under ./vendor because a plugin's own directory is the only
 * place a bare `import 'js-yaml'` resolves from: the DSH profile's node_modules is
 * not on this package's resolution path.
 *
 * Locating that vendored file is not a one-liner, and getting it wrong is loud in
 * the worst possible way. `new URL(relative, import.meta.url)` throws a bare
 * `TypeError: Invalid URL` whenever `import.meta.url` is not a usable base — a
 * loader that instantiates the module from a non-file scheme, an inline
 * evaluation, an empty base. That message names neither the file nor the reason,
 * and because every YAML read in the plugin goes through here, it takes down the
 * registry, every case and the project list at once: the panel then says
 * "Invalid URL" four times and looks broken rather than mis-located.
 *
 * So the parser is located once, by trying the plausible bases in order, and a
 * failure says which ones were tried. One clear surprise at startup beats one
 * confusing error per request.
 */
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const VENDORED_PARSER = 'vendor/js-yaml.mjs'

/**
 * The directories this module could be living in, without assuming its own URL is
 * a file URL.
 *
 * Three shapes show up in practice and only the first is a URL:
 *   - `file:///C:/pkg/src/yaml.js` — the normal case;
 *   - `C:\pkg\src\yaml.js` — a loader that handed over the path it read, which
 *     `new URL()` rejects with "Invalid URL" and `fileURLToPath()` rejects too;
 *   - `C:/pkg/src/yaml.js` — worse, because `new URL()` accepts it and resolves
 *     against the drive letter as if it were a scheme, silently producing
 *     `c:/pkg/vendor/js-yaml.mjs`.
 *
 * `import.meta.dirname` covers most runtimes; the rest are read from the string.
 */
/** A loader may hand a module URL a cache-busting query; paths are not URLs. */
function stripQuery(url) {
  if (typeof url !== 'string') return url
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}

function moduleDirs(url = import.meta.url) {
  const dirs = []
  if (typeof import.meta.dirname === 'string' && import.meta.dirname) dirs.push(import.meta.dirname)
  const path = stripQuery(url)
  if (typeof path === 'string' && path) {
    if (path.startsWith('file:')) {
      try {
        dirs.push(dirname(fileURLToPath(path)))
      } catch {
        /* unreadable file URL; the path branches below may still apply */
      }
    } else if (isAbsolute(path)) {
      // A filesystem path that was never a URL. Both separators, because a
      // Windows path can arrive with either.
      dirs.push(dirname(path))
    }
  }
  if (process.cwd()) dirs.push(process.cwd())
  return [...new Set(dirs.map((dir) => dir.replace(/[\\/]+$/, '')).filter(Boolean))]
}

/**
 * The package's own directory, found through Node's resolver rather than by
 * guessing from the module URL.
 *
 * The reload hook rewrites every module URL with `?dshE2eGen=N`, and some DSH
 * loaders hand this module a relative or non-file URL on cold start. In that
 * case the directory walk above can only reach `process.cwd()` — the profile
 * directory, where no `vendor/` lives — and every YAML read in the plugin fails
 * at once. But `require.resolve()` still walks node_modules from any sane base,
 * and a package may resolve its own `exports` by name. That finds the installed
 * `dsh-e2e` (a junction in the profile in the live app) no matter which shape
 * the module URL had.
 */
function packageRoot(url = import.meta.url) {
  const bases = [url, pathToFileURL(join(process.cwd(), '__dsh-e2e__.js')).href]
  for (const base of bases) {
    try {
      const require = createRequire(stripQuery(base))
      return dirname(require.resolve('dsh-e2e/package.json'))
    } catch {
      /* this base cannot resolve; the next one is rooted in node_modules */
    }
  }
  return null
}

/**
 * Every URL the parser could plausibly live at, best guess first. Kept separate
 * from the import so the error message can list what was tried, and so a probe can
 * drive it with a base that would have thrown.
 */
/** Exposed for the probes: which files the parser would be read from, in order. */
export function parserCandidates(options = {}) {
  const url = options.url === undefined ? import.meta.url : options.url
  const clean = stripQuery(url)
  const dirs = options.dirs || moduleDirs(clean)
  const urls = []
  // Only a file URL can be a base. `new URL(relative, 'C:/pkg/src/yaml.js')`
  // succeeds and resolves against the drive letter as a scheme, which would put a
  // silently wrong candidate ahead of the right ones.
  if (typeof clean === 'string' && clean.startsWith('file:')) {
    try {
      urls.push(new URL(`../${VENDORED_PARSER}`, clean).href)
    } catch {
      /* a malformed file URL; the directory walk below covers it */
    }
  }
  // The resolver is the one answer that survives a rewritten module URL: the
  // package is installed in the profile, not in `process.cwd()`'s vendor dir.
  const root = packageRoot(options.url === undefined ? import.meta.url : options.url)
  if (root) urls.push(pathToFileURL(join(root, VENDORED_PARSER)).href)
  for (const dir of dirs) {
    for (const candidate of [dir, dirname(dir)]) urls.push(pathToFileURL(join(candidate, VENDORED_PARSER)).href)
  }
  return [...new Set(urls)]
}

let modulePromise = null

function loadModule() {
  if (!modulePromise) {
    const candidates = parserCandidates()
    modulePromise = (async () => {
      const problems = []
      for (const candidate of candidates) {
        try {
          return await import(candidate)
        } catch (error) {
          const code = error && error.code ? `${error.code}: ` : ''
          problems.push(`${candidate} (${code}${(error && error.message) || error})`)
        }
      }
      throw new Error(`the YAML parser could not be loaded from ${VENDORED_PARSER}; tried:\n  ${problems.join('\n  ')}`)
    })()
    // Nobody awaits this until the first read, so a rejected promise would
    // otherwise surface as an unhandled rejection at import time.
    modulePromise.catch(() => {})
  }
  return modulePromise
}

export async function parseYaml(text, source = '<yaml>') {
  const yaml = await loadModule()
  try {
    return yaml.load(text, { filename: source })
  } catch (error) {
    const mark = error && error.mark ? ` (${source}:${error.mark.line + 1}:${error.mark.column + 1})` : ''
    throw new Error(`invalid YAML${mark}: ${(error && error.message) || error}`)
  }
}

export async function readYamlFile(path) {
  const text = await readFile(path, 'utf8')
  return parseYaml(text, path)
}

/**
 * Serialises a value back to YAML. Used by the panel when it has to rewrite a
 * document it parsed, so the output stays a YAML file rather than JSON that
 * happens to be valid YAML.
 */
export async function dumpYaml(value) {
  const yaml = await loadModule()
  return yaml.dump(value, { lineWidth: 120, noRefs: true, sortKeys: false })
}
