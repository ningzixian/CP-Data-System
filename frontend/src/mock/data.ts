/**
 * Mock 数据 — 与讯腾报价的 9 项检测对应
 * 后端真实接口实现后，把 .env 的 VITE_USE_MOCK 改为 false 即可切换
 */
import { INSPECTION_ITEMS } from '@/types/items'
import type {
  Pipeline, CorrosionUnit, InspectionPoint, InspectionRecord,
  DashboardData, InspectionItemCode, RecordStatus,
} from '@/types/models'

// ============== 静态数据 ==============
const now = () => new Date().toISOString()
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString()
const hoursAgo = (n: number) => new Date(Date.now() - n * 3600000).toISOString()

export const MOCK_PIPELINES: Pipeline[] = [
  {
    id: 1,
    name: '北京港华燃气-南海家园七里',
    code: 'BJ-YZ-NHJY-001',
    start_point: '南海家园七里西门外阀室',
    end_point: '南海家园七里东门调压站',
    length_km: 1.2,
    diameter_mm: 300,
    install_year: 2012,
    description: '北京大兴区亦庄经济开发区南海家园七里小区燃气管网，覆盖 1-31 号楼共 30 栋楼',
    created_at: daysAgo(60),
  },
]

export const MOCK_UNITS: CorrosionUnit[] = [
  // ====== 主项目：南海家园七里 ======
  {
    id: 10, pipeline_id: 1, name: 'NHJY-QL-01',
    start_mileage: 0, end_mileage: 600,
    lng: 116.493, lat: 39.757, address: '南海家园七里 5-11 号楼（西部组团）',
    polyline: [
      [39.7560, 116.4918],  // 西北角入口
      [39.7560, 116.4930],
      [39.7578, 116.4930],
      [39.7578, 116.4945],  // 沿东侧
      [39.7568, 116.4945],
    ],
    inspection_progress: 0.89, inspection_status: 'in_progress',
    last_inspection_at: hoursAgo(3),
    created_at: daysAgo(20),
    note: '西部组团，含西门外阀室与 5 号楼调压站，主线管 DN300',
  },
  {
    id: 11, pipeline_id: 1, name: 'NHJY-QL-02',
    start_mileage: 600, end_mileage: 1200,
    lng: 116.495, lat: 39.757, address: '南海家园七里 12-23 号楼（中部组团）',
    polyline: [
      [39.7568, 116.4945],  // 接 QL-01 终点
      [39.7568, 116.4955],
      [39.7578, 116.4955],
      [39.7578, 116.4962],
    ],
    inspection_progress: 0, inspection_status: 'pending',
    created_at: daysAgo(20),
    note: '中部组团，含 19 号楼南侧便利店区域',
  },
]

export const MOCK_POINTS: InspectionPoint[] = [
  // ===== 南海家园七里 — NHJY-QL-01 检测点（沿管道线布置）=====
  // 4 个绝缘接头（红叉），把腐控单元边界和内部隔开
  { id: 100, unit_id: 10, point_type: '绝缘接头', lng: 116.4830, lat: 39.7635, mileage: 50,  bd_coord: 'E116.4830 N39.7635', location_desc: '西门外阀室下游 50m（单元上游边界）', created_at: daysAgo(7) },
  { id: 101, unit_id: 10, point_type: '绝缘接头', lng: 116.4855, lat: 39.7628, mileage: 320, bd_coord: 'E116.4855 N39.7628', location_desc: '9-10 号楼之间（中段接头）', created_at: daysAgo(7) },
  { id: 105, unit_id: 10, point_type: '绝缘接头', lng: 116.4865, lat: 39.7633, mileage: 480, bd_coord: 'E116.4865 N39.7633', location_desc: '11 号楼前（中段接头）', created_at: daysAgo(2) },
  { id: 106, unit_id: 10, point_type: '绝缘接头', lng: 116.4870, lat: 39.7638, mileage: 600, bd_coord: 'E116.4870 N39.7638', location_desc: '5 号楼前调压站（单元下游边界）', created_at: daysAgo(2) },
  // 检测数据采样点
  { id: 102, unit_id: 10, point_type: '土壤电阻率', lng: 116.4855, lat: 39.7633, mileage: 360, bd_coord: 'E116.4855 N39.7633', location_desc: '10 号楼南侧绿化带', created_at: daysAgo(5) },
  { id: 103, unit_id: 10, point_type: '防腐层检测', lng: 116.4845, lat: 39.7628, mileage: 280, bd_coord: 'E116.4845 N39.7628', location_desc: '8 号楼与 9 号楼之间（发现 2 处破损）', created_at: hoursAgo(2) },
  { id: 104, unit_id: 10, point_type: '管地电位', lng: 116.4870, lat: 39.7638, mileage: 580, bd_coord: 'E116.4870 N39.7638', location_desc: '5 号楼前引入口', created_at: hoursAgo(6) },
]

