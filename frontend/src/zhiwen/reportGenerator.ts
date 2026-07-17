/**
 * 报告生成器（统一模板版）
 *
 * 所有报告遵循统一章节结构（与"阴极保护数据综合概览报告"一致）：
 *   一、报告摘要           (summary)
 *   二、关键指标           (kpi, 4-8 卡片)
 *   三～N、图表分析         (chart, 每个都是 ECharts 图)
 *   N+1、详细数据          (table, 完整明细)
 *   N+2、分析与建议         (text, 业务洞察)
 *
 * 6 种报告类型：
 *  - overview   综合概览（管网+检测+进度全维度）
 *  - exception  异常检测报告
 *  - topology   物探数据报告
 *  - facility   设施分布报告
 *  - progress   进度分析报告
 *  - inspection 专项检测报告
 */

import type { ZhiwenData } from './engine'

export type ReportType = 'overview' | 'exception' | 'topology' | 'facility' | 'progress' | 'inspection'

export type ReportSectionType = 'summary' | 'kpi' | 'chart' | 'table' | 'text'

export interface ReportSection {
  /** 章节标题（不含前缀"一、二、"） */
  title: string
  type: ReportSectionType
  data: any
}

export interface Report {
  type: ReportType
  title: string
  subtitle: string
  generatedAt: string
  community: string
  itemCode?: string
  sections: ReportSection[]
  meta: {
    totalPipes: number
    totalRecords: number
    totalFacilities: number
  }
}

export interface ReportOptions {
  community?: string
  itemCode?: string
  includeTopology?: boolean
}

// ============== 工具函数 ==============

