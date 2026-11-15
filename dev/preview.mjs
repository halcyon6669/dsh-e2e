/**
 * dsh-e2e — render the panel to real HTML and photograph it.
 *
 * `dev/render.test.mjs` asserts on rendered *text*, which cannot tell you that a
 * row is 400px wide or that the rail fell below the fold. A redesign has to be
 * looked at, and "open the app and click three times" is not something you can
 * do in a loop.
 *
 * So this runs the real factory against the same kind of hooks runtime the probe
 * uses, serialises the tree to HTML, and lets `src/browser.js` take the pictures.
 * Seven pages: the project table, the case list, and the case detail in dark and
 * light plus three of its tabs (database, screenshots, console). Light and dark
 * both matter because the theme tokens are the one thing no assertion covers.
 *
 * The hooks runtime is duplicated from `dev/render.test.mjs` on purpose: that
 * file is a probe and has to keep running on its own, and a shared module would
 * mean a bug in the harness breaks the thing that checks the harness. The two
 * differ where they must: this one keys hook state by component instance (see
 * below), because a flat slot array makes every tab body render empty.
 *
 * `dev/theme.css` is a checked-in snapshot of the host's own theme tokens, so
 * the preview needs no asar reader to start.
 *
 * Run: node dev/preview.mjs
 *   Output (HTML + PNG) lands in the git-ignored dev/preview/.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { captureBrowser, findBrowser } from '../src/browser.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'dev', 'preview')
const source = readFileSync(join(ROOT, 'client.js'), 'utf8')

/**
 * Hook state is kept per component instance, keyed by its position in the tree.
 *
 * The text-only probe (`dev/render.test.mjs`) shares one flat slot array and
 * gets away with it because it only asserts on rendered text. A picture is less
 * forgiving: `MainPanel` owns the tab/view state, and a nested component that
 * calls a hook at the same offset would read `MainPanel`'s slot. Worse, walking
 * the cases view first initialises a slot that the detail view's `CaseDetail`
 * later reads as `{}` instead of `'checks'`, so every tab body renders empty --
 * a picture that says the layout is broken when the harness is.
 *
 * So each component instance gets its own frame, and the whole tree is expanded
 * once per render. `findNode` and `serialize` then walk plain elements; they
 * never run another component and never touch hook state.
 */
let hookStates = []
let hookIndex = 0
let pendingRender = false
let effectSlots = []

const frames = new Map()

function withFrame(path, fn) {
  let frame = frames.get(path)
  if (!frame) {
    frame = []
    frames.set(path, frame)
  }
  const outerStates = hookStates
  const outerIndex = hookIndex
  hookStates = frame
  hookIndex = 0
  try {
    return fn()
  } finally {
    hookStates = outerStates
    hookIndex = outerIndex
  }
}

const sameDeps = (left, right) =>
  Boolean(left && right) && left.length === right.length && left.every((value, index) => Object.is(value, right[index]))

const React = {
  createElement(type, props, ...children) {
    const flat = children.length <= 1 ? children[0] : children
    return { type, props: { ...(props || {}), children: flat } }
  },
  useState(initial) {
    const frame = hookStates
    const slot = hookIndex++
    if (!(slot in frame)) frame[slot] = typeof initial === 'function' ? initial() : initial
    const set = (next) => {
      const value = typeof next === 'function' ? next(frame[slot]) : next
      if (!Object.is(value, frame[slot])) {
        frame[slot] = value
        pendingRender = true
      }
    }
    return [frame[slot], set]
  },
  useCallback(fn, deps) {
    const frame = hookStates
    const slot = hookIndex++
    const previous = frame[slot]
    if (previous && sameDeps(previous.deps, deps)) return previous.value
    frame[slot] = { deps, value: fn }
    return fn
  },
  useMemo(fn, deps) {
    const frame = hookStates
    const slot = hookIndex++
    const previous = frame[slot]
    if (previous && sameDeps(previous.deps, deps)) return previous.value
    const value = fn()
    frame[slot] = { deps, value }
    return value
  },
  useRef(initial) {
    const frame = hookStates
    const slot = hookIndex++
    if (!(slot in frame)) frame[slot] = { current: initial }
    return frame[slot]
  },
  useEffect(fn, deps) {
    const frame = hookStates
    const slot = hookIndex++
    const previous = frame[slot]
    const changed = !previous || !deps || !sameDeps(previous.deps, deps)
    frame[slot] = { deps, cleanup: previous ? previous.cleanup : undefined }
    if (changed) effectSlots.push({ frame, slot, fn })
  },
  useSyncExternalStore(subscribe, getSnapshot) {
    hookIndex += 1
    return getSnapshot()
  },
}

