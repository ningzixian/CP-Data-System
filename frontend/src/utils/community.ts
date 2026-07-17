import type { CorrosionUnit, InspectionStatus, RecordStatus } from '@/types/models'

export function communityOfUnit(unit: CorrosionUnit | null | undefined): string {
  const address = unit?.address
  if (!address) return '未分类'
  const separatorIndex = address.indexOf(' · ')
  return separatorIndex > 0 ? address.slice(0, separatorIndex) : '未分类'
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

export function communitiesFromUnits(units: CorrosionUnit[]): Array<{ name: string; units: CorrosionUnit[] }> {
  const buckets = new Map<string, CorrosionUnit[]>()
  units.forEach((unit) => {
    const community = communityOfUnit(unit)
    buckets.set(community, [...(buckets.get(community) ?? []), unit])
  })

  const known = new Set<string>()
  const result: Array<{ name: string; units: CorrosionUnit[] }> = []
  COMMUNITY_ORDER.forEach((name) => {
    known.add(name)
    result.push({ name, units: buckets.get(name) ?? [] })
  })
  buckets.forEach((communityUnits, name) => {
    if (!known.has(name)) result.push({ name, units: communityUnits })
  })
  return result
}

export function progressColor(progress: number): string {
  if (progress >= 1) return '#67c23a'
  if (progress > 0.8) return '#e6a23c'
  if (progress > 0) return '#409eff'
  return '#909399'
}

export const COMMUNITY_STATUS_COLORS: Record<InspectionStatus | RecordStatus | string, string> = {
  pending: '#909399',
  in_progress: '#e6a23c',
  passed: '#67c23a',
  exception: '#f56c6c',
  completed: '#67c23a',
}

export function averageCommunityProgress(units: CorrosionUnit[]): number {
  return units.length
    ? units.reduce((sum, unit) => sum + (unit.inspection_progress || 0), 0) / units.length
    : 0
}

export function countByStatus<T extends { status: string }>(items: T[]): Record<string, number> {
  return items.reduce<Record<string, number>>((result, item) => {
    result[item.status] = (result[item.status] || 0) + 1
    return result
  }, {})
}

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCSV(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n')
}

export function downloadCSV(filename: string, csv: string) {
  // BOM 仅用于导出的 Excel CSV，源代码和项目数据文件仍保持 UTF-8 无 BOM。
  const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
