/**
 * dev/scope.test.mjs — every identifier each file reads resolves to a binding in
 * a scope it can actually see, or is a global it is allowed to read.
 *
 * Why this exists
 * ---------------
 * `SidebarIcon` shipped with `width: size` and no `size` in sight. Nothing
 * caught it: `node --check` only rejects syntax errors, `dev/client.test.mjs`
 * reads the bundle as text (where `size` looks perfectly fine), and
 * `dev/render.test.mjs` only rendered the components the shell mounts in
 * `main`. The user saw an empty cell in the sidebar and no error anywhere.
 *
 * Then the same class of bug happened again, in `src/runner.js`. A loop was
 * rewritten to `for (const [index, expectation] of ...)` in one place and left
 * as `for (const expectation of ...)` in another, so `index` was read and never
 * declared *in that loop*. `node --check` passed, every unit test passed, and
 * the failure only surfaced when a real case ran against a real service, as
 * `fatal: ReferenceError: index is not defined`.
 *
 * The first version of this probe checked "is this name declared anywhere in the
 * file". That would not have caught the runner bug either: `index` was declared
 * elsewhere, in a different function. A check that only catches a bug you have
 * already fixed is decoration, so this version walks scopes properly.
 *
 * What it does not do
 * -------------------
 * It does not model temporal dead zone, and it treats every function as able to
 * read its enclosing scopes but not its siblings — which is correct. It is
 * per-file: a name imported from another module counts as declared, because
 * resolving across files is the bundler's job, not this probe's.
 */
import { readFileSync, readdirSync } from 'node:fs'
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

/** Globals a file is allowed to read without declaring them. */
const GLOBALS = new Set([
  'window', 'document', 'globalThis', 'self', 'console', 'fetch', 'URL',
  'URLSearchParams', 'JSON', 'Math', 'Date', 'Number', 'String', 'Boolean',
  'Array', 'Object', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Error',
  'TypeError', 'RangeError', 'SyntaxError', 'RegExp', 'Symbol', 'BigInt', 'Intl',
  'Proxy', 'Reflect', 'isNaN', 'isFinite', 'parseInt', 'parseFloat',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate',
  'clearImmediate', 'requestAnimationFrame', 'cancelAnimationFrame',
  'queueMicrotask', 'structuredClone', 'undefined', 'NaN', 'Infinity',
  'arguments', 'require', 'module', 'exports', 'process', 'global', 'Buffer',
  'TextEncoder', 'TextDecoder', 'AbortController', 'AbortSignal', 'Blob', 'File',
  'FileReader', 'FormData', 'Headers', 'Request', 'Response', 'localStorage',
  'sessionStorage', 'location', 'history', 'navigator', 'performance', 'crypto',
  'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'CustomEvent',
  'Event', 'Element', 'Node', 'HTMLElement',
])

/**
 * One pass over one file.
 *
 * A scope is `{ parent, bindings, isFunction }`. `var` and function declarations
 * go to the nearest function scope; `let`/`const`/`class`/params/catch bindings
 * go to the scope they appear in. Reads resolve up the chain.
 */
