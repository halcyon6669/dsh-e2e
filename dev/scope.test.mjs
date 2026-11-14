/**
 * dev/scope.test.mjs — every identifier the browser bundle reads is declared
 * somewhere in the bundle, or is a global it is allowed to read.
 *
 * Why this exists
 * ---------------
 * `SidebarIcon` shipped with `width: size` and no `size` in sight. Nothing
 * caught it: `node --check` only rejects syntax errors, `dev/client.test.mjs`
 * reads the bundle as text (where `size` looks perfectly fine), and
 * `dev/render.test.mjs` only rendered the components the shell mounts in
 * `main`. The user saw an empty cell in the sidebar and no error anywhere.
 *
 * A render probe can only catch this for components it happens to render. This
 * probe is the general form of that lesson: it does not care which component a
 * name lives in, only whether the name exists at all.
 *
 * What it does not do
 * -------------------
 * It is deliberately scope-insensitive. A name declared in one function and
 * used in another is not reported — that needs a real scope chain, and the bug
 * that motivated this file (a name declared NOWHERE) is caught by the cheap
 * check. Being sound-but-incomplete beats being clever-but-flaky.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * The plugin itself has no runtime dependencies, so `acorn` is not in its
 * node_modules. Look for it where a parser actually lives on this machine — the
 * DSH profile ships one — and skip cleanly when there is none. A probe that
 * fails on a machine without a parser teaches people to ignore it.
 */
async function loadAcorn() {
  try {
    return await import('acorn')
  } catch {}
  const profile = process.env.DSH_PROFILE_DIR
  if (profile) {
    try {
      const { createRequire } = await import('node:module')
      const require = createRequire(join(profile, 'noop.js'))
      return require('acorn')
    } catch {}
  }
  return null
}

const acorn = await loadAcorn()
if (!acorn) {
  console.log('scope')
  console.log('  skip  no JavaScript parser available (looked for acorn in the plugin and in DSH_PROFILE_DIR)')
  console.log('\n0 passed, 0 failed (skipped)')
  process.exit(0)
}

/** Globals a browser bundle is allowed to read without declaring them. */
const GLOBALS = new Set([
  'window', 'document', 'globalThis', 'self', 'console', 'fetch', 'URL',
  'URLSearchParams', 'JSON', 'Math', 'Date', 'Number', 'String', 'Boolean',
  'Array', 'Object', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Error',
  'TypeError', 'RangeError', 'RegExp', 'Symbol', 'BigInt', 'Intl', 'Proxy',
  'Reflect', 'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'queueMicrotask', 'structuredClone', 'undefined',
  'NaN', 'Infinity', 'arguments', 'require', 'module', 'exports', 'process',
  'Buffer', 'TextEncoder', 'TextDecoder', 'AbortController', 'AbortSignal',
  'Blob', 'File', 'FileReader', 'FormData', 'Headers', 'Request', 'Response',
  'localStorage', 'sessionStorage', 'location', 'history', 'navigator',
  'performance', 'crypto', 'MutationObserver', 'ResizeObserver',
  'IntersectionObserver', 'CustomEvent', 'Event', 'Element', 'Node', 'HTMLElement',
])

const source = readFileSync(join(ROOT, 'client.js'), 'utf8')
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script', locations: true })

const declared = new Set()
const referenced = new Map() // name -> first line

/** Collect every name a binding pattern introduces. */
function collectPattern(node) {
  if (!node) return
  switch (node.type) {
    case 'Identifier':
      declared.add(node.name)
      break
    case 'ObjectPattern':
      for (const prop of node.properties) {
        if (prop.type === 'RestElement') collectPattern(prop.argument)
        else collectPattern(prop.value)
      }
      break
    case 'ArrayPattern':
      for (const element of node.elements) collectPattern(element)
      break
    case 'AssignmentPattern':
      collectPattern(node.left)
      break
    case 'RestElement':
      collectPattern(node.argument)
      break
    default:
      break
  }
}

/** True when this Identifier is a name being introduced, not one being read. */
function isDeclaration(node, parent, key) {
  if (!parent) return false
  if (parent.type === 'VariableDeclarator' && key === 'id') return true
  if (parent.type === 'FunctionDeclaration' && key === 'id') return true
  if (parent.type === 'FunctionExpression' && key === 'id') return true
  if (parent.type === 'ClassDeclaration' && key === 'id') return true
  if (parent.type === 'ClassExpression' && key === 'id') return true
  if (parent.type === 'CatchClause' && key === 'param') return true
  if (
    (parent.type === 'FunctionDeclaration' ||
      parent.type === 'FunctionExpression' ||
      parent.type === 'ArrowFunctionExpression') &&
    key === 'params'
  ) {
    return true
  }
  return false
}

