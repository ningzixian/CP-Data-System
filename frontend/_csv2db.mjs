// csv2db.mjs — 16 个 CSV 灌到 MySQL + PostgreSQL
// 架构：每个 CSV 一个 database，每个 database 一张表（与库同名），全中文，严格复现 CSV 列
// MySQL 字符集：utf8mb4 / utf8mb4_unicode_ci
// PG：UTF8 编码
// 依赖：mysql2 + pg（已装）
//
// 用法：
//   1) 改下面的 CREDS（账号密码待你确认）
//   2) node _csv2db.mjs           # 跑全部
//   3) node _csv2db.mjs --only mysql
//   4) node _csv2db.mjs --only pg
//   5) node _csv2db.mjs --only "南海家园七里_低压"  # 跑单个

import fs from 'node:fs'
import path from 'node:path'
import mysql from 'mysql2/promise'
import pg from 'pg'

const { Client: PgClient } = pg

// ============== 配置 ==============
const CSV_DIR = path.resolve('public/data')
const HOST_MYSQL = '192.168.0.253'
const HOST_PG = '192.168.0.253'
const PORT_MYSQL = 3306
const PORT_PG = 5432

// TODO: 你给我正确的账号后再改这里
const MYSQL_USER = process.env.MYSQL_USER || 'root'
const MYSQL_PWD = process.env.MYSQL_PWD || 'abcd1234'
const PG_USER = process.env.PG_USER || 'postgres'
const PG_PWD = process.env.PG_PWD || 'abcd1234'

// ============== CSV 解析 ==============

/** 把 "南海家园七里-低压.csv" -> "南海家园七里_低压" */
function csvToIdent(filename) {
  return filename.replace(/\.csv$/i, '').replace(/-/g, '_')
}

/** 解析一行 CSV（处理双引号包裹的字段，字段内允许逗号/换行/双引号转义） */
function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') {
        inQuotes = false
      } else {
        cur += c
      }
    } else {
      if (c === ',') {
        out.push(cur)
        cur = ''
      } else if (c === '"' && cur === '') {
        inQuotes = true
      } else {
        cur += c
      }
    }
  }
  out.push(cur)
  return out
}

