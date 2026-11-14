import { generateFromSource } from '../src/scaffold.js'
import { parseYaml } from '../src/yaml.js'
import { normalizeCase } from '../src/case.js'

const cases = [
  { path: '/auth/register', method: 'POST', database: 'iam' },
  { path: '/auth/confirmCode', method: 'POST', database: 'iam' },
  { path: '/auth/login/hs512', method: 'POST' },
  { path: '/test', method: 'GET' },
  { path: '/auth/resendActiveCode', method: 'GET' },
  { path: '/refreshToken', method: 'POST' },
]

let failed = 0
for (const spec of cases) {
  const result = await generateFromSource({
    projectPath: 'E:/project/backend/Record',
    target: 'record-local',
    schema: 'public',
    ...spec,
  })
  const parsed = await parseYaml(result.yaml, `skeleton ${spec.path}`)
  // Normalise the way a real case file would be, so a skeleton that cannot load is
  // caught here rather than when someone tries to run it.
  const normalised = await normalizeCase(parsed, null, `skeleton ${spec.path}`)
  const body = normalised.request.bodyJson
  const hasNull = body && Object.values(body).some((value) => value === null)
  console.log(
    `${spec.method.padEnd(5)} ${spec.path.padEnd(24)} id=${normalised.id.padEnd(28)}`,
    `vars=${Object.keys(normalised.request.variables).length}`,
    `body=${body ? JSON.stringify(body) : '-'}`,
    hasNull ? ' <-- has null fields' : '',
  )
  if (!normalised.id) failed += 1
}

// The generator must refuse an ambiguous or unknown endpoint instead of guessing.
const refusals = [
  { path: '/does-not-exist', method: 'GET' },
  { path: '/auth/register', method: 'GET' },
]
for (const spec of refusals) {
  try {
    await generateFromSource({ projectPath: 'E:/project/backend/Record', target: 'record-local', ...spec })
    console.log('FAILED: expected a refusal for', spec.path, spec.method)
    failed += 1
  } catch (error) {
    console.log(`refused ${spec.method} ${spec.path}: ${error.message.slice(0, 110)}`)
  }
}

console.log(failed === 0 ? '\nall skeletons load' : `\n${failed} problem(s)`)
process.exitCode = failed === 0 ? 0 : 1
