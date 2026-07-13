import type {
  InspectionItemCode,
  InspectionRecord,
  InspectionStatus,
  RecordStatus,
} from '@/types/models'

/**
 * 每个单元、每个检测项只采用一条最新记录，避免重复导入导致进度超过 100%。
 */
export function latestRecordsByItem(records: InspectionRecord[]): Map<InspectionItemCode, InspectionRecord> {
  const latest = new Map<InspectionItemCode, InspectionRecord>()
  for (const record of records) {
    const current = latest.get(record.item_code)
    if (!current || record.updated_at.localeCompare(current.updated_at) > 0) {
      latest.set(record.item_code, record)
    }
  }
  return latest
}

export function computeInspectionProgress(
  records: InspectionRecord[],
  itemCodes: InspectionItemCode[],
): { progress: number; status: InspectionStatus; statuses: Map<InspectionItemCode, RecordStatus> } {
  const allowed = new Set(itemCodes)
  const latest = latestRecordsByItem(records)
  const statuses = new Map<InspectionItemCode, RecordStatus>()
  for (const [code, record] of latest) {
    if (allowed.has(code)) statuses.set(code, record.status)
  }

  // 只有合格才算完成；异常表示仍需处理，不能增加完成进度。
  const completed = [...statuses.values()].filter((status) => status === 'passed').length
  const progress = itemCodes.length ? Math.min(completed / itemCodes.length, 1) : 0

  let status: InspectionStatus = 'pending'
  if ([...statuses.values()].some((value) => value === 'exception')) status = 'exception'
  else if (progress >= 1) status = 'completed'
  else if (progress > 0) status = 'in_progress'

  return { progress, status, statuses }
}
