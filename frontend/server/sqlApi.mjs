// server/sqlApi.mjs — Vite middleware 形式的 SQL API
// 暴露给前端的命名查询（不允许 raw SQL，杜绝注入）
// 路由：
//   GET  /api/sql/:name[?community=...&db=mysql|pg&limit=N]
//   GET  /api/sql/dashboard            → 综合统计
//   GET  /api/sql/field/sync           → 触发 src.20270721 同步
//   GET  /api/sql/field/tasks          → 列出已同步的任务
//   GET  /api/sql/health               → 连通性检查
import mysql from 'mysql2/promise'
import pg from 'pg'

const COMMUNITIES = ['南海家园七里', '南海家园三里', '南海家园六里']
const TYPES = {
  pipes: '低压',
  inlets: '引入口_录入',
  controls: '控制单元',
  joints: '绝缘接头',
  regulators: '调压箱',
}

const MYSQL = { host: '192.168.0.253', port: 3306, user: 'root', password: 'abcd1234', supportBigNumbers: true, bigNumberStrings: true }
const PG = { host: '192.168.0.253', port: 5432, user: 'postgres', password: 'abcd1234' }

// 标识符转义（PG 必须引号，MySQL 兼容）
const tM = (s) => `\`${s}\``
const tP = (s) => `"${s}"`
const cM = (s) => `\`${s}\``
const cP = (s) => `"${s}"`
const tbl = (db, name) => (db === 'mysql' ? tM(name) : tP(name))
const col = (db, name) => (db === 'mysql' ? cM(name) : cP(name))
const cols = (db, list) => list.map((c) => `${col(db, c)} AS ${db === 'mysql' ? c : `"${c}"`}`).join(', ')

// 字段检测后端（src.20270721 在 192.168.20.40:3000）
const FIELD_API_HOST = '192.168.20.40'
const FIELD_API_PORT = 3000
const FIELD_API_BASE = `/api`
let _fieldToken = null
let _fieldTokenExpires = 0

// 用 Node 内置 https（undici 在 Vite middleware 下慢/挂）
import https from 'node:https'
import { Buffer } from 'node:buffer'
const httpsAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: false, maxSockets: 8 })

