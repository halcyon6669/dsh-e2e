/**
 * dsh-e2e — turning a sentence into a case file.
 *
 * The model writes the YAML; it never writes the verdict. That split is the whole
 * point of the feature: an LLM is genuinely good at "here is my controller, write
 * me a case that proves a duplicate username is rejected", and genuinely bad at
 * deciding whether a run passed. So this module only ever produces a candidate
 * case, which is then parsed by the same `loadCaseFile` the tools use and either
 * accepted or rejected on its syntax — never on its opinion.
 *
 * The model comes from the Host `llm` service plus the session's default model
 * selection, so the user does not configure a second API key for this plugin. When
 * either service is missing, the caller gets an error that says what to do instead
 * of a stack trace.
 */
import { parseYaml } from './yaml.js'

/** The parts of a case the model is allowed to invent, spelled out for it. */
const SCHEMA_BRIEF = `
A case file is a YAML mapping with exactly these top-level keys:

  id            string, required, kebab-case, unique
  title         string, short
  description   string, one or two sentences
  tags          list of strings
  env           mapping, required
  setup         mapping (optional)
  request       mapping, required
  expect        mapping, required
  teardown      mapping (optional)

env:
  target        name of a target defined in e2e.registry.yml (string)
  baseUrl       absolute URL, only when the case does not use a target
  configurationName  IDE run configuration that starts the service
  projectPath   absolute path of the project, as the IDE knows it
  insecureTls   true when the service uses a self-signed certificate
  serviceRequired  false when the service is already running and must not be started
  keepServiceRunning  true to leave the service up after the run
  startTimeoutMs  integer
  databases     mapping of case-local name -> { name: <registry database name>, schema: <schema> }
  database      shorthand for a single database: { name: ..., schema: ... }

A case NEVER contains a host, a port, a user, a password or a JDBC URL for a
database. It names a database; the connection lives in e2e.registry.yml.

setup / teardown:
  sql           string or list of strings (inline SQL)
  sqlFile       path relative to the case file
  sqlFiles      list of paths
  http          list of { method, path, headers, json, body_template, expect_status, body_contains, description }
  capture       list of { name, database, sql, column, required, description }

  capture runs after setup.sql and setup.http. It reads one value the service
  generated (a verification code, a generated id) out of the database and binds it
  to ${'${name}'} for the request. This is how a case verifies something the server
  invents.

request:
  method        GET/POST/PUT/PATCH/DELETE
  path          path relative to env.baseUrl, or
  url           absolute URL
  headers       mapping
  json          object sent as JSON
  body_template string body with ${'${var}'} placeholders
  variables     mapping of variable name -> value; values may use
                ${'${random.uuid}'}, ${'${random.hex}'}, ${'${random.int}'},
                ${'${now.iso}'}, ${'${now.epochMs}'}, ${'${now.traceId}'} and earlier variables
  timeoutMs     integer

expect:
  response:
    status            integer
    statusIn          list of integers
    json              list of { path, equals|notEquals|contains|matches|exists|type|greaterThan|lessThan|in }
    schema            JSON-schema subset: { type, required, properties, items, enum, const }
    body_contains     string
    body_not_contains string
    maxDurationMs     integer
  database          list of:
    { database, description, sql,
      rowCount | rowCountAtLeast,
      rows: [ { path: "[0].column", equals: ... } ],
      notEmpty, empty }
  logs:
    traceId           string, usually omitted
    must_contain      string or list
    must_not_contain  string or list
    regex             string or list
    maxLines          integer
  calls             list of follow-up requests, same shape as setup.http plus json_expect
  maxDurationMs     integer
`.trim()

const SYSTEM_PROMPT = `You write end-to-end test cases for the dsh-e2e plugin as YAML.

Rules, in order of importance:
1. Output ONLY the YAML document. No prose, no explanation, no markdown fence.
2. Never invent a database host, port, user, password or JDBC URL. A case names a
   database from the registry; it does not connect to one.
3. Assert on observable state, not on implementation detail: an HTTP status, a
   field of the JSON body, a row in a table, a line in the log.
4. A case must be able to fail. If every assertion would pass against a broken
   service, the case proves nothing.
5. Prefer the smallest case that proves the claim. One behaviour per file.
6. Use the database name the user gave you, in env.databases and in every
   expect.database entry.

The schema you must follow:

${SCHEMA_BRIEF}`

export class GenerateError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'GenerateError'
    Object.assign(this, details)
  }
}

/** The model to generate with: the session default, unless the caller overrides it. */
async function resolveModel(ctx, override = {}) {
  if (override.provider && override.model) {
    return { provider: override.provider, model: override.model, reasoningEffort: override.reasoningEffort }
  }
  let selection = null
  try {
    const service = typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : null
    if (service && typeof service.currentSelection === 'function') selection = service.currentSelection()
  } catch {
    /* the service is optional: fall through to the error below */
  }
  if (!selection || !selection.provider || !selection.model) {
    throw new GenerateError(
      'no model is selected for this session, so the case cannot be generated. ' +
        'Pick a model in the composer, or write the case by hand — the editor and the run button work either way.',
    )
  }
  return { provider: selection.provider, model: selection.model, reasoningEffort: selection.reasoningEffort }
}

function llmService(ctx) {
  let service = null
  try {
    service = typeof ctx.get === 'function' ? ctx.get('llm') : null
  } catch {
    service = null
  }
  if (!service || typeof service.stream !== 'function') {
    throw new GenerateError('the Host LLM service is unavailable, so a case cannot be generated in this build')
  }
  return service
}