const ITEM_CODES: InspectionItemCode[] = INSPECTION_ITEMS.map((i) => i.code)

/**
 * 为南海家园七里第一个控制单元（FSKZ755906）构造 9 项检测演示数据：
 *  - 7 项已合格
 *  - 1 项进行中
 *  - 1 项异常（防腐层破损 — 这是真实项目里最常见的现场情况）
 * 进度：7 + 1（异常也算）= 8/9 ≈ 0.89，状态 in_progress
 *
 * 注：unit_id=1 对应 facilities.ts 里解析的第一个真实低压制单元。
 */
const nhjyRecords: InspectionRecord[] = [
  {
    id: 1001, unit_id: 1, point_id: null, item_code: 'PLAN_OUTLINE',
    item_name: INSPECTION_ITEMS.find((i) => i.code === 'PLAN_OUTLINE')!.name,
    work_hours: 0.25, personnel_count: 1, personnel_level: '高级',
    inspector: '王工（高级工程师）',
    inspection_date: daysAgo(15),
    status: 'passed',
    result_summary: '《南海家园七里绝缘改造方案大纲 v1.0》已编制完成，包含 9 项检测实施计划',
    result_data: { plan_version: 'v1.0', deadline: '2026-07-15' },
    created_at: daysAgo(15), updated_at: daysAgo(15),
  },
  {
    id: 1002, unit_id: 1, point_id: null, item_code: 'JOINT_VERIFY',
    item_name: INSPECTION_ITEMS.find((i) => i.code === 'JOINT_VERIFY')!.name,
    work_hours: 1.0, personnel_count: 2, personnel_level: '中级',
    inspector: '李工、张工',
    inspection_date: daysAgo(7),
    status: 'passed',
    result_summary: '单元内 8 处绝缘接头复核：绝缘电阻 2.5~3.0MΩ，绝缘性能良好',
    result_data: { joint_count: 8, insulation_resistance: 2.8, unit_count: 1 },
    measured_value: 2.8, unit: 'MΩ',
    note: '核实本单元 8 处绝缘接头均位于小区内部',
    created_at: daysAgo(7), updated_at: daysAgo(7),
  },
  {
    id: 1003, unit_id: 1, point_id: null, item_code: 'SOIL_RESISTIVITY',
    item_name: INSPECTION_ITEMS.find((i) => i.code === 'SOIL_RESISTIVITY')!.name,
    work_hours: 0.3, personnel_count: 2, personnel_level: '中级',
    inspector: '李工、张工',
    inspection_date: daysAgo(5),
    status: 'passed',
    result_summary: '土壤电阻率 92.5 Ω·m，属于中等腐蚀性土壤',
    result_data: { resistivity: 92.5, method: '四极法', depth: 1.0 },
    measured_value: 92.5, unit: 'Ω·m',
    created_at: daysAgo(5), updated_at: daysAgo(5),
  },
  {
    id: 1004, unit_id: 1, point_id: null, item_code: 'DC_STRAY_CURRENT',
    item_name: INSPECTION_ITEMS.find((i) => i.code === 'DC_STRAY_CURRENT')!.name,
    work_hours: 0.3, personnel_count: 2, personnel_level: '高级',
    inspector: '王工、刘工',
    inspection_date: daysAgo(4),
    status: 'passed',
    result_summary: '直流杂散电流密度 0.8 μA/cm²，电位偏移 12mV，影响轻微',
    result_data: { current_density: 0.8, potential_shift: 12 },
    measured_value: 0.8, unit: 'μA/cm²',
    created_at: daysAgo(4), updated_at: daysAgo(4),
  },
  {
    id: 1005, unit_id: 1, point_id: null, item_code: 'COATING_DETECT',
    item_name: INSPECTION_ITEMS.find((i) => i.code === 'COATING_DETECT')!.name,
    work_hours: 0.5, personnel_count: 2, personnel_level: '高级',
    inspector: '王工、赵工',
    inspection_date: hoursAgo(2),
    status: 'exception',
    result_summary: '8 号楼与 9 号楼之间发现 2 处防腐层破损点，疑为前期市政施工破坏',
    result_data: {
      coating_resistivity: 850, buried_depth: 1.5, damage_count: 2,
      damage_locations: 'K0+320, K0+480',
    },
    measured_value: 850, unit: 'Ω·m²',
    note: '⚠️ 需要安排开挖修复，建议本周内处理',
    created_at: hoursAgo(2), updated_at: hoursAgo(2),
  },
  {
    id: 1006, unit_id: 1, point_id: null, item_code: 'PIPE_GROUND_POTENTIAL',
    item_name: INSPECTION_ITEMS.find((i) => i.code === 'PIPE_GROUND_POTENTIAL')!.name,
    work_hours: 0.45, personnel_count: 2, personnel_level: '高级',
    inspector: '王工、赵工',
    inspection_date: hoursAgo(6),
    status: 'passed',
    result_summary: '5 号楼前引入口管地电位：通电 -1.05V，断电 -0.78V，自然 -0.55V，符合保护准则',
    result_data: { on_potential: -1.05, off_potential: -0.78, natural_potential: -0.55 },
    measured_value: -0.78, unit: 'V (断电电位)',
    created_at: hoursAgo(6), updated_at: hoursAgo(6),
  },
  {
    id: 1007, unit_id: 1, point_id: null, item_code: 'ELECTRIC_CONTINUITY',
    item_name: INSPECTION_ITEMS.find((i) => i.code === 'ELECTRIC_CONTINUITY')!.name,
    work_hours: 1.0, personnel_count: 2, personnel_level: '中级',
    inspector: '李工、刘工',
    inspection_date: hoursAgo(8),
    status: 'passed',
    result_summary: '与周边接地体无搭接，管道电联通性独立',
    result_data: { is_connected: '否（独立）', applied_current: 2.5, potential_change: 0 },
    measured_value: 0, unit: 'mV (无变化)',
    created_at: hoursAgo(8), updated_at: hoursAgo(8),
  },
  {
    id: 1008, unit_id: 1, point_id: null, item_code: 'INLET_PARAM',
    item_name: INSPECTION_ITEMS.find((i) => i.code === 'INLET_PARAM')!.name,
    work_hours: 0.5, personnel_count: 2, personnel_level: '中级',
    inspector: '李工、张工',
    inspection_date: hoursAgo(12),
    status: 'in_progress',
    result_summary: '已测 1 个引入口：DN300、壁厚 9.8mm，不圆度 0.3%；计划继续测剩余引入口',
    result_data: { diameter: 300, out_of_roundness: 0.3, wall_thickness: 9.8 },
    measured_value: 9.8, unit: 'mm',
    note: '本单元多个引入口，本周内完成',
    created_at: hoursAgo(12), updated_at: hoursAgo(12),
  },
]

