/**
 * Unit tests for the parts of dsh-e2e that need no service, no IDE and no
 * database: case parsing, the environment guard, the assertion engine, and the
 * report renderer.
 *
 *   node dev/unit.test.mjs
 *
 * These are the tests that would have caught the three bugs found on the first
 * real run: a wrong variable name surviving a refactor, a generator not being
 * expanded, and a field meaning two different things.
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, rm, readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadCaseFile, buildVariables, interpolateString, interpolate, CaseError, endpointPrefix, withCaseId } from '../src/case.js'
import { checkTargets, isWriteStatement, stripComments, redact } from '../src/guard.js'
import { assertResponse, assertDatabase, assertLogs, readPath, compare } from '../src/assert.js'
import { renderMarkdown, renderSummary } from '../src/report.js'
import { isReadOnly } from '../src/db.js'
import { listCasesIn, nextCaseId, resolveCasePath, StoreError } from '../src/store.js'
import { caseStatus, describeSteps, hasAssertions, summariseStatuses } from '../src/plan.js'
import { loadRegistry, resolveDatabase, describeDatabase, RegistryError } from '../src/registry.js'
import { parseYaml, parserCandidates } from '../src/yaml.js'
import { createPanel, PanelError } from '../src/panel.js'

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

async function testAsync(name, fn) {
  try {
    await fn()
    passed += 1
    process.stdout.write(`  ok   ${name}\n`)
  } catch (error) {
    failed += 1
    failures.push({ name, error })
    process.stdout.write(`  FAIL ${name}\n         ${error.message}\n`)
  }
}

function section(title) {
  process.stdout.write(`\n${title}\n`)
}

// ---------------------------------------------------------------- guard

section('guard')

// The guard reads the *resolved* environment: a case only names a database, so
// the host that actually gets dialled is knowable only after the registry
// lookup. These fixtures therefore hand it a resolved object, not raw YAML.
function resolvedFixture({ baseUrl = 'http://127.0.0.1:8080', databases = {} } = {}) {
  return { target: { baseUrl }, databases }
}

function dbFixture({ host = '127.0.0.1', database = 'iam_db' } = {}) {
  return { host, database, source: 'registry', kind: 'postgresql' }
}

await testAsync('loopback and private hosts are accepted', async () => {
  for (const baseUrl of ['http://localhost:8080', 'https://127.0.0.1:8443', 'http://192.168.1.5:9000', 'http://10.0.0.1']) {
    const problems = await checkTargets({ env: {} }, resolvedFixture({ baseUrl }))
    assert.equal(problems.length, 0, `${baseUrl} should be allowed, got: ${problems.join('; ')}`)
  }
})

await testAsync('a public host is refused without allowRemote', async () => {
  const problems = await checkTargets({ env: {} }, resolvedFixture({ baseUrl: 'https://example.com' }))
  assert.equal(problems.length, 1)
  assert.match(problems[0], /not loopback or a private address/)
})

await testAsync('a public host is still refused when it looks like production', async () => {
  const problems = await checkTargets({ env: {} }, resolvedFixture({ baseUrl: 'https://api.example.com/prod' }), {
    allowRemote: true,
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /production/)
})

await testAsync('a production-looking database is refused even when remote is allowed', async () => {
  const problems = await checkTargets(
    { env: {} },
    resolvedFixture({ databases: { main: dbFixture({ database: 'production_db' }) } }),
    { allowRemote: true },
  )
  assert.equal(problems.length, 1)
  assert.match(problems[0], /production database/)
})

await testAsync('a case with no base URL is refused with an actionable message', async () => {
  const problems = await checkTargets({ env: {} }, { target: { baseUrl: null }, databases: {} })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /no base URL/)
})

await testAsync('write statements are refused unless allowWrites is set', async () => {
  const definition = {
    env: {},
    setup: { sql: ['DELETE FROM users'] },
    teardown: { sql: [] },
  }
  const resolved = resolvedFixture({ databases: { default: dbFixture() } })
  assert.equal((await checkTargets(definition, resolved)).length, 1)
  assert.equal((await checkTargets(definition, resolved, { allowWrites: true })).length, 0)
})

await testAsync('a read-only setup needs no write permission', async () => {
  const definition = {
    env: {},
    setup: { sql: ['SELECT 1'] },
    teardown: { sql: [] },
  }
  assert.equal((await checkTargets(definition, resolvedFixture({ databases: { default: dbFixture() } }))).length, 0)
})

await testAsync('a write hidden in a sqlFile is caught', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-e2e-guard-'))
  const file = join(dir, 'fixture.sql')
  await writeFile(file, '-- reset\nDELETE FROM users;\n', 'utf8')
  const definition = {
    env: {},
    setup: { sql: [], sqlFiles: [file] },
    teardown: { sql: [] },
  }
  const resolved = resolvedFixture({ databases: { default: dbFixture() } })
  const problems = await checkTargets(definition, resolved)
  assert.equal(problems.length, 1, `expected the file write to be caught, got: ${JSON.stringify(problems)}`)
  assert.match(problems[0], /writes are disabled/)
  assert.equal((await checkTargets(definition, resolved, { allowWrites: true })).length, 0)
  await rm(dir, { recursive: true, force: true })
})

await testAsync('a read-only sqlFile passes the guard', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-e2e-guard-'))
  const file = join(dir, 'fixture.sql')
  await writeFile(file, 'SELECT 1;\n', 'utf8')
  const definition = {
    env: {},
    setup: { sql: [], sqlFiles: [file] },
    teardown: { sql: [] },
  }
  assert.equal((await checkTargets(definition, resolvedFixture({ databases: { default: dbFixture() } }))).length, 0)
  await rm(dir, { recursive: true, force: true })
})

await testAsync('an unreadable sqlFile does not crash the guard', async () => {
  const definition = {
    env: {},
    setup: { sql: [], sqlFiles: [join(tmpdir(), 'definitely-does-not-exist-12345.sql')] },
    teardown: { sql: [] },
  }
  assert.deepEqual(await checkTargets(definition, resolvedFixture({ databases: { default: dbFixture() } })), [])
})

await testAsync('a partial definition does not crash the guard', async () => {
  // The guard runs on a loaded case, but a caller may hand it a fixture. It must
  // report problems, not throw.
  assert.deepEqual(await checkTargets({ env: {} }, resolvedFixture()), [])
})

await testAsync('SQL without a named database is reported rather than silently dropped', async () => {
  const definition = { env: {}, setup: { sql: ['DELETE FROM users'] }, teardown: { sql: [] } }
  const problems = await checkTargets(definition, resolvedFixture({ databases: {} }))
  assert.equal(problems.length, 1)
  assert.match(problems[0], /names no database/)
})

test('write detection covers every mutating verb', () => {
  for (const verb of ['insert', 'update', 'delete', 'merge', 'truncate', 'drop', 'alter', 'create', 'replace', 'upsert']) {
    assert.equal(isWriteStatement(`${verb} into t values (1)`), true, verb)
    assert.equal(isWriteStatement(`  ${verb.toUpperCase()}  t`), true, verb)
  }
  for (const read of ['select * from t', 'with x as (select 1) select * from x', 'show tables', 'explain select 1']) {
    assert.equal(isWriteStatement(read), false, read)
  }
})

test('stripComments keeps the statement text', () => {
  assert.equal(stripComments('-- hello\nSELECT 1').trim(), 'SELECT 1')
  assert.equal(stripComments('/* x */ SELECT 1').trim(), 'SELECT 1')
})

test('redaction hides secrets and tokens', () => {
  const out = redact(
    { password: 'hunter2', note: 'token=abc123', phone: '13800138000' },
    { secrets: ['hunter2'] },
  )
  const text = JSON.stringify(out)
  assert.equal(text.includes('hunter2'), false)
  assert.equal(text.includes('abc123'), false)
  assert.equal(text.includes('13800138000'), false)
})

// ---------------------------------------------------------------- assert

section('assert')

test('readPath walks objects and arrays', () => {
  const value = { a: { b: [{ c: 42 }] }, list: [1, 2] }
  assert.equal(readPath(value, 'a.b[0].c'), 42)
  assert.equal(readPath(value, 'list[1]'), 2)
  assert.equal(readPath(value, 'missing.path'), undefined)
  assert.equal(readPath(value, '[0]'), undefined)
})

test('compare handles every operator', () => {
  assert.equal(compare(5, { equals: 5 }).ok, true)
  assert.equal(compare(5, { notEquals: 6 }).ok, true)
  assert.equal(compare('hello world', { contains: 'world' }).ok, true)
  assert.equal(compare(['a', 'b'], { contains: 'b' }).ok, true)
  assert.equal(compare('abc123', { matches: '^[a-z]+\\d+$' }).ok, true)
  assert.equal(compare('x', { exists: true }).ok, true)
  assert.equal(compare(null, { exists: false }).ok, true)
  assert.equal(compare([], { type: 'array' }).ok, true)
  assert.equal(compare(10, { greaterThan: 5 }).ok, true)
  assert.equal(compare(3, { lessThan: 5 }).ok, true)
  assert.equal(compare('b', { in: ['a', 'b'] }).ok, true)
})

