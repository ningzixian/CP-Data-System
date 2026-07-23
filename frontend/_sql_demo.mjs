// _sql_demo.mjs — 用 SQL 算智问里的典型统计问题
// MySQL 不强制引号列名，PG 会把 DIAMETERO 自动小写成 diametero → 找不到
// 解决：所有列名都用 col() 包，PG 强制加双引号
import mysql from 'mysql2/promise'
import pg from 'pg'

const { Client: PgClient } = pg
const MYSQL = { host: '192.168.0.253', port: 3306, user: 'root', password: 'abcd1234', supportBigNumbers: true, bigNumberStrings: true }
const PG = { host: '192.168.0.253', port: 5432, user: 'postgres', password: 'abcd1234' }

// 表名
const tM = (s) => `\`${s}\``
const tP = (s) => `"${s}"`
// 列名（PG 强制大写必须加引号）
const cM = (s) => `\`${s}\``
const cP = (s) => `"${s}"`
// 按 db 选
const tbl = (db, name) => (db === 'mysql' ? tM(name) : tP(name))
const col = (db, name) => (db === 'mysql' ? cM(name) : cP(name))

// 通用 SELECT 列构造（PG alias 也加引号，保留大小写）
const cols = (db, list) =>
  list.map((c) => `${col(db, c)} AS ${db === 'mysql' ? c : `"${c}"`}`).join(', ')

const COMMUNITIES = ['南海家园七里', '南海家园三里', '南海家园六里']

const QUERIES = [
  {
    title: 'Q1. 各社区低压管线总长度（米）',
    sql: (db) =>
      COMMUNITIES.map((c) => {
        const t = tbl(db, c + '_低压')
        return `SELECT '${c}' AS 社区, COUNT(*) AS 段数, ROUND(SUM(CAST(${col(db, 'LENGTH')} AS DECIMAL(18,4))), 2) AS 总长度米, ROUND(AVG(CAST(${col(db, 'LENGTH')} AS DECIMAL(18,4))), 2) AS 平均段长米 FROM ${t}`
      }),
  },
  {
    title: 'Q2. 各社区管径分布（段数）',
    sql: (db) =>
      COMMUNITIES.flatMap((c) =>
        [50, 80, 100, 150].map(
          (d) => `SELECT '${c}' AS 社区, ${d} AS 管径, COUNT(*) AS 段数 FROM ${tbl(db, c + '_低压')} WHERE ${col(db, 'DIAMETERO')} = ${d}`
        )
      ),
  },
  {
    title: 'Q3. 2017 年新增/改造管线（六里）',
    sql: (db) => {
      const t = tbl(db, '南海家园六里_低压')
      return [`SELECT ${cols(db, ['PIPENO', 'MANAGEREGI', 'DIAMETERO', 'LENGTH', 'MATERIAL', 'YEAR'])} FROM ${t} WHERE ${col(db, 'YEAR')} IS NOT NULL ORDER BY ${col(db, 'YEAR')}, ${col(db, 'PIPENO')}`]
    },
  },
  {
    title: 'Q4. 各社区控制单元面积 TOP 5',
    sql: (db) =>
      COMMUNITIES.map((c) => {
        const t = tbl(db, c + '_控制单元')
        return `SELECT '${c}' AS 社区, ${cols(db, ['NAME', 'SHAPE_Leng', 'SHAPE_Area', 'Press'])} FROM ${t} ORDER BY ${col(db, 'SHAPE_Area')} DESC LIMIT 5`
      }),
  },
  {
    title: 'Q5. 各社区引入口数量（按压力等级）',
    sql: (db) =>
      COMMUNITIES.map(
        (c) => `SELECT '${c}' AS 社区, ${col(db, 'PRESSURED')} AS 压力, COUNT(*) AS 数量 FROM ${tbl(db, c + '_引入口_录入')} GROUP BY ${col(db, 'PRESSURED')}`
      ),
  },
  {
    title: 'Q6. 跨社区绝缘接头类型分布',
    sql: (db) =>
      COMMUNITIES.map(
        (c) => `SELECT '${c}' AS 社区, ${col(db, 'TYPE')} AS 类型, COUNT(*) AS 数量 FROM ${tbl(db, c + '_绝缘接头')} GROUP BY ${col(db, 'TYPE')}`
      ),
  },
  {
    title: 'Q7. 跨社区最长 10 段管线',
    crossDb: true,
    sql: (db) => (c) => {
      const t = tbl(db, c + '_低压')
      return `SELECT '${c}' AS 社区, ${cols(db, ['PIPENO', 'DIAMETERO', 'LENGTH', 'MATERIAL'])} FROM ${t} WHERE ${col(db, 'LENGTH')} IS NOT NULL`
    },
    postProcess: (rows) => {
      rows.sort((a, b) => Number(b.LENGTH) - Number(a.LENGTH))
      return rows.slice(0, 10)
    },
  },
  {
    title: 'Q8. 调压箱分布（跨社区）',
    crossDb: true,
    sql: (db) => (c) => {
      const t = tbl(db, c + '_调压箱')
      return `SELECT '${c}' AS 社区, ${cols(db, ['NAME', 'ADDRESS', 'TYPE', 'PRESSURED'])} FROM ${t}`
    },
    postProcess: (rows) => {
      rows.sort((a, b) => {
        if (a.社区 < b.社区) return -1
        if (a.社区 > b.社区) return 1
        return String(a.NAME).localeCompare(String(b.NAME))
      })
      return rows
    },
  },
]

