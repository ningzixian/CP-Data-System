/**
 * 智问 NLQ 引擎 — 纯前端规则式自然语言 → 结构化查询 → 结果
 *
 * 输入：用户中文问句
 * 输出：{
 *   text: 自然语言回答,
 *   table?: 二维数组,
 *   chart?: { type, data: [{ name, value }] },
 *   mapFocus?: { dataset, filter },
 *   sql?: 结构化中间表示（调试用）,
 * }
 *
 * 数据源（zhiwenData 注入）：
 *   - pipes: 低压管线
 *   - inlets: 引入口
 *   - controls: 控制单元
 *   - joints: 绝缘接头
 *   - regulators: 调压箱
 *   - units: 腐控单元（CP检测）
 *   - records: 检测记录
 *
 * 支持的查询模式（示例）：
 *   - "七里DN100以上管线总长"
 *   - "各小区管径分布"
 *   - "三里调压箱数量"
 *   - "低压管线材质分布"
 *   - "管地电位平均值"
 *   - "异常检测记录"
 *   - "进度异常的小区"
 */

export interface PipeRow {
  community: string       // 七里/三里/六里
  fid: number
  coords: Array<[number, number]>
  pipeno: string
  pressured: string       // 压力等级
  pressurer?: string
  material: string
  diametero: string       // 外径 mm
  thickness: string
  length: string          // 米
  /** 建设年代（来自物探数据） */
  build_year?: string
  /** 数据来源：'gis' | 'topology' */
  source?: 'gis' | 'topology'
  /** 埋设类型（直埋/非开挖/管沟） */
  bury_type?: string
  /** 权属单位 */
  owner?: string
}

export interface PointRow {
  community: string
  fid: number
  lng: number
  lat: number
  ecode?: string
  name?: string
  type?: string           // 调压箱/绝缘接头/引入口/控制单元
  pressured?: string
  pipeno?: string
}

export interface UnitRow {
  id: number
  pipeline_id: number
  name: string
  community: string
  address?: string
  lng?: number
  lat?: number
  inspection_progress: number
  inspection_status: string
}

export interface RecordRow {
  id: number
  unit_id: number
  unit_name?: string
  community?: string
  item_code: string
  item_name: string
  status: 'pending' | 'passed' | 'exception'
  measured_value?: number
  unit?: string
  inspector?: string
  inspection_date?: string
  result_data?: Record<string, any>
}

export interface ZhiwenData {
  pipes: PipeRow[]
  inlets: PointRow[]
  controls: PointRow[]
  joints: PointRow[]
  regulators: PointRow[]
  units: UnitRow[]
  records: RecordRow[]
  communities: string[]
  /** 物探拓扑数据（原始 LINE/POINT 表） */
  topology?: {
    rawLines: any[]
    rawPoints: any[]
    source: string
  } | null
}

export interface ChartSpec {
  type: 'pie' | 'bar' | 'line'
  title: string
  xField?: string
  yField?: string
  data: Array<{ name: string; value: number; [k: string]: any }>
}

export interface QueryResult {
  text: string                         // 自然语言回答
  table?: { headers: string[]; rows: Array<Record<string, any>> }  // 表格
  chart?: ChartSpec                    // 图表
  mapDataset?: 'pipes' | 'inlets' | 'controls' | 'joints' | 'regulators'  // 高亮地图
  mapCommunity?: string
  /** 地图聚焦模式：
   *  - filtered: 只高亮当前过滤后的设施
   *  - all:      显示所有同类设施（当前匹配的高亮，其他淡化）
   *  - context:  显示当前匹配 + 周边作为参考
   */
  mapFocus?: 'filtered' | 'all' | 'context'
  /** 地图高亮颜色（可选） */
  mapHighlight?: string
  /** 地图额外叠加层（用于非空间数据集时的设施展示） */
  mapOverlay?: Array<{ lng: number; lat: number; type: string; name: string; community: string; status?: string }>
  /** 报告（当 isReport=true 时，由 ZhiwenPage 渲染 ReportPreview） */
  isReport?: boolean
  report?: any  // Report 类型（避免循环依赖）
  reportOptions?: { community?: string; itemCode?: string }
  sql: string                          // 中间表示（给用户看"我理解成什么了"）
  totalCount?: number
}

// ============== 字典 / 词典 ==============

const COMMUNITY_SYNONYMS: Record<string, string> = {
  '七里': '南海家园七里', 'qili': '南海家园七里', 'ql': '南海家园七里',
  '三里': '南海家园三里', 'sanli': '南海家园三里', 'sl': '南海家园三里',
  '六里': '南海家园六里', 'liuli': '南海家园六里', 'll': '南海家园六里',
}

const DATASET_KEYWORDS: Record<string, RegExp> = {
  pipes: /管线|管道|低压管|管网/,
  inlets: /引入口/,
  controls: /控制单元|控制区/,
  joints: /绝缘接头|接头/,
  regulators: /调压箱|调压器/,
  units: /腐控单元|控制段/,
  records: /检测|记录|检测项|管地电位|土壤电阻率|杂散电流|防腐层|涂层|绝缘电阻|电联通|联通性/,
}

const PRESSURE_KEYWORDS: Record<string, RegExp> = {
  '中压A 0.2<P<=0.4MPa': /中压A|中压A\s*0\.2/,
  '中压B 0.01<P<=0.2MPa': /中压B/,
  '低压 P<=0.01MPa': /低压/,
}

const MATERIAL_KEYWORDS: Record<string, RegExp> = {
  '钢管': /钢管|钢制/,
  'PE管': /PE管|PE\s*管|聚乙烯/,
}

// ============== 工具 ==============

function toNumber(v: any): number {
  if (v === null || v === undefined || v === '') return 0
  const n = parseFloat(String(v))
  return isNaN(n) ? 0 : n
}

function matchCommunity(text: string): string | null {
  for (const k of Object.keys(COMMUNITY_SYNONYMS)) {
    if (text.includes(k)) return COMMUNITY_SYNONYMS[k]
  }
  return null
}