function filterByCommunity<T extends { community?: string }>(rows: T[], community?: string): T[] {
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

/** 章节序号前缀（中文一、二、三...十一、十二...） */
const CN_NUMS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五']
function cnNum(i: number) { return CN_NUMS[i] || String(i + 1) }

// ============== 通用模板构造器 ==============

/**
 * 用统一模板拼装报告
 * @param type 报告类型
 * @param title 标题
 * @param subtitle 副标题
 * @param community 数据范围
 * @param summary 报告摘要文本
 * @param kpis 关键指标数组
 * @param charts 图表数组（title + spec）
 * @param tables 详细数据表数组（title + data）
 * @param insights 业务洞察文本数组
 * @param meta 元信息
 */
function assembleReport(
  type: ReportType,
  title: string,
  subtitle: string,
  community: string,
  summary: string,
  kpis: Array<{ label: string; value: string | number; unit?: string; color: string }>,
  charts: Array<{ title: string; type: 'pie' | 'bar' | 'line'; data: any[] }>,
  tables: Array<{ title: string; headers: string[]; rows: any[] }>,
  insights: string[],
  meta: { totalPipes: number; totalRecords: number; totalFacilities: number },
  itemCode?: string,
): Report {
  const sections: ReportSection[] = []
  let chapterIdx = 0

  // 一、报告摘要
  sections.push({ title: `${cnNum(chapterIdx++)}、报告摘要`, type: 'summary', data: summary })

  // 二、关键指标
  sections.push({ title: `${cnNum(chapterIdx++)}、关键指标`, type: 'kpi', data: kpis })

  // 三～N、图表分析
  charts.forEach((c) => {
    sections.push({
      title: `${cnNum(chapterIdx++)}、${c.title}`,
      type: 'chart',
      data: { type: c.type, data: c.data },
    })
  })

  // 详细数据
  tables.forEach((t) => {
    if (t.rows.length > 0 || charts.length === 0) {
      sections.push({
        title: `${cnNum(chapterIdx++)}、${t.title}`,
        type: 'table',
        data: { headers: t.headers, rows: t.rows.slice(0, 50) },
      })
    }
  })

  // 分析与建议
  if (insights.length > 0) {
    sections.push({
      title: `${cnNum(chapterIdx++)}、分析与建议`,
      type: 'text',
      data: insights.join('\n\n'),
    })
  }

  return {
    type, title, subtitle,
    generatedAt: nowString(),
    community,
    itemCode,
    sections,
    meta,
  }
}

// ============== 各报告类型 ==============

/** 1. 综合概览报告 */
function buildOverview(d: ZhiwenData, opts: ReportOptions): Report {
  const community = opts.community || '全部'
  const pipes = filterByCommunity(d.pipes, community)
  const regulators = filterByCommunity(d.regulators, community)
  const inlets = filterByCommunity(d.inlets, community)
  const joints = filterByCommunity(d.joints, community)
  const records = filterByCommunity(d.records, community)
  const units = filterByCommunity(d.units, community)

  const totalLength = pipes.reduce((s, p) => s + toNumber(p.length), 0)
  const exceptions = records.filter((r) => r.status === 'exception').length
  const passed = records.filter((r) => r.status === 'passed').length
  const completedUnits = units.filter((u) => u.inspection_status === 'completed').length

  const communityDisplay = community === '全部' ? '南海家园 3 个小区' : community

  return assembleReport(
    'overview',
    '📊 阴极保护数据综合概览报告',
    `南海家园小区（${community}）管网与检测数据综合分析`,
    community,
    `本报告覆盖 ${communityDisplay}，包含 **${pipes.length}** 条管线（总长度 **${totalLength.toFixed(1)} m**）、**${regulators.length}** 个调压箱、**${inlets.length}** 个引入口、**${joints.length}** 个绝缘接头。当前 **${records.length}** 条检测记录，异常 **${exceptions}** 条（占 ${records.length ? ((exceptions / records.length) * 100).toFixed(1) : 0}%），通过 **${passed}** 条。腐控单元共 **${units.length}** 个，已完成 **${completedUnits}** 个。`,
    [
      { label: '管线段数', value: pipes.length, unit: '条', color: '#409eff' },
      { label: '管线总长', value: totalLength.toFixed(1), unit: '米', color: '#67c23a' },
      { label: '调压箱', value: regulators.length, unit: '座', color: '#e6a23c' },
      { label: '引入口', value: inlets.length, unit: '个', color: '#909399' },
      { label: '检测记录', value: records.length, unit: '条', color: '#409eff' },
      { label: '异常记录', value: exceptions, unit: '条', color: '#f56c6c' },
      { label: '通过记录', value: passed, unit: '条', color: '#67c23a' },
      { label: '完成单元', value: `${completedUnits}/${units.length}`, color: '#67c23a' },
    ],
    [
      { title: '各小区管线长度对比', type: 'bar', data: groupSum(d.pipes, 'community', 'length') },
      { title: '检测状态分布', type: 'pie', data: [
        { name: '通过', value: passed },
        { name: '异常', value: exceptions },
        { name: '待开始', value: records.filter((r) => r.status === 'pending').length },
      ].filter((x) => x.value > 0) },
      { title: '各小区检测记录数量', type: 'bar', data: groupCount(records, 'community') },
      { title: '各小区腐控单元完成数', type: 'bar', data: Array.from(
        d.units.reduce((m, u) => {
          if (!m.has(u.community)) m.set(u.community, { total: 0, completed: 0 })
          const item = m.get(u.community)!
          item.total++
          if (u.inspection_status === 'completed') item.completed++
          return m
        }, new Map<string, { total: number; completed: number }>()),
      ).map(([name, v]) => ({ name, value: v.completed })) },
    ],
    [
      { title: '异常检测项分布', headers: ['检测项', '异常数', '占比'], rows: groupCount(
        records.filter((r) => r.status === 'exception'),
        'item_name',
      ).map((g) => ({
        检测项: g.name,
        异常数: g.value,
        占比: exceptions ? `${((g.value / exceptions) * 100).toFixed(1)}%` : '-',
      })) },
    ],
    [
      '📌 **数据完整度高**：管线、调压箱、引入口、绝缘接头四大类设施均已建档。',
      '⚠️ **异常情况**：共发现 **' + exceptions + '** 条异常记录（' + (records.length ? ((exceptions / records.length) * 100).toFixed(1) : 0) + '%），建议优先排查占比最高的检测项。',
      '✅ **完成情况**：腐控单元完成率 **' + (units.length ? ((completedUnits / units.length) * 100).toFixed(0) : 0) + '%**，' + (completedUnits === units.length ? '全部完成，建议进入下一阶段。' : '仍有 ' + (units.length - completedUnits) + ' 个待完成，需加快推进。'),
    ],
    {
      totalPipes: pipes.length,
      totalRecords: records.length,
      totalFacilities: regulators.length + inlets.length + joints.length,
    },
  )
}

/** 2. 异常检测报告 */
function buildException(d: ZhiwenData, opts: ReportOptions): Report {
  const community = opts.community || '全部'
  const records = filterByCommunity(d.records, community)
  const exceptions = records.filter((r) => r.status === 'exception')
  const passed = records.filter((r) => r.status === 'passed').length
  const pending = records.filter((r) => r.status === 'pending').length

  const byItem = groupCount(exceptions, 'item_name')
  const byCommunity = groupCount(exceptions, 'community')
  const byInspector = groupCount(exceptions, 'inspector')

  const communityDisplay = community === '全部' ? '南海家园 3 个小区' : community
  const topItem = byItem[0]
  const topCommunity = byCommunity[0]
  const topInspector = byInspector[0]

  return assembleReport(
    'exception',
    '⚠️ 异常检测专项报告',
    `${communityDisplay} 异常检测记录深度分析`,
    community,
    `${communityDisplay}共发现 **${exceptions.length}** 条异常检测记录${topItem ? `，主要集中于 **${topItem.name}**（${topItem.value} 条，占比 ${((topItem.value / exceptions.length) * 100).toFixed(0)}%）` : ''}。异常率 **${records.length ? ((exceptions.length / records.length) * 100).toFixed(1) : 0}%**${topInspector ? `，主要检测员为 **${topInspector.name}**（${topInspector.value} 条）` : ''}。建议立即安排现场复核与整改。`,
    [
      { label: '异常总数', value: exceptions.length, unit: '条', color: '#f56c6c' },
      { label: '异常率', value: records.length ? ((exceptions.length / records.length) * 100).toFixed(1) + '%' : '0%', color: '#f56c6c' },
      { label: '涉及检测项', value: byItem.length, unit: '项', color: '#e6a23c' },
      { label: '涉及小区', value: byCommunity.length, unit: '个', color: '#409eff' },
      { label: '涉及检测员', value: byInspector.length, unit: '人', color: '#909399' },
      { label: '总检测记录', value: records.length, unit: '条', color: '#67c23a' },
      { label: '通过记录', value: passed, unit: '条', color: '#67c23a' },
      { label: '待开始', value: pending, unit: '条', color: '#909399' },
    ],
    [
      { title: '异常检测项分布', type: 'pie', data: byItem },
      { title: '各小区异常数对比', type: 'bar', data: byCommunity },
      { title: '各检测员异常数排名', type: 'bar', data: byInspector.sort((a, b) => b.value - a.value).slice(0, 10) },
      { title: '异常与通过状态对比', type: 'pie', data: [
        { name: '通过', value: passed },
        { name: '异常', value: exceptions.length },
        { name: '待开始', value: pending },
      ].filter((x) => x.value > 0) },
    ],
    [
      { title: '异常记录明细', headers: ['单元', '小区', '检测项', '测量值', '检测员', '检测时间'], rows: exceptions.slice(0, 50).map((r) => ({
        单元: r.unit_name || '-',
        小区: r.community || '-',
        检测项: r.item_name,
        测量值: r.measured_value !== undefined ? `${r.measured_value} ${r.unit || ''}` : '-',
        检测员: r.inspector || '-',
        检测时间: r.inspection_date ? new Date(r.inspection_date).toLocaleDateString('zh-CN') : '-',
      })) },
    ],
    [
      '🚨 **立即响应**：对所有 exception 状态的记录安排现场复核，建议 24 小时内启动。',
      '🎯 **优先处理**：' + (topItem ? `优先修复占比最高的 **${topItem.name}**（${topItem.value} 条）` : '按检测项数量从高到低处理') + '。',
      topCommunity ? `📍 **重点小区**：**${topCommunity.name.replace('南海家园', '')}** 异常数最多（${topCommunity.value} 条），需重点排查。` : '',
      '🔄 **复检机制**：整改后重新检测，确认状态为 passed；建议建立异常闭环跟踪表。',
      '📈 **趋势监控**：建立周/月异常趋势图，监控异常率是否持续下降。',
    ].filter(Boolean),
    {
      totalPipes: 0,
      totalRecords: exceptions.length,
      totalFacilities: 0,
    },
  )
}

/** 3. 物探数据报告 */
function buildTopology(d: ZhiwenData, opts: ReportOptions): Report {
  const community = opts.community || '全部'
  const pipes = filterByCommunity(d.pipes, community)
  const topoPipes = pipes.filter((p) => p.source === 'topology')

  if (topoPipes.length === 0) {
    return assembleReport(
      'topology',
      '🏗️ 物探数据专项报告',
      `${community} 物探数据（无）`,
      community,
      `当前 ${community} 暂无物探数据。物探数据通过 /public/data/topology/ 目录加载。`,
      [{ label: '物探线段', value: 0, unit: '条', color: '#909399' }],
      [],
      [],
      ['物探数据为空，请检查 /public/data/topology/ 目录下的 xlsx/csv 文件是否正确加载。'],
      { totalPipes: 0, totalRecords: 0, totalFacilities: 0 },
    )
  }

  const byMaterial = groupCount(topoPipes, 'material')
  const byYear = groupCount(topoPipes, 'build_year')
  const byDiameter = groupCount(topoPipes, 'diametero')
  const byPressure = groupCount(topoPipes, 'pressured')
  const byOwner = groupCount(topoPipes, 'owner')
  const byBury = groupCount(topoPipes, 'bury_type')

  const communityDisplay = community === '全部' ? '南海家园 3 个小区' : community
  const topMaterial = byMaterial[0]
  const topYear = byYear[0]
  const oldPipes = topoPipes.filter((p) => parseInt(p.build_year || '9999') < 2010).length
  const oldPercent = topoPipes.length ? ((oldPipes / topoPipes.length) * 100).toFixed(0) : '0'

  return assembleReport(
    'topology',
    '🏗️ 物探数据专项报告',
    `${communityDisplay} 物探数据多维度分析（${topoPipes.length} 条线段）`,
    community,
    `本报告分析 ${communityDisplay} 的物探数据，共 **${topoPipes.length}** 条线段。涉及 **${byMaterial.length}** 种材质、**${byDiameter.length}** 种管径、**${byPressure.length}** 种压力等级，建设年代跨越 **${byYear.length}** 个时期${oldPipes > 0 ? `，其中 **${oldPipes}** 条（${oldPercent}%）为 2010 年前建设，建议重点关注老化情况` : ''}。`,
    [
      { label: '物探线段', value: topoPipes.length, unit: '条', color: '#409eff' },
      { label: '材质种类', value: byMaterial.length, unit: '种', color: '#67c23a' },
      { label: '管径规格', value: byDiameter.length, unit: '种', color: '#e6a23c' },
      { label: '压力等级', value: byPressure.length, unit: '种', color: '#909399' },
      { label: '建设年代', value: byYear.length, unit: '个', color: '#409eff' },
      { label: '权属单位', value: byOwner.length, unit: '家', color: '#67c23a' },
      { label: '埋设类型', value: byBury.length, unit: '种', color: '#e6a23c' },
      { label: '老旧管线', value: `${oldPipes}条`, unit: '(<2010)', color: oldPipes > 0 ? '#f56c6c' : '#67c23a' },
    ],
    [
      { title: '材质分布', type: 'pie', data: byMaterial },
      { title: '管径分布', type: 'bar', data: byDiameter },
      { title: '建设年代分布', type: 'bar', data: byYear.sort((a, b) => a.name.localeCompare(b.name)) },
      { title: '压力等级分布', type: 'pie', data: byPressure },
      { title: '权属单位分布', type: 'bar', data: byOwner },
      { title: '埋设类型分布', type: 'pie', data: byBury },
    ],
    [
      { title: '权属单位明细', headers: ['权属单位', '线段数', '占比'], rows: byOwner.map((g) => ({
        权属单位: g.name,
        线段数: g.value,
        占比: `${((g.value / topoPipes.length) * 100).toFixed(1)}%`,
      })) },
      { title: '建设年代明细', headers: ['建设年代', '线段数', '占比'], rows: byYear.sort((a, b) => a.name.localeCompare(b.name)).map((g) => ({
        建设年代: g.name,
        线段数: g.value,
        占比: `${((g.value / topoPipes.length) * 100).toFixed(1)}%`,
      })) },
    ],
    [
      topMaterial ? `🔧 **主导材质**：**${topMaterial.name}** 占 ${((topMaterial.value / topoPipes.length) * 100).toFixed(0)}%，是本小区主要管材。` : '',
      topYear ? `📅 **建设高峰**：**${topYear.name}** 年建设管线最多（${topYear.value} 条）。` : '',
      oldPipes > 0 ? `⚠️ **老化提示**：**${oldPipes}** 条管线（${oldPercent}%）建于 2010 年前，建议纳入下一阶段重点维护/更换计划。` : '✅ **管龄良好**：暂无 2010 年前建设的管线，整体管龄较新。',
      '💡 **维护建议**：根据建设年代+管径+压力等级组合，识别高风险管段（老旧+大管径+中压），优先纳入年度巡检。',
    ].filter(Boolean),
    {
      totalPipes: topoPipes.length,
      totalRecords: 0,
      totalFacilities: 0,
    },
  )
}

/** 4. 设施分布报告 */
function buildFacility(d: ZhiwenData, opts: ReportOptions): Report {
  const community = opts.community || '全部'
  const regulators = filterByCommunity(d.regulators, community)
  const inlets = filterByCommunity(d.inlets, community)
  const joints = filterByCommunity(d.joints, community)
  const controls = filterByCommunity(d.controls, community)

  const regByComm = groupCount(d.regulators, 'community')
  const inlByComm = groupCount(d.inlets, 'community')
  const jntByComm = groupCount(d.joints, 'community')
  const ctrlByComm = groupCount(d.controls, 'community')

  const totalFacilities = regulators.length + inlets.length + joints.length + controls.length
  const communityDisplay = community === '全部' ? '南海家园 3 个小区' : community
  const topRegComm = regByComm[0]
  const topInlComm = inlByComm[0]

  return assembleReport(
    'facility',
    '📍 管网设施分布报告',
    `${communityDisplay} 调压箱 / 引入口 / 绝缘接头 分布分析`,
    community,
    `${communityDisplay}共有 **${regulators.length}** 个调压箱、**${inlets.length}** 个引入口、**${joints.length}** 个绝缘接头、**${controls.length}** 个控制单元（含物探点），合计 **${totalFacilities}** 个设施${topRegComm ? `。调压箱主要分布在 **${topRegComm.name.replace('南海家园', '')}**（${topRegComm.value} 个）` : ''}${topInlComm ? `，引入口以 **${topInlComm.name.replace('南海家园', '')}**（${topInlComm.value} 个）最多` : ''}。`,
    [
      { label: '调压箱', value: regulators.length, unit: '座', color: '#e6a23c' },
      { label: '引入口', value: inlets.length, unit: '个', color: '#409eff' },
      { label: '绝缘接头', value: joints.length, unit: '个', color: '#67c23a' },
      { label: '控制单元', value: controls.length, unit: '个', color: '#909399' },
      { label: '设施合计', value: totalFacilities, unit: '个', color: '#67c23a' },
    ],
    [
      { title: '各小区调压箱数量', type: 'bar', data: regByComm },
      { title: '各小区引入口数量', type: 'bar', data: inlByComm },
      { title: '各小区绝缘接头数量', type: 'bar', data: jntByComm },
      { title: '各小区控制单元数量', type: 'bar', data: ctrlByComm },
      { title: '设施类型占比', type: 'pie', data: [
        { name: '调压箱', value: regulators.length },
        { name: '引入口', value: inlets.length },
        { name: '绝缘接头', value: joints.length },
        { name: '控制单元', value: controls.length },
      ].filter((x) => x.value > 0) },
    ],
    [
      { title: '调压箱明细', headers: ['编号', '小区', '经度', '纬度', 'ECode'], rows: regulators.slice(0, 50).map((r) => ({
        编号: r.fid,
        小区: r.community,
        经度: r.lng.toFixed(6),
        纬度: r.lat.toFixed(6),
        ECode: r.ecode || '-',
      })) },
      { title: '引入口明细', headers: ['编号', '小区', '经度', '纬度'], rows: inlets.slice(0, 50).map((r) => ({
        编号: r.fid,
        小区: r.community,
        经度: r.lng.toFixed(6),
        纬度: r.lat.toFixed(6),
      })) },
    ],
    [
      topRegComm ? `🏭 **调压箱分布**：**${topRegComm.name.replace('南海家园', '')}** 调压箱最多（${topRegComm.value} 个），是本小区供气枢纽。` : '',
      topInlComm ? `🔌 **引入口分布**：**${topInlComm.name.replace('南海家园', '')}** 引入口最多（${topInlComm.value} 个），用户密度较大。` : '',
      '🗺️ **地图建议**：在 GIS 地图上叠加各小区设施图层，便于现场运维快速定位。',
    ].filter(Boolean),
    {
      totalPipes: 0,
      totalRecords: 0,
      totalFacilities: totalFacilities,
    },
  )
}

/** 5. 进度分析报告 */
function buildProgress(d: ZhiwenData, opts: ReportOptions): Report {
  const community = opts.community || '全部'
  const units = filterByCommunity(d.units, community)
  const records = filterByCommunity(d.records, community)

  const statusCount = groupCount(units, 'inspection_status')
  const completedCount = statusCount.find((s) => s.name === 'completed')?.value || 0
  const inProgressCount = statusCount.find((s) => s.name === 'in_progress')?.value || 0
  const pendingCount = statusCount.find((s) => s.name === 'pending')?.value || 0
  const exceptionCount = statusCount.find((s) => s.name === 'exception')?.value || 0
  const completedRate = units.length ? completedCount / units.length : 0
  const avgProgress = units.length ? units.reduce((s, u) => s + (u.inspection_progress || 0), 0) / units.length : 0

  const progressByComm = Array.from(
    d.units.reduce((m, u) => {
      if (!m.has(u.community)) m.set(u.community, { total: 0, completed: 0, sum: 0 })
      const item = m.get(u.community)!
      item.total++
      item.sum += u.inspection_progress || 0
      if (u.inspection_status === 'completed') item.completed++
      return m
    }, new Map<string, { total: number; completed: number; sum: number }>()),
  ).map(([name, v]) => ({
    name,
    value: v.total ? Math.round((v.completed / v.total) * 100) : 0,
  }))

  const avgProgressByComm = Array.from(
    d.units.reduce((m, u) => {
      if (!m.has(u.community)) m.set(u.community, { total: 0, sum: 0 })
      const item = m.get(u.community)!
      item.total++
      item.sum += u.inspection_progress || 0
      return m
    }, new Map<string, { total: number; sum: number }>()),
  ).map(([name, v]) => ({
    name,
    value: v.total ? Math.round((v.sum / v.total) * 100) : 0,
  }))

  const communityDisplay = community === '全部' ? '南海家园 3 个小区' : community
  const slowComm = progressByComm.filter((p) => p.value < 50).sort((a, b) => a.value - b.value)[0]

  return assembleReport(
    'progress',
    '📈 腐控单元进度分析报告',
    `${communityDisplay} 7 项检测完成情况`,
    community,
    `${communityDisplay}共 **${units.length}** 个腐控单元，总体完成率 **${(completedRate * 100).toFixed(1)}%**，平均进度 **${(avgProgress * 100).toFixed(1)}%**。当前 **${inProgressCount}** 个进行中、**${pendingCount}** 个待开始、**${exceptionCount}** 个异常。共产生 **${records.length}** 条检测记录。${slowComm ? `**${slowComm.name.replace('南海家园', '')}** 完成率最低（${slowComm.value}%），需重点跟进。` : ''}`,
    [
      { label: '腐控单元', value: units.length, unit: '个', color: '#409eff' },
      { label: '已完成', value: completedCount, unit: '个', color: '#67c23a' },
      { label: '进行中', value: inProgressCount, unit: '个', color: '#e6a23c' },
      { label: '待开始', value: pendingCount, unit: '个', color: '#909399' },
      { label: '异常单元', value: exceptionCount, unit: '个', color: '#f56c6c' },
      { label: '完成率', value: (completedRate * 100).toFixed(1) + '%', color: '#67c23a' },
      { label: '平均进度', value: (avgProgress * 100).toFixed(1) + '%', color: '#409eff' },
      { label: '检测记录', value: records.length, unit: '条', color: '#909399' },
    ],
    [
      { title: '各小区完成率', type: 'bar', data: progressByComm },
      { title: '各小区平均进度', type: 'bar', data: avgProgressByComm },
      { title: '腐控单元状态分布', type: 'pie', data: statusCount },
      { title: '完成 vs 未完成', type: 'pie', data: [
        { name: '已完成', value: completedCount },
        { name: '未完成', value: units.length - completedCount },
      ] },
    ],
    [
      { title: '腐控单元明细', headers: ['单元名称', '小区', '进度', '状态', '最近检测时间'], rows: units.map((u) => ({
        单元名称: u.name,
        小区: u.community,
        进度: (u.inspection_progress * 100).toFixed(0) + '%',
        状态: u.inspection_status,
        最近检测时间: (u as any).last_inspection_at ? new Date((u as any).last_inspection_at).toLocaleDateString('zh-CN') : '-',
      })) },
    ],
    [
      completedRate >= 0.9 ? '✅ **进度优秀**：完成率已达 ' + (completedRate * 100).toFixed(0) + '%，建议进入下一阶段验收。' :
        completedRate >= 0.5 ? '⏳ **稳步推进**：完成率 ' + (completedRate * 100).toFixed(0) + '%，仍有 ' + (units.length - completedCount) + ' 个单元待完成。' :
          '🚨 **进度滞后**：完成率仅 ' + (completedRate * 100).toFixed(0) + '%，需分析原因并加快进度。',
      slowComm ? `📍 **重点跟进**：**${slowComm.name.replace('南海家园', '')}** 完成率仅 ${slowComm.value}%，建议增加人员或调整计划。` : '✅ **整体均衡**：各小区进度较为均衡。',
      '📊 **数据建议**：建立周进度通报机制，对滞后单元设置预警阈值。',
    ].filter(Boolean),
    {
      totalPipes: 0,
      totalRecords: records.length,
      totalFacilities: 0,
    },
  )
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
  const pending = itemRecords.filter((r) => r.status === 'pending').length
  const numericValues = itemRecords
    .map((r) => r.measured_value)
    .filter((v): v is number => typeof v === 'number')
  const avg = numericValues.length ? numericValues.reduce((s, v) => s + v, 0) / numericValues.length : 0
  const max = numericValues.length ? Math.max(...numericValues) : 0
  const min = numericValues.length ? Math.min(...numericValues) : 0
  const std = numericValues.length > 1 ?
    Math.sqrt(numericValues.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / (numericValues.length - 1)) : 0

  const communityDisplay = community === '全部' ? '南海家园 3 个小区' : community
  const byComm = groupCount(itemRecords, 'community')
  const byInspector = groupCount(itemRecords, 'inspector')

  return assembleReport(
    'inspection',
    `🔍 ${itemName}专项检测报告`,
    `${communityDisplay} ${itemName}详细数据分析`,
    community,
    `${communityDisplay}的 **${itemName}** 共 **${itemRecords.length}** 条记录，通过 **${passed}** 条（${itemRecords.length ? ((passed / itemRecords.length) * 100).toFixed(0) : 0}%），异常 **${exception}** 条${numericValues.length ? `。测量值范围 ${min.toFixed(3)} ~ ${max.toFixed(3)}，平均 ${avg.toFixed(3)}，标准差 ${std.toFixed(3)}` : ''}。${exception > 0 ? `存在异常情况，建议复核整改。` : '目前数据正常。'}`,
    [
      { label: '记录总数', value: itemRecords.length, unit: '条', color: '#409eff' },
      { label: '通过', value: passed, unit: '条', color: '#67c23a' },
      { label: '异常', value: exception, unit: '条', color: '#f56c6c' },
      { label: '待开始', value: pending, unit: '条', color: '#909399' },
      { label: '通过率', value: itemRecords.length ? ((passed / itemRecords.length) * 100).toFixed(0) + '%' : '0%', color: '#67c23a' },
      { label: '平均值', value: numericValues.length ? avg.toFixed(3) : '-', color: '#409eff' },
      { label: '最大值', value: numericValues.length ? max.toFixed(3) : '-', color: '#e6a23c' },
      { label: '最小值', value: numericValues.length ? min.toFixed(3) : '-', color: '#e6a23c' },
    ],
    [
      { title: '状态分布', type: 'pie', data: [
        { name: '通过', value: passed },
        { name: '异常', value: exception },
        { name: '待开始', value: pending },
      ].filter((x) => x.value > 0) },
      { title: '各小区记录数量', type: 'bar', data: byComm },
      { title: '测量值分布（按单元）', type: 'bar', data: numericValues.length > 0 ?
        itemRecords.slice(0, 20).map((r) => ({
          name: r.unit_name || `#${r.id}`,
          value: r.measured_value || 0,
        })) : [{ name: '无数据', value: 0 }] },
      { title: '各检测员记录数', type: 'bar', data: byInspector.sort((a, b) => b.value - a.value).slice(0, 10) },
    ],
    [
      { title: '详细记录', headers: ['单元', '小区', '状态', '测量值', '单位', '检测员', '检测时间', '备注'], rows: itemRecords.slice(0, 50).map((r) => ({
        单元: r.unit_name || '-',
        小区: r.community || '-',
        状态: r.status,
        测量值: r.measured_value !== undefined ? r.measured_value : '-',
        单位: r.unit || '-',
        检测员: r.inspector || '-',
        检测时间: r.inspection_date ? new Date(r.inspection_date).toLocaleDateString('zh-CN') : '-',
        备注: (r as any).result_summary || '-',
      })) },
    ],
    [
      exception === 0 ? '✅ **质量良好**：所有记录均通过或待开始，无异常情况。' :
        `⚠️ **异常提示**：共 **${exception}** 条异常（${((exception / itemRecords.length) * 100).toFixed(0)}%），建议逐一复核。`,
      numericValues.length > 1 ? `📊 **数值分析**：均值 ${avg.toFixed(3)}，标准差 ${std.toFixed(3)}，变异系数 ${((std / Math.abs(avg)) * 100).toFixed(0)}%${
        std / Math.abs(avg) > 0.3 ? '（变异较大，数据波动明显，建议关注）' : '（变异可控，数据稳定）' }。` : '',
      '🔄 **后续建议**：异常记录整改后重新检测，确保状态更新为 passed。',
    ].filter(Boolean),
    {
      totalPipes: 0,
      totalRecords: itemRecords.length,
      totalFacilities: 0,
    },
    itemCode,
  )
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

/* ============================================================
 * 针对性报告（focused）
 *
 * 用途：用户在智问里说"管线总长"这种问题后，点了"出报告"按钮，
 *      我们用这一次 query 的结果，包装成 1-2 页的针对性小报告。
 *
 * 设计原则：
 *   - 只讲当前问题，不夹杂其他数据
 *   - 章节尽量精简：摘要 → 关键指标 → 图表 → 详细数据 → 结论
 *   - 标题直接用用户问的问题
 *   - 文件名按 query 摘要生成
 * ============================================================ */
export interface FocusedReportInput {
  /** 用户的原始问题 */
  question: string
  /** QueryResult（来自 runQuery） */
  result: {
    text?: string
    table?: { headers: string[]; rows: Array<Record<string, any>> }
    chart?: { type: 'bar' | 'line' | 'pie'; title: string; xField?: string; yField?: string; data: Array<{ name: string; value: number }> }
    totalCount?: number
    mapCommunity?: string
    sql?: string
  }
  /** 数据范围（如"南海家园七里"） */
  community?: string
}

export function buildFocusedReport(input: FocusedReportInput): Report {
  const { question, result, community } = input
  const cleanQ = question.trim().replace(/[\\/:*?"<>|\n\r]/g, ' ').slice(0, 60)
  const communityLabel = community && community !== '全部' ? community : '全部小区'
  const totalCount = result.totalCount ?? result.table?.rows.length ?? 0

  // 摘要
  const summaryHtml = [
    `本报告针对您提出的问题：**"${cleanQ}"**，仅就该问题涉及的数据做集中分析。`,
    result.text ? `\n\n📌 **核心结论**：${stripMarkdown(result.text)}` : '',
    `\n\n📍 **数据范围**：${communityLabel}`,
    totalCount > 0 ? `\n📊 **数据规模**：${totalCount} 条记录` : '',
  ].filter(Boolean).join('')

  // 关键指标：从 chart 或 table 里提取前 4-6 个
  const kpiData = extractKpis(result)

  // 章节
  const sections: ReportSection[] = [
    { title: '一、报告摘要', type: 'summary', data: summaryHtml },
  ]

  if (kpiData.length > 0) {
    sections.push({
      title: '二、关键指标',
      type: 'kpi',
      data: kpiData,
    })
  }

  if (result.chart) {
    sections.push({
      title: '三、图表分析',
      type: 'chart',
      data: result.chart,
    })
  }

  if (result.table && result.table.rows.length > 0) {
    sections.push({
      title: result.chart ? '四、详细数据' : '三、详细数据',
      type: 'table',
      data: result.table,
    })
  }

  // 结论/分析
  const conclusion = buildConclusion(question, result, totalCount)
  sections.push({
    title: result.chart || result.table ? '五、分析与建议' : '三、分析与建议',
    type: 'text',
    data: conclusion,
  })

  // 直接构造 Report（不走 assembleReport，因为 assembleReport 要重新写章节序号）
  return {
    type: 'overview',  // 复用 ReportType 字段（暂时没有 'focused'，不影响展示）
    title: `📌 ${cleanQ}`,
    subtitle: `针对问题"${cleanQ}"的针对性分析 · ${communityLabel}`,
    generatedAt: nowString(),
    community: communityLabel,
    sections,
    meta: {
      totalPipes: 0,
      totalRecords: totalCount,
      totalFacilities: 0,
    },
  }
}

/** 从 query result 里抽 4-6 个 KPI 卡片 */
function extractKpis(result: FocusedReportInput['result']): Array<{ label: string; value: string; unit?: string; color: string }> {
  const kpis: Array<{ label: string; value: string; unit?: string; color: string }> = []

  // 1) 如果有 chart，挑最大/最小/总数
  if (result.chart && result.chart.data.length > 0) {
    const data = result.chart.data
    const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0)
    const max = data.reduce((m, d) => (d.value > m.value ? d : m), data[0])
    const min = data.reduce((m, d) => (d.value < m.value ? d : m), data[0])

    kpis.push({
      label: '数据组数',
      value: String(data.length),
      unit: '组',
      color: '#409eff',
    })
    kpis.push({
      label: '合计',
      value: formatNumber(total),
      unit: result.chart.yField === 'value' ? '' : '',
      color: '#67c23a',
    })
    if (data.length > 1) {
      kpis.push({
        label: `最大：${max.name}`.slice(0, 16),
        value: formatNumber(max.value),
        color: '#e6a23c',
      })
      kpis.push({
        label: `最小：${min.name}`.slice(0, 16),
        value: formatNumber(min.value),
        color: '#909399',
      })
    }
  }

  // 2) 如果有 table，统计行数
  if (result.table) {
    if (kpis.length === 0) {
      kpis.push({
        label: '返回行数',
        value: String(result.table.rows.length),
        unit: '行',
        color: '#409eff',
      })
    }
    // 找数值列算个平均
    const numCol = findFirstNumericColumn(result.table)
    if (numCol) {
      const values = result.table.rows.map((r) => Number(r[numCol])).filter((v) => !isNaN(v))
      if (values.length > 0) {
        const avg = values.reduce((s, v) => s + v, 0) / values.length
        const sum = values.reduce((s, v) => s + v, 0)
        kpis.push({
          label: `${numCol} 平均`,
          value: formatNumber(avg),
          color: '#9c64f0',
        })
        if (kpis.length < 6) {
          kpis.push({
            label: `${numCol} 合计`,
            value: formatNumber(sum),
            color: '#67c23a',
          })
        }
      }
    }
  }

  // 3) totalCount
  if (result.totalCount !== undefined && kpis.length < 6) {
    kpis.push({
      label: '记录数',
      value: String(result.totalCount),
      unit: '条',
      color: '#409eff',
    })
  }

  return kpis.slice(0, 6)
}

function findFirstNumericColumn(table: NonNullable<FocusedReportInput['result']['table']>): string | null {
  for (const h of table.headers) {
    const v = table.rows.find((r) => r[h] !== undefined && r[h] !== null && r[h] !== '')?.[h]
    if (typeof v === 'number' || (!isNaN(parseFloat(String(v))) && String(v).trim() !== '')) {
      return h
    }
  }
  return null
}

function buildConclusion(question: string, result: FocusedReportInput['result'], totalCount: number): string {
  const q = question.toLowerCase()
  const parts: string[] = []

  if (totalCount === 0) {
    parts.push('⚠️ **数据为空**：当前查询条件下未匹配到任何数据。')
    parts.push('建议：')
    parts.push('- 检查小区名称是否正确（如"七里"、"三里"）')
    parts.push('- 放宽过滤条件（去掉管径/压力/材质等）')
    parts.push('- 在右上角 ⚙ 开启 LLM 兜底')
  } else {
    if (result.chart && result.chart.data.length > 0) {
      const data = result.chart.data
      const top = data.slice().sort((a, b) => b.value - a.value).slice(0, 3)
      parts.push(`✅ **数据概览**：共 ${totalCount} 条记录，关键维度 TOP 3：`)
      top.forEach((d, i) => parts.push(`${i + 1}. ${d.name}：**${formatNumber(d.value)}**`))
    } else if (result.table) {
      parts.push(`✅ **数据概览**：本次查询返回 ${result.table.rows.length} 条记录。`)
    }
    parts.push('')
    parts.push('💡 **后续建议**：')
    parts.push('- 如需调整范围（小区、压力、材质等），直接重新提问即可')
    parts.push('- 切换到「报告中心」可对比多种类型的深度报告')
    parts.push('- 点击工具栏「下载 PDF」可保存为 A4 文档')
  }

  return parts.join('\n')
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\n+/g, ' ')
    .slice(0, 200)
}

function formatNumber(n: number): string {
  if (!isFinite(n)) return '—'
  if (Math.abs(n) >= 10000) return (n / 10000).toFixed(2) + 'w'
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(2)
}

export const REPORT_TYPES: Array<{
  type: ReportType
  icon: string
  title: string
  desc: string
  color: string
  needsItemCode?: boolean
}> = [
  { type: 'overview', icon: '📊', title: '综合概览报告', desc: '全小区管网+检测+进度的总体概览', color: '#409eff' },
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
