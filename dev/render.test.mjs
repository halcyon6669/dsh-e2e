/**
 * dsh-e2e — a render probe for the browser half.
 *
 * The static checks in `dev/client.test.mjs` read the bundle as text, so they
 * cannot see a `ReferenceError` that only fires when a component runs. Twice now
 * a refactor renamed a variable in one place and left the old name in the JSX:
 * `node --check` passed, the bundle loaded, and the panel was blank.
 *
 * So this runs the real factory from `client.js` against a small hooks runtime,
 * with a stubbed `fetch`, and asserts on the text that actually renders. It is
 * not React and it is not a browser — it is the cheapest thing that fails when a
 * render path breaks.
 *
 * Run: node dev/render.test.mjs
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(join(ROOT, 'client.js'), 'utf8')

/* ---------- a hooks runtime, small enough to read ---------- */

/**
 * Slots are positional, exactly like React's, so the component's own code needs
 * no changes. Dependency arrays are honoured for the three hooks that take them:
 * without that, `useEffect(refresh)` re-runs on every render, `refresh` sets
 * state, and the probe spins forever — which is a bug in the harness, not in the
 * panel, and would have been very confusing to debug from a timeout.
 */
let hookStates = []
let hookIndex = 0
let pendingRender = false
let effectSlots = []

const sameDeps = (left, right) =>
  Boolean(left && right) && left.length === right.length && left.every((value, index) => Object.is(value, right[index]))

const React = {
  createElement(type, props, ...children) {
    const flat = children.length <= 1 ? children[0] : children
    return { type, props: { ...(props || {}), children: flat } }
  },
  useState(initial) {
    const slot = hookIndex++
    if (!(slot in hookStates)) hookStates[slot] = typeof initial === 'function' ? initial() : initial
    const set = (next) => {
      const value = typeof next === 'function' ? next(hookStates[slot]) : next
      if (!Object.is(value, hookStates[slot])) {
        hookStates[slot] = value
        pendingRender = true
      }
    }
    return [hookStates[slot], set]
  },
  useCallback(fn, deps) {
    const slot = hookIndex++
    const previous = hookStates[slot]
    if (previous && sameDeps(previous.deps, deps)) return previous.value
    hookStates[slot] = { deps, value: fn }
    return fn
  },
  useMemo(fn, deps) {
    const slot = hookIndex++
    const previous = hookStates[slot]
    if (previous && sameDeps(previous.deps, deps)) return previous.value
    const value = fn()
    hookStates[slot] = { deps, value }
    return value
  },
  useRef(initial) {
    const slot = hookIndex++
    if (!(slot in hookStates)) hookStates[slot] = { current: initial }
    return hookStates[slot]
  },
  useEffect(fn, deps) {
    const slot = hookIndex++
    const previous = hookStates[slot]
    const changed = !previous || !deps || !sameDeps(previous.deps, deps)
    hookStates[slot] = { deps, cleanup: previous ? previous.cleanup : undefined }
    if (changed) effectSlots.push({ slot, fn })
  },
  useSyncExternalStore(subscribe, getSnapshot) {
    hookIndex += 1
    return getSnapshot()
  },
}

/* ---------- fixtures: the shapes the Host actually returns ---------- */

const now = Date.now()
const minutesAgo = (count) => new Date(now - count * 60_000).toISOString()

/**
 * One case as the Host lists it.
 *
 * `status` is computed by the Host (`src/plan.js`), not by the browser: the page
 * has to be able to say "blocked" — refused before it dialled — which is neither
 * passed nor failed, and two implementations of that word would drift.
 */
const CASE_ENTRY = (id, caseId, endpoint, scenario, status, group) => ({
  id,
  caseId,
  caseIdDerived: false,
  title: `proves ${id}`,
  tags: [],
  description: '',
  group,
  endpoint,
  scenario,
  priority: scenario === 'error' ? 'high' : 'medium',
  status,
  asserts: true,
  steps: [
    { kind: 'request', label: `POST ${endpoint.split(' ')[1]}` },
    { kind: 'expect.response', label: 'status 200' },
  ],
  file: `C:\\cases\\${id}.yaml`,
  name: `${id}.yaml`,
  target: 'record-local',
  configuration: null,
  databases: [],
  verdict: status === 'failed' ? 'failed' : status === 'passed' ? 'passed' : null,
  // The Host (src/projects.js) FLATTENS the last report onto each case — it
  // never sets `run`. A diagnosis that only reads `entry.run.summary` left
  // every run row blank in production; keep the fixture honest so that
  // regression can't come back.
  ...(status === 'passed' || status === 'failed'
    ? { lastRunAt: '2026-11-16T12:14:13.621Z', checks: 5, failed: status === 'failed' ? 2 : 0, durationMs: 1234 }
    : {}),
})

const RECORD_CASES = [
  CASE_ENTRY('auth-register', 'REG-001', 'POST /auth/register', 'normal', 'passed', 'Registration'),
  CASE_ENTRY('auth-confirm', 'REG-002', 'POST /auth/register', 'error', 'failed', 'Registration'),
]

const PLANNED_CASE = CASE_ENTRY('auth-logout', 'REG-003', 'POST /auth/logout', 'normal', 'planned', 'Registration')

const groupOf = (name, cases) => ({
  name,
  group: name,
  endpoint: null,
  cases,
  summary: {
    counts: {
      total: cases.length,
      passed: cases.filter((entry) => entry.status === 'passed').length,
      failed: cases.filter((entry) => entry.status === 'failed').length,
      blocked: 0,
      planned: cases.filter((entry) => entry.status === 'planned').length,
      generated: 0,
      running: 0,
    },
    label: cases.some((entry) => entry.status === 'failed')
      ? 'someFailed'
      : cases.every((entry) => entry.status === 'passed')
        ? 'allPassed'
        : 'someUnrun',
  },
})

const PROJECTS = {
  ok: true,
  dirs: ['C:\\cases'],
  registryFile: 'C:\\cases\\e2e.registry.yml',
  creator: 'administor-',
  generatedAt: new Date(now).toISOString(),
  warnings: [],
  projects: [
    {
      key: 'https://127.0.0.1:8443',
      name: 'Record',
      projectPath: 'E:/project/backend/Record',
      baseUrl: 'https://127.0.0.1:8443',
      targets: ['record-local', 'record-running'],
      caseDirs: ['C:\\cases'],
      cases: [...RECORD_CASES, PLANNED_CASE],
      groups: [groupOf('Registration', [...RECORD_CASES, PLANNED_CASE])],
      counts: { total: 3, passed: 1, failed: 1, notRun: 1, normal: 2, error: 1 },
      statusCounts: { all: 3, planned: 1, generated: 0, running: 0, passed: 1, failed: 1, blocked: 0 },
      lastActivityAt: minutesAgo(23),
      firstSeenAt: minutesAgo(300),
      lastVerdict: 'failed',
      type: 'backend',
      source: 'registry',
      warnings: [],
    },
    {
      key: 'https://127.0.0.1:9999',
      name: 'shop-web',
      projectPath: 'E:/project/web/shop',
      baseUrl: 'https://127.0.0.1:9999',
      targets: ['shop'],
      caseDirs: ['C:\\cases'],
      cases: [],
      groups: [],
      counts: { total: 0, passed: 0, failed: 0, notRun: 0, normal: 0, error: 0 },
      statusCounts: { all: 0, planned: 0, generated: 0, running: 0, passed: 0, failed: 0, blocked: 0 },
      lastActivityAt: minutesAgo(2),
      firstSeenAt: minutesAgo(2),
      lastVerdict: null,
      type: 'frontend',
      source: 'registry',
      warnings: [],
    },
  ],
}

const BOOTSTRAP = {
  ok: true,
  plugin: { version: '0.4.0', dataDir: 'C:\\data', mountedAt: '/plugins/e2e' },
  caseDirs: ['C:\\cases'],
  cases: [
    {
      dir: 'C:\\cases',
      cases: [...RECORD_CASES, PLANNED_CASE],
      groups: [groupOf('Registration', [...RECORD_CASES, PLANNED_CASE])],
      failures: [],
    },
  ],
  registry: { file: 'C:\\cases\\e2e.registry.yml', targets: ['record-local'], databases: [], error: null },
  reports: { dir: 'C:\\reports', reports: [] },
  ide: { host: '127.0.0.1', port: 64342 },
  runtimes: [],
}

