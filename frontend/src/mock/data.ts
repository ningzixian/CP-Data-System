/**
 * Mock 数据 — 与 7 项现场检测对应
 * 后端真实接口实现后，把 .env 的 VITE_USE_MOCK 改为 false 即可切换
 */
import { INSPECTION_ITEMS } from '@/types/items'
import { computeInspectionProgress, latestRecordsByItem } from '@/utils/inspection'
import type {
  Pipeline, CorrosionUnit, InspectionPoint, InspectionRecord,
  DashboardData, InspectionItemCode, RecordStatus,
} from '@/types/models'

// ============== 静态数据 ==============
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
 * 为南海家园七里第一个控制单元（FSKZ755906）构造 7 项检测演示数据，
 * 其中防腐层检测异常，其余 6 项合格，因此完成进度为 6/7。
 *
 * 注：unit_id=1 对应 facilities.ts 里解析的第一个真实低压制单元。
 */
const nhjyRecords: InspectionRecord[] = [
  {
    id: 1002, unit_id: 1, item_code: 'JOINT_VERIFY',
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
    id: 1003, unit_id: 1, item_code: 'SOIL_RESISTIVITY',
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
    id: 1004, unit_id: 1, item_code: 'DC_STRAY_CURRENT',
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
    id: 1005, unit_id: 1, item_code: 'COATING_DETECT',
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
    id: 1006, unit_id: 1, item_code: 'PIPE_GROUND_POTENTIAL',
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
    id: 1007, unit_id: 1, item_code: 'ELECTRIC_CONTINUITY',
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
    id: 1008, unit_id: 1, item_code: 'INLET_PARAM',
    item_name: INSPECTION_ITEMS.find((i) => i.code === 'INLET_PARAM')!.name,
    work_hours: 0.5, personnel_count: 2, personnel_level: '中级',
    inspector: '李工、张工',
    inspection_date: hoursAgo(12),
    status: 'passed',
    result_summary: '已测 1 个引入口：DN300、壁厚 9.8mm，不圆度 0.3%；计划继续测剩余引入口',
    result_data: { diameter: 300, out_of_roundness: 0.3, wall_thickness: 9.8 },
    measured_value: 9.8, unit: 'mm',
    note: '本单元多个引入口，本周内完成',
    created_at: hoursAgo(12), updated_at: hoursAgo(12),
  },
]

/**
 * 给不同 unit_id 构造不同状态的演示 records，便于对比视觉差异：
 *   id=1: 6/7，另有 1 项异常
 *   id=2: 7/7 全部合格
 *   id=3: 4 项合格 + 1 项异常
 *   id=4: 6 项合格 + 1 项待开始
 *   id=5: 1 项异常
 *   id=6+: 无记录
 */
const ITEM_CODES_LIST: InspectionItemCode[] = INSPECTION_ITEMS.map((i) => i.code)

function makeDemoRecords(unitId: number, idBase: number, statuses: RecordStatus[]): InspectionRecord[] {
  return ITEM_CODES_LIST.map((code, idx) => {
    const item = INSPECTION_ITEMS.find((i) => i.code === code)!
    const status: RecordStatus = statuses[idx] ?? 'pending'
    const hasResult = status === 'passed' || status === 'exception'
    return {
      id: idBase + idx,
      unit_id: unitId,
      item_code: code,
      item_name: item.name,
      work_hours: 0.25,
      personnel_count: 2,
      personnel_level: '中级' as const,
      inspector: '演示人员',
      inspection_date: daysAgo(7 - idx),
      status,
      result_summary: status === 'exception' ? '检测发现异常' : (hasResult ? '检测合格' : ''),
      result_data: {},
      created_at: daysAgo(7 - idx),
      updated_at: daysAgo(7 - idx),
    }
  }).filter((r) => r.status !== 'pending')  // pending 不写入 mock，节省空间
}

const demoRecords: InspectionRecord[] = [
  ...makeDemoRecords(2, 2000, ['passed','passed','passed','passed','passed','passed','passed']),
  ...makeDemoRecords(3, 3000, ['passed','passed','passed','passed','exception','pending','pending']),
  ...makeDemoRecords(4, 4000, ['passed','passed','passed','passed','passed','passed','pending']),
  ...makeDemoRecords(5, 5000, ['exception','pending','pending','pending','pending','pending','pending']),
]

