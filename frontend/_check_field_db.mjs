// _check_field_db.mjs
import mysql from 'mysql2/promise'
import pg from 'pg'
const { Client: PgClient } = pg

try {
  const c = await mysql.createConnection({ host: '192.168.0.253', port: 3306, user: 'root', password: 'abcd1234' })
  const [dbs] = await c.query("SHOW DATABASES LIKE 'cp_%'")
  console.log('[MySQL] cp_* 库:', dbs.map(r => r.Database).join(', '))
  if (dbs.length > 0) {
    await c.query('USE cp_field_tasks')
    const [t] = await c.query('SELECT COUNT(*) AS cnt FROM tasks')
    const [p] = await c.query('SELECT COUNT(*) AS cnt FROM points')
    const [r] = await c.query('SELECT COUNT(*) AS cnt FROM reports')
    console.log('[MySQL] cp_field_tasks:', t[0].cnt, '任务,', p[0].cnt, '点,', r[0].cnt, '报告')
  }
  await c.end()
} catch (e) { console.log('[MySQL] FAIL:', e.message) }

try {
  const c = new PgClient({ host: '192.168.0.253', port: 5432, user: 'postgres', password: 'abcd1234', database: 'postgres' })
  await c.connect()
  const dbs = await c.query("SELECT datname FROM pg_database WHERE datistemplate=false AND datname LIKE 'cp_%'")
  console.log('[PG] cp_* 库:', dbs.rows.map(r => r.datname).join(', '))
  if (dbs.rows.length > 0) {
    await c.end()
    const c2 = new PgClient({ host: '192.168.0.253', port: 5432, user: 'postgres', password: 'abcd1234', database: 'cp_field_tasks' })
    await c2.connect()
    const t = await c2.query('SELECT COUNT(*)::int AS cnt FROM tasks')
    const p = await c2.query('SELECT COUNT(*)::int AS cnt FROM points')
    const r = await c2.query('SELECT COUNT(*)::int AS cnt FROM reports')
    console.log('[PG] cp_field_tasks:', t.rows[0].cnt, '任务,', p.rows[0].cnt, '点,', r.rows[0].cnt, '报告')
    await c2.end()
  } else { await c.end() }
} catch (e) { console.log('[PG] FAIL:', e.message) }
