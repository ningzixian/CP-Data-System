<script setup lang="ts">
/**
 * 报告预览组件
 *
 * 用于在智问答案区或 ReportCenter 里直接渲染一份报告。
 * 不含三步骤选择流程（只做"显示 + 操作"）。
 */
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import {
  Printer, Download, Refresh, Edit, ArrowLeft, ChatLineRound, Close, Document,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { buildFileName, formatBytes } from '@/zhiwen/exporter'
import { exportReportToPDF } from '@/zhiwen/pdfExporter'
import type { Report, ReportOptions } from '@/zhiwen/reportGenerator'

const props = defineProps<{
  report: Report
  /** 是否可编辑（显示"调整参数"按钮） */
  editable?: boolean
  /** 是否可重新生成（显示"重新生成"按钮） */
  regenerable?: boolean
  /** 标题前缀，如"智问：" */
  titlePrefix?: string
}>()

const emit = defineEmits<{
  (e: 'regenerate', options: ReportOptions): void
  (e: 'update-params', options: ReportOptions): void
  (e: 'close'): void
}>()

// 多图表实例
const chartRefs = ref<Record<number, HTMLDivElement | null>>({})
const charts: Record<number, echarts.ECharts> = {}
function resizeCharts() { Object.values(charts).forEach((chart) => chart?.resize()) }

function setChartRef(idx: number) {
  return (el: any) => {
    if (el) chartRefs.value[idx] = el.$el || el
  }
}

function renderAllCharts() {
  props.report.sections.forEach((sec, idx) => {
    if (sec.type === 'chart' && chartRefs.value[idx]) {
      const el = chartRefs.value[idx]!
      if (!charts[idx]) {
        charts[idx] = echarts.init(el)
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

onMounted(() => {
  window.addEventListener('resize', resizeCharts)
  void nextTick(renderAllCharts)
})

onBeforeUnmount(() => {
  Object.values(charts).forEach((c) => c?.dispose())
  window.removeEventListener('resize', resizeCharts)
})

watch(() => props.report, () => {
  // 报告变了，清掉旧图表重新渲染
  Object.values(charts).forEach((c) => c?.dispose())
  Object.keys(charts).forEach((k) => delete charts[Number(k)])
  chartRefs.value = {}
  nextTick(() => renderAllCharts())
}, { deep: false })

// 导出 PDF（直接下载，非浏览器打印）
const paperRef = ref<HTMLElement | null>(null)
const pdfExporting = ref(false)
const pdfProgress = ref(0)
const pdfStage = ref('')
async function downloadAsPDF() {
  if (!paperRef.value) {
    ElMessage.warning('报告还未渲染完成')
    return
  }
  pdfExporting.value = true
  pdfProgress.value = 0
  pdfStage.value = '准备导出…'
  try {
    await exportReportToPDF(paperRef.value, {
      title: props.report.title,
      subtitle: props.report.subtitle,
      onProgress: (p, stage) => {
        pdfProgress.value = p
        pdfStage.value = stage
      },
    })
    ElMessage.success('PDF 已生成，正在下载')
  } catch (e: any) {
    console.error('[PDF 导出失败]', e)
    ElMessage.error('PDF 导出失败：' + (e?.message || '未知错误'))
  } finally {
    pdfExporting.value = false
  }
}
// 兼容老调用（浏览器打印）
function printAsPDF() {
  document.body.classList.add('report-printing')
  setTimeout(() => {
    window.print()
    setTimeout(() => document.body.classList.remove('report-printing'), 500)
  }, 100)
}

// 导出 Excel
async function exportExcel() {
  try {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const meta = [
      ['报告标题', props.report.title],
      ['报告副标题', props.report.subtitle],
      ['生成时间', props.report.generatedAt],
      ['数据范围', props.report.community],
      ['管线段数', props.report.meta.totalPipes],
      ['检测记录', props.report.meta.totalRecords],
      ['设施数量', props.report.meta.totalFacilities],
    ]
    const wsMeta = XLSX.utils.aoa_to_sheet(meta)
    wsMeta['!cols'] = [{ wch: 14 }, { wch: 60 }]
    XLSX.utils.book_append_sheet(wb, wsMeta, '报告元信息')
    props.report.sections.forEach((sec) => {
      if (sec.type === 'table' && sec.data?.rows?.length) {
        const ws = XLSX.utils.aoa_to_sheet([
          sec.data.headers,
          ...sec.data.rows.map((r: any) => sec.data.headers.map((h: string) => r[h])),
        ])
        ws['!cols'] = sec.data.headers.map((h: string) => ({ wch: Math.max(10, h.length * 2 + 4) }))
        XLSX.utils.book_append_sheet(wb, ws, sec.title.slice(0, 28))
      }
    })
    const fileName = buildFileName(props.report.title.replace(/[📊⚠️🏗️📍📈🔍]/g, '').trim(), 'xlsx')
    XLSX.writeFile(wb, fileName)
    ElMessage.success(`已导出：${fileName}`)
  } catch (e) {
    console.error(e)
    ElMessage.error('导出失败：' + (e as Error).message)
  }
}

// 重新生成
function regenerate() {
  emit('regenerate', { community: props.report.community, itemCode: props.report.itemCode })
}

// 调整参数
function updateParams() {
  emit('update-params', { community: props.report.community, itemCode: props.report.itemCode })
}

function renderSummary(text: string) {
  return text.replace(/\*\*(.+?)\*\*/g, '<b style="color:#409EFF">$1</b>').replace(/\n/g, '<br/>')
}
</script>

<template>
  <div class="report-preview">
    <!-- 操作栏 -->
    <div class="rp-toolbar">
      <div class="rp-title">
        <el-icon><Printer /></el-icon>
        <span v-if="titlePrefix">{{ titlePrefix }}</span>
        <span>{{ report.title }}</span>
      </div>
      <div class="rp-actions">
        <el-tooltip content="调整参数（小区/检测项）" placement="bottom" v-if="editable">
          <el-button size="small" :icon="Edit" @click="updateParams">调整参数</el-button>
        </el-tooltip>
        <el-tooltip content="用同样参数重新生成" placement="bottom" v-if="regenerable !== false">
          <el-button size="small" :icon="Refresh" @click="regenerate">重新生成</el-button>
        </el-tooltip>
        <el-tooltip content="直接生成 PDF 文件并下载" placement="bottom">
          <el-button
            size="small"
            :icon="Document"
            type="primary"
            :loading="pdfExporting"
            @click="downloadAsPDF"
          >
            {{ pdfExporting ? `导出中 ${Math.round(pdfProgress * 100)}%` : '下载 PDF' }}
          </el-button>
        </el-tooltip>
        <el-tooltip content="浏览器打印（可手动另存 PDF）" placement="bottom">
          <el-button size="small" :icon="Printer" @click="printAsPDF">打印</el-button>
        </el-tooltip>
        <el-tooltip content="导出 Excel（每个章节一个 sheet）" placement="bottom">
          <el-button size="small" :icon="Download" type="success" @click="exportExcel">导出 Excel</el-button>
        </el-tooltip>
        <el-tooltip content="关闭" placement="bottom" v-if="editable">
          <el-button size="small" :icon="Close" circle @click="emit('close')" />
        </el-tooltip>
      </div>
    </div>

    <!-- 报告元信息条 -->
    <div class="rp-meta">
      <span><strong>副标题：</strong>{{ report.subtitle }}</span>
      <span><strong>生成时间：</strong>{{ report.generatedAt }}</span>
      <span><strong>数据范围：</strong>{{ report.community }}</span>
      <span v-if="report.itemCode"><strong>检测项：</strong>{{ report.itemCode }}</span>
    </div>

    <!-- 导出进度条 -->
    <el-progress
      v-if="pdfExporting"
      :percentage="Math.round(pdfProgress * 100)"
      :status="pdfProgress >= 1 ? 'success' : undefined"
      :stroke-width="14"
      style="margin-bottom: 10px"
    >
      <span style="font-size: 12px">{{ pdfStage || '导出中…' }} {{ Math.round(pdfProgress * 100) }}%</span>
    </el-progress>

    <!-- 报告正文（A4 排版） -->
    <div class="report-paper" ref="paperRef">
      <!-- 封面 -->
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

        <div v-if="sec.type === 'summary'" class="report-summary" v-html="renderSummary(sec.data)" />

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

        <div v-else-if="sec.type === 'chart'" class="report-chart">
          <div :ref="setChartRef(i)" class="report-chart-inner" />
          <div class="report-chart-caption">图 {{ i + 1 }}：{{ sec.title }}</div>
        </div>

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
</template>

<style scoped>
.report-preview {
  background: #fff;
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}

.rp-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  padding: 8px 12px;
  background: #f0f9ff;
  border: 1px solid #b3d8ff;
  border-radius: 8px;
}

.rp-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  flex: 1;
}

.rp-actions {
  display: flex;
  gap: 6px;
}

.rp-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding: 8px 12px;
  margin-bottom: 12px;
  background: #fafbfc;
  border-radius: 6px;
  font-size: 12px;
  color: #606266;
}

.rp-meta strong {
  color: #303133;
  margin-right: 4px;
}

/* A4 报告 */
.report-paper {
  background: #fff;
  max-width: 800px;
  margin: 0 auto;
  padding: 40px 60px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  border-radius: 4px;
  font-family: 'Microsoft YaHei', -apple-system, BlinkMacSystemFont, sans-serif;
  color: #1f1f1f;
  line-height: 1.8;
}

.report-cover {
  text-align: center;
  padding: 30px 0 50px;
  border-bottom: 2px solid #409eff;
  margin-bottom: 30px;
}

.report-cover-tag {
  display: inline-block;
  padding: 4px 12px;
  background: #ecf5ff;
  color: #409eff;
  border-radius: 12px;
  font-size: 12px;
  margin-bottom: 20px;
}

.report-title {
  font-size: 26px;
  font-weight: 700;
  color: #1f1f1f;
  margin: 0 0 12px;
  line-height: 1.3;
}

.report-subtitle {
  font-size: 15px;
  color: #606266;
  margin-bottom: 24px;
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
  margin-bottom: 30px;
  padding: 16px;
  background: #fafbfc;
  border-radius: 4px;
}

.report-toc h2 {
  font-size: 16px;
  margin: 0 0 10px;
  color: #1f1f1f;
}

.report-toc ol {
  margin: 0;
  padding-left: 24px;
  color: #606266;
  font-size: 13px;
  line-height: 2;
}

.report-section {
  margin-bottom: 28px;
  page-break-inside: avoid;
}

.report-section-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
  margin: 0 0 14px;
  padding-bottom: 6px;
  border-bottom: 2px solid #409eff;
  display: inline-block;
}

.report-summary {
  background: #f6f8fa;
  border-left: 4px solid #409eff;
  padding: 12px 16px;
  border-radius: 4px;
  font-size: 13px;
  line-height: 1.9;
}

.report-kpi {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 10px;
  margin-bottom: 8px;
}

.report-kpi-card {
  background: #fafbfc;
  border-left: 3px solid;
  border-radius: 4px;
  padding: 12px 14px;
}

.kpi-value {
  font-size: 20px;
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
  margin: 14px 0;
}

.report-chart-inner {
  width: 100%;
  height: 260px;
}

.report-chart-caption {
  text-align: center;
  font-size: 12px;
  color: #909399;
  margin-top: 6px;
  font-style: italic;
}

.report-table {
  margin: 14px 0;
  overflow-x: auto;
}

.report-table table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.report-table th {
  background: #f0f9ff;
  color: #303133;
  padding: 8px 10px;
  border: 1px solid #d4e5f7;
  text-align: left;
  font-weight: 600;
}

.report-table td {
  padding: 6px 10px;
  border: 1px solid #ebeef5;
  color: #606266;
}

.report-table tr:nth-child(even) td {
  background: #fafbfc;
}

.report-table-empty {
  text-align: center;
  color: #c0c4cc;
  padding: 24px;
  font-size: 13px;
}

.report-text {
  background: #fdf6ec;
  border-left: 4px solid #e6a23c;
  padding: 12px 16px;
  border-radius: 4px;
  font-size: 13px;
  line-height: 1.9;
  white-space: pre-line;
}

.report-footer {
  margin-top: 40px;
  padding-top: 20px;
  border-top: 1px dashed #dcdfe6;
  text-align: center;
  color: #909399;
  font-size: 12px;
}

.report-footer-meta {
  margin-top: 6px;
  font-size: 11px;
}
</style>

<style>
/* 打印样式：全局生效 */
@media print {
  body.report-printing .app-header,
  body.report-printing .zw-header,
  body.report-printing .zw-card,
  body.report-printing .zw-left,
  body.report-printing .zw-right,
  body.report-printing .rc-steps,
  body.report-printing .rc-preview-toolbar,
  body.report-printing .rp-toolbar,
  body.report-printing .rp-meta,
  body.report-printing .el-overlay,
  body.report-printing .el-message-box,
  body.report-printing .el-message {
    display: none !important;
  }
  body.report-printing .report-preview {
    background: #fff !important;
    padding: 0 !important;
    box-shadow: none !important;
  }
  body.report-printing .report-paper {
    box-shadow: none !important;
    padding: 16px 24px !important;
    max-width: 100% !important;
  }
  body.report-printing .report-section {
    page-break-inside: avoid;
  }
  body.report-printing .report-cover,
  body.report-printing .report-toc {
    page-break-after: always;
  }
}
</style>
