<script setup lang="ts">
/**
 * 右侧"报告摘要"面板
 *
 * 用在智问右侧地图下方，只显示报告的关键信息（缩略版）：
 *   - 标题 + 副标题 + 数据范围
 *   - 关键指标（KPI 卡片，2-3 列）
 *   - 图表缩略（如有）
 *   - 数据表格（前 5 行）
 *   - "滚动到完整报告"按钮
 */
import { ref, onMounted, onBeforeUnmount, watch, nextTick, computed } from 'vue'
import * as echarts from 'echarts'
import { ArrowDown, Document } from '@element-plus/icons-vue'
import type { Report } from '@/zhiwen/reportGenerator'

const props = defineProps<{
  report: Report
}>()

const emit = defineEmits<{
  (e: 'scroll-to-report'): void
}>()

// 摘要章节
const summarySection = computed(() => props.report.sections.find((s) => s.type === 'summary'))
const kpiSection = computed(() => props.report.sections.find((s) => s.type === 'kpi'))
const chartSection = computed(() => props.report.sections.find((s) => s.type === 'chart'))
const tableSection = computed(() => props.report.sections.find((s) => s.type === 'table'))
const textSection = computed(() => props.report.sections.find((s) => s.type === 'text'))

// 摘要的 HTML 渲染（兼容 reportGenerator 里的 **bold** 语法）
function renderSummary(html: string): string {
  if (!html) return ''
  return html
    .replace(/\*\*(.+?)\*\*/g, '<b style="color:#409EFF">$1</b>')
    .replace(/\n/g, '<br/>')
}

// 表格只取前 5 行
const tablePreview = computed(() => {
  if (!tableSection.value) return null
  return {
    headers: tableSection.value.data.headers as string[],
    rows: (tableSection.value.data.rows as any[]).slice(0, 5),
    total: tableSection.value.data.rows.length,
  }
})

// 图表
const chartEl = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null

function renderChart() {
  if (!chartEl.value || !chartSection.value) return
  if (!chart) chart = echarts.init(chartEl.value, undefined, { renderer: 'canvas' })
  const sec = chartSection.value
  const data = sec.data.data as Array<{ name: string; value: number }>
  const isPie = sec.data.type === 'pie'
  chart.setOption({
    tooltip: { trigger: isPie ? 'item' : 'axis' },
    legend: { show: !isPie, bottom: 0, type: 'scroll', textStyle: { fontSize: 10 } },
    grid: isPie ? undefined : { top: 24, left: 36, right: 12, bottom: 28 },
    xAxis: isPie ? undefined : {
      type: 'category', data: data.map((d) => d.name),
      axisLabel: { rotate: 25, fontSize: 10, interval: 0 },
    },
    yAxis: isPie ? undefined : { type: 'value', axisLabel: { fontSize: 10 } },
    series: [{
      type: sec.data.type,
      radius: isPie ? '52%' : undefined,
      data,
      label: isPie ? { formatter: '{b}: {d}%', fontSize: 10 } : { show: false },
    }],
  }, true)
}

watch(() => chartSection.value, () => nextTick(renderChart))
onMounted(() => nextTick(renderChart))
onBeforeUnmount(() => chart?.dispose())

// 监听窗口变化，自适应
const onResize = () => chart?.resize()
onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))
</script>