/**
 * Expand every function component into plain elements, once, with stable
 * path-keyed frames.
 *
 * The path carries the component's name, not just its child index. Position
 * alone is not enough: switching from the cases view to the detail view puts
 * `CaseDetail` at the slot `CaseTable` used to own, and a flat position key
 * would then hand `CaseDetail` the `folded` object as its `tab` -- the exact
 * empty-tab-body bug this harness was built to catch. Identity in the key keeps
 * one component's state from ever being read as another's.
 */
function expand(node, path) {
  if (node === null || node === undefined || node === false || node === true) return node
  if (typeof node === 'string' || typeof node === 'number') return node
  if (Array.isArray(node)) return node.map((child, index) => expand(child, `${path}/${index}`))
  if (typeof node === 'function') {
    const name = node.name || 'anon'
    return expand(withFrame(`${path}/${name}`, () => node({})), `${path}/${name}/call`)
  }
  if (typeof node.type === 'function') {
    const name = node.type.name || 'anon'
    const inner = withFrame(`${path}/${name}`, () => node.type(node.props || {}))
    return expand(inner, `${path}/${name}/fn`)
  }
  const props = node.props || {}
  const children = expand(props.children, `${path}/c`)
  return { type: node.type, props: { ...props, children } }
}


/* ---------- fixtures ---------- */

/**
 * A project that looks like the ones this page is actually for: a passing case
 * with a console worth reading, a failing one, and a skeleton nobody has
 * written lessons into yet.
 */
const now = Date.now()
const minutesAgo = (count) => new Date(now - count * 60_000).toISOString()

const CASE_ENTRY = (id, caseId, endpoint, scenario, status, group) => ({
  id,
  caseId,
  caseIdDerived: false,
  title: 'signing up activates the account after the code is confirmed',
  tags: [],
  description: 'A user who registers, receives the code and confirms it is active, and the code stops working.',
  group,
  endpoint,
  scenario,
  priority: scenario === 'error' ? 'high' : 'medium',
  status,
  asserts: true,
  steps: [
    { kind: 'request', label: `POST ${endpoint.split(' ')[1]}` },
    { kind: 'expect.database', label: 'users has one inactive row' },
    { kind: 'expect.response', label: 'status 200' },
  ],
  file: `C:\\cases\\${id}.yaml`,
  name: `${id}.yaml`,
  target: 'record-local',
  configuration: null,
  databases: [],
  verdict: status === 'failed' ? 'failed' : status === 'passed' ? 'passed' : null,
  // The diagnosis column reads the run summary the Host matched; without it a
  // passed row diagnoses to an empty string, which reads as a bug in the page.
  run: status === 'passed' || status === 'failed' ? { summary: { checks: 5, durationMs: 1234, caseId, verdict: status } } : null,
})

const CASES = [
  CASE_ENTRY('auth-register', 'REG-001', 'POST /auth/register', 'normal', 'passed', 'Registration'),
  CASE_ENTRY('auth-confirm', 'REG-002', 'POST /auth/confirmCode', 'error', 'failed', 'Registration'),
  CASE_ENTRY('auth-logout', 'REG-003', 'POST /auth/logout', 'normal', 'planned', 'Registration'),
]

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
    label: 'someFailed',
  },
})