/** One case as `GET /case` returns it, for the plan editor's form. */
const CASE_FILE = {
  ok: true,
  path: 'C:\\cases\\auth-register.yaml',
  file: 'auth-register.yaml',
  yaml: 'id: auth-register\ncaseId: REG-001\ntitle: proves auth-register\n',
  definition: {
    id: 'auth-register',
    caseId: 'REG-001',
    caseIdDerived: false,
    title: 'proves auth-register',
    description: '',
    group: 'Registration',
    endpoint: 'POST /auth/register',
    scenario: 'normal',
    priority: 'medium',
    steps: [],
    asserts: true,
    fields: {
      title: 'proves auth-register',
      caseId: 'REG-001',
      group: 'Registration',
      priority: 'medium',
      scenario: 'normal',
      endpoint: 'POST /auth/register',
      description: '',
      'request.method': 'POST',
      'request.path': '/auth/register',
      'expect.response.status': 200,
    },
  },
  // A case that passed yesterday still has something to say: the report of that
  // run is on disk, and opening the case has to show it rather than an empty page.
  history: [
    {
      path: 'C:\\reports\\run-1.json',
      markdownPath: 'C:\\reports\\run-1.md',
      name: 'run-1',
      modifiedAt: '2026-11-14T10:00:00.000Z',
      verdict: 'passed',
      startedAt: '2026-11-14T10:00:00.000Z',
      durationMs: 1234,
      checks: 5,
      failed: 0,
    },
  ],
}

/** The report a history row opens: same shape a live run summarises into. */
const PAST_REPORT = {
  ok: true,
  path: 'C:\\reports\\run-1.json',
  format: 'json',
  report: {
    runId: 'run-1',
    caseId: 'REG-001',
    verdict: 'passed',
    durationMs: 1234,
    traceId: 'trace-abc123',
    fatal: null,
    // The detail page reads these to fill the verdict card and the teardown
    // strip. A green run that leaked a service on port 8443 is not a green run,
    // so the strip is part of the page rather than a detail of the report.
    environment: {
      target: 'record-local',
      baseUrl: 'http://localhost:8080',
      configurationName: 'RecordApplication',
    },
    teardown: { sql: [{ sql: 'DELETE FROM users' }], mocks: [], service: { port: 8080, stopped: true }, errors: [] },
    checks: [{ ok: true, label: 'response.status is 200' }],
    steps: [{ at: 0, name: 'request' }],
    evidence: {
      request: { method: 'POST', url: 'http://localhost:8080/auth/register', body: { username: 'e2e1' } },
      response: { status: 200, statusText: 'OK', durationMs: 41, body: { token: 'abc' } },
      // Kept-but-not-asserted: this run started a service, so its console is
      // evidence even though the case checks nothing in it. `asserted: false`
      // is what the panel has to say out loud.
      logs: {
        path: 'C:\\run.log',
        traceId: 'abc123',
        traceIdPresent: true,
        asserted: false,
        totalLines: 42,
        scopedLines: 3,
        lines: ['INFO started', 'WARN slow query'],
      },
      // A report written before before/after snapshots existed: the rows the
      // query returned are still there, the pair is not. Showing nothing
      // because one half is missing throws away the answer to keep the shape
      // of the question.
      database: [
        {
          database: 'default',
          sql: 'SELECT valid_state FROM users',
          rows: [{ valid_state: '1' }],
          rowCount: 1,
          error: null,
        },
      ],
      // A case with a browser block also took pictures. The panel has to offer
      // the tab for it, and the tab has to point at `/shot` rather than inline
      // the bytes: a base64 PNG in the report makes every report bigger.
      browser: {
        url: 'http://localhost:8080/sign-in',
        browser: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        viewport: { width: 1280, height: 800 },
        screenshots: [
          {
            name: 'after click',
            fileName: 'shot-01-after-click.png',
            file: 'C:\\reports\\shots\\run-1\\shot-01-after-click.png',
            at: 900,
          },
        ],
        console: [{ level: 'log', text: 'greeted ada' }],
      },
    },
  },
}

/* ---------- the harness ---------- */

const requested = []
/** The parsed request body of every POST, paired with its path. */
const posted = []

/**
 * A run that found the service already listening and used it.
 *
 * There is no log of this run's own making, so the console tab has nothing to
 * show — and an empty tab that does not say why is indistinguishable from the
 * bug that emptied every console tab on the machine.
 */
const REUSED_REPORT = {
  ok: true,
  path: 'C:\\reports\\run-2.json',
  format: 'json',
  report: {
    runId: 'run-2',
    caseId: 'REG-001',
    verdict: 'passed',
    durationMs: 210,
    traceId: 'trace-reused',
    fatal: null,
    environment: { target: 'record-local', baseUrl: 'http://localhost:8080', configurationName: 'RecordApplication' },
    teardown: { sql: [], mocks: [], service: { port: 8080, stopped: false, reused: true }, errors: [] },
    checks: [{ ok: true, label: 'service already running', actual: 'http://localhost:8080 answered before the run started' }],
    steps: [{ at: 0, name: 'service.reused' }],
    evidence: { request: null, response: null, logs: null, database: [], browser: null, serviceReused: true },
  },
}

/** What the report route answers; swapped by the test that needs another run. */
let pastReport = PAST_REPORT

/* What the Host reads out of the project's own application.yml. The form calls
   this the moment a folder is chosen, so the port field starts on the number the
   project declares — and empty when it declares none, which is never 8080. */
const PROJECT_CONFIG = {
  ok: true,
  projectPath: 'E:/project/backend/Record',
  baseUrl: 'http://127.0.0.1:8443',
  port: 8443,
  contextPath: '',
  scheme: 'http',
  source: 'src/main/resources/application.yml',
  warnings: [],
}

// Two controllers declaring the same route is what a real project looks like, and
// it is what a route-only identity gets wrong: the second one collapses onto the
// first, or reports itself "already there".
const SCAN = {
  ok: true,
  projectPath: 'E:/project/backend/Record',
  scannedFiles: 42,
  controllers: [],
  dtos: [],
  entities: [],
  warnings: [],
  endpoints: [
    {
      controller: 'AuthController',
      file: 'src/main/java/app/AuthController.java',
      line: 51,
      httpMethod: 'POST',
      path: '/auth/register',
      javaMethod: 'register',
      requestBody: { type: 'RegisterDto', fields: [] },
    },
    {
      controller: 'AuthController',
      file: 'src/main/java/app/AuthController.java',
      line: 88,
      httpMethod: 'GET',
      path: '/auth/me',
      javaMethod: 'me',
      requestBody: null,
    },
    {
      controller: 'HealthController',
      file: 'src/main/java/app/HealthController.java',
      line: 14,
      httpMethod: 'GET',
      path: '/auth/me',
      javaMethod: 'health',
      requestBody: null,
    },
  ],
}
/* The two catalogs the settings sheet shows: what dsh-db-mcp can open, and what
   the IDE calls its run configurations. They are separate answers from separate
   places, and the sheet's whole point is putting them side by side. */
const SETTINGS = {
  ok: true,
  file: 'C:\\cases\\e2e.registry.yml',
  registryError: null,
  targets: [
    {
      name: 'record-local',
      baseUrl: 'https://127.0.0.1:8443',
      port: 8443,
      projectPath: 'E:/project/backend/Record',
      configurationName: '',
      caseDir: 'C:\\cases',
    },
  ],
  databases: [
    {
      name: 'iam',
      from: '',
      id: '',
      kind: 'postgresql',
      host: '127.0.0.1',
      port: 5432,
      database: 'iam_db',
      user: 'postgres',
      schema: 'public',
      hasPassword: true,
    },
  ],
  dbSources: {
    ok: true,
    file: 'C:\\Users\\administor-\\.dsh\\db-mcp\\datasources.json',
    dir: 'C:\\Users\\administor-\\.dsh\\db-mcp',
    sources: [
      { id: 'iam-src', name: 'IAM', kind: 'postgresql', group: '', host: '127.0.0.1', port: 5432, database: 'iam_db', user: 'postgres', schema: 'public', usable: true },
      { id: 'legacy', name: 'Legacy', kind: 'mysql', group: '', host: '127.0.0.1', port: 3306, database: 'legacy', user: '', schema: '', usable: false },
    ],
    error: null,
  },
  ide: {
    host: '127.0.0.1',
    port: 64342,
    reachable: true,
    restricted: false,
    configurations: [{ name: 'RecordApplication', description: 'Spring Boot', supportsDynamicLaunchOverrides: false }],
    error: null,
  },
  projectPath: 'E:/project/backend/Record',
}

globalThis.fetch = async (url, options) => {
  const path = String(url).split('/api')[1] || ''
  const method = (options && options.method) || 'GET'
  requested.push(path)
  if (options && typeof options.body === 'string') {
    try {
      posted.push({ path, body: JSON.parse(options.body) })
    } catch {
      /* a non-JSON body is not what this test is about */
    }
  }
  const body = path.startsWith('/projects')
    ? PROJECTS
    : path.startsWith('/case?')
      ? CASE_FILE
      : path.startsWith('/report?')
        ? pastReport
        : path.startsWith('/project-config')
          ? PROJECT_CONFIG
          : path.startsWith('/scan')
            ? SCAN
            : path.startsWith('/import-endpoints')
              ? { ok: true, written: [{ endpoint: 'POST /auth/register', caseId: 'REG-009' }], skipped: [] }
              : path.startsWith('/settings')
                ? method === 'POST'
                  ? { ok: true, changes: [], settings: SETTINGS }
                  : SETTINGS
                : BOOTSTRAP
  return { ok: true, status: 200, json: async () => body }
}