test('compare rejects an unknown spec', () => {
  const outcome = compare(1, { nonsense: 1 })
  assert.equal(outcome.ok, false)
  assert.match(outcome.detail, /give one of/)
})

test('a bad regex fails the check instead of throwing', () => {
  const outcome = compare('x', { matches: '[' })
  assert.equal(outcome.ok, false)
  assert.match(outcome.detail, /invalid regular expression/)
})

test('assertResponse checks status, body and json paths', () => {
  const response = { status: 200, bodyText: '{"code":0,"data":{"role":"USER"}}', bodyJson: { code: 0, data: { role: 'USER' } }, durationMs: 12 }
  const checks = assertResponse(
    { status: 200, statusIn: null, json: [{ path: 'data.role', equals: 'USER' }], schema: null, bodyContains: 'code', bodyNotContains: 'error', maxDurationMs: 100 },
    response,
  )
  assert.equal(checks.every((c) => c.ok), true, JSON.stringify(checks))
})

test('assertResponse reports a status mismatch', () => {
  const checks = assertResponse({ status: 200, statusIn: null, json: [], schema: null, bodyContains: null, bodyNotContains: null, maxDurationMs: null }, { status: 500, bodyText: '', bodyJson: null, durationMs: 1 })
  assert.equal(checks.length, 1)
  assert.equal(checks[0].ok, false)
})

test('assertDatabase checks row counts and per-row values', () => {
  const checks = assertDatabase(
    { description: 'user', rowCount: 1, rowCountAtLeast: null, notEmpty: false, empty: false, equals: null, rows: [{ path: '[0].valid_state', equals: '0' }] },
    [{ valid_state: '0' }],
    null,
  )
  assert.equal(checks.every((c) => c.ok), true, JSON.stringify(checks))
})

test('assertDatabase reports a per-row mismatch', () => {
  const checks = assertDatabase(
    { description: 'user', rowCount: 1, rowCountAtLeast: null, notEmpty: false, empty: false, equals: null, rows: [{ path: '[0].valid_state', equals: '1' }] },
    [{ valid_state: '0' }],
    null,
  )
  const bad = checks.filter((c) => !c.ok)
  assert.equal(bad.length, 1)
  assert.equal(bad[0].actual, '0')
})

test('assertDatabase surfaces a query error', () => {
  const checks = assertDatabase({ description: 'x', rowCount: null, rowCountAtLeast: null, notEmpty: false, empty: false, equals: null, rows: [] }, [], 'relation does not exist')
  assert.equal(checks.length, 1)
  assert.equal(checks[0].ok, false)
  assert.match(checks[0].actual, /relation does not exist/)
})

test('assertLogs checks must/must-not/regex', () => {
  const lines = ['INFO register called', 'ERROR something']
  const checks = assertLogs({ mustContain: ['register'], mustNotContain: ['OutOfMemory'], regex: ['ERROR \\w+'] }, lines, 'abc')
  assert.equal(checks.every((c) => c.ok), true, JSON.stringify(checks))
})

test('assertLogs fails a missing needle', () => {
  const checks = assertLogs({ mustContain: ['absent'], mustNotContain: [], regex: [] }, ['nothing here'], null)
  assert.equal(checks[0].ok, false)
})

test('isReadOnly accepts only read statements', () => {
  for (const sql of ['select 1', 'WITH x AS (SELECT 1) SELECT * FROM x', 'show search_path', 'explain select 1', 'values (1)']) {
    assert.equal(isReadOnly(sql), true, sql)
  }
  for (const sql of ['insert into t values (1)', 'delete from t', 'update t set a=1', 'drop table t']) {
    assert.equal(isReadOnly(sql), false, sql)
  }
})

// ---------------------------------------------------------------- case

section('case')

const MINIMAL = `
id: sample
env:
  baseUrl: http://127.0.0.1:8080
  projectPath: /tmp/project
  configurationName: App
request:
  path: /ping
expect:
  response:
    status: 200
`

let tmpDir

await testAsync('a minimal case loads', async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'dsh-e2e-test-'))
  const file = join(tmpDir, 'minimal.yaml')
  await writeFile(file, MINIMAL, 'utf8')
  const loaded = await loadCaseFile(file)
  assert.equal(loaded.definition.id, 'sample')
  assert.equal(loaded.definition.request.method, 'GET')
  assert.equal(loaded.definition.expect.response.status, 200)
  assert.equal(loaded.definition.env.serviceRequired, true)
  assert.deepEqual(loaded.definition.setup.capture, [])
})

await testAsync('an unknown top-level field is an error', async () => {
  const file = join(tmpDir, 'typo.yaml')
  await writeFile(file, MINIMAL + '\nunknownField: 1\n', 'utf8')
  await assert.rejects(() => loadCaseFile(file), (error) => {
    assert.ok(error instanceof CaseError)
    assert.match(error.message, /unknown top-level field/)
    return true
  })
})

await testAsync('an unknown env field is an error', async () => {
  const file = join(tmpDir, 'enptypo.yaml')
  await writeFile(file, MINIMAL.replace('configurationName: App', 'configurationName: App\n  databse: nope'), 'utf8')
  await assert.rejects(() => loadCaseFile(file), /unknown env field/)
})

await testAsync('a case without a request is an error', async () => {
  const file = join(tmpDir, 'norequest.yaml')
  await writeFile(file, 'id: x\nenv:\n  baseUrl: http://127.0.0.1:1\n  projectPath: p\n  configurationName: c\nexpect:\n  response:\n    status: 200\n', 'utf8')
  await assert.rejects(() => loadCaseFile(file), /request/)
})

await testAsync('a single env.database becomes the default entry', async () => {
  const file = join(tmpDir, 'singledb.yaml')
  await writeFile(file, MINIMAL.replace('configurationName: App', 'configurationName: App\n  database:\n    name: iam\n    schema: public'), 'utf8')
  const loaded = await loadCaseFile(file)
  assert.deepEqual(Object.keys(loaded.definition.env.databases), ['default'])
  assert.equal(loaded.definition.env.databases.default.name, 'iam')
  assert.equal(loaded.definition.env.databases.default.schema, 'public')
  assert.equal(loaded.definition.env.databases.default.alias, 'default')
})

await testAsync('a database reference written as a bare string is accepted', async () => {
  const file = join(tmpDir, 'stringdb.yaml')
  await writeFile(file, MINIMAL.replace('configurationName: App', 'configurationName: App\n  databases:\n    main: iam'), 'utf8')
  const loaded = await loadCaseFile(file)
  assert.equal(loaded.definition.env.databases.main.name, 'iam')
  assert.equal(loaded.definition.env.databases.main.schema, null)
})

await testAsync('a database reference with a schema override keeps it', async () => {
  const file = join(tmpDir, 'schemadb.yaml')
  await writeFile(
    file,
    MINIMAL.replace('configurationName: App', 'configurationName: App\n  databases:\n    main:\n      name: iam\n      schema: reporting'),
    'utf8',
  )
  const loaded = await loadCaseFile(file)
  assert.equal(loaded.definition.env.databases.main.schema, 'reporting')
})

await testAsync('a case that carries connection details is rejected', async () => {
  // The whole point of the registry: a case names a database, it does not
  // connect to one. Catching this here keeps credentials out of the YAML a
  // person pastes into a ticket.
  for (const leak of ['host: 127.0.0.1', 'password: hunter2', 'kind: postgresql', 'port: 5432']) {
    const file = join(tmpDir, `leak-${leak.split(':')[0]}.yaml`)
    await writeFile(file, MINIMAL.replace('configurationName: App', `configurationName: App\n  database:\n    name: iam\n    ${leak}`), 'utf8')
    await assert.rejects(() => loadCaseFile(file), /must not carry connection details/, leak)
  }
})

await testAsync('a case with no caseId gets a derived one and says so', async () => {
  const file = join(tmpDir, 'derived.yaml')
  await writeFile(file, MINIMAL, 'utf8')
  const loaded = await loadCaseFile(file)
  assert.equal(loaded.definition.caseIdDerived, true)
  // Derived from the endpoint, so it is stable while the title is reworded.
  assert.equal(loaded.definition.endpoint, 'GET /ping')
  assert.equal(loaded.definition.caseId, 'PING-sample')
})

await testAsync('a case with an authored caseId keeps it', async () => {
  const file = join(tmpDir, 'authored.yaml')
  await writeFile(file, MINIMAL.replace('id: sample\n', 'id: sample\ncaseId: REG-002\n'), 'utf8')
  const loaded = await loadCaseFile(file)
  assert.equal(loaded.definition.caseId, 'REG-002')
  assert.equal(loaded.definition.caseIdDerived, false)
})

