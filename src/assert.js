/**
 * dsh-e2e — assertions.
 *
 * Every assertion returns the same shape: { ok, label, expected, actual, detail }.
 * The report is built from these records alone, so a reader can see what was
 * claimed, what was observed, and which one failed — never a bare "FAILED".
 */

function result(ok, label, expected, actual, detail) {
  return { ok, label, expected, actual, detail: detail || '' }
}

/** Dotted / bracketed path lookup: `data.items[0].status`, `code`, `a.b`. */
export function readPath(value, path) {
  if (!path) return value
  const parts = String(path)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((part) => part.length > 0)
  let current = value
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (Array.isArray(current)) {
      const index = Number(part)
      if (!Number.isInteger(index)) return undefined
      current = current[index]
      continue
    }
    if (typeof current !== 'object') return undefined
    current = current[part]
  }
  return current
}

function deepEqual(left, right) {
  if (left === right) return true
  if (typeof left !== typeof right) return false
  if (left === null || right === null) return false
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false
    return left.every((item, index) => deepEqual(item, right[index]))
  }
  if (typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false
    return leftKeys.every((key) => deepEqual(left[key], right[key]))
  }
  return false
}

/** The comparison forms a case may use in one `expect.response.json` entry. */
function compare(actual, spec) {
  if (Object.prototype.hasOwnProperty.call(spec, 'equals')) return { ok: deepEqual(actual, spec.equals), expected: spec.equals }
  if (Object.prototype.hasOwnProperty.call(spec, 'notEquals')) return { ok: !deepEqual(actual, spec.notEquals), expected: `!= ${format(spec.notEquals)}` }
  if (Object.prototype.hasOwnProperty.call(spec, 'contains')) {
    const needle = spec.contains
    const ok = typeof actual === 'string' ? actual.includes(String(needle)) : Array.isArray(actual) ? actual.some((item) => deepEqual(item, needle)) : false
    return { ok, expected: `contains ${format(needle)}` }
  }
  if (Object.prototype.hasOwnProperty.call(spec, 'matches')) {
    let pattern
    try {
      pattern = new RegExp(String(spec.matches))
    } catch (error) {
      return { ok: false, expected: `matches /${spec.matches}/`, detail: `invalid regular expression: ${error.message}` }
    }
    return { ok: pattern.test(String(actual ?? '')), expected: `matches /${spec.matches}/` }
  }
  if (Object.prototype.hasOwnProperty.call(spec, 'exists')) {
    const exists = actual !== undefined && actual !== null
    return { ok: spec.exists ? exists : !exists, expected: spec.exists ? 'present' : 'absent' }
  }
  if (Object.prototype.hasOwnProperty.call(spec, 'type')) {
    const actualType = Array.isArray(actual) ? 'array' : actual === null ? 'null' : typeof actual
    return { ok: actualType === spec.type, expected: `type ${spec.type}` }
  }
  if (Object.prototype.hasOwnProperty.call(spec, 'greaterThan')) return { ok: Number(actual) > Number(spec.greaterThan), expected: `> ${spec.greaterThan}` }
  if (Object.prototype.hasOwnProperty.call(spec, 'lessThan')) return { ok: Number(actual) < Number(spec.lessThan), expected: `< ${spec.lessThan}` }
  if (Object.prototype.hasOwnProperty.call(spec, 'in')) {
    const list = Array.isArray(spec.in) ? spec.in : [spec.in]
    return { ok: list.some((item) => deepEqual(actual, item)), expected: `one of ${format(list)}` }
  }
  return { ok: false, expected: '(no comparison given)', detail: 'give one of equals/notEquals/contains/matches/exists/type/greaterThan/lessThan/in' }
}