/** Rendered text, minus the style block (which is CSS, not copy). */
function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node.type === 'style') return ''
  if (typeof node.type === 'function') {
    const saved = hookIndex
    const out = textOf(node.type(node.props))
    hookIndex = saved
    return out
  }
  return textOf(node.props ? node.props.children : '')
}

function elementsOf(node, found = []) {
  if (!node || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    for (const child of node) elementsOf(child, found)
    return found
  }
  found.push(node)
  if (node.type === 'style') return found
  if (typeof node.type === 'function') {
    const saved = hookIndex
    elementsOf(node.type(node.props), found)
    hookIndex = saved
    return found
  }
  if (node.props) elementsOf(node.props.children, found)
  return found
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Renders, runs the effects that are due, and re-renders until nothing changes. */
async function settle(render) {
  let tree = null
  for (let round = 0; round < 30; round += 1) {
    pendingRender = false
    hookIndex = 0
    effectSlots = []
    tree = render()
    for (const { slot, fn } of effectSlots) {
      const cleanup = fn()
      if (hookStates[slot]) hookStates[slot].cleanup = cleanup
    }
    // Effects start fetches; two turns of the microtask queue is enough for the
    // stub, which resolves immediately.
    await flush()
    await flush()
    if (!pendingRender) break
  }
  return tree
}

/* ---------- boot the real bundle ---------- */

let registration = null
globalThis.window = { __ModuleLoader__: { load: (spec) => (registration = spec) } }

const requireStub = (name) => {
  if (name === 'react') return React
  throw new Error(`the bundle required ${name}, which this probe does not provide`)
}

// The bundle is an IIFE that calls window.__ModuleLoader__.load while it runs.
// eslint-disable-next-line no-new-func
new Function('window', 'require', source)(globalThis.window, requireStub)
const factory = registration.factory

const locales = {}
let mainComponent = null
let sidebarComponent = null
const ctx = {
  // Not a no-op: the bundle registers its dictionaries inside ctx.effect, so an
  // effect that never runs leaves every label as a raw key.
  effect: (fn) => {
    fn()
    return () => {}
  },
  locale: {
    register: (ns, lang, dict) => {
      locales[lang] = dict
      return () => {}
    },
    bind: () => (key, params) => {
      const template = (locales.en || {})[key]
      if (template === undefined) return key
      return String(template).replace(/\{(\w+)\}/g, (_, name) => String((params && params[name]) ?? `{${name}}`))
    },
    subscribe: () => () => {},
    getSnapshot: () => 0,
  },
  slots: {
    inject: (_name, fn) => fn(),
    register: (config, component) => {
      if (config.name === 'main') mainComponent = component
      if (config.name === 'sidebar.panellist') sidebarComponent = component
      return () => {}
    },
  },
}

const module = factory(requireStub)
module.apply(ctx)

/* ---------- assertions ---------- */

let passed = 0
let failed = 0

async function test(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failed += 1
    console.log(`  FAIL ${name}`)
    console.log(`       ${String(error.message).split('\n')[0]}`)
  }
}

console.log('render')

await test('apply() registers a main panel', () => {
  assert.equal(typeof mainComponent, 'function')
})

/* The sidebar icon is the only thing standing between this plugin and being
   invisible: a component that throws while rendering leaves an empty cell in
   the sidebar and nothing in any log. Render it once, the way the shell does. */
await test('the sidebar icon renders without throwing', () => {
  assert.equal(typeof sidebarComponent, 'function', 'the sidebar slot should have a component')
  const icon = sidebarComponent({ size: 20 })
  assert.equal(icon.type, 'svg')
  assert.equal(icon.props.width, 20)
  assert.equal(icon.props.height, 20)
})

await test('the sidebar icon has a size when the shell passes none', () => {
  const icon = sidebarComponent({})
  assert.equal(icon.props.width, 20, 'a missing size must fall back, not become undefined')
  assert.equal(icon.props.height, 20)
})

const landing = await settle(() => mainComponent({}))
const landingText = textOf(landing)

await test('the landing view is the project table', () => {
  // The tab row is inside the project now, so the landing page is named by its
  // bar and its cards, not by a tab.
  assert.match(landingText, /Record/)
  assert.match(landingText, /shop-web/)
})

