/**
 * dsh-e2e — editing a case as fields without rewriting the file.
 *
 * The form view needs to change `priority` from medium to high. The obvious
 * implementation is parse → mutate → dump, and it is wrong: a case file is a
 * document a person wrote, and dumping it loses every comment, every blank line,
 * the quoting style, and the field order the author chose. The comments are not
 * decoration — they are where the author wrote down what the case is supposed to
 * prove, which is the part a reader needs most.
 *
 * So this module patches the text. Each field edit replaces exactly the value on
 * exactly one line, or inserts one line where the field should go. Everything
 * else in the file is untouched, byte for byte.
 *
 * It is line-based and deliberately knows nothing about YAML beyond indentation,
 * which is all it needs: a key's value is the rest of its line, and its block is
 * the run of more-indented lines below it.
 */
import { CaseError } from './case.js'

/** How many spaces one nesting level is. Case files in this project use two. */
const STEP = 2

const COMMENT = /^\s*#/

function indentOf(line) {
  const match = /^( *)/.exec(line)
  return match ? match[1].length : 0
}

function isBlank(line) {
  return line.trim() === ''
}

/**
 * The YAML spelling of a plain value.
 *
 * Strings that would change meaning unquoted (empty, leading/trailing space, a
 * colon, a leading `-`, something that looks like a number or a bool) are quoted.
 * This is the one place a value becomes text, so it is the one place to get it
 * right; getting it wrong writes `title: yes` and the case title becomes a
 * boolean.
 */
export function yamlScalar(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  const text = String(value)
  if (text === '') return "''"
  const needsQuotes =
    /^[\s]|[\s]$/.test(text) ||
    /[:#{}[\],&*?|>!%@`"']/.test(text) ||
    /^[-?]/.test(text) ||
    /^(true|false|yes|no|on|off|null|~)$/i.test(text) ||
    /^[+-]?(\d|\.\d)/.test(text) ||
    text.includes('\n')
  if (!needsQuotes) return text
  // Double quotes keep `\n` and `:` readable; the only characters needing an
  // escape inside them are the quote and the backslash itself.
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
}

/**
 * The line index where a key's block ends: the first following line that is
 * neither blank nor more indented than the key.
 */
function blockEnd(lines, keyIndex, indent) {
  let index = keyIndex + 1
  let last = keyIndex
  while (index < lines.length) {
    const line = lines[index]
    if (isBlank(line)) {
      index += 1
      continue
    }
    if (indentOf(line) <= indent) break
    last = index
    index += 1
  }
  return last
}

/** The index of `key:` at exactly `indent` inside [from, to), or -1. */
function findKey(lines, key, indent, from, to) {
  const pattern = new RegExp(`^ {${indent}}${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`)
  for (let index = from; index < to; index += 1) {
    const line = lines[index]
    if (COMMENT.test(line)) continue
    if (pattern.test(line)) return index
  }
  return -1
}

function nextNonBlank(lines, from) {
  for (let index = from; index < lines.length; index += 1) {
    if (!isBlank(lines[index])) return index
  }
  return -1
}

/**
 * Where a new top-level key belongs.
 *
 * Not at the end of the file: a case file ends with its assertions, and a
 * `group:` line after `- n: 0` reads as part of the database block. Top-level
 * keys belong with the other top-level keys, so the new one goes after the last
 * one that is a plain value on its own line — skipping block headers like
 * `description: >` and `env:`, whose own content follows them.
 */
function headerInsertPoint(lines) {
  let point = -1
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (isBlank(line) || COMMENT.test(line)) continue
    if (indentOf(line) !== 0) continue
    if (!/^[A-Za-z_][\w-]*\s*:\s*\S/.test(line)) continue
    const next = nextNonBlank(lines, index + 1)
    if (next !== -1 && indentOf(lines[next]) > 0) continue
    point = index
  }
  if (point !== -1) return point + 1
  // Nothing to anchor to: fall back to the end, without trailing blank noise.
  let last = lines.length - 1
  while (last >= 0 && isBlank(lines[last])) last -= 1
  return last + 1
}