await testAsync('endpoint, scenario and priority default sensibly and reject nonsense', async () => {
  const file = join(tmpDir, 'fields.yaml')
  await writeFile(file, MINIMAL, 'utf8')
  const loaded = await loadCaseFile(file)
  // Derived from the request, which is what actually gets sent.
  assert.equal(loaded.definition.endpoint, 'GET /ping')
  assert.equal(loaded.definition.scenario, 'normal')
  assert.equal(loaded.definition.priority, 'medium')

  for (const [field, bad, needle] of [
    ['scenario', 'happy', /scenario must be one of normal, error/],
    ['priority', 'urgent', /priority must be one of high, medium, low/],
    ['endpoint', '/ping', /must start with an HTTP method/],
    ['endpoint', 'FETCH /ping', /not an HTTP method/],
  ]) {
    const broken = join(tmpDir, `bad-${field}-${bad.replace(/\W/g, '')}.yaml`)
    await writeFile(broken, MINIMAL.replace('id: sample\n', `id: sample\n${field}: "${bad}"\n`), 'utf8')
    await assert.rejects(() => loadCaseFile(broken), needle, `${field}: ${bad}`)
  }
})

await testAsync('an explicit endpoint groups a path with a variable', async () => {
  const file = join(tmpDir, 'explicit-endpoint.yaml')
  await writeFile(file, MINIMAL.replace('id: sample\n', 'id: sample\nendpoint: GET /users/{id}\n'), 'utf8')
  const loaded = await loadCaseFile(file)
  assert.equal(loaded.definition.endpoint, 'GET /users/{id}')
})

await testAsync('endpointPrefix reads like an abbreviation', async () => {
  assert.equal(endpointPrefix('POST /auth/register'), 'REG')
  assert.equal(endpointPrefix('GET /auth/resendActiveCode'), 'RAC')
  assert.equal(endpointPrefix('GET /test'), 'TEST')
  assert.equal(endpointPrefix('DELETE /users/{id}'), 'USER')
  assert.equal(endpointPrefix('GET /'), 'CASE')
  assert.equal(endpointPrefix(null), 'CASE')
})

await testAsync('withCaseId inserts one line and leaves every comment alone', async () => {
  // Re-dumping the document would throw away the comments, and the comments are
  // where the author wrote down what the case proves.
  const text = '# why this case exists\nid: probe\n# a note about the title\ntitle: probe\n'
  const out = withCaseId(text, 'HEA-001')
  assert.equal(out, '# why this case exists\nid: probe\ncaseId: HEA-001\n# a note about the title\ntitle: probe\n')
  // Idempotent: a second call must not add a second line.
  assert.equal(withCaseId(out, 'HEA-999'), out)
  // No id to anchor to: the line goes after the leading comment block, not above it.
  assert.equal(withCaseId('# header\n\ntitle: x\n', 'C-1'), '# header\n\ncaseId: C-1\ntitle: x\n')
})

await testAsync('cases group by endpoint with scenario counts', async () => {
  const dir = join(tmpDir, 'grouped')
  await mkdir(dir, { recursive: true })
  const mk = (name, extra) => writeFile(join(dir, name), MINIMAL.replace('id: sample\n', `id: ${name.replace('.yaml', '')}\n${extra}`), 'utf8')
  await mk('a.yaml', 'caseId: HEA-001\nendpoint: GET /health\nscenario: normal\npriority: high\n')
  await mk('b.yaml', 'caseId: HEA-002\nendpoint: GET /health\nscenario: error\n')
  await mk('c.yaml', 'caseId: REG-001\nendpoint: POST /auth/register\n')
  const listed = await listCasesIn(dir)
  assert.equal(listed.groups.length, 2)
  const health = listed.groups.find((group) => group.endpoint === 'GET /health')
  assert.equal(health.counts.total, 2)
  assert.equal(health.counts.normal, 1)
  assert.equal(health.counts.error, 1)
  // Priority first inside a group, so an urgent case is at the top.
  assert.equal(health.cases[0].caseId, 'HEA-001')
})

await testAsync('setup.capture is normalised', async () => {
  const file = join(tmpDir, 'capture.yaml')
  await writeFile(
    file,
    MINIMAL.replace('expect:', 'setup:\n  capture:\n    - name: code.value\n      sql: SELECT code FROM codes\n      column: code\nexpect:'),
    'utf8',
  )
  const loaded = await loadCaseFile(file)
  assert.equal(loaded.definition.setup.capture.length, 1)
  assert.equal(loaded.definition.setup.capture[0].name, 'code.value')
  assert.equal(loaded.definition.setup.capture[0].database, 'default')
  assert.equal(loaded.definition.setup.capture[0].required, true)
})

await testAsync('setup.capture without a name is an error', async () => {
  const file = join(tmpDir, 'badcapture.yaml')
  await writeFile(file, MINIMAL.replace('expect:', 'setup:\n  capture:\n    - sql: SELECT 1\nexpect:'), 'utf8')
  await assert.rejects(() => loadCaseFile(file), /needs a "name"/)
})

// ---------------------------------------------------------------- variables

section('variables')

await testAsync('generators expand inside declared variables', async () => {
  const definition = {
    id: 'sample',
    title: 't',
    request: { variables: { 'user.name': 'e2e${random.hex}' } },
  }
  const variables = buildVariables(definition, {})
  assert.match(variables['user.name'], /^e2e[0-9a-f]{16}$/)
})

await testAsync('two runs produce different generated values', async () => {
  const definition = { id: 's', title: 't', request: { variables: { 'user.name': 'e2e${random.hex}' } } }
  const first = buildVariables(definition, {})['user.name']
  const second = buildVariables(definition, {})['user.name']
  assert.notEqual(first, second)
})

await testAsync('a later variable may reference an earlier one', async () => {
  const definition = {
    id: 's',
    title: 't',
    request: { variables: { 'user.name': 'u${random.hex}', 'user.email': '${user.name}@example.test' } },
  }
  const variables = buildVariables(definition, {})
  assert.equal(variables['user.email'], `${variables['user.name']}@example.test`)
})

test('extra variables win over declared ones', () => {
  const definition = { id: 's', title: 't', request: { variables: { 'run.id': 'declared' } } }
  assert.equal(buildVariables(definition, { 'run.id': 'actual' })['run.id'], 'actual')
})

test('an unknown variable stays literal rather than vanishing', () => {
  assert.equal(interpolateString('a ${nope} b', {}), 'a ${nope} b')
})

test('the missing callback fires for an unknown variable', () => {
  const seen = []
  interpolateString('${nope}', {}, { missing: (key) => seen.push(key) })
  assert.deepEqual(seen, ['nope'])
})

test('interpolate walks nested structures and leaves numbers alone', () => {
  const out = interpolate({ a: '${x}', b: [1, '${x}'], c: 42 }, { x: 'v' })
  assert.deepEqual(out, { a: 'v', b: [1, 'v'], c: 42 })
})

// ---------------------------------------------------------------- report

section('report')

function sampleReport(overrides = {}) {
  return {
    runId: 'run-1',
    caseId: 'sample',
    title: 'Sample case',
    description: '',
    tags: [],
    verdict: 'failed',
    startedAt: new Date(0).toISOString(),
    durationMs: 100,
    fatal: null,
    steps: [{ name: 'response.received', at: 10, status: 500, durationMs: 5 }],
    checks: [{ ok: false, label: 'response.status', expected: 200, actual: 500, detail: '' }],
    failedChecks: [{ ok: false, label: 'response.status', expected: 200, actual: 500, detail: '' }],
    warnings: [],
    evidence: { request: null, response: null, logs: null, database: [], setup: null, capture: null, teardownHttp: null, probes: [] },
    teardown: { sql: [], http: [], mocks: null, service: null, errors: [] },
    traceId: 'abc',
    source: '/tmp/x.yaml',
    environment: { baseUrl: 'http://127.0.0.1:8080', configurationName: 'App', projectPath: '/tmp/p', profile: null, databases: {} },
    ...overrides,
  }
}

