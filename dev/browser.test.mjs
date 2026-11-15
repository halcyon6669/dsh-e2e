/**
 * dsh-e2e — the browser layer.
 *
 * Two kinds of test live here, and the split matters:
 *
 *   - the *shape* tests are cheap and always run: step validation, the errors a
 *     badly written block produces, the URL join. They do not need a browser.
 *   - the *journey* test starts one. It is skipped when no Chrome or Edge is
 *     installed, because a probe that fails on a machine without a browser
 *     teaches people to ignore the probe — and a silently skipped browser step
 *     is the exact bug this layer exists to prevent, so the skip says so loudly
 *     rather than quietly passing.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeCase } from '../src/case.js'
import { captureBrowser, findBrowser, joinUrl, BrowserError } from '../src/browser.js'

let passed = 0
let failed = 0
const failures = []

async function test(name, run) {
  try {
    await run()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failed += 1
    failures.push(`${name}: ${error.message}`)
    console.log(`  FAIL ${name}`)
    for (const line of String(error.message).split('\n')) console.log(`       ${line}`)
  }
}

/** Shorthand: a case whose only interesting part is its browser block. */
function withBrowser(browser) {
  return normalizeCase(
    { id: 'probe', title: 'probe', request: { method: 'GET', path: '/' }, browser },
    '.',
    'probe.yaml',
  )
}

async function refusal(browser, expected) {
  try {
    await withBrowser(browser)
  } catch (error) {
    assert.ok(error instanceof Error)
    const message = String(error.message)
    assert.ok(
      message.toLowerCase().includes(String(expected).toLowerCase()),
      `expected the message to mention "${expected}", got: ${message}`,
    )
    return message
  }
  throw new Error(`the block was accepted, but it should have been refused for: ${expected}`)
}

console.log('browser')

await test('a step is one action, and two keys are refused', async () => {
  await refusal({ url: '/x', steps: [{ click: '#a', fill: { selector: '#b', value: 'c' } }] }, 'has 2 keys')
})

await test('an assertion without an expectation is refused', async () => {
  const message = await refusal({ url: '/x', steps: [{ assertText: { selector: '#a' } }] }, 'contains')
  assert.match(message, /cannot fail/, 'the message must say why an expectation is required')
})

await test('an unknown step names the ones that exist', async () => {
  const message = await refusal({ url: '/x', steps: [{ hover: '#a' }] }, 'is "hover"')
  for (const known of ['screenshot', 'click', 'fill', 'press', 'wait', 'waitFor', 'assertText', 'assertVisible']) {
    assert.ok(message.includes(known), `the refusal must list "${known}": ${message}`)
  }
})

await test('a fill without a value is refused, and an empty string is allowed', async () => {
  await refusal({ url: '/x', steps: [{ fill: { selector: '#a' } }] }, 'needs a "value"')
  const ok = await withBrowser({ url: '/x', steps: [{ fill: { selector: '#a', value: '' } }] })
  assert.equal(ok.browser.steps[0].fill.value, '', 'clearing a field must stay possible')
})

await test('a url has to be a string, not a number that becomes one', async () => {
  for (const url of [1, true, {}, []]) {
    await refusal({ url, steps: [] }, 'must be a string')
  }
})

await test('a viewport has to be positive', async () => {
  await refusal({ url: '/x', steps: [], viewport: { width: 0, height: 10 } }, 'positive number')
  await refusal({ url: '/x', steps: [], viewport: { width: 10, height: -1 } }, 'positive number')
  const ok = await withBrowser({ url: '/x', steps: [] })
  assert.deepEqual(ok.browser.viewport, { width: 1280, height: 800 }, 'the default viewport is 1280×800')
})

await test('an unknown browser field is refused rather than ignored', async () => {
  await refusal({ url: '/x', steps: [], colour: 'red' }, 'unknown browser field')
})

await test('a case without a browser block has none, not an empty one', async () => {
  const plain = await normalizeCase(
    { id: 'plain', title: 'plain', request: { method: 'GET', path: '/' } },
    '.',
    'probe.yaml',
  )
  // `null` and `{}` are different claims: one says "no UI here", the other says
  // "a UI was checked and it had nothing to say".
  assert.equal(plain.browser, null)
})

await test('a relative url joins the base without doubling or dropping a slash', () => {
  assert.equal(joinUrl('http://localhost:8080', '/login'), 'http://localhost:8080/login')
  assert.equal(joinUrl('http://localhost:8080/', '/login'), 'http://localhost:8080/login')
  assert.equal(joinUrl('http://localhost:8080/app/', 'login'), 'http://localhost:8080/app/login')
  // An empty path means "the base itself" — appending a slash would be a second
  // opinion about a URL the caller already gave us complete.
  assert.equal(joinUrl('http://localhost:8080', ''), 'http://localhost:8080')
})

await test('a browser block at a production address is refused before it starts', async () => {
  const { checkTargets } = await import('../src/guard.js')
  const definition = await withBrowser({
    url: 'https://shop.example.com/login',
    steps: [{ assertVisible: '#logo' }],
  })
  definition.env.baseUrl = 'http://localhost:8080'
  const resolved = { target: { baseUrl: 'http://localhost:8080' }, databases: {} }
  const problems = await checkTargets(definition, resolved)
  assert.ok(
    problems.some((problem) => problem.includes('shop.example.com')),
    `the guard must name the browser host, got: ${problems.join(' | ')}`,
  )
})