function matchDataset(text: string): string {
  for (const k of Object.keys(DATASET_KEYWORDS)) {
    if (DATASET_KEYWORDS[k].test(text)) return k
  }
  return 'pipes'  // 默认
}

function matchPressure(text: string): string | null {
  for (const p of Object.keys(PRESSURE_KEYWORDS)) {
    if (PRESSURE_KEYWORDS[p].test(text)) return p
  }
  return null
}

function matchMaterial(text: string): string | null {
  for (const m of Object.keys(MATERIAL_KEYWORDS)) {
    if (MATERIAL_KEYWORDS[m].test(text)) return m
  }
  return null
}

function matchDiameterThreshold(text: string): { op: '>' | '<' | '>=' | '<=' | '='; value: number } | null {
  // DN100 / DN100以上 / 大于DN100
  const dn = text.match(/DN\s*(\d+)/i)
  const num = text.match(/(\d+)\s*mm/)
  const value = dn ? parseInt(dn[1]) : num ? parseInt(num[1]) : null
  if (value === null) return null
  if (/(以上|大于|超过|>=|>|不小于)/.test(text)) return { op: '>=', value }
  if (/(以下|小于|不超过|<=|<|不大于)/.test(text)) return { op: '<=', value }
  return { op: '=', value }
}

/** 匹配长度阈值（"18m以上" / "大于20米" / "长度>50m"） */
function matchLengthThreshold(text: string): { op: '>=' | '<=' | '='; value: number } | null {
  // 优先匹配 m/米 单位（避免与 mm 冲突）
  // 模式：数字 + 可选空格 + m|米
  const m = text.match(/(\d+(?:\.\d+)?)\s*(?:m|米)(?!\w)/i)
  if (!m) return null
  const value = parseFloat(m[1])
  if (isNaN(value) || value <= 0) return null
  // 必须有比较词才算阈值
  if (/(以上|大于|超过|>=|>|不小于|长于|更长)/.test(text)) return { op: '>=', value }
  if (/(以下|小于|不超过|<=|<|不大于|短于|更短)/.test(text)) return { op: '<=', value }
  return { op: '>=', value }  // 默认"X米"按以上处理
}

function isCountIntent(text: string) {
  return /多少|数量|几条|几段|几个|几口|几座|几台|几条|几根|count|num|一共.{0,3}(条|个|段|座|根|口|台)|总共|共计|共有/i.test(text)
}

function isSumIntent(text: string) {
  return /总长|总长度|总米数|合计|总.+是多少|求和|sum/i.test(text)
}

function isAvgIntent(text: string) {
  return /平均|均值|avg|mean/i.test(text)
}

function isMaxMinIntent(text: string): 'max' | 'min' | null {
  if (/最长|最大|最多|最高|最重|max/i.test(text)) return 'max'
  if (/最短|最小|最少|最低|最轻|min/i.test(text)) return 'min'
  return null
}

function isGroupByIntent(text: string) {
  return /分布|对比|按.+分组|按.+统计|各.+的|每.+的|group/i.test(text) || /(分布|对比)/.test(text)
}

function isListIntent(text: string) {
  return /列出|显示|有哪些|哪些|list|展示/i.test(text)
}

function isExceptionIntent(text: string) {
  return /异常|不合格|未通过|exception|警告|告警/i.test(text)
}

function isProgressIntent(text: string) {
  return /进度|完成率|完成度|进度异常|未完成/i.test(text)
}

function isMapIntent(text: string) {
  return /地图|位置|在哪|定位|map|看地图|画在地图/i.test(text)
}

function matchSource(text: string): 'topology' | 'gis' | null {
  if (/物探|拓扑|TQ_LINE|TQ_POINT/i.test(text)) return 'topology'
  if (/GIS|原 GIS|原始 GIS/i.test(text)) return 'gis'
  return null
}

function matchBuildYear(text: string): { op: '>=' | '<=' | '=' | '<' | '>'; value: number } | null {
  // "2010年前" / "2012年以后" / "2015年" / "2000到2010年"
  const m = text.match(/(\d{4})\s*年/)
  if (!m) return null
  const y = parseInt(m[1])
  if (/(以前|之前|以前|以前|之前|前)/.test(text)) return { op: '<', value: y }
  if (/(以后|之后|以来|后)/.test(text)) return { op: '>=', value: y }
  return { op: '=', value: y }
}

function findGroupByField(text: string, dataset: string): string | null {
  // 字段别名映射
  const fieldSynonyms: Record<string, string> = {
    '压力': 'pressured',
    '压力等级': 'pressured',
    '材质': 'material',
    '材料': 'material',
    '管径': 'diametero',
    '外径': 'diametero',
    '直径': 'diametero',
    '小区': 'community',
    '区域': 'community',
    '状态': 'status',
    '检测项': 'item_code',
    '检测员': 'inspector',
    '进度': 'inspection_status',
    '建设年代': 'build_year',
    '年代': 'build_year',
    '建成年份': 'build_year',
    '埋设类型': 'bury_type',
    '权属': 'owner',
    '权属单位': 'owner',
    '来源': 'source',
    '数据源': 'source',
  }
  for (const [alias, field] of Object.entries(fieldSynonyms)) {
    if (text.includes(alias)) return field
  }
  return null
}

// ============== 过滤器构造 ==============