test('markdown puts the verdict and the failing check first', () => {
  const text = renderMarkdown(sampleReport())
  assert.match(text, /# FAIL sample/)
  assert.ok(text.indexOf('## Checks') < text.indexOf('## Timeline'), 'checks must precede the timeline')
  assert.match(text, /Why it failed/)
})

test('markdown shows warnings when the log scope degraded', () => {
  const text = renderMarkdown(sampleReport({ warnings: ['no log line carried the trace id'] }))
  assert.match(text, /## Warnings/)
  assert.match(text, /no log line carried the trace id/)
})

test('markdown renders captured values', () => {
  const report = sampleReport({ verdict: 'passed', failedChecks: [], checks: [], warnings: [] })
  report.evidence.capture = [{ name: 'code.value', value: '123456', column: 'code', rows: 1 }]
  const text = renderMarkdown(report)
  assert.match(text, /## Captured values/)
  assert.match(text, /code\.value/)
  assert.match(text, /123456/)
})

test('markdown escapes pipes so a table stays a table', () => {
  const report = sampleReport({ failedChecks: [{ ok: false, label: 'a|b', expected: 'x|y', actual: 'z|w', detail: '' }] })
  report.checks = report.failedChecks
  const text = renderMarkdown(report)
  assert.match(text, /a\\\|b/)
})

test('markdown shows what the database looked like before and after', () => {
  const report = sampleReport({ verdict: 'passed', failedChecks: [], checks: [], warnings: [] })
  report.evidence.snapshots = [
    {
      index: 0,
      database: 'iam',
      sql: 'SELECT * FROM users WHERE username = ?',
      before: [],
      beforeCount: 0,
      after: [{ username: 'e2e1', valid_state: 0 }],
      afterCount: 1,
      changed: true,
    },
  ]
  const text = renderMarkdown(report)
  assert.match(text, /## Database before and after/)
  assert.match(text, /iam — changed \(0 → 1 rows\)/)
  // Both halves have to be there: the "after" alone is what the assertion
  // already said, and the whole point of the section is the comparison.
  assert.match(text, /\*\*before\*\*/)
  assert.match(text, /\*\*after\*\*/)
  assert.match(text, /e2e1/)
})

test('markdown says when the console was kept but not asserted on', () => {
  const report = sampleReport({ verdict: 'passed', failedChecks: [], checks: [], warnings: [] })
  report.evidence.logs = {
    path: '/tmp/run.log',
    traceId: 'abc',
    traceIdPresent: true,
    asserted: false,
    totalLines: 42,
    scopedLines: 3,
    lines: ['INFO started'],
  }
  const text = renderMarkdown(report)
  assert.match(text, /## Logs/)
  // "Here is the console" and "the run checked the console" are different
  // claims. The report is what gets pasted into a bug report, so it has to make
  // the weaker one when that is the one that is true.
  assert.match(text, /kept for evidence, not asserted on/)
  assert.match(text, /INFO started/)
})

test('a report whose console was asserted on does not apologize for it', () => {
  const report = sampleReport({ verdict: 'passed', failedChecks: [], checks: [], warnings: [] })
  report.evidence.logs = {
    path: '/tmp/run.log',
    traceId: 'abc',
    traceIdPresent: true,
    asserted: true,
    totalLines: 42,
    scopedLines: 3,
    lines: ['INFO started'],
  }
  const text = renderMarkdown(report)
  assert.doesNotMatch(text, /not asserted on/)
})

test('a snapshot that never got an "after" is left out rather than shown empty', () => {
  const report = sampleReport({ verdict: 'failed', failedChecks: [], checks: [], warnings: [] })
  report.evidence.snapshots = [{ index: 0, database: 'iam', sql: 'SELECT 1', before: [], beforeCount: 0 }]
  const text = renderMarkdown(report)
  assert.ok(!/## Database before and after/.test(text), 'a half snapshot is not a comparison')
})

test('markdown says so when nothing changed', () => {
  const report = sampleReport({ verdict: 'passed', failedChecks: [], checks: [], warnings: [] })
  report.evidence.snapshots = [
    {
      index: 0,
      database: 'iam',
      sql: 'SELECT 1 FROM users',
      before: [{ n: 1 }],
      beforeCount: 1,
      after: [{ n: 1 }],
      afterCount: 1,
      changed: false,
    },
  ]
  const text = renderMarkdown(report)
  // A case that passes without changing anything is not testing what its author
  // thinks it is. The report has to be able to say that out loud.
  assert.match(text, /iam — no change \(1 → 1 rows\)/)
})

test('summary is a short line, not the whole report', () => {
  const summary = renderSummary(sampleReport(), { reportPath: '/tmp/r.md' })
  assert.match(summary, /FAIL/)
  assert.match(summary, /sample/)
  assert.ok(summary.length < 600, `summary was ${summary.length} chars`)
})

test('every section is preceded by a blank line', () => {
  // Markdown needs a blank line before a heading, or the heading is swallowed by
  // the table above it. This was a real bug: `## Setup requests` rendered as a
  // table row.
  const report = sampleReport({ verdict: 'passed', failedChecks: [], warnings: [] })
  report.checks = [{ ok: true, label: 'a', expected: 1, actual: 1, detail: '' }]
  report.evidence.setup = [{ method: 'POST', url: 'http://x/y', status: 200, error: null }]
  report.evidence.capture = [{ name: 'v', value: '1', column: 'c', rows: 1 }]
  report.evidence.request = { method: 'GET', url: 'http://x/z', headers: {}, body: null }
  report.evidence.response = { status: 200, statusText: 'OK', durationMs: 1, body: 'ok' }
  report.evidence.logs = { path: '/tmp/x.log', totalLines: 1, scopedLines: 1, traceId: 't', traceIdPresent: true, lines: ['a'] }
  report.evidence.database = [{ database: 'default', sql: 'SELECT 1', rows: [{ a: 1 }], rowCount: 1, error: null }]
  report.teardown = { sql: [], http: [], service: { port: 1, stopped: true, kept: false, pid: null }, errors: [] }

  const text = renderMarkdown(report)
  const lines = text.split('\n')
  const headings = lines.map((line, index) => ({ line, index })).filter((entry) => entry.line.startsWith('## '))
  assert.ok(headings.length >= 8, `expected several sections, got ${headings.length}`)
  for (const heading of headings) {
    assert.equal(lines[heading.index - 1].trim(), '', `"${heading.line}" is not preceded by a blank line`)
  }
})

// ---------------------------------------------------------------- store

section('store')

const CASE_OK = `id: probe
title: probe
env:
  target: local
  databases:
    default: { name: iam, schema: public }
request:
  method: GET
  path: /health
expect:
  response:
    status: 200
`

await testAsync('the registry file is not reported as a broken case', async () => {
  // The registry is looked up in the case directory first, so it usually sits
  // right beside the cases. It parses as YAML but is not a case, and counting it
  // as a failure would put a permanent red mark on a healthy folder.
  const dir = join(tmpDir, 'with-registry')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'probe.yaml'), CASE_OK, 'utf8')
  await writeFile(join(dir, 'e2e.registry.yml'), 'targets:\n  local:\n    baseUrl: http://x\n', 'utf8')
  const listed = await listCasesIn(dir)
  assert.equal(listed.cases.length, 1)
  assert.deepEqual(listed.failures, [])
})

await testAsync('a genuinely broken case is still reported', async () => {
  // The filter above must not become a way to hide real breakage.
  const dir = join(tmpDir, 'with-broken')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'probe.yaml'), CASE_OK, 'utf8')
  await writeFile(join(dir, 'broken.yaml'), 'id: broken\nnotAField: 1\n', 'utf8')
  const listed = await listCasesIn(dir)
  assert.equal(listed.cases.length, 1)
  assert.equal(listed.failures.length, 1)
  assert.equal(listed.failures[0].file, 'broken.yaml')
})

await testAsync('a path outside every root is refused', async () => {
  // The panel writes what a browser sends it, so this check is the difference
  // between a case editor and an arbitrary-file writer.
  const root = join(tmpDir, 'root-a')
  await mkdir(root, { recursive: true })
  await assert.rejects(
    () => resolveCasePath(join(tmpDir, 'elsewhere.yaml'), [root], { allowMissing: true }),
    (error) => error instanceof StoreError && /not a case inside/.test(error.message),
  )
})

await testAsync('a new case inside the root is created on demand', async () => {
  const root = join(tmpDir, 'root-b')
  await mkdir(root, { recursive: true })
  const created = await resolveCasePath('nested/new.yaml', [root], { allowMissing: true })
  assert.equal(created, join(root, 'nested', 'new.yaml'))
  const stat = await import('node:fs/promises').then((m) => m.stat(join(root, 'nested')))
  assert.ok(stat.isDirectory())
})

// ---------------------------------------------------------------- panel save

section('panel save')

const PANEL_ROOT = join(tmpDir, 'panel-cases')
await mkdir(PANEL_ROOT, { recursive: true })
const panel = createPanel({
  ctx: { get: () => undefined },
  config: { caseDir: PANEL_ROOT },
  state: { dataDir: join(tmpDir, 'panel-data') },
})

await testAsync('saving a good case writes it and leaves no temp file behind', async () => {
  const path = join(PANEL_ROOT, 'saved.yaml')
  const result = await panel.saveCase(path, CASE_OK)
  assert.equal(result.file, 'saved.yaml')
  // A case with no caseId gets one on save, inserted as a line — so the file is the
  // text that was sent plus that one line, not a re-dump of the parsed document.
  assert.equal(result.assigned, 'HEA-001')
  assert.equal(result.caseId, 'HEA-001')
  assert.equal(await readFile(path, 'utf8'), result.yaml)
  assert.ok(result.yaml.startsWith('id: probe\ncaseId: HEA-001\ntitle: probe\n'), result.yaml)
  assert.equal(result.yaml.replace('caseId: HEA-001\n', ''), CASE_OK, 'the save changed more than the caseId line')
  const leftovers = (await readdir(PANEL_ROOT)).filter((name) => name.includes('.tmp-'))
  assert.deepEqual(leftovers, [], 'a temp file survived a successful save')
})

await testAsync('saving again does not renumber or duplicate the caseId', async () => {
  // The editor sends back whatever it displayed, which already has the assigned id.
  // A second save must be a no-op on that line, not HEA-002 or two caseId lines.
  const path = join(PANEL_ROOT, 'saved.yaml')
  const once = await readFile(path, 'utf8')
  const result = await panel.saveCase(path, once)
  assert.equal(result.assigned, null)
  assert.equal(result.caseId, 'HEA-001')
  assert.equal(await readFile(path, 'utf8'), once)
  assert.equal((once.match(/^caseId:/gm) || []).length, 1)
})

await testAsync('a case that already has a caseId keeps it', async () => {
  const path = join(PANEL_ROOT, 'kept.yaml')
  const text = CASE_OK.replace('id: probe\n', 'id: probe\ncaseId: MY-007\n')
  const result = await panel.saveCase(path, text)
  assert.equal(result.assigned, null)
  assert.equal(result.caseId, 'MY-007')
  assert.equal(await readFile(path, 'utf8'), text)
})

await testAsync('a caseId already used by another file is refused', async () => {
  // Two files with the same id make every report ambiguous: a failure list can no
  // longer say which file failed.
  const path = join(PANEL_ROOT, 'clash.yaml')
  await assert.rejects(
    () => panel.saveCase(path, CASE_OK.replace('id: probe\n', 'id: probe\ncaseId: HEA-001\n')),
    (error) => error instanceof PanelError && error.status === 422 && /already used by saved\.yaml/.test(error.message),
  )
  assert.equal(existsSync(path), false, 'the refused case was written anyway')
})

await testAsync('the next number is one past the highest, not a count of files', async () => {
  // Deleting REG-002 must not make the next case REG-002 again: reports and tickets
  // that quote the old number would then point at a different case.
  const dir = join(PANEL_ROOT, 'numbering')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'a.yaml'), CASE_OK.replace('id: probe\n', 'id: a\ncaseId: HEA-001\n'), 'utf8')
  await writeFile(join(dir, 'b.yaml'), CASE_OK.replace('id: probe\n', 'id: b\ncaseId: HEA-004\n'), 'utf8')
  assert.equal(await nextCaseId(dir, 'GET /health'), 'HEA-005')
  assert.equal(await nextCaseId(dir, 'POST /auth/register'), 'REG-001')
})

