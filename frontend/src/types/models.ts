/**
 * 燃气管道阴极保护数据管理系统 — 数据模型
 *
 * 这些类型既用于前端 TypeScript，也作为后端 API 的契约。
 * 字段命名、类型、可空性请与后端保持一致。
 */

// ============== 检测项定义 ==============

/** 9 项检测项编码（对应报价文件 R3-R11） */
export type InspectionItemCode =
  | 'PLAN_OUTLINE'              // ① 编制方案大纲
  | 'JOINT_VERIFY'              // ② 绝缘接头位置和绝缘性能复核
  | 'SOIL_RESISTIVITY'          // ③ 土壤电阻率检测
  | 'DC_STRAY_CURRENT'          // ④ 直流杂散电流检测
  | 'COATING_DETECT'            // ⑤ 管道防腐层非开挖检测
  | 'PIPE_GROUND_POTENTIAL'     // ⑥ 管地腐蚀电位检测
  | 'ELECTRIC_CONTINUITY'       // ⑦ 管道电联通性检测
  | 'INLET_PARAM'               // ⑧ 引入口参数测量
  | 'DATA_ENTRY'                // ⑨ 检测数据填报

export interface InspectionItemField {
  key: string
  label: string
}

export interface InspectionItemDef {
  code: InspectionItemCode
  name: string
  /** 推荐价格 元/km（来自报价文件，仅展示用） */
  pricePerKm: number
  fields: InspectionItemField[]
}

// ============== 检测状态 ==============
export type InspectionStatus = 'pending' | 'in_progress' | 'passed' | 'exception' | 'completed'
export type RecordStatus = 'pending' | 'passed' | 'exception'

// ============== 核心实体 ==============

/** 管道（一条管线 = 一个工程项目） */
export interface Pipeline {
  id: number
  name: string
  code?: string
  start_point?: string
  end_point?: string
  length_km?: number
  diameter_mm?: number
  install_year?: number
  description?: string
  created_at: string
}

export interface PipelineInput {
  name: string
  code?: string
  start_point?: string
  end_point?: string
  length_km?: number
  diameter_mm?: number
  install_year?: number
  description?: string
}

/** 腐蚀控制单元（地图上要展示的核心实体） */
export interface CorrosionUnit {
  id: number
  pipeline_id: number
  name: string
  start_mileage?: number          // 起点里程(米)
  end_mileage?: number            // 终点里程(米)
  lng?: number                    // 中心点经度（GCJ-02 / WGS-84 看后端约定）
  lat?: number                    // 中心点纬度
  address?: string
  /** 管道走向轨迹（GCJ-02），用于在地图上画出该腐控单元的燃气管线 */
  polyline?: Array<[number, number]>
  inspection_progress: number     // 9 项检测整体进度 0-1
  inspection_status: InspectionStatus
  last_inspection_at?: string     // ISO datetime
  note?: string
  created_at: string
}

export interface CorrosionUnitInput {
  pipeline_id: number
  name: string
  start_mileage?: number
  end_mileage?: number
  lng?: number
  lat?: number
  address?: string
  note?: string
}

/** 检测点（现场具体测量位置） */
export interface InspectionPoint {
  id: number
  unit_id: number
  point_type: string
  lng: number
  lat: number
  mileage?: number
  bd_coord?: string              // 北斗坐标（原始字符串，如 "E118.8400 N31.9520"）
  location_desc?: string
  created_at: string
}

export interface InspectionPointInput {
  unit_id: number
  point_type: string
  lng: number
  lat: number
  mileage?: number
  bd_coord?: string
  location_desc?: string
}

/** 检测记录（关联 9 类检测项的实测数据） */
export interface InspectionRecord {
  id: number
  unit_id: number
  point_id?: number
  item_code: InspectionItemCode
  item_name?: string
  work_hours?: number
  personnel_count?: number
  personnel_level?: '初级' | '中级' | '高级' | '专家'
  inspector?: string
  inspection_date?: string
  status: RecordStatus
  result_summary?: string
  result_data?: Record<string, any>
  measured_value?: number
  unit?: string
  bd_coord?: string
  note?: string
  created_at: string
  updated_at: string
}

export interface InspectionRecordInput {
  unit_id: number
  point_id?: number
  item_code: InspectionItemCode
  work_hours?: number
  personnel_count?: number
  personnel_level?: string
  inspector?: string
  inspection_date?: string
  status?: RecordStatus
  result_summary?: string
  result_data?: Record<string, any>
  measured_value?: number
  unit?: string
  bd_coord?: string
  note?: string
}

// ============== 仪表盘 ==============

export interface DashboardUnitItem {
  code: InspectionItemCode
  name: string
  status: RecordStatus
}

export interface DashboardUnitRow {
  unit_id: number
  unit_name: string
  lng?: number
  lat?: number
  progress: number
  status: InspectionStatus
  items: DashboardUnitItem[]
}

export interface DashboardData {
  total_units: number
  completed: number
  in_progress: number
  pending: number
  exception: number
  rows: DashboardUnitRow[]
  items: { code: InspectionItemCode; name: string }[]
}

// ============== 通用响应包装（可选） ==============
export interface ApiError {
  code: string
  message: string
  detail?: string
}