function buildFilters(text: string, dataset: string, data: ZhiwenData) {
  const filters: Array<(row: any) => boolean> = []
  const sqlParts: string[] = []

  const community = matchCommunity(text)
  if (community) {
    filters.push((r) => r.community === community)
    sqlParts.push(`小区 = ${community}`)
  }

  if (dataset === 'pipes' || dataset === 'inlets' || dataset === 'joints' || dataset === 'regulators') {
    const pressure = matchPressure(text)
    if (pressure) {
      filters.push((r) => r.pressured === pressure)
      sqlParts.push(`压力 = ${pressure}`)
    }
    if (dataset === 'pipes') {
      const material = matchMaterial(text)
      if (material) {
        filters.push((r) => r.material === material)
        sqlParts.push(`材质 = ${material}`)
      }
      const dn = matchDiameterThreshold(text)
      if (dn) {
        const target = dn.value
        if (dn.op === '>=') {
          filters.push((r) => toNumber(r.diametero) >= target)
          sqlParts.push(`管径 >= ${target}mm`)
        } else if (dn.op === '<=') {
          filters.push((r) => toNumber(r.diametero) <= target)
          sqlParts.push(`管径 <= ${target}mm`)
        } else {
          filters.push((r) => toNumber(r.diametero) === target)
          sqlParts.push(`管径 = ${target}mm`)
        }
      }
      // 长度阈值（"18m以上" / "大于20米"）
      const len = matchLengthThreshold(text)
      if (len) {
        const target = len.value
        if (len.op === '>=') {
          filters.push((r) => toNumber(r.length) >= target)
          sqlParts.push(`长度 >= ${target}m`)
        } else if (len.op === '<=') {
          filters.push((r) => toNumber(r.length) <= target)
          sqlParts.push(`长度 <= ${target}m`)
        } else {
          filters.push((r) => toNumber(r.length) === target)
          sqlParts.push(`长度 = ${target}m`)
        }
      }
      // 建设年代（"2012年" / "2010年前" / "2000年以后"）
      const year = matchBuildYear(text)
      if (year) {
        filters.push((r) => {
          if (!r.build_year) return false  // 无建设年代信息的不参与
          const y = parseInt(r.build_year)
          if (isNaN(y)) return false
          if (year.op === '>=') return y >= year.value
          if (year.op === '<=') return y <= year.value
          if (year.op === '<') return y < year.value
          if (year.op === '>') return y > year.value
          return y === year.value
        })
        sqlParts.push(`建设年代 ${year.op === '<' ? '<' : year.op === '>' ? '>' : year.op} ${year.value}`)
      }
      // 数据来源（"物探" / "GIS"）
      const source = matchSource(text)
      if (source) {
        filters.push((r) => r.source === source)
        sqlParts.push(`数据源 = ${source === 'topology' ? '物探' : 'GIS'}`)
      }
    }
  }

  if (dataset === 'records' || dataset === 'units') {
    if (isExceptionIntent(text)) {
      filters.push((r) => r.status === 'exception' || r.inspection_status === 'exception')
      sqlParts.push(`状态 = 异常`)
    } else if (/未完成|未开始|待/.test(text)) {
      filters.push((r) => r.status === 'pending' || r.inspection_status === 'pending')
      sqlParts.push(`状态 = 待开始`)
    } else if (/进行中/.test(text)) {
      filters.push((r) => r.inspection_status === 'in_progress')
      sqlParts.push(`状态 = 进行中`)
    } else if (/已完成|合格|通过/.test(text)) {
      filters.push((r) => r.status === 'passed')
      sqlParts.push(`状态 = 通过`)
    }
    if (/管地电位|电位/.test(text)) {
      filters.push((r) => r.item_code === 'PIPE_GROUND_POTENTIAL')
      sqlParts.push(`检测项 = 管地电位`)
    } else if (/土壤电阻率|电阻率/.test(text)) {
      filters.push((r) => r.item_code === 'SOIL_RESISTIVITY')
      sqlParts.push(`检测项 = 土壤电阻率`)
    } else if (/杂散电流/.test(text)) {
      filters.push((r) => r.item_code === 'DC_STRAY_CURRENT')
      sqlParts.push(`检测项 = 直流杂散电流`)
    } else if (/防腐层|涂层/.test(text)) {
      filters.push((r) => r.item_code === 'COATING_DETECT')
      sqlParts.push(`检测项 = 防腐层检测`)
    } else if (/绝缘接头|绝缘电阻/.test(text)) {
      filters.push((r) => r.item_code === 'JOINT_VERIFY')
      sqlParts.push(`检测项 = 绝缘接头`)
    } else if (/电联通|联通性/.test(text)) {
      filters.push((r) => r.item_code === 'ELECTRIC_CONTINUITY')
      sqlParts.push(`检测项 = 电联通性`)
    } else if (/引入口/.test(text)) {
      filters.push((r) => r.item_code === 'INLET_PARAM')
      sqlParts.push(`检测项 = 引入口参数`)
    }
  }

  return { filters, sqlParts }
}

function applyFilters<T>(rows: T[], filters: Array<(r: any) => boolean>): T[] {
  return rows.filter((r) => filters.every((f) => f(r)))
}

// ============== 主入口 ==============

/**
 * 评估规则引擎的置信度（0~1）
 * 命中越多维度越高。>= 0.3 走规则，< 0.3 走 LLM 兜底
 */
export function scoreConfidence(text: string): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 0
  if (matchDataset(text)) { score += 0.3; reasons.push('数据集') }
  if (matchCommunity(text)) { score += 0.1; reasons.push('小区') }
  if (matchPressure(text)) { score += 0.1; reasons.push('压力') }
  if (matchMaterial(text)) { score += 0.1; reasons.push('材质') }
  if (matchDiameterThreshold(text)) { score += 0.15; reasons.push('管径') }
  if (isCountIntent(text) || isSumIntent(text) || isAvgIntent(text) || isMaxMinIntent(text)) {
    score += 0.3; reasons.push('聚合')
  }
  if (isGroupByIntent(text)) { score += 0.2; reasons.push('分组') }
  if (isExceptionIntent(text) || /待开始|进行中|通过/.test(text)) {
    score += 0.15; reasons.push('状态')
  }
  // 检测项关键词（管地电位等）
  if (/管地电位|土壤电阻率|杂散电流|防腐层|涂层|绝缘|电联通|引入口参数/.test(text)) {
    score += 0.3; reasons.push('检测项')
  }
  if (isMapIntent(text)) { score += 0.2; reasons.push('地图') }
  if (isListIntent(text)) { score += 0.15; reasons.push('列表') }
  return { score: Math.min(score, 1), reasons }
}