await test('the landing page offers to create a project, and the form appears in the header strip', async () => {
  const create = elementsOf(landing).find(
    (node) =>
      node.props &&
      ['e2e-btn'].some((name) => String(node.props.className || '').split(' ').includes(name)) &&
      textOf(node).includes('Create project'),
  )
  assert.ok(create, 'expected a create-project button on the landing page')
  create.props.onClick()
  // The form is rendered by the next render pass, not the captured tree.
  const opened = await settle(() => mainComponent({}))
  const inputs = elementsOf(opened).filter(
    (node) => node.props && String(node.props.className || '').split(' ').includes('e2e-input'),
  )
  // The form asks for two things now: the folder, and the port when the project
  // declares none. The Base URL is still read from the project's application.yml,
  // the project's name is the folder's name, and the run configuration /
  // remote-host fields stay removed — local e2e needs neither.
  assert.ok(inputs.length >= 1, `expected the project path field, found ${inputs.length}`)
  assert.equal(inputs.length, 2, `expected the path field and the port field, found ${inputs.length}`)
  // A placeholder is a prop, not text content: assert on it where it lives.
  const pathField = inputs.find((node) => /Project path \(required/.test(String(node.props.placeholder || '')))
  assert.ok(pathField, 'the path field says the Base URL is derived')
  const portField = inputs.find((node) => String(node.props.className || '').split(' ').includes('e2e-project-port'))
  assert.ok(portField, 'the form has a port field beside the path')
  const submit = elementsOf(opened).find(
    (node) =>
      node.props &&
      ['e2e-btn'].some((name) => String(node.props.className || '').split(' ').includes(name)) &&
      textOf(node).trim() === 'Create',
  )
  assert.ok(submit, 'the form has its own create button')
  // Clicking the path asks the system file manager: typing a long Windows path
  // by hand is what this field avoids. The dialog is the Desktop window's own —
  // the panel ships no folder browser of its own.
  assert.equal(typeof pathField.props.onClick, 'function', 'the path field opens the file manager when clicked')
  const picks = []
  globalThis.__DSH_DIRECTORY_PICKER__ = {
    pick: async () => {
      picks.push('path')
      return 'C:\\work'
    },
  }
  pathField.props.onClick()
  const chosen = await settle(() => mainComponent({}))
  const pathValue = (tree) =>
    elementsOf(tree).filter((node) => node.props && String(node.props.className || '').split(' ').includes('e2e-input'))[0].props.value
  const portValue = (tree) =>
    elementsOf(tree)
      .filter((node) => node.props && String(node.props.className || '').split(' ').includes('e2e-project-port'))
      .map((node) => String(node.props.value || ''))
      .pop()
  assert.equal(pathValue(chosen), 'C:\\work', 'the folder the dialog returned becomes the project path')
  // The port comes from the project's own application.yml, read the moment the
  // folder is known — the reader should not have to look it up themselves.
  assert.equal(portValue(chosen), '8443', 'the port the project declares fills the field on its own')
  // The button beside the field does the same thing, for anyone looking for one.
  const browse = elementsOf(opened).find(
    (node) =>
      node.props &&
      ['e2e-btn'].some((name) => String(node.props.className || '').split(' ').includes(name)) &&
      textOf(node).trim() === 'Browse…',
  )
  assert.ok(browse, 'the form offers the folder dialog as a button too')
  globalThis.__DSH_DIRECTORY_PICKER__ = {
    pick: async () => {
      picks.push('button')
      return null
    },
  }
  browse.props.onClick()
  const cancelled = await settle(() => mainComponent({}))
  assert.equal(pathValue(cancelled), 'C:\\work', 'a dismissed dialog leaves the path exactly as it was')
  assert.equal(picks.length, 2, 'both the field and the button open the dialog')
  // In an ordinary browser tab there is no bridge. The field still takes a typed
  // path, and the button says why the dialog did not open instead of doing
  // nothing at all.
  delete globalThis.__DSH_DIRECTORY_PICKER__
  browse.props.onClick()
  const unavailable = await settle(() => mainComponent({}))
  assert.match(textOf(unavailable), /no system file manager/, 'a missing bridge is reported, not ignored')
})

await test('the landing page has no per-card delete; deletion lives in edit mode', async () => {
  const cards = elementsOf(landing).filter((node) => node.props && String(node.props.className || '').split(' ').includes('e2e-project-card'))
  assert.ok(cards.length > 0, 'the landing page shows project cards')
  const deleteButtons = elementsOf(landing).filter(
    (node) => node.props && String(node.props.className || '').split(' ').includes('e2e-project-delete'),
  )
  assert.equal(deleteButtons.length, 0, 'cards carry no delete control of their own')
  // Enter edit mode: every card grows a checkbox, and picking one arms the
  // header's batch delete with the ticked count.
  const editButton = elementsOf(landing).find((node) => node.props && node.props.onClick && textOf(node) === 'Edit')
  assert.ok(editButton, 'the header offers Edit')
  editButton.props.onClick()
  const editing = await settle(() => mainComponent({}))
  const picks = elementsOf(editing).filter((node) => node.props && node.props.className === 'e2e-project-pick')
  assert.equal(picks.length, cards.length, 'every project card offers a checkbox in edit mode')
  picks[0].props.onChange()
  const picked = await settle(() => mainComponent({}))
  assert.match(textOf(picked), /Delete selected \(1\)/, 'the header counts what is picked')
})

await test('results render as counts, not one summary word', () => {
  assert.match(landingText, /1 Passed/, 'the passed count should be visible')
  assert.match(landingText, /1 Failed/, 'the failed count should be visible')
  assert.match(landingText, /Not run/, 'a project with no cases says so')
})

await test('the type column comes from the Host, not a guess', () => {
  assert.match(landingText, /BACKEND/)
  assert.match(landingText, /FRONTEND/)
})

await test('activity is relative, and the exact time stays in the title', () => {
  const cells = elementsOf(landing).filter(
    (node) => node.props && node.props.className === 'e2e-project-when' && node.props.title,
  )
  assert.ok(cells.length >= 2, `expected an activity cell per project, found ${cells.length}`)
  assert.match(textOf(cells[0]), /23m ago/)
  assert.match(String(cells[0].props.title), /\d/, 'the tooltip should carry the timestamp')
})

await test('the table and the case list come from one round trip', () => {
  assert.ok(requested.includes('/bootstrap'))
  assert.ok(requested.includes('/projects'))
})

// Settings answer questions about a project — which database entry it names,
// which IDE run configuration starts it. There is no project on the landing
// page, so the entry point must not be there either; a sheet that opened on
// some other project's answers would be worse than no sheet.
await test('the landing page has no settings of its own', () => {
  const buttons = elementsOf(landing).filter(
    (node) => node.props && /\be2e-btn\b/.test(String(node.props.className || '')),
  )
  const names = buttons.map((node) => textOf(node).trim())
  assert.equal(names.includes('Settings'), false, `the landing page offered settings: ${names.join(', ')}`)
})

const row = elementsOf(landing).find((node) => node.props && node.props.className === 'e2e-project-card' && node.props.onClick)

await test('clicking a project row opens that project', async () => {
  assert.ok(row, 'expected a clickable row')
  row.props.onClick()
  const opened = await settle(() => mainComponent({}))
  const text = textOf(opened)
  assert.match(text, /Back to home/, 'the top bar should offer a way back')
  assert.match(text, /Record/, 'the open project is named in the header')
  assert.match(text, /REG-001/, 'its cases are listed')
  assert.match(text, /REG-002/)
})

await test('the top bar is where you leave a project, and it really leaves', async () => {
  const opened = await settle(() => mainComponent({}))
  const back = elementsOf(opened).find(
    (node) =>
      node.props &&
      typeof node.props.className === 'string' &&
      /\be2e-btn\b/.test(node.props.className) &&
      /Back to home/.test(textOf(node)),
  )
  assert.ok(back, 'the top bar should carry the way back home')
  assert.equal(typeof back.props.onClick, 'function', 'a button that cannot be pressed is a label')
  back.props.onClick()
  const landingAgain = await settle(() => mainComponent({}))
  const cards = elementsOf(landingAgain).filter((node) => node.props && node.props.className === 'e2e-project-card')
  assert.ok(cards.length > 0, 'the project table comes back')
  // The breadcrumb row is project-only, so it is the cleanest proof the project closed.
  assert.equal(
    elementsOf(landingAgain).filter((node) => node.props && node.props.className === 'e2e-crumbs').length,
    0,
    'the breadcrumb row belongs to the project and should be gone',
  )
  // ...and back into the same project, so the tests after this one still have
  // it open. The card object from the first render is the same row.
  row.props.onClick()
  await settle(() => mainComponent({}))
})

await test('the case list shows only the open project’s cases', async () => {
  const opened = await settle(() => mainComponent({}))
  const text = textOf(opened)
  assert.equal(text.includes('shop-web'), false, 'another project leaked into the case list')
})

await test('a fresh list keeps the open project up to date', async () => {
  // The open project is looked up by key on every render, so a case added while
  // it is open shows up. Holding the object from click time would freeze it.
  const opened = await settle(() => mainComponent({}))
  const rows = elementsOf(opened).filter((node) => node.props && node.props.className === 'e2e-project-card')
  assert.equal(rows.length, 0, 'the table must not render behind the open project')
})

/* ---------- the case list ---------- */

const listed = await settle(() => mainComponent({}))
const listedText = textOf(listed)

await test('the case list has a tab per status, each with its count', () => {
  const tabs = elementsOf(listed).filter(
    (node) => node.props && String(node.props.className || '').split(' ').includes('e2e-tab'),
  )
  assert.ok(tabs.length >= 7, `expected a tab per status, found ${tabs.length}`)
  assert.match(listedText, /All/, 'the tabs should name their statuses')
  assert.match(listedText, /Blocked/)
  // The counts come from the Host's statusCounts; a page that recomputed them
  // from the visible rows would show zero the moment a filter was applied.
  assert.match(listedText, /Planned/)
})

await test('each row carries the four things the table promises', () => {
  const rows = elementsOf(listed).filter((node) => node.props && node.props.className === 'e2e-case-row')
  assert.equal(rows.length, 3, `expected one row per case, found ${rows.length}`)
  const text = rows.map(textOf).join('\n')
  assert.match(text, /REG-001/, 'the id')
  assert.match(text, /Passed/, 'the latest status')
  assert.match(text, /proves auth-register/, 'the test name')
  // The diagnosis is fed from the Host's FLAT last-run fields (verdict, checks,
  // failed, durationMs). A case that has run must never show an empty cell here.
  assert.match(text, /5 checks · 1234 ms/, 'the passed case reads checks and duration from its flat fields')
  assert.match(text, /5 checks · 2 failed · 1234 ms/, 'the failed case says how many checks failed')
  assert.match(text, /steps/, 'the diagnosis for an unrun case')
})

await test('a case that has never run says planned, not passed', () => {
  const rows = elementsOf(listed).filter((node) => node.props && node.props.className === 'e2e-case-row')
  const planned = rows.map(textOf).find((text) => text.includes('REG-003'))
  assert.ok(planned, 'expected the planned case to be listed')
  assert.match(planned, /Planned/)
  assert.equal(/Passed/.test(planned), false, 'an unrun case must not claim a verdict')
})

await test('the rows are grouped under the use case, with a summary', () => {
  const text = listedText
  assert.match(text, /Registration/, 'the group name')
  assert.match(text, /3 tests/, 'the group says how many it holds')
  const balances = elementsOf(listed).filter((node) => node.props && node.props.className === 'e2e-group-balance')
  assert.ok(balances.length >= 1, 'the group should show a pass/fail balance')
})

await test('a group folds, and stays folded across a refresh', async () => {
  const fold = elementsOf(listed).find(
    (node) => node.props && String(node.props.className || '').split(' ').includes('e2e-group-fold'),
  )
  assert.ok(fold, 'expected the fold control on the group header')
  assert.equal(fold.type, 'button', 'folding is an action, so it has a button')
  assert.equal(fold.props['aria-expanded'], 'true', 'a group starts open')

  fold.props.onClick()
  const folded = await settle(() => mainComponent({}))
  assert.equal(
    elementsOf(folded).filter((node) => node.props && node.props.className === 'e2e-case-row').length,
    0,
    'folding a group hides its rows',
  )
  assert.match(textOf(folded), /Registration/, 'the header stays, so you can open it again')
  assert.match(textOf(folded), /3 tests/, 'a folded group still says how much it is hiding')

  // The Host sends a fresh project on every refresh; folding is about the
  // reader's screen, not about the data, so it must not be undone by one.
  await settle(() => mainComponent({}))
  assert.equal(
    elementsOf(await settle(() => mainComponent({}))).filter(
      (node) => node.props && node.props.className === 'e2e-case-row',
    ).length,
    0,
    'a refresh must not silently unfold what the reader folded',
  )

  const again = elementsOf(await settle(() => mainComponent({}))).find(
    (node) => node.props && String(node.props.className || '').split(' ').includes('e2e-group-fold'),
  )
  again.props.onClick()
  const open = await settle(() => mainComponent({}))
  assert.ok(
    elementsOf(open).filter((node) => node.props && node.props.className === 'e2e-case-row').length > 0,
    'clicking again opens it',
  )
})

await test('the case list can delete what it has ticked, and asks twice', async () => {
  const before = requested.length
  // The group header's "select all" checkbox shares the class with the rows;
  // only the row ones are titled "Select this case".
  const checkboxes = elementsOf(listed).filter(
    (node) => node.props && node.props.className === 'e2e-case-check' && node.props.title === 'Select this case',
  )
  assert.ok(checkboxes.length > 0, 'the case rows carry selection checkboxes')
  checkboxes[0].props.onChange()
  const picked = await settle(() => mainComponent({}))
  const arm = elementsOf(picked).find(
    (node) =>
      node.props &&
      typeof node.props.className === 'string' &&
      /\be2e-btn\b/.test(node.props.className) &&
      /Delete selected \(1\)/.test(textOf(node)),
  )
  assert.ok(arm, 'the selection footer offers to delete the one ticked case')
  // First press arms; the file must still be on disk.
  arm.props.onClick()
  const armed = await settle(() => mainComponent({}))
  assert.match(textOf(armed), /Delete for real/, 'the first press asks for confirmation')
  assert.equal(requested.length, before, 'no delete went out on the first press')
  // Second press commits, and only then is the file deleted.
  const commit = elementsOf(armed).find(
    (node) =>
      node.props &&
      typeof node.props.className === 'string' &&
      /\be2e-btn\b/.test(node.props.className) &&
      /Delete for real/.test(textOf(node)),
  )
  assert.ok(commit, 'the armed button is pressable')
  commit.props.onClick()
  await settle(() => mainComponent({}))
  const deletes = requested.slice(before).filter((path) => path.startsWith('/case?file='))
  assert.ok(deletes.length >= 1, 'the second press deletes the ticked case file')
  // Leave the selection clear for the tests that follow.
  elementsOf(await settle(() => mainComponent({})))
    .filter((node) => node.props && node.props.className === 'e2e-case-check' && node.props.title === 'Select this case')
    .forEach((node, index) => {
      if (index === 0) node.props.onChange()
    })
  await settle(() => mainComponent({}))
})

await test('the group balance and row grid stay inside the scroller', () => {
  // A flex row that can overflow pushed the pass/fail balance past the right
  // edge of the case list; the grid rows had no box-sizing either. Both need the
  // width clamps in the bundle, not a screenshot that looks right on one screen.
  // Anchor to line start: the folded-state rule also mentions the class and
  // would otherwise win the match without the width clamps.
  const groupHead = source.match(/^\.e2e-plan-group-head\s*\{[^}]*\}/m)
  assert.ok(groupHead, 'the group head has a style block')
  assert.match(groupHead[0], /min-width:\s*0/, 'the group head may shrink')
  assert.match(groupHead[0], /box-sizing:\s*border-box/, 'its padding is inside its width')
  assert.match(source, /\.e2e-group-balance\s*\{[^}]*white-space:\s*nowrap/, 'the balance never wraps away')
  assert.match(source, /\.e2e-endpoint-tag\s*\{[^}]*text-overflow:\s*ellipsis/, 'long endpoints are clipped, not pushed out')
  // The open button owns four header tracks. Left in one 110px grid cell, its
  // status and diagnosis columns rendered under the wrong headers and looked
  // empty — the exact complaint that started this pass.
  const openBtn = source.match(/\.e2e-case-open\s*\{[^}]*\}/)
  assert.ok(openBtn, 'the open button has a style block')
  assert.match(openBtn[0], /grid-column:\s*2\s*\/\s*6/, 'it spans the id/name/status/diagnosis columns')
  // The bottom bar is a quiet selection footer, not a second run toolbar that
  // would not even stick inside the split flex column.
  const serialBar = source.match(/\.e2e-serial-bar\s*\{[^}]*\}/)
  assert.ok(serialBar, 'the serial bar has a style block')
  assert.equal(/position:\s*sticky/.test(serialBar[0]), false, 'it is not a no-op sticky bar')
  const listBtns = elementsOf(listed).filter((node) => node.props && /\be2e-btn\b/.test(String(node.props.className || '')))
  assert.equal(listBtns.some((node) => /Trigger serial run|串行/.test(textOf(node))), false, 'the footer does not repeat the run actions')
})

