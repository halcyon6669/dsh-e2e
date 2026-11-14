import { IdeaClient } from '../src/idea.js'

const client = new IdeaClient({ port: 64342, timeoutMs: 60000 })
const projectPath = 'E:/project/backend/Record'
try {
  await client.connect()
  await client.listTools()

  const started = await client.callTool('execute_run_configuration', {
    configurationName: 'RecordApplication',
    waitForExit: false,
    projectPath,
  })
  console.log('--- execute_run_configuration ---')
  console.log('text:', started.text.slice(0, 800))
  console.log('structured:', JSON.stringify(started.structured, null, 2)?.slice(0, 1200))

  await new Promise((r) => setTimeout(r, 9000))

  const out = await client.callTool('xdebug_get_process_output', { maxLines: 25, projectPath })
  console.log('--- xdebug_get_process_output ---')
  console.log('text:', out.text.slice(0, 1500))
  console.log('structured keys:', out.structured ? Object.keys(out.structured) : null)
  if (out.structured) console.log(JSON.stringify(out.structured, null, 2).slice(0, 1500))
} catch (error) {
  console.error('FAILED:', error.message)
  process.exitCode = 1
} finally {
  client.close()
}
