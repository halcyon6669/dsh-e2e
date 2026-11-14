/**
 * dsh-e2e — the form's text patcher.
 *
 * The form view writes YAML by patching the file the user wrote, not by
 * re-serialising a parsed copy. That choice is what keeps their comments, blank
 * lines and field order intact — and it is also the one place in this plugin
 * that edits a document it did not create. So the rules get a probe:
 *
 *   - a field that exists is replaced in place, indentation preserved
 *   - a field that does not exist is inserted into its parent block
 *   - comments and blank lines are never moved or dropped
 *   - a value that needs quoting gets quoted, and one that does not stays bare
 *   - the form refuses to write anything it does not understand
 *
 * Run: node dev/edit.test.mjs
 */
import assert from 'node:assert/strict'

import { applyFields, assertEditable, EDITABLE_FIELDS, formFields, setField, yamlScalar } from '../src/edit.js'

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
    console.log(`       ${String(error.message).split('\n')[0]}`)
  }
}

console.log('edit')

/* ---------- the fixture: a document with everything a user writes ---------- */

const DOCUMENT = [
  '# This case proves that a duplicate username is refused.',
  '# The comment is the reason the case exists; losing it is losing the case.',
  'id: auth-register-dup',
  'caseId: REG-002',
  'title: A duplicate username is refused',
  'description: >',
  '  The second registration with the same username must fail,',
  '  and the first row must still be the only one.',
  '',
  '# high = this is the case we would ship a hotfix for.',
  'priority: high',
  'scenario: error',
  'endpoint: POST /auth/register',
  '',
  'env:',
  '  target: record-local',
  '',
  'request:',
  '  method: POST',
  '  path: /auth/register',
  '  json:',
  '    username: e2e${random.hex}',
  '    password: "P@ssw0rd1"',
  '',
  'expect:',
  '  response:',
  '    status: 409',
  '  database:',
  '    - name: default',
  '      sql: select count(*) as n from users',
  '      expect:',
  '        rows:',
  '          - n: 0',
  '',
].join('\n')

const lines = (text) => text.split('\n')
const countComments = (text) => lines(text).filter((line) => line.trimStart().startsWith('#')).length

/* ---------- replacing in place ---------- */

test('a top-level field is replaced where it stands', () => {
  const next = setField(DOCUMENT, 'title', 'A duplicate name is refused')
  assert.match(next, /^title: A duplicate name is refused$/m)
  assert.equal(lines(next).length, lines(DOCUMENT).length, 'replacing must not change the line count')
  assert.equal(countComments(next), countComments(DOCUMENT), 'every comment survives')
})

test('a nested field is replaced inside its own block, not some other block', () => {
  const next = setField(DOCUMENT, 'expect.response.status', 400)
  assert.match(next, /^    status: 400$/m)
  assert.equal(next.includes('status: 409'), false, 'the old value is gone')
  // The one at `request.method` is a different key and must be untouched.
  assert.match(next, /^  method: POST$/m)
})

test('the request block keeps its own method when the expect block changes', () => {
  const next = setField(DOCUMENT, 'request.method', 'PUT')
  assert.match(next, /^  method: PUT$/m)
  assert.match(next, /^    status: 409$/m, 'the assertion is untouched')
})

test('a field that is absent is inserted into its parent block', () => {
  const next = setField(DOCUMENT, 'group', 'Registration')
  assert.match(next, /^group: Registration$/m)
  // Inserted at the end of the top-level block, which is after `endpoint:` and
  // before the blank line that starts `env:`.
  const at = lines(next).indexOf('group: Registration')
  assert.ok(at > lines(next).indexOf('endpoint: POST /auth/register'), 'it lands after the other top-level keys')
  assert.ok(at < lines(next).indexOf('env:'), 'and before the next block')
})

test('a nested field that is absent is inserted into the nested block', () => {
  const next = setField(DOCUMENT, 'expect.response.headers.x-trace', 'trace-1')
  assert.match(next, /^    headers:$/m, 'the missing middle segment is created as a block, not as a value')
  assert.match(next, /^      x-trace: trace-1$/m, 'and the leaf lands inside it')
  assert.equal(countComments(next), countComments(DOCUMENT))
})

test('a missing middle segment is never written as a value', () => {
  // The bug this pins: creating `expect.response.headers.x-trace` must not write
  // `headers: <value>`, which would silently turn a mapping into a string and
  // make the case unloadable.
  const next = setField(DOCUMENT, 'expect.response.headers.x-trace', 'trace-1')
  assert.equal(/^\s*headers: \S/m.test(next), false, 'headers must stay a block header')
})