// ============== LLM 兜底：把 JSON 计划转成 QueryResult ==============

export interface LLMQueryPlan {
  dataset?: 'pipes' | 'inlets' | 'controls' | 'joints' | 'regulators' | 'units' | 'records'
  filters?: {
    community?: string | null
    pressured?: string | null
    material?: string | null
    diametero?: { '>='?: number; '<='?: number; '>'?: number; '<'?: number; '='?: number } | null
    status?: 'passed' | 'exception' | 'pending' | null
    item_code?: string | null
    inspection_status?: 'pending' | 'in_progress' | 'completed' | 'exception' | null
  }
  agg?: 'count' | 'sum' | 'avg' | 'max' | 'min' | 'list' | 'group' | null
  groupBy?: string | null
  /** LLM 给出的自然语言回答思路（不保证数值正确，我们用引擎算真实值覆盖） */
  answer?: string
}

const ITEM_CODE_MAP: Record<string, string> = {
  '管地电位': 'PIPE_GROUND_POTENTIAL',
  '土壤电阻率': 'SOIL_RESISTIVITY',
  '杂散电流': 'DC_STRAY_CURRENT',
  '防腐层': 'COATING_DETECT',
  '涂层': 'COATING_DETECT',
  '绝缘接头': 'JOINT_VERIFY',
  '绝缘电阻': 'JOINT_VERIFY',
  '电联通': 'ELECTRIC_CONTINUITY',
  '联通性': 'ELECTRIC_CONTINUITY',
  '引入口参数': 'INLET_PARAM',
}

/** 把 LLM 的 JSON 计划转成 queryText，再让 runQuery 执行一遍 */
export function planToText(plan: LLMQueryPlan): string {
  const parts: string[] = []
  const f = plan.filters || {}
  if (f.community) parts.push(f.community)
  if (f.pressured) parts.push(f.pressured)
  if (f.material) parts.push(f.material)
  if (f.diametero) {
    const op = Object.keys(f.diametero)[0] as any
    const v = (f.diametero as any)[op]
    parts.push(`DN${v}${op === '>=' ? '以上' : op === '<=' ? '以下' : op === '>' ? '大于' : op === '<' ? '小于' : ''}`)
  }
  if (f.item_code) parts.push(f.item_code)
  if (f.status === 'exception') parts.push('异常')
  if (f.status === 'pending') parts.push('待开始')
  if (f.status === 'passed') parts.push('通过')
  if (f.inspection_status === 'in_progress') parts.push('进行中')

  // 数据集关键词
  const dsMap: Record<string, string> = {
    pipes: '管线', inlets: '引入口', controls: '控制单元',
    joints: '绝缘接头', regulators: '调压箱', units: '腐控单元', records: '检测记录',
  }
  if (plan.dataset) parts.push(dsMap[plan.dataset])

  // 聚合
  const aggMap: Record<string, string> = {
    count: '多少', sum: '总长度', avg: '平均', max: '最大', min: '最小', group: '分布', list: '列出',
  }
  if (plan.agg && aggMap[plan.agg]) parts.unshift(aggMap[plan.agg])

  if (plan.groupBy) parts.push(`按${plan.groupBy}分布`)

  return parts.join(' ') || plan.answer || '查询'
}

/** 根据 LLM 给的 plan 重新生成 SQL 字符串描述 */
export function planToSql(plan: LLMQueryPlan, result: QueryResult): string {
  const dsLabel = {
    pipes: '管线', inlets: '引入口', controls: '控制单元',
    joints: '绝缘接头', regulators: '调压箱', units: '腐控单元', records: '检测记录',
  }[plan.dataset || 'pipes'] || plan.dataset

  const f = plan.filters || {}
  const parts: string[] = []
  if (f.community) parts.push(`小区=${f.community}`)
  if (f.pressured) parts.push(`压力=${f.pressured}`)
  if (f.material) parts.push(`材质=${f.material}`)
  if (f.diametero) {
    const op = Object.keys(f.diametero)[0]
    parts.push(`管径${op}${(f.diametero as any)[op]}`)
  }
  if (f.item_code) parts.push(`检测项=${f.item_code}`)
  if (f.status) parts.push(`状态=${f.status}`)
  if (plan.groupBy) parts.push(`GROUP BY ${plan.groupBy}`)
  if (plan.agg) parts.push(`AGG=${plan.agg}`)
  if (plan.answer) parts.push(`[LLM思路] ${plan.answer}`)
  return `数据源: ${dsLabel} (${parts.join('，') || '全部'}) | LLM 兜底解析`
}