<template>
  <div class="zw-card rsp">
    <div class="zw-card-title">
      <el-icon><Document /></el-icon>
      <span>报告摘要</span>
      <span class="rsp-subtitle">{{ report.title.replace('📌 ', '') }}</span>
    </div>

    <!-- 副标题 + 元信息 -->
    <div class="rsp-meta">
      <div class="rsp-meta-line">{{ report.subtitle }}</div>
      <div class="rsp-meta-line small">
        <span><b>数据范围：</b>{{ report.community }}</span>
        <span><b>生成：</b>{{ report.generatedAt }}</span>
      </div>
    </div>

    <!-- 摘要 -->
    <div v-if="summarySection" class="rsp-summary" v-html="renderSummary(summarySection.data)" />

    <!-- KPI -->
    <div v-if="kpiSection && kpiSection.data.length" class="rsp-kpi">
      <div
        v-for="(kpi, i) in kpiSection.data"
        :key="i"
        class="rsp-kpi-card"
        :style="{ borderLeftColor: kpi.color }"
      >
        <div class="rsp-kpi-value" :style="{ color: kpi.color }">{{ kpi.value }}</div>
        <div class="rsp-kpi-label">
          {{ kpi.label }}<span v-if="kpi.unit" class="rsp-kpi-unit"> ({{ kpi.unit }})</span>
        </div>
      </div>
    </div>

    <!-- 图表 -->
    <div v-if="chartSection" class="rsp-chart">
      <div class="rsp-section-label">{{ chartSection.title }}</div>
      <div ref="chartEl" class="rsp-chart-inner" />
    </div>

    <!-- 表格 -->
    <div v-if="tablePreview && tableSection" class="rsp-table">
      <div class="rsp-section-label">
        {{ tableSection.title }}
        <span class="rsp-table-total">共 {{ tablePreview.total }} 条</span>
      </div>
      <div class="rsp-table-scroll">
        <table>
          <thead>
            <tr>
              <th v-for="h in tablePreview.headers" :key="h">{{ h }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, ri) in tablePreview.rows" :key="ri">
              <td v-for="h in tablePreview.headers" :key="h">{{ row[h] }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="tablePreview.total > tablePreview.rows.length" class="rsp-table-more">
        还有 {{ tablePreview.total - tablePreview.rows.length }} 行…
      </div>
    </div>

    <!-- 结论 -->
    <div v-if="textSection" class="rsp-text" v-html="renderSummary(textSection.data)" />

    <!-- 跳到完整报告 -->
    <el-button
      size="small"
      type="primary"
      plain
      :icon="ArrowDown"
      style="width: 100%; margin-top: 8px"
      @click="emit('scroll-to-report')"
    >
      查看完整报告
    </el-button>
  </div>
</template>

<style scoped>
.rsp {
  border-top: 3px solid #409eff;
}
.rsp-subtitle {
  font-size: 12px;
  color: #606266;
  font-weight: normal;
  margin-left: 8px;
  flex: 1;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rsp-meta {
  background: #f0f9ff;
  border-radius: 4px;
  padding: 6px 10px;
  margin: 6px 0 8px;
  font-size: 12px;
  color: #303133;
}
.rsp-meta-line + .rsp-meta-line { margin-top: 2px; }
.rsp-meta-line.small {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #909399;
}
.rsp-summary {
  font-size: 12px;
  line-height: 1.6;
  color: #303133;
  background: #fafafa;
  border-left: 3px solid #67c23a;
  padding: 8px 10px;
  border-radius: 0 4px 4px 0;
  margin-bottom: 8px;
  max-height: 120px;
  overflow-y: auto;
}
.rsp-kpi {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
  margin-bottom: 8px;
}
.rsp-kpi-card {
  background: #fff;
  border: 1px solid #ebeef5;
  border-left: 3px solid #409eff;
  border-radius: 4px;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rsp-kpi-value {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.2;
}
.rsp-kpi-label {
  font-size: 10px;
  color: #606266;
  line-height: 1.3;
}
.rsp-kpi-unit {
  color: #909399;
  font-size: 9px;
}
.rsp-section-label {
  font-size: 12px;
  font-weight: 600;
  color: #303133;
  margin: 6px 0 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.rsp-chart {
  margin: 4px 0 8px;
}
.rsp-chart-inner {
  width: 100%;
  height: 160px;
}
.rsp-table {
  margin: 4px 0 8px;
}
.rsp-table-total {
  font-size: 10px;
  color: #909399;
  font-weight: normal;
}
.rsp-table-scroll {
  max-height: 140px;
  overflow: auto;
  border: 1px solid #ebeef5;
  border-radius: 4px;
}
.rsp-table table {
  width: 100%;
  border-collapse: collapse;
  font-size: 10px;
}
.rsp-table th,
.rsp-table td {
  padding: 4px 6px;
  border-bottom: 1px solid #ebeef5;
  text-align: left;
  white-space: nowrap;
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rsp-table th {
  background: #f5f7fa;
  color: #606266;
  font-weight: 600;
  position: sticky;
  top: 0;
  z-index: 1;
}
.rsp-table-more {
  font-size: 10px;
  color: #909399;
  text-align: center;
  margin-top: 4px;
  font-style: italic;
}
.rsp-text {
  font-size: 11px;
  line-height: 1.6;
  color: #606266;
  background: #fdf6ec;
  border-radius: 4px;
  padding: 6px 8px;
  margin-bottom: 4px;
  max-height: 110px;
  overflow-y: auto;
}
</style>