const PROJECTS = {
  ok: true,
  dirs: ['C:\\cases'],
  registryFile: 'C:\\cases\\e2e.registry.yml',
  creator: 'administor-',
  generatedAt: minutesAgo(1),
  warnings: [],
  projects: [
    {
      key: 'https://127.0.0.1:8443',
      name: 'Record',
      projectPath: 'E:/project/backend/Record',
      baseUrl: 'https://127.0.0.1:8443',
      targets: ['record-local', 'record-running'],
      caseDirs: ['C:\\cases'],
      cases: CASES,
      groups: [groupOf('Registration', CASES)],
      counts: { total: 3, passed: 1, failed: 1, notRun: 1, normal: 2, error: 1 },
      statusCounts: { all: 3, planned: 1, generated: 0, running: 0, passed: 1, failed: 1, blocked: 0 },
      lastActivityAt: minutesAgo(23),
      firstSeenAt: minutesAgo(300),
      lastVerdict: 'failed',
      type: 'backend',
      source: 'registry',
      warnings: [],
    },
  ],
}

const BOOTSTRAP = {
  ok: true,
  plugin: { version: '0.10.0', dataDir: 'C:\\data', mountedAt: '/plugins/e2e' },
  caseDirs: ['C:\\cases'],
  cases: [{ dir: 'C:\\cases', cases: CASES, groups: [groupOf('Registration', CASES)], failures: [] }],
  registry: { file: 'C:\\cases\\e2e.registry.yml', targets: ['record-local'], databases: [], error: null },
  reports: { dir: 'C:\\reports', reports: [] },
  ide: { host: '127.0.0.1', port: 64342 },
  runtimes: [],
}

const CASE_FILE = {
  ok: true,
  path: 'C:\\cases\\auth-register.yaml',
  file: 'auth-register.yaml',
  yaml: 'id: auth-register\ncaseId: REG-001\n',
  definition: {
    id: 'auth-register',
    caseId: 'REG-001',
    caseIdDerived: false,
    title: CASES[0].title,
    description: CASES[0].description,
    group: 'Registration',
    endpoint: 'POST /auth/register',
    scenario: 'normal',
    priority: 'medium',
    steps: CASES[0].steps,
    asserts: true,
    fields: {
      title: CASES[0].title,
      caseId: 'REG-001',
      group: 'Registration',
      priority: 'medium',
      scenario: 'normal',
      endpoint: 'POST /auth/register',
      description: CASES[0].description,
      'request.method': 'POST',
      'request.path': '/auth/register',
      'expect.response.status': 200,
    },
  },
  history: [
    {
      path: 'C:\\reports\\run-2026-11-15T03-41-27-867Z-80a2a7__CC-001.json',
      markdownPath: 'C:\\reports\\run-1.md',
      name: 'run-2026-11-15T03-41-27-867Z-80a2a7__CC-001',
      modifiedAt: minutesAgo(26),
      verdict: 'passed',
      startedAt: minutesAgo(26),
      durationMs: 7842,
      checks: 7,
      failed: 0,
    },
    {
      path: 'C:\\reports\\run-earlier.json',
      markdownPath: 'C:\\reports\\run-earlier.md',
      name: 'run-earlier',
      modifiedAt: minutesAgo(300),
      verdict: 'failed',
      startedAt: minutesAgo(300),
      durationMs: 11288,
      checks: 7,
      failed: 2,
    },
  ],
}