function analyse(source, sourceType) {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType, locations: true })

  const missing = []
  const referenced = new Map() // name -> first line
  const declaredNames = new Set() // every name declared anywhere, for sanity checks

  /**
   * Reads are collected and resolved *after* the whole file is walked.
   *
   * Resolving inline looks right and is wrong: a function may be called before
   * the line that declares it, and JavaScript hoists declarations precisely so
   * that works. Reporting `B` as undeclared because `A` is written above it
   * would make this probe cry wolf on every file in the plugin.
   */
  const pendingReads = []

  const program = { parent: null, bindings: new Set(), isFunction: true }

  const declare = (scope, name, node) => {
    if (!name) return
    scope.bindings.add(name)
    declaredNames.add(name)
  }

  const functionScopeOf = (scope) => {
    let current = scope
    while (current && !current.isFunction) current = current.parent
    return current || program
  }

  const resolves = (scope, name) => {
    let current = scope
    while (current) {
      if (current.bindings.has(name)) return true
      current = current.parent
    }
    return false
  }

  const read = (node, scope) => {
    const name = node.name
    if (!referenced.has(name)) referenced.set(name, node.loc.start.line)
    if (GLOBALS.has(name)) return
    pendingReads.push({ name, line: node.loc.start.line, scope })
  }

  /** Declare every name a binding pattern introduces, and read its defaults. */
  const declarePattern = (node, target, refScope) => {
    if (!node) return
    switch (node.type) {
      case 'Identifier':
        declare(target, node.name, node)
        return
      case 'ObjectPattern':
        for (const prop of node.properties) {
          if (prop.type === 'RestElement') {
            declarePattern(prop.argument, target, refScope)
            continue
          }
          if (prop.computed) walk(prop.key, refScope)
          declarePattern(prop.value, target, refScope)
        }
        return
      case 'ArrayPattern':
        for (const element of node.elements) declarePattern(element, target, refScope)
        return
      case 'AssignmentPattern':
        declarePattern(node.left, target, refScope)
        // `{ a = b }` declares `a` and reads `b` from the enclosing scope.
        walk(node.right, refScope)
        return
      case 'RestElement':
        declarePattern(node.argument, target, refScope)
        return
      default:
        // A computed key or an exotic pattern element is still an expression.
        walk(node, refScope)
    }
  }

  const block = (parent) => ({ parent, bindings: new Set(), isFunction: false })

  function walk(node, scope) {
    if (!node || typeof node.type !== 'string') return
    switch (node.type) {
      case 'Identifier':
        read(node, scope)
        return
      case 'VariableDeclaration': {
        const target = node.kind === 'var' ? functionScopeOf(scope) : scope
        for (const declarator of node.declarations) {
          declarePattern(declarator.id, target, scope)
          if (declarator.init) walk(declarator.init, scope)
        }
        return
      }
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        // A declaration binds its name where it is written; an expression may be
        // anonymous, and a named function expression binds its own name inside.
        if (node.id) declare(scope, node.id.name, node)
        const inner = { parent: scope, bindings: new Set(), isFunction: true }
        if (node.type === 'FunctionExpression' && node.id) declare(inner, node.id.name, node)
        for (const param of node.params) declarePattern(param, inner, inner)
        walk(node.body, inner)
        return
      }
      case 'ClassDeclaration':
      case 'ClassExpression': {
        if (node.id) declare(scope, node.id.name, node)
        if (node.superClass) walk(node.superClass, scope)
        const inner = block(scope)
        if (node.type === 'ClassExpression' && node.id) declare(inner, node.id.name, node)
        walk(node.body, inner)
        return
      }
      case 'ClassBody':
        for (const member of node.body) walk(member, scope)
        return
      case 'MethodDefinition':
      case 'PropertyDefinition': {
        if (node.computed) walk(node.key, scope)
        if (node.value) walk(node.value, scope)
        return
      }
      case 'BlockStatement':
        // A function body is walked inside the function's own scope; a bare block
        // gets one of its own.
        walkAll(node.body, block(scope))
        return
      case 'ForStatement':
      case 'ForOfStatement':
      case 'ForInStatement': {
        const inner = block(scope)
        if (node.init) walk(node.init, inner)
        if (node.left) walk(node.left, inner)
        if (node.right) walk(node.right, inner)
        if (node.test) walk(node.test, inner)
        if (node.update) walk(node.update, inner)
        walk(node.body, inner)
        return
      }
      case 'CatchClause': {
        const inner = block(scope)
        declarePattern(node.param, inner, inner)
        walk(node.body, inner)
        return
      }
      case 'SwitchStatement': {
        walk(node.discriminant, scope)
        const inner = block(scope)
        for (const switchCase of node.cases) {
          if (switchCase.test) walk(switchCase.test, inner)
          walkAll(switchCase.consequent, inner)
        }
        return
      }
      case 'ImportDeclaration':
        // Declared by the import itself; the module specifier is not code.
        for (const specifier of node.specifiers) declare(scope, specifier.local.name, specifier)
        return
      case 'ExportNamedDeclaration':
        if (node.declaration) walk(node.declaration, scope)
        for (const specifier of node.specifiers) {
          // `export { a as b }` reads `a` and merely names `b`.
          if (specifier.local) read(specifier.local, scope)
        }
        return
      case 'ExportDefaultDeclaration':
        walk(node.declaration, scope)
        return
      case 'ExportAllDeclaration':
        return
      case 'MemberExpression':
        walk(node.object, scope)
        if (node.computed) walk(node.property, scope)
        return
      case 'Property': {
        if (node.computed) walk(node.key, scope)
        // `{ a }` is shorthand: the value is the read, the key is just a name.
        walk(node.value, scope)
        return
      }
      case 'MetaProperty':
        return
      case 'LabeledStatement':
        walk(node.body, scope)
        return
      case 'BreakStatement':
      case 'ContinueStatement':
        return
      default:
        break
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue
      const value = node[key]
      if (Array.isArray(value)) {
        for (const item of value) walk(item, scope)
      } else if (value && typeof value === 'object' && typeof value.type === 'string') {
        walk(value, scope)
      }
    }
  }

  function walkAll(nodes, scope) {
    for (const node of nodes) walk(node, scope)
  }

  walk(ast, program)

  // Resolve now that every scope has every binding. Scopes are objects created
  // during the walk, so a read recorded with its scope still sees the final set
  // of names — a forward reference resolves to the binding written below it,
  // exactly as hoisting would.
  for (const entry of pendingReads) {
    if (resolves(entry.scope, entry.name)) continue
    missing.push({ name: entry.name, line: entry.line })
  }

  missing.sort((a, b) => a.line - b.line)
  return { declared: declaredNames, referenced, missing }
}

