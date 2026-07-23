// _csv2db_dry.mjs — 只解析 CSV + 推断类型 + 打印 schema，不连库
// 用法：node _csv2db_dry.mjs
import fs from 'node:fs'
import path from 'node:path'

const CSV_DIR = path.resolve('public/data')

function csvToIdent(filename) {
  return filename.replace(/\.csv$/i, '').replace(/-/g, '_')
}

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

function readCsv(filepath) {
  let raw = fs.readFileSync(filepath, 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0)
  if (lines.length === 0) return { headers: [], rows: [] }
  const headers = parseCsvLine(lines[0])
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
    while (cells.length < uniqueHeaders.length) cells.push('')
    rows.push(cells)
  }
  return { headers: uniqueHeaders, rows }
}

function inferColumnType(values) {
  const nonEmpty = values.filter((v) => v !== '' && v != null)
  if (nonEmpty.length === 0) return { mysql: 'VARCHAR(255)', pg: 'VARCHAR(255)' }
  if (nonEmpty.every((v) => /^-?\d+$/.test(String(v).trim()))) {
    const max = Math.max(...nonEmpty.map((v) => Math.abs(parseInt(String(v).trim(), 10) || 0)))
    if (max <= 2147483647) return { mysql: 'INT', pg: 'INTEGER' }
    return { mysql: 'BIGINT', pg: 'BIGINT' }
  }
  if (nonEmpty.every((v) => /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(String(v).trim()))) {
    return { mysql: 'DOUBLE', pg: 'DOUBLE PRECISION' }
  }
  if (nonEmpty.every((v) =>
    /^\d{4}[/-]\d{1,2}[/-]\d{1,2}([ T]\d{1,2}:\d{1,2}(:\d{1,2})?(\.\d+)?)?$/.test(String(v).trim())
  )) {
    return { mysql: 'DATETIME', pg: 'TIMESTAMP' }
  }
  const maxLen = Math.max(...nonEmpty.map((v) => String(v).length))
  if (maxLen <= 50) return { mysql: `VARCHAR(${Math.max(maxLen, 1)})`, pg: `VARCHAR(${Math.max(maxLen, 1)})` }
  if (maxLen <= 255) return { mysql: 'VARCHAR(255)', pg: 'VARCHAR(255)' }
  if (maxLen <= 1000) return { mysql: 'VARCHAR(1000)', pg: 'VARCHAR(1000)' }
  if (maxLen <= 4000) return { mysql: 'VARCHAR(4000)', pg: 'VARCHAR(4000)' }
  return { mysql: 'TEXT', pg: 'TEXT' }
}

const csvFiles = fs.readdirSync(CSV_DIR).filter((f) => f.toLowerCase().endsWith('.csv')).sort()
console.log(`发现 ${csvFiles.length} 个 CSV\n`)

for (const file of csvFiles) {
  const ident = csvToIdent(file)
  const filepath = path.join(CSV_DIR, file)
  const { headers, rows } = readCsv(filepath)
  console.log(`━━━ ${file} → ${ident} (${rows.length} 行, ${headers.length} 列) ━━━`)
  headers.forEach((h, i) => {
    const colValues = rows.map((r) => r[i])
    if (h === 'WKT') {
      console.log(`  [${i}] "${h}" → TEXT (强制)`)
      return
    }
    const t = inferColumnType(colValues)
    const sample = colValues.slice(0, 2).map((v) => v === '' ? '<空>' : `"${v}"`).join(', ')
    console.log(`  [${i}] "${h}" → MySQL:${t.mysql} | PG:${t.pg} | sample: ${sample}`)
  })
  console.log('')
}