const allPassedStatuses: RecordStatus[] = ITEM_CODES_LIST.map(() => 'passed')
const sixLiRecords: InspectionRecord[] = Array.from({ length: 10 }, (_, index) => {
  const unitId = 16 + index
  return makeDemoRecords(unitId, 6000 + index * 10, allPassedStatuses)
}).flat()

// 三里 FSKZ755856 土壤电阻率现场演示数据。表针读数约 7 Ω，地钎间距按照片布置估算为 5 m。
const SAN_LI_FSKZ755856_UNIT_ID = 32
const SAN_LI_SOIL_DEMO_POINT_ID = 755856201
const SAN_LI_SOIL_DEMO_POINT_LNG = 116.49750
const SAN_LI_SOIL_DEMO_POINT_LAT = 39.76330
const sanLiSoilResistivityRecord: InspectionRecord = {
  id: 7558,
  unit_id: SAN_LI_FSKZ755856_UNIT_ID,
  item_code: 'SOIL_RESISTIVITY',
  item_name: INSPECTION_ITEMS.find((item) => item.code === 'SOIL_RESISTIVITY')!.name,
  work_hours: 0.5,
  personnel_count: 2,
  personnel_level: '中级',
  inspector: '现场检测人员',
  inspection_date: '2026-07-03T11:00:28.000+08:00',
  status: 'passed',
  result_summary: '四极法演示测试：仪表读数约 7 Ω，估算土壤电阻率 219.911 Ω·m',
  result_data: {
    method: '四极法（Wenner）',
    point_count: 1,
    completed_point_count: 1,
    resistivity: 219.911,
    test_points: [{
      id: SAN_LI_SOIL_DEMO_POINT_ID,
      name: '三里土壤电阻率测试点 1',
      lng: SAN_LI_SOIL_DEMO_POINT_LNG,
      lat: SAN_LI_SOIL_DEMO_POINT_LAT,
      ground_rod_count: 4,
      ground_rod_spacing: 5,
      test_current: null,
      test_voltage: null,
      measured_resistance: 7,
      geometric_coefficient: 31.4159,
      resistivity: 219.911,
      note: '根据现场照片生成的演示数据：仪表量程 ×1，表针读数约 7 Ω；地钎间距按 5 m 估算。',
      photo_urls: [
        { name: '接地电阻仪表读数.jpg', url: '/data/demo/soil/FSKZ755856-meter.jpg' },
        { name: '四极法地钎现场布置.jpg', url: '/data/demo/soil/FSKZ755856-layout.jpg' },
      ],
    }],
  },
  measured_value: 219.911,
  unit: 'Ω·m',
  note: '演示数据由现场照片识别与估算生成，正式成果应以原始检测记录为准。',
  created_at: '2026-07-03T11:00:28.000+08:00',
  updated_at: '2026-07-03T11:00:28.000+08:00',
}

