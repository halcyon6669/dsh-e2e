/**
 * dsh-e2e — a probe for the test plan document.
 *
 * The plan is a view over the case files, so the two things worth proving are
 * that the view says what the files say, and that saving it writes back only
 * the fields it shows. Anything else would make the plan a second copy of the
 * cases — with its own idea of what they contain.
 *
 * Run: node dev/testplan.test.mjs
 */
import assert from 'node:assert/strict'
import { planChanges, planDocument } from '../src/testplan.js'

const entry = (over) => ({
  id: 'list-users',
  caseId: 'LIST-USERS-001',
  title: 'List users',
  priority: 'high',
  description: 'The list comes back',
  endpoint: 'GET /users',
  group: 'GET /users',
  file: 'C:\\cases\\list-users.yaml',
  steps: [{ action: 'GET /users' }],
  ...over,
})

const project = {
  groups: [
    {
      name: 'GET /users',
      endpoint: 'GET /users',
      cases: [entry(), entry({ id: 'list-users-empty', caseId: 'LIST-USERS-002', title: 'Nobody there', priority: 'low' })],
    },
    {
      name: 'POST /users',
      endpoint: 'POST /users',
      cases: [entry({ id: 'create-user', caseId: 'CREATE-USER-001', title: 'Create', priority: 'medium', endpoint: 'POST /users' })],
    },
  ],
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
    console.log(`       ${error.message}`)
  }
}

console.log('test plan')

const plan = planDocument(project)

test('one use case per group, in the order the groups came in', () => {
  assert.deepEqual(
    plan.document.useCases.map((useCase) => useCase.useCase),
    ['GET /users', 'POST /users'],
  )
  assert.deepEqual(
    plan.document.useCases.map((useCase) => useCase.testCases.length),
    [2, 1],
  )
})

test('a use case gets a slug that survives a URL and a file name', () => {
  const [first, second] = plan.document.useCases
  assert.equal(first.slug, 'get-users')
  assert.equal(second.slug, 'post-users')
  assert.match(first.slug, /^[a-z0-9-]+$/)
})

test('a test case carries the id, the priority word and the name', () => {
  const [first] = plan.document.useCases
  assert.deepEqual(first.testCases[0], {
    id: 'LIST-USERS-001',
    priority: 'High',
    name: 'List users',
    subFeature: 'GET /users',
    description: 'The list comes back',
    steps: ['GET /users'],
  })
})

test('the meta keeps the file each id belongs to', () => {
  assert.equal(plan.meta.get('LIST-USERS-001').file, 'C:\\cases\\list-users.yaml')
  assert.equal(plan.meta.get('LIST-USERS-001').priority, 'high')
})

test('an unchanged document asks for no writes at all', () => {
  assert.deepEqual(planChanges(plan.document, plan.meta), [])
})

test('a renamed test asks for exactly one field, on exactly one file', () => {
  const next = JSON.parse(JSON.stringify(plan.document))
  next.useCases[0].testCases[0].name = 'List every user'
  assert.deepEqual(planChanges(next, plan.meta), [
    { file: 'C:\\cases\\list-users.yaml', id: 'LIST-USERS-001', fields: { title: 'List every user' } },
  ])
})

test('a lower-cased priority word still resolves to the case field', () => {
  const next = JSON.parse(JSON.stringify(plan.document))
  next.useCases[0].testCases[0].priority = 'medium'
  assert.deepEqual(planChanges(next, plan.meta), [
    { file: 'C:\\cases\\list-users.yaml', id: 'LIST-USERS-001', fields: { priority: 'medium' } },
  ])
})

test('the goal column writes the description field', () => {
  const next = JSON.parse(JSON.stringify(plan.document))
  next.useCases[1].testCases[0].description = 'Then the user exists'
  assert.deepEqual(planChanges(next, plan.meta), [
    { file: 'C:\\cases\\list-users.yaml', id: 'CREATE-USER-001', fields: { description: 'Then the user exists' } },
  ])
})

test('an id the project does not have is ignored, not written somewhere', () => {
  const next = { useCases: [{ useCase: 'GET /nope', slug: 'nope', testCases: [{ id: 'NOPE-001', name: 'x', priority: 'High' }] }] }
  assert.deepEqual(planChanges(next, plan.meta), [])
})

test('an id named twice is written once, and the first mention wins', () => {
  const next = JSON.parse(JSON.stringify(plan.document))
  // A cut-and-paste in the YAML view can leave one test under two use cases.
  // The first mention is the one the reader meant; the second is not a second
  // edit, and it is certainly not two writes to the same file.
  next.useCases[0].testCases[0].name = 'List every user'
  next.useCases.push({ useCase: 'GET /everyone', slug: 'everyone', testCases: [{ id: 'LIST-USERS-001', name: 'Something else', priority: 'Low' }] })
  const changes = planChanges(next, plan.meta)
  assert.equal(changes.length, 1)
  assert.deepEqual(changes[0].fields, { title: 'List every user' })
})

test('a document with no use cases is not a crash', () => {
  assert.deepEqual(planChanges({}, plan.meta), [])
  assert.deepEqual(planChanges(null, plan.meta), [])
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
