/**
 * dsh-e2e — what a case will do, and where it stands.
 *
 * The case list answers two questions per row that are not in the YAML:
 *
 *   - "how much is in here" — a case with one request and no assertion is not
 *     the same size of thing as one that seeds rows, captures a code, sends the
 *     request, checks two tables and cleans up. A step count is the cheapest
 *     honest answer, and it is derived from the same fields the runner reads, so
 *     it cannot drift from what will actually happen.
 *
 *   - "what happened last" — a verdict alone is not enough, because "never run"
 *     and "ran and was refused by the guard" look identical in a verdict column
 *     that only knows pass/fail. They are different problems with different
 *     fixes: one needs someone to press Run, the other needs a credential.
 *
 * Everything here is pure: it takes a normalised definition and, optionally, the
 * newest report for that case. No I/O, so the panel and the tools agree.
 */

/** Statuses in the order the page's tabs show them. */
export const STATUSES = ['planned', 'generated', 'running', 'passed', 'failed', 'blocked']

/**
 * One entry per thing the runner will do, in the order it does them.
 *
 * This is a *description*, not a plan the runner executes — the runner builds its
 * own sequence because it has the resolved environment (which service to start,
 * which database to dial). Keeping the two in the same order is what makes the
 * count meaningful; the runner's `step()` calls are the authority on the order,
 * and this function follows them.
 */
export function describeSteps(definition) {
  const steps = []
  const env = definition.env || {}
  const setup = definition.setup || {}
  const expect = definition.expect || {}
  const teardown = definition.teardown || {}

  // Starting the service is a step the author waits for, and it is the one most
  // likely to be the reason a case is slow. It only appears when the case names
  // a checkout to start — a case pointed at an already-running service has no
  // such step, and saying it does would be a lie about where the time goes.
  if (env.projectPath) {
    steps.push({ kind: 'service.start', label: env.configurationName || 'start the service' })
  }

  for (const request of setup.http || []) {
    steps.push({ kind: 'setup.http', label: `${request.method} ${request.path || request.url}` })
  }
  const setupSql = (setup.sql || []).length + (setup.sqlFiles || []).length
  if (setupSql > 0) steps.push({ kind: 'setup.sql', label: `${setupSql} statement(s)` })
  for (const capture of setup.capture || []) {
    steps.push({ kind: 'setup.capture', label: `capture ${capture.name}` })
  }

  const request = definition.request || {}
  steps.push({ kind: 'request', label: `${request.method || 'GET'} ${request.path || request.url || ''}`.trim() })

  if (expect.response) steps.push({ kind: 'expect.response', label: 'check the response' })
  for (const probe of expect.calls || []) {
    steps.push({ kind: 'expect.call', label: probe.description || `${probe.method || 'GET'} ${probe.path || probe.url || ''}`.trim() })
  }
  for (const query of expect.database || []) {
    steps.push({ kind: 'expect.database', label: query.description || `query ${query.database || 'default'}` })
  }
  if (expect.logs) steps.push({ kind: 'expect.logs', label: 'read the logs' })

  for (const request of teardown.http || []) {
    steps.push({ kind: 'teardown.http', label: `${request.method} ${request.path || request.url}` })
  }
  const teardownSql = (teardown.sql || []).length + (teardown.sqlFiles || []).length
  if (teardownSql > 0) steps.push({ kind: 'teardown.sql', label: `${teardownSql} statement(s)` })

  return steps
}

/**
 * True when the case asserts anything at all.
 *
 * A scaffolded skeleton sends a request and checks nothing — it is a plan, not a
 * test, and running it proves only that the service did not crash. That is worth
 * knowing on the list, because a suite of forty green skeletons means nothing.
 */
export function hasAssertions(definition) {
  const expect = definition.expect || {}
  return Boolean(
    expect.response ||
      (expect.database || []).length > 0 ||
      (expect.calls || []).length > 0 ||
      expect.logs,
  )
}

/**
 * Where a case stands, from its newest report (or the absence of one).
 *
 * `blocked` is the one that earns its place: the guard refuses a case before it
 * dials anything — a remote host, a missing credential, a write without
 * permission. That case did not fail, it never started, and reporting it as a
 * failure sends someone to read an assertion that never ran.
 *
 * `planned` vs `generated` is the other distinction worth the extra word: a
 * skeleton that asserts nothing is a plan. Forty green plans mean nothing, and a
 * page that calls them "passed" would be the most expensive kind of wrong.
 */
export function caseStatus(entry, run) {
  if (run && run.status === 'running') return 'running'
  // `entry` is a list row, which carries `asserts`; a caller that has only the
  // definition passes `{ definition }`. Both shapes are accepted rather than
  // silently reading the wrapper as if it were the case, which would make every
  // such case look like an empty plan.
  const row = entry || {}
  const definition = row.definition || row
  const asserts = row.asserts !== undefined ? row.asserts : hasAssertions(definition)
  if (!run || !run.verdict) return asserts ? 'generated' : 'planned'
  if (run.verdict === 'passed') return 'passed'
  if (run.verdict === 'refused') return 'blocked'
  return 'failed'
}

/** The one-line summary the list's group header shows: "5 tests · all passed". */
export function summariseStatuses(statuses) {
  const counts = { total: statuses.length, passed: 0, failed: 0, blocked: 0, planned: 0, generated: 0, running: 0 }
  for (const status of statuses) {
    if (counts[status] === undefined) continue
    counts[status] += 1
  }
  counts.total = statuses.length
  let label
  if (counts.total === 0) label = 'empty'
  else if (counts.failed > 0) label = 'someFailed'
  else if (counts.blocked > 0) label = 'someBlocked'
  else if (counts.running > 0) label = 'someRunning'
  else if (counts.planned > 0 || counts.generated > 0) label = 'someUnrun'
  else label = 'allPassed'
  return { counts, label }
}