/** The report the detail page opens: a real one, with every section populated. */
const PAST_REPORT = {
  ok: true,
  path: CASE_FILE.history[0].path,
  format: 'json',
  report: {
    runId: 'run-20261115-0341-80a2a7',
    caseId: 'REG-001',
    id: 'auth-register',
    title: CASES[0].title,
    description: CASES[0].description,
    endpoint: 'POST /auth/register',
    scenario: 'normal',
    priority: 'medium',
    verdict: 'passed',
    startedAt: minutesAgo(26),
    durationMs: 7842,
    traceId: 'trace-f81e3a9c0182',
    fatal: null,
    environment: {
      target: 'record-local',
      baseUrl: 'https://127.0.0.1:8443',
      configurationName: 'RecordApplication',
      projectPath: 'E:/project/backend/Record',
      databases: { default: { registryName: 'iam', source: 'db-mcp:gaussdb' } },
    },
    teardown: {
      sql: [{ sql: "DELETE FROM codes WHERE username LIKE 'e2e%'" }],
      mocks: [],
      service: { port: 8443, stopped: true },
      errors: [],
    },
    checks: [
      { ok: true, label: 'service readiness', expected: 'a startup line in the run log', actual: 'Tomcat started on port 8443 (https)' },
      { ok: true, label: 'response.status', expected: '200', actual: '200' },
      { ok: true, label: 'response.body contains', expected: 'registered', actual: '{"code":200,"msg":"registered"}' },
      { ok: true, label: 'users has one inactive row', expected: '1 row', actual: '1 row' },
      { ok: true, label: 'codes has a valid six-digit code', expected: '6 digits', actual: '230285' },
      { ok: true, label: 'logs carry the trace id', expected: 'the request trace', actual: '18 lines correlated' },
      { ok: true, label: 'teardown released port 8443', expected: 'the port to be free', actual: 'ports: released' },
    ],
    steps: [
      { at: 0, name: 'ide.connected' },
      { at: 16, name: 'service.started' },
      { at: 3360, name: 'request.sent' },
      { at: 3447, name: 'response.received' },
      { at: 5120, name: 'database.asserted' },
      { at: 7842, name: 'teardown.finished' },
    ],
    evidence: {
      request: {
        method: 'POST',
        url: 'https://127.0.0.1:8443/auth/register',
        headers: { 'content-type': 'application/json', 'x-trace-id': 'trace-f81e3a9c0182' },
        body: { username: 'e2e-a1b2c3d4', password: '***', email: 'e2e@record.local', channel: 'WEB_E2E' },
      },
      response: {
        status: 200,
        statusText: 'OK',
        durationMs: 87,
        headers: { 'content-type': 'application/json' },
        body: '{"code":200,"msg":"registered"}',
        bodyJson: { code: 200, msg: 'registered' },
        truncated: false,
      },
      logs: {
        path: 'C:\\Users\\administor-\\.dsh\\e2e\\logs\\ij_run__RecordApplication.log',
        traceId: 'trace-f81e3a9c0182',
        traceIdPresent: true,
        asserted: false,
        totalLines: 214,
        scopedLines: 18,
        lines: [
          '08:42:15.881 [nio-8443-exec-1] INFO  c.r.RecordApplication - Started RecordApplication in 3.2 seconds',
          '08:42:15.814 [nio-8443-exec-1] INFO  c.r.a.AuthController - register attempt',
          '08:42:15.845 [nio-8443-exec-1] DEBUG c.r.s.UserService - hashing password',
          '08:42:15.860 [nio-8443-exec-1] DEBUG c.r.s.CodeService - generated code 230285',
          '08:42:15.871 [nio-8443-exec-1] INFO  c.r.s.MailService - sending activation mail',
          '08:42:15.885 [nio-8443-exec-1] WARN  c.r.s.MailService - SMTP timeout after 3000ms, retrying once',
          '08:42:15.888 [nio-8443-exec-1] INFO  c.r.s.UserService - inserted user e2e-a1b2c3d4',
          '08:42:15.889 [nio-8443-exec-1] ERROR c.r.s.MailService - giving up on the activation mail',
        ],
      },
      database: [
        {
          database: 'default',
          sql: "SELECT valid_state FROM users WHERE username = 'e2e-a1b2c3d4'",
          rows: [{ valid_state: '0' }],
          rowCount: 1,
          error: null,
        },
      ],
      snapshots: [
        {
          index: 0,
          database: 'default',
          sql: "SELECT * FROM users WHERE username = 'e2e-a1b2c3d4'",
          before: [],
          beforeCount: 0,
          after: [
            {
              username: 'e2e-a1b2c3d4',
              valid_state: '0',
              role: 'USER',
              created_at: '2026-11-15 08:42:15',
            },
          ],
          afterCount: 1,
          changed: true,
          afterError: null,
          beforeError: null,
        },
        {
          index: 1,
          database: 'default',
          sql: "SELECT * FROM codes WHERE username = 'e2e-a1b2c3d4'",
          before: [],
          beforeCount: 0,
          after: [{ code: '230285', valid: '1', expires_in: 300 }],
          afterCount: 1,
          changed: true,
          afterError: null,
          beforeError: null,
        },
      ],
      browser: {
        url: 'https://127.0.0.1:8443/sign-in',
        browser: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        viewport: { width: 1280, height: 800 },
        screenshots: [
          { name: 'loaded', fileName: 'shot-01-loaded.png', file: 'C:\\reports\\shots\\run-1\\shot-01-loaded.png', at: 1240 },
          { name: 'after click', fileName: 'shot-02-after-click.png', file: 'C:\\reports\\shots\\run-1\\shot-02-after-click.png', at: 2118 },
        ],
        console: [{ level: 'log', text: 'greeted ada' }],
      },
      setup: null,
      capture: {},
      teardownHttp: null,
      probes: [],
    },
  },
}

