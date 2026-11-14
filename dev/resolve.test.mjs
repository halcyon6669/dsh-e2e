import { loadCaseFile } from '../src/case.js'
import { resolveEnvironment, describeEnvironment } from '../src/resolve.js'

for (const file of ['examples/auth-register.yaml', 'examples/auth-confirm-code.yaml']) {
  const { definition } = await loadCaseFile(file)
  console.log('---', file, definition.id)
  console.log('env.databases:', JSON.stringify(definition.env.databases))
  try {
    const resolved = await resolveEnvironment(definition, { config: {} })
    console.log('resolved:', JSON.stringify(describeEnvironment(resolved), null, 2))
  } catch (error) {
    console.log('RESOLVE FAILED:', error.message)
  }
}