/**
 * 给不同 unit_id 构造不同状态的演示 records，便于对比视觉差异：
 *   id=1 (FSKZ755906): 8/9 = 89% in_progress（含 1 项异常 + 1 项进行中）
 *   id=2 (FSKZ755914): 9/9 = 100% completed
 *   id=3 (FSKZ755912): 4 passed + 1 exception = 5/9 = 56% exception
 *   id=4 (FSKZ755911): 3 passed = 3/9 = 33% in_progress
 *   id=5 (FSKZ755910): 1 exception = 1/9 = 11% in_progress
 *   id=6+: 0/9 pending（无 records）
 */
const ITEM_CODES_LIST: InspectionItemCode[] = INSPECTION_ITEMS.map((i) => i.code)

function makeDemoRecords(unitId: number, idBase: number, statuses: RecordStatus[]): InspectionRecord[] {
  return ITEM_CODES_LIST.map((code, idx) => {
    const item = INSPECTION_ITEMS.find((i) => i.code === code)!
    const status: RecordStatus = statuses[idx] ?? 'pending'
    const isDone = status === 'passed' || status === 'exception'
    return {
      id: idBase + idx,
      unit_id: unitId,
      point_id: null,
      item_code: code,
      item_name: item.name,
      work_hours: 0.25,
      personnel_count: 2,
      personnel_level: '中级' as const,
      inspector: '演示人员',
      inspection_date: daysAgo(7 - idx),
      status,
      result_summary: status === 'exception' ? '检测发现异常' : (isDone ? '检测合格' : ''),
      result_data: {},
      measured_value: null,
      unit: item.pricePerKm ? undefined : undefined,
      created_at: daysAgo(7 - idx),
      updated_at: daysAgo(7 - idx),
    } as InspectionRecord
  }).filter((r) => r.status !== 'pending')  // pending 不写入 mock，节省空间
}

