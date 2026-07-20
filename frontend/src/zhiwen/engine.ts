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
  created_at?: string
  updated_at?: string
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
  mapOverlay?: Array<{ lng: number; lat: number; type: string; name: string; community: string; status?: string; isPrimary?: boolean }>
  /** 反查匹配标签（用于地图 InfoWindow / 主标记） */
  mapMatchedLabel?: string
  /** 反查匹配 key（用于地图 InfoWindow 标题） */
  mapMatchedKey?: string
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
  return 'pipes'  // 默认（用于 runQuery 路由到具体数据集的逻辑，不是置信度信号）
}

/**
 * 是否真的命中数据集关键词（不算默认 fallback）
 *  - scoreConfidence 必须用这个，否则"你能知道点啥"这种闲聊也会被算成数据集命中
 *  - runQuery 内部仍然用 matchDataset（默认 'pipes'）来路由
 */
function hasRealDatasetMatch(text: string): boolean {
  for (const k of Object.keys(DATASET_KEYWORDS)) {
    if (DATASET_KEYWORDS[k].test(text)) return true
  }
  return false
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
  // 1) 显式数量词：多少/数量/几条/几段/几个/几口/几座/几台/几根
  // 2) count / num 英文
  // 3) "一共" / "总共" / "共计" / "合计" / "共有" — 这些是聚合意图
  // 4) "一共有几个" / "总共多少" — 复合形式
  return /多少|数量|几条|几段|几个|几口|几座|几台|几根|count|num|一共|总共|共计|合计|共有/i.test(text)
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

/**
 * 给"数量类"查询生成详情表格
 *  - 之前是写死的 `['Fid', '小区', '压力']` 兜底，导致引入口/控制单元/绝缘接头
 *    等没有 pressured 字段的数据集，表格里的"压力"列全是 '-'，看起来数据完全不对
 *  - 现在按 dataset 给出真实有意义的列：
 *    pipes:     PIPENO, 小区, 压力, 材质, 管径(mm), 长度(m)
 *    inlets:    编号(ECODE), 小区, 管线号, 压力, 坐标
 *    joints:    编号, 名称, 小区, 压力
 *    regulators:编号, 名称, 小区, 压力, 管线号
 *    controls:  名称(FSKZ), 小区, 管线号
 *    units:     名称, 小区, 地址, 状态, 进度
 *    records:   检测项, 单元, 小区, 状态, 测量值
 *  - 顺便生成一句简短 summary，让 text 段落也能带点有意义的信息
 *    (如"三里有 30 个引入口，分布在 3 条不同管线上")
 */
function buildCountTable(
  dataset: string,
  rows: any[],
): { headers: string[]; rows: any[]; summary: string } {
  const MAX = 50
  const limit = rows.slice(0, MAX)
  let headers: string[] = []
  let tableRows: any[] = []
  let summary = ''

  switch (dataset) {
    case 'pipes': {
      headers = ['PIPENO', '小区', '压力', '材质', '管径(mm)', '长度(m)']
      tableRows = limit.map((r: any) => ({
        PIPENO: r.pipeno || '-',
        小区: r.community,
        压力: r.pressured || '-',
        材质: r.material || '-',
        '管径(mm)': r.diametero || '-',
        '长度(m)': r.length || '-',
      }))
      const totalLen = rows.reduce((s, r) => s + toNumber(r.length), 0)
      summary = `\n合计长度约 **${totalLen.toFixed(1)} 米**。`
      break
    }
    case 'inlets': {
      headers = ['编号(ECODE)', '小区', '管线号', '压力']
      tableRows = limit.map((r: any) => ({
        '编号(ECODE)': r.ecode || '-',
        小区: r.community,
        管线号: r.pipeno || '-',
        压力: r.pressured || '-',
      }))
      const distinctPipes = new Set(rows.map((r: any) => r.pipeno).filter(Boolean)).size
      if (distinctPipes > 0) summary = `\n分布在 **${distinctPipes}** 条不同管线上。`
      break
    }
    case 'joints': {
      headers = ['编号(ECODE)', '名称', '小区', '压力']
      tableRows = limit.map((r: any) => ({
        '编号(ECODE)': r.ecode || '-',
        名称: r.name || '-',
        小区: r.community,
        压力: r.pressured || '-',
      }))
      break
    }
    case 'regulators': {
      headers = ['编号(ECODE)', '名称', '小区', '压力', '管线号']
      tableRows = limit.map((r: any) => ({
        '编号(ECODE)': r.ecode || '-',
        名称: r.name || '-',
        小区: r.community,
        压力: r.pressured || '-',
        管线号: r.pipeno || '-',
      }))
      break
    }
    case 'controls': {
      headers = ['名称(FSKZ)', '小区', '管线号', '压力']
      tableRows = limit.map((r: any) => ({
        '名称(FSKZ)': r.name || '-',
        小区: r.community,
        管线号: r.pipeno || '-',
        压力: r.pressured || '-',
      }))
      break
    }
    case 'units': {
      headers = ['名称', '小区', '状态', '进度']
      tableRows = limit.map((r: any) => ({
        名称: r.name || '-',
        小区: r.community,
        状态: r.inspection_status || '-',
        进度: r.inspection_progress != null
          ? `${Math.round(r.inspection_progress * 100)}%`
          : '-',
      }))
      break
    }
    case 'records': {
      headers = ['检测项', '单元', '小区', '状态', '测量值']
      tableRows = limit.map((r: any) => ({
        检测项: r.item_name || r.item_code,
        单元: r.unit_name || '-',
        小区: r.community || '-',
        状态: r.status || '-',
        测量值: r.measured_value != null
          ? `${r.measured_value}${r.unit ? ' ' + r.unit : ''}`
          : '-',
      }))
      const passed = rows.filter((r: any) => r.status === 'passed').length
      const exception = rows.filter((r: any) => r.status === 'exception').length
      if (passed + exception > 0) {
        summary = `\n通过 **${passed}** 条，异常 **${exception}** 条。`
      }
      break
    }
    default: {
      // 兜底：尽量暴露有数据的字段
      headers = ['Fid', '小区']
      tableRows = limit.map((r: any) => ({ Fid: r.fid, 小区: r.community }))
    }
  }

  if (rows.length > MAX) {
    summary += `\n（仅展示前 ${MAX} 条，共 ${rows.length} 条）`
  }

  return { headers, rows: tableRows, summary }
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

/**
 * 是否为"对比"类查询
 *  - 显式对比词：对比 / 比较 / 比一比 / 比一下 / 比对 / 横评 / 竖评
 *  - 英文/混写：vs / vs. / VS / versus
 *  - 比较句式："比 X 多/少/长/短/大/小/高/低/好/差/强/弱"
 *  - 注意：不包含"各小区"等"全量分组"信号，那由 groupBy 路径处理更合适
 */
function isCompareIntent(text: string) {
  return /(对比|比较|比一比|比一下|比对|横评|竖评|纵向对比|横向对比|versus)/i.test(text)
      || /\bvs\.?\b/i.test(text)
      || /比(谁|哪个|哪).{0,8}(多|少|长|短|大|小|高|低|好|差|强|弱|多|少)/i.test(text)
}

/**
 * 从文本中提取所有小区（去重，按出现顺序）
 *  - 支持"七里和三里"、"七里三里"、"七里、三里"等多种写法
 *  - 也支持"各小区"（返回 data.communities 全部）
 */
function matchAllCommunities(text: string, data?: ZhiwenData): string[] {
  const result: string[] = []
  for (const k of Object.keys(COMMUNITY_SYNONYMS)) {
    if (text.includes(k)) {
      const full = COMMUNITY_SYNONYMS[k]
      if (!result.includes(full)) result.push(full)
    }
  }
  // 兜底 1："各小区" / "全部小区" / "所有小区" / "三个小区" → 全小区
  if (result.length === 0 && /(各小区|全部小区|所有小区|三个小区|南海家园(?!七里|三里|六里))/.test(text) && data?.communities?.length) {
    return [...data.communities]
  }
  // 兜底 2：单独的"南海家园"（无具体小区）→ 全部 3 个小区
  if (result.length === 0 && /南海家园/.test(text) && data?.communities?.length) {
    return [...data.communities]
  }
  // 兜底 3："一共有几个" / "总共多少" / "一共有多少"（无具体小区 + 合计意图）→ 全部
  if (result.length === 0 && /(一共|总共|共计|合计)/.test(text) && data?.communities?.length) {
    return [...data.communities]
  }
  return result
}

/**
 * 推断对比指标
 *  - return: { metric, label, unit, ... }
 *  - dataset 决定默认指标；关键词覆盖默认
 */
type CompareMetric = 'count' | 'sum_length' | 'avg_length' | 'avg_progress' | 'exception_count' | 'passed_count' | 'unit_count'

function inferCompareMetric(text: string, dataset: string): { metric: CompareMetric; label: string; unit: string } {
  // 通用关键词覆盖
  if (/异常|不合格|未通过|exception/i.test(text)) {
    return { metric: 'exception_count', label: '异常数', unit: '个' }
  }
  if (/通过|合格|passed/i.test(text)) {
    return { metric: 'passed_count', label: '通过数', unit: '个' }
  }
  if (/进度|完成率|完成度|未完成/.test(text) && (dataset === 'units' || dataset === 'records')) {
    return { metric: 'avg_progress', label: '平均进度', unit: '%' }
  }
  if (dataset === 'pipes') {
    if (/总长|总长度|长度|多少米|几米|米数|总米数/.test(text)) {
      return { metric: 'sum_length', label: '管线总长度', unit: 'm' }
    }
    if (/平均|均值|平均长度/.test(text)) {
      return { metric: 'avg_length', label: '管线平均长度', unit: 'm' }
    }
    // 默认：管线数
    return { metric: 'count', label: '管线条数', unit: '条' }
  }
  // 其它数据集默认计数
  const labelMap: Record<string, string> = {
    inlets: '引入口数', joints: '绝缘接头数', regulators: '调压箱数',
    controls: '控制单元数', units: '腐控单元数', records: '检测记录数',
  }
  return { metric: 'count', label: labelMap[dataset] || '数量', unit: countUnit(dataset) }
}

/**
 * 数据集对应的量词
 *  - 管线: 条（线状物，约定俗成）
 *  - 引入口/绝缘接头/调压箱/控制单元/腐控单元: 个
 *  - 检测记录: 条（按条记录）
 *  - 调压箱: 也有人说"台"，但"个"更通用，这里用"个"
 *  - 用户反馈：之前全部硬编码"条"是错的，引入口应该是"个"
 */
export function countUnit(dataset: string): string {
  const unitMap: Record<string, string> = {
    pipes: '条',
    inlets: '个',
    joints: '个',
    regulators: '个',
    controls: '个',
    units: '个',
    records: '条',
  }
  return unitMap[dataset] || '个'
}

/**
 * 计算单个小区在指定 metric 上的值
 */
function computeMetricForCommunity(
  dataset: string,
  metric: CompareMetric,
  community: string,
  data: ZhiwenData,
): number {
  const items = ((data as any)[dataset] as any[]).filter((r: any) => r.community === community)
  if (items.length === 0) return 0
  switch (metric) {
    case 'count':           return items.length
    case 'sum_length':      return items.reduce((s, r) => s + toNumber(r.length), 0)
    case 'avg_length': {
      const total = items.reduce((s, r) => s + toNumber(r.length), 0)
      return items.length ? total / items.length : 0
    }
    case 'avg_progress': {
      const total = items.reduce((s, r) => s + toNumber(r.inspection_progress), 0)
      return items.length ? total / items.length : 0
    }
    case 'exception_count': return items.filter((r) => r.inspection_status === 'exception' || r.status === 'exception').length
    case 'passed_count':    return items.filter((r) => r.inspection_status === 'completed' || r.status === 'passed' || r.status === 'completed').length
    case 'unit_count':      return items.length
  }
}

// =================================================================
// 单元编号反查：用户输入编号 / 楼栋引用 → 找到对应设施、所属小区、楼栋
// =================================================================

/**
 * 设施类型标签映射
 */
const FACILITY_TYPE_LABEL: Record<string, string> = {
  inlets: '引入口',
  joints: '绝缘接头',
  regulators: '调压箱',
  controls: '控制单元',
  pipes: '管线段',
}

/**
 * 是否为"按编号查归属"类查询
 *  - 显式意图词：在哪里 / 在哪个小区 / 在哪个楼 / 属于哪个 / 查 X / 帮我找 / 找一下
 *  - 含可识别的编号字面量：FSKZxxx / N..R..A..
 *  - 含楼栋引用：X号楼 / X#楼 / X号X单元
 *  - 含单元引用：X单元 / X号X楼
 *  - 含小区名 + "X号楼/单元" 的组合
 */
export function isUnitLookupQuery(text: string) {
  if (/(在哪里|在哪个(小区|楼|单元|组团|单元楼)|属于哪个|属于|查.{0,3}(位置|归属|在)|帮我找|找一下|帮我查|帮我看|在哪)/.test(text)) return true
  if (/FSKZ\s*\d/i.test(text)) return true
  // 设施 ECODE：N + 2位数字 + R + 3-4位数字 + 可选字母 + 可选数字
  if (/\bN\d{2}R\d{3,4}[A-Z]?\d*\b/i.test(text)) return true
  // 楼栋引用：X号楼 / X#楼 / X号
  if (/\d+\s*[#号]\s*楼/.test(text)) return true
  // 单元引用：X单元 / X号楼X单元 / X号X单元
  if (/\d+\s*单元/.test(text)) return true
  return false
}

/** 中文数字 → 阿拉伯数字 */
const CN_NUM_MAP: Record<string, number> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15,
  '十六': 16, '十七': 17, '十八': 18, '十九': 19, '二十': 20,
  '廿一': 21, '廿二': 22, '廿三': 23, '廿四': 24, '廿五': 25,
}

/** 提取查询中的"编号"key（FSKZ / ECODE / 楼栋引用） */
export function extractLookupKey(text: string): { key: string; type: 'fskz' | 'ecode' | 'building' | 'unit' | 'free' } | null {
  const trimmed = text.trim()

  // 1) FSKZ 编号
  const fskz = trimmed.match(/FSKZ\s*(\d+)/i)
  if (fskz) return { key: `FSKZ${fskz[1]}`, type: 'fskz' }

  // 2) ECODE 编号
  const ecode = trimmed.match(/\b(N\d{2}R\d{3,4}[A-Z]?\d*)\b/i)
  if (ecode) return { key: ecode[1].toUpperCase(), type: 'ecode' }

  // 3) X号X单元 / X号楼X单元 / X#X单元（提取楼号 + 单元号，优先匹配更具体的模式）
  //    注意：要放在 "X号楼" 检查之前，否则 "1号楼四单元" 会被 building 模式先吃掉
  const unitMatch = trimmed.match(/(\d+)\s*[#号]\s*楼?\s*([一二三四五六七八九十\d]+)\s*单元/)
  if (unitMatch) {
    let unitNum: number
    const raw = unitMatch[2]
    if (/^\d+$/.test(raw)) {
      unitNum = parseInt(raw, 10)
    } else {
      unitNum = CN_NUM_MAP[raw] || parseInt(raw, 10) || 0
    }
    return { key: `${unitMatch[1]}号楼${unitNum}单元`, type: 'unit' }
  }

  // 4) X号楼 / X#楼（纯楼号引用）
  const buildingMatch = trimmed.match(/(\d+)\s*[#号]\s*楼/)
  if (buildingMatch) return { key: `${buildingMatch[1]}号楼`, type: 'building' }

  // 5) 裸 "X号" 引用（没跟楼/单元/单元字，也按楼号处理）
  const bareBuildingMatch = trimmed.match(/(?<![号#\d])(\d+)\s*号(?![楼单元])/)
  if (bareBuildingMatch) return { key: `${bareBuildingMatch[1]}号楼`, type: 'building' }

  return null
}

/**
 * 在所有数据集里搜匹配 key 的设施
 *  - FSKZ: 在 controls 里按 NAME 匹配
 *  - ECODE: 在 inlets / joints / regulators 里按 ecode 匹配
 *  - building/unit: 在 inlets / joints / regulators 里按 name/address 包含匹配
 */
export function searchFacilityByKey(
  key: string,
  type: 'fskz' | 'ecode' | 'building' | 'unit' | 'free',
  data: ZhiwenData,
): Array<{
  dataset: string
  type: string
  name: string
  ecode: string
  community: string
  location_desc: string
  lng: number
  lat: number
  pipeno: string
  raw: any
}> {
  const matches: Array<{
    dataset: string; type: string; name: string; ecode: string;
    community: string; location_desc: string; lng: number; lat: number;
    pipeno: string; raw: any;
  }> = []

  // FSKZ → 控制单元
  if (type === 'fskz') {
    for (const u of data.controls) {
      if (u.name && u.name.toUpperCase() === key.toUpperCase()) {
        matches.push({
          dataset: 'controls', type: '控制单元',
          name: u.name, ecode: u.ecode || '',
          community: u.community, location_desc: '',
          lng: u.lng, lat: u.lat, pipeno: u.pipeno || '',
          raw: u,
        })
      }
    }
    return matches
  }

  // ECODE → 设施
  if (type === 'ecode') {
    const upper = key.toUpperCase()
    for (const list of [
      { ds: 'inlets', rows: data.inlets, label: '引入口' },
      { ds: 'joints', rows: data.joints, label: '绝缘接头' },
      { ds: 'regulators', rows: data.regulators, label: '调压箱' },
    ] as const) {
      for (const f of list.rows) {
        if (f.ecode && f.ecode.toUpperCase() === upper) {
          matches.push({
            dataset: list.ds, type: list.label,
            name: f.name || f.ecode || '', ecode: f.ecode,
            community: f.community, location_desc: '',
            lng: f.lng, lat: f.lat, pipeno: f.pipeno || '',
            raw: f,
          })
        }
      }
    }
    return matches
  }

  // building / unit → 模糊匹配 NAME / ADDRESS
  if (type === 'building' || type === 'unit') {
    // 提取楼号（阿拉伯数字）作为核心匹配
    const buildingNumMatch = key.match(/(\d+)/)
    if (!buildingNumMatch) return []
    const num = buildingNumMatch[1]
    for (const list of [
      { ds: 'inlets', rows: data.inlets, label: '引入口' },
      { ds: 'joints', rows: data.joints, label: '绝缘接头' },
      { ds: 'regulators', rows: data.regulators, label: '调压箱' },
    ] as const) {
      for (const f of list.rows) {
        const hay = `${f.name || ''} ${f.ecode || ''} ${f.pipeno || ''}`
        // 楼号匹配：兼容多种格式
        //  - "1号楼" / "1#楼" / "1号楼X单元" / "1# 四单元..." / 单纯 "1号" 前缀
        const matched =
          new RegExp(`(^|\\s|[^\\d])${num}\\s*[#号]\\s*楼`).test(hay)  // 1号楼 / 1#楼
          || new RegExp(`(^|\\s|[^\\d])${num}\\s*[#号]\\s*[^\\s]*`).test(hay)  // 1# 四单元 / 1号
          || hay.includes(`${num}号楼`)
          || hay.includes(`${num}#楼`)
          || hay.startsWith(`${num}号`) || hay.startsWith(`${num}#`)
        if (matched) {
          matches.push({
            dataset: list.ds, type: list.label,
            name: f.name || f.ecode || '', ecode: f.ecode || '',
            community: f.community, location_desc: '',
            lng: f.lng, lat: f.lat, pipeno: f.pipeno || '',
            raw: f,
          })
        }
      }
    }
    return matches
  }

  return matches
}

// ============== 破损点（防腐层）反查 ==============
/**
 * 防腐层破损点存在 COATING_DETECT 检测记录的 result_data.damage_locations 里
 *  - 原始 records 没有经纬度（检测记录本身是元数据）
 *  - damage_locations 数组里每个点都有 lng/lat/building/severity/leakage_potential 等
 *  - 用户的常见问法：
 *    "三里的破损点" / "FSKZ755856的破损点" / "1号楼的破损点" / "防腐层破损点" / "破损点位置" / "破损点有几个"
 */

/** 是否"破损点"类查询 */
export function isDamagePointQuery(text: string): boolean {
  // 强信号：破损点 / 防腐层破损 / 涂层破损 / 涂层缺陷
  if (/(破损点|破损位置|防腐层.{0,4}破损|涂层.{0,4}破损|涂层.{0,4}缺陷|漏点|缺陷点|损伤点)/.test(text)) return true
  // 弱信号：含"破损" + (位置词 / 数量词 / 严重程度词)
  if (/破损/.test(text) && /(在哪|在哪个|位置|哪里|哪些|几个|多少|列出|统计|严重|疑似|全部|所有|分布)/.test(text)) return true
  return false
}

/** 解析破损点查询的过滤条件 */
export interface DamagePointFilter {
  community?: string
  fskz?: string         // FSKZ 编号
  building?: string     // 楼号（"1号楼"）
  severity?: string     // 严重程度（"严重破损"/"疑似破损"等）
}

export function extractDamagePointFilter(text: string): DamagePointFilter {
  const f: DamagePointFilter = {}
  // 小区
  if (/七里|QL/.test(text)) f.community = '南海家园七里'
  else if (/三里|SL/.test(text)) f.community = '南海家园三里'
  else if (/六里|LL/.test(text)) f.community = '南海家园六里'
  // FSKZ
  const fskzM = text.match(/FSKZ\s*(\d+)/i)
  if (fskzM) f.fskz = `FSKZ${fskzM[1]}`
  // 楼号
  const bldM = text.match(/(\d+)\s*[#号]\s*楼/)
  if (bldM) f.building = `${bldM[1]}号楼`
  // 严重程度
  if (/严重/.test(text)) f.severity = '严重'
  else if (/疑似/.test(text)) f.severity = '疑似'
  return f
}

/** 破损点的标准化结构（供地图 / 表格用） */
export interface CollectedDamagePoint {
  /** 唯一 ID：recordId-pointIdx，方便 React key */
  uid: string
  /** 所属检测记录 ID */
  recordId: number
  /** 所属控制单元 FSKZ */
  fskz: string
  /** 所属小区 */
  community: string
  /** 楼号（如 "1号楼"） */
  building: string
  /** 现场位置描述 */
  location_desc: string
  /** 严重程度 */
  severity: string
  /** 漏电电位 mV */
  leakage_potential: number | null
  /** 埋深 m */
  buried_depth: number | null
  /** 地面类型 */
  surface: string
  /** 现场编号 */
  name: string
  lng: number
  lat: number
  /** 备注 */
  note: string
  /** 所属管线名 */
  pipeline_name: string
}

/** 从 records 里抽出所有匹配的破损点 */
export function collectDamagePoints(
  data: ZhiwenData,
  filter: DamagePointFilter = {},
): CollectedDamagePoint[] {
  const points: CollectedDamagePoint[] = []
  for (const rec of data.records) {
    if (rec.item_code !== 'COATING_DETECT') continue
    if (filter.community && rec.community !== filter.community) continue
    if (filter.fskz && rec.unit_name && rec.unit_name.toUpperCase() !== filter.fskz.toUpperCase()) continue
    const dl = rec.result_data?.damage_locations
    if (!Array.isArray(dl)) continue
    const resultSummary = rec.result_data?.result_summary || rec.result_data?.pipeline_name || ''
    const pipelineName = rec.result_data?.pipeline_name || ''
    for (let idx = 0; idx < dl.length; idx++) {
      const p = dl[idx]
      // 过滤楼号
      if (filter.building && p.building !== filter.building) continue
      // 过滤严重程度（模糊匹配）
      if (filter.severity && !(p.severity || '').includes(filter.severity)) continue
      // 必须有经纬度
      if (typeof p.lng !== 'number' || typeof p.lat !== 'number') continue
      points.push({
        uid: `${rec.id}-${idx}`,
        recordId: rec.id,
        fskz: rec.unit_name || '',
        community: rec.community || '',
        building: p.building || '',
        location_desc: p.location_desc || '',
        severity: p.severity || '—',
        leakage_potential: typeof p.leakage_potential === 'number' ? p.leakage_potential : null,
        buried_depth: typeof p.buried_depth === 'number' ? p.buried_depth : null,
        surface: p.surface || '—',
        name: p.name || `破损点 ${idx + 1}`,
        lng: p.lng,
        lat: p.lat,
        note: p.note || '',
        pipeline_name: pipelineName,
      })
    }
  }
  // 按漏电电位降序（严重的在前）
  points.sort((a, b) => (b.leakage_potential ?? 0) - (a.leakage_potential ?? 0))
  return points
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

// ============== 老板的 15 个问题需要的新能力 ==============

/** Top-N 提取："最长的10条" / "最高的5个" / "前3名" */
export function extractTopN(text: string): { n: number; sortField: 'length' | 'progress' | 'damage_count' | 'count' | 'measured_value' | 'diametero'; order: 'desc' | 'asc' } | null {
  // "前N名" / "前 N 个"
  let m = text.match(/前\s*(\d+)\s*(名|个|条|台|座|根|段)/)
  if (m) return { n: parseInt(m[1]), sortField: 'count', order: 'desc' }

  // "最...的N个/条" — 需要识别排序方向
  m = text.match(/最(长|大|高|多|重|深|严|严 重|严 重|旧|老|新|快|慢|强|弱|好|差)\s*的?\s*(\d+)\s*(个|条|台|座|根|段|口|栋|名)?/)
  if (m) {
    const word = m[1]
    const n = parseInt(m[2])
    const ascWords = ['短', '小', '低', '少', '轻', '浅', '新', '慢', '弱', '差']
    const order: 'desc' | 'asc' = ascWords.includes(word) ? 'asc' : 'desc'
    // 映射到字段
    let sortField: any = 'count'
    if (['长', '短'].includes(word)) sortField = 'length'
    else if (['大', '小'].includes(word)) sortField = 'diametero'
    else if (['高', '低'].includes(word)) sortField = 'progress'
    else if (['多', '少'].includes(word)) sortField = 'count'
    else if (['重', '轻'].includes(word)) sortField = 'length'
    else if (['深', '浅'].includes(word)) sortField = 'length'
    else if (['严'].includes(word)) sortField = 'damage_count'
    else if (['旧', '老'].includes(word)) sortField = 'count'  // 建设年代用 buildYearTopN 单独处理
    else if (['新'].includes(word)) sortField = 'count'
    return { n, sortField, order }
  }

  // "最...的是哪/什么" — 无数字，n=1（"管线最旧的是哪年" → 找最早的 1 条）
  m = text.match(/最(长|大|高|多|重|深|严|旧|老|新|快|慢|强|弱|好|差|短|小|低|少|轻|浅)\s*(的\s*)?(是|那|哪|在|多|几|多少|什)/)
  if (m) {
    const word = m[1]
    const ascWords = ['短', '小', '低', '少', '轻', '浅', '新', '慢', '弱', '差']
    const order: 'desc' | 'asc' = ascWords.includes(word) ? 'asc' : 'desc'
    let sortField: any = 'count'
    if (['长', '短'].includes(word)) sortField = 'length'
    else if (['大', '小'].includes(word)) sortField = 'diametero'
    else if (['高', '低'].includes(word)) sortField = 'progress'
    else if (['多', '少'].includes(word)) sortField = 'count'
    else if (['重', '轻'].includes(word)) sortField = 'length'
    else if (['深', '浅'].includes(word)) sortField = 'length'
    else if (['严'].includes(word)) sortField = 'damage_count'
    else if (['旧', '老'].includes(word)) sortField = 'count'
    else if (['新'].includes(word)) sortField = 'count'
    return { n: 1, sortField, order }
  }
  return null
}

/** 是否 Top-N 意图 */
export function isTopNIntent(text: string): boolean {
  if (extractTopN(text)) return true
  if (/(最.{1,3}的|最.{1,3}是哪|排序)/i.test(text)) return true
  return false
}

/**
 * 时间范围匹配
 *  - 本周 / 上周 / 本月 / 上个月 / 今天 / 最近N天 / 2020年 等
 *  - 返回 { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', label: '本周' }
 */
export interface TimeRange {
  from: string  // 包含
  to: string    // 包含
  label: string // '本周' / '最近7天' / '2020年'
}

export function matchTimeRange(text: string, now = new Date()): TimeRange | null {
  const ymd = (d: Date) => d.toISOString().slice(0, 10)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const offsetDays = (d: Date, n: number) => {
    const r = new Date(d); r.setDate(r.getDate() + n); return r
  }

  // 本周（周一到周日）
  if (/本周|这周/.test(text)) {
    const dow = (today.getDay() + 6) % 7  // 周一=0
    const mon = offsetDays(today, -dow)
    const sun = offsetDays(mon, 6)
    return { from: ymd(mon), to: ymd(sun), label: '本周' }
  }
  // 上周
  if (/上周/.test(text)) {
    const dow = (today.getDay() + 6) % 7
    const thisMon = offsetDays(today, -dow)
    const lastMon = offsetDays(thisMon, -7)
    const lastSun = offsetDays(thisMon, -1)
    return { from: ymd(lastMon), to: ymd(lastSun), label: '上周' }
  }
  // 本月
  if (/本月|这个月/.test(text)) {
    const first = new Date(today.getFullYear(), today.getMonth(), 1)
    const last = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    return { from: ymd(first), to: ymd(last), label: '本月' }
  }
  // 上个月
  if (/上个月|上月/.test(text)) {
    const first = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const last = new Date(today.getFullYear(), today.getMonth(), 0)
    return { from: ymd(first), to: ymd(last), label: '上个月' }
  }
  // 今天
  if (/今天|今日/.test(text)) {
    return { from: ymd(today), to: ymd(today), label: '今天' }
  }
  // 最近 N 天
  let m = text.match(/最近\s*(\d+)\s*天/)
  if (m) {
    const n = parseInt(m[1])
    return { from: ymd(offsetDays(today, -n + 1)), to: ymd(today), label: `最近${n}天` }
  }
  // 最近 N 个月
  m = text.match(/最近\s*(\d+)\s*个?月/)
  if (m) {
    const n = parseInt(m[1])
    const first = new Date(today.getFullYear(), today.getMonth() - n + 1, 1)
    return { from: ymd(first), to: ymd(today), label: `最近${n}个月` }
  }
  // 具体年份："2020年" / "2020年建设" — 已经在 matchBuildYear 处理，但也可以转成 TimeRange
  m = text.match(/(\d{4})\s*年(新增|发生|出现|完成|检测|录入|施工)?/)
  if (m && /新增|发生|出现|完成|检测|录入/.test(text)) {
    const y = parseInt(m[1])
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: `${y}年` }
  }
  return null
}

/** 进度范围匹配："进度超过80%" / "进度低于50%" / "80%以上" */
export function matchProgressRange(text: string): { op: '>=' | '<=' | '>'; value: number } | null {
  // "进度超过80%" / "进度高于80%" / "进度大于80%" / "进度>=80%"
  let m = text.match(/进度\s*(超过|高于|大于|>=|>|不少于|不小于)\s*(\d+)\s*%?/)
  if (m) {
    const num = parseInt(m[2])
    return /超过|大于|高于|>|不少于|不小于|>=/.test(m[1])
      ? { op: '>=', value: num / 100 }
      : { op: '>=', value: num / 100 }
  }
  m = text.match(/进度\s*(低于|小于|<=|<|不多于)\s*(\d+)\s*%?/)
  if (m) {
    const num = parseInt(m[2])
    return { op: '<=', value: num / 100 }
  }
  // "80%以上的" / "进度80%以上" — 倒装
  m = text.match(/(\d+)\s*%\s*(以上|以上|以上)/)
  if (m) return { op: '>=', value: parseInt(m[1]) / 100 }
  m = text.match(/(\d+)\s*%\s*(以下|以下|以内)/)
  if (m) return { op: '<=', value: parseInt(m[1]) / 100 }
  return null
}

/** 检测员匹配："检测员张三" / "张三检测的" / "张三今天检测了多少" / "李四的检测" */
export function matchInspector(text: string): string | null {
  // 名字后的合法边界：必须紧跟检测/录入/巡检/施工/做 等明确动作词，或"的检测/的录入"等所有格形式
  //  - 不能是任意 2-3 字+任意边界（如"道点啥"、"知道点"），否则会把闲聊当检测员
  //  - 保留"最"以支持"张三最常检测什么"这类查询
  const NAME_BOUNDARY = '(?:做的?|检测的?|录入的?|巡检的?|施工的?|的检测|的录入|的巡检|的施工|最)'

  // 1) "检测员XXX" — 名字 2-3 字 + 动作边界
  let m = text.match(new RegExp(`检测员\\s*[::]?\\s*([\\u4e00-\\u9fa5]{2,3}?)(?=${NAME_BOUNDARY})`))
  if (m) return m[1].trim()

  // 2) "张三做的" / "张三检测的" / "张三的检测" / "李四的录入" / "张三最常检测什么"
  //    关键：名字后必须紧跟"做/检测/录入/巡检/施工/的X"等明确指示，不能是任意 2-3 字+任意边界
  m = text.match(new RegExp(`([\\u4e00-\\u9fa5]{2,3}?)(?=${NAME_BOUNDARY})`))
  if (m) return m[1].trim()

  return null
}

/** 两个 FSKZ 对比 */
export function isTwoUnitCompare(text: string): { a: string; b: string } | null {
  const m = text.match(/FSKZ\s*(\d+)\s*(?:和|跟|与|跟|及|\/|vs\.?|VS\.?)\s*FSKZ\s*(\d+)/i)
  if (m) return { a: `FSKZ${m[1]}`, b: `FSKZ${m[2]}` }
  // "A 和 B 哪个进度高" — A 和 B 是 FSKZ
  const m2 = text.match(/FSKZ\s*(\d+)[^a-zA-Z\d]{0,5}FSKZ\s*(\d+)/i)
  if (m2) return { a: `FSKZ${m2[1]}`, b: `FSKZ${m2[2]}` }
  return null
}

/** 两个 FSKZ 反查对比 — 实际找两个设施然后比较指标 */
export function compareTwoUnits(a: string, b: string, data: ZhiwenData): {
  a: any | null; b: any | null; text: string; table?: any
} {
  // 优先在 controls 里找（FSKZ 是控制单元）
  const findUnit = (fskz: string): any => {
    const ctrl = data.controls.find((c) => (c.name || '').toUpperCase() === fskz.toUpperCase())
    if (ctrl) return { ...ctrl, source: 'control' }
    // 然后在 units 里找
    const u = data.units.find((u) => (u.name || '').toUpperCase() === fskz.toUpperCase())
    if (u) return u
    return null
  }
  const ua = findUnit(a)
  const ub = findUnit(b)
  if (!ua || !ub) {
    return { a: ua, b: ub, text: `未找到 ${!ua ? a : b} 对应的单元` }
  }
  // 找 records 计算异常数 / 进度（按 unit_name 匹配，因为 control 没 id 字段）
  const recordsA = data.records.filter((r) => (r.unit_name || '').toUpperCase() === a.toUpperCase())
  const recordsB = data.records.filter((r) => (r.unit_name || '').toUpperCase() === b.toUpperCase())
  const excA = recordsA.filter((r) => r.status === 'exception').length
  const excB = recordsB.filter((r) => r.status === 'exception').length
  const passA = recordsA.filter((r) => r.status === 'passed').length
  const passB = recordsB.filter((r) => r.status === 'passed').length
  const progA = ua.inspection_progress ?? 0
  const progB = ub.inspection_progress ?? 0
  const winner = progA > progB ? a : progA < progB ? b : '平局'
  const diff = Math.abs(progA - progB) * 100
  const text = `${a} vs ${b}：\n` +
    `- 进度：**${a} ${(progA * 100).toFixed(0)}%** vs **${b} ${(progB * 100).toFixed(0)}%** （差距 ${diff.toFixed(0)}%）\n` +
    `- 检测记录：${a} ${recordsA.length} 条 vs ${b} ${recordsB.length} 条\n` +
    `- 异常：${a} ${excA} 个 vs ${b} ${excB} 个\n` +
    `- 通过：${a} ${passA} 个 vs ${b} ${passB} 个\n` +
    `\n${winner !== '平局' ? `**${winner}** 进度更高` : '进度相当'}`
  return {
    a: ua, b: ub, text,
    table: {
      headers: ['指标', a, b],
      rows: [
        { 指标: '所属小区', [a]: ua.community, [b]: ub.community },
        { 指标: '进度', [a]: `${(progA * 100).toFixed(0)}%`, [b]: `${(progB * 100).toFixed(0)}%` },
        { 指标: '检测记录数', [a]: recordsA.length, [b]: recordsB.length },
        { 指标: '异常数', [a]: excA, [b]: excB },
        { 指标: '通过数', [a]: passA, [b]: passB },
        { 指标: '经度', [a]: ua.lng?.toFixed(6) || '—', [b]: ub.lng?.toFixed(6) || '—' },
        { 指标: '纬度', [a]: ua.lat?.toFixed(6) || '—', [b]: ub.lat?.toFixed(6) || '—' },
      ],
    },
  }
}

// ============== 过滤器构造 ==============

function buildFilters(text: string, dataset: string, data: ZhiwenData) {
  const filters: Array<(row: any) => boolean> = []
  const sqlParts: string[] = []

  // 小区过滤：支持多小区（"三里和七里" / "三个小区" / "南海家园"）
  // 用 matchAllCommunities 而不是 matchCommunity，这样跨小区查询能正确
  const communities = matchAllCommunities(text, data)
  if (communities.length === 1) {
    filters.push((r) => r.community === communities[0])
    sqlParts.push(`小区 = ${communities[0]}`)
  } else if (communities.length > 1) {
    filters.push((r) => communities.includes(r.community))
    sqlParts.push(`小区 IN (${communities.join('、')})`)
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

  // ====== 通用：进度范围过滤（units）======
  if (dataset === 'units' || dataset === 'records') {
    const prog = matchProgressRange(text)
    if (prog) {
      const op = prog.op
      const v = prog.value
      filters.push((r) => {
        const p = r.inspection_progress ?? (r.status === 'completed' || r.status === 'passed' ? 1 : r.status === 'in_progress' ? 0.5 : 0)
        if (op === '>=') return p >= v
        if (op === '<=') return p <= v
        if (op === '>') return p > v
        return p < v
      })
      sqlParts.push(`进度 ${op === '>=' ? '≥' : op === '<=' ? '≤' : op} ${(v * 100).toFixed(0)}%`)
    }
  }

  // ====== 通用：检测员过滤（records）======
  if (dataset === 'records') {
    const insp = matchInspector(text)
    if (insp) {
      filters.push((r) => (r.inspector || '').includes(insp))
      sqlParts.push(`检测员 = ${insp}`)
    }
  }

  // ====== 通用：时间范围过滤（records 用 inspection_date / created_at）======
  if (dataset === 'records' || dataset === 'units') {
    const tr = matchTimeRange(text)
    if (tr) {
      filters.push((r) => {
        const d = r.inspection_date || r.created_at || ''
        if (!d) return false
        const dateStr = String(d).slice(0, 10)  // 取 YYYY-MM-DD
        return dateStr >= tr.from && dateStr <= tr.to
      })
      sqlParts.push(`时间 = ${tr.label}（${tr.from} ~ ${tr.to}）`)
    }
  }

  // ====== units 专用：100% 完成 ======
  if (dataset === 'units') {
    if (/100%\s*(完成|完成率|搞定|检测完|都检完)|全部完成|都完成了|完成度满|进度满|全部检完|已经完成|已完成|完成100%/.test(text)) {
      filters.push((r) => {
        const p = r.inspection_progress ?? (r.inspection_status === 'completed' ? 1 : 0)
        return p >= 0.999 || r.inspection_status === 'completed'
      })
      sqlParts.push(`进度 = 100% 完成`)
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
  // 数据集命中：只算真实命中，不算默认 'pipes' fallback
  if (hasRealDatasetMatch(text)) { score += 0.3; reasons.push('数据集') }
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
  // 报告/概览/汇总/总结 意图：直接给足分数，确保不被规则引擎误判为"不理解"
  //  - "总报告" / "出一份综合报告" / "我要看报告" 这类问题虽然不带数据维度词，
  //    但意图非常明确（要一份报告），必须走到 runQuery → parseReportRequest 路径
  if (/(报告|报表|总结|汇总|概览|总览|整体)/.test(text)) {
    score += 0.5; reasons.push('报告意图')
  }
  // 对比意图：X 跟 Y 比 / X vs Y / X 和 Y 对比 — 同样意图明确，加 0.2 保底避免被误判
  if (/(对比|比较|比一比|比一下|比对|横评|竖评|vs\.?|VS\.?)/i.test(text)
      || /比(谁|哪个).{0,8}(多|少|长|短|大|小|高|低|好|差|强|弱)/i.test(text)) {
    score += 0.2; reasons.push('对比意图')
  }
  // 编号反查意图：FSKZ 编号 / ECODE / 楼栋引用 + "在哪里/属于/查" 等
  //  - 纯编号（"FSKZ755853"、"N54R328A067"）如果不加这个分，会被 dataset/小区维度都拿不到 → 走 LLM 兜底
  //  - 加 0.4 保底让 rules 路径至少能跑到 lookup 分支
  if (isUnitLookupQuery(text)) {
    score += 0.4; reasons.push('编号反查')
  }
  // 老板的 5 大新能力：分别加 0.2~0.3 保底分
  if (isTopNIntent(text)) { score += 0.3; reasons.push('Top-N') }
  if (matchTimeRange(text)) { score += 0.2; reasons.push('时间范围') }
  if (matchProgressRange(text)) { score += 0.2; reasons.push('进度范围') }
  if (matchInspector(text)) { score += 0.2; reasons.push('检测员') }
  if (isTwoUnitCompare(text)) { score += 0.3; reasons.push('两单元对比') }
  if (isDamagePointQuery(text)) { score += 0.3; reasons.push('破损点') }
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
  { keywords: /综合概览|总览|概览|综合报告|总报告|全部报告|总体报告|整体报告|完整报告|整体|汇总|总结|总表|报表/, type: 'overview' },
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

/** 识别自然语言里的"报告请求"
 *
 * 触发报告意图的场景（满足任一即视为报告请求）：
 *   1. 强信号：动词+报告  →  "做/出/生成/写/给我/要+报告/单"
 *   2. 强信号：综合/总览/整体 等显式总览词
 *   3. 弱信号：含"报告" + 含至少一个具体报告维度词（管地电位/物探/异常/设施/进度/拓扑/检测等）
 *
 * 不触发的场景：
 *   - 普通查询如"管线总长"、"七里调压箱有几个" → 返回 null，按普通查询处理
 *   - 这种情况下用户想看报告可以点结果旁边的"出报告"按钮生成针对性报告
 *
 * 兜底策略：
 *   - 识别到具体类型 → 用对应类型
 *   - 仅强信号但没具体类型 → 综合概览
 *   - 弱信号但命中具体类型 → 该类型报告
 */
export function parseReportRequest(text: string, _data: ZhiwenData): ReportRequest | null {
  const trimmed = text.trim()

  // 0. 强信号：动词+报告，或显式总览/汇总/总结词
  //    - 放宽动词后中间字符：原来只允许 0-6 字符，"出一份总报告"勉强能过；现在允许 0-10 字符，兜住"给我出一份总报告"等
  //    - 报表/总结/汇总 也算报告意图
  const strongIntent = /(做|出|生成|写|给我|要|来|来一份|出一份|做一份|我想看|我要看|想看|想要|看看|看下).{0,10}(报告|单|表|汇总|总结)/.test(text)
    || /^(报告|综合报告|总报告|全部报告|总体报告|整体报告|完整报告|总览|概览|整体|汇总|汇总报告|综合概览|总结|报表|总表)$/.test(trimmed)
    || /综合概览|总览报告|整体报告|汇总报告|综合报告|总报告|全部报告|总体报告|完整报告|出一份报告|生成报告|写一份报告|出报告|生成一份报告/.test(text)

  // 1. 弱信号：含"报告" + 含具体报告维度词
  const hasReportWord = /报告/.test(text)
  const dimensionWords = /(管地电位|土壤电阻率|杂散电流|防腐层|涂层|绝缘接头|绝缘电阻|电联通|联通性|引入口参数|物探|拓扑|异常|不合格|不通过|设施|调压箱|引入口|进度|完成率|权属)/
  const weakIntent = hasReportWord && dimensionWords.test(text)

  if (!strongIntent && !weakIntent) return null

  // 2. 报告类型识别
  let type: ReportType | null = null
  for (const { keywords, type: t } of REPORT_TYPE_ALIAS) {
    if (keywords.test(text)) { type = t; break }
  }

  // 3. 专项检测：含"检测项名"且不是其他类型的关键词
  if (!type) {
    const itemMatch = text.match(/(管地电位|土壤电阻率|杂散电流|防腐层|涂层|绝缘接头|绝缘电阻|电联通|联通性|引入口参数)/)
    if (itemMatch) type = 'inspection'
  }

  // 4. 没识别到具体类型：
  //    强信号 → 综合概览（用户明确要报告，但没说类型）
  //    弱信号 + 无类型 → 返回 null（让用户用针对性的"出报告"按钮）
  if (!type) {
    if (!strongIntent) return null
    type = 'overview'
  }

  // 5. 参数提取
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

/** 是否可以"基于该 query 出报告"（每个查询结果都该能出） */
export function canMakeReportFromResult(result: QueryResult): boolean {
  // 至少有文字结果或表格或图表 → 可生成针对性报告
  return !!(result.text || result.table || result.chart)
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

  // -2) 防腐层破损点反查：用户问"三里的破损点" / "FSKZ755856的破损点" / "1号楼的破损点" / "破损点位置"
  //     优先级比普通 lookup 略低，但比对比/count 都高 — 破损点是 COATING_DETECT 记录内部的子数据
  //     不走 records filter 路径（records 本身没有 lng/lat，damage_locations 才有）
  if (isDamagePointQuery(q)) {
    const filter = extractDamagePointFilter(q)
    const points = collectDamagePoints(data, filter)
    if (points.length > 0) {
      // 按小区分组
      const byCommunity = new Map<string, CollectedDamagePoint[]>()
      for (const p of points) {
        if (!byCommunity.has(p.community)) byCommunity.set(p.community, [])
        byCommunity.get(p.community)!.push(p)
      }
      const mainCommunity = filter.community
        || Array.from(byCommunity.entries()).sort((a, b) => b[1].length - a[1].length)[0]?.[0]
        || points[0].community
      const mainPoints = byCommunity.get(mainCommunity) || points

      // 文字总结
      const isCount = isCountIntent(q)
      const textLines: string[] = []
      if (filter.building) {
        textLines.push(`✅ "${filter.building}" 找到 **${points.length} 处** 防腐层破损点（${mainCommunity.replace('南海家园', '')}）`)
      } else if (filter.fskz) {
        textLines.push(`✅ "${filter.fskz}" 控制单元下有 **${points.length} 处** 防腐层破损点`)
      } else if (filter.community) {
        textLines.push(`✅ ${mainCommunity.replace('南海家园', '')}共发现 **${points.length} 处** 防腐层破损点，分布在 ${byCommunity.size > 1 ? byCommunity.size + ' 个小区' : '同一小区'}。`)
      } else {
        textLines.push(`✅ 全部小区共发现 **${points.length} 处** 防腐层破损点`)
        for (const [c, arr] of byCommunity) {
          textLines.push(`   - **${c.replace('南海家园', '')}**：${arr.length} 处`)
        }
      }
      // 严重程度统计
      const severityCount: Record<string, number> = {}
      for (const p of points) {
        const s = p.severity || '未知'
        severityCount[s] = (severityCount[s] || 0) + 1
      }
      const sevSummary = Object.entries(severityCount)
        .map(([s, n]) => `**${n}** 处 ${s}`)
        .join('，')
      if (sevSummary) textLines.push(`   严重程度：${sevSummary}`)

      // 是否要列表/位置
      const wantList = /在哪|位置|哪里|哪些|列出|显示|list/i.test(q)
      const text = textLines.join('\n') + '\n\n🗺️ 地图已标出所有破损点位置。'

      return {
        text,
        totalCount: points.length,
        table: isCount && !wantList ? {
          headers: ['指标', '值'],
          rows: [
            { 指标: '破损点总数', 值: `${points.length} 处` },
            { 指标: '涉及小区数', 值: `${byCommunity.size} 个` },
            { 指标: '涉及楼栋数', 值: `${new Set(points.map((p) => p.building).filter(Boolean)).size} 栋` },
            ...Object.entries(severityCount).map(([s, n]) => ({ 指标: `${s}破损点`, 值: `${n} 处` })),
          ],
        } : {
          headers: ['现场编号', '楼栋', '位置', '漏电电位(mV)', '严重程度', '所属控制单元', '小区'],
          rows: points.slice(0, 50).map((p) => ({
            现场编号: p.name,
            楼栋: p.building || '—',
            位置: p.location_desc || '—',
            '漏电电位(mV)': p.leakage_potential ?? '—',
            严重程度: p.severity,
            所属控制单元: p.fskz || '—',
            小区: p.community.replace('南海家园', ''),
          })),
        },
        chart: points.length > 1 ? {
          type: 'bar',
          title: '各楼栋破损点数量',
          xField: 'name',
          yField: 'value',
          data: sumByField(points.map((p) => ({ name: p.building || '未知', value: 1 })), 'name', 'value'),
        } : undefined,
        mapDataset: 'pipes',  // 用管线作为底图（社区范围内已有真实管线）
        mapCommunity: mainCommunity,
        mapFocus: 'filtered',
        // 关键：把每个破损点作为 overlay marker
        mapOverlay: mainPoints.map((p, idx) => ({
          lng: p.lng,
          lat: p.lat,
          type: '破损点',
          name: p.name,
          community: p.community,
          status: p.severity.includes('严重') ? 'exception' : 'warning',
          isPrimary: idx === 0,
        })),
        mapMatchedKey: mainPoints[0] ? `DP-${mainPoints[0].uid}` : undefined,
        mapMatchedLabel: mainPoints.length === 1
          ? `破损点 · ${mainPoints[0].name}`
          : `${mainPoints.length} 个破损点${filter.building ? '（' + filter.building + '）' : ''}`,
        sql: `破损点反查 | filter=${JSON.stringify(filter)} | 命中 ${points.length} 处, 跨 ${byCommunity.size} 个小区`,
      }
    } else {
      // 没找到 - 给出引导
      return {
        text: `未找到符合条件的破损点。\n\n请输入更多的信息，以便更精准地查询；\n请连接网络，以便检索更多消息；
在数据库中补充更多有效数据。\n\n💡 试试：\n- **三里的破损点**（按小区）\n- **FSKZ755856 的破损点**（按控制单元）\n- **1号楼的破损点**（按楼号）\n- **严重破损**（按严重程度）\n- **破损点有几个**（总数）`,
        sql: `破损点反查 | filter=${JSON.stringify(filter)} | 未命中`,
        mapDataset: 'pipes',
        mapFocus: 'all',
      }
    }
  }

  // -1.7) 检测员工作量排名："检测员工作量" / "各检测员工作量" / "检测员排名"
  //       不指定具体人 → 按 inspector 分组 + 按记录数降序
  if (matchDataset(q) === 'records' && /检测员.{0,4}(工作量|排名|统计|对比)|各检测员/.test(q)) {
    const grouped = new Map<string, number>()
    for (const r of data.records) {
      const k = r.inspector || '(未署名)'
      grouped.set(k, (grouped.get(k) || 0) + 1)
    }
    const sorted = Array.from(grouped.entries()).sort((a, b) => b[1] - a[1])
    return {
      text: `👥 **检测员工作量排名**（共 ${sorted.length} 位检测员，${data.records.length} 条记录）：\n\n` +
        sorted.map(([k, n], i) => `${i + 1}. **${k}** — ${n} 条`).join('\n'),
      totalCount: data.records.length,
      table: {
        headers: ['排名', '检测员', '记录数', '占比'],
        rows: sorted.map(([k, n], i) => ({
          排名: i + 1, 检测员: k, 记录数: n, 占比: `${(n / data.records.length * 100).toFixed(1)}%`,
        })),
      },
      chart: sorted.length > 1 ? {
        type: 'bar',
        title: '检测员工作量',
        xField: 'name',
        yField: 'value',
        data: sorted.map(([k, n]) => ({ name: k, value: n })),
      } : undefined,
      mapDataset: 'pipes',
      mapFocus: 'all',
      sql: `检测员工作量排名 | group by inspector | ${sorted.length} 检测员`,
    }
  }

  // -1.8) 单个检测员的检测项目分布："张三最常检测什么" / "张三检测了哪些项目"
  if (matchDataset(q) === 'records' && matchInspector(q) && /(最常|常检|检测.{0,4}(哪些|什么)项目|项目.{0,4}分布)/.test(q)) {
    const insp = matchInspector(q)!
    const rows = data.records.filter((r) => (r.inspector || '').includes(insp))
    const grouped = new Map<string, number>()
    for (const r of rows) {
      const k = r.item_name || r.item_code || '未知'
      grouped.set(k, (grouped.get(k) || 0) + 1)
    }
    const sorted = Array.from(grouped.entries()).sort((a, b) => b[1] - a[1])
    return {
      text: `👤 **${insp}** 检测项目分布（共 ${rows.length} 条）：\n\n` +
        sorted.map(([k, n], i) => `${i + 1}. **${k}** — ${n} 条（${(n / rows.length * 100).toFixed(0)}%）`).join('\n'),
      totalCount: rows.length,
      table: {
        headers: ['排名', '检测项', '记录数', '占比'],
        rows: sorted.map(([k, n], i) => ({
          排名: i + 1, 检测项: k, 记录数: n, 占比: `${(n / rows.length * 100).toFixed(1)}%`,
        })),
      },
      chart: sorted.length > 1 ? {
        type: 'pie',
        title: `${insp} 检测项分布`,
        data: sorted.map(([k, n]) => ({ name: k, value: n })),
      } : undefined,
      mapDataset: 'pipes',
      mapFocus: 'all',
      sql: `检测员项目分布 | inspector=${insp} | ${sorted.length} 项`,
    }
  }

  // -1.6) 检测员查询："张三检测了多少个" / "张三今天检测了多少" / "李四的检测"
  //       独立分支，给出更友好的"工作量"语义
  if (matchDataset(q) === 'records' && matchInspector(q) && (isCountIntent(q) || /工作|做了|录入了|巡检了/.test(q))) {
    const insp = matchInspector(q)!
    const rows = data.records.filter((r) => (r.inspector || '').includes(insp))
    const tr = matchTimeRange(q)
    const timeRows = tr ? rows.filter((r) => {
      const d = String(r.inspection_date || r.created_at || '').slice(0, 10)
      return d >= tr.from && d <= tr.to
    }) : rows
    const passed = timeRows.filter((r) => r.status === 'passed').length
    const exc = timeRows.filter((r) => r.status === 'exception').length
    const communities = new Set(timeRows.map((r) => r.community).filter(Boolean)).size
    const items = new Set(timeRows.map((r) => r.item_name || r.item_code).filter(Boolean))

    let text = `👤 **${insp}** 共完成 **${timeRows.length}** 条检测记录`
    if (tr) text += `（${tr.label}）`
    text += '。\n\n'
    if (passed || exc) {
      text += `通过 **${passed}** 条，异常 **${exc}** 条`
      if (communities > 0) text += `，跨 **${communities}** 个小区`
      text += '。\n'
    }
    if (items.size > 0) {
      text += `检测项：${[...items].slice(0, 5).join('、')}${items.size > 5 ? ` 等 ${items.size} 项` : ''}。`
    }

    return {
      text,
      totalCount: timeRows.length,
      table: timeRows.length > 0 && !isCountIntent(q) ? {
        headers: ['日期', '单元', '检测项', '小区', '状态'],
        rows: timeRows.slice(0, 50).map((r: any) => ({
          日期: r.inspection_date || '-',
          单元: r.unit_name || '-',
          检测项: r.item_name || r.item_code,
          小区: (r.community || '').replace('南海家园', ''),
          状态: r.status || '-',
        })),
      } : {
        headers: ['指标', '值'],
        rows: [
          { 指标: '总检测数', 值: `${timeRows.length} 条` },
          { 指标: '通过数', 值: `${passed} 条` },
          { 指标: '异常数', 值: `${exc} 条` },
          { 指标: '覆盖小区', 值: `${communities} 个` },
          { 指标: '检测项数', 值: `${items.size} 项` },
        ],
      },
      mapDataset: 'pipes',
      mapCommunity: matchCommunity(q) || undefined,
      mapFocus: 'all',
      sql: `检测员工作量 | inspector=${insp} | count=${timeRows.length} | ${tr ? `time=${tr.label}` : 'all-time'}`,
    }
  }

  // -1.4) 多小区合计："三里和七里一共有几个引入口" / "三里、七里一共多少"
  //       独立分支，输出每个小区明细 + 合计
  if (isCountIntent(q) && /一共|总共|共计|合计|共有/.test(q)) {
    const allComms = matchAllCommunities(q, data)
    if (allComms.length >= 2) {
      const ds = matchDataset(q)
      const rows = (data as any)[ds] || []
      const breakdown = allComms.map((c) => ({
        community: c,
        count: rows.filter((r: any) => r.community === c).length,
      }))
      const total = breakdown.reduce((s, b) => s + b.count, 0)
      const dsLabel = { pipes: '管线', inlets: '引入口', controls: '控制单元', joints: '绝缘接头', regulators: '调压箱', units: '腐控单元', records: '检测记录' }[ds]
      const unit = countUnit(ds)

      return {
        text: `📊 **${allComms.map((c) => c.replace('南海家园', '')).join(' + ')}** 共有 **${total}** ${unit}${dsLabel}：\n\n` +
          breakdown.map((b) => `  - **${b.community.replace('南海家园', '')}**：${b.count} ${unit}`).join('\n') +
          `\n\n💡 数据集：${dsLabel}。如需看明细可点"导出"。`,
        totalCount: total,
        table: {
          headers: ['小区', dsLabel + '数'],
          rows: breakdown.map((b) => ({ 小区: b.community.replace('南海家园', ''), [`${dsLabel}数`]: b.count })).concat([{ 小区: '合计', [`${dsLabel}数`]: total }]),
        },
        chart: breakdown.length >= 2 ? {
          type: 'pie',
          title: `${allComms.map((c) => c.replace('南海家园', '')).join('+')}${dsLabel}分布`,
          data: breakdown.map((b) => ({ name: b.community.replace('南海家园', ''), value: b.count })),
        } : undefined,
        mapDataset: ds as any,
        mapCommunity: allComms[0],
        mapFocus: 'filtered',
        sql: `多小区合计 | ${ds} | communities=${allComms.join('+')} | total=${total}`,
      }
    }
  }

  // -1.5) 两个具体 FSKZ 对比："FSKZ755853 跟 FSKZ755856 哪个进度高"
  //       优先级高于普通对比（因为是具体两个值），独立处理
  const twoUnit = isTwoUnitCompare(q)
  if (twoUnit) {
    const r = compareTwoUnits(twoUnit.a, twoUnit.b, data)
    return {
      text: r.text,
      table: r.table,
      mapDataset: 'pipes',
      mapCommunity: r.a?.community || r.b?.community,
      mapFocus: 'all',
      mapOverlay: r.a && r.b ? [
        { lng: r.a.lng, lat: r.a.lat, type: '控制单元', name: r.a.name || twoUnit.a, community: r.a.community, status: 'matched', isPrimary: true },
        { lng: r.b.lng, lat: r.b.lat, type: '控制单元', name: r.b.name || twoUnit.b, community: r.b.community, status: 'matched', isPrimary: false },
      ].filter((o) => typeof o.lng === 'number' && typeof o.lat === 'number') : undefined,
      sql: `两单元对比 | ${twoUnit.a} vs ${twoUnit.b}`,
    }
  }

  // -1) 单元编号反查：用户问"X号楼在哪" / "FSKZ755853 在哪个小区" / "N54R328A067 属于哪个楼"
  //     优先级最高，避免被 dataset/filters 路径抢走
  if (isUnitLookupQuery(q)) {
    const lookup = extractLookupKey(q)
    if (lookup) {
      const matches = searchFacilityByKey(lookup.key, lookup.type, data)
      if (matches.length > 0) {
        // 按社区分组
        const byCommunity = new Map<string, typeof matches>()
        for (const m of matches) {
          if (!byCommunity.has(m.community)) byCommunity.set(m.community, [])
          byCommunity.get(m.community)!.push(m)
        }

        // 找主社区（命中最多的小区）
        let mainCommunity = matches[0].community
        let mainCount = 0
        for (const [c, arr] of byCommunity) {
          if (arr.length > mainCount) {
            mainCommunity = c
            mainCount = arr.length
          }
        }

        // 文字总结
        const typeLabel = lookup.type === 'fskz' ? '控制单元'
          : lookup.type === 'ecode' ? '设施'
          : lookup.type === 'building' ? '楼栋相关设施'
          : '楼栋单元相关设施'

        const textLines: string[] = []
        if (matches.length === 1) {
          const m = matches[0]
          textLines.push(`✅ 找到 1 个 ${typeLabel}：**${m.name || m.ecode}**（${m.type}）`)
          textLines.push(`   所属小区：**${m.community}**`)
          if (m.pipeno) textLines.push(`   管线编号：${m.pipeno}`)
          textLines.push(`   位置：${m.lng.toFixed(6)}, ${m.lat.toFixed(6)}`)
        } else {
          textLines.push(`✅ "${lookup.key}" 命中 ${matches.length} 个设施，分布在 ${byCommunity.size} 个小区：`)
          for (const [c, arr] of byCommunity) {
            textLines.push(`   - **${c}**：${arr.length} 个（${arr.slice(0, 3).map((m) => m.name || m.ecode).join('、')}${arr.length > 3 ? ` 等 ${arr.length} 个` : ''}）`)
          }
        }

        // 表格行
        const tableRows = matches.map((m) => ({
          名称: m.name || m.ecode,
          类型: m.type,
          小区: m.community,
          编号: m.ecode,
          管线: m.pipeno || '—',
          经度: m.lng.toFixed(6),
          纬度: m.lat.toFixed(6),
        }))

        // 地图聚焦：取主社区的设施
        const mainMatches = byCommunity.get(mainCommunity) || matches
        const mapDataset = mainMatches.some((m) => m.dataset === 'joints') ? 'joints'
          : mainMatches.some((m) => m.dataset === 'regulators') ? 'regulators'
          : mainMatches.some((m) => m.dataset === 'inlets') ? 'inlets'
          : mainMatches.some((m) => m.dataset === 'controls') ? 'controls'
          : 'pipes'

        return {
          text: textLines.join('\n') + '\n\n💡 已切换地图到该小区，匹配设施已标出。',
          totalCount: matches.length,
          table: {
            headers: ['名称', '类型', '小区', '编号', '管线', '经度', '纬度'],
            rows: tableRows,
          },
          mapDataset: mapDataset as 'pipes' | 'inlets' | 'controls' | 'joints' | 'regulators',
          mapCommunity: mainCommunity,
          mapFocus: 'filtered',
          mapMatchedKey: lookup.key,
          mapMatchedLabel: matches.length === 1
            ? `${matches[0].type} · ${matches[0].name || matches[0].ecode}`
            : `${matches.length} 个匹配 · ${lookup.key}`,
          mapOverlay: matches.map((m, idx) => ({
            lng: m.lng,
            lat: m.lat,
            type: m.type,
            name: m.name || m.ecode,
            community: m.community,
            status: 'matched',
            isPrimary: idx === 0,  // 第一个匹配点作为主点，地图默认聚焦这里
          })),
          sql: `编号反查 | key="${lookup.key}" type=${lookup.type} | 命中 ${matches.length} 个设施, 跨 ${byCommunity.size} 个小区`,
        }
      } else {
        // 没找到 - 给出引导
        return {
          text: `未找到 "${lookup.key}" 对应的设施。\n\n请输入更多的信息，以便更精准地查询；\n请连接网络，以便检索更多消息；
在数据库中补充更多有效数据。\n\n💡 支持的查询格式：\n- 控制单元：**FSKZ755853**\n- 设施编号：**N54R328A067** / **N79R501**\n- 楼栋引用：**1号楼** / **2号楼四单元**\n- 直接问："N54R328A067 在哪个小区？" / "1号楼有什么设施？"`,
          sql: `编号反查 | key="${lookup.key}" type=${lookup.type} | 未命中`,
          mapDataset: 'pipes',
          mapFocus: 'all',
        }
      }
    }
  }

  // 0) 对比查询：用户问"X 和 Y 的指标对比" / "X 跟 Y 比"
  //    优先级放在普通 count/sum 之前，避免 "各小区管线总长度" 这类 GROUP BY 路径抢走对比意图
  //    但 "各小区" 已经由 matchAllCommunities 兜住（返回 data.communities 全部），所以"各小区管线总长度对比"也走这里
  if (isCompareIntent(q)) {
    const communities = matchAllCommunities(q, data)
    if (communities.length >= 2) {
      const dataset = matchDataset(q)
      const { metric, label, unit } = inferCompareMetric(q, dataset)
      const datasetLabel = {
        pipes: '管线', inlets: '引入口', controls: '控制单元',
        joints: '绝缘接头', regulators: '调压箱', units: '腐控单元', records: '检测记录',
      }[dataset] || dataset

      // 逐小区算指标
      const rows = communities.map((c) => {
        const value = computeMetricForCommunity(dataset, metric, c, data)
        const allItems = ((data as any)[dataset] as any[]).filter((r: any) => r.community === c)
        const totalLen = dataset === 'pipes' ? allItems.reduce((s, r) => s + toNumber(r.length), 0) : 0
        return {
          小区: c.replace('南海家园', ''),
          [label]: metric === 'avg_progress' ? Number((value * 100).toFixed(1)) : Number(value.toFixed(2)),
          _unit: unit,
          _rawValue: value,
          _totalLength: totalLen,
        }
      })

      // 找最值（用于文字总结）
      const sorted = [...rows].sort((a, b) => b._rawValue - a._rawValue)
      const top = sorted[0]
      const bottom = sorted[sorted.length - 1]
      const diff = top._rawValue - bottom._rawValue
      const ratio = bottom._rawValue > 0 ? (top._rawValue / bottom._rawValue).toFixed(2) : '∞'

      const tableRows = rows.map((r) => {
        const out: Record<string, any> = { 小区: r.小区 }
        out[label] = metric === 'avg_progress' ? `${r[label]}%` : `${r[label]} ${unit}`
        return out
      })
      // 简化：让 pipes 数据同时显示段数
      if (dataset === 'pipes') {
        for (const r of tableRows) {
          const fullName = communities.find((c) => c.replace('南海家园', '') === r.小区) || r.小区
          const items = ((data as any).pipes as any[]).filter((x: any) => x.community === fullName)
          r['段数'] = items.length
        }
      }

      const sql = `对比查询 | 数据源: ${datasetLabel} | 小区: ${communities.join(' vs ')} | 指标: ${label}`
      const sumText = communities.length === 2
        ? `${top.小区} 的 ${label} 最高（${metric === 'avg_progress' ? top[label] + '%' : top[label] + ' ' + unit}），${bottom.小区} 最低（${metric === 'avg_progress' ? bottom[label] + '%' : bottom[label] + ' ' + unit}），差距 ${metric === 'avg_progress' ? ((diff * 100).toFixed(1)) + '%' : diff.toFixed(2) + ' ' + unit}（约 ${ratio} 倍）。`
        : `${top.小区} 的 ${label} 最高，${bottom.小区} 最低，差距 ${metric === 'avg_progress' ? (diff * 100).toFixed(1) + '%' : diff.toFixed(2) + ' ' + unit}。`

      return {
        text: `${communities.map((c) => c.replace('南海家园', '')).join('、')} ${datasetLabel}的 ${label} 对比如下：\n\n${sumText}\n\n💡 图表直观展示各小区指标高低，地图已切换到对比小区。`,
        totalCount: communities.length,
        table: {
          headers: Object.keys(tableRows[0] || { 小区: '', [label]: '' }),
          rows: tableRows,
        },
        chart: {
          type: 'bar',
          title: `${communities.map((c) => c.replace('南海家园', '')).join(' vs ')} · ${label}对比`,
          xField: 'name',
          yField: 'value',
          data: rows.map((r) => ({ name: r.小区, value: r[label] })),
        },
        mapDataset: (['pipes','inlets','controls','joints','regulators'] as readonly string[]).includes(dataset) ? (dataset as 'pipes' | 'inlets' | 'controls' | 'joints' | 'regulators') : undefined,
        mapFocus: 'all',  // 对比场景下不聚焦单一小区，地图显示全小区淡化对比小区高亮
        sql,
      }
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

  // 0.5) Top-N："最长的10条管线" / "进度最高的5个单元" / "前3名"
  //     优先级高于 count（"最长的10条"虽然有"10"，但用户要的是 list，不是 count）
  //     优先级高于普通 list（Top-N 带排序，普通 list 不排）
  const topN = extractTopN(q)
  if (topN && (dataset === 'pipes' || dataset === 'units' || dataset === 'inlets' || dataset === 'joints' || dataset === 'regulators')) {
    const n = topN.n
    const field = topN.sortField
    const order = topN.order
    // 按字段排序
    const sorted = [...rows].sort((a: any, b: any) => {
      let av = 0, bv = 0
      if (field === 'length') { av = toNumber(a.length); bv = toNumber(b.length) }
      else if (field === 'diametero') { av = toNumber(a.diametero); bv = toNumber(b.diametero) }
      else if (field === 'progress') {
        av = a.inspection_progress ?? (a.inspection_status === 'completed' ? 1 : a.inspection_status === 'in_progress' ? 0.5 : 0)
        bv = b.inspection_progress ?? (b.inspection_status === 'completed' ? 1 : b.inspection_status === 'in_progress' ? 0.5 : 0)
      }
      return order === 'desc' ? bv - av : av - bv
    })
    const top = sorted.slice(0, n)

    const fieldLabel: Record<string, string> = {
      length: '长度', diametero: '管径', progress: '进度', count: '数量', damage_count: '破损数', measured_value: '测量值',
    }
    const orderLabel = order === 'desc' ? '最大' : '最小'

    let headers: string[] = []
    let tableRows: any[] = []
    if (dataset === 'pipes') {
      headers = ['排名', 'PIPENO', '小区', '压力', '管径(mm)', '长度(m)']
      tableRows = top.map((r: any, i: number) => ({
        排名: i + 1,
        PIPENO: r.pipeno,
        小区: r.community,
        压力: r.pressured || '-',
        '管径(mm)': r.diametero,
        '长度(m)': r.length,
      }))
    } else if (dataset === 'units') {
      headers = ['排名', '名称', '小区', '进度', '状态']
      tableRows = top.map((r: any, i: number) => ({
        排名: i + 1,
        名称: r.name,
        小区: r.community,
        进度: r.inspection_progress != null ? `${Math.round(r.inspection_progress * 100)}%` : '-',
        状态: r.inspection_status || '-',
      }))
    } else {
      headers = ['排名', '名称/编号', '小区', '坐标']
      tableRows = top.map((r: any, i: number) => ({
        排名: i + 1,
        '名称/编号': r.name || r.ecode || r.fid,
        小区: r.community,
        坐标: typeof r.lng === 'number' ? `${r.lng.toFixed(6)}, ${r.lat.toFixed(6)}` : '-',
      }))
    }

    // 给主点加 map overlay（管线就不加了，加也意义不大，标第一段管线即可）
    const mapOverlay = dataset === 'units' || dataset === 'inlets' || dataset === 'joints' || dataset === 'regulators'
      ? top.filter((r: any) => typeof r.lng === 'number' && typeof r.lat === 'number').slice(0, n).map((r: any, i: number) => ({
          lng: r.lng, lat: r.lat,
          type: dataset === 'units' ? '控制单元' : '设施',
          name: r.name || r.ecode || r.fid,
          community: r.community,
          status: 'matched',
          isPrimary: i === 0,
        }))
      : undefined

    return {
      text: `${datasetLabel}${filterDesc}按 **${fieldLabel[field] || field}** ${orderLabel} 排前 **${n}** 个：\n\n` +
        top.map((r: any, i: number) => {
          if (dataset === 'pipes') {
            return `${i + 1}. **${r.pipeno}** (${r.community.replace('南海家园', '')}) — ${r.length}m / DN${r.diametero}`
          } else if (dataset === 'units') {
            return `${i + 1}. **${r.name}** (${r.community.replace('南海家园', '')}) — 进度 ${Math.round((r.inspection_progress ?? 0) * 100)}%`
          } else {
            return `${i + 1}. **${r.name || r.ecode || r.fid}** (${r.community.replace('南海家园', '')})`
          }
        }).join('\n') +
        `\n\n🗺️ 地图已标出 Top ${n}。`,
      totalCount: top.length,
      table: { headers, rows: tableRows },
      mapDataset: (['pipes','inlets','controls','joints','regulators'] as readonly string[]).includes(dataset) ? (dataset as 'pipes' | 'inlets' | 'controls' | 'joints' | 'regulators') : undefined,
      mapCommunity: matchCommunity(q) ?? top[0]?.community,
      mapFocus: 'filtered',
      mapOverlay,
      sql: `Top-${n} | ${dataset} | sort by ${field} ${order} | filter: ${filterDesc}`,
    }
  }

  // 0.6) 按"建设年代" Top-N（"最旧的是哪年" / "最早的3条管线"）
  //      这是 build_year 排序的特例
  if (dataset === 'pipes' && topN && /建设|年代|年份|年/.test(q)) {
    const withYear = rows.filter((r: any) => r.build_year && parseInt(r.build_year))
    if (withYear.length > 0) {
      const sorted = [...withYear].sort((a: any, b: any) => {
        const ay = parseInt(a.build_year) || 9999
        const by = parseInt(b.build_year) || 9999
        return ay - by  // 升序，最早的在前
      })
      const top = sorted.slice(0, topN.n)
      const years = top.map((r: any) => parseInt(r.build_year))
      const minYear = Math.min(...years)
      return {
        text: `📅 建设年代最早的 ${topN.n} 条管线：\n\n` +
          top.map((r: any, i: number) => `${i + 1}. **${r.pipeno}** — ${r.build_year}年 (${r.community.replace('南海家园', '')})`).join('\n') +
          `\n\n最早的一条建于 **${minYear}** 年。`,
        totalCount: top.length,
        table: {
          headers: ['排名', 'PIPENO', '建设年代', '小区', '长度(m)'],
          rows: top.map((r: any, i: number) => ({
            排名: i + 1, PIPENO: r.pipeno, 建设年代: r.build_year, 小区: r.community, '长度(m)': r.length,
          })),
        },
        mapDataset: 'pipes',
        mapCommunity: matchCommunity(q),
        sql: `建设年代 Top-${topN.n} | sort by build_year asc`,
      }
    }
  }

  // 1) 数量类
  if (isCountIntent(q)) {
    const unit = countUnit(dataset)
    const tableSpec = buildCountTable(dataset, rows)
    sql += ` | 聚合: COUNT(*) = ${rows.length}`
    if (rows.length === 0) {
      return {
        text: `未找到符合条件的${datasetLabel}。\n\n请输入更多的信息，以便更精准地查询；\n请连接网络，以便检索更多消息；
在数据库中补充更多有效数据。\n\n💡 试试：\n- 加上明确的小区（七里 / 三里 / 六里 / 全部）\n- 换一种对象（管线 / 调压箱 / 引入口 / 控制单元 / 检测项）\n- 减少过滤条件（去掉压力、管径、材质等）`,
        totalCount: 0,
        mapDataset: (['pipes','inlets','controls','joints','regulators'] as readonly string[]).includes(dataset) ? (dataset as 'pipes' | 'inlets' | 'controls' | 'joints' | 'regulators') : undefined,
        mapCommunity: matchCommunity(q) || undefined,
        sql,
      }
    }
    return {
      text: `${datasetLabel}${filterDesc}共 **${rows.length}** ${unit}。${tableSpec.summary || ''}`,
      totalCount: rows.length,
      table: { headers: tableSpec.headers, rows: tableSpec.rows },
      mapDataset: (['pipes','inlets','controls','joints','regulators'] as readonly string[]).includes(dataset) ? (dataset as 'pipes' | 'inlets' | 'controls' | 'joints' | 'regulators') : undefined,
      mapCommunity: matchCommunity(q) || undefined,
      sql,
    }
  }

  // 1.5) "三里引入口最多的管线" — 按 pipeno 分组 + 排序
  //      "最多的" + 设施 dataset + 没明确 topN → 默认 top 5
  if (['inlets', 'joints', 'regulators'].includes(dataset) && /最多|分布|哪些管线|每条管线/.test(q)) {
    const grouped = new Map<string, number>()
    for (const r of rows as any[]) {
      const k = r.pipeno || '(无管线号)'
      grouped.set(k, (grouped.get(k) || 0) + 1)
    }
    const sorted = Array.from(grouped.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN?.n ?? 5)
    const total = sorted.reduce((s, [_, c]) => s + c, 0)
    return {
      text: `${datasetLabel}${filterDesc}按 **管线号** 分组，**最多** 的几条：\n\n` +
        sorted.map(([k, c], i) => `${i + 1}. **${k}** — ${c} 个${datasetLabel}（占 ${(c / rows.length * 100).toFixed(0)}%）`).join('\n') +
        `\n\n📊 Top ${sorted.length} 共 ${total} 个 / 总 ${rows.length} 个。`,
      totalCount: rows.length,
      table: {
        headers: ['排名', '管线号', `${datasetLabel}数`, '占比'],
        rows: sorted.map(([k, c], i) => ({
          排名: i + 1,
          管线号: k,
          [`${datasetLabel}数`]: c,
          占比: `${(c / rows.length * 100).toFixed(1)}%`,
        })),
      },
      chart: sorted.length > 1 ? {
        type: 'bar',
        title: `各管线${datasetLabel}分布`,
        xField: 'name',
        yField: 'value',
        data: sorted.map(([k, c]) => ({ name: k, value: c })),
      } : undefined,
      mapDataset: dataset as any,
      mapCommunity: matchCommunity(q) || undefined,
      mapFocus: 'filtered',
      sql: `按 pipeno 分组 | sort desc | top ${sorted.length} | filter: ${filterDesc}`,
    }
  }

  // 2) 长度求和（管线专属）
  if (dataset === 'pipes' && (isSumIntent(q) || /总长|长度/.test(q))) {
    const typedRows: any[] = rows
    if (typedRows.length === 0) {
      return {
        text: `${datasetLabel}${filterDesc}没有可统计的管线。\n\n请输入更多的信息，以便更精准地查询；\n请连接网络，以便检索更多消息；
在数据库中补充更多有效数据。\n\n💡 试试：\n- 加上明确的小区（七里 / 三里 / 六里 / 全部）\n- 减少过滤条件（去掉压力、管径、材质等）`,
        totalCount: 0,
        mapDataset: 'pipes',
        mapCommunity: matchCommunity(q) || undefined,
        sql,
      }
    }
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
        text: `${datasetLabel}${filterDesc}没有可聚合的测量值。\n\n请输入更多的信息，以便更精准地查询；\n请连接网络，以便检索更多消息；
在数据库中补充更多有效数据。\n\n💡 试试：\n- 加上明确的小区（七里 / 三里 / 六里 / 全部）\n- 加上具体检测项（管地电位 / 土壤电阻率 / 牺牲阳极 / 绝缘接头）\n- 减少过滤条件（去掉时间、检测员等）`,
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
    const listTableSpec = buildCountTable(dataset, rows)
    if (rows.length === 0) {
      return {
        text: `未找到符合条件的${datasetLabel}。\n\n请输入更多的信息，以便更精准地查询；\n请连接网络，以便检索更多消息；
在数据库中补充更多有效数据。\n\n💡 试试：\n- 加上明确的小区（七里 / 三里 / 六里 / 全部）\n- 换一种对象（管线 / 调压箱 / 引入口 / 控制单元 / 检测项）\n- 减少过滤条件（去掉压力、管径、材质等）`,
        totalCount: 0,
        mapDataset: (['pipes','inlets','controls','joints','regulators'] as readonly string[]).includes(dataset) ? (dataset as 'pipes' | 'inlets' | 'controls' | 'joints' | 'regulators') : undefined,
        mapCommunity: matchCommunity(q) || undefined,
        sql,
      }
    }
    return {
      text: `${datasetLabel}${filterDesc}共 **${rows.length}** ${countUnit(dataset)}，展示前 ${Math.min(50, rows.length)} 条。${listTableSpec.summary || ''}`,
      totalCount: rows.length,
      table: { headers: listTableSpec.headers, rows: listTableSpec.rows },
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
        text: `已为您筛选${datasetLabel}${filterDesc}，共 **${rows.length}** ${countUnit(dataset)}。`,
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
  // 命中 0 条 → 引导用户输入更多信息 / 联网
  if (rows.length === 0) {
    return {
      text: `未找到与查询条件匹配的信息。\n\n请输入更多的信息，以便更精准地查询；\n请连接网络，以便检索更多消息；
在数据库中补充更多有效数据。\n\n💡 试试：\n- 加上明确的小区（七里 / 三里 / 六里 / 全部）\n- 加上具体对象（管线 / 调压箱 / 引入口 / 控制单元 / 检测项）\n- 加上聚合动作（多少 / 总长 / 平均 / 分布 / 异常）`,
      totalCount: 0,
      sql,
    }
  }
  return {
    text: `已为您筛选${datasetLabel}${filterDesc}，共 **${rows.length}** ${countUnit(dataset)}。试试加 "总长"、"多少"、"分布"、"按材质"、"异常" 等关键词。`,
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
  { tag: '报告', label: '📊 生成综合概览报告', query: '出一份总报告' },
  { tag: '报告', label: '📊 综合概览报告（七里）', query: '七里综合概览报告' },
  { tag: '报告', label: '📊 综合概览报告（六里）', query: '六里综合概览报告' },
  { tag: '报告', label: '⚠️ 异常检测报告', query: '异常检测报告' },
  { tag: '报告', label: '🏗️ 物探数据报告', query: '物探报告' },
  { tag: '报告', label: '📍 设施分布报告', query: '设施分布报告' },
  { tag: '报告', label: '📈 进度分析报告', query: '进度分析报告' },
  { tag: '报告', label: '🔍 管地电位专项报告', query: '管地电位专项报告' },
  { tag: '报告', label: '🔍 土壤电阻率专项报告', query: '土壤电阻率专项报告' },
  { tag: '对比', label: '🆚 七里和三里管线长度对比', query: '七里和三里管线长度对比' },
  { tag: '对比', label: '🆚 三里和六里调压箱数量对比', query: '三里和六里调压箱数量对比' },
  { tag: '对比', label: '🆚 各小区异常记录数对比', query: '各小区异常记录数对比' },
  { tag: '对比', label: '🆚 七里六里腐控单元进度对比', query: '七里和六里腐控单元进度对比' },
  { tag: '对比', label: '🆚 各小区管线总长对比', query: '各小区管线总长度对比' },
  { tag: '反查', label: '🔍 FSKZ755853 在哪个小区？', query: 'FSKZ755853 在哪个小区' },
  { tag: '反查', label: '🔍 N54R328A067 在哪？', query: 'N54R328A067 在哪里' },
  { tag: '反查', label: '🔍 1号楼有哪些设施？', query: '1号楼有哪些设施' },
  { tag: '反查', label: '🔍 2号楼四单元在哪？', query: '2号楼四单元在哪' },
  { tag: '破损点', label: '🕳️ 三里的破损点', query: '三里的破损点' },
  { tag: '破损点', label: '🕳️ FSKZ755856 的破损点', query: 'FSKZ755856 的破损点' },
  { tag: '破损点', label: '🕳️ 1号楼的破损点', query: '1号楼的破损点' },
  { tag: '破损点', label: '🕳️ 破损点有几个', query: '破损点有几个' },
  { tag: '破损点', label: '🕳️ 全部破损点位置', query: '所有破损点位置' },
  { tag: '跨小区', label: '🔀 三里和七里一共有几个引入口', query: '三里和七里一共有几个引入口' },
  { tag: '跨小区', label: '🔀 三里、六里一共多少调压箱', query: '三里、六里一共多少调压箱' },
  { tag: '跨小区', label: '🔀 三里加七里一共有多少管线', query: '三里加七里一共有多少管线' },
  { tag: '跨小区', label: '🔀 三个小区一共有多少控制单元', query: '三个小区一共有多少控制单元' },
  { tag: '跨小区', label: '🔀 南海家园一共有多少引入口', query: '南海家园一共有多少引入口' },
  { tag: 'Top', label: '🏆 进度最高的5个单元', query: '进度最高的5个单元' },
  { tag: 'Top', label: '🏆 最长的10条管线', query: '最长的10条管线' },
  { tag: 'Top', label: '🏆 三里引入口最多的管线', query: '三里引入口最多的管线' },
  { tag: 'Top', label: '🏆 最早的5条管线', query: '最早的5条管线' },
  { tag: 'Top', label: '🆚 FSKZ755853 跟 FSKZ755856 哪个进度高', query: 'FSKZ755853 跟 FSKZ755856 哪个进度高' },
  { tag: '进度', label: '📊 进度超过80%的单元有几个', query: '进度超过80%的单元有几个' },
  { tag: '进度', label: '📊 已经100%完成的单元', query: '已经100%完成的单元' },
  { tag: '时间', label: '⏰ 三里这周新增的异常', query: '三里这周新增的异常' },
  { tag: '时间', label: '⏰ 上个月新增的检测', query: '上个月新增的检测' },
  { tag: '检测员', label: '👤 检测员张三的所有记录', query: '检测员张三的所有记录' },
  { tag: '检测员', label: '👤 张三检测了多少个', query: '张三检测了多少个' },
  { tag: '检测员', label: '👤 张三今天检测了多少', query: '张三今天检测了多少' },
  { tag: '检测员', label: '👤 张三最常检测什么', query: '张三最常检测什么' },
  { tag: '检测员', label: '👤 检测员工作量排名', query: '检测员工作量' },
  { tag: '检测员', label: '👤 李四的检测', query: '李四的检测' },
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
