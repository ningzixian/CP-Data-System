// Try multiple credential variations
import mysql from 'mysql2/promise'
import pg from 'pg'

const { Client: PgClient } = pg

const mysqlCandidates = [
  { user: 'mysql-prod', password: 'abcd1234' },
  { user: 'mysql_prod', password: 'abcd1234' },
  { user: 'mysqlprod', password: 'abcd1234' },
  { user: 'root', password: 'abcd1234' },
]

console.log('=== MySQL user probes ===')
for (const cand of mysqlCandidates) {
  try {
    const c = await mysql.createConnection({
      host: '192.168.0.253', port: 3306,
      user: cand.user, password: cand.password, connectTimeout: 8000,
    })
    const [v] = await c.query('SELECT VERSION() AS v, USER() AS u, CURRENT_USER() AS cu')
    console.log(`[MySQL] OK user="${cand.user}":`, v[0])
    const [dbs] = await c.query('SHOW DATABASES')
    console.log(`[MySQL] dbs:`, dbs.map((r) => r.Database).join(', '))
    await c.end()
    break
  } catch (e) {
    console.log(`[MySQL] FAIL user="${cand.user}": ${e.message}`)
  }
}

const pgCandidates = [
  { user: 'postgres-prod', password: 'abcd1234' },
  { user: 'postgres_prod', password: 'abcd1234' },
  { user: 'postgresprod', password: 'abcd1234' },
  { user: 'postgres', password: 'abcd1234' },
]

console.log('\n=== PG user probes ===')
for (const cand of pgCandidates) {
  try {
    const c = new PgClient({
      host: '192.168.0.253', port: 5432,
      user: cand.user, password: cand.password, connectionTimeoutMillis: 8000,
    })
    await c.connect()
    const v = await c.query('SELECT version() AS v, current_user AS u, session_user AS su')
    console.log(`[PG] OK user="${cand.user}":`, v.rows[0])
    const dbs = await c.query("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname")
    console.log(`[PG] dbs:`, dbs.rows.map((r) => r.datname).join(', '))
    await c.end()
    break
  } catch (e) {
    console.log(`[PG] FAIL user="${cand.user}": ${e.message}`)
  }
}