function format(value) {
  if (typeof value === 'string') return JSON.stringify(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** Response assertions: status, JSON fields, required body text, duration. */
export function assertResponse(expectation, response) {
  const checks = []
  if (!expectation) return checks

  if (expectation.status !== null) {
    checks.push(result(response.status === expectation.status, 'response.status', expectation.status, response.status))
  }
  if (Array.isArray(expectation.statusIn) && expectation.statusIn.length > 0) {
    checks.push(result(expectation.statusIn.includes(response.status), 'response.statusIn', expectation.statusIn.join(' | '), response.status))
  }

  for (const entry of expectation.json) {
    const actual = readPath(response.bodyJson ?? tryParse(response.bodyText), entry.path)
    const compared = compare(actual, entry)
    checks.push(result(compared.ok, `response.json ${entry.path}`, compared.expected, actual, compared.detail))
  }

  if (expectation.schema) {
    const problems = validateSchema(response.bodyJson ?? tryParse(response.bodyText), expectation.schema, '$')
    checks.push(result(problems.length === 0, 'response.schema', 'matches the declared schema', problems.length === 0 ? 'ok' : problems.join('; ')))
  }

  if (expectation.bodyContains) {
    checks.push(result(response.bodyText.includes(expectation.bodyContains), 'response.body contains', expectation.bodyContains, preview(response.bodyText)))
  }
  if (expectation.bodyNotContains) {
    checks.push(result(!response.bodyText.includes(expectation.bodyNotContains), 'response.body must not contain', expectation.bodyNotContains, preview(response.bodyText)))
  }
  if (expectation.maxDurationMs) {
    checks.push(result(response.durationMs <= expectation.maxDurationMs, 'response.durationMs', `<= ${expectation.maxDurationMs}`, response.durationMs))
  }
  return checks
}

function tryParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function preview(text, limit = 300) {
  const value = String(text ?? '')
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

/**
 * A deliberately small JSON Schema subset: type, required, properties, items,
 * enum, and const. Enough to catch a changed contract without pulling in a
 * validator dependency.
 */
export function validateSchema(value, schema, path) {
  const problems = []
  if (!schema || typeof schema !== 'object') return problems
  if (schema.type) {
    const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value
    const expected = schema.type === 'integer' ? 'number' : schema.type
    if (expected !== actual || (schema.type === 'integer' && !Number.isInteger(value))) {
      problems.push(`${path}: expected ${schema.type}, got ${actual}`)
      return problems
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => deepEqual(item, value))) {
    problems.push(`${path}: ${format(value)} is not one of ${format(schema.enum)}`)
  }
  if (Object.prototype.hasOwnProperty.call(schema, 'const') && !deepEqual(value, schema.const)) {
    problems.push(`${path}: expected the constant ${format(schema.const)}`)
  }
  if (Array.isArray(schema.required) && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) problems.push(`${path}.${key}: required but missing`)
    }
  }
  if (schema.properties && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(schema.properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        problems.push(...validateSchema(value[key], child, `${path}.${key}`))
      }
    }
  }
  if (schema.items && Array.isArray(value)) {
    value.forEach((item, index) => problems.push(...validateSchema(item, schema.items, `${path}[${index}]`)))
  }
  return problems
}

/** Database assertions over rows already fetched by the runner. */
export function assertDatabase(expectation, rows, error) {
  const checks = []
  if (error) {
    checks.push(result(false, 'database query', 'the query must run', `error: ${error}`))
    return checks
  }
  const label = expectation.description || 'database'
  if (expectation.rowCount !== null) {
    checks.push(result(rows.length === expectation.rowCount, `${label} row count`, expectation.rowCount, rows.length))
  }
  if (expectation.rowCountAtLeast !== null) {
    checks.push(result(rows.length >= expectation.rowCountAtLeast, `${label} row count`, `>= ${expectation.rowCountAtLeast}`, rows.length))
  }
  if (expectation.notEmpty) {
    checks.push(result(rows.length > 0, `${label} not empty`, 'at least one row', rows.length))
  }
  if (expectation.empty) {
    checks.push(result(rows.length === 0, `${label} empty`, 'no rows', rows.length))
  }
  if (expectation.equals) {
    const first = rows[0] || {}
    for (const [key, expected] of Object.entries(expectation.equals)) {
      checks.push(result(deepEqual(first[key], expected), `${label} ${key}`, expected, first[key]))
    }
  }
  // Per-row assertions: a list of { path, equals|matches|... } entries, where
  // path addresses the whole result set ("[0].valid_state"). This is how a case
  // pins exact column values rather than just row counts.
  if (Array.isArray(expectation.rows)) {
    for (const assertion of expectation.rows) {
      const actual = readPath(rows, assertion.path)
      const spec = { ...assertion }
      delete spec.path
      const outcome = compare(actual, spec)
      checks.push(result(outcome.ok, `${label} ${assertion.path}`, outcome.expected, actual, outcome.detail || ''))
    }
  }
  return checks
}

/** Log assertions over the lines collected for this case. */
export function assertLogs(expectation, lines, traceId) {
  const checks = []
  if (!expectation) return checks
  const scope = traceId ? ` (traceId ${traceId})` : ''

  for (const needle of expectation.mustContain) {
    const hit = lines.find((line) => line.includes(needle))
    checks.push(result(Boolean(hit), `logs must contain${scope}`, needle, hit ? preview(hit) : `no line contained it (${lines.length} lines scanned)`))
  }
  for (const needle of expectation.mustNotContain) {
    const hit = lines.find((line) => line.includes(needle))
    checks.push(result(!hit, `logs must not contain${scope}`, needle, hit ? preview(hit) : 'absent'))
  }
  for (const expression of expectation.regex) {
    let pattern
    try {
      pattern = new RegExp(expression)
    } catch (error) {
      checks.push(result(false, `logs regex${scope}`, expression, `invalid regular expression: ${error.message}`))
      continue
    }
    const hit = lines.find((line) => pattern.test(line))
    checks.push(result(Boolean(hit), `logs regex${scope}`, expression, hit ? preview(hit) : 'no match'))
  }
  return checks
}

export { deepEqual, compare }
