/**
 * Verifies that the reload endpoint really re-reads src/*.js, not just the entry
 * module. This is the test that catches a reload which reports success while the
 * process keeps running the previous code.
 *
 *   node dev/reload.test.mjs
 */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const target = join(root, 'src', 'yaml.js')

const original = await readFile(target, 'utf8')

function fakeContext() {
  const routes = []
  return {
    routes,
    effect(fn) {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {
          const index = routes.indexOf(route)
          if (index >= 0) routes.splice(index, 1)
        }
      },
    },
    get() {
      return { register: () => ({ dispose() {} }) }
    },
    tools: { register: () => ({ dispose() {} }) },
  }
}

function fakeRequest(method = 'GET') {
  return { method, url: '/plugins/e2e/api/reload', headers: { host: '127.0.0.1:1' } }
}

function fakeResponse() {
  const chunks = []
  return {
    statusCode: 0,
    body() {
      return chunks.join('')
    },
    writeHead(status) {
      this.statusCode = status
    },
    end(chunk) {
      if (chunk) chunks.push(String(chunk))
    },
  }
}

let failures = 0
function check(name, fn) {
  try {
    fn()
    process.stdout.write(`  ok   ${name}\n`)
  } catch (error) {
    failures += 1
    process.stdout.write(`  FAIL ${name}\n         ${error.message}\n`)
  }
}

process.stdout.write('\nreload\n')

try {
  const module = await import(pathToFileURL(join(root, 'index.js')).href)
  const ctx = fakeContext()
  module.apply(ctx, { runtimeDir: join(root, 'dev', '.reload-state') })

  const reloadRoute = ctx.routes.find((route) => route.path.endsWith('/reload'))
  check('the reload route is registered', () => {
    assert.ok(reloadRoute, 'no reload route')
    assert.equal(reloadRoute.kind, 'exact')
  })

  // Let the initial host load settle before touching anything.
  await new Promise((resolve) => setTimeout(resolve, 300))

  const first = fakeResponse()
  await reloadRoute.handler(fakeRequest('POST'), first)
  check('a first reload succeeds', () => {
    assert.equal(first.statusCode, 200, first.body())
    const body = JSON.parse(first.body())
    assert.equal(body.ok, true)
  })

  // Change a module that index.js does not import directly: src/yaml.js is
  // reached through host.js -> tools.js -> case.js -> yaml.js.
  await writeFile(target, `${original}\nexport const __reloadProbe = 'SECOND'\n`, 'utf8')

  const second = fakeResponse()
  await reloadRoute.handler(fakeRequest('POST'), second)
  check('the second reload succeeds', () => {
    assert.equal(second.statusCode, 200, second.body())
  })

  const probe = await import(`${pathToFileURL(target).href}?probe=${Date.now()}`)
  check('a nested module change is picked up', () => {
    assert.equal(probe.__reloadProbe, 'SECOND', 'the reload did not re-read src/yaml.js')
  })

  // A broken edit must fail loudly instead of silently keeping the old code.
  await writeFile(target, 'export function parseYaml() { throw new Error("boom") }\nthis is not javascript\n', 'utf8')
  const third = fakeResponse()
  await reloadRoute.handler(fakeRequest('POST'), third)
  check('a broken module makes the reload fail', () => {
    assert.equal(third.statusCode, 500, `expected 500, got ${third.statusCode}: ${third.body()}`)
  })

  const getResponse = fakeResponse()
  await reloadRoute.handler(fakeRequest('GET'), getResponse)
  check('a GET is refused with 405', () => {
    assert.equal(getResponse.statusCode, 405)
  })
} finally {
  await writeFile(target, original, 'utf8')
}

process.stdout.write(failures === 0 ? '\nreload checks passed\n' : `\n${failures} reload check(s) failed\n`)
if (failures > 0) process.exit(1)
