<script setup lang="ts">
/**
 * 报告中心
 *
 * 流程：选类型 → 选参数 → 预览 → 导出
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick, reactive } from 'vue'
import * as echarts from 'echarts'
import {
  Document, ArrowLeft, ArrowRight, Download, Printer, DataLine,
  Histogram, PieChart, ChatLineRound, Refresh,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  generateReport, REPORT_TYPES, ITEM_CODES,
  type Report, type ReportType, type ReportOptions,
} from '@/zhiwen/reportGenerator'
import { exportQueryResult, buildFileName, formatBytes } from '@/zhiwen/exporter'
import type { ZhiwenData } from '@/zhiwen/engine'

const props = defineProps<{ data: ZhiwenData }>()

// ============== 状态 ==============
type Step = 'select' | 'params' | 'preview'
const step = ref<Step>('select')
const selectedType = ref<ReportType | null>(null)
const options = reactive<ReportOptions>({
  community: '全部',
  itemCode: 'PIPE_GROUND_POTENTIAL',
})
const report = ref<Report | null>(null)
const generating = ref(false)

// 报告预览区多图表实例管理
const chartRefs = ref<Record<number, HTMLDivElement | null>>({})
const charts: Record<number, echarts.ECharts> = {}

// ============== 计算属性 ==============
const selectedTypeInfo = computed(() => REPORT_TYPES.find((r) => r.type === selectedType.value))

// ============== 步骤切换 ==============
function pickType(t: ReportType) {
  selectedType.value = t
  // 自动给 inspection 设置默认 item
  const info = REPORT_TYPES.find((r) => r.type === t)
  if (info?.needsItemCode) {
    options.itemCode = options.itemCode || 'PIPE_GROUND_POTENTIAL'
  }
  step.value = 'params'
}

function back() {
  if (step.value === 'preview') step.value = 'params'
  else if (step.value === 'params') step.value = 'select'
}

function next() {
  if (!selectedType.value) return
  generate()
}

function reset() {
  step.value = 'select'
  selectedType.value = null
  report.value = null
}

// ============== 生成报告 ==============
function generate() {
  if (!selectedType.value) return
  generating.value = true
  setTimeout(() => {
    try {
      report.value = generateReport(selectedType.value!, props.data, { ...options })
      step.value = 'preview'
      nextTick(() => renderAllCharts())
    } catch (e) {
      console.error(e)
      ElMessage.error('生成报告失败：' + (e as Error).message)
    } finally {
      generating.value = false
    }
  }, 100)
}

function regenerate() {
  generate()
}

// ============== 图表渲染 ==============
function renderAllCharts() {
  if (!report.value) return
  report.value.sections.forEach((sec, idx) => {
    if (sec.type === 'chart' && chartRefs.value[idx]) {
      const el = chartRefs.value[idx]!
      if (!charts[idx]) {
        charts[idx] = echarts.init(el)
        window.addEventListener('resize', () => charts[idx]?.resize())
      }
      const isPie = sec.data.type === 'pie'
      charts[idx].setOption({
        tooltip: { trigger: isPie ? 'item' : 'axis' },
        legend: { bottom: 0, type: 'scroll' },
        grid: isPie ? undefined : { top: 30, left: 50, right: 20, bottom: 40 },
        xAxis: isPie ? undefined : { type: 'category', data: sec.data.data.map((d: any) => d.name), axisLabel: { rotate: 30 } },
        yAxis: isPie ? undefined : { type: 'value' },
        series: [{
          type: sec.data.type,
          radius: isPie ? '55%' : undefined,
          data: sec.data.data,
          label: isPie ? { formatter: '{b}: {c} ({d}%)' } : undefined,
        }],
      })
    }
  })
}

function setChartRef(idx: number) {
  return (el: any) => {
    if (el) chartRefs.value[idx] = el.$el || el
  }
}

onBeforeUnmount(() => {
  Object.values(charts).forEach((c) => c?.dispose())
  window.removeEventListener('resize', () => {})
})

// ============== 导出 ==============

/** 打印为 PDF（用户选"另存为 PDF"） */
function printAsPDF() {
  if (!report.value) return
  // 加 print-mode class，CSS 隐藏非报告内容
  document.body.classList.add('report-printing')
  setTimeout(() => {
    window.print()
    setTimeout(() => document.body.classList.remove('report-printing'), 500)
  }, 100)
}