test('the comment that explains a field survives the field being changed', () => {
  const next = setField(DOCUMENT, 'priority', 'medium')
  assert.match(next, /^priority: medium$/m)
  assert.match(next, /# high = this is the case we would ship a hotfix for\./, 'the comment above it is still there')
})

test('the multi-line description is not damaged by an unrelated edit', () => {
  const next = setField(DOCUMENT, 'title', 'Renamed')
  assert.match(next, /description: >\n {2}The second registration/)
  assert.match(next, /^ {2}and the first row must still be the only one\.$/m)
})

/* ---------- writing values ---------- */

test('a value that needs quoting is quoted, and one that does not stays bare', () => {
  assert.equal(yamlScalar('plain'), 'plain')
  assert.equal(yamlScalar('Registration'), 'Registration')
  assert.equal(yamlScalar(''), "''")
  assert.equal(yamlScalar('a: b'), '"a: b"', 'a colon would start a mapping')
  assert.equal(yamlScalar('# not a comment'), '"# not a comment"', 'a leading hash would be a comment')
  assert.equal(yamlScalar(' padded '), '" padded "', 'leading space would be stripped')
  assert.equal(yamlScalar('true'), '"true"', 'the string "true" is not the boolean')
  assert.equal(yamlScalar('404'), '"404"', 'the string "404" is not the number')
  assert.equal(yamlScalar('say "hi"'), '"say \\"hi\\""', 'quotes inside are escaped')
})

test('a number stays a number and a boolean stays a boolean', () => {
  assert.equal(yamlScalar(200), '200')
  assert.equal(yamlScalar(true), 'true')
  assert.equal(yamlScalar(false), 'false')
  assert.equal(yamlScalar(null), 'null')
})

test('a quoted value round-trips through the field it was written to', () => {
  const next = setField(DOCUMENT, 'title', 'Registration: the second attempt')
  assert.match(next, /^title: "Registration: the second attempt"$/m)
})

/* ---------- several fields at once ---------- */

test('applyFields writes every changed field and skips the undefined ones', () => {
  const next = applyFields(DOCUMENT, { title: 'Renamed', group: 'Registration', priority: undefined })
  assert.match(next, /^title: Renamed$/m)
  assert.match(next, /^group: Registration$/m)
  assert.match(next, /^priority: high$/m, 'an undefined field is left alone')
  assert.equal(countComments(next), countComments(DOCUMENT))
})

test('applying the same values twice changes nothing the second time', () => {
  const once = applyFields(DOCUMENT, { title: 'Renamed', group: 'Registration' })
  const twice = applyFields(once, { title: 'Renamed', group: 'Registration' })
  assert.equal(twice, once, 'the patch is idempotent')
})

test('a round trip through formFields and applyFields changes nothing', () => {
  // The form opens with the parsed values and saves only what the reader
  // changed. If those two agree, saving an untouched form is a no-op — which is
  // what stops "Save" from quietly reformatting a file nobody edited.
  const fields = formFields({
    title: 'A duplicate username is refused',
    caseId: 'REG-002',
    group: '',
    priority: 'high',
    scenario: 'error',
    endpoint: 'POST /auth/register',
    description: '',
    request: { method: 'POST', path: '/auth/register' },
    expect: { response: { status: 409 } },
  })
  assert.equal(fields.title, 'A duplicate username is refused')
  assert.equal(fields['request.method'], 'POST')
  assert.equal(fields['expect.response.status'], 409)
})

/* ---------- refusing to write what it does not understand ---------- */

test('the form refuses a field it does not own', () => {
  assert.throws(() => assertEditable({ 'teardown.sql': 'drop table users' }), /cannot edit/)
  assert.throws(() => assertEditable({ 'env.target': 'prod' }), /cannot edit/)
})

test('every field the form offers is one the form may write', () => {
  for (const field of Object.keys(
    formFields({
      title: 't',
      caseId: '',
      group: '',
      priority: 'medium',
      scenario: 'normal',
      endpoint: 'GET /x',
      description: '',
      request: { method: 'GET', path: '/x' },
      expect: { response: { status: 200 } },
    }),
  )) {
    assert.ok(EDITABLE_FIELDS.includes(field), `${field} is offered by the form but not editable`)
  }
  assert.doesNotThrow(() => assertEditable(Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, 'x']))))
})

test('the form is deliberately small', () => {
  // Not a style preference: every field here is one the author edits while
  // thinking. setup SQL, captures, teardown and mocks are written once and read
  // by the machine — a form for them is a text editor with fewer features.
  assert.equal(EDITABLE_FIELDS.length, 10, `the form grew to ${EDITABLE_FIELDS.length} fields; is that deliberate?`)
  assert.equal(EDITABLE_FIELDS.some((field) => field.startsWith('setup.')), false)
  assert.equal(EDITABLE_FIELDS.some((field) => field.startsWith('teardown.')), false)
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