const sanLiDcStrayCurrentRecord: InspectionRecord = {
  id: 7559,
  unit_id: SAN_LI_FSKZ755856_UNIT_ID,
  item_code: 'DC_STRAY_CURRENT',
  item_name: INSPECTION_ITEMS.find((item) => item.code === 'DC_STRAY_CURRENT')!.name,
  work_hours: 0.5,
  personnel_count: 2,
  personnel_level: '中级',
  inspector: '现场检测人员',
  inspection_date: '2026-07-16T09:34:00.000+08:00',
  status: 'passed',
  result_summary: '两处监测点共记录 5 个管地直流电位样本，总体范围 -0.6879～-0.5061 V',
  result_data: {
    method: '管地直流电位法',
    point_count: 2,
    completed_point_count: 2,
    sample_count: 5,
    average_potential: -0.6144,
    potential_shift: 181.8,
    monitoring_points: [
      {
        id: 755856301,
        name: '直流电位监测点 1',
        lng: 116.49750,
        lat: 39.76330,
        potential_readings: [-0.6856, -0.6879, -0.6856],
        min_potential: -0.6879,
        max_potential: -0.6856,
        average_potential: -0.6864,
        potential_fluctuation: 2.3,
        reference_electrode: 'Cu/CuSO₄',
        note: '根据仪表照片识别的 VDC 读数。',
        photo_urls: [
          { name: '监测点1-读数-0.6856V-1.jpg', url: '/data/demo/dc-stray/FSKZ755856-point1-reading1.jpg' },
          { name: '监测点1-读数-0.6879V.jpg', url: '/data/demo/dc-stray/FSKZ755856-point1-reading2.jpg' },
          { name: '监测点1-读数-0.6856V-2.jpg', url: '/data/demo/dc-stray/FSKZ755856-point1-reading3.jpg' },
        ],
      },
      {
        id: 755856302,
        name: '直流电位监测点 2',
        lng: 116.49772,
        lat: 39.76318,
        potential_readings: [-0.5061, -0.5069],
        min_potential: -0.5069,
        max_potential: -0.5061,
        average_potential: -0.5065,
        potential_fluctuation: 0.8,
        reference_electrode: 'Cu/CuSO₄',
        note: '表笔接触现场测试端子，读数由照片识别。',
        photo_urls: [
          { name: '监测点2-读数-0.5061V.jpg', url: '/data/demo/dc-stray/FSKZ755856-point2-reading1.jpg' },
          { name: '监测点2-读数-0.5069V.jpg', url: '/data/demo/dc-stray/FSKZ755856-point2-reading2.jpg' },
        ],
      },
    ],
  },
  measured_value: -0.6144,
  unit: 'V',
  note: '演示数据根据现场照片识别生成；照片未提供电流密度，未据此生成正式杂散电流结论。',
  created_at: '2026-07-16T09:34:00.000+08:00',
  updated_at: '2026-07-16T09:34:00.000+08:00',
}

// 《南海家园三里小区低压线破损点记录》中的 1、2 号楼破损点。
// 原始 X/Y 作为来源记录保留；地图展示坐标按现场描述校正在对应楼栋的官方低压管线上。
const sanLiCoatingDetectRecord: InspectionRecord = {
  id: 7560,
  unit_id: SAN_LI_FSKZ755856_UNIT_ID,
  item_code: 'COATING_DETECT',
  item_name: INSPECTION_ITEMS.find((item) => item.code === 'COATING_DETECT')!.name,
  work_hours: 0.5,
  personnel_count: 2,
  personnel_level: '中级',
  inspector: '讯腾智科',
  inspection_date: '2025-10-26T09:00:00.000+08:00',
  status: 'exception',
  result_summary: '南海家园三里 1、2 号楼共发现 2 处低压管线防腐层疑似破损点',
  result_data: {
    method: '皮尔逊法',
    device: '皮尔逊 SL-2818',
    pipeline_name: '南海家园三里小区低压线',
    pipeline_length: 3756,
    damage_count: 2,
    completed_point_count: 2,
    damage_locations: [
      {
        id: 755856401,
        name: '68-1',
        building: '1号楼',
        location_desc: '1号楼四单元西北侧路牙北 1.4m',
        lng: 116.49796915,
        lat: 39.76340551,
        source_x: 512088.77,
        source_y: 288472.32,
        buried_depth: 1.1,
        leakage_potential: 450,
        surface: '绿地',
        severity: '疑似破损',
        note: '统计表序号 1；现场标识编号 68-1。',
        photo_urls: [],
      },
      {
        id: 755856402,
        name: '68-2',
        building: '2号楼',
        location_desc: '2号楼二单元北侧路牙下',
        lng: 116.497345312722,
        lat: 39.7636082820188,
        source_x: 511887.95,
        source_y: 288487.35,
        buried_depth: 1.1,
        leakage_potential: 450,
        surface: '沥青',
        severity: '疑似破损',
        note: '统计表序号 2；现场标识编号 68-2。展示位置已校正在2号楼二单元楼前官方低压管线上。',
        photo_urls: [],
      },
    ],
  },
  measured_value: 2,
  unit: '处',
  note: '数据来自 2025 年 10 月 26 日统计表；参考图片未导入，照片由用户在防腐层检测抽屉中自行上传。',
  created_at: '2025-10-26T09:00:00.000+08:00',
  updated_at: '2025-10-26T09:00:00.000+08:00',
}

