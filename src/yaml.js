/**
 * dsh-e2e — the single YAML entry point.
 *
 * js-yaml is vendored under ./vendor because a plugin's own directory is the only
 * place a bare `import 'js-yaml'` resolves from: the DSH profile's node_modules is
 * not on this package's resolution path.
 */
import { readFile } from 'node:fs/promises'

let modulePromise = null

function loadModule() {
  if (!modulePromise) {
    modulePromise = import(new URL('../vendor/js-yaml.mjs', import.meta.url).href)
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
