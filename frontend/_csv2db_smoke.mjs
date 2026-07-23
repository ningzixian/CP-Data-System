// _csv2db_smoke.mjs — 烟测：连库 → 建 1 库 1 表 → 插入 → 验证 → DROP（不留痕）
import fs from 'node:fs'
import path from 'node:path'
import mysql from 'mysql2/promise'
import pg from 'pg'

const { Client: PgClient } = pg

const HOST = '192.168.0.253'
const PORT_MYSQL = 3306
const PORT_PG = 5432
const MYSQL_USER = process.env.MYSQL_USER || 'root'
const MYSQL_PWD = process.env.MYSQL_PWD || 'abcd1234'
const PG_USER = process.env.PG_USER || 'postgres'
const PG_PWD = process.env.PG_PWD || 'abcd1234'

const TEST_DB = 'cp_smoke_test_xxx'  // 不与真实数据冲突

function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') inQuotes = false
      else cur += c
    } else {
      if (c === ',') { out.push(cur); cur = '' }
      else if (c === '"' && cur === '') inQuotes = true
      else cur += c
    }
  }
  out.push(cur)
  return out
}

function readCsv(filepath) {
  let raw = fs.readFileSync(filepath, 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0)
  const headers = parseCsvLine(lines[0])
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i])
    if (cells.length === 1 && cells[0] === '') continue
    while (cells.length < headers.length) cells.push('')
    rows.push(cells)
  }
  return { headers, rows }
}

const sampleFile = path.resolve('public/data/南海家园七里-控制单元.csv')
const { headers, rows } = readCsv(sampleFile)
console.log(`烟测样本: 南海家园七里-控制单元.csv (${rows.length} 行, ${headers.length} 列)`)
console.log(`表名: ${TEST_DB}\n`)

console.log('━━━ MySQL 烟测 ━━━')
try {
  const conn = await mysql.createConnection({
    host: HOST, port: PORT_MYSQL, user: MYSQL_USER, password: MYSQL_PWD, connectTimeout: 10000,
  })
  await conn.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``)
  await conn.query(`CREATE DATABASE \`${TEST_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  await conn.query(`USE \`${TEST_DB}\``)
  await conn.query(`DROP TABLE IF EXISTS \`${TEST_DB}\``)
  await conn.query(`CREATE TABLE \`${TEST_DB}\` (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(100), wkt TEXT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  const wkt = rows[0][0] || 'POLYGON EMPTY'
  const name = rows[0][3] || 'test'
  await conn.query(`INSERT INTO \`${TEST_DB}\` (name, wkt) VALUES (?, ?), (?, ?)`, [name, wkt, '测试中文', 'POLYGON ((1 2, 3 4))'])
  const [r] = await conn.query(`SELECT COUNT(*) AS cnt FROM \`${TEST_DB}\``)
  console.log(`  [MySQL] 插入 2 行，查询 COUNT = ${r[0].cnt}`)
  await conn.query(`DROP DATABASE \`${TEST_DB}\``)
  await conn.end()
  console.log('  [MySQL] ✓ 通过')
} catch (e) {
  console.log('  [MySQL] ✗ 失败:', e.message)
}

console.log('\n━━━ PG 烟测 ━━━')
try {
  const admin = new PgClient({ host: HOST, port: PORT_PG, user: PG_USER, password: PG_PWD, database: 'postgres' })
  await admin.connect()
  await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}"`)
  await admin.query(`CREATE DATABASE "${TEST_DB}" WITH ENCODING 'UTF8' TEMPLATE template0`)
  await admin.end()

  const c = new PgClient({ host: HOST, port: PORT_PG, user: PG_USER, password: PG_PWD, database: TEST_DB })
  await c.connect()
  await c.query(`DROP TABLE IF EXISTS "${TEST_DB}"`)
  await c.query(`CREATE TABLE "${TEST_DB}" (id SERIAL PRIMARY KEY, name VARCHAR(100), wkt TEXT)`)
  const wkt = rows[0][0] || 'POLYGON EMPTY'
  const name = rows[0][3] || 'test'
  await c.query(`INSERT INTO "${TEST_DB}" (name, wkt) VALUES ($1, $2), ($3, $4)`, [name, wkt, '测试中文', 'POLYGON ((1 2, 3 4))'])
  const r = await c.query(`SELECT COUNT(*)::int AS cnt FROM "${TEST_DB}"`)
  console.log(`  [PG] 插入 2 行，查询 COUNT = ${r.rows[0].cnt}`)
  await c.end()

  const admin2 = new PgClient({ host: HOST, port: PORT_PG, user: PG_USER, password: PG_PWD, database: 'postgres' })
  await admin2.connect()
  await admin2.query(`DROP DATABASE "${TEST_DB}"`)
  await admin2.end()
  console.log('  [PG] ✓ 通过')
} catch (e) {
  console.log('  [PG] ✗ 失败:', e.message)
}
