/**
 * 7 项现场检测的静态定义
 * 价格数据来自讯腾报价.xlsx，编码与后端 InspectionRecord.ITEM_CODES 保持一致
 */
import type { InspectionItemDef, InspectionItemCode } from '@/types/models'

export const INSPECTION_ITEMS: InspectionItemDef[] = [
  {
    code: 'JOINT_VERIFY',
    name: '① 绝缘接头位置和绝缘性能复核',
    pricePerKm: 12500,
    fields: [
      { key: 'joint_count', label: '接头数量' },
      { key: 'insulation_resistance', label: '绝缘电阻(MΩ)' },
      { key: 'unit_count', label: '核实腐控单元数' },
    ],
  },
  {
    code: 'SOIL_RESISTIVITY',
    name: '② 土壤电阻率检测',
    pricePerKm: 1350,
    fields: [
      { key: 'resistivity', label: '土壤电阻率(Ω·m)' },
      { key: 'method', label: '检测方法' },
      { key: 'depth', label: '测试深度(m)' },
    ],
  },
  {
    code: 'DC_STRAY_CURRENT',
    name: '③ 直流杂散电流检测',
    pricePerKm: 1700,
    fields: [
      { key: 'current_density', label: '电流密度(μA/cm²)' },
      { key: 'potential_shift', label: '电位偏移(mV)' },
    ],
  },
  {
    code: 'COATING_DETECT',
    name: '④ 防腐层非开挖检测',
    pricePerKm: 750,
    fields: [
      { key: 'coating_resistivity', label: '面电阻率(Ω·m²)' },
      { key: 'buried_depth', label: '管道埋深(m)' },
      { key: 'damage_count', label: '破损点数' },
      { key: 'damage_locations', label: '破损点位置(JSON)' },
    ],
  },
  {
    code: 'PIPE_GROUND_POTENTIAL',
    name: '⑤ 管地腐蚀电位检测',
    pricePerKm: 3000,
    fields: [
      { key: 'on_potential', label: '通电电位(V)' },
      { key: 'off_potential', label: '断电电位(V)' },
      { key: 'natural_potential', label: '自然电位(V)' },
    ],
  },
  {
    code: 'ELECTRIC_CONTINUITY',
    name: '⑥ 管道电联通性检测',
    pricePerKm: 4500,
    fields: [
      { key: 'is_connected', label: '是否搭接' },
      { key: 'applied_current', label: '施加电流(A)' },
      { key: 'potential_change', label: '电位变化(mV)' },
    ],
  },
  {
    code: 'INLET_PARAM',
    name: '⑦ 引入口参数测量',
    pricePerKm: 350,
    fields: [
      { key: 'diameter', label: '管径(mm)' },
      { key: 'out_of_roundness', label: '不圆度(%)' },
      { key: 'wall_thickness', label: '剩余壁厚(mm)' },
    ],
  },
]

export const ITEM_BY_CODE: Record<InspectionItemCode, InspectionItemDef> = INSPECTION_ITEMS.reduce(
  (acc, it) => ({ ...acc, [it.code]: it }),
  {} as any,
)

export const STATUS_LABELS: Record<string, string> = {
  pending: '待开始',
  in_progress: '进行中',
  passed: '已完成',
  exception: '异常',
  completed: '已完成',
}

export const STATUS_SHORT: Record<string, string> = {
  pending: '○',
  in_progress: '…',
  passed: '✓',
  exception: '✗',
  completed: '✓',
}

export const STATUS_COLORS: Record<string, string> = {
  pending: '#909399',
  in_progress: '#e6a23c',
  passed: '#67c23a',
  exception: '#f56c6c',
  completed: '#67c23a',
}
