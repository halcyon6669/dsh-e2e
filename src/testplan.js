/**
 * The test plan: the whole project's cases read as one document.
 *
 * The case list answers "what is red", and a case file answers "what does this
 * one say". Neither answers "what are we testing at all" — that question is
 * about the set, and a set is easier to read as one page: this endpoint, these
 * five tests, these priorities.
 *
 * So the document is derived, never stored: the case files remain the truth,
 * and the plan is a view over them. Saving a plan therefore edits the case
 * files — a case cannot be renamed in one place and stay old in another,
 * because there is only one place.
 */

const PRIORITY_WORD = { high: 'High', medium: 'Medium', low: 'Low' }
const PRIORITY_KEY = { High: 'high', Medium: 'medium', Low: 'low' }

/** The `useCase` label for a bucket: the endpoint it tests, else its group name. */
function useCaseName(bucket) {
  const endpoint = bucket.endpoint || (bucket.cases.find((entry) => entry.endpoint) || {}).endpoint
  if (endpoint) return String(endpoint)
  return String(bucket.group || bucket.name || '')
}

/**
 * A short, stable handle for a use case. It is the endpoint flattened to
 * something a URL or a file name could carry: `/auth/confirmCode` becomes
 * `auth-confirmcode`. It is not unique by construction, so a numeric suffix is
 * added when two use cases flatten to the same word.
 */
function slugOf(name, taken) {
  const base =
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .split('-')
      .filter(Boolean)
      .slice(0, 3)
      .join('-')
      .slice(0, 24) || 'plan'
  let slug = base
  let index = 2
  while (taken.has(slug)) {
    slug = `${base}-${index}`
    index += 1
  }
  taken.add(slug)
  return slug
}

function priorityWord(priority) {
  return PRIORITY_WORD[String(priority || '').toLowerCase()] || 'Medium'
}

/** One test case as the plan shows it. `file` and `entry` stay out of the document. */
function testCaseOf(entry) {
  const steps = Array.isArray(entry.steps) ? entry.steps : []
  return {
    id: String(entry.caseId || entry.id || ''),
    priority: priorityWord(entry.priority),
    name: String(entry.title || entry.id || ''),
    subFeature: String(entry.group || entry.endpoint || ''),
    description: String(entry.description || ''),
    steps: steps.map((step) => (typeof step === 'string' ? step : step && step.action ? String(step.action) : String(step))),
  }
}

/**
 * The project's plan document.
 *
 * `meta` maps an id to the case file and its current editable fields, so the
 * caller can save a document without re-reading the project.
 */
export function planDocument(project) {
  const taken = new Set()
  const meta = new Map()
  const useCases = (project.groups || []).map((bucket) => {
    const useCase = useCaseName(bucket)
    const testCases = (bucket.cases || []).map((entry) => {
      const testCase = testCaseOf(entry)
      meta.set(testCase.id, {
        file: entry.file,
        id: testCase.id,
        title: String(entry.title || ''),
        priority: String(entry.priority || 'medium'),
        description: String(entry.description || ''),
        group: String(entry.group || ''),
      })
      return testCase
    })
    return { useCase, slug: slugOf(useCase, taken), testCases }
  })
  return { document: { useCases }, meta }
}

/**
 * The differences a saved document asks for, per case file.
 *
 * Only the three fields the plan actually shows are compared: a plan that also
 * rewrote `request.path` because it round-tripped the file would be a plan that
 * silently edits tests.
 */
export function planChanges(document, meta) {
  const changes = []
  const seen = new Set()
  const useCases = document && Array.isArray(document.useCases) ? document.useCases : []
  for (const useCase of useCases) {
    const testCases = useCase && Array.isArray(useCase.testCases) ? useCase.testCases : []
    for (const testCase of testCases) {
      if (!testCase || !testCase.id) continue
      const id = String(testCase.id)
      if (seen.has(id)) continue
      seen.add(id)
      const known = meta.get(id)
      if (!known || !known.file) continue
      const fields = {}
      const name = testCase.name === undefined || testCase.name === null ? known.title : String(testCase.name)
      if (name !== known.title) fields.title = name
      const priority = PRIORITY_KEY[String(testCase.priority || '').trim()] || PRIORITY_KEY[String(testCase.priority || '').trim().replace(/^./, (c) => c.toUpperCase())]
      if (priority && priority !== known.priority) fields.priority = priority
      const description = testCase.description === undefined || testCase.description === null ? known.description : String(testCase.description)
      if (description !== known.description) fields.description = description
      if (Object.keys(fields).length > 0) changes.push({ file: known.file, id, fields })
    }
  }
  return changes
}

export { PRIORITY_WORD, PRIORITY_KEY }