function httpsReq({ method, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const opts = {
      host: FIELD_API_HOST,
      port: FIELD_API_PORT,
      path,
      method,
      agent: httpsAgent,
      headers: { ...headers, ...(body ? { 'content-length': Buffer.byteLength(body) } : {}) },
    }
    const req = https.request(opts, (res) => {
      let d = ''
      res.on('data', (c) => d += c)
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`${method} ${path} -> ${res.statusCode}: ${d.slice(0, 200)}`))
        } else {
          try { resolve(JSON.parse(d)) } catch { resolve(d) }
        }
      })
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function getFieldToken() {
  if (_fieldToken && Date.now() < _fieldTokenExpires - 60_000) return _fieldToken
  const t0 = Date.now()
  const j = await httpsReq({
    method: 'POST',
    path: `${FIELD_API_BASE}/auth/login`,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  console.log(`[field] login ${Date.now() - t0}ms`)
  _fieldToken = j.token
  _fieldTokenExpires = Date.now() + 6 * 3600 * 1000
  return _fieldToken
}

async function fieldReq(path) {
  const t0 = Date.now()
  const token = await getFieldToken()
  const j = await httpsReq({
    method: 'GET',
    path: `${FIELD_API_BASE}${path}`,
    headers: { authorization: `Bearer ${token}` },
  })
  const elapsed = Date.now() - t0
  if (elapsed > 200) console.log(`[field] ${path} ${elapsed}ms (${Array.isArray(j) ? j.length : '?'} rows)`)
  return j
}

// ========== 命名查询（白名单） ==========
const QUERIES = {
  // Q1. 社区管线总长度
  'community-totals': async (db) => {
    return COMMUNITIES.map((c) => {
      const t = tbl(db, c + '_低压')
      return `SELECT '社区' AS dim_val, COUNT(*) AS cnt, ROUND(SUM(CAST(${col(db, 'LENGTH')} AS DECIMAL(18,4))), 2) AS total_length, ROUND(AVG(CAST(${col(db, 'LENGTH')} AS DECIMAL(18,4))), 2) AS avg_length FROM ${t}`.replace(`'社区' AS dim_val`, `'${c}' AS 社区`)
    })
  },

  // Q2. 社区 + 管径 段数矩阵
  'diameter-distribution': async (db) => {
    return COMMUNITIES.flatMap((c) =>
      [50, 80, 100, 150].map(
        (d) => `SELECT '${c}' AS 社区, ${d} AS 管径, COUNT(*) AS 段数 FROM ${tbl(db, c + '_低压')} WHERE ${col(db, 'DIAMETERO')} = ${d}`
      )
    )
  },

  // Q3. 2017 年改造（六里）
  'recent-2017': async (db) => {
    return [`SELECT ${cols(db, ['PIPENO', 'MANAGEREGI', 'DIAMETERO', 'LENGTH', 'MATERIAL', 'YEAR'])} FROM ${tbl(db, '南海家园六里_低压')} WHERE ${col(db, 'YEAR')} IS NOT NULL ORDER BY ${col(db, 'YEAR')}, ${col(db, 'PIPENO')}`]
  },

  // Q4. 控制单元面积 TOP 5
  'controls-top': async (db) => {
    return COMMUNITIES.map((c) => {
      const t = tbl(db, c + '_控制单元')
      return `SELECT '${c}' AS 社区, ${cols(db, ['NAME', 'SHAPE_Leng', 'SHAPE_Area', 'Press'])} FROM ${t} ORDER BY ${col(db, 'SHAPE_Area')} DESC LIMIT 5`
    })
  },

  // Q5. 引入口按压力
  'inlets-by-pressure': async (db) =>
    COMMUNITIES.map(
      (c) => `SELECT '${c}' AS 社区, ${col(db, 'PRESSURED')} AS 压力, COUNT(*) AS 数量 FROM ${tbl(db, c + '_引入口_录入')} GROUP BY ${col(db, 'PRESSURED')}`
    ),

  // Q6. 绝缘接头类型
  'joints-by-type': async (db) =>
    COMMUNITIES.map(
      (c) => `SELECT '${c}' AS 社区, ${col(db, 'TYPE')} AS 类型, COUNT(*) AS 数量 FROM ${tbl(db, c + '_绝缘接头')} GROUP BY ${col(db, 'TYPE')}`
    ),

  // Q7. 跨社区最长 10 段（手拼：每库跑一次）
  'longest-pipes-top10': { crossDb: 'pipes', postProcess: (rows) => {
    rows.sort((a, b) => Number(b.LENGTH) - Number(a.LENGTH))
    return rows.slice(0, 10)
  } },

  // Q8. 调压箱分布
  'regulators-list': { crossDb: 'regulators', postProcess: (rows) => {
    rows.sort((a, b) => {
      if (a.社区 !== b.社区) return String(a.社区).localeCompare(String(b.社区))
      return String(a.NAME).localeCompare(String(b.NAME))
    })
    return rows
  } },

  // Q9. 各社区数量 (单库表)
  'community-row-counts': async (db) => {
    const result = []
    for (const t of ['低压', '引入口_录入', '控制单元', '绝缘接头', '调压箱']) {
      for (const c of COMMUNITIES) {
        result.push(`SELECT '${c}' AS 社区, '${t}' AS 设施, COUNT(*) AS 数量 FROM ${tbl(db, c + '_' + t)}`)
      }
    }
    return result
  },

  // Q10. 各社区管径 0~300 分布
  'diameter-histogram': async (db) => {
    return COMMUNITIES.flatMap((c) => {
      const t = tbl(db, c + '_低压')
      return [0, 50, 80, 100, 150, 200, 300].map(
        (d) => `SELECT '${c}' AS 社区, ${d} AS bucket_max, COUNT(*) AS cnt FROM ${t} WHERE ${col(db, 'DIAMETERO')} <= ${d} AND ${col(db, 'DIAMETERO')} > ${d === 0 ? 0 : d - 50}`
      )
    })
  },
}

// ========== DB 连接 ==========
async function queryMysql(sqls) {
  const conn = await mysql.createConnection(MYSQL)
  const result = []
  for (const sql of sqls) {
    const m = sql.match(/FROM `([^`]+)`/)
    if (m) await conn.query(`USE \`${m[1]}\``)
    const [rows] = await conn.query(sql)
    result.push(...rows)
  }
  await conn.end()
  return result
}

