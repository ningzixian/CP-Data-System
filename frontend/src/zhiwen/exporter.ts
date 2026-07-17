/**
 * 导出工具 — 把智问结果导出为 Excel / CSV / JSON
 *
 * 用法：
 *   await exportQueryResult(result, { format: 'xlsx', question: '七里DN100管线总长' })
 *   await exportQueryResult(result, { format: 'csv',  question: '七里调压箱' })
 *   await exportQueryResult(result, { format: 'json', question: '管线分布' })
 *
 * Excel 用 sheetjs（xlsx）动态加载，不影响主包大小。
 */

import type { QueryResult } from './engine'

export type ExportFormat = 'xlsx' | 'csv' | 'json'

export interface ExportOptions {
  format: ExportFormat
  /** 用户原始问题（用于生成文件名 + Excel sheet 名） */
  question: string
  /** 选中的列（默认全部）。空数组 = 全部 */
  columns?: string[]
  /** 最多导出行数（默认全量） */
  maxRows?: number
}

/** 生成默认文件名：`智问_七里DN100以上管线总长_20260717_143052.xlsx` */
export function buildFileName(question: string, format: ExportFormat): string {
  const safeQ = question.trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 30) || '查询'
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const ext = format === 'xlsx' ? 'xlsx' : format === 'csv' ? 'csv' : 'json'
  return `智问_${safeQ}_${ts}.${ext}`
}

/** 触发浏览器下载 */
function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 500)
}

/** 主入口 */
export async function exportQueryResult(
  result: QueryResult,
  options: ExportOptions,
): Promise<{ ok: boolean; fileName: string; sizeBytes: number; error?: string }> {
  if (!result.table) {
    return { ok: false, fileName: '', sizeBytes: 0, error: '当前结果没有表格数据可导出' }
  }
  const { format, question, columns, maxRows } = options
  const headers = columns && columns.length
    ? columns.filter((c) => result.table!.headers.includes(c))
    : result.table.headers
  const allRows = result.table.rows
  const rows = maxRows && maxRows > 0 ? allRows.slice(0, maxRows) : allRows
  const fileName = buildFileName(question, format)

  try {
    let blob: Blob
    if (format === 'xlsx') {
      blob = await toXlsx(headers, rows, question, result)
    } else if (format === 'csv') {
      blob = toCsv(headers, rows)
    } else {
      blob = toJson(headers, rows, question, result)
    }
    downloadBlob(blob, fileName)
    return { ok: true, fileName, sizeBytes: blob.size }
  } catch (e) {
    return { ok: false, fileName, sizeBytes: 0, error: (e as Error).message }
  }
}

// ============== CSV 实现 ==============

function csvEscape(v: any): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  // 含特殊字符 → 用双引号包裹，内部双引号转义
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function toCsv(headers: string[], rows: any[]): Blob {
  // UTF-8 BOM 让 Excel 正确识别中文
  const BOM = '\uFEFF'
  const lines: string[] = []
  lines.push(headers.map(csvEscape).join(','))
  for (const r of rows) {
    lines.push(headers.map((h) => csvEscape(r[h])).join(','))
  }
  const csv = BOM + lines.join('\r\n')
  return new Blob([csv], { type: 'text/csv;charset=utf-8' })
}

// ============== JSON 实现 ==============

function toJson(headers: string[], rows: any[], question: string, result: QueryResult): Blob {
  const payload = {
    question,
    exportedAt: new Date().toISOString(),
    summary: result.text.replace(/\*\*/g, ''),
    sql: result.sql,
    totalCount: result.totalCount,
    columns: headers,
    rows: rows.map((r) => {
      const o: Record<string, any> = {}
      for (const h of headers) o[h] = r[h]
      return o
    }),
  }
  const text = JSON.stringify(payload, null, 2)
  return new Blob([text], { type: 'application/json;charset=utf-8' })
}

// ============== Excel 实现（动态 import xlsx） ==============

async function toXlsx(headers: string[], rows: any[], question: string, result: QueryResult): Promise<Blob> {
  // 动态加载，避免影响主包大小
  const XLSX = await import('xlsx')

  // Sheet 1：明细数据
  const aoa: any[][] = [headers]
  for (const r of rows) aoa.push(headers.map((h) => r[h]))
  const ws1 = XLSX.utils.aoa_to_sheet(aoa)
  // 列宽自适应（粗略估算：按列名长度 + 4 个汉字宽）
  ws1['!cols'] = headers.map((h) => ({ wch: Math.max(10, h.length * 2 + 8) }))

  // Sheet 2：查询元信息
  const meta: any[][] = [
    ['查询问题', question],
    ['导出时间', new Date().toLocaleString('zh-CN')],
    ['查询思路', result.sql || ''],
    ['回答摘要', result.text.replace(/\*\*/g, '')],
    ['总命中数', result.totalCount ?? rows.length],
    ['本次导出行数', rows.length],
    [''],
    ['数据列', ''],
    ...headers.map((h) => [h, '']),
  ]
  const ws2 = XLSX.utils.aoa_to_sheet(meta)
  ws2['!cols'] = [{ wch: 16 }, { wch: 60 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws1, '查询结果')
  XLSX.utils.book_append_sheet(wb, ws2, '查询元信息')

  // 用 array → buffer → Blob 走，保证 IE/Edge/WPS 都能正确识别
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

// ============== 工具：格式化字节数 ==============

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}
