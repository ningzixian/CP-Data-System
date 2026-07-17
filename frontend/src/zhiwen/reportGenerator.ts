/**
 * 报告生成器
 *
 * 支持 6 种报告类型：
 *  - overview   综合概览
 *  - exception  异常检测报告
 *  - topology   物探数据报告
 *  - facility   设施分布报告
 *  - progress   进度分析报告
 *  - inspection 专项检测报告
 *
 * 每份报告 = 多个 section 拼成（A4 排版）：
 *  - summary   文字摘要
 *  - kpi       关键指标卡片
 *  - chart     ECharts 图表
 *  - table     表格
 *  - list      列表
 */

import type { ZhiwenData } from './engine'

export type ReportType = 'overview' | 'exception' | 'topology' | 'facility' | 'progress' | 'inspection'

export interface ReportSection {
  title: string
  type: 'summary' | 'kpi' | 'chart' | 'table' | 'list' | 'text'
  data: any
}

export interface Report {
  type: ReportType
  title: string
  subtitle: string
  generatedAt: string
  community: string  // 全部 / 七里 / 三里 / 六里
  itemCode?: string
  sections: ReportSection[]
  meta: {
    totalPipes: number
    totalRecords: number
    totalFacilities: number
  }
}

export interface ReportOptions {
  community?: string  // '全部' | '南海家园七里' | ...
  itemCode?: string    // 用于专项检测报告
  /** 是否包含物探数据 */
  includeTopology?: boolean
}

// ============== 工具 ==============

function filterByCommunity<T extends { community: string }>(rows: T[], community?: string): T[] {
  if (!community || community === '全部' || community === 'all') return rows
  return rows.filter((r) => r.community === community)
}

function toNumber(v: any): number {
  if (v === null || v === undefined || v === '') return 0
  const n = parseFloat(String(v))
  return isNaN(n) ? 0 : n
}

function groupCount<T>(rows: T[], field: keyof T): Array<{ name: string; value: number }> {
  const m = new Map<string, number>()
  rows.forEach((r) => {
    const k = String((r as any)[field] ?? '(空)')
    m.set(k, (m.get(k) || 0) + 1)
  })
  return Array.from(m.entries()).map(([name, value]) => ({ name, value }))
}

function groupSum<T>(rows: T[], groupField: keyof T, sumField: keyof T): Array<{ name: string; value: number }> {
  const m = new Map<string, number>()
  rows.forEach((r) => {
    const k = String((r as any)[groupField] ?? '(空)')
    m.set(k, (m.get(k) || 0) + toNumber((r as any)[sumField]))
  })
  return Array.from(m.entries())
    .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value)
}

function pad(n: number) { return String(n).padStart(2, '0') }

function nowString() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ============== 各报告类型 ==============

