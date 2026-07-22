import type { MobileDetectionData, MobileDetectionPoint, MobileTask } from '@/api/mobileDetection'
import type { CorrosionUnit, InspectionItemCode, InspectionRecord } from '@/types/models'

function stableNumber(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) || 1
}

function photoUrl(path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return `/api/photos/file/${encoded}`
}

function photos(paths: string[]) {
  return paths.map((path, index) => ({ name: `现场照片 ${index + 1}`, url: photoUrl(path) }))
}

function nearestUnit(task: MobileTask, point: MobileDetectionPoint, units: CorrosionUnit[]): CorrosionUnit | undefined {
  const textCandidates = units.filter((unit) => {
    const text = `${unit.name} ${unit.address ?? ''}`
    return (task.area && text.includes(task.area))
      || task.buildings.some((building) => building && text.includes(building))
  })
  const candidates = textCandidates.length ? textCandidates : units
  return candidates
    .filter((unit) => Number.isFinite(unit.lng) && Number.isFinite(unit.lat))
    .sort((a, b) => {
      const distanceA = (a.lng! - point.lng) ** 2 + (a.lat! - point.lat) ** 2
      const distanceB = (b.lng! - point.lng) ** 2 + (b.lat! - point.lat) ** 2
      return distanceA - distanceB
    })[0] ?? candidates[0]
}

function baseRecord(
  reportId: string,
  itemCode: InspectionItemCode,
  itemName: string,
  task: MobileTask,
  point: MobileDetectionPoint,
  unit: CorrosionUnit,
  createdAt: string,
): InspectionRecord {
  return {
    id: stableNumber(`${reportId}:${itemCode}`),
    unit_id: unit.id,
    point_id: stableNumber(point.id),
    item_code: itemCode,
    item_name: itemName,
    inspection_date: createdAt,
    status: 'passed',
    result_summary: `${task.name} · ${point.location}`,
    result_data: {
      backend: { reportId, taskId: task.id, pointId: point.id, pointSeq: point.seq },
    },
    bd_coord: '',
    created_at: createdAt,
    updated_at: createdAt,
  }
}

export interface AdaptedMobileDetectionData {
  records: InspectionRecord[]
  unmatchedReports: number
}

/** 将后端三类报告转换为现有前端只读检测记录。 */
export function adaptMobileDetectionData(
  data: MobileDetectionData,
  units: CorrosionUnit[],
): AdaptedMobileDetectionData {
  const tasks = new Map(data.tasks.map((task) => [task.id, task]))
  const points = new Map(data.points.map((point) => [point.id, point]))
  const records: InspectionRecord[] = []
  let unmatchedReports = 0

  data.reports.forEach((report) => {
    const task = tasks.get(report.taskId)
    const point = points.get(report.pointId)
    if (!task || !point) {
      unmatchedReports += 1
      return
    }
    const unit = nearestUnit(task, point, units)
    if (!unit) {
      unmatchedReports += 1
      return
    }

    const soil = report.items.土壤电阻率
    const soilPh = report.items.土壤酸碱值
    if (soil || soilPh) {
      const record = baseRecord(report.id, 'SOIL_RESISTIVITY', '土壤电阻率检测', task, point, unit, report.createdAt)
      if (soil) {
        record.measured_value = soil.电阻率
        record.unit = 'Ω·m'
      }
      const summaryParts = [
        soil ? `土壤电阻率 ${soil.电阻率} Ω·m` : '',
        soilPh ? `pH ${soilPh.酸碱度}` : '',
      ].filter(Boolean)
      record.result_summary = `${point.location}：${summaryParts.join('，')}`
      record.result_data = {
        ...record.result_data,
        method: '手机端实测',
        resistivity: soil?.电阻率 ?? null,
        measured_resistance: soil?.电阻值 ?? null,
        ground_rod_spacing: soil?.地钎距离 ?? null,
        ph: soilPh?.酸碱度 ?? null,
        ph_photo_urls: photos(soilPh?.photos ?? []),
        point_count: 1,
        completed_point_count: 1,
        test_points: [{
          id: stableNumber(point.id), name: point.location, lng: point.lng, lat: point.lat,
          ground_rod_count: null, ground_rod_spacing: soil?.地钎距离 ?? null,
          test_current: null, test_voltage: null, measured_resistance: soil?.电阻值 ?? null,
          geometric_coefficient: null, resistivity: soil?.电阻率 ?? null,
          ph: soilPh?.酸碱度 ?? null,
          note: soilPh ? `土壤酸碱度 pH ${soilPh.酸碱度}` : '',
          photo_urls: photos([...(soil?.photos ?? []), ...(soilPh?.photos ?? [])]),
        }],
      }
      records.push(record)
    }

    const pipeline = report.items.管线探测
    if (pipeline) {
      const record = baseRecord(report.id, 'COATING_DETECT', '管线探测', task, point, unit, report.createdAt)
      record.status = pipeline.破损点 ? 'exception' : 'passed'
      record.measured_value = pipeline.埋深
      record.unit = 'm'
      record.result_summary = `${point.location}：埋深 ${pipeline.埋深} m，${pipeline.破损点 ? '发现破损点' : '未发现破损点'}`
      record.result_data = {
        ...record.result_data,
        method: '手机端管线探测', rtkNo: pipeline.rtkNo,
        damage_count: pipeline.破损点 ? 1 : 0,
        completed_point_count: 1,
        damage_locations: pipeline.破损点 ? [{
          id: stableNumber(point.id), name: `检测点 ${point.seq}`, building: task.buildings.join('、'),
          location_desc: point.location, lng: point.lng, lat: point.lat,
          source_x: null, source_y: null, buried_depth: pipeline.埋深,
          leakage_potential: null, surface: '', severity: '确认破损', note: `RTK：${pipeline.rtkNo}`,
          photo_urls: photos(pipeline.photos),
        }] : [],
      }
      records.push(record)
    }
  })

  return { records, unmatchedReports }
}
