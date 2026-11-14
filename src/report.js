/**
 * dsh-e2e — report rendering.
 *
 * The report is the product. A reader who was not here must be able to take this
 * text and find the cause without re-running anything, so every claim carries the
 * request, the response, the exact log lines and the exact SQL that produced it.
 */

const ICON = { passed: 'PASS', failed: 'FAIL' }

/** Markdown for one run: the same text goes into the tool result and the file. */
export function renderMarkdown(report) {
  const lines = []
  lines.push(`# ${ICON[report.verdict] || report.verdict} ${report.caseId} — ${report.title}`)
  lines.push('')
  lines.push(`- run: \`${report.runId}\``)
  lines.push(`- verdict: **${report.verdict}**`)
  lines.push(`- duration: ${report.durationMs}ms`)
  if (report.endpoint) lines.push(`- endpoint: \`${report.endpoint}\``)
  if (report.scenario) lines.push(`- scenario: ${report.scenario}`)
  if (report.priority) lines.push(`- priority: ${report.priority}`)
  lines.push(`- trace id: \`${report.traceId}\``)
  lines.push(`- source: ${report.source}`)
  const env = report.environment
  lines.push(
    `- target: ${env.baseUrl} (run configuration ${env.configurationName || '(none)'}${env.profile ? `, profile ${env.profile}` : ''})`,
  )
  if (env.databases && Object.keys(env.databases).length > 0) {
    for (const [name, entry] of Object.entries(env.databases)) {
      lines.push(`- database ${name}: ${entry.kind} ${entry.host}:${entry.port}/${entry.database}${entry.schema ? ` (schema ${entry.schema})` : ''}`)
    }
  }
  if (report.description) {
    lines.push('')
    lines.push(report.description)
  }

  if (report.fatal) {
    lines.push('')
    lines.push('## Fatal')
    lines.push('')
    lines.push('```')
    lines.push(report.fatal.message)
    lines.push('```')
    if (Array.isArray(report.fatal.details) && report.fatal.details.length > 0) {
      for (const item of report.fatal.details) lines.push(`- ${item}`)
    }
  }

  lines.push('')
  lines.push('## Checks')
  lines.push('')
  lines.push('| | assertion | expected | actual |')
  lines.push('|---|---|---|---|')
  for (const check of report.checks) {
    lines.push(
      `| ${check.ok ? '✅' : '❌'} | ${cell(check.label)} | ${cell(fmt(check.expected))} | ${cell(fmt(check.actual))} |`,
    )
  }
  if (report.checks.length === 0) lines.push('| — | (no assertions ran) | — | — |')

  if (report.failedChecks.length > 0) {
    lines.push('')
    lines.push('## Why it failed')
    lines.push('')
    for (const check of report.failedChecks) {
      lines.push(`### ❌ ${check.label}`)
      lines.push('')
      lines.push(`- expected: ${fmt(check.expected)}`)
      lines.push(`- actual: ${fmt(check.actual)}`)
      if (check.detail) lines.push(`- detail: ${fmt(check.detail)}`)
      lines.push('')
    }
  }

  if (Array.isArray(report.warnings) && report.warnings.length > 0) {
    lines.push('')
    lines.push('## Warnings')
    lines.push('')
    for (const warning of report.warnings) lines.push(`- ⚠️ ${warning}`)
  }

  const evidence = report.evidence
  if (evidence.setup && evidence.setup.length > 0) {
    lines.push('')
    lines.push('## Setup requests')
    lines.push('')
    for (const item of evidence.setup) {
      lines.push(`- \`${item.method} ${item.url}\` → ${item.status === null ? 'no response' : `HTTP ${item.status}`}${item.error ? ` ⚠️ ${item.error}` : ''}`)
    }
    lines.push('')
  }

  if (evidence.capture && evidence.capture.length > 0) {
    lines.push('')
    lines.push('## Captured values')
    lines.push('')
    for (const item of evidence.capture) {
      lines.push(`- \`${item.name}\` = \`${item.value}\` (column \`${item.column}\`, ${item.rows} row(s) matched)`)
    }
    lines.push('')
  }

  if (evidence.request) {
    lines.push('')
    lines.push('## Request')
    lines.push('')
    lines.push('```http')
    lines.push(`${evidence.request.method} ${evidence.request.url}`)
    for (const [key, value] of Object.entries(evidence.request.headers || {})) lines.push(`${key}: ${value}`)
    if (evidence.request.body) {
      lines.push('')
      lines.push(evidence.request.body)
    }
    lines.push('```')
  }

  if (evidence.response) {
    lines.push('')
    lines.push('## Response')
    lines.push('')
    lines.push(`\`${evidence.response.status} ${evidence.response.statusText}\` in ${evidence.response.durationMs}ms`)
    lines.push('')
    lines.push('```json')
    lines.push(evidence.response.body || '(empty)')
    lines.push('```')
  }

  if (evidence.logs) {
    lines.push('')
    lines.push('## Logs')
    lines.push('')
    lines.push(
      `file: \`${evidence.logs.path}\` — ${evidence.logs.totalLines} lines total, ${evidence.logs.scopedLines} matching trace id \`${evidence.logs.traceId}\`` +
        (evidence.logs.traceIdPresent ? '' : ' (no line carried it: every line of this run was scanned instead)'),
    )
    lines.push('')
    if (evidence.logs.lines.length === 0) {
      lines.push('_no log lines were collected_')
    } else {
      lines.push('```log')
      for (const line of evidence.logs.lines) lines.push(line)
      lines.push('```')
    }
  }

  if (evidence.probes.length > 0) {
    lines.push('')
    lines.push('## Probe calls')
    lines.push('')
    for (const probe of evidence.probes) {
      lines.push(`### ${probe.description}`)
      lines.push('')
      lines.push(`\`${probe.method} ${probe.url}\` → ${probe.status === null ? `no response (${probe.error})` : probe.status}`)
      lines.push('')
      if (probe.body !== null) {
        lines.push('```')
        lines.push(probe.body)
        lines.push('```')
        lines.push('')
      }
    }
  }

  if (evidence.database.length > 0) {
    lines.push('')
    lines.push('## Database')
    lines.push('')
    for (const item of evidence.database) {
      lines.push(`### ${item.database}`)
      lines.push('')
      lines.push('```sql')
      lines.push(item.sql)
      lines.push('```')
      if (item.error) {
        lines.push(`error: \`${item.error}\``)
      } else if (item.rowCount === 0) {
        lines.push('_no rows_')
      } else {
        lines.push('')
        lines.push(rowsToTable(item.rows))
        if (item.rowCount > item.rows.length) lines.push(`_showing ${item.rows.length} of ${item.rowCount} rows_`)
      }
      lines.push('')
    }
  }

  // The before/after pair, next to the assertion it explains. "expected 1 row,
  // got 0" is a verdict; "0 before, 0 after" is a diagnosis, and the Markdown
  // report is what people read weeks later when they ask why.
  const snapshots = (evidence.snapshots || []).filter((item) => item.changed !== undefined)
  if (snapshots.length > 0) {
    lines.push('')
    lines.push('## Database before and after')
    lines.push('')
    for (const item of snapshots) {
      const verdict = item.changed ? 'changed' : 'no change'
      lines.push(`### ${item.database} — ${verdict} (${item.beforeCount} → ${item.afterCount} rows)`)
      lines.push('')
      lines.push('```sql')
      lines.push(item.sql)
      lines.push('```')
      for (const [label, rows] of [
        ['before', item.before],
        ['after', item.after],
      ]) {
        lines.push('')
        lines.push(`**${label}**`)
        lines.push('')
        if (!Array.isArray(rows) || rows.length === 0) {
          lines.push('_no rows_')
        } else {
          lines.push(rowsToTable(rows))
        }
      }
      lines.push('')
    }
  }

  if (report.teardown) {
    lines.push('')
    lines.push('## Teardown')
    lines.push('')
    const teardown = report.teardown
    if (Array.isArray(teardown.http) && teardown.http.length > 0) {
      for (const item of teardown.http) {
        lines.push(`- request ${item.error ? 'failed' : 'ok'}: \`${item.method} ${item.url}\`${item.status === null ? '' : ` → HTTP ${item.status}`}${item.error ? ` — ${item.error}` : ''}`)
      }
    }
    if (teardown.sql.length > 0) {
      for (const item of teardown.sql) lines.push(`- SQL ${item.ok ? 'ok' : 'failed'}: \`${item.sql}\`${item.error ? ` — ${item.error}` : ''}`)
    } else if (!Array.isArray(teardown.http) || teardown.http.length === 0) {
      lines.push('- no teardown SQL')
    }
    if (teardown.service) {
      lines.push(
        `- service: port ${teardown.service.port} ${teardown.service.kept ? 'left running (keepServiceRunning)' : teardown.service.stopped ? 'stopped' : 'STILL RUNNING'}`,
      )
      for (const attempt of teardown.service.attempts || []) lines.push(`  - ${attempt}`)
    }
    for (const error of teardown.errors) lines.push(`- ⚠️ ${error}`)
  }

  lines.push('')
  lines.push('## Timeline')
  lines.push('')
  for (const step of report.steps) lines.push(`- +${step.at}ms ${step.name}${describeStep(step)}`)
  lines.push('')
  return lines.join('\n')
}