/** 1. 综合概览 */
function buildOverview(d: ZhiwenData, opts: ReportOptions): Report {
  const community = opts.community || '全部'
  const pipes = filterByCommunity(d.pipes, community)
  const regulators = filterByCommunity(d.regulators, community)
  const inlets = filterByCommunity(d.inlets, community)
  const joints = filterByCommunity(d.joints, community)
  const controls = filterByCommunity(d.controls, community)
  const units = filterByCommunity(d.units, community)
  const records = filterByCommunity(d.records, community)

  const totalLength = pipes.reduce((s, p) => s + toNumber(p.length), 0)
  const exceptions = records.filter((r) => r.status === 'exception').length
  const passed = records.filter((r) => r.status === 'passed').length
  const completedUnits = units.filter((u) => u.inspection_status === 'completed').length

  // 各小区管线长度
  const byCommunityPipeLength = groupSum(d.pipes, 'community', 'length')

  // 检测项状态分布
  const exceptionByItem = groupCount(
    records.filter((r) => r.status === 'exception'),
    'item_name',
  )

  return {
    type: 'overview',
    title: '📊 阴极保护数据综合概览报告',
    subtitle: `南海家园小区（${community}）管网与检测数据综合分析`,
    generatedAt: nowString(),
    community,
    sections: [
      {
        title: '一、报告摘要',
        type: 'summary',
        data: `本报告覆盖${community === '全部' ? '南海家园 3 个小区' : community}，包含 **${pipes.length}** 条管线（总长度 **${totalLength.toFixed(1)} m**）、**${regulators.length}** 个调压箱、**${inlets.length}** 个引入口、**${joints.length}** 个绝缘接头。当前 **${records.length}** 条检测记录，异常 **${exceptions}** 条（占 ${records.length ? ((exceptions / records.length) * 100).toFixed(1) : 0}%），通过 **${passed}** 条。腐控单元共 **${units.length}** 个，已完成 **${completedUnits}** 个。`,
      },
      {
        title: '二、关键指标',
        type: 'kpi',
        data: [
          { label: '管线段数', value: pipes.length, unit: '条', color: '#409eff' },
          { label: '管线总长', value: totalLength.toFixed(1), unit: '米', color: '#67c23a' },
          { label: '调压箱', value: regulators.length, unit: '座', color: '#e6a23c' },
          { label: '引入口', value: inlets.length, unit: '个', color: '#909399' },
          { label: '检测记录', value: records.length, unit: '条', color: '#409eff' },
          { label: '异常记录', value: exceptions, unit: '条', color: '#f56c6c' },
          { label: '通过记录', value: passed, unit: '条', color: '#67c23a' },
          { label: '完成单元', value: `${completedUnits}/${units.length}`, unit: '', color: '#67c23a' },
        ],
      },
      {
        title: '三、各小区管线长度对比',
        type: 'chart',
        data: { type: 'bar', data: byCommunityPipeLength, xField: 'name', yField: 'value' },
      },
      {
        title: '四、检测状态分布',
        type: 'chart',
        data: {
          type: 'pie',
          data: [
            { name: '通过', value: passed },
            { name: '异常', value: exceptions },
            { name: '待开始', value: records.filter((r) => r.status === 'pending').length },
          ].filter((x) => x.value > 0),
        },
      },
      {
        title: '五、异常检测项分布',
        type: 'table',
        data: {
          headers: ['检测项', '异常数', '占比'],
          rows: exceptionByItem.map((g) => ({
            检测项: g.name,
            异常数: g.value,
            占比: exceptions ? `${((g.value / exceptions) * 100).toFixed(1)}%` : '-',
          })),
        },
      },
    ],
    meta: {
      totalPipes: pipes.length,
      totalRecords: records.length,
      totalFacilities: regulators.length + inlets.length + joints.length,
    },
  }
}

/** 2. 异常检测报告 */
function buildException(d: ZhiwenData, opts: ReportOptions): Report {
  const community = opts.community || '全部'
  const records = filterByCommunity(d.records, community)
  const exceptions = records.filter((r) => r.status === 'exception')

  const exceptionByItem = groupCount(exceptions, 'item_name')
  const exceptionByCommunity = groupCount(exceptions, 'community')

  return {
    type: 'exception',
    title: '⚠️ 异常检测专项报告',
    subtitle: `南海家园小区（${community}）异常检测记录深度分析`,
    generatedAt: nowString(),
    community,
    sections: [
      {
        title: '一、报告摘要',
        type: 'summary',
        data: `${community === '全部' ? '南海家园 3 个小区' : community}共发现 **${exceptions.length}** 条异常检测记录。${exceptionByItem.length > 0 ? `主要集中于 **${exceptionByItem[0].name}**（${exceptionByItem[0].value} 条），占比 ${((exceptionByItem[0].value / exceptions.length) * 100).toFixed(0)}%。` : ''}建议立即安排现场复核与整改。`,
      },
      {
        title: '二、关键指标',
        type: 'kpi',
        data: [
          { label: '异常总数', value: exceptions.length, unit: '条', color: '#f56c6c' },
          { label: '涉及检测项', value: exceptionByItem.length, unit: '项', color: '#e6a23c' },
          { label: '涉及小区', value: exceptionByCommunity.length, unit: '个', color: '#409eff' },
          { label: '异常率', value: records.length ? ((exceptions.length / records.length) * 100).toFixed(1) + '%' : '0%', unit: '', color: '#f56c6c' },
        ],
      },
      {
        title: '三、异常检测项分布',
        type: 'chart',
        data: { type: 'pie', data: exceptionByItem },
      },
      {
        title: '四、各小区异常数对比',
        type: 'chart',
        data: { type: 'bar', data: exceptionByCommunity },
      },
      {
        title: '五、异常记录明细',
        type: 'table',
        data: {
          headers: ['单元', '小区', '检测项', '测量值', '检测员', '检测时间'],
          rows: exceptions.slice(0, 50).map((r) => ({
            单元: r.unit_name || '-',
            小区: r.community || '-',
            检测项: r.item_name,
            测量值: r.measured_value !== undefined ? `${r.measured_value} ${r.unit || ''}` : '-',
            检测员: r.inspector || '-',
            检测时间: r.inspection_date ? new Date(r.inspection_date).toLocaleDateString('zh-CN') : '-',
          })),
        },
      },
      {
        title: '六、整改建议',
        type: 'text',
        data: `1. **立即响应**：对所有 exception 状态的记录安排现场复核\n2. **优先处理**：优先修复占比最高的检测项\n3. **复检机制**：整改后重新检测，确认状态为 passed\n4. **趋势监控**：本周异常数 ${exceptions.length} 条，建议建立异常趋势图，监控是否恶化`,
      },
    ],
    meta: {
      totalPipes: 0,
      totalRecords: exceptions.length,
      totalFacilities: 0,
    },
  }
}