// 三里 FSKZ755856 管地腐蚀电位演示数据。照片仅用于读取仪表数值，不随代码内置。
// 最左侧引入口 N54R328A067 读数为 -0.6182 VDC，其余引入口由界面按设施数据补为空记录。
const SAN_LI_LEFTMOST_INLET_ID = 426159
const SAN_LI_WEST_SECOND_INLET_ID = 426158
const SAN_LI_WEST_THIRD_INLET_ID = 426157
const sanLiPipeGroundPotentialRecord: InspectionRecord = {
  id: 7561,
  unit_id: SAN_LI_FSKZ755856_UNIT_ID,
  item_code: 'PIPE_GROUND_POTENTIAL',
  item_name: INSPECTION_ITEMS.find((item) => item.code === 'PIPE_GROUND_POTENTIAL')!.name,
  work_hours: 0.25,
  personnel_count: 1,
  personnel_level: '中级',
  inspector: '现场检测人员',
  inspection_date: '2026-01-07T09:48:00.000+08:00',
  status: 'pending',
  result_summary: '已完成 1 个引入口自然电位测试，其余引入口待录入',
  result_data: {
    method: '自然电位法',
    inlet_count: 28,
    completed_inlet_count: 1,
    natural_potential: -0.6182,
    inlets: [{
      inlet_id: SAN_LI_LEFTMOST_INLET_ID,
      inlet_code: 'N54R328A067',
      natural_potential: -0.6182,
      reference_electrode: 'Cu/CuSO₄',
      test_method: '自然电位法',
      note: '6号楼1单元现场仪表读数；照片由用户后续上传。',
    }],
  },
  measured_value: -0.6182,
  unit: 'V',
  note: '读数根据现场照片识别，照片未内置。当前检测尚未覆盖全部引入口，因此状态保持进行中。',
  created_at: '2026-01-07T09:48:00.000+08:00',
  updated_at: '2026-01-07T09:48:00.000+08:00',
}

// 三里 FSKZ755856 管道电联通性演示数据。两处仪表照片分别显示 491.1 kΩ 和 129.5 kΩ。
// 照片不随代码内置，用户可在电联通性抽屉中按测试位置上传并持久化保存。
const sanLiElectricContinuityRecord: InspectionRecord = {
  id: 7562,
  unit_id: SAN_LI_FSKZ755856_UNIT_ID,
  item_code: 'ELECTRIC_CONTINUITY',
  item_name: INSPECTION_ITEMS.find((item) => item.code === 'ELECTRIC_CONTINUITY')!.name,
  work_hours: 0.5,
  personnel_count: 2,
  personnel_level: '中级',
  inspector: '现场检测人员',
  inspection_date: '2026-07-17T09:00:00.000+08:00',
  status: 'passed',
  result_summary: '完成电动车充电桩接地和楼房接地网两处测试，测得电阻 491.1 kΩ、129.5 kΩ，未发现电联通',
  result_data: {
    method: '电阻测量法',
    point_count: 2,
    completed_point_count: 2,
    connected_count: 0,
    is_connected: '未发现电联通',
    average_resistance: 310.3,
    test_points: [
      {
        id: 755856601,
        name: '电动车充电桩接地',
        target_type: '充电设施接地',
        lng: 116.49764,
        lat: 39.76343,
        measured_resistance: 491.1,
        resistance_unit: 'kΩ',
        is_connected: false,
        conclusion: '未联通',
        note: '根据现场仪表照片读取 491.1 kΩ；照片由用户后续上传。',
        photo_urls: [],
      },
      {
        id: 755856602,
        name: '楼房接地网',
        target_type: '建筑接地网',
        lng: 116.49738,
        lat: 39.76356,
        measured_resistance: 129.5,
        resistance_unit: 'kΩ',
        is_connected: false,
        conclusion: '未联通',
        note: '根据现场仪表照片读取 129.5 kΩ；照片由用户后续上传。',
        photo_urls: [],
      },
    ],
  },
  measured_value: 310.3,
  unit: 'kΩ',
  note: '展示结论依据照片中的高阻值生成，正式检测结论应以现场记录和判定标准为准。',
  created_at: '2026-07-17T09:00:00.000+08:00',
  updated_at: '2026-07-17T09:00:00.000+08:00',
}