await testAsync('a broken case is refused and the file on disk is untouched', async () => {
  // The whole point of validating through a temp file: the editor can send
  // anything, and what is already on disk must survive it.
  const path = join(PANEL_ROOT, 'saved.yaml')
  const before = await readFile(path, 'utf8')
  await assert.rejects(
    () => panel.saveCase(path, 'id: saved\n  title: broken\nrequest: {\n'),
    (error) => error instanceof PanelError && error.status === 422,
  )
  assert.equal(await readFile(path, 'utf8'), before)
})

await testAsync('a save error names the file being edited, not the temp file', async () => {
  // The parser quotes whatever path it was handed, which is the temp file. That
  // file is deleted immediately, so a message naming it is doubly useless.
  const path = join(PANEL_ROOT, 'saved.yaml')
  let message = ''
  try {
    await panel.saveCase(path, 'id: saved\n  title: broken\nrequest: {\n')
  } catch (error) {
    message = error.message
  }
  assert.ok(message.includes('saved.yaml'), `the message does not name the case: ${message}`)
  assert.equal(/\.tmp-\d+-\d+/.test(message), false, `the message leaks a temp path: ${message}`)
})

await testAsync('validate reports the same way and leaves nothing on disk', async () => {
  const path = join(PANEL_ROOT, 'never-saved.yaml')
  let message = ''
  try {
    await panel.validateCase(path, 'id: x\n  title: broken\nrequest: {\n')
  } catch (error) {
    message = error.message
  }
  assert.ok(message.includes('never-saved.yaml'), `the message does not name the case: ${message}`)
  assert.equal(/\.check-\d+-\d+/.test(message), false, `the message leaks a temp path: ${message}`)
  assert.equal(existsSync(path), false, 'validate wrote the case it was only asked to check')
})

await testAsync('validate accepts a good case without writing it', async () => {
  const path = join(PANEL_ROOT, 'never-saved.yaml')
  const result = await panel.validateCase(path, CASE_OK)
  assert.equal(result.caseId, 'probe')
  assert.equal(existsSync(path), false)
})

// ---------------------------------------------------------------- plan

test('a browser journey is a step of its own, not a footnote', () => {
  // Six UI steps reported as "2 steps" would make the count worse than useless:
  // the browser is where the time goes.
  const definition = {
    request: { method: 'GET', path: '/' },
    expect: { response: { status: 200 } },
    browser: { url: '/', steps: [{ screenshot: 'a' }, { click: '#go' }, { assertVisible: '#out' }] },
  }
  const steps = describeSteps(definition)
  assert.deepEqual(steps.map((s) => s.kind), ['request', 'expect.response', 'browser'])
  assert.equal(steps[2].label, '3 browser step(s)')

  const justOpens = describeSteps({ request: { method: 'GET', path: '/' }, browser: { url: '/', steps: [] } })
  assert.equal(justOpens[justOpens.length - 1].label, 'open the page')
})

test('a UI-only case is a test, not a plan', () => {
  // Asserting on the page is asserting. Filing a UI case under "planned" is the
  // label this tool reserves for a test that cannot fail.
  const uiOnly = {
    request: { method: 'GET', path: '/' },
    expect: {},
    browser: { url: '/', steps: [{ assertText: { selector: '#t', contains: 'hi' } }] },
  }
  assert.equal(hasAssertions(uiOnly), true, 'a browser assertion counts as an assertion')
  assert.equal(caseStatus({ definition: uiOnly }, null), 'generated')

  const browsing = { request: { method: 'GET', path: '/' }, expect: {}, browser: { url: '/', steps: [{ click: '#a' }] } }
  assert.equal(hasAssertions(browsing), false, 'opening a page and clicking is still not an assertion')
})

section('plan')

test('a skeleton with no assertions is a plan, not a test', () => {
  // The scanner produces cases that send a request and assert nothing. Counting
  // forty green ones as tests is how a suite becomes decorative.
  const bare = { request: { method: 'GET', path: '/x' }, expect: {} }
  assert.equal(hasAssertions(bare), false)
  assert.equal(caseStatus({ definition: bare }, null), 'planned')
  const asserted = { request: { method: 'GET', path: '/x' }, expect: { response: { status: 200 } } }
  assert.equal(hasAssertions(asserted), true)
  assert.equal(caseStatus({ definition: asserted }, null), 'generated')
})

test('a refusal is blocked, not failed', () => {
  // A refused case never dialled. Reporting it as failed sends the reader to an
  // assertion that did not run.
  const entry = { definition: { request: {}, expect: { response: { status: 200 } } } }
  assert.equal(caseStatus(entry, { status: 'finished', verdict: 'refused' }), 'blocked')
  assert.equal(caseStatus(entry, { status: 'finished', verdict: 'failed' }), 'failed')
  assert.equal(caseStatus(entry, { status: 'running', verdict: null }), 'running')
  assert.equal(caseStatus(entry, null), 'generated')
})

test('steps describe the runner order, service first and teardown last', () => {
  const definition = {
    env: { projectPath: '/p', configurationName: 'App' },
    setup: {
      http: [{ method: 'POST', path: '/seed' }],
      sql: ['insert into t values (1)', 'delete from t'],
      sqlFiles: ['cleanup.sql'],
      capture: [{ name: 'id', from: 'response.body.id' }],
    },
    request: { method: 'POST', path: '/users' },
    expect: { response: { status: 201 }, database: [{ sql: 'select 1' }], logs: { mustContain: ['ok'] } },
    teardown: { sql: ['delete from t'] },
  }
  const steps = describeSteps(definition)
  assert.deepEqual(steps.map((s) => s.kind), [
    'service.start',
    'setup.http',
    'setup.sql',
    'setup.capture',
    'request',
    'expect.response',
    'expect.database',
    'expect.logs',
    'teardown.sql',
  ])
  assert.equal(steps.find((s) => s.kind === 'setup.sql').label, '3 statement(s)')
  assert.equal(steps.find((s) => s.kind === 'setup.capture').label, 'capture id')
  assert.equal(steps.find((s) => s.kind === 'request').label, 'POST /users')
  assert.equal(steps.find((s) => s.kind === 'service.start').label, 'App')
})

test('a case pointed at a running service claims no start step', () => {
  // Saying it starts a service would be a lie about where the time goes.
  const steps = describeSteps({ request: { method: 'GET', path: '/ping' }, env: {} })
  assert.deepEqual(steps.map((s) => s.kind), ['request'])
})