/** 3. 物探数据报告 */
function buildTopology(d: ZhiwenData, opts: ReportOptions): Report {
  const community = opts.community || '全部'
  const pipes = filterByCommunity(d.pipes, community)
  const topoPipes = pipes.filter((p) => p.source === 'topology')

  if (topoPipes.length === 0) {
    return {
      type: 'topology',
      title: '🏗️ 物探数据专项报告',
      subtitle: `${community} 物探数据（无）`,
      generatedAt: nowString(),
      community,
      sections: [
        { title: '说明', type: 'text', data: `当前 ${community} 暂无物探数据。物探数据通过 /public/data/topology/ 目录加载。` },
      ],
      meta: { totalPipes: 0, totalRecords: 0, totalFacilities: 0 },
    }
  }

  const byMaterial = groupCount(topoPipes, 'material')
  const byYear = groupCount(topoPipes, 'build_year')
  const byDiameter = groupCount(topoPipes, 'diametero')
  const byPressure = groupCount(topoPipes, 'pressured')
  const byOwner = groupCount(topoPipes, 'owner')
  const byBuryType = groupCount(topoPipes, 'bury_type')

  return {
    type: 'topology',
    title: '🏗️ 物探数据专项报告',
    subtitle: `${community} 物探数据维度分析（${topoPipes.length} 条线段）`,
    generatedAt: nowString(),
    community,
    sections: [
      {
        title: '一、报告摘要',
        type: 'summary',
        data: `本报告分析 ${community} 的物探数据，共 **${topoPipes.length}** 条线段。涉及 **${byMaterial.length}** 种材质、**${byDiameter.length}** 种管径、**${byPressure.length}** 种压力等级，建设年代跨越 ${byYear.length} 个时期。`,
      },
      {
        title: '二、关键指标',
        type: 'kpi',
        data: [
          { label: '物探线段', value: topoPipes.length, unit: '条', color: '#409eff' },
          { label: '材质种类', value: byMaterial.length, unit: '种', color: '#67c23a' },
          { label: '管径规格', value: byDiameter.length, unit: '种', color: '#e6a23c' },
          { label: '压力等级', value: byPressure.length, unit: '种', color: '#909399' },
          { label: '建设年代', value: byYear.length, unit: '个', color: '#409eff' },
          { label: '权属单位', value: byOwner.length, unit: '家', color: '#67c23a' },
        ],
      },
      {
        title: '三、材质分布',
        type: 'chart',
        data: { type: 'pie', data: byMaterial },
      },
      {
        title: '四、管径分布',
        type: 'chart',
        data: { type: 'bar', data: byDiameter },
      },
      {
        title: '五、建设年代分布',
        type: 'chart',
        data: { type: 'bar', data: byYear },
      },
      {
        title: '六、压力等级分布',
        type: 'chart',
        data: { type: 'pie', data: byPressure },
      },
      {
        title: '七、权属单位分布',
        type: 'table',
        data: {
          headers: ['权属单位', '线段数', '占比'],
          rows: byOwner.map((g) => ({
            权属单位: g.name,
            线段数: g.value,
            占比: `${((g.value / topoPipes.length) * 100).toFixed(1)}%`,
          })),
        },
      },
      {
        title: '八、埋设类型分布',
        type: 'table',
        data: {
          headers: ['埋设类型', '线段数', '占比'],
          rows: byBuryType.map((g) => ({
            埋设类型: g.name,
            线段数: g.value,
            占比: `${((g.value / topoPipes.length) * 100).toFixed(1)}%`,
          })),
        },
      },
    ],
    meta: {
      totalPipes: topoPipes.length,
      totalRecords: 0,
      totalFacilities: 0,
    },
  }
}

