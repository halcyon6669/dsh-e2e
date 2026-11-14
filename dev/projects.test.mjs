/**
 * dsh-e2e — a probe for the project table.
 *
 * Builds a throwaway case directory with two targets that reach the same
 * service (the merge case), one target with its own checkout, a case that names
 * no target at all, and a report so the "latest results" column has something
 * to show. Asserts the rollup, then removes everything it made.
 *
 * Run: node dev/projects.test.mjs
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listProjects } from '../src/projects.js'

const CASE = (id, endpoint, target) => `id: ${id}
caseId: ${id.toUpperCase()}-001
title: ${id}
endpoint: ${endpoint}
scenario: normal
priority: medium
${target ? `env:\n  target: ${target}\n` : ''}request:
  method: GET
  path: ${endpoint.split(' ')[1]}
`

const REGISTRY = `targets:
  app-local:
    projectPath: ${JSON.stringify(join(tmpdir(), 'dsh-e2e-projects', 'shop'))}
    configurationName: ShopApplication
    baseUrl: https://127.0.0.1:9443
  app-running:
    baseUrl: https://127.0.0.1:9443
  other:
    projectPath: ${JSON.stringify(join(tmpdir(), 'dsh-e2e-projects', 'other'))}
    baseUrl: https://127.0.0.1:9444
`

const REPORT = (runId, caseId, verdict) => ({
  runId,
  caseId,
  title: caseId,
  verdict,
  startedAt: new Date().toISOString(),
  durationMs: 120,
  checks: [{ ok: verdict === 'passed', label: 'x' }],
  failedChecks: verdict === 'passed' ? [] : [{ label: 'x' }],
})

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
    console.log(`       ${error.message}`)
  }
}

const root = await mkdtemp(join(tmpdir(), 'dsh-e2e-projects-test-'))
const cases = join(root, 'cases')
const reports = join(root, 'reports')
await mkdir(cases, { recursive: true })
await mkdir(reports, { recursive: true })
await mkdir(join(tmpdir(), 'dsh-e2e-projects', 'shop'), { recursive: true })
await mkdir(join(tmpdir(), 'dsh-e2e-projects', 'other'), { recursive: true })

await writeFile(join(cases, 'e2e.registry.yml'), REGISTRY, 'utf8')
await writeFile(join(cases, 'get-users.yaml'), CASE('list-users', 'GET /users', 'app-local'), 'utf8')
await writeFile(join(cases, 'get-users-running.yaml'), CASE('list-users-2', 'GET /users', 'app-running'), 'utf8')
await writeFile(join(cases, 'get-orders.yaml'), CASE('list-orders', 'GET /orders', 'other'), 'utf8')
await writeFile(join(cases, 'get-health.yaml'), CASE('health', 'GET /health', null), 'utf8')
await writeFile(join(reports, 'run-a__LIST-USERS-001.json'), JSON.stringify(REPORT('run-a', 'LIST-USERS-001', 'passed')), 'utf8')
// Both cases on the merged project have run: "green" has to mean every case
// passed, not "the one case I happened to run passed".
await writeFile(join(reports, 'run-c__LIST-USERS-2-001.json'), JSON.stringify(REPORT('run-c', 'LIST-USERS-2-001', 'passed')), 'utf8')
await writeFile(join(reports, 'run-b__LIST-ORDERS-001.json'), JSON.stringify(REPORT('run-b', 'LIST-ORDERS-001', 'failed')), 'utf8')

const options = {
  config: { caseDir: cases, reportDir: reports },
  state: { dataDir: root },
  env: { ...process.env },
}

console.log('projects')

const result = await listProjects(options)
const byName = new Map(result.projects.map((project) => [project.name, project]))

await test('two targets that reach the same service are one project', () => {
  const shop = byName.get('shop')
  assert.ok(shop, `expected a "shop" project, got ${[...byName.keys()].join(', ')}`)
  assert.deepEqual(shop.targets.sort(), ['app-local', 'app-running'])
  assert.equal(shop.counts.total, 2)
})

await test('a case with no target lands in its directory project', () => {
  const dirProject = result.projects.find((project) => project.key.startsWith('dir:'))
  assert.ok(dirProject, 'expected a directory project for the targetless case')
  assert.deepEqual(
    dirProject.cases.map((entry) => entry.caseId),
    ['HEALTH-001'],
  )
})

await test('latest results come from the newest report per case', () => {
  const shop = byName.get('shop')
  const passedCase = shop.cases.find((entry) => entry.caseId === 'LIST-USERS-001')
  assert.equal(passedCase.verdict, 'passed')
  const other = byName.get('other')
  assert.equal(other.counts.failed, 1)
  assert.equal(other.counts.passed, 0)
})

await test('a project is only green when every case passed', () => {
  assert.equal(byName.get('other').lastVerdict, 'failed')
  assert.equal(byName.get('shop').lastVerdict, 'passed')
})

await test('the backend type is read from the build files, not guessed', async () => {
  await writeFile(join(tmpdir(), 'dsh-e2e-projects', 'shop', 'build.gradle'), '', 'utf8')
  const again = await listProjects(options)
  const shop = again.projects.find((project) => project.name === 'shop')
  assert.equal(shop.type, 'backend')
})

await test('a project with no cases yet still appears, as not run', async () => {
  const bare = join(root, 'bare-cases')
  await mkdir(bare, { recursive: true })
  await writeFile(
    join(bare, 'e2e.registry.yml'),
    `targets:\n  lonely:\n    baseUrl: https://127.0.0.1:9999\n`,
    'utf8',
  )
  const lonely = await listProjects({ ...options, config: { caseDir: bare, reportDir: reports } })
  assert.equal(lonely.projects.length, 1)
  assert.equal(lonely.projects[0].counts.total, 0)
  assert.equal(lonely.projects[0].lastVerdict, null)
})

await test('the listing never changes what it describes', async () => {
  // A read that creates a directory would make the first load of the page
  // differ from every later one.
  const before = await listProjects(options)
  const after = await listProjects(options)
  assert.deepEqual(
    after.projects.map((project) => project.key),
    before.projects.map((project) => project.key),
  )
})

await test('a report written before caseId existed still counts', async () => {
  // Reports used to store the file's id in `caseId`. After the field was added,
  // a case called `REG-001` had no report it could match, so the table claimed
  // everything was "not run" while the reports sat right there — the worst kind
  // of wrong, because it looks like the tests were never written.
  const dir = join(root, 'legacy')
  const legacyCases = join(dir, 'cases')
  const legacyReports = join(dir, 'reports')
  await mkdir(legacyCases, { recursive: true })
  await mkdir(legacyReports, { recursive: true })
  await writeFile(join(legacyCases, 'e2e.registry.yml'), `targets:\n  t:\n    baseUrl: https://127.0.0.1:9445\n`, 'utf8')
  await writeFile(
    join(legacyCases, 'get-ping.yaml'),
    // The file's id is what the old report recorded; the caseId was added later.
    CASE('get-ping', 'GET /ping', 't'),
    'utf8',
  )
  // The old shape: `caseId` holds the file's id, and there is no `id` field at all.
  // JSON.stringify drops the undefined, which is exactly the on-disk shape.
  await writeFile(
    join(legacyReports, 'run-old__get-ping.json'),
    JSON.stringify({ ...REPORT('run-old', 'get-ping', 'passed'), caseId: 'get-ping', id: undefined }),
    'utf8',
  )
  const legacy = await listProjects({ ...options, config: { caseDir: legacyCases, reportDir: legacyReports } })
  assert.equal(legacy.projects.length, 1)
  assert.equal(legacy.projects[0].counts.passed, 1, 'the old report was not matched to its case')
  assert.equal(legacy.projects[0].lastVerdict, 'passed')
})

await rm(root, { recursive: true, force: true })
await rm(join(tmpdir(), 'dsh-e2e-projects'), { recursive: true, force: true })

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
