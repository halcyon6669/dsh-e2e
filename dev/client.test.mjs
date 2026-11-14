/**
 * Static checks on the browser bundle.
 *
 * The Client half cannot be executed here: it is a browser module whose only
 * entry point is `window.__ModuleLoader__`, and there is no DOM. What *can* be
 * checked is everything that goes wrong silently in practice — a bundle that
 * never registers, a slot name that does not exist, a translation key missing
 * from one locale, an inline style that ignores the host theme, a `require` of a
 * package the loader does not hand out.
 *
 *   node dev/client.test.mjs
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

let passed = 0
let failed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed += 1
    process.stdout.write(`  ok   ${name}\n`)
  } catch (error) {
    failed += 1
    failures.push({ name, error })
    process.stdout.write(`  FAIL ${name}\n         ${error.message}\n`)
  }
}

const source = await readFile(join(ROOT, 'client.js'), 'utf8')
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
const en = JSON.parse(await readFile(join(ROOT, 'locale', 'en.json'), 'utf8'))
const zh = JSON.parse(await readFile(join(ROOT, 'locale', 'zh.json'), 'utf8'))
const scannerSource = await readFile(join(ROOT, 'src', 'scan.js'), 'utf8')

/**
 * The panel's dictionary lives inside the bundle closure (`DICT.en` / `DICT.zh`),
 * which is the dsh-db-mcp convention: the strings ship with the code that uses
 * them. Extract the object literal and evaluate it, so the checks below run
 * against the real dictionary rather than a copy that can drift.
 */
function extractDict(locale) {
  const marker = `const DICT = {`
  const start = source.indexOf(marker)
  assert.ok(start >= 0, 'the bundle has no DICT block')
  const open = source.indexOf('{', start)
  let depth = 0
  let end = -1
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }
  assert.ok(end > open, 'the DICT block is not balanced')
  const literal = source.slice(open, end)
  const dict = new Function(`return (${literal})`)()
  assert.ok(dict[locale] && typeof dict[locale] === 'object', `DICT.${locale} is missing`)
  return dict[locale]
}

const dictEn = extractDict('en')
const dictZh = extractDict('zh')

process.stdout.write('\nclient bundle\n')