async function queryPg(sqls) {
  const result = []
  // 跨库 union 时每个 sql 自己连自己的库
  for (const sql of sqls) {
    const dbs = [...new Set((sql.match(/"([^"]+)"/g) || []).map((s) => s.slice(1, -1)).filter((n) => n.startsWith('南海家园')))]
    const dbName = dbs[0]
    const c = new pg.Client({ ...PG, database: dbName })
    await c.connect()
    const r = await c.query(sql)
    result.push(...r.rows)
    await c.end()
  }
  return result
}

async function runNamedQuery(name, db) {
  const def = QUERIES[name]
  if (!def) throw new Error(`unknown query: ${name}`)
  if (def.crossDb) {
    const tableSuffix = def.crossDb === 'pipes' ? '_低压' : '_调压箱'
    // 按表型选列（pipes 用 PIPENO/LENGTH，regulators 用 NAME/PRESSURED）
    const colListM = def.crossDb === 'pipes' ? 'PIPENO, DIAMETERO, LENGTH, MATERIAL' : 'NAME, ADDRESS, TYPE, PRESSURED'
    const colListP = def.crossDb === 'pipes' ? '"PIPENO", "DIAMETERO", "LENGTH", "MATERIAL"' : '"NAME", "ADDRESS", "TYPE", "PRESSURED"'
    const whereM = def.crossDb === 'pipes' ? 'LENGTH IS NOT NULL' : ''
    const whereP = def.crossDb === 'pipes' ? '"LENGTH" IS NOT NULL' : ''
    const result = []
    for (const c of COMMUNITIES) {
      if (db === 'mysql') {
        const conn = await mysql.createConnection(MYSQL)
        await conn.query(`USE \`${c + tableSuffix}\``)
        const sql = `SELECT '${c}' AS 社区, ${colListM} FROM \`${c + tableSuffix}\`${whereM ? ' WHERE ' + whereM : ''}`
        const [rows] = await conn.query(sql)
        result.push(...rows)
        await conn.end()
      } else {
        const c2 = new pg.Client({ ...PG, database: c + tableSuffix })
        await c2.connect()
        const sql = `SELECT '${c}' AS 社区, ${colListP} FROM "${c + tableSuffix}"${whereP ? ' WHERE ' + whereP : ''}`
        const r = await c2.query(sql)
        result.push(...r.rows)
        await c2.end()
      }
    }
    return def.postProcess ? def.postProcess(result) : result
  }
  const sqls = await def(db)
  const fn = db === 'mysql' ? queryMysql : queryPg
  return fn(sqls)
}

// ========== Field 数据同步 ==========
async function syncFieldData() {
  const t0 = Date.now()
  console.log('[sync] starting...')
  // 拉所有任务 + 每个任务的点 + 每个点的报告
  const tasks = await fieldReq('/tasks')
  console.log(`[sync] got ${tasks.length} tasks (${Date.now() - t0}ms)`)
  const fieldTasksTable = 'cp_field_tasks'
  const fieldPointsTable = 'cp_field_points'
  const fieldReportsTable = 'cp_field_reports'

  const summary = { tasks: 0, points: 0, reports: 0, by: 'mysql+pg' }

  for (const db of ['mysql', 'pg']) {
    const conn = db === 'mysql' ? await mysql.createConnection(MYSQL) : new pg.Client({ ...PG, database: 'postgres' })
    if (db === 'mysql') {
      console.log(`[sync][MySQL] starting inserts (${tasks.length} tasks)`)
      // 单库模式
      await conn.query(`CREATE DATABASE IF NOT EXISTS \`${fieldTasksTable}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
      await conn.query(`USE \`${fieldTasksTable}\``)
      // 幂等：建表（不存在才建）+ TRUNCATE 清数据
      await conn.query(`CREATE TABLE IF NOT EXISTS tasks (id VARCHAR(64) PRIMARY KEY, name VARCHAR(255), area VARCHAR(64), unit VARCHAR(64), pressureLevel VARCHAR(16), pointsCount INT DEFAULT 0, createdAt DATETIME, updatedAt DATETIME)`)
      await conn.query(`CREATE TABLE IF NOT EXISTS points (id VARCHAR(64) PRIMARY KEY, taskId VARCHAR(64), seq INT, location VARCHAR(255), lng DOUBLE, lat DOUBLE, dataTypes TEXT, createdAt DATETIME)`)
      await conn.query(`CREATE TABLE IF NOT EXISTS reports (id VARCHAR(64) PRIMARY KEY, taskId VARCHAR(64), pointId VARCHAR(64), items JSON, createdAt DATETIME)`)
      console.log(`[sync][MySQL] tables ready, truncating...`)
      await conn.query('TRUNCATE TABLE reports')
      await conn.query('TRUNCATE TABLE points')
      await conn.query('TRUNCATE TABLE tasks')
      console.log(`[sync][MySQL] truncated, starting inserts`)

      for (const t of tasks) {
        const pts = await fieldReq(`/tasks/${t.id}/points`)
        await conn.query(
          `INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?)`,
          [t.id, t.name, t.area, t.unit, t.pressureLevel, pts.length, new Date(t.createdAt), new Date(t.updatedAt)]
        )
        summary.tasks++
        for (const p of pts) {
          await conn.query(
            `INSERT INTO points VALUES (?,?,?,?,?,?,?,?)`,
            [p.id, p.taskId, p.seq, p.location, p.lng, p.lat, JSON.stringify(p.dataTypes), new Date(p.createdAt)]
          )
          summary.points++
          const reps = await fieldReq(`/tasks/${t.id}/reports?pointId=${p.id}`)
          for (const r of reps) {
            await conn.query(
              `INSERT INTO reports VALUES (?,?,?,?,?)`,
              [r.id, r.taskId, r.pointId, JSON.stringify(r.items), new Date(r.createdAt)]
            )
            summary.reports++
          }
        }
      }
      await conn.end()
    } else {
      // PG：建一个 cp_field 数据库
      const dbName = fieldTasksTable
      try {
        await conn.query(`CREATE DATABASE "${dbName}" WITH ENCODING 'UTF8' TEMPLATE template0`)
      } catch (e) {
        if (!String(e.message).includes('already exists')) throw e
      }
      await conn.end()
      const c = new pg.Client({ ...PG, database: dbName })
      await c.connect()
      // 幂等：建表 + TRUNCATE
      await c.query(`CREATE TABLE IF NOT EXISTS tasks (id VARCHAR(64) PRIMARY KEY, name VARCHAR(255), area VARCHAR(64), unit VARCHAR(64), "pressureLevel" VARCHAR(16), "pointsCount" INT DEFAULT 0, "createdAt" TIMESTAMP, "updatedAt" TIMESTAMP)`)
      await c.query(`CREATE TABLE IF NOT EXISTS points (id VARCHAR(64) PRIMARY KEY, "taskId" VARCHAR(64), seq INT, location VARCHAR(255), lng DOUBLE PRECISION, lat DOUBLE PRECISION, "dataTypes" TEXT, "createdAt" TIMESTAMP)`)
      await c.query(`CREATE TABLE IF NOT EXISTS reports (id VARCHAR(64) PRIMARY KEY, "taskId" VARCHAR(64), "pointId" VARCHAR(64), items JSONB, "createdAt" TIMESTAMP)`)
      await c.query('TRUNCATE TABLE reports, points, tasks')

      for (const t of tasks) {
        const pts = await fieldReq(`/tasks/${t.id}/points`)
        await c.query(
          `INSERT INTO tasks VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [t.id, t.name, t.area, t.unit, t.pressureLevel, pts.length, t.createdAt, t.updatedAt]
        )
        for (const p of pts) {
          await c.query(
            `INSERT INTO points VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [p.id, p.taskId, p.seq, p.location, p.lng, p.lat, JSON.stringify(p.dataTypes), p.createdAt]
          )
          const reps = await fieldReq(`/tasks/${t.id}/reports?pointId=${p.id}`)
          for (const r of reps) {
            await c.query(
              `INSERT INTO reports VALUES ($1,$2,$3,$4,$5)`,
              [r.id, r.taskId, r.pointId, JSON.stringify(r.items), r.createdAt]
            )
          }
        }
      }
      await c.end()
    }
  }
  return summary
}

// ========== 综合 dashboard 聚合 ==========
async function dashboardSummary() {
  const [mysql, pgResults] = await Promise.all([
    runNamedQuery('community-row-counts', 'mysql'),
    runNamedQuery('community-row-counts', 'pg'),
  ])
  // 加汇总
  const summary = { communities: {}, totals: { pipes: 0, inlets: 0, controls: 0, joints: 0, regulators: 0 } }
  for (const r of mysql) {
    const c = r.社区
    if (!summary.communities[c]) summary.communities[c] = {}
    summary.communities[c][r.设施] = Number(r.数量)
    const key = ({ 低压: 'pipes', 引入口_录入: 'inlets', 控制单元: 'controls', 绝缘接头: 'joints', 调压箱: 'regulators' })[r.设施]
    if (key) summary.totals[key] += Number(r.数量)
  }
  // 加管径分布
  summary.diameterDistribution = await runNamedQuery('diameter-distribution', 'mysql')
  // 加最长 5
  const longest = await runNamedQuery('longest-pipes-top10', 'mysql')
  summary.longestPipes = longest.slice(0, 5)
  // 加现场同步状态
  summary.field = await runNamedQuery('field-task-counts', 'mysql').catch(() => ({ tasks: 0, points: 0, reports: 0 }))
  return summary
}

// 添加 field 统计
QUERIES['field-task-counts'] = async () => [
  `SELECT (SELECT COUNT(*) FROM cp_field_tasks.tasks) AS tasks, (SELECT COUNT(*) FROM cp_field_tasks.points) AS points, (SELECT COUNT(*) FROM cp_field_tasks.reports) AS reports`,
]

QUERIES['field-tasks-list'] = async () => [
  `SELECT id, name, area, unit, pressureLevel, pointsCount, createdAt, updatedAt FROM cp_field_tasks.tasks ORDER BY createdAt DESC LIMIT 50`,
]

QUERIES['field-task-points'] = async () => [
  `SELECT taskId, COUNT(*) AS pointCount FROM cp_field_tasks.points GROUP BY taskId ORDER BY pointCount DESC`,
]

QUERIES['field-task-reports'] = async () => [
  `SELECT taskId, COUNT(*) AS reportCount, MIN(createdAt) AS firstReport, MAX(createdAt) AS lastReport FROM cp_field_tasks.reports GROUP BY taskId`,
]

// ============== Auto-sync on first request ==============
// Vite middleware 不能跑长任务（DB call + 远程 fetch 串起来，单线程会卡）
// 改用 child process 跑独立脚本，前端通过 jobId 轮询状态
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SYNC_SCRIPT = path.resolve(__dirname, '../_field2db.mjs')

// Job 状态（内存）
const jobs = new Map()

function startSyncJob() {
  const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const job = {
    id: jobId,
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    output: [],
    result: null,
    error: null,
  }
  jobs.set(jobId, job)

  console.log(`[sync] starting job ${jobId} via child process`)
  const child = spawn(process.execPath, [SYNC_SCRIPT, '--db', 'both'], {
    env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    cwd: path.resolve(__dirname, '..'),
  })

  child.stdout.on('data', (d) => {
    const s = d.toString()
    job.output.push(s)
    console.log(`[sync ${jobId}] ${s.trim()}`)
  })
  child.stderr.on('data', (d) => {
    const s = d.toString()
    job.output.push(s)
    console.log(`[sync ${jobId} ERR] ${s.trim()}`)
  })
  child.on('close', (code) => {
    job.finishedAt = Date.now()
    if (code === 0) {
      job.status = 'success'
      // 解析最后一行找总结
      const tail = job.output.join('').split(/\r?\n/).filter(Boolean).slice(-3).join(' / ')
      job.result = { message: tail }
    } else {
      job.status = 'error'
      job.error = `exit code ${code}`
    }
    console.log(`[sync ${jobId}] finished: ${job.status} (${(job.finishedAt - job.startedAt)}ms)`)
  })
  child.on('error', (e) => {
    job.finishedAt = Date.now()
    job.status = 'error'
    job.error = e.message
  })

  return job
}

// ========== Vite 插件 ==========
export default function sqlApi() {
  return {
    name: 'cp-sql-api',
    configureServer(server) {
      // CORS
      server.middlewares.use((req, res, next) => {
        res.setHeader('access-control-allow-origin', '*')
        res.setHeader('access-control-allow-headers', 'authorization, content-type')
        res.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS')
        if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }
        next()
      })

      const send = (res, status, obj) => {
        res.statusCode = status
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify(obj))
      }

      // 健康
      server.middlewares.use('/api/sql/health', async (req, res) => {
        const result = { ok: false, mysql: null, pg: null }
        try {
          const c = await mysql.createConnection(MYSQL)
          await c.query('SELECT 1')
          await c.end()
          result.mysql = 'ok'
        } catch (e) { result.mysql = e.message }
        try {
          const c = new pg.Client({ ...PG, database: 'postgres' })
          await c.connect()
          await c.query('SELECT 1')
          await c.end()
          result.pg = 'ok'
        } catch (e) { result.pg = e.message }
        result.ok = result.mysql === 'ok' && result.pg === 'ok'
        send(res, result.ok ? 200 : 500, result)
      })

      // 命名查询
      server.middlewares.use('/api/sql/q', async (req, res) => {
        try {
          const url = new URL(req.url, 'http://x')
          const name = url.searchParams.get('name')
          const db = url.searchParams.get('db') || 'mysql'
          if (!name) return send(res, 400, { error: 'missing name' })
          if (!QUERIES[name]) return send(res, 404, { error: `unknown query: ${name}` })
          const t0 = Date.now()
          const rows = await runNamedQuery(name, db)
          send(res, 200, { name, db, ms: Date.now() - t0, rows })
        } catch (e) { send(res, 500, { error: e.message, stack: e.stack }) }
      })

      // 列出所有查询名
      server.middlewares.use('/api/sql/list', (req, res) => {
        send(res, 200, { queries: Object.keys(QUERIES) })
      })

      // 触发 field 数据同步（异步：立即返回 jobId，sync 在子进程跑）
      server.middlewares.use('/api/sql/field/sync', async (req, res) => {
        try {
          // 不允许并发
          const running = [...jobs.values()].find((j) => j.status === 'running')
          if (running) {
            return send(res, 200, { jobId: running.id, status: 'running', message: '已有同步任务在跑' })
          }
          const job = startSyncJob()
          send(res, 200, { jobId: job.id, status: 'running', startedAt: job.startedAt })
        } catch (e) { send(res, 500, { error: e.message, stack: e.stack }) }
      })

      // 查 job 状态
      server.middlewares.use('/api/sql/field/job', (req, res) => {
        const url = new URL(req.url, 'http://x')
        const jobId = url.searchParams.get('id')
        if (!jobId) {
          return send(res, 200, { jobs: [...jobs.values()].slice(-5) })
        }
        const job = jobs.get(jobId)
        if (!job) return send(res, 404, { error: 'job not found' })
        send(res, 200, job)
      })

      // 已同步的现场任务
      server.middlewares.use('/api/sql/field/tasks', async (req, res) => {
        try {
          const url = new URL(req.url, 'http://x')
          const db = url.searchParams.get('db') || 'mysql'
          const t0 = Date.now()
          if (db === 'mysql') {
            const conn = await mysql.createConnection({ ...MYSQL, database: 'cp_field_tasks' })
            const [tasks] = await conn.query('SELECT * FROM tasks ORDER BY createdAt DESC LIMIT 50')
            const [points] = await conn.query('SELECT taskId, COUNT(*) AS cnt FROM points GROUP BY taskId')
            const [reports] = await conn.query('SELECT taskId, COUNT(*) AS cnt FROM reports GROUP BY taskId')
            await conn.end()
            send(res, 200, { ms: Date.now() - t0, db, tasks, points, reports })
          } else {
            const c = new pg.Client({ ...PG, database: 'cp_field_tasks' })
            await c.connect()
            const t = await c.query('SELECT * FROM tasks ORDER BY "createdAt" DESC LIMIT 50')
            const p = await c.query('SELECT "taskId", COUNT(*)::int AS cnt FROM points GROUP BY "taskId"')
            const r = await c.query('SELECT "taskId", COUNT(*)::int AS cnt FROM reports GROUP BY "taskId"')
            await c.end()
            send(res, 200, { ms: Date.now() - t0, db, tasks: t.rows, points: p.rows, reports: r.rows })
          }
        } catch (e) { send(res, 500, { error: e.message }) }
      })

      // 一次性返回所有 tasks+points+reports（前端 syncField 用，避免 N+1）
      server.middlewares.use('/api/sql/field/snapshot', async (req, res) => {
        try {
          const url = new URL(req.url, 'http://x')
          const db = url.searchParams.get('db') || 'mysql'
          const t0 = Date.now()
          if (db === 'mysql') {
            const conn = await mysql.createConnection({ ...MYSQL, database: 'cp_field_tasks' })
            const [tasks] = await conn.query('SELECT * FROM tasks ORDER BY createdAt DESC')
            const [points] = await conn.query('SELECT * FROM points ORDER BY taskId, seq')
            const [reports] = await conn.query('SELECT id, taskId, pointId, items, createdAt FROM reports ORDER BY taskId, pointId, createdAt')
            await conn.end()
            send(res, 200, {
              ms: Date.now() - t0, db,
              tasks,
              points,
              reports: reports.map((r) => ({ ...r, items: typeof r.items === 'string' ? JSON.parse(r.items) : r.items })),
            })
          } else {
            const c = new pg.Client({ ...PG, database: 'cp_field_tasks' })
            await c.connect()
            const t = await c.query('SELECT * FROM tasks ORDER BY "createdAt" DESC')
            const p = await c.query('SELECT * FROM points ORDER BY "taskId", seq')
            const r = await c.query('SELECT id, "taskId", "pointId", items, "createdAt" FROM reports ORDER BY "taskId", "pointId", "createdAt"')
            await c.end()
            send(res, 200, { ms: Date.now() - t0, db, tasks: t.rows, points: p.rows, reports: r.rows })
          }
        } catch (e) { send(res, 500, { error: e.message }) }
      })

      // Dashboard 综合
      server.middlewares.use('/api/sql/dashboard', async (req, res) => {
        try {
          const t0 = Date.now()
          const summary = await dashboardSummary()
          send(res, 200, { ms: Date.now() - t0, ...summary, autoSync: { available: true, hint: 'POST /api/sql/field/sync to trigger' } })
        } catch (e) { send(res, 500, { error: e.message, stack: e.stack }) }
      })
    },
  }
}