/** 导出 Excel（把报告里的所有表合并到一个工作簿，每个表一个 sheet） */
async function exportExcel() {
  if (!report.value) return
  try {
    // 把报告所有 section 合并成一张大表（每个 section 加 title 行）
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()

    // Sheet 1: 报告元信息
    const meta = [
      ['报告标题', report.value.title],
      ['报告副标题', report.value.subtitle],
      ['生成时间', report.value.generatedAt],
      ['数据范围', report.value.community],
      ['管线段数', report.value.meta.totalPipes],
      ['检测记录', report.value.meta.totalRecords],
      ['设施数量', report.value.meta.totalFacilities],
    ]
    const wsMeta = XLSX.utils.aoa_to_sheet(meta)
    wsMeta['!cols'] = [{ wch: 14 }, { wch: 60 }]
    XLSX.utils.book_append_sheet(wb, wsMeta, '报告元信息')

    // 其他 section 的表格
    report.value.sections.forEach((sec, i) => {
      if (sec.type === 'table' && sec.data?.rows?.length) {
        const ws = XLSX.utils.aoa_to_sheet([sec.data.headers, ...sec.data.rows.map((r: any) => sec.data.headers.map((h: string) => r[h]))])
        ws['!cols'] = sec.data.headers.map((h: string) => ({ wch: Math.max(10, h.length * 2 + 4) }))
        XLSX.utils.book_append_sheet(wb, ws, sec.title.slice(0, 28))  // sheet 名最长 31 字符
      }
    })

    const fileName = buildFileName(report.value.title.replace(/[📊⚠️🏗️📍📈🔍]/g, '').trim(), 'xlsx')
    XLSX.writeFile(wb, fileName)
    ElMessage.success(`已导出：${fileName}`)
  } catch (e) {
    console.error(e)
    ElMessage.error('导出失败：' + (e as Error).message)
  }
}

// ============== 工具 ==============
function renderSummary(text: string) {
  return text.replace(/\*\*(.+?)\*\*/g, '<b style="color:#409EFF">$1</b>').replace(/\n/g, '<br/>')
}

const communities = computed(() => ['全部', ...new Set(props.data.communities || [])])
</script>