/** 4. 设施分布报告 */
function buildFacility(d: ZhiwenData, opts: ReportOptions): Report {
  const community = opts.community || '全部'
  const regulators = filterByCommunity(d.regulators, community)
  const inlets = filterByCommunity(d.inlets, community)
  const joints = filterByCommunity(d.joints, community)
  const controls = filterByCommunity(d.controls, community)

  const regulatorByCommunity = groupCount(d.regulators, 'community')
  const inletByCommunity = groupCount(d.inlets, 'community')
  const jointByCommunity = groupCount(d.joints, 'community')

  return {
    type: 'facility',
    title: '📍 管网设施分布报告',
    subtitle: `${community} 调压箱 / 引入口 / 绝缘接头 分布分析`,
    generatedAt: nowString(),
    community,
    sections: [
      {
        title: '一、报告摘要',
        type: 'summary',
        data: `${community === '全部' ? '南海家园 3 个小区' : community}共有 **${regulators.length}** 个调压箱、**${inlets.length}** 个引入口、**${joints.length}** 个绝缘接头、**${controls.length}** 个控制单元（含物探点）。`,
      },
      {
        title: '二、关键指标',
        type: 'kpi',
        data: [
          { label: '调压箱', value: regulators.length, unit: '座', color: '#e6a23c' },
          { label: '引入口', value: inlets.length, unit: '个', color: '#409eff' },
          { label: '绝缘接头', value: joints.length, unit: '个', color: '#67c23a' },
          { label: '控制单元', value: controls.length, unit: '个', color: '#909399' },
        ],
      },
      {
        title: '三、各小区调压箱数量',
        type: 'chart',
        data: { type: 'bar', data: regulatorByCommunity },
      },
      {
        title: '四、各小区引入口数量',
        type: 'chart',
        data: { type: 'bar', data: inletByCommunity },
      },
      {
        title: '五、各小区绝缘接头数量',
        type: 'chart',
        data: { type: 'bar', data: jointByCommunity },
      },
      {
        title: '六、调压箱明细',
        type: 'table',
        data: {
          headers: ['编号', '小区', '经度', '纬度', 'ECode'],
          rows: regulators.slice(0, 50).map((r) => ({
            编号: r.fid,
            小区: r.community,
            经度: r.lng.toFixed(6),
            纬度: r.lat.toFixed(6),
            ECode: r.ecode || '-',
          })),
        },
      },
    ],
    meta: {
      totalPipes: 0,
      totalRecords: 0,
      totalFacilities: regulators.length + inlets.length + joints.length,
    },
  }
}