/** LLM system prompt：把 schema 告诉模型，让它输出结构化 JSON */
export function buildLLMPrompt(userQuery: string, data: ZhiwenData): { system: string; user: string } {
  const overview = {
    pipes: data.pipes.length,
    inlets: data.inlets.length,
    controls: data.controls.length,
    joints: data.joints.length,
    regulators: data.regulators.length,
    units: data.units.length,
    records: data.records.length,
  }
  const communityBreakdown = ['pipes', 'inlets', 'joints', 'regulators', 'controls'].map((k) => {
    const counts: Record<string, number> = {}
    ;(data as any)[k].forEach((r: any) => {
      counts[r.community] = (counts[r.community] || 0) + 1
    })
    return `${k}: ${JSON.stringify(counts)}`
  }).join('\n  ')

  const system = `你是数据查询助手。用户用中文问关于燃气管网/阴极保护数据的问题，你需要把问题转成结构化 JSON 查询计划。

# 可用数据集 (dataset 字段)
- pipes: 低压管线，字段 community(小区), pressured(压力等级), material(材质), diametero(管径mm), length(长度m), pipeno
- inlets: 引入口，字段 community, lng, lat
- controls: 控制单元，字段 community
- joints: 绝缘接头，字段 community
- regulators: 调压箱，字段 community, lng, lat
- units: 腐控单元，字段 name, community, inspection_progress(0-1), inspection_status(pending/in_progress/completed/exception)
- records: 检测记录，字段 item_code, item_name, status(passed/exception/pending), measured_value, unit, community

# item_code 映射
- 管地电位 → PIPE_GROUND_POTENTIAL
- 土壤电阻率 → SOIL_RESISTIVITY
- 杂散电流 → DC_STRAY_CURRENT
- 防腐层 → COATING_DETECT
- 绝缘接头/绝缘电阻 → JOINT_VERIFY
- 电联通 → ELECTRIC_CONTINUITY
- 引入口参数 → INLET_PARAM

# 小区名称（community 字段）
- "南海家园七里"（七里/QL）
- "南海家园三里"（三里/SL）
- "南海家园六里"（六里/LL）

# 压力等级 pressured 字段值
- "低压 P<=0.01MPa"
- "中压A 0.2<P<=0.4MPa"
- "中压B 0.01<P<=0.2MPa"

# agg 字段取值
- count: 数量
- sum: 求和（管线长度）
- avg/max/min: 聚合数值
- group: 分组统计
- list: 列出
- null: 不指定，让前端自动选择

# groupBy 字段取值
pipes 可用: pressured, material, diametero, community
records 可用: item_code, status, inspector, community
units 可用: inspection_status, community

只输出 JSON，不要解释，不要 markdown 代码块包裹。
格式：
{"dataset":"pipes","filters":{"community":"南海家园七里","diametero":{">=":100}},"agg":"sum","groupBy":null,"answer":"七里DN100以上管线总长"}`

  const user = `当前数据概览：
  pipes=${overview.pipes}, inlets=${overview.inlets}, controls=${overview.controls}, joints=${overview.joints}, regulators=${overview.regulators}, units=${overview.units}, records=${overview.records}

各小区分布：
  ${communityBreakdown}

用户问题：${userQuery}`

  return { system, user }
}

// ============== 报告请求解析 ==============

import { generateReport, REPORT_TYPES, ITEM_CODES, type ReportType, type ReportOptions, type Report } from './reportGenerator'

export interface ReportRequest {
  type: ReportType
  options: ReportOptions
  confidence: number
}

const REPORT_TYPE_ALIAS: Array<{ keywords: RegExp; type: ReportType }> = [
  { keywords: /综合概览|总览|概览|综合报告|整体|汇总/, type: 'overview' },
  { keywords: /异常报告|异常检测|异常明细|不合格|不通过/, type: 'exception' },
  { keywords: /物探|拓扑|TQ_LINE|TQ_POINT|建设年代|权属分布/, type: 'topology' },
  { keywords: /设施分布|设施报告|调压箱分布|引入口分布|接头分布/, type: 'facility' },
  { keywords: /进度报告|进度分析|完成率|完成情况|进度情况/, type: 'progress' },
]

const ITEM_CODE_ALIAS: Record<string, string> = {
  '管地电位': 'PIPE_GROUND_POTENTIAL',
  '土壤电阻率': 'SOIL_RESISTIVITY',
  '杂散电流': 'DC_STRAY_CURRENT',
  '防腐层': 'COATING_DETECT',
  '涂层': 'COATING_DETECT',
  '绝缘接头': 'JOINT_VERIFY',
  '绝缘电阻': 'JOINT_VERIFY',
  '电联通': 'ELECTRIC_CONTINUITY',
  '联通性': 'ELECTRIC_CONTINUITY',
  '引入口参数': 'INLET_PARAM',
}

const ITEM_CODE_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(ITEM_CODE_ALIAS).map(([k, v]) => [v, k]),
)

/** 识别自然语言里的"报告请求" */
export function parseReportRequest(text: string, _data: ZhiwenData): ReportRequest | null {
  // 0. 必须有"报告"或"概览/总览"等关键词
  const hasReport = /报告/.test(text)
  const hasOverview = /综合概览|总览|概览|整体|汇总|总结/.test(text)
  if (!hasReport && !hasOverview) return null

  // 1. 报告类型识别
  let type: ReportType | null = null
  for (const { keywords, type: t } of REPORT_TYPE_ALIAS) {
    if (keywords.test(text)) { type = t; break }
  }

  // 2. 专项检测：含"检测项名"且不是其他类型的关键词
  if (!type) {
    const itemMatch = text.match(/(管地电位|土壤电阻率|杂散电流|防腐层|涂层|绝缘接头|绝缘电阻|电联通|联通性|引入口参数)/)
    if (itemMatch) type = 'inspection'
  }

  // 3. 兜底：有"报告"或"概览"但没明确类型 → 综合概览
  if (!type) type = 'overview'

  // 4. 参数提取
  const community = matchCommunity(text) || '全部'
  const options: ReportOptions = { community }

  if (type === 'inspection') {
    const itemMatch = text.match(/(管地电位|土壤电阻率|杂散电流|防腐层|涂层|绝缘接头|绝缘电阻|电联通|联通性|引入口参数)/)
    if (itemMatch) {
      options.itemCode = ITEM_CODE_ALIAS[itemMatch[1]] || 'PIPE_GROUND_POTENTIAL'
    } else {
      options.itemCode = 'PIPE_GROUND_POTENTIAL'
    }
  }

  return { type, options, confidence: 0.9 }
}

/** 用户说"重新生成" / "再生成" / "重做" 时的处理 */
export function isRegenerateIntent(text: string): boolean {
  return /^(重新生成|再生成|重做|再来一次|重生成|重做一次|重新做|regenerate|again)$/i.test(text.trim())
}