// 三里 FSKZ755856 西侧前三个引入口的单次外径测量数据。照片不随代码内置。
const sanLiInletParameterRecord: InspectionRecord = {
  id: 7563,
  unit_id: SAN_LI_FSKZ755856_UNIT_ID,
  item_code: 'INLET_PARAM',
  item_name: INSPECTION_ITEMS.find((item) => item.code === 'INLET_PARAM')!.name,
  work_hours: 0.25,
  personnel_count: 1,
  personnel_level: '中级',
  inspector: '现场检测人员',
  inspection_date: '2026-07-17T09:30:00.000+08:00',
  status: 'pending',
  result_summary: '已完成西侧前三个引入口的单次外径测量，代表性平均外径 60.2 mm，其余引入口待录入',
  result_data: {
    method: '数显游标卡尺单点测量法',
    inlet_count: 28,
    completed_inlet_count: 3,
    diameter: 60.2,
    average_diameter: 60.2,
    inlets: [
      {
        inlet_id: SAN_LI_LEFTMOST_INLET_ID,
        inlet_code: 'N54R328A067',
        diameter_readings: [60.0],
        average_diameter: 60.0,
        diameter_difference: 0.3,
        out_of_roundness: 0.5,
        wall_thickness: 3.62,
        instrument: '数显游标卡尺',
        note: '西侧第一个引入口；单次外径读数 60.0 mm。照片由用户后续上传。',
      },
      {
        inlet_id: SAN_LI_WEST_SECOND_INLET_ID,
        inlet_code: 'N54R328A068',
        diameter_readings: [60.4],
        average_diameter: 60.4,
        diameter_difference: 0.4,
        out_of_roundness: 0.662,
        wall_thickness: 3.78,
        instrument: '数显游标卡尺',
        note: '西侧第二个引入口；单次外径读数 60.4 mm。照片由用户后续上传。',
      },
      {
        inlet_id: SAN_LI_WEST_THIRD_INLET_ID,
        inlet_code: 'N54R328A069',
        diameter_readings: [60.2],
        average_diameter: 60.2,
        diameter_difference: 0.3,
        out_of_roundness: 0.498,
        wall_thickness: 3.69,
        instrument: '数显游标卡尺',
        note: '西侧第三个引入口；单次外径读数按演示值 60.2 mm 记录。照片由用户后续上传。',
      },
    ],
  },
  measured_value: 60.2,
  unit: 'mm',
  note: '当前完成西侧前三个引入口，未覆盖全部引入口，因此状态保持进行中。',
  created_at: '2026-07-17T09:30:00.000+08:00',
  updated_at: '2026-07-17T09:30:00.000+08:00',
}

export const MOCK_RECORDS: InspectionRecord[] = [
  ...nhjyRecords,
  ...demoRecords,
  ...sixLiRecords,
  sanLiSoilResistivityRecord,
  sanLiDcStrayCurrentRecord,
  sanLiCoatingDetectRecord,
  sanLiPipeGroundPotentialRecord,
  sanLiElectricContinuityRecord,
  sanLiInletParameterRecord,
]

const MOCK_RECORDS_STORAGE_KEY = 'cp-data-system:mock-records'
const MOCK_RECORDS_STORAGE_VERSION = 2

interface PersistedMockRecords {
  version: number
  records: InspectionRecord[]
}

function recordKey(record: InspectionRecord): string {
  return `${record.unit_id}:${record.item_code}`
}

function migrateSanLiSoilDemoRecord(record: InspectionRecord): InspectionRecord {
  if (record.id !== sanLiSoilResistivityRecord.id) return record
  const testPoints = Array.isArray(record.result_data?.test_points)
    ? record.result_data.test_points.map((point: Record<string, unknown>) => Number(point.id) === SAN_LI_SOIL_DEMO_POINT_ID
      ? { ...point, lng: SAN_LI_SOIL_DEMO_POINT_LNG, lat: SAN_LI_SOIL_DEMO_POINT_LAT }
      : point)
    : sanLiSoilResistivityRecord.result_data?.test_points
  return {
    ...record,
    unit_id: SAN_LI_FSKZ755856_UNIT_ID,
    result_data: { ...(record.result_data ?? {}), test_points: testPoints },
  }
}

