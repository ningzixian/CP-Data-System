/**
 * 现场检测 → 前端 cp store 数据同步层
 *
 * 目标：让现场检测的填报（src.20270721 后端）能反映到所有模块：
 *   - Dashboard 进度（inspection_progress）
 *   - 智问查询（records 数据集）
 *   - 地图 / 看板 / 管理（records + units）
 *
 * 字段映射（不 1:1，按最接近的语义对接）：
 *   土壤电阻率 → SOIL_RESISTIVITY
 *   管线探测   → COATING_DETECT
 *   馈电实验   → ELECTRIC_CONTINUITY
 *   位置 / 土壤酸碱值 → 无对应，跳过（不污染前端 records）
 *
 * 匹配规则：task.unit（字符串如 "FSKZ755853"）== unit.name（前端腐控单元的 name）
 *
 * 副作用：
 *   - 给 cpStore.records 追加 InspectionRecord
 *   - 更新匹配到的 unit 的 inspection_progress / inspection_status
 *   - 更新 unit 的 last_inspection_at
 *
 * 注意：
 *   - 这个同步**单向**（后端 → 前端），前端不写回
 *   - 失败时静默吞掉，不影响前端其他功能
 */
import type { InspectionRecord, InspectionItemCode, CorrosionUnit, RecordStatus } from '@/types/models'
import { fieldApi, type DetectionReport, type DetectionPoint, type Task, type DataType } from '@/api/fieldApi'

// 后端 dataTypes → 前端 item_code 映射
//  - 后端 DetectionReportItemsSchema 只有 土壤电阻率/酸碱值/管线探测 3 个 item
//  - 位置/馈电实验 后端 schema 没有定义，对应前端不映射
const DATA_TYPE_TO_ITEM_CODE: Partial<Record<DataType, InspectionItemCode>> = {
  土壤电阻率: 'SOIL_RESISTIVITY',
  管线探测: 'COATING_DETECT',
}

// 7 项检测项总数（用于算 progress 分母）
const TOTAL_ITEMS = 7

interface SyncResult {
  taskCount: number
  pointCount: number
  recordCount: number
  matchedUnits: number
  /** 各 unitName 当前的 inspection_progress 变化（如 { FSKZ755853: 0.43 }） */
  unitProgress: Record<string, number>
}

/**
 * 现场检测 reports → 前端 InspectionRecord[]（1 个 report 可拆成 0~3 条 record）
 */
function convertReportsToRecords(
  reports: DetectionReport[],
  point: DetectionPoint,
  task: Task,
): InspectionRecord[] {
  const out: InspectionRecord[] = []
  for (const rep of reports) {
    for (const [itemKey, itemValue] of Object.entries(rep.items)) {
      const code = DATA_TYPE_TO_ITEM_CODE[itemKey as DataType]
      if (!code) continue  // 没对应前端 item_code，跳过（位置/酸碱度等）
      // 数值：从 itemValue 里挑一个像数字的字段
      const measured = pickMeasuredValue(itemValue)
      out.push({
        id: hashStringToInt(`${rep.id}-${itemKey}`),
        unit_id: 0,  // 占位，下面覆盖
        point_id: hashStringToInt(point.id),
        item_code: code,
        item_name: itemKey,
        inspector: undefined,
        inspection_date: rep.createdAt,
        measured_value: measured?.value,
        measured_unit: measured?.unit,
        work_hours: undefined,
        personnel_count: undefined,
        personnel_level: undefined,
        status: 'passed' as RecordStatus,
        created_at: rep.createdAt,
        _unit_name: task.unit,  // 自定义字段，匹配后覆盖 unit_id
        _task_id: task.id,
        _point_id: point.id,
        _source: 'field' as const,
      } as any)
    }
  }
  return out
}

/** 简单 hash：字符串 → 32 位整数（用作前端 id） */
function hashStringToInt(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0
  }
  return Math.abs(h) || 1
}

/** 从 item 对象里挑一个数值字段（电阻率/酸碱度/埋深等） */
function pickMeasuredValue(v: any): { value: number; unit: string } | null {
  if (!v || typeof v !== 'object') return null
  if (typeof v.电阻率 === 'number') return { value: v.电阻率, unit: 'Ω·m' }
  if (typeof v.酸碱度 === 'number') return { value: v.酸碱度, unit: 'pH' }
  if (typeof v.埋深 === 'number') return { value: v.埋深, unit: 'm' }
  if (typeof v.电阻值 === 'number') return { value: v.电阻值, unit: 'Ω' }
  return null
}