<template>
  <div class="report-center">
    <!-- 顶部进度条 -->
    <div class="rc-steps">
      <div class="rc-step" :class="{ active: step === 'select', done: selectedType }">
        <span class="rc-step-num">1</span>
        <span class="rc-step-text">选择报告类型</span>
      </div>
      <div class="rc-step-line" :class="{ done: step !== 'select' }"></div>
      <div class="rc-step" :class="{ active: step === 'params', done: step === 'preview' }">
        <span class="rc-step-num">2</span>
        <span class="rc-step-text">配置参数</span>
      </div>
      <div class="rc-step-line" :class="{ done: step === 'preview' }"></div>
      <div class="rc-step" :class="{ active: step === 'preview' }">
        <span class="rc-step-num">3</span>
        <span class="rc-step-text">预览与导出</span>
      </div>
    </div>

    <!-- 步骤 1: 选报告类型 -->
    <div v-if="step === 'select'" class="rc-step-content">
      <div class="rc-section-title">📋 请选择您需要的报告</div>
      <div class="rc-types">
        <div
          v-for="t in REPORT_TYPES"
          :key="t.type"
          class="rc-type-card"
          :style="{ borderTopColor: t.color }"
          @click="pickType(t.type)"
        >
          <div class="rc-type-icon" :style="{ background: t.color + '20', color: t.color }">
            {{ t.icon }}
          </div>
          <div class="rc-type-title">{{ t.title }}</div>
          <div class="rc-type-desc">{{ t.desc }}</div>
        </div>
      </div>
    </div>

    <!-- 步骤 2: 配参数 -->
    <div v-else-if="step === 'params'" class="rc-step-content">
      <div class="rc-section-title">
        <el-icon><ArrowRight /></el-icon>
        配置报告参数：{{ selectedTypeInfo?.title }}
      </div>
      <div class="rc-params">
        <div class="rc-param-item">
          <label>数据范围：</label>
          <el-radio-group v-model="options.community" size="default">
            <el-radio-button
              v-for="c in communities"
              :key="c"
              :label="c"
            >{{ c === '全部' ? '全部小区' : c.replace('南海家园', '') }}</el-radio-button>
          </el-radio-group>
        </div>

        <div v-if="selectedTypeInfo?.needsItemCode" class="rc-param-item">
          <label>检测项：</label>
          <el-select v-model="options.itemCode" size="default" style="width: 280px">
            <el-option
              v-for="item in ITEM_CODES"
              :key="item.code"
              :label="item.name"
              :value="item.code"
            />
          </el-select>
        </div>

        <div class="rc-param-item">
          <el-alert type="info" :closable="false" show-icon>
            <template #title>
              <strong>{{ selectedTypeInfo?.title }}</strong>：{{ selectedTypeInfo?.desc }}
            </template>
            <div style="margin-top: 4px; font-size: 12px; color: #606266">
              将自动生成：报告摘要、关键指标卡片、统计图表、详细数据表、结论与建议
            </div>
          </el-alert>
        </div>

        <div class="rc-param-actions">
          <el-button :icon="ArrowLeft" @click="back">上一步</el-button>
          <el-button type="primary" :icon="DataLine" :loading="generating" @click="next">
            生成报告预览
          </el-button>
        </div>
      </div>
    </div>

    <!-- 步骤 3: 预览 + 导出 -->
    <div v-else-if="step === 'preview' && report" class="rc-step-content">
      <div class="rc-preview-toolbar">
        <el-button :icon="ArrowLeft" @click="back">修改参数</el-button>
        <el-button :icon="Refresh" @click="regenerate">重新生成</el-button>
        <el-button :icon="Printer" type="primary" @click="printAsPDF">打印 / 导出 PDF</el-button>
        <el-button :icon="Download" type="success" @click="exportExcel">导出 Excel</el-button>
        <span class="rc-preview-tip">
          <el-icon><ChatLineRound /></el-icon>
          请检视报告内容，确认无误后导出
        </span>
      </div>

      <!-- A4 排版报告 -->
      <div class="report-paper" id="report-paper">
        <!-- 报告封面 -->
        <div class="report-cover">
          <div class="report-cover-tag">阴极保护数据管理系统 · 自动报告</div>
          <h1 class="report-title">{{ report.title }}</h1>
          <div class="report-subtitle">{{ report.subtitle }}</div>
          <div class="report-cover-meta">
            <div><strong>生成时间：</strong>{{ report.generatedAt }}</div>
            <div><strong>数据范围：</strong>{{ report.community }}</div>
            <div><strong>报告 ID：</strong>{{ Date.now() }}</div>
          </div>
        </div>

        <!-- 目录 -->
        <div class="report-toc">
          <h2>目录</h2>
          <ol>
            <li v-for="(sec, i) in report.sections" :key="i">{{ sec.title }}</li>
          </ol>
        </div>

        <!-- 章节 -->
        <div v-for="(sec, i) in report.sections" :key="i" class="report-section">
          <h2 class="report-section-title">{{ sec.title }}</h2>

          <!-- 文字摘要 -->
          <div v-if="sec.type === 'summary'" class="report-summary" v-html="renderSummary(sec.data)" />

          <!-- 关键指标 -->
          <div v-else-if="sec.type === 'kpi'" class="report-kpi">
            <div
              v-for="(kpi, ki) in sec.data"
              :key="ki"
              class="report-kpi-card"
              :style="{ borderLeftColor: kpi.color }"
            >
              <div class="kpi-value" :style="{ color: kpi.color }">{{ kpi.value }}</div>
              <div class="kpi-label">{{ kpi.label }}<span v-if="kpi.unit" class="kpi-unit"> ({{ kpi.unit }})</span></div>
            </div>
          </div>

          <!-- 图表 -->
          <div v-else-if="sec.type === 'chart'" class="report-chart">
            <div :ref="setChartRef(i)" class="report-chart-inner" />
            <div class="report-chart-caption">图 {{ i + 1 }}：{{ sec.title }}</div>
          </div>

          <!-- 表格 -->
          <div v-else-if="sec.type === 'table'" class="report-table">
            <table>
              <thead>
                <tr>
                  <th v-for="h in sec.data.headers" :key="h">{{ h }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, ri) in sec.data.rows" :key="ri">
                  <td v-for="h in sec.data.headers" :key="h">{{ row[h] }}</td>
                </tr>
              </tbody>
            </table>
            <div v-if="sec.data.rows.length === 0" class="report-table-empty">无数据</div>
          </div>

          <!-- 文本 -->
          <div v-else-if="sec.type === 'text'" class="report-text" v-html="renderSummary(sec.data)" />
        </div>

        <!-- 报告结尾 -->
        <div class="report-footer">
          <div>— 报告结束 —</div>
          <div class="report-footer-meta">
            阴极保护数据管理系统 · 智问模块 · 自动生成于 {{ report.generatedAt }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.report-center {
  background: #f5f7fa;
  min-height: calc(100vh - 60px);
  padding: 16px 24px 32px;
}

/* 步骤条 */
.rc-steps {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
  padding: 16px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}

.rc-step {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #909399;
}

.rc-step-num {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #ebeef5;
  color: #909399;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 14px;
  transition: all 0.2s;
}

.rc-step.active .rc-step-num {
  background: #409eff;
  color: #fff;
}

.rc-step.done .rc-step-num {
  background: #67c23a;
  color: #fff;
}

.rc-step-text {
  font-size: 14px;
  font-weight: 500;
}

.rc-step.active .rc-step-text,
.rc-step.done .rc-step-text {
  color: #303133;
}

.rc-step-line {
  width: 80px;
  height: 2px;
  background: #ebeef5;
  margin: 0 12px;
}

.rc-step-line.done {
  background: #67c23a;
}

/* 步骤内容 */
.rc-step-content {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}

.rc-section-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 报告类型选择 */
.rc-types {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.rc-type-card {
  background: #fafbfc;
  border-top: 3px solid;
  border-radius: 8px;
  padding: 20px 16px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
}

.rc-type-card:hover {
  background: #fff;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
}

.rc-type-icon {
  font-size: 36px;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  margin: 0 auto 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.rc-type-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 6px;
}

.rc-type-desc {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}

/* 参数配置 */
.rc-params {
  max-width: 720px;
}

.rc-param-item {
  margin-bottom: 18px;
  display: flex;
  align-items: flex-start;
}

.rc-param-item > label {
  width: 100px;
  flex-shrink: 0;
  padding-top: 6px;
  color: #606266;
  font-weight: 500;
}

.rc-param-item > .el-radio-group,
.rc-param-item > .el-select {
  flex: 1;
}

.rc-param-actions {
  display: flex;
  gap: 12px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px dashed #ebeef5;
}

/* 预览工具栏 */
.rc-preview-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 12px 16px;
  background: #f0f9ff;
  border: 1px solid #b3d8ff;
  border-radius: 8px;
}

.rc-preview-tip {
  margin-left: auto;
  color: #409eff;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 4px;
}

/* 报告纸张（A4 排版） */
.report-paper {
  background: #fff;
  max-width: 800px;
  margin: 0 auto;
  padding: 60px 72px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
  border-radius: 4px;
  font-family: 'Microsoft YaHei', -apple-system, BlinkMacSystemFont, sans-serif;
  color: #1f1f1f;
  line-height: 1.8;
}

.report-cover {
  text-align: center;
  padding: 40px 0 60px;
  border-bottom: 2px solid #409eff;
  margin-bottom: 40px;
}

.report-cover-tag {
  display: inline-block;
  padding: 4px 12px;
  background: #ecf5ff;
  color: #409eff;
  border-radius: 12px;
  font-size: 12px;
  margin-bottom: 24px;
}

.report-title {
  font-size: 28px;
  font-weight: 700;
  color: #1f1f1f;
  margin: 0 0 12px;
  line-height: 1.3;
}

.report-subtitle {
  font-size: 16px;
  color: #606266;
  margin-bottom: 32px;
}

.report-cover-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: #606266;
  text-align: left;
  max-width: 320px;
  margin: 0 auto;
}