function describeStep(step) {
  if (step.name === 'response.received') return ` (HTTP ${step.status}, ${step.durationMs}ms)`
  if (step.name === 'service.started') return ` (${step.configurationName}, ready=${step.ready}, ${step.startupMs}ms)`
  if (step.name === 'logs.collected') return ` (${step.scopedLines}/${step.totalLines} lines matched)`
  if (step.name === 'setup.sql' || step.name === 'teardown.sql') return ` (${step.statements} statements)`
  if (step.name === 'setup.http') return ` (${step.requests} requests, ${step.failed} failed)`
  if (step.name === 'setup.capture') return ` (${step.captured.length} value(s))`
  if (step.name === 'teardown.http') return ` (${step.requests} requests, ${step.failed} failed)`
  if (step.name === 'database.asserted') return ` (${step.database}: ${step.rows} rows${step.error ? `, error: ${step.error}` : ''})`
  if (step.name === 'request.sent') return ` (${step.method} ${step.url})`
  if (step.name === 'database.connected') return ` (${step.databaseName}: ${step.host}:${step.port}/${step.database})`
  if (step.name === 'probe.sent') return ` (${step.description}: ${step.status === null ? `error ${step.error}` : `HTTP ${step.status}`})`
  return ''
}

function cell(text) {
  return String(text ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function fmt(value) {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function rowsToTable(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '_no rows_'
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  const lines = [`| ${columns.join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`]
  for (const row of rows) lines.push(`| ${columns.map((column) => cell(fmt(row[column]))).join(' | ')} |`)
  return lines.join('\n')
}

/**
 * A compact one-screen summary for the tool result: the verdict, what failed, and
 * where the full report is. The long form is written next to the case.
 */
export function renderSummary(report, options = {}) {
  const lines = []
  lines.push(`${ICON[report.verdict] || report.verdict}  ${report.caseId} — ${report.title}`)
  lines.push(`verdict: ${report.verdict}   duration: ${report.durationMs}ms   traceId: ${report.traceId}`)
  if (report.fatal) lines.push(`fatal: ${report.fatal.message}`)
  const failed = report.failedChecks
  if (failed.length > 0) {
    lines.push('')
    lines.push(`failed assertions (${failed.length}):`)
    for (const check of failed.slice(0, 8)) {
      lines.push(`  ❌ ${check.label}: expected ${fmt(check.expected)}, got ${fmt(check.actual)}`)
    }
    if (failed.length > 8) lines.push(`  … and ${failed.length - 8} more`)
  } else if (report.checks.length > 0) {
    lines.push(`all ${report.checks.length} assertions passed`)
  }
  if (report.evidence.response) {
    lines.push('')
    lines.push(`HTTP ${report.evidence.response.status} in ${report.evidence.response.durationMs}ms`)
  }
  if (report.evidence.logs) {
    const logs = report.evidence.logs
    lines.push(`logs: ${logs.scopedLines}/${logs.totalLines} lines matched traceId${logs.traceIdPresent ? '' : ' (trace id absent from the log — scanned every line)'}`)
  }
  if (report.evidence.database.length > 0) {
    const counts = report.evidence.database.map((item) => `${item.database}: ${item.rowCount} rows`).join(', ')
    lines.push(`database: ${counts}`)
  }
  if (Array.isArray(report.warnings) && report.warnings.length > 0) {
    lines.push('')
    lines.push('warnings:')
    for (const warning of report.warnings) lines.push(`  ⚠️ ${warning}`)
  }
  if (report.teardown && report.teardown.errors.length > 0) {
    lines.push('')
    lines.push('teardown warnings:')
    for (const error of report.teardown.errors) lines.push(`  ⚠️ ${error}`)
  }
  if (options.reportPath) {
    lines.push('')
    lines.push(`full report: ${options.reportPath}`)
  }
  return lines.join('\n')
}
