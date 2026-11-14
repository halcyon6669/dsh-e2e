import { scanProject } from '../src/scan.js'

const result = await scanProject({ projectPath: 'E:/project/backend/Record' })
console.log('scannedFiles:', result.scannedFiles)
console.log('controllers:', result.controllers.map((c) => `${c.name}${c.base}`).join(', '))
console.log('')
for (const endpoint of result.endpoints) {
  console.log(`${endpoint.httpMethod.padEnd(6)} ${endpoint.path.padEnd(28)} ${endpoint.controller}.${endpoint.javaMethod || '?'}  (line ${endpoint.line})`)
  if (endpoint.requestBody) {
    const fields = endpoint.requestBody.fields
    if (fields === null) {
      console.log(`         body: ${endpoint.requestBody.type} (unresolved)`)
    } else {
      for (const field of fields) {
        const bits = []
        if (field.required) bits.push('required')
        if (field.minLength !== null) bits.push(`min=${field.minLength}`)
        if (field.maxLength !== null) bits.push(`max=${field.maxLength}`)
        if (field.pattern) bits.push('pattern')
        if (field.email) bits.push('email')
        console.log(`         ${field.type} ${field.name} ${bits.length ? '[' + bits.join(' ') + ']' : ''}`)
      }
    }
  }
}
console.log('')
console.log('entities:', result.entities.map((e) => `${e.name} -> ${e.table} (${e.columns.join(', ')})`).join('; '))
if (result.warnings.length) {
  console.log('')
  console.log('warnings:')
  for (const warning of result.warnings) console.log(' -', warning)
}