function migrateSanLiCoatingDemoRecord(record: InspectionRecord): InspectionRecord {
  if (record.unit_id !== SAN_LI_FSKZ755856_UNIT_ID || record.item_code !== 'COATING_DETECT') return record
  const existingPoints = Array.isArray(record.result_data?.damage_locations)
    ? record.result_data.damage_locations as Array<Record<string, unknown>>
    : []
  const baselinePoints = Array.isArray(sanLiCoatingDetectRecord.result_data?.damage_locations)
    ? sanLiCoatingDetectRecord.result_data.damage_locations as Array<Record<string, unknown>>
    : []

  // 早期持久化记录可能已有“2 处破损”的统计和点位数组，但点内没有经纬度。
  // 这类记录会让小方块显示数量，却无法在地图上创建 Marker。
  // 按 id / 名称补齐两处内置演示点；浏览器里已经编辑过的有效坐标继续优先保留。
  const repairedPoints = baselinePoints.map((baseline) => {
    const existing = existingPoints.find((point) =>
      Number(point.id) === Number(baseline.id)
      || String(point.name ?? '') === String(baseline.name ?? ''),
    )
    if (!existing) return baseline
    const existingLng = Number(existing.lng)
    const existingLat = Number(existing.lat)
    const isLegacyPoint2Position = Number(baseline.id) === 755856402
      && Math.abs(existingLng - 116.49563470) < 1e-8
      && Math.abs(existingLat - 39.76355064) < 1e-8
    return {
      ...baseline,
      ...existing,
      lng: Number.isFinite(existingLng) && !isLegacyPoint2Position ? existingLng : baseline.lng,
      lat: Number.isFinite(existingLat) && !isLegacyPoint2Position ? existingLat : baseline.lat,
      note: isLegacyPoint2Position ? baseline.note : (existing.note ?? baseline.note),
    }
  })

  return {
    ...sanLiCoatingDetectRecord,
    ...record,
    unit_id: SAN_LI_FSKZ755856_UNIT_ID,
    status: record.status ?? sanLiCoatingDetectRecord.status,
    result_summary: record.result_summary || sanLiCoatingDetectRecord.result_summary,
    result_data: {
      ...(sanLiCoatingDetectRecord.result_data ?? {}),
      ...(record.result_data ?? {}),
      damage_count: 2,
      completed_point_count: 2,
      damage_locations: repairedPoints,
    },
    measured_value: 2,
    unit: '处',
  }
}

function migrateSanLiPipePotentialRecord(record: InspectionRecord): InspectionRecord {
  if (record.unit_id !== SAN_LI_FSKZ755856_UNIT_ID || record.item_code !== 'PIPE_GROUND_POTENTIAL') return record
  const existingInlets = Array.isArray(record.result_data?.inlets)
    ? record.result_data.inlets as Array<Record<string, unknown>>
    : []
  const baselineReading = (sanLiPipeGroundPotentialRecord.result_data?.inlets as Array<Record<string, unknown>>)[0]
  const existingReading = existingInlets.find((reading) => Number(reading.inlet_id) === SAN_LI_LEFTMOST_INLET_ID)
  const inlets = existingReading
    ? existingInlets
    : [baselineReading, ...existingInlets]
  const completedCount = inlets.filter((reading) => {
    const value = reading.natural_potential
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
  }).length
  return {
    ...sanLiPipeGroundPotentialRecord,
    ...record,
    result_data: {
      ...(sanLiPipeGroundPotentialRecord.result_data ?? {}),
      ...(record.result_data ?? {}),
      inlet_count: Math.max(28, Number(record.result_data?.inlet_count) || 0),
      completed_inlet_count: completedCount,
      inlets,
    },
    measured_value: record.measured_value ?? -0.6182,
    unit: 'V',
  }
}

