import { IdeaClient, probeIdea } from '../src/idea.js'

const probe = await probeIdea('127.0.0.1', 64342)
console.log('probe:', probe)

const client = new IdeaClient({ port: 64342, timeoutMs: 30000 })
try {
  await client.connect()
  console.log('serverInfo:', client.serverInfo)
  const tools = await client.listTools()
  console.log('tool count:', tools.length)
  console.log('sample:', tools.slice(0, 8).map((tool) => tool.name).join(', '))

  const configs = await client.callTool('get_run_configurations', { projectPath: 'E:/project/backend/Record' })
  console.log('get_run_configurations text:')
  console.log(configs.text.slice(0, 1200))
  if (configs.structured) console.log('structured keys:', Object.keys(configs.structured))
} catch (error) {
  console.error('FAILED:', error.message)
  process.exitCode = 1
} finally {
  client.close()
}