/**
 * 主同步函数：把现场检测的数据合进 cpStore
 *  - 给 records 追加 InspectionRecord
 *  - 更新匹配 unit 的 inspection_progress
 *  - 失败静默（不影响其他功能）
 */
export async function syncFieldDataIntoCpStore(cpStore: {
  records: any[]
  units: CorrosionUnit[]
  dashboard: any
  fieldTasks?: any[]
}): Promise<SyncResult> {
  const result: SyncResult = {
    taskCount: 0,
    pointCount: 0,
    recordCount: 0,
    matchedUnits: 0,
    unitProgress: {},
  }

  try {
    console.log('[fieldSync] 开始拉取现场检测数据...')
    const tasks = await fieldApi.listTasks()
    result.taskCount = tasks.length
    // 把 tasks 存到 cpStore.fieldTasks（智问"现场检测任务查询"用）
    if (cpStore.fieldTasks) {
      cpStore.fieldTasks.length = 0
      cpStore.fieldTasks.push(...tasks)
    }
    console.log(`[fieldSync] 拿到 ${tasks.length} 个任务`)

    // 按 task.unit 收集所有 reports，便于按 unit 聚合
    const reportsByUnit = new Map<string, { reports: DetectionReport[]; point: DetectionPoint; task: Task }[]>()

    for (const task of tasks) {
      // 跳过没关联到前端 unit 的 task（unit 是空或没匹配到）
      if (!task.unit) continue

      try {
        const points = await fieldApi.listPoints(task.id)
        result.pointCount += points.length
        for (const point of points) {
          const reports = await fieldApi.listReports(task.id, point.id)
          if (reports.length === 0) continue

          // 转换 reports 为 records
          const newRecords = convertReportsToRecords(reports, point, task)
          result.recordCount += newRecords.length

          // 暂存（unit_id 后面匹配时填）
          if (!reportsByUnit.has(task.unit)) reportsByUnit.set(task.unit, [])
          reportsByUnit.get(task.unit)!.push({ reports, point, task })
        }
      } catch (e) {
        console.warn(`[fieldSync] task=${task.id} 拉点位/填报失败:`, e)
      }
    }

    // 给每个匹配的 unit 更新数据
    for (const [unitName, items] of reportsByUnit.entries()) {
      const unit = cpStore.units.find((u) => u.name === unitName)
      if (!unit) {
        console.log(`[fieldSync] 跳过 unit=${unitName}（前端无匹配）`)
        continue
      }

      result.matchedUnits++

      // 收集该 unit 下所有 reports 涉及的 item_code（去重）
      const itemCodes = new Set<InspectionItemCode>()
      let latestReportTime: string | undefined
      for (const { reports } of items) {
        for (const r of reports) {
          if (r.createdAt && (!latestReportTime || r.createdAt > latestReportTime)) {
            latestReportTime = r.createdAt
          }
          for (const k of Object.keys(r.items)) {
            const code = DATA_TYPE_TO_ITEM_CODE[k as DataType]
            if (code) itemCodes.add(code)
          }
        }
      }

      // 算 progress：完成的 item 数 / 总数
      const newProgress = Math.min(1, itemCodes.size / TOTAL_ITEMS)
      const oldProgress = unit.inspection_progress
      // 取较大值（不去掉之前的）
      if (newProgress > oldProgress) {
        unit.inspection_progress = newProgress
        if (newProgress >= 0.999) unit.inspection_status = 'completed'
        else if (newProgress > 0) unit.inspection_status = 'in_progress'
      }
      if (latestReportTime) {
        unit.last_inspection_at = latestReportTime
      }
      result.unitProgress[unitName] = unit.inspection_progress
      console.log(
        `[fieldSync] unit=${unitName} 进度: ${(oldProgress * 100).toFixed(0)}% → ${(unit.inspection_progress * 100).toFixed(0)}%`,
      )

      // 追加 records
      const newRecords = items.flatMap(({ reports, point, task }) =>
        convertReportsToRecords(reports, point, task).map((r: any) => ({
          ...r,
          unit_id: unit.id,  // 补上 unit_id
        })),
      )
      cpStore.records.push(...newRecords)
    }

    // 重新算 dashboard（如果已加载）
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
      `[fieldSync] 完成: ${result.taskCount} 任务 / ${result.pointCount} 点位 / ${result.recordCount} 记录 / ${result.matchedUnits} 单元已更新`,
    )
  } catch (e) {
    console.error('[fieldSync] 同步失败（不影响前端其他功能）:', e)
  }

  return result
}