test('summariseStatuses names the worst thing in the group', () => {
  assert.equal(summariseStatuses([]).label, 'empty')
  assert.equal(summariseStatuses(['passed', 'passed']).label, 'allPassed')
  assert.equal(summariseStatuses(['passed', 'failed']).label, 'someFailed')
  assert.equal(summariseStatuses(['passed', 'blocked']).label, 'someBlocked')
  assert.equal(summariseStatuses(['passed', 'running']).label, 'someRunning')
  assert.equal(summariseStatuses(['passed', 'planned']).label, 'someUnrun')
  // failed outranks blocked: a failure is a result, a block is a question.
  assert.equal(summariseStatuses(['blocked', 'failed']).label, 'someFailed')
})

// ---------------------------------------------------------------- batch

section('batch')

await testAsync('a refused case keeps its name and does not stop the batch', async () => {
  // Found on a real run: the refused record carried the file name, so the list
  // showed "auth-register.yaml" where every other row showed a case id.
  const dir = join(tmpDir, 'batch-cases')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'writes.yaml'), CASE_OK.replace('path: /health', 'path: /health'), 'utf8')
  await writeFile(
    join(dir, 'writer.yaml'),
    `id: writer
title: writer
env:
  target: local
  databases:
    default: { name: iam, schema: public }
request:
  method: POST
  path: /users
expect:
  response:
    status: 201
setup:
  sql:
    - insert into t values (1)
`,
    'utf8',
  )
  const batchPanel = createPanel({
    ctx: { get: () => undefined },
    config: { caseDir: dir },
    state: { dataDir: join(tmpDir, 'batch-data') },
  })
  const started = await batchPanel.startBatch({ files: ['writer.yaml', 'missing.yaml'] })
  assert.equal(started.total, 2)
  // Both are refused (one for writes, one for not existing), and both are recorded.
  let status = started
  for (let attempt = 0; attempt < 40 && status.status === 'running'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25))
    status = await batchPanel.batchStatus(started.id)
  }
  assert.equal(status.status, 'finished')
  assert.equal(status.finished, 2)
  assert.equal(status.refused, 2)
  const refused = status.runs[0]
  assert.equal(refused.verdict, 'refused')
  // The case has no caseId of its own, so it reports its derived one — the point
  // is that it reports a case, not the file name it was asked for.
  assert.equal(refused.caseId, 'USER-writer', `the refusal lost the case name: ${refused.caseId}`)
  assert.ok(refused.error.length > 0, 'a refusal carries the reason it was refused')
  assert.equal(refused.reportPath, null, 'a refused case has no report to point at')
  assert.match(status.runs[1].error, /missing\.yaml/, 'a case that does not exist is reported as such')
  batchPanel.dispose()
})

await testAsync('a batch with no files is refused outright', async () => {
  await assert.rejects(() => panel.startBatch({ files: [] }), (error) => error instanceof PanelError)
})

await testAsync('an unknown batch id is a 404', async () => {
  await assert.rejects(
    () => panel.batchStatus('batch-nope'),
    (error) => error instanceof PanelError && error.status === 404,
  )
})

// ---------------------------------------------------------------- registry

section('registry')

await testAsync('a registry file supplies targets and databases', async () => {
  const dir = join(tmpDir, 'reg-a')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'e2e.registry.yml'),
    `targets:
  local:
    baseUrl: https://127.0.0.1:8443
    configurationName: App
databases:
  iam:
    kind: postgres
    host: 127.0.0.1
    port: 5432
    database: iam_db
    user: postgres
    password: secret
    schema: public
`,
    'utf8',
  )
  const registry = await loadRegistry({ caseDir: dir, env: {} })
  assert.equal(registry.file, join(dir, 'e2e.registry.yml'))
  assert.deepEqual(Object.keys(registry.targets), ['local'])
  assert.deepEqual(Object.keys(registry.databases), ['iam'])
})

await testAsync('a kind alias is normalised and the password is not leaked by describe', async () => {
  const dir = join(tmpDir, 'reg-b')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'e2e.registry.yml'),
    `databases:
  g:
    kind: gauss
    host: localhost
    port: 15432
    database: postgres
    user: gaussdb
    password: topsecret
`,
    'utf8',
  )
  const registry = await loadRegistry({ caseDir: dir, env: {} })
  const described = await describeDatabase(registry, 'g')
  assert.equal(described.kind, 'gaussdb')
  assert.equal(described.passwordConfigured, true)
  assert.ok(!JSON.stringify(described).includes('topsecret'), 'describeDatabase leaked the password')
})

await testAsync('the case schema overrides the registry schema', async () => {
  const dir = join(tmpDir, 'reg-c')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'e2e.registry.yml'),
    `databases:
  iam:
    kind: postgresql
    host: 127.0.0.1
    port: 5432
    database: iam_db
    user: postgres
    schema: public
`,
    'utf8',
  )
  const registry = await loadRegistry({ caseDir: dir, env: {} })
  assert.equal((await resolveDatabase(registry, 'iam', { schema: 'tenant_a' })).schema, 'tenant_a')
  assert.equal((await resolveDatabase(registry, 'iam')).schema, 'public')
})

await testAsync('a missing database name says what is available', async () => {
  const dir = join(tmpDir, 'reg-d')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'e2e.registry.yml'),
    'databases:\n  iam:\n    kind: postgresql\n    host: 127.0.0.1\n    database: x\n    user: u\n',
    'utf8',
  )
  const registry = await loadRegistry({ caseDir: dir, env: {} })
  await assert.rejects(
    () => resolveDatabase(registry, 'nope'),
    (error) => error instanceof RegistryError && /iam/.test(error.message),
  )
})

await testAsync('${env:NAME} expands and keeps its fallback', async () => {
  const dir = join(tmpDir, 'reg-e')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'e2e.registry.yml'),
    `databases:
  iam:
    kind: postgresql
    host: 127.0.0.1
    database: iam_db
    user: postgres
    password: \${env:DSH_E2E_TEST_PW:-fallback-pw}
`,
    'utf8',
  )
  const registry = await loadRegistry({ caseDir: dir, env: {} })
  assert.equal((await resolveDatabase(registry, 'iam')).password, 'fallback-pw')
  const overridden = await loadRegistry({ caseDir: dir, env: { DSH_E2E_TEST_PW: 'from-env' } })
  assert.equal((await resolveDatabase(overridden, 'iam')).password, 'from-env')
})

section('create project')

// The panel's createProject is the write side of "new project": it audits the
// URL with the runner's own rules, writes one target into the registry as a
// text insertion, and makes the case directory. These tests drive the panel so
// the whole path is covered, not just addTarget in isolation.
const PROJECT_ROOT = join(tmpDir, 'project-cases')
await mkdir(PROJECT_ROOT, { recursive: true })
const projectPanel = createPanel({
  ctx: { get: () => undefined },
  config: { caseDir: PROJECT_ROOT },
  state: { dataDir: join(tmpDir, 'project-data') },
})

await testAsync('creating a project writes the registry, makes the directory, and returns both', async () => {
  const result = await projectPanel.createProject({ name: 'shop', baseUrl: 'https://127.0.0.1:9443' })
  assert.equal(result.name, 'shop')
  assert.equal(result.caseDir, join(PROJECT_ROOT, 'shop'))
  assert.ok(existsSync(join(PROJECT_ROOT, 'shop')), 'the case directory exists')
  const registry = await readFile(result.registryFile, 'utf8')
  assert.match(registry, /^targets:\n  shop:\n    baseUrl: https:\/\/127\.0\.0\.1:9443\n/m, 'the target block reads like hand-written YAML')
})

await testAsync('a second project joins the targets block without touching anything else', async () => {
  const before = await readFile(join(PROJECT_ROOT, 'e2e.registry.yml'), 'utf8')
  const result = await projectPanel.createProject({ name: 'blog', baseUrl: 'https://127.0.0.1:9444' })
  const after = await readFile(result.registryFile, 'utf8')
  assert.ok(after.startsWith(before.split('targets:')[0]), 'text above the targets block moved')
  assert.match(after, /  blog:\n    baseUrl: https:\/\/127\.0\.0\.1:9444/, 'the new target is in the block')
  assert.equal(after.includes('shop:'), true, 'the first project survived')
  const order = ['shop:', 'blog:'].map((marker) => after.indexOf(marker))
  assert.ok(order[0] < order[1], 'targets are appended, not prepended')
})