/* ---------- the case detail page ---------- */

const caseRow = elementsOf(listed).find(
  (node) =>
    node.props &&
    String(node.props.className || '').split(' ').includes('e2e-case-open') &&
    textOf(node).includes('REG-001'),
)

await test('opening a case reads it, it does not open the editor', async () => {
  assert.ok(caseRow, 'expected a clickable case row')
  caseRow.props.onClick()
  const opened = await settle(() => mainComponent({}))
  const text = textOf(opened)
  // Clicking a row means "show me this test". A Save button appearing because
  // someone looked at a file is a trap, not a feature.
  assert.match(text, /Test case · REG-001/, 'the page names the case it is showing')
  assert.match(text, /Properties/, 'the properties column')
  assert.match(text, /Code/, 'the code tab')
  assert.match(text, /History/, 'the history tab')
  assert.match(text, /Run again/, 'running it is one button')
  assert.match(text, /Edit/, 'editing is a separate, deliberate step')
  const inputs = elementsOf(opened).filter((node) => node.props && node.props.className === 'e2e-input')
  assert.equal(inputs.length, 0, 'the detail page has no editable fields')
})

await test('a passing case still shows what it saw', async () => {
  const opened = await settle(() => mainComponent({}))
  const text = textOf(opened)
  assert.match(text, /Passed/, 'the last verdict is on the page')
  // The report is on disk whether or not anyone is watching; a green case whose
  // evidence you cannot see is a green case you take on faith.
  const historyTab = elementsOf(opened).find(
    (node) =>
      node.props &&
      String(node.props.className || '').split(' ').includes('e2e-mode-btn') &&
      /History/.test(textOf(node)),
  )
  assert.ok(historyTab, 'the detail page offers the history tab')
  assert.match(textOf(historyTab), /History 1/, 'and says how many runs there are')
  historyTab.props.onClick()
  const withHistory = await settle(() => mainComponent({}))
  // Not `=== 'e2e-history-row'`: the row of the run being shown also carries
  // `is-active`, and an equality check here would report "no rows" for a page
  // that is displaying exactly one. (This is the third time a modifier class
  // has hidden a working component from this probe.)
  const rows = elementsOf(withHistory).filter(
    (node) => node.props && String(node.props.className || '').split(' ').includes('e2e-history-row'),
  )
  assert.equal(rows.length, 1, 'the past run is listed')
  rows[0].props.onClick()
  const detail = await settle(() => mainComponent({}))
  const after = textOf(detail)
  assert.match(after, /response\.status is 200/, 'the checks of that run')
  assert.match(after, /localhost:8080\/auth\/register/, 'the request it actually sent')
})

await test('a browser run shows its pictures, and they come from /shot', async () => {
  const opened = await settle(() => mainComponent({}))
  const shotsTab = elementsOf(opened).find(
    (node) =>
      node.props &&
      String(node.props.className || '').split(' ').includes('e2e-mode-btn') &&
      /Screenshots/.test(textOf(node)),
  )
  assert.ok(shotsTab, 'a case with a browser block offers the screenshot tab')
  shotsTab.props.onClick()
  const withShots = await settle(() => mainComponent({}))
  const images = elementsOf(withShots).filter((node) => node.type === 'img')
  assert.equal(images.length, 1, 'the screenshot is rendered')
  const src = String(images[0].props.src)
  // Served by the panel, not inlined: a case that never looks at a picture
  // should not pay for one in every report it fetches.
  assert.match(src, /\/shot\?path=/, 'the image is fetched from the shot route')
  assert.match(src, /shot-01-after-click\.png/, 'and points at the file this run wrote')
  assert.match(textOf(withShots), /greeted ada/, 'the page console is captured too')
})

await test('the console tab shows the server output and says it was not asserted on', async () => {
  const opened = await settle(() => mainComponent({}))
  const logsTab = elementsOf(opened).find(
    (node) =>
      node.props &&
      String(node.props.className || '').split(' ').includes('e2e-mode-btn') &&
      /Console/.test(textOf(node)),
  )
  assert.ok(logsTab, 'the detail page offers the console tab')
  assert.match(textOf(logsTab), /Console 2/, 'and counts the lines it has')
  logsTab.props.onClick()
  const withLogs = await settle(() => mainComponent({}))
  const text = textOf(withLogs)
  assert.match(text, /WARN slow query/, 'the lines the server actually printed')
  // The difference between "the run checked the console" and "the console is
  // here" is the whole point: a reader who misses it thinks a green run
  // verified that nothing alarming was logged.
  assert.match(text, /Kept for evidence, not asserted on/, 'it says what the log is worth')
  assert.doesNotMatch(text, /collected no logs/, 'and does not claim there are none')
})

