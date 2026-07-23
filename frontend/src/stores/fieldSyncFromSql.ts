/**
 * fieldSyncFromSql.ts — 从 SQL 读现场数据，喂给前端 cp store
 *
 * 与 fieldSync.ts 的区别：
 *  - fieldSync.ts      走 HTTP 到 192.168.20.40:3000 拉 src.20270721
 *  - fieldSyncFromSql  走 SQL（Vite middleware → MySQL/PG）拉 cp_field_tasks
 *
 * 数据已通过 _field2db.mjs 同步到 MySQL + PG，前端只需读 snapshot
 * 优势：单次 HTTP 拿到所有数据，不存在 N+1、性能稳定
 */
import type { InspectionRecord, InspectionItemCode, CorrosionUnit } from '@/types/models'

// 后端 dataTypes → 前端 item_code 映射（与 src.20270721 的 item key 一致）
const DATA_TYPE_TO_ITEM_CODE: Record<string, InspectionItemCode> = {
  土壤电阻率: 'SOIL_RESISTIVITY',
  管线探测: 'COATING_DETECT',
}

// 7 项检测项总数
const TOTAL_ITEMS = 7

interface SnapshotTask {
  id: string
  name: string
  area: string
  unit: string
  pressureLevel: string
  pointsCount: number
  createdAt: string
  updatedAt: string
}
interface SnapshotPoint {
  id: string
  taskId: string
  seq: number
  location: string
  lng: number
  lat: number
  dataTypes: string[]
  createdAt: string
}
interface SnapshotReport {
  id: string
  taskId: string
  pointId: string
  items: Record<string, any>
  createdAt: string
}

interface Snapshot {
  tasks: SnapshotTask[]
  points: SnapshotPoint[]
  reports: SnapshotReport[]
}

interface SyncResult {
  source: 'sql'
  taskCount: number
  pointCount: number
  recordCount: number
  matchedUnits: number
  unitProgress: Record<string, number>
}

function hashStringToInt(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h) || 1
}

function pickMeasuredValue(v: any): { value: number; unit: string } | null {
  if (!v || typeof v !== 'object') return null
  if (typeof v.电阻率 === 'number') return { value: v.电阻率, unit: 'Ω·m' }
  if (typeof v.酸碱度 === 'number') return { value: v.酸碱度, unit: 'pH' }
  if (typeof v.埋深 === 'number') return { value: v.埋深, unit: 'm' }
  if (typeof v.电阻值 === 'number') return { value: v.电阻值, unit: 'Ω' }
  return null
}

/**
 * 拉 snapshot
 */
async function fetchSnapshot(): Promise<Snapshot> {
  const r = await fetch('/api/sql/field/snapshot?db=mysql')
  if (!r.ok) throw new Error(`snapshot ${r.status}`)
  return r.json()
}

/**
 * 同步：snapshot → cp store
 */
export async function syncFieldFromSql(cpStore: {
  records: any[]
  units: CorrosionUnit[]
  dashboard: any
  fieldTasks?: any[]
}): Promise<SyncResult> {
  const result: SyncResult = {
    source: 'sql',
    taskCount: 0,
    pointCount: 0,
    recordCount: 0,
    matchedUnits: 0,
    unitProgress: {},
  }

  try {
    const snap = await fetchSnapshot()
    result.taskCount = snap.tasks.length
    result.pointCount = snap.points.length
    result.reports = 0  // 临时

    if (cpStore.fieldTasks) {
      cpStore.fieldTasks.length = 0
      cpStore.fieldTasks.push(...snap.tasks)
    }

    // 按 task.unit 聚合 reports
    const reportsByUnit = new Map<string, SnapshotReport[]>()
    const pointById = new Map<string, SnapshotPoint>()
    for (const p of snap.points) pointById.set(p.id, p)

    for (const r of snap.reports) {
      const task = snap.tasks.find((t) => t.id === r.taskId)
      if (!task || !task.unit) continue
      if (!reportsByUnit.has(task.unit)) reportsByUnit.set(task.unit, [])
      reportsByUnit.get(task.unit)!.push(r)
    }

    // 更新每个匹配的 unit
    for (const [unitName, reports] of reportsByUnit.entries()) {
      const unit = cpStore.units.find((u) => u.name === unitName)
      if (!unit) {
        console.log(`[fieldSyncFromSql] skip unit=${unitName}（前端无匹配）`)
        continue
      }
      result.matchedUnits++

      const itemCodes = new Set<InspectionItemCode>()
      let latest: string | undefined
      const newRecords: any[] = []
      for (const r of reports) {
        if (r.createdAt && (!latest || r.createdAt > latest)) latest = r.createdAt
        for (const k of Object.keys(r.items)) {
          const code = DATA_TYPE_TO_ITEM_CODE[k]
          if (!code) continue
          itemCodes.add(code)
          const point = pointById.get(r.pointId)
          if (!point) continue
          const measured = pickMeasuredValue(r.items[k])
          newRecords.push({
            id: hashStringToInt(`${r.id}-${k}`),
            unit_id: unit.id,
            point_id: hashStringToInt(point.id),
            item_code: code,
            item_name: k,
            inspector: undefined,
            inspection_date: r.createdAt,
            measured_value: measured?.value,
            measured_unit: measured?.unit,
            work_hours: undefined,
            personnel_count: undefined,
            personnel_level: undefined,
            status: 'passed',
            created_at: r.createdAt,
            _unit_name: unitName,
            _task_id: r.taskId,
            _point_id: r.pointId,
            _source: 'field-sql',
          })
        }
      }

      const newProgress = Math.min(1, itemCodes.size / TOTAL_ITEMS)
      const oldProgress = unit.inspection_progress
      if (newProgress > oldProgress) {
        unit.inspection_progress = newProgress
        if (newProgress >= 0.999) unit.inspection_status = 'completed'
        else if (newProgress > 0) unit.inspection_status = 'in_progress'
      }
      if (latest) unit.last_inspection_at = latest
      result.unitProgress[unitName] = unit.inspection_progress
      result.recordCount += newRecords.length
      cpStore.records.push(...newRecords)

      console.log(
        `[fieldSyncFromSql] unit=${unitName} ${(oldProgress * 100).toFixed(0)}% → ${(unit.inspection_progress * 100).toFixed(0)}%, +${newRecords.length} records`,
      )
    }

    // dashboard 重新聚合
    if (cpStore.dashboard) {
      const total = cpStore.units.length
      const completed = cpStore.units.filter((u) => u.inspection_status === 'completed').length
      const inProgress = cpStore.units.filter((u) => u.inspection_status === 'in_progress').length
      const exception = cpStore.units.filter((u) => u.inspection_status === 'exception').length
      cpStore.dashboard = {
        ...cpStore.dashboard,
        total_units: total,
        completed,
        in_progress: inProgress,
        pending: Math.max(0, total - completed - inProgress - exception),
        exception,
        overall_progress: total ? cpStore.units.reduce((s, u) => s + u.inspection_progress, 0) / total : 0,
      }
    }

    console.log(
      `[fieldSyncFromSql] done: ${result.taskCount} 任务 / ${result.pointCount} 点 / ${result.recordCount} records / ${result.matchedUnits} units`,
    )
  } catch (e) {
    console.error('[fieldSyncFromSql] failed (silent):', e)
  }

  return result
}