.report-cover-meta strong {
  color: #303133;
  margin-right: 4px;
}

.report-toc {
  margin-bottom: 40px;
  padding: 20px;
  background: #fafbfc;
  border-radius: 4px;
}

.report-toc h2 {
  font-size: 18px;
  margin: 0 0 12px;
  color: #1f1f1f;
}

.report-toc ol {
  margin: 0;
  padding-left: 24px;
  color: #606266;
  font-size: 14px;
  line-height: 2;
}

.report-section {
  margin-bottom: 32px;
  page-break-inside: avoid;
}

.report-section-title {
  font-size: 18px;
  font-weight: 600;
  color: #1f1f1f;
  margin: 0 0 16px;
  padding-bottom: 8px;
  border-bottom: 2px solid #409eff;
  display: inline-block;
}

.report-summary {
  background: #f6f8fa;
  border-left: 4px solid #409eff;
  padding: 14px 18px;
  border-radius: 4px;
  font-size: 14px;
  line-height: 1.9;
}

.report-kpi {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 8px;
}

.report-kpi-card {
  background: #fafbfc;
  border-left: 3px solid;
  border-radius: 4px;
  padding: 14px 16px;
}

.kpi-value {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.2;
}

.kpi-label {
  font-size: 12px;
  color: #606266;
  margin-top: 4px;
}

