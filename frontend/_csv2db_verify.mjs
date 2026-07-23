// _csv2db_verify.mjs — 验证：列出所有库/表 + COUNT + 中文 + 边界条件
import fs from 'node:fs'
import path from 'node:path'
import mysql from 'mysql2/promise'
import pg from 'pg'

const { Client: PgClient } = pg
const CSV_DIR = path.resolve('public/data')

const csvFiles = fs.readdirSync(CSV_DIR).filter((f) => f.toLowerCase().endsWith('.csv')).sort()
const tables = csvFiles.map((f) => f.replace(/\.csv$/i, '').replace(/-/g, '_'))

console.log('━━━ MySQL 验证 ━━━\n')
try {
  const conn = await mysql.createConnection({
    host: '192.168.0.253', port: 3306, user: 'root', password: 'abcd1234',
  })
  const [dbs] = await conn.query("SHOW DATABASES")
  const cpDbs = dbs.map((r) => r.Database).filter((d) => d.startsWith('南海家园'))
  console.log(`找到 ${cpDbs.length} 个南海家园相关库\n`)

  console.log('库名 | 行数')
  console.log('---|---')
  for (const t of tables) {
    await conn.query(`USE \`${t}\``)
    const [r] = await conn.query(`SELECT COUNT(*) AS cnt FROM \`${t}\``)
    console.log(`${t} | ${r[0].cnt}`)
  }
  console.log('\n-- 控制单元（带中文）--')
  await conn.query('USE `南海家园七里_控制单元`')
  const [rows] = await conn.query('SELECT `NAME`, SHAPE_Leng, SHAPE_Area, Press FROM `南海家园七里_控制单元` LIMIT 3')
  console.table(rows)
  console.log('-- 低压管（中文 MANAGEREGI / REGION）--')
  await conn.query('USE `南海家园七里_低压`')
  const [cn] = await conn.query('SELECT PIPENO, MANAGEREGI, REGION FROM `南海家园七里_低压` WHERE MANAGEREGI IS NOT NULL LIMIT 3')
  console.table(cn)
  console.log('-- YEAR 列（曾经炸的）--')
  await conn.query('USE `南海家园六里_低压`')
  const [yearRows] = await conn.query('SELECT YEAR, MAPNAME FROM `南海家园六里_低压` WHERE YEAR IS NOT NULL LIMIT 5')
  const [yearStats] = await conn.query('SELECT COUNT(*) AS total, SUM(CASE WHEN YEAR IS NULL THEN 1 ELSE 0 END) AS null_cnt FROM `南海家园六里_低压`')
  console.log(`总数=${yearStats[0].total}, YEAR NULL=${yearStats[0].null_cnt}, 非空行数=${yearRows.length}`)
  console.table(yearRows)
  await conn.end()
} catch (e) {
  console.log('[MySQL] FAIL:', e.message)
}

console.log('\n━━━ PG 验证 ━━━\n')
try {
  const admin = new PgClient({ host: '192.168.0.253', port: 5432, user: 'postgres', password: 'abcd1234', database: 'postgres' })
  await admin.connect()
  const dbs = await admin.query("SELECT datname FROM pg_database WHERE datistemplate = false AND datname LIKE '南海家园%' ORDER BY datname")
  console.log(`找到 ${dbs.rows.length} 个南海家园相关库\n`)
  await admin.end()

  console.log('库名 | 行数')
  console.log('---|---')
  for (const t of tables) {
    const c = new PgClient({ host: '192.168.0.253', port: 5432, user: 'postgres', password: 'abcd1234', database: t })
    await c.connect()
    const r = await c.query(`SELECT COUNT(*)::int AS cnt FROM "${t}"`)
    console.log(`${t} | ${r.rows[0].cnt}`)
    await c.end()
  }
  console.log('\n-- 控制单元（PG 中 NAME 是保留字，必须双引号）--')
  const c1 = new PgClient({ host: '192.168.0.253', port: 5432, user: 'postgres', password: 'abcd1234', database: '南海家园七里_控制单元' })
  await c1.connect()
  const r1 = await c1.query('SELECT "NAME", "SHAPE_Leng", "SHAPE_Area", "Press" FROM "南海家园七里_控制单元" LIMIT 3')
  console.table(r1.rows)
  await c1.end()

  console.log('-- 低压管（中文 MANAGEREGI / REGION）--')
  const c2 = new PgClient({ host: '192.168.0.253', port: 5432, user: 'postgres', password: 'abcd1234', database: '南海家园七里_低压' })
  await c2.connect()
  const r2 = await c2.query('SELECT "PIPENO", "MANAGEREGI", "REGION" FROM "南海家园七里_低压" WHERE "MANAGEREGI" IS NOT NULL LIMIT 3')
  console.table(r2.rows)
  await c2.end()

  console.log('-- YEAR 列（曾经炸的）--')
  const c3 = new PgClient({ host: '192.168.0.253', port: 5432, user: 'postgres', password: 'abcd1234', database: '南海家园六里_低压' })
  await c3.connect()
  const r3 = await c3.query('SELECT "YEAR", "MAPNAME" FROM "南海家园六里_低压" WHERE "YEAR" IS NOT NULL LIMIT 5')
  const s3 = await c3.query('SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE "YEAR" IS NULL)::int AS null_cnt FROM "南海家园六里_低压"')
  console.log(`总数=${s3.rows[0].total}, YEAR NULL=${s3.rows[0].null_cnt}, 非空行数=${r3.rows.length}`)
  console.table(r3.rows)
  await c3.end()
} catch (e) {
  console.log('[PG] FAIL:', e.message)
}

console.log('\n=== 验证完成 ===')