/* ---------- the harness ---------- */

const requested = []
globalThis.fetch = async (url) => {
  const path = String(url).split('/api')[1] || ''
  requested.push(path)
  const body = path.startsWith('/projects')
    ? PROJECTS
    : path.startsWith('/case?')
      ? CASE_FILE
      : path.startsWith('/report?')
        ? PAST_REPORT
        : BOOTSTRAP
  return { ok: true, status: 200, json: async () => body }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

async function settle(Component, props = {}) {
  let tree = null
  for (let round = 0; round < 30; round += 1) {
    pendingRender = false
    effectSlots = []
    // The root itself must be expanded inside a frame, otherwise MainPanel's
    // hooks land in the global array and its index drifts across rounds. One
    // expansion pass runs every component exactly once with a stable path key.
    tree = expand({ type: Component, props }, 'root')
    for (const { frame, slot, fn } of effectSlots) {
      const cleanup = fn()
      if (frame[slot]) frame[slot].cleanup = cleanup
    }
    await flush()
    await flush()
    if (!pendingRender) break
  }
  return tree
}

let registration = null
globalThis.window = { __ModuleLoader__: { load: (spec) => (registration = spec) } }

const requireStub = (name) => {
  if (name === 'react') return React
  throw new Error(`the bundle required ${name}, which this preview does not provide`)
}

// eslint-disable-next-line no-new-func
new Function('window', 'require', source)(globalThis.window, requireStub)

const locales = {}
let mainComponent = null
const ctx = {
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
      return () => {}
    },
  },
}

registration.factory(requireStub).apply(ctx)

/* ---------- serialise the tree ---------- */

const escapeHtml = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const STYLE_PROPS = {
  width: 'width',
  height: 'height',
  color: 'color',
  display: 'display',
  flex: 'flex',
  gap: 'gap',
  padding: 'padding',
  margin: 'margin',
  background: 'background',
  border: 'border',
  gridTemplateColumns: 'grid-template-columns',
}

function styleOf(value) {
  if (!value || typeof value !== 'object') return ''
  return Object.entries(value)
    .map(([name, raw]) => {
      const property = STYLE_PROPS[name] || name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
      return `${property}:${raw}`
    })
    .join(';')
}

