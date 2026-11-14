import { PgClient } from '../src/pg.js'

const client = new PgClient({
  host: '127.0.0.1',
  port: 15432,
  database: 'postgres',
  user: 'gaussdb',
  password: 'Gauss#Db2026',
  schema: 'public',
})

try {
  await client.connect()
  console.log('connected')
  const version = await client.queryOne('select version() as v, current_database() as db, current_schema() as sch, current_user as usr')
  console.log('meta:', version)
  const tables = await client.query("select table_schema, table_name from information_schema.tables where table_schema in ('public','gaussdb') order by 1,2")
  console.log('tables:', tables)
  const users = await client.query('select count(*) as c from users')
  console.log('users count:', users)
  const typed = await client.query("select 1::int as i, 'x' as s, now() as ts, true as b, null::text as n, 1.5::numeric as num")
  console.log('typed:', typed)
} catch (error) {
  console.error('FAILED:', error.message)
  process.exitCode = 1
} finally {
  client.close()
}