function migrateSanLiElectricContinuityRecord(record: InspectionRecord): InspectionRecord {
  if (record.unit_id !== SAN_LI_FSKZ755856_UNIT_ID || record.item_code !== 'ELECTRIC_CONTINUITY') return record
  const existingPoints = Array.isArray(record.result_data?.test_points)
    ? record.result_data.test_points as Array<Record<string, unknown>>
    : []
  const baselinePoints = sanLiElectricContinuityRecord.result_data?.test_points as Array<Record<string, unknown>>
  const points = baselinePoints.map((baseline) => {
    const existing = existingPoints.find((point) => Number(point.id) === Number(baseline.id))
    return existing ? { ...baseline, ...existing } : baseline
  })
  existingPoints.forEach((point) => {
    if (!points.some((item) => Number(item.id) === Number(point.id))) points.push(point)
  })
  const completedCount = points.filter((point) => Number.isFinite(Number(point.measured_resistance))).length
  return {
    ...sanLiElectricContinuityRecord,
    ...record,
    result_summary: record.result_summary || sanLiElectricContinuityRecord.result_summary,
    result_data: {
      ...(sanLiElectricContinuityRecord.result_data ?? {}),
      ...(record.result_data ?? {}),
      point_count: points.length,
      completed_point_count: completedCount,
      test_points: points,
    },
    measured_value: record.measured_value ?? 310.3,
    unit: 'kΩ',
  }
}

function migrateSanLiInletParameterRecord(record: InspectionRecord): InspectionRecord {
  if (record.unit_id !== SAN_LI_FSKZ755856_UNIT_ID || record.item_code !== 'INLET_PARAM') return record
  const existingInlets = Array.isArray(record.result_data?.inlets)
    ? record.result_data.inlets as Array<Record<string, unknown>>
    : []
  const baselineReadings = sanLiInletParameterRecord.result_data?.inlets as Array<Record<string, unknown>>
  const targetIds = new Set(baselineReadings.map((reading) => Number(reading.inlet_id)))
  const existingWestReading = existingInlets.find((reading) => Number(reading.inlet_id) === SAN_LI_LEFTMOST_INLET_ID)
  const existingSecondReading = existingInlets.find((reading) => Number(reading.inlet_id) === SAN_LI_WEST_SECOND_INLET_ID)
  const existingThirdReading = existingInlets.find((reading) => Number(reading.inlet_id) === SAN_LI_WEST_THIRD_INLET_ID)
  const legacyWestReadings = existingWestReading?.diameter_readings
  const hasDiameterResult = (reading?: Record<string, unknown>) => reading?.average_diameter !== null
    && reading?.average_diameter !== undefined
    && Number.isFinite(Number(reading.average_diameter))
  const isLegacyThreeReadingsAtFirstInlet = Array.isArray(legacyWestReadings)
    && legacyWestReadings.length === 3
    && !hasDiameterResult(existingSecondReading)
    && !hasDiameterResult(existingThirdReading)
  const mergeBaselineReading = (
    baseline: Record<string, unknown>,
    existing?: Record<string, unknown>,
  ): Record<string, unknown> => {
    if (!existing) return baseline
    const merged = { ...baseline, ...existing }
    const hasWallThickness = existing.wall_thickness !== null
      && existing.wall_thickness !== undefined
      && existing.wall_thickness !== ''
      && Number.isFinite(Number(existing.wall_thickness))
    const hasLegacyRoundnessPlaceholder = Number(existing.diameter_difference) === 0
      && Number(existing.out_of_roundness) === 0
      && Array.isArray(existing.diameter_readings)
      && existing.diameter_readings.length === 1

    if (!hasWallThickness) merged.wall_thickness = baseline.wall_thickness
    if (hasLegacyRoundnessPlaceholder) {
      merged.diameter_difference = baseline.diameter_difference
      merged.out_of_roundness = baseline.out_of_roundness
    }
    return merged
  }
  const inlets = isLegacyThreeReadingsAtFirstInlet
    ? [...baselineReadings, ...existingInlets.filter((reading) => !targetIds.has(Number(reading.inlet_id)))]
    : [
        ...baselineReadings.map((baseline) => {
          const existing = existingInlets.find((reading) => Number(reading.inlet_id) === Number(baseline.inlet_id))
          return mergeBaselineReading(baseline, existing)
        }),
        ...existingInlets.filter((reading) => !targetIds.has(Number(reading.inlet_id))),
      ]
  const completedCount = inlets.filter((reading) => Number.isFinite(Number(reading.average_diameter))).length
  return {
    ...sanLiInletParameterRecord,
    ...record,
    result_data: {
      ...(sanLiInletParameterRecord.result_data ?? {}),
      ...(record.result_data ?? {}),
      inlet_count: Math.max(28, Number(record.result_data?.inlet_count) || 0),
      completed_inlet_count: completedCount,
      method: isLegacyThreeReadingsAtFirstInlet ? '数显游标卡尺单点测量法' : (record.result_data?.method ?? '数显游标卡尺单点测量法'),
      inlets,
    },
    result_summary: isLegacyThreeReadingsAtFirstInlet
      ? sanLiInletParameterRecord.result_summary
      : (record.result_summary || sanLiInletParameterRecord.result_summary),
    note: isLegacyThreeReadingsAtFirstInlet ? sanLiInletParameterRecord.note : record.note,
    measured_value: record.measured_value ?? 60.2,
    unit: 'mm',
  }
}