.kpi-unit {
  color: #909399;
  font-weight: normal;
}

.report-chart {
  margin: 16px 0;
}

.report-chart-inner {
  width: 100%;
  height: 280px;
}

.report-chart-caption {
  text-align: center;
  font-size: 12px;
  color: #909399;
  margin-top: 8px;
  font-style: italic;
}

.report-table {
  margin: 16px 0;
  overflow-x: auto;
}

.report-table table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.report-table th {
  background: #f0f9ff;
  color: #303133;
  padding: 10px 12px;
  border: 1px solid #d4e5f7;
  text-align: left;
  font-weight: 600;
}

.report-table td {
  padding: 8px 12px;
  border: 1px solid #ebeef5;
  color: #606266;
}

.report-table tr:nth-child(even) td {
  background: #fafbfc;
}

.report-table-empty {
  text-align: center;
  color: #c0c4cc;
  padding: 30px;
  font-size: 13px;
}

.report-text {
  background: #fdf6ec;
  border-left: 4px solid #e6a23c;
  padding: 14px 18px;
  border-radius: 4px;
  font-size: 14px;
  line-height: 1.9;
  white-space: pre-line;
}

.report-footer {
  margin-top: 60px;
  padding-top: 24px;
  border-top: 1px dashed #dcdfe6;
  text-align: center;
  color: #909399;
  font-size: 13px;
}

.report-footer-meta {
  margin-top: 8px;
  font-size: 11px;
}
</style>

<style>
/* 打印样式：不进 scoped，全局生效 */
@media print {
  body.report-printing .report-center {
    background: #fff !important;
    padding: 0 !important;
  }
  body.report-printing .rc-steps,
  body.report-printing .rc-preview-toolbar,
  body.report-printing .app-header {
    display: none !important;
  }
  body.report-printing .report-paper {
    box-shadow: none !important;
    padding: 20px 30px !important;
    max-width: 100% !important;
  }
  body.report-printing .report-section {
    page-break-inside: avoid;
  }
  body.report-printing .report-cover {
    page-break-after: always;
  }
  body.report-printing .report-toc {
    page-break-after: always;
  }
  /* Element Plus 弹窗在打印时隐藏 */
  body.report-printing .el-overlay,
  body.report-printing .el-message-box {
    display: none !important;
  }
}
</style>
