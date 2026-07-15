/**
 * 管线勘测 — 数据模型
 *
 * 跟现有 CorrosionUnit / CsvPipe 分离,独立管理。
 * 后续接后端 API 时这个文件就是前后端契约。
 */

/** 点位类型:三通 / 弯头 / 普通点位 / 绝缘接头 / 引入口 */
export type SurveyPointType = 'tee' | 'elbow' | 'straight' | 'joint' | 'inlet'

/** 端点 ID 两种来源:
 *  - 自建点位: 'point:NHJY-SL-001'
 *  - 引入口:  'inlet:<fid>'(用 facilities.ts 加载的引入口)
 *
 *  用前缀区分,渲染时按前缀路由到不同数据源。
 */
export type SurveyEndpointId = `point:${string}` | `inlet:${string}`

/** 点位数据来源:
 *  - 'csv': 从现场打点 CSV 导入(默认)
 *  - 'manual': 用户在地图上手动添加(视觉上用不同颜色区分)
 *  - 两种来源均可在“编辑”模式下拖动调整位置
 */
export type SurveyPointSource = 'csv' | 'manual'

/** 勘测点位 */
export interface SurveyPoint {
  /** 形如 'NHJY-SL-001',小区前缀 + 类型(SL=Survey Line 点位) + 顺序号 */
  id: string
  /** 地图当前使用的有效坐标（由原始位置或移动位置同步得到）。 */
  lng: number
  lat: number
  /** CSV 首次导入的位置，移动点位时永久保留。 */
  originalLng?: number
  originalLat?: number
  /** 用户移动后的覆盖位置；为空时显示原始位置。 */
  movedLng?: number
  movedLat?: number
  type: SurveyPointType
  /** 旋转角度(度),仅 tee/elbow 有意义；其他类型固定 0 */
  rotation: number
  /** 埋深(米) */
  depth?: number
  /** 电流（mA） */
  current?: number
  /** 备注 */
  note?: string
  /** 数据来源,默认 'csv'(向下兼容旧 localStorage 数据) */
  source?: SurveyPointSource
  createdAt: string
}

/** 勘测管线(两点之间手动连接,带箭头指向 to) */
export interface SurveyLine {
  id: string
  fromId: SurveyEndpointId
  toId: SurveyEndpointId
  note?: string
  createdAt: string
}

/** 地图上的矩形差异标识。 */
export interface SurveyBox {
  id: string
  west: number
  south: number
  east: number
  north: number
  /** 用于说明勘测管线与官方管线差异等信息。 */
  note?: string
  createdAt: string
}

/** 端点来源类型(用于 UI 区分渲染) */
export type SurveyEndpointKind = 'point' | 'inlet'

/** 解析端点 ID */
export function parseEndpointId(eid: SurveyEndpointId): { kind: SurveyEndpointKind; rawId: string } {
  const [kind, ...rest] = eid.split(':')
  return { kind: kind as SurveyEndpointKind, rawId: rest.join(':') }
}