await test('the console hides framework chatter and keeps the lines that matter', async () => {
  // A real run's 300-line window is mostly DispatcherServlet and Hikari DEBUG.
  // Showing all of it buried the two lines that explain what the service did.
  pastReport = {
    ...PAST_REPORT,
    report: {
      ...PAST_REPORT.report,
      evidence: {
        ...PAST_REPORT.report.evidence,
        logs: {
          path: 'C:\\run.log',
          traceId: 'abc123',
          traceIdPresent: true,
          asserted: false,
          totalLines: 9,
          scopedLines: 0,
          lines: [
            'o.s.web.servlet.DispatcherServlet - Initializing Servlet',
            'com.zaxxer.hikari.HikariConfig - HikariPool-1 - configuration',
            'o.s.web.servlet.DispatcherServlet - Completed initialization',
            'DEBUG c.h.a.i.j.d.p.c.m.C.update - ==>  Preparing: UPDATE codes',
            'DEBUG c.h.a.i.j.d.p.c.m.C.update - <==    Updates: 1',
            'WARN slow query',
            'com.zaxxer.hikari.pool.HikariPool - HikariPool-1 - Close initiated',
            'INFO started',
            'o.s.web.servlet.DispatcherServlet - Initializing Servlet', // repeated noise, deduped
          ],
        },
      },
    },
  }
  try {
    const opened = await openDetail()
    const logsTab = elementsOf(opened).find(
      (node) =>
        node.props &&
        String(node.props.className || '').split(' ').includes('e2e-mode-btn') &&
        /Console/.test(textOf(node)),
    )
    assert.ok(logsTab, 'the detail page offers the console tab')
    logsTab.props.onClick()
    const text = textOf(await settle(() => mainComponent({})))
    // The application's own lines survive.
    assert.match(text, /Preparing: UPDATE codes/, 'the SQL the service ran')
    assert.match(text, /Updates: 1/, 'the result of that SQL')
    assert.match(text, /WARN slow query/, 'warnings are kept')
    assert.match(text, /INFO started/, 'startup milestones are kept')
    assert.match(text, /key line\(s\)/, 'the page says it is showing a filtered view')
    // The framework noise is gone.
    assert.doesNotMatch(text, /Initializing Servlet/, 'DispatcherServlet chatter is hidden')
    assert.doesNotMatch(text, /HikariPool-1/, 'connection-pool chatter is hidden')
  } finally {
    pastReport = PAST_REPORT
    await openDetail()
  }
})

// A run that borrowed a service that was already up has no console of its own.
// Saying only "no console" reads like the defect this page was reported for, so
// the reason has to be on the page.
await test('a borrowed service says why its console is empty', async () => {
  pastReport = REUSED_REPORT
  try {
    const opened = await openDetail()
    const consoleTab = elementsOf(opened).find(
      (node) =>
        node.props &&
        String(node.props.className || '').split(' ').includes('e2e-mode-btn') &&
        /Console/.test(textOf(node)),
    )
    assert.ok(consoleTab, 'the detail page offers the console tab')
    consoleTab.props.onClick()
    const withConsole = await settle(() => mainComponent({}))
    const text = textOf(withConsole)
    assert.match(text, /used it instead of launching a second copy/, 'the reader is told the service was reused')
    assert.match(text, /no log of its own/, 'and why that means an empty console')
  } finally {
    pastReport = PAST_REPORT
    // The report is read once, when the case is opened, so putting the fixture
    // back is not enough: the page still holds the borrowed-service run. Open
    // the case again so the tests after this one start from the same report
    // they were written against.
    await openDetail()
  }
})

await test('a report without snapshots still shows the rows it read', async () => {
  const opened = await settle(() => mainComponent({}))
  const dbTab = elementsOf(opened).find(
    (node) =>
      node.props &&
      String(node.props.className || '').split(' ').includes('e2e-mode-btn') &&
      /Database/.test(textOf(node)),
  )
  assert.ok(dbTab, 'the detail page offers the database tab')
  assert.match(textOf(dbTab), /Database 1/, 'the after-state alone still counts as one answer')
  dbTab.props.onClick()
  const withDb = await settle(() => mainComponent({}))
  const text = textOf(withDb)
  assert.match(text, /SELECT valid_state FROM users/, 'the query that ran')
  assert.match(text, /valid_state/, 'and the row it returned')
  assert.match(text, /After the request only/, 'labelled as half a comparison, not a whole one')
  assert.doesNotMatch(text, /read no database rows/, 'it does not claim there were none')
})

// A generated skeleton connects its database but asserts nothing on it: the
// empty tab said "read no rows", which read like a defect. When the steps prove
// the connection happened, the page says what would fill the tab instead.
await test('a connected database with no assertions says what would fill the tab', async () => {
  pastReport = {
    ...PAST_REPORT,
    report: {
      ...PAST_REPORT.report,
      steps: [{ at: 0, name: 'database.connected' }],
      evidence: { request: null, response: null, logs: null, database: [], snapshots: [] },
    },
  }
  try {
    const opened = await openDetail()
    const dbTab = elementsOf(opened).find(
      (node) =>
        node.props &&
        String(node.props.className || '').split(' ').includes('e2e-mode-btn') &&
        /Database/.test(textOf(node)),
    )
    assert.ok(dbTab, 'the detail page offers the database tab')
    dbTab.props.onClick()
    const withDb = await settle(() => mainComponent({}))
    const text = textOf(withDb)
    assert.match(text, /asserts on none of it/, 'the page explains the empty tab')
    assert.match(text, /expect\.database/, 'and names the YAML block that fills it')
    assert.doesNotMatch(text, /read no database rows/, 'it does not claim rows were read')
  } finally {
    pastReport = PAST_REPORT
    await openDetail()
  }
})

await test('a case carries its own two halves, and the project carries no tabs', async () => {
  const detail = await settle(() => mainComponent({}))
  // Three tabs could not be three places: "cases" was the project and the other
  // two were halves of a case, so two of them were unpressed buttons claiming to
  // be pages. The switch lives on the case now, and the project line shows it.
  assert.equal(
    elementsOf(detail).filter((node) => node.props && /e2e-topnav-tab/.test(String(node.props.className || ''))).length,
    0,
    'the top bar must not offer project tabs',
  )
  const switched = elementsOf(detail).filter(
    (node) => node.props && String(node.props.className || '').split(' ').includes('e2e-case-switch-btn'),
  )
  assert.deepEqual(switched.map((node) => textOf(node)), ['Evidence', 'Test plan'], 'both halves are offered')
  assert.ok(
    String(switched[0].props.className).includes('is-active'),
    'the half being shown is the one marked active',
  )
  // The switch really moves: the plan page has the Form / YAML modes, the
  // evidence page does not.
  const planHalf = switched.find((node) => /Test plan/.test(textOf(node)))
  planHalf.props.onClick()
  const inPlan = await settle(() => mainComponent({}))
  assert.match(textOf(inPlan), /Form/, 'the plan half is the editor')
  const backToEvidence = elementsOf(inPlan).find(
    (node) =>
      node.props &&
      String(node.props.className || '').split(' ').includes('e2e-case-switch-btn') &&
      /Evidence/.test(textOf(node)),
  )
  assert.ok(backToEvidence, 'evidence stays reachable from the plan half')
  backToEvidence.props.onClick()
  const inEvidence = await settle(() => mainComponent({}))
  assert.match(textOf(inEvidence), /Test case · REG-001/, 'and the evidence half is the case')
})

await test('pressing Edit is what opens the editor', async () => {
  const detail = await settle(() => mainComponent({}))
  const edit = elementsOf(detail).find(
    (node) =>
      node.props &&
      String(node.props.className || '').split(' ').includes('e2e-btn') &&
      textOf(node) === 'Edit test plan',
  )
  assert.ok(edit, 'expected an Edit button on the detail page')
  edit.props.onClick()
  const opened = await settle(() => mainComponent({}))
  const text = textOf(opened)
  // The plan no longer has a tab of its own to name it: the case's switch does,
  // and the switch is the thing that says which half of the case you are in.
  assert.match(text, /Test plan/, 'the test plan names itself, through the case switch')
  assert.match(text, /Form/, 'the form view is offered')
  assert.match(text, /YAML/, 'so is the YAML view')
  assert.match(text, /REG-001/, 'the open case is named')
  const inputs = elementsOf(opened).filter((node) => node.props && node.props.className === 'e2e-input')
  assert.ok(inputs.length >= 5, `expected the form fields, found ${inputs.length} inputs`)
})

