<script setup lang="ts">
/**
 * 智问模块 — 自然语言查询 + 统计 + 图表 + 地图 + LLM 兜底 + 智能提示
 * 纯前端方案，数据全在内存，LLM 走本地 Ollama / OpenAI 兼容 API
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick, reactive } from 'vue'
import { useRouter } from 'vue-router'
import * as echarts from 'echarts'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ChatDotRound, DataAnalysis, MapLocation, Histogram, PieChart, Setting, MagicStick, Aim, Connection, Download, Document,
} from '@element-plus/icons-vue'
import { useCpStore } from '@/stores/cp'
import { communityOfUnit } from '@/utils/community'
import { loadAMap } from '@/map/amap-loader'
import { loadZhiwenNetworkData, projectCpData } from '@/zhiwen/dataLoader'
import {
  runQuery, scoreConfidence, PRESET_QUERIES, buildLLMPrompt, planToText, planToSql,
  parseReportRequest, isRegenerateIntent, canMakeReportFromResult, countUnit,
  type ZhiwenData, type QueryResult, type ChartSpec, type LLMQueryPlan,
} from '@/zhiwen/engine'
import {
  generateReport, REPORT_TYPES, ITEM_CODES, buildFocusedReport,
  type Report, type ReportOptions,
} from '@/zhiwen/reportGenerator'
import { generateSuggestions, getSuggestionColor, type Suggestion } from '@/zhiwen/suggestions'
import {
  loadLLMConfig, saveLLMConfig, callLLM, pingLLM,
  DEFAULT_LLM_CONFIG, type LLMConfig,
} from '@/zhiwen/llm'
import { exportQueryResult, buildFileName, formatBytes, type ExportFormat } from '@/zhiwen/exporter'
import ReportCenter from './ReportCenter.vue'
import ReportPreview from './ReportPreview.vue'
import ReportSidebarPanel from './ReportSidebarPanel.vue'

const store = useCpStore()
const router = useRouter()

// ============== 状态 ==============
const question = ref('')
const loading = ref(false)
const dataLoading = ref(true)
const result = ref<QueryResult | null>(null)
const history = ref<Array<{ q: string; r: QueryResult; at: number; via?: 'rule' | 'llm' }>>([])
const activePresetTag = ref<string>('全部')

const chartRef = ref<HTMLDivElement | null>(null)
const mapRef = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null
let map: any = null
let AMap: any = null

const data = ref<ZhiwenData>({
  pipes: [], inlets: [], controls: [], joints: [], regulators: [],
  units: [], records: [], communities: [],
  topology: null,
})

// LLM 状态
const llmCfg = ref<LLMConfig>({ ...DEFAULT_LLM_CONFIG })
const llmStatus = ref<'off' | 'ready' | 'thinking'>('off')
const lastMethod = ref<'rule' | 'llm' | null>(null)

// 思考阶段：idle | thinking | knowing
//  - 规则引擎算出结果后不会立刻显示
//  - 随机等 2-5 秒（先显示"Thinking..."）
//  - 再等 0.5 秒（显示"I Know"）
//  - 最后才把结果渲染到答案区
const thinkingPhase = ref<'idle' | 'thinking' | 'knowing'>('idle')
const thinkingDots = ref('')
let thinkingTimer: number | null = null
let knowingTimer: number | null = null
let dotsTimer: number | null = null
const pendingResult = ref<QueryResult | null>(null)
const pendingText = ref('')

function clearThinkingTimers() {
  if (thinkingTimer !== null) window.clearTimeout(thinkingTimer)
  if (knowingTimer !== null) window.clearTimeout(knowingTimer)
  if (dotsTimer !== null) window.clearInterval(dotsTimer)
  thinkingTimer = null
  knowingTimer = null
  dotsTimer = null
}

// 设置弹窗
const settingsOpen = ref(false)
const settingsForm = reactive<LLMConfig>({ ...DEFAULT_LLM_CONFIG })
const testing = ref(false)

// 智能提示
const suggestions = ref<Suggestion[]>([])

// Tab 切换：智问 / 报告中心
const activeTab = ref<'chat' | 'report'>('chat')

// 导出相关
const exporting = ref(false)
const exportDialogOpen = ref(false)
const exportForm = reactive<{
  format: ExportFormat
  columns: string[]
  range: 'all' | 'top'
  topN: number
}>({
  format: 'xlsx',
  columns: [],
  range: 'all',
  topN: 100,
})
const exportLastResult = ref<{ fileName: string; sizeBytes: number } | null>(null)

// 报告调参 dialog
const reportParamsOpen = ref(false)
const reportParamsForm = reactive<{
  community: string
  itemCode: string
}>({
  community: '全部',
  itemCode: 'PIPE_GROUND_POTENTIAL',
})

// ============== 加载数据 ==============
async function loadData() {
  dataLoading.value = true
  try {
    const [net] = await Promise.all([
      loadZhiwenNetworkData(),
      store.loadAll(),
    ])
    const communityByUnit = Object.fromEntries(store.units.map((unit) => [unit.id, communityOfUnit(unit)]))
    const cp = projectCpData(store.units as any, store.records as any, communityByUnit)
    data.value = {
      pipes: net.pipes,
      inlets: net.inlets,
      controls: net.controls,
      joints: net.joints,
      regulators: net.regulators,
      units: cp.units,
      records: cp.records,
      communities: net.communities,
      topology: net.topology,
    }
    // 加载完显示数据源提示
    if (net.topology) {
      const { rawLines, rawPoints, source } = net.topology
      ElMessage.success(`已加载物探数据：${rawLines.length} 条线段 + ${rawPoints.length} 个拓扑点（${source.split('：')[1] || source}）`)
    }
    // 加载完数据后刷新智能提示
    suggestions.value = generateSuggestions(data.value)
  } catch (e) {
    console.error(e)
    ElMessage.error('数据加载失败：' + (e as Error).message)
  } finally {
    dataLoading.value = false
  }
}

onMounted(async () => {
  // 加载 LLM 配置
  llmCfg.value = loadLLMConfig()
  llmStatus.value = llmCfg.value.enabled ? 'ready' : 'off'
  await loadData()
  await nextTick()
  initMap()
})

// ============== 查询执行 ==============
async function ask(q?: string) {
  const text = (q ?? question.value).trim()
  if (!text) {
    ElMessage.warning('请输入您想问的问题')
    return
  }
  loading.value = true
  lastMethod.value = null
  clearThinkingTimers()
  thinkingPhase.value = 'idle'
  pendingResult.value = null
  pendingText.value = ''

  // 0) 报告快捷意图：用户说"重新生成"且当前有报告 → 用原参数再生成
  if (isRegenerateIntent(text) && result.value?.isReport) {
    regenerateReport(result.value.reportOptions || { community: result.value.report?.community })
    loading.value = false
    return
  }

  try {
    // 1) 评估规则引擎置信度
    const conf = scoreConfidence(text)
    console.log('[智问] 规则置信度:', conf)

    if (conf.score >= 0.4) {
      // 走规则
      const r = enrichMap(runQuery(text, data.value), text, data.value)
      lastMethod.value = 'rule'
      // 普通反查跳转主地图；纯位置查询留在智问页使用右侧地图展示。
      if (r.mapMatchedKey) {
        const key = r.mapMatchedKey
        if (r.isLocationOnly) {
          history.value.unshift({ q: text, r, at: Date.now(), via: 'rule' })
          scheduleReveal(r, text)
        } else {
          result.value = r
          history.value.unshift({ q: text, r, at: Date.now(), via: 'rule' })
          router.push({ path: '/map', query: { focus: key } })
        }
      } else {
        // 走"思考 → I Know → 出结果"动画
        history.value.unshift({ q: text, r, at: Date.now(), via: 'rule' })
        scheduleReveal(r, text)
      }
    } else if (text.length >= 3 && llmCfg.value.enabled && conf.score > 0) {
      // 走 LLM 兜底（排除太短的问题，比如 "hi"）
      // 关键：必须至少有 1 个弱信号（如某个数据集关键词/小区名）才调 LLM
      //  score=0 时直接走 fallback，避免 LLM 对完全无关问题（比如"你知道点啥啊你"）胡乱拼凑结果
      // LLM 路径：用同样的动画包装
      const r = await askViaLLM(text)
      lastMethod.value = 'llm'
      if (r) {
        history.value.unshift({ q: text, r, at: Date.now(), via: 'llm' })
        scheduleReveal(r, text)
      }
    } else {
      // 规则不行 / LLM 没开 / score=0（输入完全不相关）— 给出引导，不绘制误导性的默认地图数据。
      const fallbackResult: QueryResult = enrichMap({
        text: `未找到与「${text}」匹配的信息。\n\n请输入更多的信息，以便更精准地查询；\n请连接网络，以便检索更多消息；
在数据库中补充更多有效数据。\n\n💡 试试：\n1. 加上明确的关键词（小区、管线、调压箱、检测项）\n2. 加上聚合词（多少、总长、平均、分布、异常）\n3. 在右上角 ⚙ 开启 LLM 兜底，让本地大模型帮你解析`,
        sql: `未匹配到：${conf.reasons.join('、') || '无任何维度（输入完全不相关）'}`,
      }, text, data.value)
      lastMethod.value = 'rule'
      history.value.unshift({ q: text, r: fallbackResult, at: Date.now(), via: 'rule' })
      scheduleReveal(fallbackResult, text)
    }

    if (history.value.length > 20) history.value.pop()
    question.value = q ? text : question.value
    // 注意：result 渲染由 scheduleReveal 控制（在 thinking 完成后才设 result.value）
    // 反查命中已在上面直接 return，不会到这里
  } catch (e) {
    console.error(e)
    ElMessage.error('查询失败：' + (e as Error).message)
    // 出错时清掉 thinking 状态，避免遮罩卡住
    thinkingPhase.value = 'idle'
    clearThinkingTimers()
  } finally {
    // 思考动画期间 loading 保持 true（让按钮的 loading 圈也亮着）
    // thinking 完成后 scheduleReveal 内部会设 result.value（但 loading 不再变）
    // 这里我们让 loading 立即变 false，按钮立即可点（动画本身由遮罩控制）
    loading.value = false
    llmStatus.value = llmCfg.value.enabled ? 'ready' : 'off'
  }
}

/** 调 LLM 兜底 */
async function askViaLLM(text: string): Promise<QueryResult | null> {
  llmStatus.value = 'thinking'
  const { system, user } = buildLLMPrompt(text, data.value)

  let plan: LLMQueryPlan | null = null
  let llmRaw = ''
  try {
    llmRaw = await callLLM(llmCfg.value, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], { json: true })
    // 尝试解析 JSON（兼容模型偶尔包了代码块的情况）
    const cleaned = llmRaw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
    plan = JSON.parse(cleaned)
  } catch (e) {
    console.error('[LLM] 解析失败', e, llmRaw)
    ElMessage.warning('LLM 返回无法解析，已切换为兜底建议')
    return {
      text: `LLM 兜底调用失败：${(e as Error).message}\n\n建议：检查右上角 ⚙ LLM 配置是否正确。`,
      sql: llmRaw.slice(0, 500),
    }
  }

  if (!plan || !plan.dataset) {
    return {
      text: `LLM 也无法理解这个问题。原始返回：${llmRaw.slice(0, 200)}`,
      sql: `LLM plan: ${JSON.stringify(plan)}`,
    }
  }

  // 把 LLM plan 转成自然语言 query，让 runQuery 算出真实数字
  const syntheticQuery = planToText(plan)
  const r = enrichMap(runQuery(syntheticQuery, data.value), text, data.value)
  // 用 LLM 的思路 + 引擎的精确数字生成最终答案
  const answer = plan.answer
    ? `${plan.answer}\n\n${r.text}`
    : r.text

  return {
    ...r,
    text: answer,
    sql: planToSql(plan, r) + `\n[合成查询] ${syntheticQuery}\n[LLM 原始] ${llmRaw.slice(0, 200)}`,
  }
}

