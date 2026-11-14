// Probe: does the registry load, and can a database declared as `from: db-mcp`
// actually borrow the password that dsh-db-mcp stored encrypted?
//
// The shipped example registry keeps its db-mcp entry commented out, because an
// id that is right on one machine is wrong on every other one. So this probe
// tests two things separately:
//
//   1. the example registry loads as shipped (no db-mcp dependency)
//   2. the db-mcp import works *on this machine*, using whatever datasource this
//      machine actually has — built into a throwaway registry so the example
//      stays portable
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadRegistry, resolveDatabase, describeDatabase, knownNames } from '../src/registry.js'

const registry = await loadRegistry({ config: {}, caseDir: 'examples' })
console.log('file:', registry.file)
console.log('targets:', knownNames(registry, 'targets'))
console.log('databases:', knownNames(registry, 'databases'))
for (const name of knownNames(registry, 'databases')) {
  try {
    console.log(' ', name, JSON.stringify(await describeDatabase(registry, name)))
  } catch (error) {
    console.log(' ', name, 'FAILED:', error.message)
  }
}

// A typo must name the alternatives — that is the whole point of the lookup.
try {
  await resolveDatabase(registry, 'definitely-not-a-database', {})
  console.log('unknown-name check: FAILED — resolving a bogus name did not throw')
  process.exitCode = 1
} catch (error) {
  console.log('unknown-name check:', error.message)
}

// --- the db-mcp import, against this machine's real datasources -------------

const dbMcpDir = process.env.DSH_DB_MCP_DIR || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh', 'db-mcp')
let sources = []
try {
  const parsed = JSON.parse(await readFile(join(dbMcpDir, 'datasources.json'), 'utf8'))
  sources = Array.isArray(parsed.datasources) ? parsed.datasources : []
} catch (error) {
  console.log(`db-mcp import: skipped — no datasources.json under ${dbMcpDir} (${error.message})`)
}

const pgKinds = new Set(['postgres', 'postgresql', 'pg', 'gauss', 'gaussdb', 'opengauss', 'open-gauss'])
const candidate = sources.find((source) => pgKinds.has(String(source.kind || '').toLowerCase()))

if (!sources.length) {
  // already reported above
} else if (!candidate) {
  console.log(
    'db-mcp import: skipped — no PostgreSQL-family datasource to import;',
    `dsh-db-mcp has ${sources.map((source) => `${source.id}(${source.kind})`).join(', ')}`,
  )
} else {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-e2e-registry-'))
  const file = join(dir, 'e2e.registry.yml')
  try {
    await writeFile(
      file,
      [
        'databases:',
        '  imported:',
        '    from: db-mcp',
        `    id: ${candidate.id}`,
        '    schema: public',
        '',
      ].join('\n'),
      'utf8',
    )
    const temp = await loadRegistry({ config: { registryFile: file } })
    const resolved = await resolveDatabase(temp, 'imported', { schema: 'public' })
    console.log(
      `db-mcp import "${candidate.id}" -> ${resolved.source} ${resolved.kind} ` +
        `${resolved.host}:${resolved.port}/${resolved.database} schema=${resolved.schema}`,
      `password configured: ${Boolean(resolved.password)} (len ${resolved.password ? resolved.password.length : 0})`,
    )
    const summary = await describeDatabase(temp, 'imported')
    if (JSON.stringify(summary).includes('"password"')) {
      console.log('db-mcp import: FAILED — describeDatabase leaked a password field')
      process.exitCode = 1
    }
    if (!resolved.password) {
      console.log('db-mcp import: FAILED — the datasource has a stored secret but decryption produced nothing')
      process.exitCode = 1
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