await test('the plan editor lists every case in the project, not just the open one', async () => {
  const opened = await settle(() => mainComponent({}))
  // `e2e-plan-row-name` is the label inside a row, so match the row class exactly.
  const rows = elementsOf(opened).filter((node) =>
    node.props ? String(node.props.className || '').split(' ').includes('e2e-plan-row') : false,
  )
  assert.equal(rows.length, 3, `expected every case in the plan, found ${rows.length}`)
})

await test('switching to YAML shows the document, and back shows the form', async () => {
  const opened = await settle(() => mainComponent({}))
  const modeButtons = (tree) =>
    elementsOf(tree).filter((node) =>
      node.props ? String(node.props.className || '').split(' ').includes('e2e-mode-btn') : false,
    )
  const modes = modeButtons(opened)
  assert.deepEqual(
    modes.map((node) => textOf(node)),
    ['Form', 'YAML'],
    'the editor offers exactly the two ways to write a case',
  )
  const yamlButton = modes.find((node) => textOf(node) === 'YAML')
  yamlButton.props.onClick()
  const yamlView = await settle(() => mainComponent({}))
  const areas = elementsOf(yamlView).filter((node) => node.type === 'textarea' && /is-plan/.test(String(node.props.className)))
  assert.equal(areas.length, 1, 'the YAML view is one textarea')
  assert.match(String(areas[0].props.value), /caseId: REG-001/, 'it shows the file, not a re-serialised copy')
  const formButton = modeButtons(yamlView).find((node) => textOf(node) === 'Form')
  formButton.props.onClick()
  const back = await settle(() => mainComponent({}))
  assert.equal(
    elementsOf(back).filter((node) => node.type === 'textarea' && /is-plan/.test(String(node.props.className))).length,
    0,
    'the form view must not keep the textarea around',
  )
})

await test('every group offers to add a test to itself', async () => {
  const opened = await settle(() => mainComponent({}))
  const adds = elementsOf(opened).filter((node) => node.props && node.props.className === 'e2e-add-test')
  assert.equal(adds.length, 1, 'one button per group')
  assert.match(textOf(adds[0]), /Add test/)
})

/* ---- the scan dialog ---- */

// Reading the endpoints out of the source is a question about the whole project,
// so it is a button in the case list's toolbar that opens a dialog — not a form
// hidden behind "new case" that imports one endpoint per trip.
await test('the toolbar scans the project, and the dialog imports what is ticked', async () => {
  // The earlier tests leave the panel in the plan editor; the toolbar belongs to
  // the case list, so walk back the way a reader does — the project crumb.
  let tree = await settle(() => mainComponent({}))
  const crumb = elementsOf(tree).find(
    (node) =>
      node.props &&
      String(node.props.className || '').split(' ').includes('e2e-crumb') &&
      /Record/.test(textOf(node)),
  )
  assert.ok(crumb, 'the breadcrumb leads back to the case list')
  crumb.props.onClick()
  const opened = await settle(() => mainComponent({}))
  const scanButton = elementsOf(opened).find(
    (node) =>
      node.props &&
      /\be2e-btn\b/.test(String(node.props.className || '')) &&
      /Scan the project for endpoints/.test(textOf(node)),
  )
  assert.ok(scanButton, 'the case list toolbar carries the scan button')
  scanButton.props.onClick()
  const dialog = await settle(() => mainComponent({}))
  const dialogText = textOf(dialog)
  assert.match(dialogText, /Endpoints in this project/, 'the dialog names what it is showing')
  assert.match(dialogText, /42 files/, 'the scan counts came from the Host')
  assert.match(dialogText, /\/auth\/register/, 'the endpoints the scan found are listed')
  assert.match(dialogText, /\/auth\/me/)

  // Nothing ticked means nothing to import: the primary button says so by being off.
  let dialogTree = dialog
  const importButton = () =>
    elementsOf(dialogTree).find(
      (node) => node.props && /\be2e-btn\b/.test(String(node.props.className || '')) && /^Import \d+/.test(textOf(node)),
    )
  assert.equal(importButton().props.disabled, true, 'an empty tick list cannot import')

  const rows = elementsOf(dialogTree).filter((node) => node.props && String(node.props.className || '').includes('e2e-scan-row'))
  // Three endpoints, two of them the same route from two controllers. A route
  // alone would collapse the second into the first, which is the bug this is
  // here to catch.
  assert.equal(rows.length, 3, 'one row per endpoint, even when two share a route')
  const boxes = rows.map((row) => elementsOf(row).find((node) => node.type === 'input'))
  boxes[0].props.onChange()
  dialogTree = await settle(() => mainComponent({}))
  assert.equal(importButton().props.disabled, false, 'a ticked row arms the import')
  assert.match(textOf(dialogTree), /Import 1/, 'the button counts the ticks')

  // Ticking the same route in the other controller must be a second tick, not an
  // untick of the first.
  boxes[2].props.onChange()
  dialogTree = await settle(() => mainComponent({}))
  assert.match(textOf(dialogTree), /Import 2/, 'two rows on one route are two ticks')

  importButton().props.onClick()
  await settle(() => mainComponent({}))
  assert.ok(requested.includes('/import-endpoints'), 'the ticks became one import request')
  const sent = posted.filter((entry) => entry.path.startsWith('/import-endpoints')).pop()
  assert.equal(sent.body.endpoints.length, 2, 'both ticked endpoints travel')
  assert.equal(sent.body.endpoints[0].file, 'src/main/java/app/AuthController.java', 'a pick names its own source file')
  assert.equal(
    sent.body.projectPath,
    'E:/project/backend/Record',
    'the import names the open project, not whichever target the Host would guess',
  )
  assert.equal(sent.body.target, 'record-local', 'the case is stamped with the open project\u2019s target')
  const closed = await settle(() => mainComponent({}))
  assert.equal(
    elementsOf(closed).filter((node) => node.props && node.props.className === 'e2e-scan-backdrop').length,
    0,
    'the dialog closes once the import lands',
  )
})

await test('the scan asks the Host about the open project', async () => {
  const scans = posted.filter((entry) => entry.path.startsWith('/scan'))
  assert.ok(scans.length > 0, 'the toolbar scan reached the Host')
  assert.equal(
    scans.pop().body.projectPath,
    'E:/project/backend/Record',
    'the scan reads the checkout the reader opened',
  )
})

/* ---- the settings sheet ---- */

// The two catalogs a reader needs are answers to the same question — "what does
// this machine have?" — so there is one place to read both. The database entry
// and its source are two halves of one decision, and the sheet has to show that
// the source list is not empty, because an empty list looks like "nothing here"
// rather than "nothing there yet".
await test('the settings sheet puts the database source and the IDE configuration in one place', async () => {
  let tree = await settle(() => mainComponent({}))
  const settingsButton = elementsOf(tree).find(
    (node) => node.props && /\be2e-btn\b/.test(String(node.props.className || '')) && /^Settings$/.test(textOf(node)),
  )
  assert.ok(settingsButton, 'the top bar carries the settings entry point')
  settingsButton.props.onClick()
  const opened = await settle(() => mainComponent({}))
  const text = textOf(opened)
  assert.match(text, /dsh-db-mcp source/, 'the sheet says where the databases come from')
  assert.match(text, /iam/, 'the registry entry is listed')
  assert.match(text, /iam-src — postgresql/, 'a usable source is offered with what it points at')
  assert.match(text, /legacy — mysql \(not PostgreSQL-wire, cannot be used\)/, 'an unusable one is shown, and says why')
  assert.match(text, /IDE run configuration/, 'the IDE half has its own heading')
  assert.match(text, /RecordApplication/, 'the IDE listed a run configuration')
  assert.match(text, /Allow setup\/teardown SQL to write/, 'the write switch is on the same sheet')
  // The address is editable here too: the port the project declares is shown,
  // and a project that declares none shows an empty field to type into.
  const portInput = elementsOf(opened).find(
    (node) => node.props && String(node.props.className || '').split(' ').includes('e2e-settings-port'),
  )
  assert.ok(portInput, 'the sheet has a port field')
  assert.equal(String(portInput.props.value), '8443', 'it opens on the port the target addresses')
})