await testAsync('a comment above the targets block survives the insertion', async () => {
  const file = join(PROJECT_ROOT, 'e2e.registry.yml')
  const current = await readFile(file, 'utf8')
  await writeFile(file, current.replace('targets:', '# the services we test against\ntargets:'), 'utf8')
  const result = await projectPanel.createProject({ name: 'admin', baseUrl: 'https://127.0.0.1:9445' })
  const after = await readFile(result.registryFile, 'utf8')
  assert.match(after, /# the services we test against/, 'the comment was thrown away')
})

await testAsync('two projects may share an origin: the folder is the project, not the port', async () => {
  // A local machine holds several checkouts and only one of them is running, so
  // the port a new project derives is very often the port an old project still
  // claims. Refusing that would mean stopping a service to write down a folder.
  const second = await projectPanel.createProject({ name: 'shop-two', baseUrl: 'https://127.0.0.1:9443' })
  assert.equal(second.name, 'shop-two')
  const registry = await readFile(second.registryFile, 'utf8')
  assert.match(registry, /  shop:\n/, 'the first target survived')
  assert.match(registry, /  shop-two:\n/, 'the second target was written')
})

await testAsync('a production-looking URL is refused at creation, with the runner\'s words', async () => {
  await assert.rejects(
    () => projectPanel.createProject({ name: 'live', baseUrl: 'https://prod.example.com' }),
    (error) => {
      assert.match(error.message, /production endpoint/)
      return true
    },
  )
})

await testAsync('a public URL needs allowRemote, with the runner\'s words', async () => {
  await assert.rejects(
    () => projectPanel.createProject({ name: 'staging', baseUrl: 'https://198.51.100.7' }),
    (error) => {
      assert.match(error.message, /not loopback or a private address/)
      return true
    },
  )
  const result = await projectPanel.createProject({ name: 'staging', baseUrl: 'https://198.51.100.7', allowRemote: true })
  assert.equal(result.name, 'staging')
})

await testAsync('a name with spaces is slugged, because the slug is the target name', async () => {
  const result = await projectPanel.createProject({ name: 'my shop', baseUrl: 'https://127.0.0.1:9446' })
  assert.equal(result.name, 'my-shop', 'the slug is what cases will write in env.target')
  const registry = await readFile(result.registryFile, 'utf8')
  assert.match(registry, /  my-shop:\n/, 'the slug, not the display name, lands in the registry')
})

await testAsync('a folder alone is enough: the name and the Base URL come from it', async () => {
  // The form asks for one thing. The project's name is the folder's name, and
  // the port is in the project's own application.yml — so a path is the whole
  // input, and anything else would be asking the reader to repeat it.
  const projectPath = join(tmpDir, 'My Store')
  await mkdir(join(projectPath, 'src', 'main', 'resources'), { recursive: true })
  await writeFile(join(projectPath, 'src', 'main', 'resources', 'application.yml'), 'server:\n  port: 9448\n', 'utf8')
  const result = await projectPanel.createProject({ projectPath })
  assert.equal(result.name, 'my-store', 'the folder name is the project name, slugged for the registry')
  assert.equal(result.baseUrl, 'http://127.0.0.1:9448', 'the port came from the project\'s application.yml')
  assert.match(String(result.derivedFrom), /application\.yml$/, 'the panel can say where the URL came from')
  const registry = await readFile(result.registryFile, 'utf8')
  assert.match(registry, /  my-store:\n    baseUrl: http:\/\/127\.0\.0\.1:9448\n/, 'the target is written')
  assert.match(registry, /projectPath: .*My Store/, 'and it remembers the folder it was born from')
})

await testAsync('a folder with no server configuration says so instead of inventing a URL', async () => {
  const bare = join(tmpDir, 'bare-app')
  await mkdir(bare, { recursive: true })
  await assert.rejects(
    () => projectPanel.createProject({ projectPath: bare }),
    (error) => {
      assert.ok(error instanceof PanelError)
      assert.match(error.message, /could not derive a Base URL/)
      return true
    },
  )
})

await testAsync('a fresh registry file gets a header that explains the conventions', async () => {
  const freshRoot = join(tmpDir, 'project-fresh')
  await mkdir(freshRoot, { recursive: true })
  const freshPanel = createPanel({ ctx: { get: () => undefined }, config: { caseDir: freshRoot }, state: { dataDir: join(tmpDir, 'project-fresh-data') } })
  const result = await freshPanel.createProject({ name: 'solo', baseUrl: 'https://127.0.0.1:9447' })
  assert.equal(result.created, true)
  const text = await readFile(result.registryFile, 'utf8')
  assert.match(text, /^# /, 'the file starts with a comment, not bare YAML')
  assert.match(text, /env\.target/, 'the header names the convention cases will use')
})

section('import endpoints')

// A little Spring project the scanner can read: one controller, one DTO.
const IMPORT_ROOT = join(tmpDir, 'import-project')
await mkdir(join(IMPORT_ROOT, 'src', 'main', 'resources'), { recursive: true })
await mkdir(join(IMPORT_ROOT, 'src', 'main', 'java', 'demo'), { recursive: true })
await writeFile(join(IMPORT_ROOT, 'src', 'main', 'resources', 'application.yml'), 'server:\n  port: 9555\n', 'utf8')
await writeFile(
  join(IMPORT_ROOT, 'src', 'main', 'java', 'demo', 'DemoController.java'),
  [
    'package demo;',
    '',
    'import org.springframework.web.bind.annotation.*;',
    '',
    '@RestController',
    '@RequestMapping("/demo")',
    'public class DemoController {',
    '    @PostMapping("/ping")',
    '    public String ping(@RequestBody PingDto body) { return "ok"; }',
    '}',
    '',
  ].join('\n'),
  'utf8',
)
await writeFile(
  join(IMPORT_ROOT, 'src', 'main', 'java', 'demo', 'PingDto.java'),
  ['package demo;', '', 'public class PingDto {', '    private String name;', '}', ''].join('\n'),
  'utf8',
)
const IMPORT_CASES = join(tmpDir, 'import-cases')
await mkdir(IMPORT_CASES, { recursive: true })
await writeFile(
  join(IMPORT_CASES, 'e2e.registry.yml'),
  `targets:\n  demo:\n    baseUrl: http://127.0.0.1:9555\n    projectPath: ${IMPORT_ROOT.split('\\').join('/')}\n`,
  'utf8',
)
const importPanel = createPanel({
  ctx: { get: () => undefined },
  config: { caseDir: IMPORT_CASES },
  state: { dataDir: join(tmpDir, 'import-data') },
})

await testAsync('importing ticked endpoints writes one case each and refuses to overwrite one', async () => {
  // The dialog ticks boxes; the Host writes files. One scan, one file per tick.
  const first = await importPanel.importEndpoints({
    endpoints: [{ method: 'POST', path: '/demo/ping' }],
  })
  assert.equal(first.written.length, 1, `expected one case written, got ${JSON.stringify(first.skipped)}`)
  assert.equal(first.target, 'demo', 'the target came from the registry, not from the reader')
  assert.ok(existsSync(first.written[0].path), 'the case file is on disk')
  assert.ok(first.written[0].caseId, 'the panel assigned a case id')

  // Second import of the same endpoint: the file stays as it is.
  const second = await importPanel.importEndpoints({
    endpoints: [{ method: 'POST', path: '/demo/ping' }],
  })
  assert.equal(second.written.length, 0, 'an existing case is never replaced')
  assert.equal(second.skipped.length, 1)
  assert.match(String(second.skipped[0].reason), /already there/)
})

await testAsync('an endpoint the scan cannot find is reported, not invented', async () => {
  const result = await importPanel.importEndpoints({
    endpoints: [{ method: 'GET', path: '/demo/does-not-exist' }],
  })
  assert.equal(result.written.length, 0)
  assert.equal(result.skipped.length, 1)
  assert.match(String(result.skipped[0].reason), /does not find it/)
})

await testAsync('importing with nothing ticked is refused, in the reader\'s words', async () => {
  await assert.rejects(
    () => importPanel.importEndpoints({ endpoints: [] }),
    (error) => {
      assert.ok(error instanceof PanelError)
      assert.match(error.message, /no endpoints were picked to import/)
      return true
    },
  )
})

// Two controllers in one project can both answer `GET /`. A route-only identity
// writes one file and calls the other one "already there" — which is exactly the
// import that silently did nothing.
const DUP_ROOT = join(tmpDir, 'dup-project')
await mkdir(join(DUP_ROOT, 'src', 'main', 'resources'), { recursive: true })
await mkdir(join(DUP_ROOT, 'src', 'main', 'java', 'a'), { recursive: true })
await mkdir(join(DUP_ROOT, 'src', 'main', 'java', 'b'), { recursive: true })
await writeFile(join(DUP_ROOT, 'src', 'main', 'resources', 'application.yml'), 'server:\n  port: 9556\n', 'utf8')
await writeFile(
  join(DUP_ROOT, 'src', 'main', 'java', 'a', 'AlphaController.java'),
  [
    'package a;',
    '',
    'import org.springframework.web.bind.annotation.*;',
    '',
    '@RestController',
    'public class AlphaController {',
    '    @GetMapping("/")',
    '    public String index() { return "a"; }',
    '}',
    '',
  ].join('\n'),
  'utf8',
)
await writeFile(
  join(DUP_ROOT, 'src', 'main', 'java', 'b', 'BetaController.java'),
  [
    'package b;',
    '',
    'import org.springframework.web.bind.annotation.*;',
    '',
    '@RestController',
    'public class BetaController {',
    '    @GetMapping("/")',
    '    public String root() { return "b"; }',
    '}',
    '',
  ].join('\n'),
  'utf8',
)
const DUP_CASES = join(tmpDir, 'dup-cases')
await mkdir(DUP_CASES, { recursive: true })
await writeFile(
  join(DUP_CASES, 'e2e.registry.yml'),
  `targets:\n  dup:\n    baseUrl: http://127.0.0.1:9556\n    projectPath: ${DUP_ROOT.split('\\').join('/')}\n`,
  'utf8',
)
const dupPanel = createPanel({
  ctx: { get: () => undefined },
  config: { caseDir: DUP_CASES },
  state: { dataDir: join(tmpDir, 'dup-data') },
})

await testAsync('two controllers on one route are two cases, not one and a lie', async () => {
  const result = await dupPanel.importEndpoints({
    endpoints: [
      { method: 'GET', path: '/', controller: 'AlphaController', file: 'src/main/java/a/AlphaController.java', line: 7 },
      { method: 'GET', path: '/', controller: 'BetaController', file: 'src/main/java/b/BetaController.java', line: 7 },
    ],
  })
  assert.equal(
    result.written.length,
    2,
    `both endpoints deserve a file; skipped: ${JSON.stringify(result.skipped)}`,
  )
  assert.notEqual(result.written[0].file, result.written[1].file, 'one file each')
  assert.ok(existsSync(result.written[0].path) && existsSync(result.written[1].path), 'both are on disk')
})

await testAsync('a tick naming its source file resolves to that controller, not the first match', async () => {
  // The route is the same for both; only the file tells them apart. Importing the
  // Beta one has to read Beta's source, not Alpha's.
  const beta = await dupPanel.importEndpoints({
    endpoints: [
      { method: 'GET', path: '/', controller: 'BetaController', file: 'src/main/java/b/BetaController.java', line: 7 },
    ],
  })
  assert.equal(beta.written.length, 0, 'the file is already there from the test above')
  assert.match(String(beta.skipped[0].reason), /already there/)
  // The reason names the file, so a reader can see which one it collided with.
  assert.match(String(beta.skipped[0].reason), /beta/i)
})

await testAsync('the import writes where the case list reads: the configured case directory', async () => {
  const result = await importPanel.importEndpoints({
    endpoints: [{ method: 'POST', path: '/demo/ping' }],
    projectPath: IMPORT_ROOT,
    target: 'demo',
  })
  assert.equal(result.dir, IMPORT_CASES, 'one directory, the one the panel lists')
  assert.ok(existsSync(join(IMPORT_CASES, 'post-demo-ping.yaml')), 'the file landed in it')
})

section('delete a directory project')

// A project card with no registry target is a directory. Deleting it is a file
// operation, and the guard is that the directory must be one the panel owns —
// never a path the caller made up.
const DIR_CASES = join(tmpDir, 'dir-cases')
await mkdir(DIR_CASES, { recursive: true })
const dirPanel = createPanel({
  ctx: { get: () => undefined },
  config: { caseDir: DIR_CASES },
  state: { dataDir: join(tmpDir, 'dir-data') },
})

await testAsync('a case sub-directory goes as a whole', async () => {
  const sub = join(DIR_CASES, 'nightly')
  await mkdir(sub, { recursive: true })
  await writeFile(join(sub, 'a.yaml'), 'id: a\n', 'utf8')
  await writeFile(join(sub, 'e2e.registry.yml'), 'targets: {}\n', 'utf8')
  const result = await dirPanel.deleteProject({ kind: 'directory', name: `dir:${sub}` })
  assert.equal(result.removedDir, sub)
  assert.equal(existsSync(sub), false, 'the directory is gone')
})

await testAsync('the configured case root keeps the directory and loses only its cases', async () => {
  await writeFile(join(DIR_CASES, 'one.yaml'), 'id: one\n', 'utf8')
  const result = await dirPanel.deleteProject({ kind: 'directory', name: `dir:${DIR_CASES}` })
  assert.equal(result.removedDir, null, 'the shared case root is not removed')
  assert.equal(result.keptDir, DIR_CASES)
  assert.equal(existsSync(DIR_CASES), true, 'the panel still has somewhere to save the next case')
  assert.equal(existsSync(join(DIR_CASES, 'one.yaml')), false, 'its cases are gone')
})

await testAsync('a directory outside every case root is refused', async () => {
  await assert.rejects(
    () => dirPanel.deleteProject({ kind: 'directory', name: `dir:${tmpDir}` }),
    (error) => {
      assert.ok(error instanceof PanelError)
      assert.match(error.message, /not inside a case directory/)
      return true
    },
  )
})

section('yaml')

// The panel once greeted the user with four "Invalid URL" warnings across the
// registry and every case, because the parser was located with
// `new URL('../vendor/js-yaml.mjs', import.meta.url)` and that base was not a
// file URL. The base is not something this module controls, so the fix is not
// "assume a better base" — it is "try the plausible ones and say which failed".
await testAsync('the parser location survives every base that used to throw', async () => {
  const bases = ['', undefined, 'data:text/javascript,x', 'node:fs', 'yaml.js', 'C:\\pkg\\src\\yaml.js', '/home/u/pkg/src/yaml.js']
  for (const url of bases) {
    const candidates = parserCandidates({ url })
    assert.ok(candidates.length > 0, `no candidates for base ${JSON.stringify(url)}`)
    assert.ok(
      candidates.some((candidate) => candidate.endsWith('/vendor/js-yaml.mjs')),
      `no candidate points at the vendored parser for base ${JSON.stringify(url)}: ${candidates}`,
    )
    assert.ok(
      candidates.every((candidate) => candidate.startsWith('file:')),
      `a candidate for base ${JSON.stringify(url)} is not a file URL: ${candidates}`,
    )
  }
})

// The reload hook rewrites module URLs with `?dshE2eGen=N`; the query must not
// turn a good file URL into a bad candidate, and the resolver-based fallback
// still has to be there for cold starts whose URL is not a file at all.
await test('a rewritten module URL still finds the package parser', () => {
  const candidates = parserCandidates({ url: 'file:///C:/pkg/src/yaml.js?dshE2eGen=23' })
  assert.ok(
    candidates.includes('file:///C:/pkg/vendor/js-yaml.mjs'),
    `the query broke the relative candidate: ${candidates}`,
  )
  assert.ok(
    candidates.some((candidate) => candidate.endsWith('/dsh-e2e/vendor/js-yaml.mjs')),
    `the package fallback is missing: ${candidates}`,
  )
})

await test('a cold start with no file URL still finds the package parser', () => {
  const candidates = parserCandidates({ url: 'yaml.js' })
  assert.ok(
    candidates.some((candidate) => candidate.endsWith('/dsh-e2e/vendor/js-yaml.mjs')),
    `the package fallback is missing on a bare base: ${candidates}`,
  )
})

// `new URL('../vendor/x', 'C:/pkg/src/yaml.js')` does not throw — it treats the
// drive letter as a scheme and resolves to `c:/pkg/vendor/x`. A candidate like
// that is worse than no candidate: it is checked before the working directory.
await test('a drive-letter path is never used as a URL base', () => {
  const candidates = parserCandidates({ url: 'C:/pkg/src/yaml.js' })
  assert.ok(
    !candidates.some((candidate) => /^c:\//i.test(candidate)),
    `a drive-letter candidate survived: ${candidates}`,
  )
})

await test('a Windows path yields its directory, not a bogus URL', () => {
  const candidates = parserCandidates({ url: 'C:\\pkg\\src\\yaml.js' })
  assert.ok(
    candidates.includes('file:///C:/pkg/vendor/js-yaml.mjs'),
    `expected the drive root candidate first, got: ${candidates}`,
  )
})

await test('the first choice is the package directory, not the working directory', () => {
  const [first] = parserCandidates()
  assert.ok(first.endsWith('/dsh-e2e/vendor/js-yaml.mjs'), `the first candidate was ${first}`)
})

await testAsync('a YAML read still works, and a syntax error names the file', async () => {
  assert.deepEqual(await parseYaml('a: 1\nb: [x, y]'), { a: 1, b: ['x', 'y'] })
  await assert.rejects(
    () => parseYaml('a: [1', 'some/case.yaml'),
    (error) => /invalid YAML/.test(error.message) && /some\/case\.yaml/.test(error.message),
  )
})

// ---------------------------------------------------------------- done

await rm(tmpDir, { recursive: true, force: true })

process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) {
  process.stdout.write('\nfailures:\n')
  for (const failure of failures) process.stdout.write(`  - ${failure.name}: ${failure.error.message}\n`)
  process.exit(1)
}