test('the bundle registers itself with the module loader', () => {
  assert.match(source, /window\.__ModuleLoader__\.load\(/)
  assert.match(source, /id:\s*'dsh-e2e'/)
  assert.match(source, /factory\s*\(/)
})

test('the factory is a lazy registration, not top-level work', () => {
  // Everything must live inside the factory closure: the loader executes the
  // file just to register a factory, and any top-level side effect (a fetch, a
  // DOM query) would run before the app exists.
  const body = source.slice(source.indexOf('factory'))
  assert.ok(body.length > 0)
  for (const forbidden of ['document.querySelector', 'document.body', 'localStorage']) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not appear in the bundle`)
  }
})

test('React comes from the loader, never from a CDN or a second copy', () => {
  assert.match(source, /const React = require\('react'\)/)
  assert.equal(source.includes('https://unpkg.com'), false)
  assert.equal(source.includes('cdn.jsdelivr.net'), false)
  assert.equal(source.includes('ReactDOM'), false)
})

test('no package is required that the loader does not provide', () => {
  const required = [...source.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1])
  for (const name of required) {
    assert.ok(
      name === 'react' || name.startsWith('@deepseek-ai/dsh-client-'),
      `unexpected require('${name}'): only React and the declared client injects are available`,
    )
  }
})

test('the declared injects cover every required package', () => {
  const required = [...source.matchAll(/require\('(@deepseek-ai\/[^']+)'\)/g)].map((match) => match[1])
  for (const name of required) {
    assert.ok((pkg.dsh?.client?.inject || []).includes(name), `${name} is required but not declared in dsh.client.inject`)
  }
})

test('both slots it mounts into are real slots', () => {
  const slots = [...source.matchAll(/ctx\.slots\.register\(\s*\{\s*name:\s*'([^']+)'/g)].map((match) => match[1])
  const injected = [...source.matchAll(/ctx\.slots\.inject\('([^']+)'/g)].map((match) => match[1])
  const known = new Set([
    'main',
    'sidebar.panellist',
    'sidebar.panel.icon',
    'sidebar.panellist.actions',
    'plugins.tab',
    'plugins.detail.section',
    'shell.overlay',
    'sidebar.footer.action',
  ])
  for (const name of [...slots, ...injected]) assert.ok(known.has(name), `unknown slot: ${name}`)
  assert.ok(slots.includes('sidebar.panellist'), 'the panel needs a sidebar entry')
  assert.ok(slots.includes('main'), 'the panel needs a main surface')
})

test('the sidebar entry carries a stable id and an order', () => {
  assert.match(source, /id:\s*'e2e'/)
  assert.match(source, /order:\s*\d+/)
})

test('every visible string goes through the locale service', () => {
  assert.match(source, /ctx\.locale\.register\(NS, 'en'/)
  assert.match(source, /ctx\.locale\.register\(NS, 'zh'/)
  assert.match(source, /ctx\.locale\.bind\(NS\)/)
  // A hard-coded English sentence in JSX is the failure this catches: those are
  // the strings that never get translated and never show up in a missing-key
  // report.
  const jsxText = [...source.matchAll(/>\s*([A-Z][a-z]+(?: [a-z]+){2,}[.!?]?)\s*</g)].map((match) => match[1])
  assert.deepEqual(jsxText, [], `hard-coded UI text: ${JSON.stringify(jsxText)}`)
})

test('the en and zh dictionaries cover the same keys', () => {
  const keys = (dict) => Object.keys(dict).sort()
  assert.deepEqual(keys(dictZh), keys(dictEn))
  assert.ok(keys(dictEn).length > 40, `expected a real dictionary, got ${keys(dictEn).length} keys`)
})

test('every t() key used in the bundle exists in both dictionaries', () => {
  // The call may carry interpolation options — t('notice.saved', { file }) — so
  // the pattern stops at the closing quote, not at a closing paren.
  const used = new Set([...source.matchAll(/\bt\('([a-z][\w.]*)'/g)].map((match) => match[1]))
  for (const key of used) {
    assert.ok(key in dictEn, `t('${key}') is missing from DICT.en`)
    assert.ok(key in dictZh, `t('${key}') is missing from DICT.zh`)
  }
  assert.ok(used.size > 20, `expected the panel to use the dictionary, found ${used.size} keys`)
})

test('every dynamically built t() key exists too', () => {
  // Labels reached through a template — t(`verdict.${x}`) — are invisible to the
  // literal scan above, so the families are enumerated here.
  const families = {
    verdict: ['passed', 'failed', 'refused', 'running'],
    'label.scenario': ['normal', 'error'],
    'label.priority': ['high', 'medium', 'low'],
  }
  for (const [family, values] of Object.entries(families)) {
    const templated = source.includes(`t(\`${family}.\${`)
    assert.ok(templated, `no template uses the ${family} family; drop it from this table`)
    for (const value of values) {
      const key = `${family}.${value}`
      assert.ok(key in dictEn, `${key} is built dynamically but missing from DICT.en`)
      assert.ok(key in dictZh, `${key} is built dynamically but missing from DICT.zh`)
    }
  }
})

test('no translation key is defined but unused', () => {
  const used = new Set([...source.matchAll(/\bt\('([a-z][\w.]*)'/g)].map((match) => match[1]))
  const templated = new Set()
  // A family may itself be dotted (`t(`label.scenario.${x}`)`), so the capture has
  // to allow dots — restricting it to one segment silently ignores those keys.
  for (const match of source.matchAll(/t\(`([a-z][\w.]*?)\.\$\{/g)) {
    const family = match[1]
    for (const key of Object.keys(dictEn)) if (key.startsWith(`${family}.`)) templated.add(key)
  }
  const unused = Object.keys(dictEn).filter((key) => !used.has(key) && !templated.has(key))
  assert.deepEqual(unused, [], `unused dictionary keys: ${JSON.stringify(unused)}`)
})

test('styles use host theme tokens, not hard-coded colours', () => {
  const styleBlock = source.slice(source.indexOf('const STYLE'), source.indexOf('const STYLE') + 12000)
  assert.match(styleBlock, /--dsw-alias-/)
  const colours = [...styleBlock.matchAll(/#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d+\s*,/g)].map((match) => match[0])
  assert.deepEqual(colours, [], `hard-coded colours bypass the theme: ${JSON.stringify(colours)}`)
})

test('every API path the panel calls is a documented route', () => {
  // Read the routes out of the Host rather than keeping a second list here: a
  // hard-coded list only tests that someone remembered to update it, which is
  // exactly the failure it was supposed to catch.
  const panelSource = readFileSync(join(ROOT, 'src', 'panel.js'), 'utf8')
  const routes = new Set(
    [...panelSource.matchAll(/\{\s*method:\s*'(?:GET|POST|DELETE)',\s*path:\s*'([^']+)'/g)].map((match) => match[1]),
  )
  assert.ok(routes.size >= 14, `expected the Host to declare its routes in a table, found ${routes.size}`)
  const called = new Set([...source.matchAll(/api(?:Get|Post|Delete)\('([^']+)'/g)].map((match) => match[1].split('?')[0]))
  for (const path of called) assert.ok(routes.has(path), `the panel calls ${path}, which the Host does not serve`)
})

test('the panel never puts a credential in the page', () => {
  // The registry holds passwords; the bootstrap payload is a redacted summary.
  // A `password` field reaching the bundle would mean it can reach the DOM.
  for (const forbidden of ['password:', 'secret.key', 'secrets.json']) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not appear in the bundle`)
  }
})

test('the scan box reads the field names the Host actually emits', () => {
  // A wrong field name here fails silently in the worst way: the endpoint list
  // still renders, with an empty method column, and scaffolding posts
  // `method: undefined`, which the Host reads as "any method".
  assert.match(scannerSource, /httpMethod:/, 'src/scan.js no longer emits httpMethod')

  assert.equal(
    /endpoint\.method\b/.test(source),
    false,
    'the bundle reads endpoint.method, but the scan payload calls it httpMethod',
  )
  assert.match(source, /endpoint\.httpMethod/, 'the bundle does not read endpoint.httpMethod')
})

process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) {
  process.stdout.write('\nfailures:\n')
  for (const { name, error } of failures) process.stdout.write(`  - ${name}: ${error.message}\n`)
  process.exit(1)
}