export function runQuery(text: string, data: ZhiwenData): QueryResult {
  const q = text.trim()
  if (!q || q.length < 2) {
    return {
      text: '请输入您想问的问题，例如：七里DN100以上管线总长',
      sql: '',
      mapDataset: 'pipes',
      mapFocus: 'all',
    }
  }

  // 报告请求：直接生成报告
  const reportReq = parseReportRequest(q, data)
  if (reportReq) {
    const report: Report = generateReport(reportReq.type, data, reportReq.options)
    const typeInfo = REPORT_TYPES.find((r) => r.type === reportReq.type)
    return {
      text: `✅ 已为您生成【${typeInfo?.title}】\n\n${report.sections[0]?.data || ''}\n\n💡 如需调整小区/检测项/重新生成，请使用下方按钮。`,
      isReport: true,
      report,
      reportOptions: reportReq.options,
      sql: `报告类型: ${typeInfo?.title}\n数据范围: ${reportReq.options.community}${reportReq.options.itemCode ? `\n检测项: ${ITEM_CODE_REVERSE[reportReq.options.itemCode] || reportReq.options.itemCode}` : ''}\n章节数: ${report.sections.length}`,
      mapDataset: 'pipes',
      mapFocus: 'all',
    }
  }

  const dataset = matchDataset(q)
  const rawRows = (data as any)[dataset] || []
  const { filters, sqlParts } = buildFilters(q, dataset, data)
  const rows = applyFilters(rawRows, filters)

  const datasetLabel = {
    pipes: '管线', inlets: '引入口', controls: '控制单元',
    joints: '绝缘接头', regulators: '调压箱', units: '腐控单元', records: '检测记录',
  }[dataset] || dataset

  const filterDesc = sqlParts.length ? `（${sqlParts.join('，')}）` : '（全部）'
  let sql = `数据源: ${datasetLabel} ${filterDesc}`

  // 1) 数量类
  if (isCountIntent(q)) {
    sql += ` | 聚合: COUNT(*) = ${rows.length}`
    return {
      text: `${datasetLabel}${filterDesc}共 **${rows.length}** 条。`,
      totalCount: rows.length,
      table: dataset === 'pipes'
        ? { headers: ['PIPENO', '小区', '压力', '材质', '管径(mm)', '长度(m)'], rows: rows.slice(0, 50).map((r: any) => ({
            PIPENO: r.pipeno, 小区: r.community, 压力: r.pressured, 材质: r.material,
            '管径(mm)': r.diametero, '长度(m)': r.length,
          })) }
        : dataset === 'units' || dataset === 'records'
          ? { headers: ['名称', '小区', '状态', '进度/项'], rows: rows.slice(0, 50).map((r: any) => ({
              名称: r.name || r.item_name, 小区: r.community, 状态: r.status || r.inspection_status,
              '进度/项': r.inspection_progress ?? r.item_code,
            })) }
          : { headers: ['Fid', '小区', '压力'], rows: rows.slice(0, 50).map((r: any) => ({
              Fid: r.fid, 小区: r.community, 压力: r.pressured || '-',
            })) },
      mapDataset: (['pipes','inlets','controls','joints','regulators'] as readonly string[]).includes(dataset) ? (dataset as 'pipes' | 'inlets' | 'controls' | 'joints' | 'regulators') : undefined,
      mapCommunity: matchCommunity(q) || undefined,
      sql,
    }
  }

  // 2) 长度求和（管线专属）
  if (dataset === 'pipes' && (isSumIntent(q) || /总长|长度/.test(q))) {
    const typedRows: any[] = rows
    const total = typedRows.reduce((s: number, r: any) => s + toNumber(r.length), 0)
    const avg = typedRows.length ? total / typedRows.length : 0
    const max = typedRows.reduce((m: number, r: any) => Math.max(m, toNumber(r.length)), 0)
    sql += ` | 聚合: SUM(长度) = ${total.toFixed(2)}m, AVG = ${avg.toFixed(2)}m, MAX = ${max.toFixed(2)}m`
    return {
      text: `${datasetLabel}${filterDesc}共 **${typedRows.length}** 条，总长度 **${total.toFixed(2)} 米**（平均 ${avg.toFixed(2)} m/段，最长 ${max.toFixed(2)} m）。`,
      totalCount: typedRows.length,
      table: {
        headers: ['指标', '值'],
        rows: [
          { 指标: '段数', 值: typedRows.length },
          { 指标: '总长度(m)', 值: total.toFixed(2) },
          { 指标: '平均长度(m)', 值: avg.toFixed(2) },
          { 指标: '最长段(m)', 值: max.toFixed(2) },
        ],
      },
      chart: {
        type: 'bar',
        title: '各管径管线长度',
        xField: 'name',
        yField: 'value',
        data: sumByField(typedRows, 'diametero', 'length'),
      },
      mapDataset: 'pipes',
      mapCommunity: matchCommunity(q) || undefined,
      sql,
    }
  }

  // 3) 平均/最大/最小
  if (dataset === 'records' && (isAvgIntent(q) || isMaxMinIntent(q) || isSumIntent(q))) {
    const op = isMaxMinIntent(q)
    const numericRows: any[] = rows.filter((r: any) => r.measured_value !== undefined && r.measured_value !== null)
    const values: number[] = numericRows.map((r: any) => toNumber(r.measured_value))
    if (values.length === 0) {
      sql += ` | 聚合: 无可用数值`
      return {
        text: `${datasetLabel}${filterDesc}没有可聚合的测量值。`,
        sql,
      }
    }
    let v = 0
    let label = ''
    if (op === 'max') { v = Math.max(...values); label = '最大值' }
    else if (op === 'min') { v = Math.min(...values); label = '最小值' }
    else if (isSumIntent(q)) { v = values.reduce((s, x) => s + x, 0); label = '合计' }
    else { v = values.reduce((s: number, x: number) => s + x, 0) / values.length; label = '平均值' }
    sql += ` | 聚合: ${label}(测量值) = ${v.toFixed(3)}`
    return {
      text: `${datasetLabel}${filterDesc}共 **${numericRows.length}** 条有测量值的数据，**${label} = ${v.toFixed(3)}** ${(numericRows[0] as any)?.unit || ''}。`,
      totalCount: numericRows.length,
      table: {
        headers: ['指标', '值'],
        rows: [
          { 指标: '样本数', 值: numericRows.length },
          { 指标: `${label}${(numericRows[0] as any)?.unit ? '(' + (numericRows[0] as any).unit + ')' : ''}`, 值: v.toFixed(3) },
          { 指标: '最大', 值: Math.max(...values).toFixed(3) },
          { 指标: '最小', 值: Math.min(...values).toFixed(3) },
        ],
      },
      chart: numericRows.length > 1 ? {
        type: 'bar',
        title: '测量值分布',
        xField: 'name',
        yField: 'value',
        data: numericRows.slice(0, 20).map((r: any) => ({ name: r.unit_name || `#${r.id}`, value: toNumber(r.measured_value) })),
      } : undefined,
      sql,
    }
  }

  if (dataset === 'pipes' && (isAvgIntent(q) || isMaxMinIntent(q))) {
    const op = isMaxMinIntent(q)
    const values = rows.map((r: any) => toNumber(r.length))
    const v = op === 'max' ? Math.max(...values) : op === 'min' ? Math.min(...values) : values.reduce((s, x) => s + x, 0) / values.length
    const label = op === 'max' ? '最长' : op === 'min' ? '最短' : '平均'
    sql += ` | 聚合: ${label}(长度) = ${v.toFixed(2)}m`
    return {
      text: `${datasetLabel}${filterDesc}共 **${rows.length}** 段，${label}长度 **${v.toFixed(2)} 米**。`,
      totalCount: rows.length,
      chart: {
        type: 'bar',
        title: '管径 × 长度',
        xField: 'name',
        yField: 'value',
        data: sumByField(rows as any[], 'diametero', 'length'),
      },
      mapDataset: 'pipes',
      mapCommunity: matchCommunity(q) || undefined,
      sql,
    }
  }

  // 4) 进度统计（小区级）
  if (dataset === 'units' && isProgressIntent(q)) {
    const grouped = groupBy(rows as any[], 'community', (arr) => ({
      总数: arr.length,
      完成: arr.filter((u) => u.inspection_status === 'completed').length,
      进行中: arr.filter((u) => u.inspection_status === 'in_progress').length,
      异常: arr.filter((u) => u.inspection_status === 'exception').length,
      待开始: arr.filter((u) => u.inspection_status === 'pending').length,
    }))
    sql += ` | GROUP BY 小区`
    return {
      text: `各小区腐控单元进度概览。`,
      table: {
        headers: ['小区', '总数', '完成', '进行中', '异常', '待开始', '完成率'],
        rows: grouped.map((g) => ({
          小区: g.name, ...g.value, 完成率: g.value.总数 ? `${((g.value.完成 / g.value.总数) * 100).toFixed(0)}%` : '-',
        })),
      },
      chart: {
        type: 'bar',
        title: '各小区腐控单元状态',
        xField: 'name',
        yField: 'value',
        data: grouped.map((g) => ({ name: g.name, value: g.value.总数 })),
      },
      sql,
    }
  }

  // 5) 检测项统计
  if (dataset === 'records' && (isGroupByIntent(q) || /哪项|哪些项|异常项/.test(q))) {
    const grouped = groupBy(rows as any[], 'item_name', (arr) => ({
      总数: arr.length,
      通过: arr.filter((r) => r.status === 'passed').length,
      异常: arr.filter((r) => r.status === 'exception').length,
      待开始: arr.filter((r) => r.status === 'pending').length,
    }))
    sql += ` | GROUP BY 检测项`
    return {
      text: `检测项维度统计${filterDesc}。`,
      table: {
        headers: ['检测项', '总数', '通过', '异常', '待开始', '通过率'],
        rows: grouped.map((g) => ({
          检测项: g.name, ...g.value, 通过率: g.value.总数 ? `${((g.value.通过 / g.value.总数) * 100).toFixed(0)}%` : '-',
        })),
      },
      chart: {
        type: 'pie',
        title: '检测记录状态分布',
        xField: 'name',
        yField: 'value',
        data: [
          { name: '通过', value: rows.filter((r: any) => r.status === 'passed').length },
          { name: '异常', value: rows.filter((r: any) => r.status === 'exception').length },
          { name: '待开始', value: rows.filter((r: any) => r.status === 'pending').length },
        ],
      },
      sql,
    }
  }

  // 6) 通用 GROUP BY
  if (isGroupByIntent(q) || /分布/.test(q)) {
    const field = findGroupByField(q, dataset)
    if (field) {
      const grouped = groupBy(rows as any[], field, (arr) => arr.length)
      sql += ` | GROUP BY ${field}`
      const chartType = grouped.length > 8 ? 'bar' : 'pie'
      return {
        text: `按 ${field} 分布统计${filterDesc}。`,
        totalCount: rows.length,
        table: {
          headers: [field, '数量', '占比'],
          rows: grouped.map((g) => ({
            [field]: g.name,
            数量: g.value,
            占比: rows.length ? `${((g.value / rows.length) * 100).toFixed(1)}%` : '-',
          })),
        },
        chart: {
          type: chartType,
          title: `按 ${field} 分布`,
          xField: 'name',
          yField: 'value',
          data: grouped.map((g) => ({ name: g.name, value: g.value })),
        },
        mapDataset: (['pipes','inlets','controls','joints','regulators'] as readonly string[]).includes(dataset) ? (dataset as 'pipes' | 'inlets' | 'controls' | 'joints' | 'regulators') : undefined,
        mapCommunity: matchCommunity(q) || undefined,
        sql,
      }
    }
  }

  // 7) 列出
  if (isListIntent(q) || dataset === 'pipes' || dataset === 'units') {
    sql += ` | 操作: LIST`
    return {
      text: `${datasetLabel}${filterDesc}共 **${rows.length}** 条，展示前 50 条。`,
      totalCount: rows.length,
      table: dataset === 'pipes'
        ? { headers: ['PIPENO', '小区', '压力', '材质', '管径(mm)', '长度(m)'], rows: rows.slice(0, 50).map((r: any) => ({
            PIPENO: r.pipeno, 小区: r.community, 压力: r.pressured, 材质: r.material,
            '管径(mm)': r.diametero, '长度(m)': r.length,
          })) }
        : dataset === 'units'
          ? { headers: ['名称', '小区', '状态', '进度'], rows: rows.slice(0, 50).map((r: any) => ({
              名称: r.name, 小区: r.community, 状态: r.inspection_status, 进度: `${(r.inspection_progress * 100).toFixed(0)}%`,
            })) }
          : dataset === 'records'
            ? { headers: ['检测项', '单元', '状态', '测量值', '检测员'], rows: rows.slice(0, 50).map((r: any) => ({
                检测项: r.item_name, 单元: r.unit_name, 状态: r.status, 测量值: r.measured_value, 检测员: r.inspector,
              })) }
            : { headers: ['Fid', '小区', '经度', '纬度'], rows: rows.slice(0, 50).map((r: any) => ({
                Fid: r.fid, 小区: r.community, 经度: r.lng, 纬度: r.lat,
              })) },
      mapDataset: (['pipes','inlets','controls','joints','regulators'] as readonly string[]).includes(dataset) ? (dataset as 'pipes' | 'inlets' | 'controls' | 'joints' | 'regulators') : undefined,
      mapCommunity: matchCommunity(q) || undefined,
      sql,
    }
  }

  // 默认 fallback：有过滤条件就展示表 + 状态饼图
  if (sqlParts.length > 0 && (dataset === 'records' || dataset === 'units' || dataset === 'pipes')) {
    sql += ` | 操作: DEFAULT-LIST`
    if (dataset === 'records') {
      return {
        text: `已为您筛选${datasetLabel}${filterDesc}，共 **${rows.length}** 条。`,
        totalCount: rows.length,
        table: {
          headers: ['检测项', '单元', '状态', '测量值', '检测员'],
          rows: rows.slice(0, 50).map((r: any) => ({
            检测项: r.item_name, 单元: r.unit_name, 状态: r.status, 测量值: r.measured_value, 检测员: r.inspector,
          })),
        },
        chart: rows.length > 0 ? {
          type: 'pie',
          title: '状态分布',
          data: [
            { name: '通过', value: rows.filter((r: any) => r.status === 'passed').length },
            { name: '异常', value: rows.filter((r: any) => r.status === 'exception').length },
            { name: '待开始', value: rows.filter((r: any) => r.status === 'pending').length },
          ].filter((x) => x.value > 0),
        } : undefined,
        sql,
      }
    }
  }
  sql += ` | 操作: DEFAULT`
  return {
    text: `已为您筛选${datasetLabel}${filterDesc}，共 **${rows.length}** 条。试试加 "总长"、"多少"、"分布"、"按材质"、"异常" 等关键词。`,
    totalCount: rows.length,
    sql,
  }
}