function clearResult() {
  result.value = null
  chart?.clear()
  clearMap()
}

/**
 * 触发"思考 → I Know → 出结果"动画
 *  - 先把结果暂存 pendingResult
 *  - 进入 thinking 阶段 2-5 秒（随机）
 *  - 再进入 knowing 阶段 0.5 秒（"I Know"）
 *  - 最后才把结果放出去显示
 *  - 期间按钮 loading=true，result 仍为 null（被 thinking 遮罩盖住）
 */
function scheduleReveal(r: QueryResult, text: string) {
  pendingResult.value = r
  pendingText.value = text
  thinkingPhase.value = 'thinking'
  thinkingDots.value = ''
  // 清除旧 timer
  clearThinkingTimers()
  // 随机 2-5 秒
  const thinkMs = 2000 + Math.floor(Math.random() * 3000)
  // 跑点动画（每 350ms 切 0/1/2/3 个点）
  let n = 0
  dotsTimer = window.setInterval(() => {
    n = (n + 1) % 4
    thinkingDots.value = '.'.repeat(n)
  }, 350)
  // 切到 "I Know"
  thinkingTimer = window.setTimeout(() => {
    if (dotsTimer) { window.clearInterval(dotsTimer); dotsTimer = null }
    thinkingPhase.value = 'knowing'
    // 0.5s 后真正显示结果
    knowingTimer = window.setTimeout(() => {
      thinkingPhase.value = 'idle'
      result.value = r
      pendingResult.value = null
      pendingText.value = ''
      // 触发图表/地图渲染
      renderChart(r.chart)
      renderMap(r)
    }, 500)
  }, thinkMs)
}

/**
 * 用户点"跳过"：立即结束思考动画，直接展示结果
 */
function skipThinking() {
  clearThinkingTimers()
  const r = pendingResult.value
  thinkingPhase.value = 'idle'
  pendingResult.value = null
  pendingText.value = ''
  if (r) {
    result.value = r
    renderChart(r.chart)
    renderMap(r)
  }
}

// ============== 导出 ==============
/**
 * 两步确认导出：
 *   1. 先问"是否要导出"（用户原意）
 *   2. 确认后再问"以什么格式导出"（含列选择 + 行数范围）
 */
async function askExport() {
  if (!result.value || !result.value.table) {
    ElMessage.warning('当前结果没有表格数据，无法导出')
    return
  }
  try {
    // 步骤 1：先问要不要导出
    await ElMessageBox.confirm(
      `当前查询命中 **${result.value.totalCount ?? result.value.table.rows.length}** ${currentUnit.value}，已展示前 ${Math.min(50, result.value.table.rows.length)} ${currentUnit.value}。\n\n是否导出数据？`,
      '📥 导出确认',
      {
        confirmButtonText: '导出',
        cancelButtonText: '取消',
        type: 'info',
        dangerouslyUseHTMLString: false,
      },
    )
  } catch {
    // 用户点了取消
    return
  }
  // 步骤 2：打开格式选择弹窗
  exportForm.columns = [...result.value.table.headers]  // 默认全选
  exportForm.format = 'xlsx'
  exportForm.range = 'all'
  exportForm.topN = Math.min(100, result.value.table.rows.length)
  exportLastResult.value = null
  exportDialogOpen.value = true
}

/** 实际执行导出 */
async function doExport() {
  if (!result.value) return
  exporting.value = true
  try {
    const maxRows = exportForm.range === 'all' ? undefined : exportForm.topN
    const r = await exportQueryResult(result.value, {
      format: exportForm.format,
      question: history.value[0]?.q || '查询',
      columns: exportForm.columns,
      maxRows,
    })
    if (r.ok) {
      exportLastResult.value = { fileName: r.fileName, sizeBytes: r.sizeBytes }
      ElMessage.success(`已导出：${r.fileName}（${formatBytes(r.sizeBytes)}）`)
    } else {
      ElMessage.error('导出失败：' + r.error)
    }
  } finally {
    exporting.value = false
  }
}

/** 导出后再次下载（弹窗关闭后也可点） */
function downloadAgain() {
  if (!exportLastResult.value) return
  // 直接重跑一遍导出（浏览器不会重复弹下载）
  doExport()
}

// ============== 报告处理 ==============

/** 当前问题是否足以出针对性报告（任何有结论的 query 都可以） */
function canMakeFocusedReport(r: QueryResult): boolean {
  return !!(r.text || r.table || r.chart)
}

/** 当前 query 文本（从历史最后一条取） */
function currentQuestionText(): string {
  return history.value[0]?.q || question.value || '查询结果'
}

/**
 * 针对当前 query 出"只讲这个事"的报告。
 * 跟综合概览报告不同，章节只包含这次结果相关的指标/图表/表格/结论。
 */
