// _field2db.mjs — 独立 CLI 同步脚本（不依赖 Vite）
// 用法：node _field2db.mjs [--db mysql|pg|both]
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
import https from 'node:https'
import { Buffer } from 'node:buffer'
import mysql from 'mysql2/promise'
import pg from 'pg'
const { Client: PgClient } = pg

const FIELD_HOST = '192.168.20.40'
const FIELD_PORT = 3000
const FIELD_BASE = '/api'
const MYSQL = { host: '192.168.0.253', port: 3306, user: 'root', password: 'abcd1234' }
const PG = { host: '192.168.0.253', port: 5432, user: 'postgres', password: 'abcd1234' }
const DB_NAME = 'cp_field_tasks'
const httpsAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: false })

const args = process.argv.slice(2)
const onlyDb = args.includes('--db') ? args[args.indexOf('--db') + 1] : 'both'

console.log(`[sync] target DBs: ${onlyDb}`)

function httpsReq({ method, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const opts = {
      host: FIELD_HOST, port: FIELD_PORT, path, method,
      agent: httpsAgent,
      headers: { ...headers, ...(body ? { 'content-length': Buffer.byteLength(body) } : {}) },
    }
    const req = https.request(opts, (res) => {
      let d = ''
      res.on('data', (c) => d += c)
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`${method} ${path} -> ${res.statusCode}: ${d.slice(0, 200)}`))
        else { try { resolve(JSON.parse(d)) } catch { resolve(d) } }
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

let _token = null
let _tokenExp = 0
async function getToken() {
  if (_token && Date.now() < _tokenExp - 60_000) return _token
  console.log('[sync] logging in...')
  const j = await httpsReq({
    method: 'POST', path: `${FIELD_BASE}/auth/login`,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  _token = j.token
  _tokenExp = Date.now() + 6 * 3600 * 1000
  return _token
}

async function fetchAll(path) {
  const token = await getToken()
  return httpsReq({ method: 'GET', path: `${FIELD_BASE}${path}`, headers: { authorization: `Bearer ${token}` } })
}

async function syncMysql() {
  console.log('[sync][MySQL] connecting...')
  const conn = await mysql.createConnection(MYSQL)
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  await conn.query(`USE \`${DB_NAME}\``)
  await conn.query('DROP TABLE IF EXISTS tasks')
  await conn.query('DROP TABLE IF EXISTS points')
  await conn.query('DROP TABLE IF EXISTS reports')
  await conn.query(`CREATE TABLE tasks (id VARCHAR(64) PRIMARY KEY, name VARCHAR(255), area VARCHAR(64), unit VARCHAR(64), pressureLevel VARCHAR(16), pointsCount INT DEFAULT 0, createdAt DATETIME, updatedAt DATETIME)`)
  await conn.query(`CREATE TABLE points (id VARCHAR(64) PRIMARY KEY, taskId VARCHAR(64), seq INT, location VARCHAR(255), lng DOUBLE, lat DOUBLE, dataTypes TEXT, createdAt DATETIME)`)
  await conn.query(`CREATE TABLE reports (id VARCHAR(64) PRIMARY KEY, taskId VARCHAR(64), pointId VARCHAR(64), items JSON, createdAt DATETIME)`)

  const tasks = await fetchAll('/tasks')
  console.log(`[sync][MySQL] ${tasks.length} tasks`)
  let ptCount = 0, rptCount = 0
  for (const t of tasks) {
    const pts = await fetchAll(`/tasks/${t.id}/points`)
    await conn.query(`INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?)`,
      [t.id, t.name, t.area, t.unit, t.pressureLevel, pts.length, new Date(t.createdAt), new Date(t.updatedAt)])
    for (const p of pts) {
      ptCount++
      await conn.query(`INSERT INTO points VALUES (?,?,?,?,?,?,?,?)`,
        [p.id, p.taskId, p.seq, p.location, p.lng, p.lat, JSON.stringify(p.dataTypes), new Date(p.createdAt)])
      const reps = await fetchAll(`/tasks/${t.id}/reports?pointId=${p.id}`)
      for (const r of reps) {
        rptCount++
        await conn.query(`INSERT INTO reports VALUES (?,?,?,?,?)`,
          [r.id, r.taskId, r.pointId, JSON.stringify(r.items), new Date(r.createdAt)])
      }
    }
  }
  await conn.end()
  console.log(`[sync][MySQL] ✓ ${tasks.length} 任务 / ${ptCount} 点 / ${rptCount} 报告`)
}

async function syncPg() {
  console.log('[sync][PG] connecting...')
  const admin = new PgClient({ ...PG, database: 'postgres' })
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE "${DB_NAME}" WITH ENCODING 'UTF8' TEMPLATE template0`)
  } catch (e) {
    if (!String(e.message).includes('already exists')) throw e
  }
  await admin.end()
  const c = new PgClient({ ...PG, database: DB_NAME })
  await c.connect()
  await c.query('DROP TABLE IF EXISTS tasks')
  await c.query('DROP TABLE IF EXISTS points')
  await c.query('DROP TABLE IF EXISTS reports')
  await c.query(`CREATE TABLE tasks (id VARCHAR(64) PRIMARY KEY, name VARCHAR(255), area VARCHAR(64), unit VARCHAR(64), "pressureLevel" VARCHAR(16), "pointsCount" INT DEFAULT 0, "createdAt" TIMESTAMP, "updatedAt" TIMESTAMP)`)
  await c.query(`CREATE TABLE points (id VARCHAR(64) PRIMARY KEY, "taskId" VARCHAR(64), seq INT, location VARCHAR(255), lng DOUBLE PRECISION, lat DOUBLE PRECISION, "dataTypes" TEXT, "createdAt" TIMESTAMP)`)
  await c.query(`CREATE TABLE reports (id VARCHAR(64) PRIMARY KEY, "taskId" VARCHAR(64), "pointId" VARCHAR(64), items JSONB, "createdAt" TIMESTAMP)`)

  const tasks = await fetchAll('/tasks')
  console.log(`[sync][PG] ${tasks.length} tasks`)
  let ptCount = 0, rptCount = 0
  for (const t of tasks) {
    const pts = await fetchAll(`/tasks/${t.id}/points`)
    await c.query(`INSERT INTO tasks VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [t.id, t.name, t.area, t.unit, t.pressureLevel, pts.length, t.createdAt, t.updatedAt])
    for (const p of pts) {
      ptCount++
      await c.query(`INSERT INTO points VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [p.id, p.taskId, p.seq, p.location, p.lng, p.lat, JSON.stringify(p.dataTypes), p.createdAt])
      const reps = await fetchAll(`/tasks/${t.id}/reports?pointId=${p.id}`)
      for (const r of reps) {
        rptCount++
        await c.query(`INSERT INTO reports VALUES ($1,$2,$3,$4,$5)`,
          [r.id, r.taskId, r.pointId, JSON.stringify(r.items), r.createdAt])
      }
    }
  }
  await c.end()
  console.log(`[sync][PG] ✓ ${tasks.length} 任务 / ${ptCount} 点 / ${rptCount} 报告`)
}

const t0 = Date.now()
try {
  if (onlyDb === 'mysql' || onlyDb === 'both') await syncMysql()
  if (onlyDb === 'pg' || onlyDb === 'both') await syncPg()
  console.log(`[sync] 全部完成，${Date.now() - t0}ms`)
} catch (e) {
  console.error('[sync] FAILED:', e.message)
  process.exit(1)
}
