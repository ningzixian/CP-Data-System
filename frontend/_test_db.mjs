// Quick DB connectivity test
import mysql from 'mysql2/promise'
import pg from 'pg'

const { Client: PgClient } = pg

console.log('=== MySQL test ===')
try {
  const c = await mysql.createConnection({
    host: '192.168.0.253',
    port: 3306,
    user: 'mysql-prod',
    password: 'abcd1234',
    connectTimeout: 10000,
  })
  const [v] = await c.query('SELECT VERSION() AS v, USER() AS u')
  console.log('[MySQL] connected:', v[0])
  const [dbs] = await c.query('SHOW DATABASES')
  console.log('[MySQL] databases:', dbs.map((r) => r.Database).join(', '))
  const [charsets] = await c.query("SHOW VARIABLES LIKE 'character_set%'")
  console.log('[MySQL] charsets:', charsets)
  await c.end()
} catch (e) {
  console.log('[MySQL] FAIL:', e.message)
}

console.log('\n=== PostgreSQL test ===')
try {
  const c = new PgClient({
    host: '192.168.0.253',
    port: 5432,
    user: 'postgres-prod',
    password: 'abcd1234',
    connectionTimeoutMillis: 10000,
  })
  await c.connect()
  const v = await c.query('SELECT version() AS v, current_user AS u')
  console.log('[PG] connected:', v.rows[0])
  const dbs = await c.query("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname")
  console.log('[PG] databases:', dbs.rows.map((r) => r.datname).join(', '))
  await c.end()
} catch (e) {
  console.log('[PG] FAIL:', e.message)
}