function makeFocusedReport() {
  if (!result.value) {
    ElMessage.warning('请先发起一次查询')
    return
  }
  const q = currentQuestionText()
  const community = result.value.mapCommunity || result.value.report?.community || '全部小区'
  const focused = buildFocusedReport({
    question: q,
    result: {
      text: result.value.text,
      table: result.value.table,
      chart: result.value.chart,
      totalCount: result.value.totalCount,
      mapCommunity: result.value.mapCommunity,
      sql: result.value.sql,
    },
    community,
  })
  // 把 result 升级成"显示报告"形态
  result.value = {
    ...result.value,
    isReport: true,
    report: focused,
    reportOptions: { community },
    text: `✅ 已基于当前问题"${q}"生成针对性报告。\n\n${focused.sections[0]?.data || ''}\n\n💡 工具栏可下载 PDF。`,
  }
  // 入历史
  history.value.unshift({
    q: q,
    r: result.value,
    at: Date.now(),
  })
  if (history.value.length > 20) history.value.pop()
  // 滚到报告
  nextTick(() => {
    const el = document.querySelector('.report-preview')
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

/** 重新生成报告（用同参数） */
function regenerateReport(options: ReportOptions) {
  if (!result.value?.report) return
  const r = result.value.report as Report
  const newReport = generateReport(r.type, data.value, options)
  result.value = {
    ...result.value,
    report: newReport,
    reportOptions: options,
    text: `✅ 已为您重新生成【${REPORT_TYPES.find((t) => t.type === r.type)?.title}】`,
    sql: `报告类型: ${REPORT_TYPES.find((t) => t.type === r.type)?.title}\n数据范围: ${options.community}${options.itemCode ? `\n检测项: ${ITEM_CODES.find((c) => c.code === options.itemCode)?.name || options.itemCode}` : ''}\n章节数: ${newReport.sections.length}`,
  }
  history.value.unshift({
    q: history.value[0]?.q || '报告生成',
    r: result.value,
    at: Date.now(),
  })
  ElMessage.success('已重新生成')
}

/** 打开调参 dialog */
function openReportParams() {
  if (!result.value?.report) return
  const r = result.value.report as Report
  reportParamsForm.community = r.community
  if (r.itemCode) reportParamsForm.itemCode = r.itemCode
  reportParamsOpen.value = true
}

/** 提交新参数重新生成 */
function submitReportParams() {
  if (!result.value?.report) return
  regenerateReport({
    community: reportParamsForm.community,
    itemCode: reportParamsForm.itemCode,
  })
  reportParamsOpen.value = false
}

/** 关闭报告 */
function closeReport() {
  result.value = null
  chart?.clear()
  clearMap()
}

/** 滚动到中间完整报告（由右侧报告摘要面板的"查看完整报告"触发） */
function scrollToFullReport() {
  nextTick(() => {
    const el = document.querySelector('.report-preview')
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

function usePreset(p: { label: string; query: string }) {
  question.value = p.query
  ask(p.query)
}

function useSuggestion(s: Suggestion) {
  question.value = s.query
  ask(s.query)
}

// ============== 地图增强 ==============
/** 社区中心点（用于控制单元/检测记录 overlay 的兜底定位） */
const COMMUNITY_CENTER: Record<string, [number, number]> = {
  '南海家园七里': [116.4940, 39.7570],
  '南海家园三里': [116.4970, 39.7620],
  '南海家园六里': [116.4920, 39.7550],
}

/**
 * enrichMap — 让每个查询结果都有合理的地图反馈
 *
 * 设计原则：
 *  - 空间数据集（pipes/regulators/joints/inlets/controls）：直接渲染
 *  - 非空间数据集（records/units）：生成 overlay（每个相关单元的位置）
 *  - 没匹配设施的兜底：显示全社区边界
 */
function enrichMap(r: QueryResult, query: string, d: ZhiwenData): QueryResult {
  // 颜色：按社区
  const communityColor: Record<string, string> = {
    '南海家园七里': '#409EFF',
    '南海家园三里': '#67C23A',
    '南海家园六里': '#E6A23C',
  }

  // 空结果只保留底图，不再自动补成“全管网”，避免给用户造成命中数据的错觉。
  if (!r.mapDataset && !r.mapOverlay?.length
      && (r.totalCount === 0 || r.text.startsWith('未找到') || r.sql.startsWith('未匹配到'))) {
    return r
  }

  // 1) 空间数据集已有 mapDataset：补上聚焦模式
  if (r.mapDataset && ['pipes', 'inlets', 'controls', 'joints', 'regulators'].includes(r.mapDataset)) {
    return {
      ...r,
      mapFocus: r.mapFocus || 'filtered',
      mapHighlight: r.mapCommunity ? communityColor[r.mapCommunity] : undefined,
    }
  }

  // 2) 非空间数据集（records / units）：用 overlay 模式
  if (!r.mapDataset) {
    // 推断：是否 records 或 units 相关
    const text = query
    const isUnitQuery = /腐控单元|控制单元|控制段|单元.*(?:进度|完成)|(?:进度|完成率|完成度).*单元/.test(text)
    const isRecordQuery = /检测|记录|检测项|管地电位|土壤电阻率|杂散电流|防腐层|涂层|绝缘|电联通|异常/.test(text)

    // 单元进度查询也含有“进度”等业务词，必须优先按单元结果生成标记。
    if (isUnitQuery) {
      const matchedUnits = matchUnitsFromResult(r, text, d.units)
      const overlay = matchedUnits.map((u) => {
        const center = COMMUNITY_CENTER[u.community] || [116.494, 39.757]
        return {
          lng: u.lng || center[0],
          lat: u.lat || center[1],
          type: '腐控单元',
          name: u.name,
          community: u.community,
          status: u.inspection_status,
        }
      })
      return {
        ...r,
        mapDataset: 'pipes',
        mapFocus: 'all',
        mapOverlay: overlay.length ? overlay : undefined,
        text: r.text + (overlay.length ? `\n\n🗺️ 地图已标出 ${overlay.length} 个腐控单元位置。` : ''),
      }
    }

    if (isRecordQuery) {
      // 取查询命中的 records（按 text 简单匹配 item_name/community/status）
      const matchedRecords = matchRecordsHeuristically(text, d.records)
      const communities = Array.from(new Set(matchedRecords.map((r) => r.community).filter(Boolean)))
      // 用社区中心 + unit 实际坐标（如果有）做 overlay
      const overlay = matchedRecords.slice(0, 50).map((rec) => {
        const u = d.units.find((u) => u.id === rec.unit_id)
        // 优先用 unit 的实际坐标，否则用社区中心
        const center = COMMUNITY_CENTER[rec.community] || [116.494, 39.757]
        return {
          lng: u?.lng || center[0],
          lat: u?.lat || center[1],
          type: '检测点',
          name: `${u?.name || ''} · ${rec.item_name}`,
          community: rec.community || '',
          status: rec.status,
        }
      })

      return {
        ...r,
        mapDataset: 'pipes',  // 用管线作为底图（社区范围内已有真实管线）
        mapCommunity: communities[0],
        mapOverlay: overlay.length ? overlay : undefined,
        mapFocus: communities.length ? 'all' : 'all',
        text: r.text + (overlay.length ? `\n\n🗺️ 地图已标出 ${overlay.length} 个相关检测点位置${communities.length ? '（' + communities.map(c => c.replace('南海家园', '')).join('、') + '）' : ''}。` : ''),
      }
    }

    // 3) 兜底：显示全管网（pipes）
    return {
      ...r,
      mapDataset: 'pipes',
      mapFocus: 'all',
    }
  }

  return r
}

/** 启发式 records 匹配（不严格，因为是辅助地图显示） */
function matchRecordsHeuristically(text: string, records: any[]): any[] {
  const community = matchCommunityFromText(text)
  const isException = /异常|不合格|exception/i.test(text)
  const isPassed = /通过|合格|passed/i.test(text)
  const itemMatch = text.match(/(管地电位|土壤电阻率|杂散电流|防腐层|涂层|绝缘|电联通|联通性|引入口参数)/)

  return records.filter((r) => {
    if (community && r.community !== community) return false
    if (isException && r.status !== 'exception') return false
    if (isPassed && r.status !== 'passed') return false
    if (itemMatch && !r.item_name?.includes(itemMatch[1])) return false
    return true
  })
}

function matchUnitsHeuristically(text: string, units: any[]): any[] {
  const community = matchCommunityFromText(text)
  const isException = /异常|exception/i.test(text)
  return units.filter((u) => {
    if (community && u.community !== community) return false
    if (isException && u.inspection_status !== 'exception') return false
    return true
  })
}

function matchUnitsFromResult(result: QueryResult, text: string, units: any[]): any[] {
  const table = result.table
  const nameIndex = table?.headers.findIndex((header) => /名称|单元/.test(header)) ?? -1
  if (table && nameIndex >= 0) {
    const nameHeader = table.headers[nameIndex]
    const names = new Set(table.rows.map((row) => {
      const value = Array.isArray(row) ? row[nameIndex] : row?.[nameHeader]
      return String(value ?? '').trim()
    }).filter(Boolean))
    const exact = units.filter((unit) => names.has(String(unit.name ?? '').trim()))
    if (exact.length) return exact
  }
  return matchUnitsHeuristically(text, units)
}

function matchCommunityFromText(text: string): string | null {
  if (/七里|QL/.test(text)) return '南海家园七里'
  if (/三里|SL/.test(text)) return '南海家园三里'
  if (/六里|LL/.test(text)) return '南海家园六里'
  return null
}

// ============== 图表 ==============
function renderChart(spec?: ChartSpec) {
  if (!chartRef.value) return
  if (!chart) chart = echarts.init(chartRef.value)
  if (!spec) { chart.clear(); return }
  const isPie = spec.type === 'pie'
  chart.setOption({
    tooltip: { trigger: isPie ? 'item' : 'axis' },
    legend: { bottom: 0, type: 'scroll' },
    grid: isPie ? undefined : { top: 30, left: 50, right: 20, bottom: 40 },
    xAxis: isPie ? undefined : { type: 'category', data: spec.data.map((d) => d.name), axisLabel: { rotate: 30 } },
    yAxis: isPie ? undefined : { type: 'value' },
    series: [{
      type: spec.type,
      radius: isPie ? '55%' : undefined,
      data: spec.data,
      label: isPie ? { formatter: '{b}: {c} ({d}%)' } : undefined,
    }],
  })
}

// ============== 地图 ==============
/** 浮动状态条 — 实时显示 AMap 加载状态，让用户不用开 F12 也能看到 */
const mapStatus = ref<{
  step: 'init' | 'loading' | 'created' | 'tiles-ok' | 'tiles-failed' | 'error'
  message: string
}>({ step: 'init', message: '准备初始化地图...' })
let mapProbeTimer: number | null = null
let mapFitTimer: number | null = null
let mapZoomTimer: number | null = null

function clearMapTimers() {
  if (mapProbeTimer !== null) window.clearTimeout(mapProbeTimer)
  if (mapFitTimer !== null) window.clearTimeout(mapFitTimer)
  if (mapZoomTimer !== null) window.clearTimeout(mapZoomTimer)
  mapProbeTimer = null
  mapFitTimer = null
  mapZoomTimer = null
}

async function initMap() {
  if (!mapRef.value) return
  mapStatus.value = { step: 'loading', message: '正在加载高德地图 JS API...' }
  try {
    AMap = await loadAMap()
    mapStatus.value = { step: 'created', message: 'AMap JS API 已加载，正在创建地图实例...' }
    map = new AMap.Map(mapRef.value, {
      zoom: 15,
      center: [116.494, 39.757],
      viewMode: '2D',
    })
    mapStatus.value = { step: 'created', message: '地图实例已创建，正在加载底图...' }
    map.on('complete', () => {
      if (mapProbeTimer !== null) window.clearTimeout(mapProbeTimer)
      mapProbeTimer = null
      mapStatus.value = { step: 'tiles-ok', message: '✅ 地图加载完成' }
    })
    mapProbeTimer = window.setTimeout(() => {
      mapProbeTimer = null
      if (mapStatus.value.step === 'created') {
        mapStatus.value = { step: 'tiles-failed', message: '⚠️ 底图加载较慢，请检查网络或地图配置' }
      }
    }, 5000)

    map.on('error', (e: any) => {
      console.error('[ZhiwenMap] map error event:', e)
    })
  } catch (e: any) {
    console.error('[ZhiwenMap] AMap 加载失败', e)
    mapStatus.value = { step: 'error', message: `❌ AMap JS API 加载失败：${e?.message || String(e)}` }
    if (mapRef.value) {
      mapRef.value.innerHTML = `
        <div style="padding:20px;color:#f56c6c;font-size:13px;line-height:1.6;background:#fef0f0;border:1px dashed #f56c6c;border-radius:6px;">
          <b>❌ 高德地图加载失败</b><br/>
          错误信息：${(e?.message || String(e)).replace(/</g, '&lt;')}<br/>
          <small style="color:#909399;">可能是 key 失效或网络受限。请打开 DevTools Console 看更多详情。</small>
        </div>
      `
    }
  }
}

function clearMap() {
  if (mapFitTimer !== null) window.clearTimeout(mapFitTimer)
  if (mapZoomTimer !== null) window.clearTimeout(mapZoomTimer)
  mapFitTimer = null
  mapZoomTimer = null
  if (map) map.clearMap()
}

function renderMap(r: QueryResult) {
  if (!map) return
  clearMap()

  const dataset = r.mapDataset
  const focus = r.mapFocus || 'filtered'
  const highlight = r.mapHighlight

  const colorMap: Record<string, string> = {
    '南海家园七里': '#409EFF',
    '南海家园三里': '#67C23A',
    '南海家园六里': '#E6A23C',
  }

  // 主图层可能为空（数据集未加载或类型不同），但 overlay 仍然有数据
  // — 这种情况要用 overlay 驱动视野，不能提前 return
  const hasOverlay = !!(r.mapOverlay && r.mapOverlay.length)
  const allRows = dataset ? ((data.value as any)[dataset] as any[] || []) : []

  // 决定要渲染哪些
  let toRender: any[] = []
  let toFade: any[] = []
  if (allRows.length > 0) {
    if (focus === 'all') {
      toRender = allRows
    } else if (r.mapCommunity) {
      toRender = allRows.filter((row) => row.community === r.mapCommunity)
      toFade = allRows.filter((row) => row.community !== r.mapCommunity)
    } else {
      toRender = allRows
    }
  }

  // 渲染主图层
  if (dataset === 'pipes' && allRows.length > 0) {
    toFade.forEach((p) => {
      new AMap.Polyline({
        path: p.coords,
        strokeColor: colorMap[p.community] || '#c0c4cc',
        strokeWeight: 1, strokeOpacity: 0.2, map,
      })
    })
    toRender.forEach((p) => {
      const color = highlight || colorMap[p.community] || '#409EFF'
      new AMap.Polyline({
        path: p.coords,
        strokeColor: color,
        strokeWeight: focus === 'all' ? 2 : 4,
        strokeOpacity: focus === 'all' ? 0.5 : 0.9,
        map,
      })
    })
  } else if (allRows.length > 0) {
    // points（调压箱/绝缘接头/引入口/控制单元）
    toFade.forEach((p) => {
      new AMap.Marker({
        position: [p.lng, p.lat], map,
        title: `${p.type || ''} ${p.name || p.fid}`,
        content: `<div style="background:#c0c4cc;width:6px;height:6px;border-radius:50%;border:1px solid #fff;opacity:0.4;"></div>`,
      })
    })
    toRender.forEach((p) => {
      const color = highlight || colorMap[p.community] || '#409EFF'
      new AMap.Marker({
        position: [p.lng, p.lat], map,
        title: `${p.type || ''} ${p.name || p.fid}`,
        content: `<div style="background:${color};width:12px;height:12px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 6px ${color}80;animation: pulse 1.2s ease-out;"></div>`,
      })
    })
  }

  // 渲染 overlay（编号反查匹配点 / 检测点）— 大标记 + 文字标签 + 第一个点开 InfoWindow
  const primaryMarker: any = null
  if (hasOverlay) {
    const statusColor: Record<string, string> = {
      passed: '#67c23a',
      exception: '#f56c6c',
      pending: '#909399',
      in_progress: '#e6a23c',
      completed: '#67c23a',
      matched: '#f56c6c',  // 编号反查用醒目红色
    }
    let firstMarker: any = null
    let firstOverlay: any = null
    r.mapOverlay!.forEach((o, idx) => {
      const isPrimary = o.isPrimary === true || idx === 0
      const color = statusColor[o.status || 'matched'] || colorMap[o.community] || '#f56c6c'
      // 大标记 + 序号标签，主点用红 + 数字 1
      const size = isPrimary ? 22 : 16
      const label = isPrimary ? '★' : String(idx + 1)
      const marker = new AMap.Marker({
        position: [o.lng, o.lat], map,
        title: `${o.name} · ${o.type || ''}`,
        content:
          `<div style="position:relative;">` +
            `<div style="background:${color};width:${size}px;height:${size}px;border-radius:50%;` +
              `border:3px solid #fff;box-shadow:0 0 12px ${color},0 0 4px rgba(0,0,0,0.4);` +
              `${isPrimary ? 'animation: pulse 1.5s ease-out infinite;' : ''}"></div>` +
            `<div style="position:absolute;top:-22px;left:50%;transform:translateX(-50%);` +
              `background:${color};color:#fff;font-size:11px;font-weight:700;` +
              `padding:1px 5px;border-radius:8px;white-space:nowrap;` +
              `box-shadow:0 1px 3px rgba(0,0,0,0.3);">${label}</div>` +
          `</div>`,
        zIndex: 200 + (r.mapOverlay!.length - idx),  // 主点 zIndex 最高
      })
      if (isPrimary) {
        firstMarker = marker
        firstOverlay = o
      }
    })

    // 给主点打开 InfoWindow，显示查询结果摘要
    if (firstMarker && firstOverlay) {
      const labelHtml =
        `<div style="padding:6px 4px;min-width:200px;">` +
          `<div style="font-weight:700;font-size:14px;color:#303133;margin-bottom:4px;">` +
            `${r.mapMatchedKey ? r.mapMatchedKey : firstOverlay.name}` +
          `</div>` +
          `<div style="color:#606266;font-size:12px;line-height:1.6;">` +
            `<div>类型：${firstOverlay.type || '设施'}</div>` +
            `<div>小区：${firstOverlay.community}</div>` +
            `${firstOverlay.name && firstOverlay.name !== (r.mapMatchedKey || firstOverlay.name) ? `<div>名称：${firstOverlay.name}</div>` : ''}` +
            `<div>坐标：${firstOverlay.lng.toFixed(6)}, ${firstOverlay.lat.toFixed(6)}</div>` +
          `</div>` +
        `</div>`
      const info = new AMap.InfoWindow({
        content: labelHtml,
        offset: new AMap.Pixel(0, -28),
        closeWhenClickMap: true,
      })
      info.open(map, firstMarker.getPosition())
    }
  }

  // 自适应视野：把主图层 + overlay 全收集起来，强制 fit
  mapFitTimer = window.setTimeout(() => {
    mapFitTimer = null
    if (!map) return

    const allPoints: Array<{ lng: number; lat: number }> = []
    toRender.forEach((p) => {
      if (dataset === 'pipes' && p.coords && p.coords.length) {
        p.coords.forEach((c: any) => allPoints.push({ lng: c[0], lat: c[1] }))
      } else if (p.lng && p.lat) {
        allPoints.push({ lng: p.lng, lat: p.lat })
      }
    })
    ;(r.mapOverlay || []).forEach((o) => {
      if (o.lng && o.lat) allPoints.push({ lng: o.lng, lat: o.lat })
    })

    if (allPoints.length === 0) return

    const lngs = allPoints.map((p) => p.lng)
    const lats = allPoints.map((p) => p.lat)
    const minLng = Math.min(...lngs)
    const maxLng = Math.max(...lngs)
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const center: [number, number] = [(minLng + maxLng) / 2, (minLat + maxLat) / 2]

    // 根据跨度计算 zoom
    const spanLng = maxLng - minLng
    const spanLat = maxLat - minLat
    const span = Math.max(spanLng, spanLat)
    let zoom: number
    if (allPoints.length === 1) zoom = 18
    else if (span < 0.0003) zoom = 19      // < 30m → 楼栋级
    else if (span < 0.0008) zoom = 18      // < 80m → 楼栋周边
    else if (span < 0.002) zoom = 17        // < 200m → 街区级
    else if (span < 0.005) zoom = 16        // < 500m → 街区+
    else if (span < 0.012) zoom = 15        // < 1.2km → 小区级
    else if (span < 0.03) zoom = 14         // < 3km
    else if (span < 0.08) zoom = 13         // < 8km
    else zoom = 12

    // 单点（编号反查单点匹配）— 直接 setZoomAndCenter，强制收紧视野
    if (allPoints.length === 1) {
      map.setZoomAndCenter(zoom, center, false, 600)
      if (r.isLocationOnly) {
        try {
          new AMap.Circle({
            center,
            radius: 18,
            strokeColor: '#f56c6c',
            strokeWeight: 3,
            strokeOpacity: 1,
            fillColor: '#f56c6c',
            fillOpacity: 0.12,
            zIndex: 150,
            map,
          })
          new AMap.Circle({
            center,
            radius: 35,
            strokeColor: '#f56c6c',
            strokeWeight: 1.5,
            strokeOpacity: 0.45,
            strokeStyle: 'dashed',
            fillColor: 'transparent',
            fillOpacity: 0,
            zIndex: 140,
            map,
          })
        } catch {
          // 地图 SDK 缺少 Circle 能力时仍保留原有点位标记。
        }
      }
      return
    }

    // 多点 — 用 setBounds 包住全部点，再强制 zoom
    try {
      map.setBounds(
        new AMap.Bounds([minLng, minLat], [maxLng, maxLat]),
        false,
        [80, 80, 80, 80],
      )
      mapZoomTimer = window.setTimeout(() => {
        mapZoomTimer = null
        if (map && map.getZoom() < zoom - 1) {
          map.setZoom(zoom, false, 600)
        }
      }, 200)
    } catch {
      map.setZoomAndCenter(zoom, center, false, 800)
    }
  }, 80)
}

// ============== 预设分类 ==============
const presetTags = computed(() => {
  const tags = new Set<string>(['全部'])
  PRESET_QUERIES.forEach((p) => tags.add(p.tag))
  return Array.from(tags)
})
const filteredPresets = computed(() => {
  if (activePresetTag.value === '全部') return PRESET_QUERIES
  return PRESET_QUERIES.filter((p) => p.tag === activePresetTag.value)
})

// ============== 数据概览 ==============
const overview = computed(() => ({
  pipes: data.value.pipes.length,
  regulators: data.value.regulators.length,
  inlets: data.value.inlets.length,
  joints: data.value.joints.length,
  controls: data.value.controls.length,
  units: data.value.units.length,
  records: data.value.records.length,
}))

const exceptionCount = computed(() => data.value.records.filter((r) => r.status === 'exception').length)

/**
 * 从当前 result 反推数据集类型
 *  - 用于显示"X 条/个" 等量词
 *  - 优先用 mapDataset（空间数据集都有）
 *  - 否则从 sql "数据源: X" 解析
 *  - 兜底：从 table headers 推断
 *  - 默认 'pipes'（最常见）
 */
function inferResultDataset(r: QueryResult | null): string {
  if (!r) return 'pipes'
  if (r.mapDataset) return r.mapDataset
  // 从 sql 解析
  const m = r.sql?.match(/数据源:\s*(\S+)/)
  if (m) {
    const labelToKey: Record<string, string> = {
      '管线': 'pipes', '引入口': 'inlets', '绝缘接头': 'joints',
      '调压箱': 'regulators', '控制单元': 'controls',
      '腐控单元': 'units', '检测记录': 'records',
    }
    if (labelToKey[m[1]]) return labelToKey[m[1]]
  }
  // 从 table headers 推断
  if (r.table?.headers?.length) {
    if (r.table.headers.includes('PIPENO')) return 'pipes'
    if (r.table.headers.includes('检测项')) return 'records'
    if (r.table.headers.includes('进度') && r.table.headers.includes('状态')) return 'units'
  }
  return 'pipes'
}

const currentDataset = computed(() => inferResultDataset(result.value))
const currentUnit = computed(() => countUnit(currentDataset.value))

const mapBadge = computed(() => {
  if (!result.value?.mapDataset) return ''
  const focus = result.value.mapFocus
  const community = result.value.mapCommunity?.replace('南海家园', '') || ''
  const overlay = result.value.mapOverlay?.length || 0
  let text = ''
  if (focus === 'all' && !community) text = '全小区视图'
  else if (community) text = `${community} 聚焦`
  else text = '聚焦视图'
  if (overlay) text += ` · 标注 ${overlay} 个点`
  return text
})

const llmStatusText = computed(() => ({
  off: 'LLM 关闭',
  ready: 'LLM 就绪',
  thinking: 'LLM 思考中...',
})[llmStatus.value])

const llmStatusColor = computed(() => ({
  off: '#909399',
  ready: '#67c23a',
  thinking: '#e6a23c',
})[llmStatus.value])

// ============== 设置 ==============
function openSettings() {
  Object.assign(settingsForm, llmCfg.value)
  settingsOpen.value = true
}

function saveSettings() {
  saveLLMConfig({ ...settingsForm })
  llmCfg.value = { ...settingsForm }
  llmStatus.value = settingsForm.enabled ? 'ready' : 'off'
  ElMessage.success('已保存')
  settingsOpen.value = false
}

async function testConnection() {
  testing.value = true
  try {
    const r = await pingLLM({ ...settingsForm })
    if (r.ok) ElMessage.success(r.message)
    else ElMessage.error(r.message)
  } finally {
    testing.value = false
  }
}

// ============== 工具 ==============
function handleResize() { chart?.resize() }

onBeforeUnmount(() => {
  clearThinkingTimers()
  clearMapTimers()
  chart?.dispose()
  if (map) map.destroy()
  map = null
  window.removeEventListener('resize', handleResize)
})

onMounted(() => {
  window.addEventListener('resize', handleResize)
})

watch(() => result.value?.chart, (s) => nextTick(() => renderChart(s)))

// 数据变化时刷新智能提示
watch(() => data.value.records.length, () => {
  suggestions.value = generateSuggestions(data.value)
})

function renderText(text: string) {
  return text.replace(/\*\*(.+?)\*\*/g, '<b style="color:#409EFF">$1</b>')
      .replace(/\n/g, '<br/>')
}
</script>

<template>
  <div class="zhiwen-page">
    <!-- 顶部：智问输入 -->
    <div class="zw-header">
      <div class="zw-title">
        <el-icon :size="22" color="#409EFF"><ChatDotRound /></el-icon>
        <span>智问 · 数据洞察</span>
        <el-tag size="small" type="info" effect="plain">纯前端 · 内网可跑</el-tag>
        <span class="llm-badge" :style="{ background: llmStatusColor + '20', color: llmStatusColor, borderColor: llmStatusColor }">
          <el-icon :size="12"><MagicStick /></el-icon>
          {{ llmStatusText }}
        </span>
        <div class="zw-tab">
          <div
            class="zw-tab-item"
            :class="{ active: activeTab === 'chat' }"
            @click="activeTab = 'chat'"
          >
            <el-icon><ChatDotRound /></el-icon> 智问问答
          </div>
          <div
            class="zw-tab-item"
            :class="{ active: activeTab === 'report' }"
            @click="activeTab = 'report'"
          >
            <el-icon><Document /></el-icon> 报告中心
          </div>
        </div>
      </div>
      <div class="zw-input">
        <el-input
          v-model="question"
          placeholder="试试：七里DN100以上管线总长 / 各小区调压箱数量 / 异常检测记录 / 土壤电阻率平均值"
          size="large"
          clearable
          @keyup.enter="ask()"
        >
          <template #prefix><el-icon><ChatDotRound /></el-icon></template>
        </el-input>
        <el-button type="primary" size="large" :loading="loading" @click="ask()">智问</el-button>
        <el-button size="large" :disabled="!result" @click="clearResult">清空</el-button>
        <el-button size="large" :icon="Setting" circle @click="openSettings" title="LLM 设置" />
      </div>
      <!-- 数据概览 -->
      <div class="zw-overview">
        <div class="ov-item">
          <span class="ov-num">{{ overview.pipes }}</span>
          <span class="ov-label">管线</span>
        </div>
        <div class="ov-item">
          <span class="ov-num" :style="exceptionCount > 0 ? { color: '#f56c6c' } : {}">{{ exceptionCount }}</span>
          <span class="ov-label">异常记录</span>
        </div>
        <div class="ov-item">
          <span class="ov-num">{{ overview.regulators }}</span>
          <span class="ov-label">调压箱</span>
        </div>
        <div class="ov-item">
          <span class="ov-num">{{ overview.inlets }}</span>
          <span class="ov-label">引入口</span>
        </div>
        <div class="ov-item">
          <span class="ov-num">{{ overview.joints }}</span>
          <span class="ov-label">绝缘接头</span>
        </div>
        <div class="ov-item">
          <span class="ov-num">{{ overview.controls }}</span>
          <span class="ov-label">控制单元</span>
        </div>
        <div class="ov-item">
          <span class="ov-num">{{ overview.units }}</span>
          <span class="ov-label">腐控单元</span>
        </div>
        <div class="ov-item">
          <span class="ov-num">{{ overview.records }}</span>
          <span class="ov-label">检测记录</span>
        </div>
      </div>
    </div>

    <!-- 主体：智问 tab -->
    <div v-if="activeTab === 'chat'" class="zw-body" v-loading="dataLoading">
      <!-- 左侧：预设 + 历史 -->
      <div class="zw-left">
        <div class="zw-card">
          <div class="zw-card-title">⚡ 快捷命令</div>
          <el-radio-group v-model="activePresetTag" size="small" class="zw-tag">
            <el-radio-button v-for="t in presetTags" :key="t" :label="t">{{ t }}</el-radio-button>
          </el-radio-group>
          <div class="zw-presets">
            <div v-for="(p, i) in filteredPresets" :key="i" class="preset-item" @click="usePreset(p)">
              {{ p.label }}
            </div>
          </div>
        </div>

        <div class="zw-card">
          <div class="zw-card-title">🕘 查询历史</div>
          <div v-if="!history.length" class="zw-empty">还没有查询</div>
          <div v-for="(h, i) in history" :key="i" class="hist-item" @click="ask(h.q)">
            <div class="hist-q">
              {{ h.q }}
              <el-tag v-if="h.via === 'llm'" size="small" type="warning" effect="plain" style="margin-left: 4px">LLM</el-tag>
              <el-tag v-else-if="h.via === 'rule'" size="small" type="success" effect="plain" style="margin-left: 4px">规则</el-tag>
            </div>
            <div class="hist-meta">{{ h.r.text.slice(0, 40).replace(/\*\*/g, '') }}...</div>
          </div>
        </div>
      </div>

      <!-- 中间：答案区 -->
      <div class="zw-main">
        <div v-if="!result || thinkingPhase !== 'idle'" class="zw-welcome">
          <!-- 思考中 / 我知道了：明显区域的思考动画 -->
          <div v-if="thinkingPhase === 'thinking' || thinkingPhase === 'knowing'" class="zw-thinking">
            <div class="zw-thinking-card" :class="`zw-thinking--${thinkingPhase}`">
              <div class="zw-thinking-orb">
                <span></span><span></span><span></span>
              </div>
              <div class="zw-thinking-text">
                <template v-if="thinkingPhase === 'thinking'">
                  Thinking<span class="zw-thinking-dots">{{ thinkingDots }}</span>
                </template>
                <template v-else>
                  <span class="zw-thinking-flash">I Know</span>
                </template>
              </div>
              <div v-if="pendingText" class="zw-thinking-question">「{{ pendingText }}」</div>
              <el-button
                size="small"
                plain
                class="zw-thinking-skip"
                @click="skipThinking"
              >跳过</el-button>
            </div>
          </div>

          <!-- 智能提示（默认欢迎页） -->
          <template v-else>
          <!-- 智能提示 -->
          <div v-if="suggestions.length" class="zw-suggestions">
            <div class="zw-suggestions-title">
              <el-icon :size="16" color="#409EFF"><Aim /></el-icon>
              <span>猜您想问</span>
              <el-tag size="small" type="info" effect="plain">基于当前数据动态生成</el-tag>
            </div>
            <div class="suggestion-grid">
              <div
                v-for="(s, i) in suggestions"
                :key="i"
                class="suggestion-card"
                :style="{ borderLeftColor: getSuggestionColor(s.kind) }"
                @click="useSuggestion(s)"
              >
                <div class="sug-icon">{{ s.icon }}</div>
                <div class="sug-body">
                  <div class="sug-title">{{ s.title }}</div>
                  <div class="sug-sub">{{ s.subtitle }}</div>
                </div>
              </div>
            </div>
          </div>

          <div class="zw-hints">
            <div class="hint-title">💡 支持的自然语言查询：</div>
            <ul>
              <li><b>数量类</b>：七里调压箱多少个 / 三里管线有多少</li>
              <li><b>统计类</b>：七里DN100以上管线总长 / 土壤电阻率平均值</li>
              <li><b>分布类</b>：管线压力分布 / 各小区管径分布 / 检测项异常分布</li>
              <li><b>过滤类</b>：三里低压管线 / 钢管 / DN200以上 / 中压A</li>
              <li><b>检测类</b>：管地电位最大 / 异常检测记录 / 进度异常的小区</li>
              <li><b>地图类</b>：六里调压箱 / 三里引入口</li>
              <li><b>自由问</b>：开启 LLM 兜底后，任何自然语言问题都能答 ✨</li>
            </ul>
          </div>
          </template>
        </div>

        <div v-else-if="!result.isLocationOnly">
          <div class="zw-answer" :class="`answer-${lastMethod}`">
            <el-icon :size="18" :color="lastMethod === 'llm' ? '#e6a23c' : '#67C23A'">
              <MagicStick v-if="lastMethod === 'llm'" />
              <ChatDotRound v-else />
            </el-icon>
            <span v-html="renderText(result.text)" />
            <div class="zw-answer-actions">
              <el-tag v-if="lastMethod === 'llm'" size="small" type="warning" effect="dark">LLM 兜底</el-tag>
              <el-tag v-else-if="result.isReport" size="small" type="primary" effect="dark">📄 报告</el-tag>
              <el-tag v-else size="small" type="success" effect="dark">规则引擎</el-tag>
              <el-button
                v-if="!result.isReport && canMakeFocusedReport(result)"
                size="small"
                type="warning"
                plain
                :icon="Document"
                @click="makeFocusedReport"
              >
                出报告
              </el-button>
              <el-button
                v-if="result.table"
                size="small"
                type="primary"
                plain
                :icon="Download"
                @click="askExport"
              >
                导出
              </el-button>
            </div>
          </div>

          <!-- 报告（嵌入式 A4 排版） -->
          <ReportPreview
            v-if="result.isReport && result.report"
            :report="result.report"
            title-prefix="智问："
            :editable="true"
            @regenerate="regenerateReport"
            @update-params="openReportParams"
            @close="closeReport"
          />

          <div v-if="result.table" class="zw-card zw-table-card">
            <div class="zw-card-title">
              <el-icon><DataAnalysis /></el-icon> 详细数据
              <el-tag v-if="result.totalCount !== undefined" size="small">{{ result.totalCount }} {{ currentUnit }}</el-tag>
            </div>
            <el-table :data="result.table.rows" stripe border size="small" max-height="320">
              <el-table-column v-for="h in result.table.headers" :key="h" :prop="h" :label="h" :show-overflow-tooltip="true" />
            </el-table>
          </div>

          <div v-if="result.chart" class="zw-card zw-chart-card">
            <div class="zw-card-title">
              <el-icon><PieChart v-if="result.chart.type === 'pie'" /><Histogram v-else /></el-icon>
              {{ result.chart.title }}
            </div>
            <div ref="chartRef" class="zw-chart" />
          </div>
        </div>

        <div v-else class="zw-location-hint">
          <el-icon :size="22" color="#409EFF"><Aim /></el-icon>
          <div class="zw-location-hint-body">
            <div class="zw-location-hint-title">📍 {{ result.mapMatchedLabel || result.mapMatchedKey }}</div>
            <div class="zw-location-hint-sub">已在右侧地图标出位置，红色圆圈表示匹配设施</div>
          </div>
        </div>
      </div>

      <!-- 右侧：地图 + 报告摘要 -->
      <div class="zw-right">
        <!-- 地理视图小地图：反查命中时不显示（用户期望直接跳到地图页全屏查看） -->
        <div v-if="!result?.mapMatchedKey || result?.isLocationOnly" class="zw-card">
          <div class="zw-card-title">
            <el-icon><MapLocation /></el-icon> 地理视图
            <span v-if="mapBadge" class="map-title-extra">{{ mapBadge }}</span>
          </div>
          <div class="zw-map-wrap">
            <!-- 浮动状态条：实时显示地图加载状态（不用开 F12 也能看到） -->
            <div v-if="mapStatus.step !== 'tiles-ok'"
                 class="zw-map-status"
                 :class="`zw-map-status--${mapStatus.step}`">
              {{ mapStatus.message }}
            </div>
            <div v-if="result && result.mapDataset" class="zw-map-badge">
              <span class="dot"></span>
              <span>当前查询：{{ result.mapDataset }} {{ result.mapCommunity ? '(' + result.mapCommunity.replace('南海家园', '') + ')' : '（全小区）' }}{{ result.mapOverlay?.length ? ' · 标注 ' + result.mapOverlay.length + ' 个点' : '' }}</span>
            </div>
            <div v-else-if="result" class="zw-map-badge">
              <span class="dot"></span>
              <span>当前查询：综合查询（全小区）</span>
            </div>
            <div ref="mapRef" class="zw-map" :class="{ 'zw-map--with-report': result?.isReport && result?.report }" />
          </div>
          <div class="zw-legend">
            <span><i style="background:#409EFF"></i>七里</span>
            <span><i style="background:#67C23A"></i>三里</span>
            <span><i style="background:#E6A23C"></i>六里</span>
            <span><i style="background:#67c23a;border:2px solid #fff;box-shadow:0 0 6px #67c23a"></i>通过</span>
            <span><i style="background:#f56c6c;border:2px solid #fff;box-shadow:0 0 6px #f56c6c"></i>异常</span>
            <span><i style="background:#e6a23c;border:2px solid #fff;box-shadow:0 0 6px #e6a23c"></i>进行中</span>
          </div>
        </div>

        <!-- 报告摘要面板（出报告后才显示） -->
        <ReportSidebarPanel
          v-if="result?.isReport && result?.report"
          :report="result.report"
          @scroll-to-report="scrollToFullReport"
        />
      </div>
    </div>

    <!-- 报告中心 tab -->
    <ReportCenter v-if="activeTab === 'report'" :data="data" />

    <!-- 报告调参 dialog -->
    <el-dialog v-model="reportParamsOpen" title="⚙ 调整报告参数" width="500px">
      <el-alert type="info" :closable="false" style="margin-bottom: 16px">
        调整参数后会自动重新生成报告。
      </el-alert>
      <el-form :model="reportParamsForm" label-width="100px">
        <el-form-item label="数据范围">
          <el-radio-group v-model="reportParamsForm.community">
            <el-radio-button label="全部">全部小区</el-radio-button>
            <el-radio-button label="南海家园七里">七里</el-radio-button>
            <el-radio-button label="南海家园三里">三里</el-radio-button>
            <el-radio-button label="南海家园六里">六里</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="result?.report?.type === 'inspection'" label="检测项">
          <el-select v-model="reportParamsForm.itemCode" style="width: 100%">
            <el-option
              v-for="item in ITEM_CODES"
              :key="item.code"
              :label="item.name"
              :value="item.code"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reportParamsOpen = false">取消</el-button>
        <el-button type="primary" @click="submitReportParams">重新生成</el-button>
      </template>
    </el-dialog>

    <!-- LLM 设置弹窗 -->
    <el-dialog v-model="settingsOpen" title="⚙ LLM 兜底设置" width="560px" :close-on-click-modal="false">
      <el-alert type="info" :closable="false" style="margin-bottom: 16px">
        当规则引擎置信度不足时，自动调用本地 LLM 解析您的问题。<br>
        兼容 <b>Ollama</b> 原生 API 和 <b>OpenAI 风格</b> Chat Completions（支持 vLLM / LocalAI / LM Studio / 一键本地 GPT 等）。
      </el-alert>

      <el-form :model="settingsForm" label-width="100px" size="default">
        <el-form-item label="启用 LLM">
          <el-switch v-model="settingsForm.enabled" />
        </el-form-item>
        <el-form-item label="API 风格">
          <el-radio-group v-model="settingsForm.style">
            <el-radio-button label="ollama">Ollama</el-radio-button>
            <el-radio-button label="openai">OpenAI 兼容</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="Base URL">
          <el-input v-model="settingsForm.baseUrl" placeholder="http://localhost:11434" />
        </el-form-item>
        <el-form-item label="API Key">
          <el-input v-model="settingsForm.apiKey" type="password" show-password placeholder="Ollama 不需要；OpenAI 兼容需填" />
        </el-form-item>
        <el-form-item label="模型">
          <el-input v-model="settingsForm.model" placeholder="qwen2.5:7b / llama3.1 / gpt-4" />
        </el-form-item>
        <el-form-item label="Temperature">
          <el-slider v-model="settingsForm.temperature" :min="0" :max="1" :step="0.1" show-input />
          <div style="color: #909399; font-size: 12px">建议 0.1~0.3（越低越稳定，结构化输出）</div>
        </el-form-item>
        <el-form-item label="超时(秒)">
          <el-input-number v-model="settingsForm.timeoutMs" :min="5000" :max="120000" :step="5000" />
        </el-form-item>
      </el-form>

      <div style="background: #f5f7fa; padding: 10px; border-radius: 6px; font-size: 12px; color: #606266; line-height: 1.7">
        <b>Ollama 启动示例：</b><br>
        <code style="background: #fff; padding: 2px 6px; border-radius: 3px">ollama serve</code> 启动服务<br>
        <code style="background: #fff; padding: 2px 6px; border-radius: 3px">ollama pull qwen2.5:7b</code> 拉模型<br>
        Base URL 填：<code style="background: #fff; padding: 2px 6px; border-radius: 3px">http://localhost:11434</code>
      </div>

      <template #footer>
        <el-button :loading="testing" @click="testConnection">测试连接</el-button>
        <el-button @click="settingsOpen = false">取消</el-button>
        <el-button type="primary" @click="saveSettings">保存</el-button>
      </template>
    </el-dialog>

    <!-- 导出弹窗 -->
    <el-dialog
      v-model="exportDialogOpen"
      title="📥 导出数据"
      width="560px"
      :close-on-click-modal="false"
    >
      <div v-if="result?.table" class="export-meta">
        <el-descriptions :column="2" size="small" border>
          <el-descriptions-item label="命中行数">{{ result.totalCount ?? result.table.rows.length }}</el-descriptions-item>
          <el-descriptions-item label="列数">{{ exportForm.columns.length }} / {{ result.table.headers.length }}</el-descriptions-item>
          <el-descriptions-item label="查询问题" :span="2">
            <span style="color:#303133">{{ history[0]?.q || '查询' }}</span>
          </el-descriptions-item>
        </el-descriptions>
      </div>

      <el-form :model="exportForm" label-width="80px" style="margin-top: 16px">
        <el-form-item label="导出格式">
          <el-radio-group v-model="exportForm.format">
            <el-radio-button label="xlsx">
              📊 Excel (.xlsx)
            </el-radio-button>
            <el-radio-button label="csv">
              📄 CSV (.csv)
            </el-radio-button>
            <el-radio-button label="json">
              🔧 JSON (.json)
            </el-radio-button>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="导出范围">
          <el-radio-group v-model="exportForm.range">
            <el-radio-button label="all">全部行</el-radio-button>
            <el-radio-button label="top">前 N 行</el-radio-button>
          </el-radio-group>
          <el-input-number
            v-if="exportForm.range === 'top'"
            v-model="exportForm.topN"
            :min="1"
            :max="result?.table?.rows.length || 1"
            size="small"
            style="margin-left: 12px; width: 120px"
          />
        </el-form-item>

        <el-form-item label="导出列">
          <div class="export-columns">
            <el-checkbox
              :model-value="exportForm.columns.length === (result?.table?.headers.length || 0)"
              @change="(v: any) => v ? exportForm.columns = [...(result?.table?.headers || [])] : exportForm.columns = []"
            >
              全选
            </el-checkbox>
            <el-checkbox-group v-model="exportForm.columns" class="export-col-list">
              <el-checkbox
                v-for="h in result?.table?.headers || []"
                :key="h"
                :label="h"
                :value="h"
              />
            </el-checkbox-group>
          </div>
        </el-form-item>
      </el-form>

      <el-alert
        v-if="exportForm.format === 'xlsx'"
        type="info"
        :closable="false"
        style="margin-top: 8px"
      >
        Excel 文件包含 2 个 Sheet：<b>「查询结果」</b>（明细数据）和 <b>「查询元信息」</b>（问题、SQL、摘要等）
      </el-alert>

      <el-alert
        v-if="exportLastResult"
        type="success"
        :closable="false"
        style="margin-top: 8px"
        show-icon
      >
        ✅ 已导出 <b>{{ exportLastResult.fileName }}</b>（{{ formatBytes(exportLastResult.sizeBytes) }}）
      </el-alert>

      <template #footer>
        <el-button @click="exportDialogOpen = false">关闭</el-button>
        <el-button
          type="primary"
          :icon="Download"
          :loading="exporting"
          :disabled="!exportForm.columns.length"
          @click="doExport"
        >
          {{ exportForm.format === 'xlsx' ? '导出 Excel' : exportForm.format === 'csv' ? '导出 CSV' : '导出 JSON' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.zhiwen-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 60px);
  background: #f5f7fa;
}

.zw-header {
  background: #fff;
  padding: 16px 24px 12px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}

.zw-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 12px;
}

.llm-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  padding: 2px 8px;
  border: 1px solid;
  border-radius: 10px;
  margin-left: 8px;
  font-weight: normal;
}

.zw-tab {
  display: flex;
  margin-left: auto;
  background: #f5f7fa;
  border-radius: 8px;
  padding: 3px;
  gap: 2px;
}

.zw-tab-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 13px;
  color: #606266;
  cursor: pointer;
  transition: all 0.2s;
  font-weight: normal;
}

.zw-tab-item:hover {
  color: #409eff;
}

.zw-tab-item.active {
  background: #fff;
  color: #409eff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  font-weight: 500;
}

.zw-input {
  display: flex;
  gap: 8px;
  align-items: center;
}

.zw-input :deep(.el-input) { flex: 1; }

.zw-overview {
  display: flex;
  gap: 24px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed #ebeef5;
  flex-wrap: wrap;
}

.ov-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.ov-num {
  font-size: 18px;
  font-weight: 600;
  color: #409EFF;
}

.ov-label {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
}

.zw-body {
  flex: 1;
  display: grid;
  grid-template-columns: 280px 1fr 380px;
  gap: 12px;
  padding: 12px;
  overflow: hidden;
}

.zw-left, .zw-right {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}

.zw-main {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  padding-right: 4px;
}

.zw-card {
  background: #fff;
  border-radius: 8px;
  padding: 14px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}

.zw-card-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 10px;
}

.zw-tag { width: 100%; margin-bottom: 10px; display: flex; flex-wrap: wrap; }
.zw-tag :deep(.el-radio-button) { margin-right: 4px; margin-bottom: 4px; }

.zw-presets { display: flex; flex-direction: column; gap: 6px; }

.preset-item {
  padding: 8px 10px;
  background: #f5f7fa;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: #606266;
  transition: all 0.15s;
  border: 1px solid transparent;
}

.preset-item:hover {
  background: #ecf5ff;
  color: #409EFF;
  border-color: #b3d8ff;
}

.zw-empty { color: #c0c4cc; font-size: 12px; text-align: center; padding: 20px 0; }

.hist-item {
  padding: 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  border-bottom: 1px dashed #ebeef5;
}

.hist-item:hover { background: #f5f7fa; }

.hist-q { color: #303133; font-weight: 500; margin-bottom: 2px; }
.hist-meta { color: #909399; font-size: 11px; }

.zw-welcome {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
}

/* 智能提示 */
.zw-suggestions {
  margin-bottom: 20px;
}

.zw-suggestions-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 12px;
}

.suggestion-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.suggestion-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: #fafbfc;
  border-left: 3px solid #409eff;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.suggestion-card:hover {
  background: #ecf5ff;
  transform: translateX(2px);
  box-shadow: 0 2px 8px rgba(64, 158, 255, 0.15);
}

.sug-icon { font-size: 24px; flex-shrink: 0; }

.sug-body { flex: 1; min-width: 0; }

.sug-title {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sug-sub {
  font-size: 12px;
  color: #909399;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.zw-hints {
  background: #f5f7fa;
  padding: 16px 20px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.9;
  color: #606266;
}

.hint-title {
  font-weight: 600;
  color: #303133;
  margin-bottom: 6px;
}

.zw-hints ul { list-style: none; padding: 0; margin: 0; }
.zw-hints li { padding: 2px 0; }
.zw-hints b { color: #409EFF; margin-right: 6px; }

.zw-answer {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #f0f9ff;
  border: 1px solid #b3d8ff;
  border-radius: 8px;
  padding: 12px 16px;
  font-size: 15px;
  line-height: 1.6;
  color: #303133;
}

.zw-answer-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.zw-location-hint {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid #b3d8ff;
  border-radius: 8px;
  background: #f0f9ff;
  color: #303133;
}

.zw-location-hint-body {
  min-width: 0;
}

.zw-location-hint-title {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.5;
}

.zw-location-hint-sub {
  margin-top: 2px;
  color: #606266;
  font-size: 13px;
  line-height: 1.5;
}

:global(html.dark) .zw-location-hint {
  border-color: rgba(64, 158, 255, 0.42);
  background: rgba(64, 158, 255, 0.1);
  color: #e5eaf3;
}

:global(html.dark) .zw-location-hint-sub {
  color: #a3adc2;
}

.answer-llm {
  background: #fdf6ec;
  border-color: #f5dab1;
}

.zw-table-card, .zw-chart-card { flex-shrink: 0; }

.zw-chart { width: 100%; height: 280px; }

.zw-map {
  width: 100%;
  height: 420px;
  border-radius: 6px;
  background: #ebeef5;
  overflow: hidden;
  transition: height 0.3s ease;
}
.zw-map--with-report {
  height: 240px;
}

.zw-legend {
  display: flex;
  gap: 12px;
  margin-top: 8px;
  font-size: 12px;
  color: #606266;
  justify-content: center;
  flex-wrap: wrap;
}

.map-title-extra {
  margin-left: auto;
  font-size: 12px;
  color: #409EFF;
  font-weight: normal;
}

.zw-legend i {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 4px;
  vertical-align: middle;
}

.export-meta {
  background: #fafbfc;
  padding: 12px;
  border-radius: 6px;
}

.export-columns {
  width: 100%;
}

.export-col-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 8px;
  padding: 8px 12px;
  background: #fafbfc;
  border-radius: 6px;
  max-height: 180px;
  overflow-y: auto;
}

.zw-map-wrap {
  position: relative;
}

.zw-map-status {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 999;
  padding: 6px 12px;
  border-radius: 14px;
  font-size: 12px;
  font-weight: 500;
  background: rgba(50, 50, 50, 0.88);
  color: #fff;
  white-space: nowrap;
  max-width: 90%;
  overflow: hidden;
  text-overflow: ellipsis;
  z-index: 1000;
  pointer-events: none;
}
.zw-map-status--loading,
.zw-map-status--init {
  background: rgba(64, 158, 255, 0.92);
}
.zw-map-status--created,
.zw-map-status--tiles-failed {
  background: rgba(230, 162, 60, 0.92);
}
.zw-map-status--tiles-ok {
  background: rgba(103, 194, 58, 0.92);
}
.zw-map-status--error {
  background: rgba(245, 108, 108, 0.95);
  font-weight: 600;
}

.zw-map-badge {
  position: absolute;
  top: 10px;
  left: 10px;
  background: rgba(255, 255, 255, 0.95);
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  color: #303133;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: center;
  gap: 6px;
  z-index: 100;
  pointer-events: none;
}

.zw-map-badge .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #67c23a;
  animation: pulse-dot 1.5s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.4); opacity: 0.6; }
}

@keyframes pulse {
  0% { transform: scale(0.8); opacity: 0.6; }
  50% { transform: scale(1.3); opacity: 1; }
  100% { transform: scale(1); opacity: 0.9; }
}

/* AMap 内部元素继承动画 */
:deep(amap-marker),
:deep(.amap-marker) {
  transition: all 0.3s ease;
}

/* ============== 思考动画 ============== */
.zw-thinking {
  min-height: 360px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  border-radius: 8px;
  padding: 40px 20px;
}

.zw-thinking-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  padding: 36px 48px;
  border-radius: 16px;
  background: linear-gradient(135deg, #f0f9ff 0%, #ecf5ff 100%);
  border: 1px solid #b3d8ff;
  box-shadow: 0 8px 32px rgba(64, 158, 255, 0.12);
  min-width: 320px;
  animation: thinking-card-in 0.4s ease;
}

.zw-thinking--knowing {
  background: linear-gradient(135deg, #f0f9eb 0%, #e1f3d8 100%);
  border-color: #b3e19d;
  box-shadow: 0 8px 32px rgba(103, 194, 58, 0.18);
  animation: knowing-card-in 0.3s ease;
}

@keyframes thinking-card-in {
  0% { opacity: 0; transform: translateY(8px) scale(0.96); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes knowing-card-in {
  0% { opacity: 0.6; transform: scale(0.92); }
  60% { opacity: 1; transform: scale(1.05); }
  100% { opacity: 1; transform: scale(1); }
}

.zw-thinking-orb {
  position: relative;
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.zw-thinking-orb span {
  position: absolute;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #409EFF;
  animation: orb-bounce 1.2s ease-in-out infinite;
}

.zw-thinking-orb span:nth-child(1) {
  left: 4px;
  background: #409EFF;
  animation-delay: 0s;
}

.zw-thinking-orb span:nth-child(2) {
  left: 24px;
  background: #67C23A;
  animation-delay: 0.15s;
}

.zw-thinking-orb span:nth-child(3) {
  left: 44px;
  background: #E6A23C;
  animation-delay: 0.3s;
}

@keyframes orb-bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.5; }
  40% { transform: translateY(-16px); opacity: 1; }
}

.zw-thinking-text {
  font-size: 22px;
  font-weight: 600;
  color: #303133;
  letter-spacing: 0.5px;
  min-height: 32px;
  display: flex;
  align-items: center;
}

.zw-thinking-dots {
  display: inline-block;
  width: 28px;
  text-align: left;
  font-weight: 700;
  color: #409EFF;
  letter-spacing: 2px;
}

.zw-thinking-flash {
  color: #67C23A;
  font-weight: 700;
  font-size: 24px;
  animation: knowing-flash 0.5s ease;
}

@keyframes knowing-flash {
  0% { opacity: 0; transform: scale(0.7); }
  50% { opacity: 1; transform: scale(1.15); }
  100% { opacity: 1; transform: scale(1); }
}

.zw-thinking-question {
  max-width: 360px;
  padding: 8px 14px;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 6px;
  font-size: 13px;
  color: #606266;
  text-align: center;
  word-break: break-all;
  line-height: 1.5;
  border: 1px dashed #d9ecff;
}

.zw-thinking-skip {
  margin-top: 4px;
  font-size: 12px;
  opacity: 0.7;
  transition: opacity 0.2s;
}

.zw-thinking-skip:hover {
  opacity: 1;
}
</style>