await test('a browser block on loopback passes the guard', async () => {
  const { checkTargets } = await import('../src/guard.js')
  const definition = await withBrowser({ url: '/login', steps: [{ assertVisible: '#logo' }] })
  definition.env.baseUrl = 'http://localhost:8080'
  const resolved = { target: { baseUrl: 'http://localhost:8080' }, databases: {} }
  const problems = await checkTargets(definition, resolved)
  assert.deepEqual(problems.filter((problem) => problem.includes('browser')), [])
})

// ---------------------------------------------------------------------------
// The journey. Needs a real browser.
// ---------------------------------------------------------------------------

const executable = (() => {
  try {
    return findBrowser()
  } catch {
    return null
  }
})()

if (!executable) {
  console.log('  skip  the journey tests, because no Chrome or Edge was found')
  console.log('        (set DSH_CHROME, or install one, to run them)')
} else {
  console.log(`  info  using ${executable}`)

  await test('a journey fills a field, clicks, asserts and keeps the pictures', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-e2e-browser-'))
    const page = join(dir, 'index.html')
    await writeFile(
      page,
      `<!doctype html><html><head><meta charset="utf-8"><title>probe</title></head>
<body>
  <h1 id="title">Sign in</h1>
  <input id="user" autocomplete="off">
  <button id="go" type="button">Go</button>
  <p id="out"></p>
  <script>
    document.getElementById('go').addEventListener('click', () => {
      const name = document.getElementById('user').value
      document.getElementById('out').textContent = 'welcome ' + name
      console.log('greeted ' + name)
    })
  </script>
</body></html>`,
      'utf8',
    )

    const result = await captureBrowser({
      url: `file:///${page.replace(/\\/g, '/')}`,
      outDir: join(dir, 'shots'),
      viewport: { width: 900, height: 600 },
      steps: [
        { screenshot: 'loaded' },
        { fill: { selector: '#user', value: 'ada' } },
        { click: '#go' },
        { assertText: { selector: '#out', contains: 'welcome ada', description: 'greets the user' } },
        { assertVisible: '#title' },
        { screenshot: 'after click' },
      ],
    })

    try {
      assert.equal(result.screenshots.length, 2)
      for (const shot of result.screenshots) {
        const info = await stat(shot.file)
        assert.ok(info.size > 1000, `${shot.fileName} should be a real PNG, got ${info.size} bytes`)
      }
      assert.match(result.screenshots[0].fileName, /^shot-01-/, 'screenshots are numbered in order')
      assert.match(result.screenshots[1].fileName, /^shot-02-after-click\.png$/)

      const failures = result.checks.filter((check) => !check.ok)
      assert.deepEqual(failures, [], 'both assertions pass')
      assert.ok(
        result.checks.some((check) => check.label === 'greets the user'),
        'the assertion keeps the description the author wrote',
      )

      const consoleText = result.console.map((line) => line.text).join('\n')
      assert.match(consoleText, /greeted ada/, 'the page console is captured')

      const kinds = result.timeline.map((entry) => entry.name)
      assert.ok(kinds.includes('browser.screenshot'), 'the timeline records each screenshot')
      // The timeline entry's own name is the step kind; the screenshot's name is
      // a label on it. Getting that backwards made every entry read "shot-01".
      assert.ok(
        result.timeline.every((entry) => !/^shot-\d/.test(entry.name)),
        `a screenshot label must not replace the step name: ${kinds.join(', ')}`,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  await test('a failed assertion fails the run without hiding the screenshot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-e2e-browser-'))
    const page = join(dir, 'index.html')
    await writeFile(page, '<!doctype html><html><body><h1 id="title">Sign in</h1></body></html>', 'utf8')
    const result = await captureBrowser({
      url: `file:///${page.replace(/\\/g, '/')}`,
      outDir: join(dir, 'shots'),
      steps: [
        { assertText: { selector: '#title', contains: 'welcome', description: 'the heading welcomes' } },
        { screenshot: 'after' },
      ],
    })
    try {
      const bad = result.checks.filter((check) => !check.ok)
      assert.equal(bad.length, 1)
      assert.match(bad[0].label, /the heading welcomes/)
      // A failing assertion must not stop the steps after it: the picture of
      // what the page actually showed is the reason anyone opens the report.
      assert.equal(result.screenshots.length, 1)
      assert.ok(result.screenshots[0].file.endsWith('.png'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  await test('clicking a missing element is a failed check, not a thrown error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-e2e-browser-'))
    const page = join(dir, 'index.html')
    await writeFile(page, '<!doctype html><html><body><p id="here">ok</p></body></html>', 'utf8')
    const result = await captureBrowser({
      url: `file:///${page.replace(/\\/g, '/')}`,
      outDir: join(dir, 'shots'),
      steps: [{ click: '#nowhere' }, { assertVisible: '#here' }],
    })
    try {
      const bad = result.checks.filter((check) => !check.ok)
      assert.equal(bad.length, 1, 'the missing click is the only failure')
      assert.match(bad[0].label, /#nowhere/)
      assert.equal(result.checks.filter((check) => check.ok).length, 1, 'the steps after it still ran')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}

console.log('')
if (failed > 0) {
  console.log(`${passed} passed, ${failed} failed`)
  for (const failure of failures) console.log(`  - ${failure}`)
  process.exitCode = 1
} else {
  console.log(`${passed} passed, 0 failed`)
}