await test('picking a source and saving writes the registry, not the page', async () => {
  let tree = await settle(() => mainComponent({}))
  const selects = elementsOf(tree).filter((node) => node.type === 'select')
  assert.ok(selects.length >= 3, 'entry, source and configuration are separate pickers')
  // The source picker is the one whose options name dsh-db-mcp sources.
  const sourcePicker = selects.find((node) =>
    elementsOf(node).some((option) => String((option.props && option.props.value) || '') === 'iam-src'),
  )
  assert.ok(sourcePicker, 'a source picker exists')
  sourcePicker.props.onChange({ target: { value: 'iam-src' } })
  await settle(() => mainComponent({}))

  const save = elementsOf(await settle(() => mainComponent({}))).find(
    (node) => node.props && /\be2e-btn\b/.test(String(node.props.className || '')) && /^Save$/.test(textOf(node)),
  )
  assert.ok(save, 'the sheet has a save button')
  save.props.onClick()
  await settle(() => mainComponent({}))

  const sent = posted.filter((entry) => entry.path.startsWith('/settings')).pop()
  assert.ok(sent, 'saving reached the Host')
  assert.equal(sent.body.database.name, 'iam')
  assert.equal(sent.body.database.from, 'db-mcp', 'the pick is what makes the entry import its connection')
  assert.equal(sent.body.database.id, 'iam-src')
  assert.equal(
    sent.body.projectPath,
    'E:/project/backend/Record',
    'the IDE list belongs to the open checkout, so the save says which one',
  )
})

await test('a typed port becomes the target address, and the rest of the URL is kept', async () => {
  let tree = await settle(() => mainComponent({}))
  const settingsButton = elementsOf(tree).find(
    (node) => node.props && /\be2e-btn\b/.test(String(node.props.className || '')) && /^Settings$/.test(textOf(node)),
  )
  assert.ok(settingsButton, 'the top bar carries the settings entry point')
  settingsButton.props.onClick()
  const opened = await settle(() => mainComponent({}))
  const portInput = elementsOf(opened).find(
    (node) => node.props && String(node.props.className || '').split(' ').includes('e2e-settings-port'),
  )
  assert.ok(portInput, 'the sheet has a port field')
  portInput.props.onChange({ target: { value: '9090' } })
  const afterTyping = await settle(() => mainComponent({}))
  const save = elementsOf(afterTyping).find(
    (node) => node.props && /\be2e-btn\b/.test(String(node.props.className || '')) && /^Save$/.test(textOf(node)),
  )
  assert.ok(save, 'the sheet has a save button')
  save.props.onClick()
  await settle(() => mainComponent({}))

  const sent = posted.filter((entry) => entry.path.startsWith('/settings')).pop()
  assert.ok(sent, 'saving reached the Host')
  // Only the port changed: the scheme and host the registry already carried are
  // kept, because moving a service to another port is not a rewrite of where it is.
  assert.equal(sent.body.target.baseUrl, 'https://127.0.0.1:9090')
})

/* ---- the detail page: verdict card, tab strip, inspection rail ---- */

/**
 * Walks back to the case list and opens the first case.
 *
 * The earlier tests leave the panel somewhere else (the plan editor, mostly),
 * and these ones are about the detail page, so they have to arrive there the
 * way a person does: press the way back, then the row.
 */
async function openDetail() {
  let tree = await settle(() => mainComponent({}))
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const row = elementsOf(tree).find(
      (node) =>
        node.props &&
        String(node.props.className || '').split(' ').includes('e2e-case-open') &&
        textOf(node).includes('REG-001'),
    )
    if (row) {
      row.props.onClick()
      return settle(() => mainComponent({}))
    }
    // Whatever page the previous test left open, there is exactly one control
    // that means "I am done here": the back-to-home button in the top bar, or
    // Done in the editor. On the landing page there is none of those — getting
    // back into a project is done with its card.
    const leave =
      elementsOf(tree).find(
        (node) =>
          node.props &&
          ['e2e-btn', 'e2e-crumb'].some((name) => String(node.props.className || '').split(' ').includes(name)) &&
          /^(Back to home|Done)$/.test(textOf(node).trim()),
      ) ||
      elementsOf(tree).find((node) => node.props && node.props.className === 'e2e-project-card' && node.props.onClick)
    assert.ok(leave, `expected a control that returns to the case list; page was: ${textOf(tree).replace(/\s+/g, ' ').slice(0, 300)}`)
    leave.props.onClick()
    tree = await settle(() => mainComponent({}))
  }
  assert.fail('could not reach the case list')
}

/** Presses one tab of the detail page and renders the result. */
async function showTab(tree, matcher) {
  const tab = elementsOf(tree).find(
    (node) =>
      node.props && String(node.props.className || '').split(' ').includes('e2e-mode-btn') && matcher.test(textOf(node)),
  )
  assert.ok(tab, `no tab matching ${matcher}`)
  tab.props.onClick()
  return settle(() => mainComponent({}))
}

// The verdict card is the answer to "should I keep reading", so the three
// numbers it carries have to be numbers, not a sentence to be parsed.
await test('the verdict card puts the count next to the word', async () => {
  const opened = await openDetail()
  const metrics = elementsOf(opened).filter((node) =>
    node.props ? String(node.props.className || '').split(' ').includes('e2e-metric') : false,
  )
  assert.equal(metrics.length, 3, 'checks, duration and the fatal boundary')
  const text = textOf(opened)
  assert.match(text, /1\/1/, 'the checks passed, as a fraction') // one check in the fixture
  assert.match(text, /1234 ms/, 'the duration, in the unit it was measured in')
  assert.match(text, /Strict verdict/, 'the verdict says what kind of verdict it is')
})

// A green run that leaked a service is not a green run. Teardown belongs on the
// page, not three clicks into the report.
await test('the teardown strip is on the page, not in the report', async () => {
  const opened = await openDetail()
  const text = textOf(opened)
  assert.match(text, /Teardown/, 'the strip has a heading word')
  assert.match(text, /clean/, 'nothing went wrong, and it says so')
  assert.match(text, /trace-abc123/, 'the trace id, so a log search is possible')
})

// The rail is the point of this layout: what went over the wire is visible
// while you read a checkpoint, not behind a tab you have to remember to open.
await test('the wire and the log tail stay visible whatever tab you are on', async () => {
  const opened = await openDetail()
  const rail = elementsOf(opened).find((node) => node.props && node.props.className === 'e2e-rail')
  assert.ok(rail, 'the inspection rail is rendered')
  const railText = textOf(rail)
  assert.match(railText, /POST/, 'the method badge')
  assert.match(railText, /localhost:8080\/auth\/register/, 'the URL that was called')
  assert.match(railText, /200/, 'the status that came back')
  assert.match(railText, /WARN slow query/, 'the last lines of the console')
  // And it is still there after switching tabs, which is the whole claim.
  const codeTab = elementsOf(opened).find(
    (node) =>
      node.props && String(node.props.className || '').split(' ').includes('e2e-mode-btn') && /Code/.test(textOf(node)),
  )
  assert.ok(codeTab, 'the code tab exists')
  codeTab.props.onClick()
  const afterSwitch = await settle(() => mainComponent({}))
  const railAgain = elementsOf(afterSwitch).find((node) => node.props && node.props.className === 'e2e-rail')
  assert.match(textOf(railAgain), /localhost:8080\/auth\/register/, 'the rail does not change with the tab')
})

// A checkpoint row has to be quotable: "number 1 failed" is how people talk
// about a run, and the status word lines up so the column can be scanned.
await test('a checkpoint row can be pointed at, by number and by word', async () => {
  const opened = await showTab(await openDetail(), /Checkpoints/)
  const rows = elementsOf(opened).filter((node) =>
    node.props ? String(node.props.className || '').split(' ').includes('e2e-check') : false,
  )
  assert.equal(rows.length, 1, 'one row per check in the fixture')
  const rowText = textOf(rows[0])
  // `textOf` concatenates without separators, so the mark and the number touch.
  assert.match(rowText, /1\. response\.status is 200/, 'rows are numbered from one')
  assert.match(rowText, /PASSED/, 'the verdict word is on the row, in one vocabulary')
})

// A failed row is tinted, because on a page of greens the red line has to find
// the reader rather than the other way round.
await test('a failed checkpoint is tinted, and says FAILED', async () => {
  PAST_REPORT.report.verdict = 'failed'
  PAST_REPORT.report.checks = [{ ok: false, label: 'response.body contains', expected: 'token', actual: 'nope' }]
  try {
    const opened = await showTab(await openDetail(), /Checkpoints/)
    const row = elementsOf(opened).find((node) =>
      node.props ? String(node.props.className || '').split(' ').includes('e2e-check') : false,
    )
    assert.ok(row, 'the failed check is rendered')
    assert.match(String(row.props.className), /is-failed/, 'the row carries the failed modifier')
    assert.match(textOf(row), /FAILED/, 'and the word')
    assert.match(textOf(row), /expected token/, 'the expectation is quoted verbatim')
  } finally {
    PAST_REPORT.report.verdict = 'passed'
    PAST_REPORT.report.checks = [{ ok: true, label: 'response.status is 200' }]
  }
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