/**
 * Every file the plugin actually ships and runs. `client.js` is a classic script
 * (the module loader hands it a factory); everything else is an ES module.
 */
const FILES = [
  { path: 'client.js', sourceType: 'script' },
  { path: 'index.js', sourceType: 'module' },
  ...readdirSync(join(ROOT, 'src'))
    .filter((name) => name.endsWith('.js'))
    .sort()
    .map((name) => ({ path: join('src', name), sourceType: 'module' })),
]

const results = []
for (const file of FILES) {
  const source = readFileSync(join(ROOT, file.path), 'utf8')
  try {
    results.push({ ...file, ...analyse(source, file.sourceType), error: null })
  } catch (error) {
    results.push({ ...file, error })
  }
}

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

test('every source file parses', () => {
  const broken = results.filter((item) => item.error)
  assert(broken.length === 0, broken.map((item) => `${item.path}: ${item.error.message}`).join('\n'))
})

test('every identifier each file reads resolves to a binding it can see', () => {
  const offenders = results.filter((item) => item.missing && item.missing.length > 0)
  const report = offenders
    .map((item) => `${item.path}:\n${item.missing.map((entry) => `  line ${entry.line}: ${entry.name}`).join('\n')}`)
    .join('\n')
  assert(offenders.length === 0, `undeclared identifier(s):\n${report}`)
})

test('the analysis actually found declarations to check against', () => {
  // A parser that silently produced an empty AST would make the test above pass
  // for the wrong reason. These floors are far below the real counts, and they
  // are per-file on purpose: one file that failed to parse into anything would
  // otherwise hide behind the totals.
  for (const item of results) {
    assert(item.declared.size > 2, `${item.path}: only ${item.declared.size} declarations; the parse looks wrong`)
    assert(item.referenced.size > 2, `${item.path}: only ${item.referenced.size} references; the parse looks wrong`)
  }
})

test('the analysis sees the names that matter', () => {
  // Named checks, not just counts: these are the identifiers whose loss would
  // make the whole probe vacuous while leaving the counts looking healthy.
  const client = results.find((item) => item.path === 'client.js')
  for (const name of ['h', 'React', 'MainPanel', 'SidebarIcon', 'DICT']) {
    assert(client.declared.has(name), `${name} should be a declaration the probe can see`)
  }
  // `React.useState` is a member access, so only `React` counts as a reference —
  // the probe deliberately does not treat property names as identifiers. Assert
  // on names that really are bare references in the bundle.
  for (const name of ['DICT', 'API', 'NS']) {
    assert(client.referenced.has(name), `${name} should be a reference the probe can see`)
  }
  // The server half: an import has to count as a declaration, or every module
  // that uses one would report the imported name as undeclared.
  const runner = results.find((item) => item.path === join('src', 'runner.js'))
  assert(runner, 'src/runner.js should be in the analysed set')
  assert(runner.declared.has('index'), 'a loop variable introduced by destructuring is a declaration')
  assert(runner.referenced.has('index'), 'and reading it is a reference')
})

/**
 * The probe's own regression test.
 *
 * A scope-aware analysis is easy to get subtly wrong in the lenient direction:
 * if the resolver silently accepts everything, the test above passes forever.
 * This feeds the analyser a file that reads a name declared in a *sibling*
 * function — the exact shape of the runner bug — and insists it is reported.
 */
test('a name declared in a sibling scope is not visible', () => {
  const sample = [
    'function first(items) {',
    '  return items.map((item, index) => item + index)',
    '}',
    'function second(items) {',
    '  for (const item of items) {',
    '    console.log(index)',
    '  }',
    '}',
  ].join('\n')
  const found = analyse(sample, 'script').missing
  assert(
    found.some((entry) => entry.name === 'index'),
    `the analyser accepted a read of "index" from a sibling function; it found ${JSON.stringify(found)}`,
  )
})

test('but a name from an enclosing scope is visible', () => {
  const sample = [
    'function outer(items) {',
    '  const total = items.length',
    '  return items.map((item) => item + total)',
    '}',
  ].join('\n')
  const found = analyse(sample, 'script').missing
  assert(found.length === 0, `a closure read was reported as undeclared: ${JSON.stringify(found)}`)
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