/**
 * Sets one field by dotted path: `title`, `request.method`,
 * `expect.response.status`.
 *
 * Returns the new text. The key is replaced in place when it exists, and created
 * inside its parent block when it does not — creating `request.method` when
 * `request:` has only a `path` puts the new line after `path`, not at the bottom
 * of the file where it would be outside its block.
 *
 * A missing *middle* segment creates the key empty and keeps descending:
 * `expect.response.headers.x-trace` has to write `headers:` and then `x-trace:`
 * under it, not `headers: yes`.
 */
export function setField(yaml, path, value) {
  const segments = String(path).split('.').filter(Boolean)
  if (segments.length === 0) throw new CaseError('a field path is needed')
  const lines = String(yaml ?? '').split('\n')

  let indent = 0
  let from = 0
  let to = lines.length
  let parentIndex = -1

  for (let depth = 0; depth < segments.length; depth += 1) {
    const segment = segments[depth]
    const last = depth === segments.length - 1
    const keyIndex = findKey(lines, segment, indent, from, to)

    if (keyIndex !== -1 && last) {
      lines[keyIndex] = `${' '.repeat(indent)}${segment}: ${yamlScalar(value)}`
      return lines.join('\n')
    }

    if (keyIndex !== -1) {
      parentIndex = keyIndex
      from = keyIndex + 1
      to = blockEnd(lines, keyIndex, indent) + 1
      indent += STEP
      continue
    }

    // The key is not there. A new key joins its parent block: right after the
    // block's last line, so it cannot land outside the block it belongs to.
    const at = parentIndex === -1
      ? headerInsertPoint(lines)
      : blockEnd(lines, parentIndex, indentOf(lines[parentIndex])) + 1
    const lead = `${' '.repeat(indent)}${segment}:`

    if (last) {
      lines.splice(at, 0, `${lead} ${yamlScalar(value)}`)
      return lines.join('\n')
    }

    // A middle segment: create it empty and descend into the line we just added.
    lines.splice(at, 0, lead)
    parentIndex = at
    indent += STEP
    from = at + 1
    to = lines.length
  }
  return lines.join('\n')
}

/**
 * Applies a map of field paths, skipping values that are unchanged.
 *
 * Skipping is not an optimisation: writing `priority: medium` over the author's
 * `priority: medium` would still be a no-op, but a form that touches nothing
 * must produce a file identical to the one on disk, and "identical" is easier to
 * prove when nothing is written.
 */
export function applyFields(yaml, fields) {
  let text = String(yaml ?? '')
  for (const [path, value] of Object.entries(fields || {})) {
    if (value === undefined) continue
    text = setField(text, path, value)
  }
  return text
}

/**
 * The fields the form shows, flattened out of a normalised definition.
 *
 * Deliberately a small, fixed set. The form is for the things an author changes
 * while thinking — the name, the group, the priority, the route, the expected
 * status. Everything else (setup SQL, captures, teardown, mocks) is YAML-only,
 * because a form for it would be a worse text editor.
 */
export function formFields(definition) {
  const request = definition.request || {}
  const expect = definition.expect || {}
  return {
    title: definition.title || '',
    caseId: definition.caseId || '',
    group: definition.group || '',
    priority: definition.priority || 'medium',
    scenario: definition.scenario || 'normal',
    endpoint: definition.endpoint || '',
    description: definition.description || '',
    'request.method': request.method || 'GET',
    'request.path': request.path || request.url || '',
    'expect.response.status': expect.response && expect.response.status !== null && expect.response.status !== undefined ? expect.response.status : '',
  }
}

/** The fields the form is allowed to write. A path outside this list is refused. */
export const EDITABLE_FIELDS = [
  'title',
  'caseId',
  'group',
  'priority',
  'scenario',
  'endpoint',
  'description',
  'request.method',
  'request.path',
  'expect.response.status',
]

export function assertEditable(fields) {
  const unknown = Object.keys(fields || {}).filter((path) => !EDITABLE_FIELDS.includes(path))
  if (unknown.length > 0) {
    throw new CaseError(`the form cannot edit ${unknown.join(', ')}; it only writes ${EDITABLE_FIELDS.join(', ')}`)
  }
}