/** True when this Identifier is a label or a non-computed member/key name. */
function isNameOnly(node, parent, key) {
  if (!parent) return false
  if (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return true
  if (parent.type === 'Property' && key === 'key' && !parent.computed) return true
  if (parent.type === 'MethodDefinition' && key === 'key' && !parent.computed) return true
  if (parent.type === 'PropertyDefinition' && key === 'key' && !parent.computed) return true
  if (parent.type === 'LabeledStatement' && key === 'label') return true
  if (parent.type === 'BreakStatement' && key === 'label') return true
  if (parent.type === 'ContinueStatement' && key === 'label') return true
  if (parent.type === 'ExportSpecifier') return true
  if (parent.type === 'ImportSpecifier' || parent.type === 'ImportDefaultSpecifier') return true
  if (parent.type === 'ImportNamespaceSpecifier') return true
  return false
}

function walk(node, parent, key) {
  if (!node || typeof node.type !== 'string') return
  if (node.type === 'Identifier') {
    if (isDeclaration(node, parent, key)) {
      declared.add(node.name)
      return
    }
    if (isNameOnly(node, parent, key)) return
    if (!referenced.has(node.name)) referenced.set(node.name, node.loc.start.line)
    return
  }
  // Binding patterns declare; visiting them as expressions would report the
  // declared names as reads.
  if (
    node.type === 'VariableDeclarator' ||
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'ClassDeclaration' ||
    node.type === 'ClassExpression' ||
    node.type === 'CatchClause'
  ) {
    if (node.type === 'VariableDeclarator') collectPattern(node.id)
    if (node.id) declared.add(node.id.name)
    if (node.params) for (const param of node.params) collectPattern(param)
    if (node.type === 'CatchClause') collectPattern(node.param)
  }
  for (const childKey of Object.keys(node)) {
    if (childKey === 'loc' || childKey === 'start' || childKey === 'end') continue
    const value = node[childKey]
    if (Array.isArray(value)) {
      for (const item of value) walk(item, node, childKey)
    } else if (value && typeof value === 'object' && typeof value.type === 'string') {
      walk(value, node, childKey)
    }
  }
}

walk(ast, null, null)

const missing = []
for (const [name, line] of referenced) {
  if (declared.has(name)) continue
  if (GLOBALS.has(name)) continue
  missing.push({ name, line })
}
missing.sort((a, b) => a.line - b.line)

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failed += 1
    console.log(`  FAIL ${name}`)
    // The whole message, not just its first line: a failure that says
    // "undeclared identifier(s):" and then hides them is a failure you have to
    // re-run to read.
    for (const line of String(error.message).split('\n')) console.log(`       ${line}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

console.log('scope')

test('every identifier the bundle reads is declared or is a global', () => {
  const report = missing.map((item) => `line ${item.line}: ${item.name}`).join('\n')
  assert(missing.length === 0, `undeclared identifier(s):\n${report}`)
})

test('the analysis actually found declarations to check against', () => {
  // A parser that silently produced an empty AST would make the test above
  // pass for the wrong reason. These floors are far below the real counts
  // (247 declarations, 261 referenced names) — they catch a broken parse, not
  // a large diff.
  assert(declared.size > 150, `only ${declared.size} declarations found; the parse looks wrong`)
  assert(referenced.size > 150, `only ${referenced.size} references found; the parse looks wrong`)
})

test('the analysis sees the names that matter', () => {
  // Named checks, not just counts: these are the identifiers whose loss would
  // make the whole probe vacuous while leaving the counts looking healthy.
  for (const name of ['h', 'React', 'MainPanel', 'SidebarIcon', 'DICT']) {
    assert(declared.has(name), `${name} should be a declaration the probe can see`)
  }
  // `React.useState` is a member access, so only `React` counts as a reference —
  // the probe deliberately does not treat property names as identifiers. Assert
  // on names that really are bare references in the bundle.
  for (const name of ['DICT', 'API', 'NS']) {
    assert(referenced.has(name), `${name} should be a reference the probe can see`)
  }
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
