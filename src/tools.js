/**
 * dsh-e2e — the agent-facing tools.
 *
 * Five tools, each a fixed action. None of them runs a shell command, and none of
 * them takes SQL from the model: the case file is the only place a statement or a
 * request can come from. That is the safety boundary — the agent chooses *which*
 * case to run, not what the case does.
 *
 * The same implementations back the panel (./panel.js), so a run started from the
 * browser and a run started by the agent produce the same report.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loadCaseFile, loadCaseDirectory, CaseError } from './case.js'
import { runCase, redactReport } from './runner.js'
import { renderSummary } from './report.js'
import { probeIdea } from './idea.js'
import { checkTargets } from './guard.js'
import { resolveEnvironment, describeEnvironment } from './resolve.js'
import { loadRegistry, describeDatabase, knownNames } from './registry.js'
import { caseRoots, listCasesIn, readReport, writeReport } from './store.js'

const TOOL_TIMEOUT_MS = 15 * 60 * 1000

const textOutput = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
}

export function createTools(options) {
  const { ctx, state, config } = options

  function toolsService() {
    try {
      if (typeof ctx.get === 'function') return ctx.get('tools')
      return ctx.tools
    } catch {
      return undefined
    }
  }

  const roots = () => caseRoots({ config, state })

  /** Loads the registry the way a run would, so the listing matches reality. */
  async function loadRunRegistry() {
    const dirs = roots()
    return loadRegistry({ config, caseDir: dirs[0] || null, env: process.env })
  }

  const definitions = [
    {
      name: 'e2e_list_cases',
      description:
        'List the E2E case files under the configured case directory (or one you name). Each entry shows the case id, what it covers, the target it runs against and the databases it names. Call this before e2e_run_case to see what is available.',
      parameters: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: "Case directory to scan. Defaults to the plugin's configured caseDir." },
        },
        additionalProperties: false,
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const dirs = args && args.dir ? [resolve(String(args.dir))] : roots()
        if (dirs.length === 0) {
          return { ok: false, error: 'no case directory configured; set config.caseDir in the plugin settings or pass dir' }
        }
        const results = []
        for (const dir of dirs) {
          try {
            results.push(await listCasesIn(dir))
          } catch (error) {
            results.push({ dir, error: error.message, cases: [], failures: [] })
          }
        }
        return { ok: results.every((item) => !item.error), dirs: results }
      },
    },
    {
      name: 'e2e_list_databases',
      description:
        'List the databases a case may name: the entries in e2e.registry.yml plus whatever is imported from dsh-db-mcp. Shows host, port, database, user, schema and whether a password is configured — never the password itself. Call this before writing a case, so the case names a database that actually exists.',
      parameters: {
        type: 'object',
        properties: {
          caseDir: { type: 'string', description: 'Directory whose e2e.registry.yml to read. Defaults to the configured caseDir.' },
        },
        additionalProperties: false,
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const dir = args && args.caseDir ? resolve(String(args.caseDir)) : roots()[0] || null
        let registry
        try {
          registry = await loadRegistry({ config, caseDir: dir, env: process.env })
        } catch (error) {
          return { ok: false, error: error.message, registryFile: null, databases: [], targets: [] }
        }
        const databases = []
        for (const name of knownNames(registry, 'databases')) {
          try {
            databases.push(await describeDatabase(registry, name))
          } catch (error) {
            databases.push({ name, error: error.message })
          }
        }
        return {
          ok: true,
          registryFile: registry.file,
          targets: knownNames(registry, 'targets').map((name) => ({
            name,
            baseUrl: registry.targets[name] && registry.targets[name].baseUrl ? registry.targets[name].baseUrl : null,
            configurationName:
              registry.targets[name] && registry.targets[name].configurationName
                ? registry.targets[name].configurationName
                : null,
            projectPath:
              registry.targets[name] && registry.targets[name].projectPath ? registry.targets[name].projectPath : null,
          })),
          databases,
        }
      },
    },
    {
      name: 'e2e_probe_environment',
      description:
        'Check whether this machine can actually run an E2E case right now: is the IDE MCP server reachable, which run configurations does it expose for the project, and does the target base URL answer. Run this first when a case fails to start the service.',
      parameters: {
        type: 'object',
        properties: {
          projectPath: { type: 'string', description: 'Project path as the IDE knows it, e.g. E:/project/backend/Record.' },
          baseUrl: { type: 'string', description: 'Base URL the service should answer on, e.g. https://127.0.0.1:8443.' },
          idePort: { type: 'integer', description: 'IDE MCP port. Defaults to the configured port (64342).' },
        },
        additionalProperties: false,
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const port = Number((args && args.idePort) || config.idePort || 64342)
        const probe = await probeIdea(config.ideHost || '127.0.0.1', port)
        const result = { idePort: port, ide: probe, runConfigurations: null, service: null }
        if (probe.reachable && !probe.restricted) {
          const { IdeaClient } = await import('./idea.js')
          const client = new IdeaClient({ host: config.ideHost || '127.0.0.1', port, timeoutMs: 20000 })
          try {
            await client.connect()
            result.serverInfo = client.serverInfo
            const configs = await client.callTool(
              'get_run_configurations',
              args && args.projectPath ? { projectPath: String(args.projectPath) } : {},
            )
            const listed = configs.structured && Array.isArray(configs.structured.configurations) ? configs.structured.configurations : []
            result.runConfigurations = listed.map((entry) => ({
              name: entry.name,
              description: entry.description,
              supportsDynamicLaunchOverrides: entry.supportsDynamicLaunchOverrides === true,
            }))
          } catch (error) {
            result.ideError = error.message
          } finally {
            client.close()
          }
        }
        if (args && args.baseUrl) {
          const { sendRequest } = await import('./http.js')
          try {
            const response = await sendRequest({ url: String(args.baseUrl), method: 'GET', timeoutMs: 5000, insecureTls: true })
            result.service = { reachable: true, status: response.status }
          } catch (error) {
            result.service = { reachable: false, error: error.message }
          }
        }
        return result
      },
    },
    {
      name: 'e2e_run_case',
      description:
        'Run one E2E case file end to end: start the real service through its IDE run configuration, run setup SQL, send the real HTTP request with a trace id, collect the log lines that carry that trace id, read the database terminal state, assert everything, then tear down and stop the service. Returns the verdict plus the evidence; the full report is written next to the run. A case that fails is a normal result — read the failed assertions.',
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Path to the case YAML. Relative paths resolve against the configured caseDir.' },
          caseId: { type: 'string', description: 'Case id to find in the configured caseDir, when you would rather not pass a path.' },
          allowRemote: { type: 'boolean', description: 'Permit a non-loopback, non-private target. Still refused if it looks like production.' },
          allowWrites: { type: 'boolean', description: 'Permit setup/teardown SQL to modify the database. Off by default.' },
          keepServiceRunning: { type: 'boolean', description: 'Leave the service running after the run (useful when iterating on one case).' },
          idePort: { type: 'integer', description: 'IDE MCP port override.' },
          traceHeader: { type: 'string', description: 'Header used to carry the trace id. Defaults to X-Trace-Id.' },
        },
        additionalProperties: false,
      },
      isConcurrencySafe: () => false,
      async execute(args) {
        const input = args && typeof args === 'object' ? args : {}
        const dirs = roots()
        let filePath = null
        if (input.file) {
          filePath = resolve(dirs[0] || process.cwd(), String(input.file))
        } else if (input.caseId) {
          // `caseId` is the stable, quotable name (`REG-002`); `id` is the file
          // slug. Accept either, because a person who read a report will quote the
          // caseId, while one who read a filename will quote the id — and asking
          // them to know which is which is a needless way to fail.
          const wanted = String(input.caseId)
          const seen = []
          for (const dir of dirs) {
            try {
              const { cases } = await loadCaseDirectory(dir)
              const hit = cases.find(
                (entry) => String(entry.definition.caseId) === wanted || String(entry.definition.id) === wanted,
              )
              if (hit) {
                filePath = hit.path
                break
              }
              for (const entry of cases) seen.push(String(entry.definition.caseId))
            } catch {
              /* try the next root */
            }
          }
          if (!filePath) {
            const known = seen.length > 0 ? `; known ids: ${seen.slice(0, 12).join(', ')}` : ''
            return { ok: false, error: `no case with id "${input.caseId}" under ${dirs.join(', ') || '(no caseDir configured)'}${known}` }
          }
        } else {
          return { ok: false, error: 'pass either file or caseId' }
        }

        let loaded
        try {
          loaded = await loadCaseFile(filePath)
        } catch (error) {
          const message = error instanceof CaseError ? error.message : `cannot load ${filePath}: ${error.message}`
          return { ok: false, error: message }
        }
        state.lastCaseDir = loaded.dir

        // Names become connections here, before the guard looks at anything: the
        // case only says "database billing, schema audit", so the host that will
        // actually be dialled is only knowable after the registry lookup.
        let resolved
        try {
          resolved = await resolveEnvironment(loaded.definition, { config, env: process.env })
        } catch (error) {
          return { ok: false, verdict: 'refused', error: error.message, caseId: loaded.definition.caseId || loaded.definition.id }
        }

        const guardOptions = {
          allowRemote: input.allowRemote === true,
          allowWrites: input.allowWrites === true,
          idePort: Number(input.idePort || config.idePort || 64342),
        }
        const problems = await checkTargets(loaded.definition, resolved, guardOptions)
        if (problems.length > 0) {
          return {
            ok: false,
            verdict: 'refused',
            error: `refusing to run case "${loaded.definition.caseId || loaded.definition.id}"`,
            caseId: loaded.definition.caseId || loaded.definition.id,
            environment: describeEnvironment(resolved),
            problems,
          }
        }

        const { report, secrets } = await runCase(loaded.definition, {
          ...guardOptions,
          resolved,
          config,
          ideHost: config.ideHost || '127.0.0.1',
          ideTimeoutMs: config.ideTimeoutMs || 60000,
          keepServiceRunning: input.keepServiceRunning === true,
          traceHeader: input.traceHeader ? String(input.traceHeader) : config.traceHeader || 'X-Trace-Id',
          maxBodyChars: config.maxBodyChars || 8000,
          logSettleMs: config.logSettleMs,
        })

        const safe = redactReport(report, secrets)
        const written = await writeReport(safe, { reportDir: config.reportDir, state })
        return {
          ok: safe.verdict === 'passed',
          verdict: safe.verdict,
          caseId: safe.caseId,
          title: safe.title,
          endpoint: safe.endpoint,
          scenario: safe.scenario,
          priority: safe.priority,
          durationMs: safe.durationMs,
          traceId: safe.traceId,
          checks: safe.checks.length,
          failed: safe.failedChecks.map((check) => ({
            label: check.label,
            expected: check.expected,
            actual: check.actual,
            detail: check.detail,
          })),
          warnings: safe.warnings || [],
          fatal: safe.fatal ? safe.fatal.message : null,
          reportPath: written.mdPath,
          jsonPath: written.jsonPath,
          summary: renderSummary(safe, { reportPath: written.mdPath }),
        }
      },
    },
    {
      name: 'e2e_read_report',
      description:
        'Read a previously written E2E report (markdown by default, or the structured JSON). Use it to re-read evidence from an earlier run without re-running the case.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Report path as returned by e2e_run_case.' },
          format: { type: 'string', enum: ['markdown', 'json'], description: 'Defaults to markdown.' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const requested = String((args && args.path) || '')
        try {
          const result = await readReport(requested, { reportDir: config.reportDir, state })
          if ((args && args.format) === 'json' || result.format === 'json') {
            return { ok: true, path: result.path, report: result.report }
          }
          return { ok: true, path: result.path, markdown: result.markdown }
        } catch (error) {
          // A path outside the report directory is refused there; fall back to a
          // plain read so an old absolute path the user already has still works.
          try {
            const text = await readFile(resolve(requested), 'utf8')
            if ((args && args.format) === 'json') return { ok: true, path: resolve(requested), report: JSON.parse(text) }
            return { ok: true, path: resolve(requested), markdown: text }
          } catch {
            return { ok: false, error: error.message }
          }
        }
      },
    },
    {
      name: 'e2e_scan_endpoints',
      description:
        'Read a Spring project\'s source and list the HTTP endpoints it serves (controller, method, path, request body DTO fields). Use this before writing a case by hand: it answers "what can I even test here" from the code rather than from guesswork. Read-only.',
      parameters: {
        type: 'object',
        properties: {
          projectPath: {
            type: 'string',
            description: 'Project root to scan. Defaults to the first registry target that has a projectPath.',
          },
        },
        additionalProperties: false,
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const { scanProject } = await import('./scan.js')
        let projectPath = args && args.projectPath ? String(args.projectPath) : null
        if (!projectPath) {
          const registry = await loadRunRegistry()
          for (const name of knownNames(registry, 'targets')) {
            const target = registry.targets[name]
            if (target && target.projectPath) {
              projectPath = target.projectPath
              break
            }
          }
        }
        if (!projectPath) {
          return {
            ok: false,
            error: 'no project path: pass projectPath, or give a registry target one',
          }
        }
        try {
          const result = await scanProject({ projectPath })
          // The tool result must be lossless JSON: an `undefined` property (a DTO
          // field with no constraints, say) makes the host reject the whole answer.
          // One round trip through JSON drops them and proves the shape is serialisable.
          return JSON.parse(
            JSON.stringify({
              ok: true,
              projectPath: result.root,
              scannedFiles: result.scannedFiles,
              controllers: result.controllers,
              entities: result.entities,
              warnings: result.warnings,
              endpoints: result.endpoints.map((endpoint) => ({
                method: endpoint.httpMethod,
                path: endpoint.path,
                controller: endpoint.controller,
                javaMethod: endpoint.javaMethod,
                file: endpoint.file,
                line: endpoint.line,
                requestBody: endpoint.requestBody
                  ? {
                      type: endpoint.requestBody.type,
                      fields: endpoint.requestBody.fields
                        ? endpoint.requestBody.fields.map((field) => ({
                            name: field.name,
                            type: field.type,
                            required: Boolean(field.required),
                            // Only the constraints the source actually declared, so a
                            // field with no annotations stays visibly unconstrained
                            // instead of looking validated with empty values.
                            ...(field.minLength !== null && field.minLength !== undefined
                              ? { minLength: field.minLength }
                              : {}),
                            ...(field.maxLength !== null && field.maxLength !== undefined
                              ? { maxLength: field.maxLength }
                              : {}),
                            ...(field.pattern ? { pattern: field.pattern } : {}),
                            ...(field.email ? { email: true } : {}),
                          }))
                        : null,
                    }
                  : null,
              })),
            }),
          )
        } catch (error) {
          return { ok: false, error: error.message }
        }
      },
    },
    {
      name: 'e2e_scaffold_case',
      description:
        'Turn one endpoint found by e2e_scan_endpoints into a case skeleton: request path, method, sample body built from the DTO constraints, and TODO comments for the assertions only a human can decide. Returns YAML without writing a file — save it with the panel, or write it yourself and pass it to e2e_run_case.',
      parameters: {
        type: 'object',
        properties: {
          projectPath: { type: 'string', description: 'Project root. Defaults to the registry target.' },
          path: { type: 'string', description: 'Endpoint path, e.g. /auth/register.' },
          method: { type: 'string', description: 'HTTP method. Required only when the path serves several.' },
          target: { type: 'string', description: 'Registry target name to put in env.target. Defaults to the first target.' },
          database: { type: 'string', description: 'Registry database name to put in env.databases.default.name.' },
          schema: { type: 'string', description: 'Schema override for that database.' },
          id: { type: 'string', description: 'Case id. Defaults to a slug of the method and path.' },
          expectStatus: { type: 'number', description: 'Only if you already know it. Omitted on purpose otherwise.' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const { generateFromSource } = await import('./scaffold.js')
        const input = args || {}
        try {
          const registry = await loadRunRegistry()
          let target = input.target ? String(input.target) : null
          if (!target) {
            const names = knownNames(registry, 'targets')
            target = names.length > 0 ? names[0] : null
          }
          if (!target) {
            return { ok: false, error: 'no registry target to reference: add one to e2e.registry.yml' }
          }
          let projectPath = input.projectPath ? String(input.projectPath) : null
          if (!projectPath) {
            for (const name of knownNames(registry, 'targets')) {
              const candidate = registry.targets[name]
              if (candidate && candidate.projectPath) {
                projectPath = candidate.projectPath
                break
              }
            }
          }
          const result = await generateFromSource({
            projectPath,
            path: input.path,
            method: input.method,
            target,
            database: input.database,
            schema: input.schema,
            id: input.id,
            expectStatus: input.expectStatus,
          })
          return {
            ok: true,
            id: result.id,
            target,
            yaml: result.yaml,
            endpoint: {
              method: result.endpoint.httpMethod,
              path: result.endpoint.path,
              controller: result.endpoint.controller,
              javaMethod: result.endpoint.javaMethod,
              file: result.endpoint.file,
              line: result.endpoint.line,
            },
            notes: result.notes,
            warnings: result.scan.warnings,
          }
        } catch (error) {
          return { ok: false, error: error.message }
        }
      },
    },
  ]

  const service = toolsService()
  if (!service || typeof service.register !== 'function') {
    throw new Error('the host tools service is unavailable, so the E2E tools cannot be published')
  }
  const disposers = definitions.map((definition) =>
    service.register({
      ...definition,
      timeoutMs: definition.timeoutMs || TOOL_TIMEOUT_MS,
      output: textOutput,
    }),
  )
  return {
    toolNames: definitions.map((definition) => definition.name),
    dispose() {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* the host is already tearing down */
        }
      }
    },
  }
}