// ============== 辅助：分组聚合 ==============

function groupBy<T>(rows: T[], field: string, agg: (arr: T[]) => number | Record<string, number>): Array<{ name: string; value: any }> {
  const map = new Map<string, T[]>()
  for (const r of rows) {
    const key = String((r as any)[field] ?? '(空)')
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(r)
  }
  return Array.from(map.entries()).map(([name, arr]) => ({ name, value: agg(arr) }))
}

function sumByField(rows: any[], groupField: string, sumField: string): Array<{ name: string; value: number }> {
  return groupBy(rows, groupField, (arr) =>
    arr.reduce((s, r) => s + toNumber(r[sumField]), 0)
  ) as any
}

// ============== 预设查询（快捷命令面板）==============

export const PRESET_QUERIES: Array<{ label: string; query: string; tag: string }> = [
  { tag: '管网', label: '📊 各小区管线总长对比', query: '各小区管线总长度' },
  { tag: '管网', label: '🥧 各压力等级管线分布', query: '管线压力分布' },
  { tag: '管网', label: '🥧 各材质管线分布', query: '管线材质分布' },
  { tag: '管网', label: '📏 七里DN100以上管线总长', query: '七里DN100以上管线总长' },
  { tag: '管网', label: '📏 三里低压管线数量', query: '三里低压管线有多少' },
  { tag: '管网', label: '📏 大于18米的管线有几条', query: '管线大于18米大一共有几条' },
  { tag: '管网', label: '📏 七里50米以上管线', query: '七里管线长度大于50米有几条' },
  { tag: '管网', label: '🏭 各小区调压箱数量', query: '各小区调压箱数量' },
  { tag: '管网', label: '🔌 各小区引入口数量', query: '各小区引入口数量' },
  { tag: '管网', label: '🔩 七里最长的10条管线', query: '七里管线最长' },
  { tag: '管网', label: '🏗️ 各建设年代管线分布', query: '管线建设年代分布' },
  { tag: '管网', label: '🏗️ 七里2012年建设的管线', query: '七里2012年的管线有多少' },
  { tag: '管网', label: '🏗️ 2010年以前建设的管线', query: '2010年以前建设的管线' },
  { tag: '管网', label: '🏗️ 各权属单位管线数量', query: '管线权属分布' },
  { tag: '管网', label: '🏗️ 各埋设类型分布', query: '管线埋设类型分布' },
  { tag: '管网', label: '🏗️ 物探数据来源管线', query: '物探数据来源管线有多少' },
  { tag: '检测', label: '⚠️ 全部异常检测记录', query: '异常检测记录' },
  { tag: '检测', label: '📈 各检测项状态分布', query: '检测项分布' },
  { tag: '检测', label: '📈 各小区腐控单元进度', query: '各小区腐控单元进度' },
  { tag: '检测', label: '🔍 管地电位平均值', query: '管地电位平均' },
  { tag: '检测', label: '🔍 土壤电阻率最大值', query: '土壤电阻率最大' },
  { tag: '地图', label: '🗺️ 七里管线地图', query: '七里管线' },
  { tag: '地图', label: '🗺️ 三里调压箱位置', query: '三里调压箱' },
  { tag: '地图', label: '🗺️ 六里全部设施', query: '六里引入口' },
]