/**
 * Collects a streaming completion into one string.
 *
 * `stream` yields deltas; a provider that fails mid-stream yields an error chunk
 * rather than throwing, so both paths are handled and both surface the provider's
 * own message instead of an empty result.
 */
async function complete(service, options) {
  let text = ''
  let failure = null
  const stream = service.stream(options)
  for await (const chunk of stream) {
    if (!chunk || typeof chunk !== 'object') continue
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
    else if (chunk.type === 'error') failure = chunk.error || chunk.message || 'the model reported an error'
    else if (chunk.type === 'finish' && chunk.reason === 'error' && !failure) failure = 'the model stopped with an error'
  }
  if (failure && !text.trim()) throw new GenerateError(`the model failed: ${failure}`)
  return text
}

/** Strips a markdown fence the model added despite being told not to. */
function unfence(text) {
  const trimmed = String(text || '').trim()
  const fenced = trimmed.match(/^```(?:ya?ml)?\s*\n([\s\S]*?)\n?```$/i)
  return fenced ? fenced[1].trim() : trimmed
}

/**
 * Generates one case file from a description of what it should prove.
 *
 * `context` carries what the model needs to write something that actually fits
 * this project: the targets and databases the registry offers, the existing case
 * ids (so it does not collide), and optionally a snippet of the controller or a
 * previous case to imitate.
 */
export async function generateCase(ctx, input = {}) {
  const description = String(input.description || '').trim()
  if (!description) throw new GenerateError('describe what the case should prove, and it can be generated')

  const service = llmService(ctx)
  const model = await resolveModel(ctx, input)

  const contextParts = []
  if (Array.isArray(input.targets) && input.targets.length > 0) {
    contextParts.push(`Targets available in the registry: ${input.targets.join(', ')}.`)
  }
  if (Array.isArray(input.databases) && input.databases.length > 0) {
    contextParts.push(
      `Databases available in the registry: ${input.databases
        .map((item) => (typeof item === 'string' ? item : `${item.name}${item.schema ? ` (schema ${item.schema})` : ''}`))
        .join(', ')}.`,
    )
  }
  if (Array.isArray(input.existingIds) && input.existingIds.length > 0) {
    contextParts.push(`Case ids already in use (do not reuse one): ${input.existingIds.join(', ')}.`)
  }
  if (input.hint) contextParts.push(`Additional context from the user:\n${String(input.hint).slice(0, 8000)}`)

  const userPrompt = [
    `Write one dsh-e2e case file for this request:`,
    '',
    description,
    '',
    contextParts.length > 0 ? contextParts.join('\n') : '',
    '',
    'Reply with the YAML document only.',
  ]
    .filter((line) => line !== undefined)
    .join('\n')

  const text = await complete(service, {
    provider: model.provider,
    model: model.model,
    reasoningEffort: model.reasoningEffort,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
    temperature: 0.2,
    maxTokens: 4000,
    purpose: 'dsh-e2e generate case',
  })

  const yamlText = unfence(text)
  if (!yamlText) throw new GenerateError('the model returned nothing')

  // Validate with the same parser a real case goes through, so a generated file
  // is never presented as usable when it would be rejected on load.
  let parsed
  try {
    parsed = await parseYaml(yamlText, 'generated case')
  } catch (error) {
    throw new GenerateError(`the model produced YAML that does not parse: ${error.message}`, { yaml: yamlText })
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new GenerateError('the model produced YAML that is not a mapping', { yaml: yamlText })
  }
  if (!parsed.id || !parsed.request) {
    throw new GenerateError('the model produced a case without an "id" or a "request"', { yaml: yamlText, parsed })
  }

  return {
    yaml: yamlText,
    parsed,
    model: { provider: model.provider, model: model.model },
    raw: text,
  }
}

/**
 * Explains a failed run in plain language.
 *
 * Deliberately advisory: the verdict was decided by the assertions, and this only
 * describes what the evidence suggests. A model that says "looks fine" must not be
 * able to turn a red run green, so its output is never merged into `checks`.
 */
export async function explainFailure(ctx, report, input = {}) {
  const service = llmService(ctx)
  const model = await resolveModel(ctx, input)

  const failed = Array.isArray(report.failedChecks) ? report.failedChecks : []
  const facts = {
    caseId: report.caseId,
    title: report.title,
    verdict: report.verdict,
    fatal: report.fatal,
    failedChecks: failed.map((check) => ({
      label: check.label,
      expected: check.expected,
      actual: check.actual,
      detail: check.detail,
    })),
    warnings: report.warnings || [],
    request: report.evidence && report.evidence.request ? { method: report.evidence.request.method, url: report.evidence.request.url } : null,
    response: report.evidence && report.evidence.response ? { status: report.evidence.response.status, body: String(report.evidence.response.body || '').slice(0, 2000) } : null,
    database: Array.isArray(report.evidence && report.evidence.database)
      ? report.evidence.database.map((item) => ({ database: item.database, sql: item.sql, rows: item.rows, error: item.error }))
      : [],
  }

  const text = await complete(service, {
    provider: model.provider,
    model: model.model,
    reasoningEffort: model.reasoningEffort,
    system:
      'You explain why an automated end-to-end test failed. The assertions already decided the verdict; you never change it. ' +
      'Name the most likely cause, point at the specific evidence, and give one concrete next step. ' +
      'Be brief: at most five sentences. If the evidence is insufficient, say what to collect next instead of guessing.',
    messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(facts, null, 2) }] }],
    temperature: 0.2,
    maxTokens: 700,
    purpose: 'dsh-e2e explain failure',
  })

  return { explanation: String(text || '').trim(), model: { provider: model.provider, model: model.model } }
}