/** 读整个 CSV（自动去 BOM） */
function readCsv(filepath) {
  let raw = fs.readFileSync(filepath, 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0)
  if (lines.length === 0) return { headers: [], rows: [] }
  const headers = parseCsvLine(lines[0])
  // 去重：同名 header 加后缀 __2, __3...
  const seen = new Map()
  const uniqueHeaders = headers.map((h) => {
    const base = h.trim() || 'col'
    const n = (seen.get(base) || 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base}__${n}`
  })
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i])
    if (cells.length === 1 && cells[0] === '') continue
    // pad 到 header 长度
    while (cells.length < uniqueHeaders.length) cells.push('')
    rows.push(cells)
  }
  return { headers: uniqueHeaders, rows }
}

// ============== 类型推断 ==============

function inferColumnType(values) {
  const nonEmpty = values.filter((v) => v !== '' && v != null)
  if (nonEmpty.length === 0) {
    return { mysql: 'VARCHAR(255)', pg: 'VARCHAR(255)' }
  }
  const allInt = nonEmpty.every((v) => /^-?\d+$/.test(String(v).trim()))
  if (allInt) {
    const max = Math.max(
      ...nonEmpty.map((v) => Math.abs(parseInt(String(v).trim(), 10) || 0))
    )
    if (max <= 2147483647) return { mysql: 'INT', pg: 'INTEGER' }
    return { mysql: 'BIGINT', pg: 'BIGINT' }
  }
  const allNum = nonEmpty.every((v) => /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(String(v).trim()))
  if (allNum) return { mysql: 'DOUBLE', pg: 'DOUBLE PRECISION' }
  const allDate = nonEmpty.every((v) =>
    /^\d{4}[/-]\d{1,2}[/-]\d{1,2}([ T]\d{1,2}:\d{1,2}(:\d{1,2})?(\.\d+)?)?$/.test(String(v).trim())
  )
  if (allDate) return { mysql: 'DATETIME', pg: 'TIMESTAMP' }
  // 字符串
  const maxLen = Math.max(...nonEmpty.map((v) => String(v).length))
  if (maxLen <= 50) return { mysql: `VARCHAR(${Math.max(maxLen, 1)})`, pg: `VARCHAR(${Math.max(maxLen, 1)})` }
  if (maxLen <= 255) return { mysql: 'VARCHAR(255)', pg: 'VARCHAR(255)' }
  if (maxLen <= 1000) return { mysql: 'VARCHAR(1000)', pg: 'VARCHAR(1000)' }
  if (maxLen <= 4000) return { mysql: 'VARCHAR(4000)', pg: 'VARCHAR(4000)' }
  return { mysql: 'TEXT', pg: 'TEXT' }
}

function inferSchema(headers, rows) {
  return headers.map((h) => {
    const colValues = rows.map((r) => {
      const idx = headers.indexOf(h)
      return r[idx]
    })
    // WKT 列一律 TEXT
    if (h === 'WKT') return { name: h, mysql: 'TEXT', pg: 'TEXT' }
    return { name: h, ...inferColumnType(colValues) }
  })
}

// ============== MySQL ==============

async function migrateMysql(csvFiles, opts = {}) {
  console.log('\n=== MySQL 迁移 ===')
  console.log(`连接 ${MYSQL_USER}@${HOST_MYSQL}:${PORT_MYSQL}`)
  const conn = await mysql.createConnection({
    host: HOST_MYSQL,
    port: PORT_MYSQL,
    user: MYSQL_USER,
    password: MYSQL_PWD,
    multipleStatements: false,
    connectTimeout: 15000,
    // 注意：不指定 database，连接根
  })
  console.log('[MySQL] 已连接')

  for (const file of csvFiles) {
    const ident = csvToIdent(file)
    const filepath = path.join(CSV_DIR, file)
    if (opts.only && opts.only !== ident) continue
    const { headers, rows } = readCsv(filepath)
    if (rows.length === 0) {
      console.log(`  [skip] ${file} (0 rows)`)
      continue
    }
    const schema = inferSchema(headers, rows)
    const dbName = `\`${ident}\``  // 用反引号包
    // CREATE DATABASE
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS ${dbName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    )
    // USE
    await conn.query(`USE ${dbName}`)
    // DROP & CREATE TABLE
    const tableName = `\`${ident}\``
    await conn.query(`DROP TABLE IF EXISTS ${tableName}`)
    const colDefs = schema
      .map((c) => `\`${c.name}\` ${c.mysql} NULL`)
      .join(',\n  ')
    const createSql = `CREATE TABLE ${tableName} (\n  ${colDefs}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    await conn.query(createSql)
    // BULK INSERT（多行 VALUES）— 空串在数字/日期列上转 NULL（MySQL strict mode 不接受 '' 当 INT）
    const batchSize = 200
    let inserted = 0
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)
      const placeholders = batch.map(() => `(${schema.map(() => '?').join(',')})`).join(',')
      const flatValues = batch.flat().map((v, idx) => {
        const colType = schema[idx % schema.length].mysql
        if ((v === '' || v == null) && /^(INT|BIGINT|DOUBLE|DATETIME|DATE|TIME|TIMESTAMP|FLOAT|DECIMAL|TINYINT|SMALLINT|MEDIUMINT)$/i.test(colType)) {
          return null
        }
        return v
      })
      await conn.query(`INSERT INTO ${tableName} VALUES ${placeholders}`, flatValues)
      inserted += batch.length
    }
    console.log(
      `  [ok] ${file} → ${ident} (${rows.length} 行, ${schema.length} 列)`
    )
  }

  await conn.end()
  console.log('[MySQL] 完成')
}

// ============== PostgreSQL ==============

async function ensurePgDatabase(dbIdent) {
  // 先连到默认 postgres 库，建库
  const admin = new PgClient({
    host: HOST_PG,
    port: PORT_PG,
    user: PG_USER,
    password: PG_PWD,
    database: 'postgres',
    connectionTimeoutMillis: 15000,
  })
  await admin.connect()
  // 检查是否存在
  const r = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbIdent])
  if (r.rowCount === 0) {
    // CREATE DATABASE 不能参数化，必须手动安全拼接（限定字符集 A-Za-z0-9_中文）
    if (!/^[A-Za-z0-9_一-龥]+$/.test(dbIdent)) {
      throw new Error(`非法 db 标识符: ${dbIdent}`)
    }
    await admin.query(`CREATE DATABASE "${dbIdent}" WITH ENCODING 'UTF8' TEMPLATE template0`)
    console.log(`  [create-db] ${dbIdent}`)
  } else {
    console.log(`  [exists-db] ${dbIdent}`)
  }
  await admin.end()
}

async function migratePg(csvFiles, opts = {}) {
  console.log('\n=== PostgreSQL 迁移 ===')
  console.log(`连接 ${PG_USER}@${HOST_PG}:${PORT_PG}`)
  for (const file of csvFiles) {
    const ident = csvToIdent(file)
    const filepath = path.join(CSV_DIR, file)
    if (opts.only && opts.only !== ident) continue
    const { headers, rows } = readCsv(filepath)
    if (rows.length === 0) {
      console.log(`  [skip] ${file} (0 rows)`)
      continue
    }
    const schema = inferSchema(headers, rows)

    await ensurePgDatabase(ident)

    const client = new PgClient({
      host: HOST_PG,
      port: PORT_PG,
      user: PG_USER,
      password: PG_PWD,
      database: ident,
      connectionTimeoutMillis: 15000,
    })
    await client.connect()
    // DROP & CREATE TABLE
    const colDefs = schema
      .map((c) => `"${c.name}" ${c.pg} NULL`)
      .join(',\n  ')
    await client.query(`DROP TABLE IF EXISTS "${ident}"`)
    await client.query(`CREATE TABLE "${ident}" (\n  ${colDefs}\n)`)

    // BULK INSERT（多行 VALUES 一次提交，PG 支持 $1, $2, ..., $1, $2 复用）
    const batchSize = 200
    let inserted = 0
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)
      const placeholders = batch
        .map(
          (_, ri) =>
            `(${schema.map((_, ci) => `$${ri * schema.length + ci + 1}`).join(',')})`
        )
        .join(',')
      const flatValues = batch.flat().map((v, idx) => {
        const colType = schema[idx % schema.length].pg
        if ((v === '' || v == null) && /^(INTEGER|BIGINT|SMALLINT|SMALLSERIAL|SERIAL|BIGSERIAL|REAL|DOUBLE PRECISION|DECIMAL|NUMERIC|FLOAT|DATE|TIME|TIMESTAMP)$/i.test(colType)) {
          return null
        }
        return v
      })
      await client.query(`INSERT INTO "${ident}" VALUES ${placeholders}`, flatValues)
      inserted += batch.length
    }
    console.log(
      `  [ok] ${file} → ${ident} (${rows.length} 行, ${schema.length} 列)`
    )
    await client.end()
  }
  console.log('[PG] 完成')
}

// ============== 主流程 ==============

async function main() {
  const args = process.argv.slice(2)
  const opts = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--only' && args[i + 1]) {
      opts.only = args[i + 1]
      i++
    }
  }

  if (!fs.existsSync(CSV_DIR)) {
    console.error(`CSV 目录不存在: ${CSV_DIR}`)
    process.exit(1)
  }
  const csvFiles = fs
    .readdirSync(CSV_DIR)
    .filter((f) => f.toLowerCase().endsWith('.csv'))
    .sort()
  console.log(`发现 ${csvFiles.length} 个 CSV:`)
  csvFiles.forEach((f) => console.log(`  - ${f} → ${csvToIdent(f)}`))

  const only = opts.only
  const runMysql = !only || (await shouldRun('mysql', only))
  const runPg = !only || (await shouldRun('pg', only))

  if (runMysql) await migrateMysql(csvFiles, opts)
  if (runPg) await migratePg(csvFiles, opts)

  console.log('\n=== 全部完成 ===')
}

async function shouldRun(target, only) {
  if (only === 'mysql' || only === 'pg') return only === target
  return true  // 库名匹配时 both run
}

main().catch((e) => {
  console.error('失败:', e)
  process.exit(1)
})