/** 5. 进度分析报告 */
function buildProgress(d: ZhiwenData, opts: ReportOptions): Report {
  const community = opts.community || '全部'
  const units = filterByCommunity(d.units, community)
  const records = filterByCommunity(d.records, community)

  const statusCount = groupCount(units, 'inspection_status')
  const completedRate = units.length ? (statusCount.find((s) => s.name === 'completed')?.value || 0) / units.length : 0
  const avgProgress = units.length ? units.reduce((s, u) => s + (u.inspection_progress || 0), 0) / units.length : 0

  const progressByCommunity = Array.from(
    d.units.reduce((m, u) => {
      if (!m.has(u.community)) m.set(u.community, { total: 0, completed: 0 })
      const item = m.get(u.community)!
      item.total++
      if (u.inspection_status === 'completed') item.completed++
      return m
    }, new Map<string, { total: number; completed: number }>()),
  ).map(([name, v]) => ({ name, value: v.total ? Math.round((v.completed / v.total) * 100) : 0 }))

  return {
    type: 'progress',
    title: '📈 腐控单元进度分析报告',
    subtitle: `${community} 7 项检测完成情况`,
    generatedAt: nowString(),
    community,
    sections: [
      {
        title: '一、报告摘要',
        type: 'summary',
        data: `${community === '全部' ? '南海家园 3 个小区' : community}共 **${units.length}** 个腐控单元，总体完成率 **${(completedRate * 100).toFixed(1)}%**，平均进度 **${(avgProgress * 100).toFixed(1)}%**。${statusCount.find((s) => s.name === 'in_progress') ? `当前 **${statusCount.find((s) => s.name === 'in_progress')!.value}** 个单元进行中。` : ''}`,
      },
      {
        title: '二、关键指标',
        type: 'kpi',
        data: [
          { label: '腐控单元', value: units.length, unit: '个', color: '#409eff' },
          { label: '完成数', value: statusCount.find((s) => s.name === 'completed')?.value || 0, unit: '个', color: '#67c23a' },
          { label: '进行中', value: statusCount.find((s) => s.name === 'in_progress')?.value || 0, unit: '个', color: '#e6a23c' },
          { label: '完成率', value: (completedRate * 100).toFixed(1) + '%', unit: '', color: '#67c23a' },
          { label: '平均进度', value: (avgProgress * 100).toFixed(1) + '%', unit: '', color: '#409eff' },
          { label: '检测记录', value: records.length, unit: '条', color: '#909399' },
        ],
      },
      {
        title: '三、各小区完成率',
        type: 'chart',
        data: { type: 'bar', data: progressByCommunity },
      },
      {
        title: '四、腐控单元明细',
        type: 'table',
        data: {
          headers: ['单元名称', '小区', '进度', '状态', '最近检测时间'],
          rows: units.map((u) => ({
            单元名称: u.name,
            小区: u.community,
            进度: (u.inspection_progress * 100).toFixed(0) + '%',
            状态: u.inspection_status,
            最近检测时间: u.last_inspection_at ? new Date(u.last_inspection_at).toLocaleDateString('zh-CN') : '-',
          })),
        },
      },
    ],
    meta: {
      totalPipes: 0,
      totalRecords: records.length,
      totalFacilities: 0,
    },
  }
}

