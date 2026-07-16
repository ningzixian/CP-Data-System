/**
 * 业务通用工具
 *
 *  - communityOfUnit: 从 unit.address 解析出小区名
 *    写入约定："南海家园七里 · 单元 X"，" · " 前缀就是小区名
 *  - communitiesFromUnits: 按 COMMUNITY_ORDER 顺序分桶 + 防御性追加未知小区
 *  - progressColor / statusColor: 给进度条 / 状态徽章取色
 */
import type { CorrosionUnit, InspectionStatus, RecordStatus } from '@/types/models'

export function communityOfUnit(unit: CorrosionUnit | null | undefined): string {
  const addr = unit?.address
  if (!addr) return '未分类'
  const idx = addr.indexOf(' · ')
  return idx > 0 ? addr.slice(0, idx) : '未分类'
}

export const COMMUNITY_ORDER = [
  '南海家园七里',
  '南海家园六里',
  '南海家园五里',
  '南海家园四里',
  '南海家园三里',
  '南海家园二里',
  '南海家园一里',
  '亦庄金茂悦北区',
  '亦庄金茂悦南区',
  '金茂逸墅',
  '金域东郡',
  '观海苑',
  '棠颂璟庐',
  '鹿海园一里',
  '鹿海园三里',
  '鹿海园四里',
  '鹿海园五里',
  '泰河园一里',
  '泰河园一里二区',
  '泰河园三里',
  '泰河园四里一区',
  '泰河园四里二区',
  '泰河园七里',
  '悦廷',
  '亦园',
  '北京中芯花园',
  '亦城茗苑',
] as const

export function communitiesFromUnits(units: CorrosionUnit[]) {
  const buckets = new Map<string, CorrosionUnit[]>()
  for (const u of units) {
    const c = communityOfUnit(u)
    let arr = buckets.get(c)
    if (!arr) {
      arr = []
      buckets.set(c, arr)
    }
    arr.push(u)
  }
  const known = new Set<string>()
  const result: { name: string; units: CorrosionUnit[] }[] = []
  for (const name of COMMUNITY_ORDER) {
    known.add(name)
    result.push({ name, units: buckets.get(name) ?? [] })
  }
  for (const [name, list] of buckets) {
    if (known.has(name)) continue
    result.push({ name, units: list })
  }
  return result
}

export function progressColor(p: number): string {
  if (p >= 1) return '#67c23a'
  if (p > 0.8) return '#e6a23c'
  if (p > 0) return '#409eff'
  return '#909399'
}

export const STATUS_COLORS: Record<InspectionStatus | RecordStatus | string, string> = {
  pending: '#909399',
  in_progress: '#e6a23c',
  passed: '#67c23a',
  exception: '#f56c6c',
  completed: '#67c23a',
}

export function avgProgress(units: CorrosionUnit[]): number {
  if (units.length === 0) return 0
  return units.reduce((s, u) => s + (u.inspection_progress || 0), 0) / units.length
}

export function countByStatus<T extends { status: string }>(items: T[]): Record<string, number> {
  const result: Record<string, number> = {}
  for (const it of items) {
    result[it.status] = (result[it.status] || 0) + 1
  }
  return result
}

/** CSV 字段转义（双引号包裹含逗号/换行/双引号的字段） */
export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

/** 把任意二维数组转成 CSV 文本 */
export function toCSV(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvEscape).join(',')]
  for (const r of rows) lines.push(r.map(csvEscape).join(','))
  return lines.join('\r\n')
}

/** 触发浏览器下载 */
export function downloadCSV(filename: string, csv: string) {
  // 加 BOM 让 Excel 正确识别 UTF-8
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