// 在 PG 上：先看 SQL 涉及哪些库，逐库连
function extractPgDbs(sql) {
  const m = sql.match(/"([^"]+)"/g) || []
  return [...new Set(m.map((s) => s.slice(1, -1)).filter((n) => n.startsWith('南海家园')))]
}

async function runMysql(q) {
  const conn = await mysql.createConnection(MYSQL)
  const t0 = Date.now()
  let result = []
  if (q.crossDb) {
    for (const c of COMMUNITIES) {
      const sql = q.sql('mysql')(c)
      await conn.query(`USE \`${c + '_低压'}\``.replace('_低压', q.title.includes('调压箱') ? '_调压箱' : '_低压'))
      const [rows] = await conn.query(sql)
      result.push(...rows)
    }
  } else {
    for (const sql of q.sql('mysql')) {
      const m = sql.match(/FROM `([^`]+)`/)
      if (m) await conn.query(`USE \`${m[1]}\``)
      const [rows] = await conn.query(sql)
      result.push(...rows)
    }
  }
  if (q.postProcess) result = q.postProcess(result)
  const ms = Date.now() - t0
  await conn.end()
  return { rows: result, ms }
}

async function runPg(q) {
  const t0 = Date.now()
  let result = []
  if (q.crossDb) {
    const isQ7 = q.title.includes('最长')
    const tableSuffix = isQ7 ? '_低压' : '_调压箱'
    for (const c of COMMUNITIES) {
      const c2 = new PgClient({ ...PG, database: c + tableSuffix })
      await c2.connect()
      const r = await c2.query(q.sql('pg')(c))
      result.push(...r.rows)
      await c2.end()
    }
  } else {
    for (const sql of q.sql('pg')) {
      const sqlDbs = extractPgDbs(sql)
      const dbName = sqlDbs[0]
      const c = new PgClient({ ...PG, database: dbName })
      await c.connect()
      const r = await c.query(sql)
      result.push(...r.rows)
      await c.end()
    }
  }
  if (q.postProcess) result = q.postProcess(result)
  const ms = Date.now() - t0
  return { rows: result, ms }
}

console.log('━━━ MySQL vs PG SQL 统计对比 ━━━\n')
for (const q of QUERIES) {
  console.log(`\n━━━ ${q.title} ━━━`)
  const [mr, pr] = await Promise.all([runMysql(q), runPg(q)])
  console.log(`\n[MySQL] ${mr.rows.length} 行，${mr.ms}ms`)
  console.table(mr.rows.slice(0, 20))
  if (mr.rows.length > 20) console.log(`... 还有 ${mr.rows.length - 20} 行省略`)
  console.log(`\n[PG] ${pr.rows.length} 行，${pr.ms}ms`)
  console.table(pr.rows.slice(0, 20))
  if (pr.rows.length > 20) console.log(`... 还有 ${pr.rows.length - 20} 行省略`)
  // 数据一致性（统一键名大小写，去掉数字字符串差异）
  const norm = (r) => {
    const o = {}
    for (const k of Object.keys(r)) {
      const lower = k.toLowerCase()
      const v = r[k]
      o[lower] = String(v)
    }
    return JSON.stringify(o)
  }
  const myJson = mr.rows.map(norm).sort().join('|')
  const pgJson = pr.rows.map(norm).sort().join('|')
  if (myJson === pgJson) {
    console.log('✅ MySQL/PG 数据完全一致')
  } else {
    console.log('⚠️  MySQL/PG 数据有差异（看上面表格）')
  }
}
console.log('\n=== 完成 ===')