function serialize(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return escapeHtml(node)
  if (Array.isArray(node)) return node.map(serialize).join('')
  // `settle()` already expanded every function component into plain elements.
  // Running one here would invoke its hooks a second time against a different
  // frame and quietly corrupt the very state the picture is meant to show.
  const tag = node.type
  const props = node.props || {}
  if (tag === 'style') return `<style>${props.children || ''}</style>`
  const attributes = []
  for (const [name, value] of Object.entries(props)) {
    if (name === 'children' || value === undefined || value === null || value === false) continue
    if (name === 'style') {
      attributes.push(`style="${escapeHtml(styleOf(value))}"`)
      continue
    }
    if (name === 'onClick') continue // no behaviour in a still picture
    if (/^on[A-Z]/.test(name)) continue
    const attribute = name === 'className' ? 'class' : name
    if (value === true) attributes.push(attribute)
    else attributes.push(`${attribute}="${escapeHtml(value)}"`)
  }
  const inner = serialize(props.children)
  const voidTags = new Set(['img', 'br', 'hr', 'input', 'meta', 'link'])
  if (voidTags.has(tag)) return `<${tag} ${attributes.join(' ')}>`
  return `<${tag}${attributes.length ? ` ${attributes.join(' ')}` : ''}>${inner}</${tag}>`
}

/* ---------- assemble ---------- */

// The theme block, lifted out of the host's own bundle, so the preview renders
// in the real palette instead of the browser's default black on white.
const themeCss = readFileSync(join(ROOT, 'dev', 'theme.css'), 'utf8')

/**
 * Renders one view to a complete document.
 *
 * `dark` toggles the attribute the host's theme service sets, which is the only
 * switch those tokens read. Both are produced because the redesign has to work
 * in both, and eyeballing only one is how a dark-only contrast bug ships.
 */
function documentFor(tree, { dark, width }) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>${themeCss}</style>
<style>
  html, body { margin: 0; height: 100%; background: var(--dsw-alias-bg-base); }
  body { font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; }
  #root { height: 100%; }
  button { font: inherit; }