/** 6. 专项检测报告 */
function buildInspection(d: ZhiwenData, opts: ReportOptions): Report {
  const community = opts.community || '全部'
  const records = filterByCommunity(d.records, community)
  const itemCode = opts.itemCode || 'PIPE_GROUND_POTENTIAL'
  const itemRecords = records.filter((r) => r.item_code === itemCode)

  const itemName = itemRecords[0]?.item_name || itemCode
  const passed = itemRecords.filter((r) => r.status === 'passed').length
  const exception = itemRecords.filter((r) => r.status === 'exception').length
  const numericValues = itemRecords
    .map((r) => r.measured_value)
    .filter((v): v is number => typeof v === 'number')
  const avg = numericValues.length ? numericValues.reduce((s, v) => s + v, 0) / numericValues.length : 0
  const max = numericValues.length ? Math.max(...numericValues) : 0
  const min = numericValues.length ? Math.min(...numericValues) : 0

  return {
    type: 'inspection',
    title: `🔍 ${itemName}专项检测报告`,
    subtitle: `${community} ${itemName}数据详细分析`,
    generatedAt: nowString(),
    community,
    itemCode,
    sections: [
      {
        title: '一、报告摘要',
        type: 'summary',
        data: `${community === '全部' ? '南海家园 3 个小区' : community}的 **${itemName}** 共 **${itemRecords.length}** 条记录，通过 **${passed}** 条（${itemRecords.length ? ((passed / itemRecords.length) * 100).toFixed(0) : 0}%），异常 **${exception}** 条${numericValues.length ? `。测量值范围 ${min.toFixed(3)} ~ ${max.toFixed(3)}，平均 ${avg.toFixed(3)}。` : '。'}`,
      },
      {
        title: '二、关键指标',
        type: 'kpi',
        data: [
          { label: '记录总数', value: itemRecords.length, unit: '条', color: '#409eff' },
          { label: '通过', value: passed, unit: '条', color: '#67c23a' },
          { label: '异常', value: exception, unit: '条', color: '#f56c6c' },
          { label: '通过率', value: itemRecords.length ? ((passed / itemRecords.length) * 100).toFixed(0) + '%' : '0%', unit: '', color: '#67c23a' },
          { label: '平均测量值', value: numericValues.length ? avg.toFixed(3) : '-', unit: '', color: '#409eff' },
          { label: '最大/最小', value: numericValues.length ? `${max.toFixed(2)}/${min.toFixed(2)}` : '-', unit: '', color: '#e6a23c' },
        ],
      },
      {
        title: '三、状态分布',
        type: 'chart',
        data: {
          type: 'pie',
          data: [
            { name: '通过', value: passed },
            { name: '异常', value: exception },
            { name: '待开始', value: itemRecords.filter((r) => r.status === 'pending').length },
          ].filter((x) => x.value > 0),
        },
      },
      {
        title: '四、详细记录',
        type: 'table',
        data: {
          headers: ['单元', '小区', '状态', '测量值', '单位', '检测员', '检测时间', '备注'],
          rows: itemRecords.slice(0, 50).map((r) => ({
            单元: r.unit_name || '-',
            小区: r.community || '-',
            状态: r.status,
            测量值: r.measured_value !== undefined ? r.measured_value : '-',
            单位: r.unit || '-',
            检测员: r.inspector || '-',
            检测时间: r.inspection_date ? new Date(r.inspection_date).toLocaleDateString('zh-CN') : '-',
            备注: r.result_summary || '-',
          })),
        },
      },
    ],
    meta: {
      totalPipes: 0,
      totalRecords: itemRecords.length,
      totalFacilities: 0,
    },
  }
}

// ============== 主入口 ==============

export function generateReport(type: ReportType, d: ZhiwenData, opts: ReportOptions = {}): Report {
  switch (type) {
    case 'overview': return buildOverview(d, opts)
    case 'exception': return buildException(d, opts)
    case 'topology': return buildTopology(d, opts)
    case 'facility': return buildFacility(d, opts)
    case 'progress': return buildProgress(d, opts)
    case 'inspection': return buildInspection(d, opts)
    default: return buildOverview(d, opts)
  }
}

export const REPORT_TYPES: Array<{
  type: ReportType
  icon: string
  title: string
  desc: string
  color: string
  needsItemCode?: boolean
}> = [
  { type: 'overview', icon: '📊', title: '综合概览', desc: '全小区管网+检测+进度的总体概览', color: '#409eff' },
  { type: 'exception', icon: '⚠️', title: '异常检测报告', desc: '所有异常记录的详细分析与整改建议', color: '#f56c6c' },
  { type: 'topology', icon: '🏗️', title: '物探数据报告', desc: '管径/材质/建设年代/权属的物探数据维度分析', color: '#e6a23c' },
  { type: 'facility', icon: '📍', title: '设施分布报告', desc: '调压箱/引入口/绝缘接头的分布统计', color: '#67c23a' },
  { type: 'progress', icon: '📈', title: '进度分析报告', desc: '腐控单元完成率与 7 项检测进度', color: '#909399' },
  { type: 'inspection', icon: '🔍', title: '专项检测报告', desc: '单个检测项的深度数据分析（管地电位/土壤电阻率等）', color: '#409eff', needsItemCode: true },
]

export const ITEM_CODES = [
  { code: 'PIPE_GROUND_POTENTIAL', name: '管地电位' },
  { code: 'SOIL_RESISTIVITY', name: '土壤电阻率' },
  { code: 'DC_STRAY_CURRENT', name: '直流杂散电流' },
  { code: 'COATING_DETECT', name: '防腐层检测' },
  { code: 'JOINT_VERIFY', name: '绝缘接头' },
  { code: 'ELECTRIC_CONTINUITY', name: '电联通性' },
  { code: 'INLET_PARAM', name: '引入口参数' },
]
