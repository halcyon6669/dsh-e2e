/**
 * dsh-e2e — turning a case into everything a run needs.
 *
 * A case names a *target* and a set of *databases*; it never carries a host, a
 * port or a password. This module is the one place those names become concrete:
 * it merges three layers, in this order of increasing authority —
 *
 *   1. the registry (`e2e.registry.yml`, or the plugin config, or dsh-db-mcp's
 *      own datasource list via `from: db-mcp`),
 *   2. the case's `env` block (which may override a target field inline, for a
 *      one-off local run),
 *   3. the tool call's own arguments (idePort, allowWrites, ...), which are not
 *      part of this module.
 *
 * Keeping the merge here — rather than scattered through the runner — is what
 * makes the error messages useful: when a name is unknown, the message can list
 * what *is* known and say which file to edit.
 */
import { loadRegistry, resolveDatabase, resolveTarget, knownNames, RegistryError } from './registry.js'

const DEFAULT_START_TIMEOUT_MS = 120000

export class ResolveError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'ResolveError'
    Object.assign(this, details)
  }
}

/**
 * Resolves one case to a concrete environment.
 *
 * `databases` keeps the *case's* key as the lookup name, because that is what
 * `expect.database[].database` and `setup.capture[].database` refer to; the
 * registry entry it points at may have a different name entirely.
 */
export async function resolveEnvironment(definition, options = {}) {
  const { config = {}, env = process.env } = options
  const caseDir = definition.dir || null

  let registry
  try {
    registry = await loadRegistry({ config, caseDir, env })
  } catch (error) {
    if (error instanceof RegistryError) throw new ResolveError(error.message, { cause: error })
    throw error
  }

  const targetName = definition.env.target || null
  let target
  try {
    target = resolveTarget(registry, targetName, {
      // Inline values in the case win, so a case can point at a service that is
      // already running without inventing a registry entry for it.
      projectPath: definition.env.projectPath,
      configurationName: definition.env.configurationName,
      baseUrl: definition.env.baseUrl,
      healthPath: definition.env.healthPath,
      profile: definition.env.profile,
      insecureTls: definition.env.insecureTls === true ? true : undefined,
      startTimeoutMs: definition.env.startTimeoutMs,
    })
  } catch (error) {
    if (error instanceof RegistryError) throw new ResolveError(error.message, { cause: error })
    throw error
  }

  if (target.insecureTls !== true) target.insecureTls = definition.env.insecureTls === true
  if (!target.baseUrl) {
    throw new ResolveError(
      `case "${definition.id}" has no base URL: set env.baseUrl, or name a target with "target:" and define its baseUrl in the registry` +
        describeRegistry(registry),
    )
  }
  if (!target.configurationName && definition.env.serviceRequired) {
    throw new ResolveError(
      `case "${definition.id}" does not name the IDE run configuration that starts the service: ` +
        `set env.configurationName, or put it on the target it references in the registry` +
        describeRegistry(registry),
    )
  }

  const databases = {}
  for (const [key, ref] of Object.entries(definition.env.databases || {})) {
    const lookup = ref.name && ref.name !== key ? ref.name : key
    let resolved
    try {
      resolved = await resolveDatabase(registry, lookup, { schema: ref.schema })
    } catch (error) {
      if (error instanceof RegistryError) {
        throw new ResolveError(
          `case "${definition.id}" reads database "${key}" (registry name "${lookup}"): ${error.message}. ` +
            `A case names a database; the connection lives in e2e.registry.yml or in dsh-db-mcp.`,
          { cause: error, database: key },
        )
      }
      throw error
    }
    databases[key] = { ...resolved, alias: key, description: ref.description || resolved.description }
  }

  return {
    target: {
      name: target.name,
      source: target.source,
      baseUrl: target.baseUrl,
      healthPath: target.healthPath,
      projectPath: target.projectPath,
      configurationName: target.configurationName,
      profile: target.profile,
      insecureTls: target.insecureTls,
      startTimeoutMs: target.startTimeoutMs || DEFAULT_START_TIMEOUT_MS,
    },
    databases,
    registry,
    keepServiceRunning: definition.env.keepServiceRunning === true,
    serviceRequired: definition.env.serviceRequired !== false,
    mocks: definition.env.mocks || null,
  }
}

function describeRegistry(registry) {
  const targets = knownNames(registry, 'targets')
  const databases = knownNames(registry, 'databases')
  const where = registry && registry.file ? `the registry at ${registry.file}` : 'the registry (none found)'
  return (
    `\n  ${where} defines targets: ${targets.join(', ') || 'none'}; databases: ${databases.join(', ') || 'none'}.` +
    `\n  Add the entry there, or run \`e2e_list_databases\` to see what is available.`
  )
}

/** A credential-free view of one resolved environment, for reports and the panel. */
export function describeEnvironment(resolved) {
  return {
    target: resolved.target.name || null,
    baseUrl: resolved.target.baseUrl,
    configurationName: resolved.target.configurationName,
    projectPath: resolved.target.projectPath,
    profile: resolved.target.profile || null,
    registry: resolved.registry ? resolved.registry.file : null,
    databases: Object.fromEntries(
      Object.entries(resolved.databases).map(([key, item]) => [
        key,
        {
          registryName: item.registryName || item.name,
          source: item.source,
          kind: item.kind,
          host: item.host,
          port: item.port,
          database: item.database,
          schema: item.schema || '',
        },
      ]),
    ),
  }
}