</style>
</head>
<body${dark ? ' data-ds-dark-theme=""' : ''} style="width:${width}px">
<div id="root">${serialize(tree)}</div>
</body></html>`
}

function write(name, tree, options) {
  mkdirSync(OUT, { recursive: true })
  const file = join(OUT, `${name}.html`)
  writeFileSync(file, documentFor(tree, options), 'utf8')
  return file
}

/* ---------- drive it ---------- */

/**
 * Finds the first node whose class list contains `name` and whose text matches.
 *
 * `split(' ').includes(...)`, never `=== name`: every one of these carries a
 * modifier class sooner or later (`is-active`, `is-failed`), and an equality
 * check then reports "nothing here" for a page that is showing it.
 */
function findNode(tree, name, matcher) {
  const stack = [tree]
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    if (Array.isArray(node)) {
      stack.push(...node)
      continue
    }
    // `settle()` has already expanded the whole tree into plain elements, so
    // there is nothing to call here: a function node would mean a broken harness.
    if (node.props && String(node.props.className || '').split(' ').includes(name)) {
      const parts = []
      const inner = [node]
      while (inner.length) {
        const item = inner.pop()
        if (!item || typeof item !== 'object') continue
        const children = item.props ? item.props.children : null
        if (typeof children === 'string') parts.push(children)
        if (Array.isArray(children)) inner.push(...children)
        else if (children) inner.push(children)
      }
      if (!matcher.test(parts.join(' '))) console.log(`  findNode: ${name} text = ${JSON.stringify(parts.join(' ').slice(0, 80))}`)
      if (matcher.test(parts.join(' '))) return node
    }
    const children = node.props ? node.props.children : null
    if (Array.isArray(children)) stack.push(...children)
    else if (children) stack.push(children)
  }
  return null
}

const list = await settle(mainComponent)
const pages = []
pages.push({ name: 'projects', file: write('projects', list, { dark: true, width: 1440 }) })

// The project table is the landing page; the case rows live one level down.
const projectRow = findNode(list, 'e2e-project-card', /Record/)
let caseRow = null
if (projectRow && typeof projectRow.props.onClick === 'function') {
  projectRow.props.onClick()
  const inside = await settle(mainComponent)
  pages.push({ name: 'cases', file: write('cases', inside, { dark: true, width: 1440 }) })
  // The row is a container; the click lives on the open button inside it.
  caseRow = findNode(inside, 'e2e-case-open', /REG-001/)
}

if (caseRow && typeof caseRow.props.onClick === 'function') {
  caseRow.props.onClick()
  let detail = await settle(mainComponent)
  pages.push({ name: 'detail-dark', file: write('detail-dark', detail, { dark: true, width: 1440 }) })
  pages.push({ name: 'detail-light', file: write('detail-light', detail, { dark: false, width: 1440 }) })

  // The other tabs, because "the checks tab looks fine" says nothing about the
  // database diff, and the diff is the one that was two blobs of JSON.
  const tabsOf = (tree) => {
    const found = []
    const stack = [tree]
    while (stack.length) {
      const node = stack.pop()
      if (!node || typeof node !== 'object') continue
      // MainPanel returns an array at its root. serialize() and findNode()
      // handle that; a walker that forgets it silently finds nothing at all.
      if (Array.isArray(node)) {
        stack.push(...node)
        continue
      }
      if (node.props && String(node.props.className || '').split(' ').includes('e2e-mode-btn')) found.push(node)
      const children = node.props ? node.props.children : null
      if (Array.isArray(children)) stack.push(...children)
      else if (children) stack.push(children)
    }
    return found
  }
  const label = (node) => {
    const parts = []
    const stack = [node]
    while (stack.length) {
      const item = stack.pop()
      if (!item || typeof item !== 'object') continue
      if (Array.isArray(item)) {
        stack.push(...item)
        continue
      }
      const children = item.props ? item.props.children : null
      if (typeof children === 'string') parts.push(children)
      if (Array.isArray(children)) stack.push(...children)
      else if (children) stack.push(children)
    }
    return parts.join(' ')
  }

  for (const [tabName, matcher] of [
    ['database', /Database/],
    ['screenshots', /Screenshots/],
    ['console', /Console/],
  ]) {
    const candidates = tabsOf(detail)
    // `settle()` re-expands the whole tree on every round, so the buttons found
    // in the first detail tree carry stale closures. Re-read them from the tree
    // that is actually current, not from a tree captured three renders ago.
    const tab = candidates.find((node) => matcher.test(label(node)))
    if (!tab || typeof tab.props.onClick !== 'function') {
      console.log(`warn: no ${tabName} tab in the tree (${candidates.length} tab buttons)`)
      continue
    }
    tab.props.onClick()
    const shown = await settle(mainComponent)
    detail = shown
    pages.push({ name: `detail-${tabName}`, file: write(`detail-${tabName}`, shown, { dark: true, width: 1440 }) })
  }
} else {
  console.log('warn: no REG-001 row, only the project table was rendered')
}

/* ---------- photograph ---------- */

mkdirSync(OUT, { recursive: true })
const browser = findBrowser()
if (!browser) {
  console.log(`wrote ${pages.length} page(s) to ${OUT}, but there is no Chrome or Edge to photograph them`)
  process.exit(0)
}

for (const page of pages) {
  const result = await captureBrowser({
    url: pathToFileURL(page.file).href,
    steps: [{ screenshot: page.name }],
    outDir: OUT,
    viewport: { width: 1440, height: 900 },
    prefix: 'preview',
    maxScreenshots: 10,
  })
  const shot = (result.screenshots || []).find((item) => item.name === page.name)
  console.log(`  ${shot ? 'shot' : 'no shot'} ${page.name}${shot ? ` -> ${shot.fileName} (${shot.file})` : ''}`)
}

// Both HTML and PNG stay. The HTML is the thing you re-open when a picture is
// not enough; neither belongs in the repository (see .gitignore).
console.log(`pages: ${pages.map((page) => page.name).join(', ')}`)
console.log(`out:   ${OUT}`)