function loadPersistedRecords(): InspectionRecord[] | null {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(MOCK_RECORDS_STORAGE_KEY)
    if (!value) return null
    const parsed = JSON.parse(value) as InspectionRecord[] | PersistedMockRecords
    const persistedSource = Array.isArray(parsed)
      ? parsed
      : (Array.isArray(parsed.records) ? parsed.records : null)
    if (!persistedSource) return null

    // 早期演示数据曾按 CSV 原始行号误绑到 37（FSKZ755863）。
    // 项目实际会过滤非低压单元，FSKZ755856 的真实运行时 ID 为 32。
    const persisted = persistedSource
      .map(migrateSanLiSoilDemoRecord)
      .map(migrateSanLiCoatingDemoRecord)
      .map(migrateSanLiPipePotentialRecord)
      .map(migrateSanLiElectricContinuityRecord)
      .map(migrateSanLiInletParameterRecord)

    // 合并新增的内置演示数据，同时保留浏览器中已有的编辑结果。
    const persistedByKey = new Map(persisted.map((record) => [recordKey(record), record]))
    const baselineKeys = new Set(MOCK_RECORDS.map(recordKey))
    const migrated = MOCK_RECORDS.map((record) => {
      return record.unit_id >= 16 && record.unit_id <= 25
        ? record
        : (persistedByKey.get(recordKey(record)) ?? record)
    })
    persisted.forEach((record) => {
      if (!baselineKeys.has(recordKey(record))) migrated.push(record)
    })
    window.localStorage.setItem(MOCK_RECORDS_STORAGE_KEY, JSON.stringify({
      version: MOCK_RECORDS_STORAGE_VERSION,
      records: migrated,
    }))
    return migrated.filter((record) => ITEM_CODES.includes(record.item_code))
  } catch {
    return null
  }
}

// 内存里可写的副本（mock 模式下，新建的记录会追加到这份数据上）
export const mockStore = {
  pipelines: [...MOCK_PIPELINES],
  units: [...MOCK_UNITS],
  points: [...MOCK_POINTS],
  records: loadPersistedRecords() ?? [...MOCK_RECORDS],
  nextId: 1000,
}

mockStore.nextId = Math.max(...mockStore.records.map((r) => r.id), ...mockStore.units.map((u) => u.id)) + 1

export function persistMockRecords() {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(MOCK_RECORDS_STORAGE_KEY, JSON.stringify({
    version: MOCK_RECORDS_STORAGE_VERSION,
    records: mockStore.records,
  }))
}

// ============== 工具函数 ==============
function computeUnitProgress(unitId: number): { progress: number; status: CorrosionUnit['inspection_status'] } {
  const recs = mockStore.records.filter((r) => r.unit_id === unitId)
  const { progress, status } = computeInspectionProgress(recs, ITEM_CODES)
  return { progress, status }
}

export function buildDashboard(): DashboardData {
  const items = INSPECTION_ITEMS.map((i) => ({ code: i.code, name: i.name }))
  const rows = mockStore.units.map((u) => {
    const recs = mockStore.records.filter((r) => r.unit_id === u.id)
    const { progress, status } = computeInspectionProgress(recs, ITEM_CODES)
    const recMap = latestRecordsByItem(recs)

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
        status: recMap.get(it.code)?.status ?? 'pending',
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