const demoRecords: InspectionRecord[] = [
  // id=2: 全 9 项 passed = 100% completed
  ...makeDemoRecords(2, 2000, ['passed','passed','passed','passed','passed','passed','passed','passed','passed']),
  // id=3: 4 passed + 1 exception = 5/9 = 56% exception
  ...makeDemoRecords(3, 3000, ['passed','passed','passed','passed','exception','pending','pending','pending','pending']),
  // id=4 (FSKZ755902): 8 passed + 1 pending = 8/9 ≈ 89% in_progress
  // （临时调高进度，用于测试进度条 > 80% 橙色效果）
  ...makeDemoRecords(4, 4000, ['passed','passed','passed','passed','passed','passed','passed','passed','pending']),
  // id=5: 1 exception = 1/9 = 11% in_progress
  ...makeDemoRecords(5, 5000, ['exception','pending','pending','pending','pending','pending','pending','pending','pending']),
]

export const MOCK_RECORDS: InspectionRecord[] = [
  ...nhjyRecords,
  ...demoRecords,
]

// 内存里可写的副本（mock 模式下，新建的记录会追加到这份数据上）
export const mockStore = {
  pipelines: [...MOCK_PIPELINES],
  units: [...MOCK_UNITS],
  points: [...MOCK_POINTS],
  records: [...MOCK_RECORDS],
  nextId: 1000,
}

mockStore.nextId = Math.max(...mockStore.records.map((r) => r.id), ...mockStore.units.map((u) => u.id)) + 1

// ============== 工具函数 ==============
function computeUnitProgress(unitId: number): { progress: number; status: CorrosionUnit['inspection_status'] } {
  const total = ITEM_CODES.length
  const recs = mockStore.records.filter((r) => r.unit_id === unitId)
  const completed = recs.filter((r) => r.status === 'passed' || r.status === 'exception').length
  const progress = total ? completed / total : 0
  let status: CorrosionUnit['inspection_status'] = 'pending'
  if (progress >= 1) status = 'completed'
  else if (progress > 0) status = 'in_progress'
  return { progress, status }
}

export function buildDashboard(): DashboardData {
  const items = INSPECTION_ITEMS.map((i) => ({ code: i.code, name: i.name }))
  const rows = mockStore.units.map((u) => {
    const recs = mockStore.records.filter((r) => r.unit_id === u.id)
    const recMap = new Map(recs.map((r) => [r.item_code, r.status]))

    // 实时从记录算进度，避免手写进度与实际记录不一致
    const passed = recs.filter((r) => r.status === 'passed').length
    const exception = recs.filter((r) => r.status === 'exception').length
    const completed = passed + exception
    const progress = items.length ? completed / items.length : 0
    let status: 'pending' | 'in_progress' | 'completed' | 'exception' = 'pending'
    if (exception > 0 && completed === items.length) status = 'exception'
    else if (progress >= 1) status = 'completed'
    else if (progress > 0) status = 'in_progress'

    return {
      unit_id: u.id,
      unit_name: u.name,
      lng: u.lng,
      lat: u.lat,
      progress,
      status,
      items: items.map((it) => ({
        code: it.code,
        name: it.name,
        status: (recMap.get(it.code) ?? 'pending') as any,
      })),
    }
  })
  return {
    total_units: mockStore.units.length,
    completed: rows.filter((r) => r.status === 'completed').length,
    in_progress: rows.filter((r) => r.status === 'in_progress').length,
    pending: rows.filter((r) => r.status === 'pending').length,
    exception: rows.filter((r) => r.status === 'exception').length,
    rows,
    items,
  }
}

export { computeUnitProgress }
