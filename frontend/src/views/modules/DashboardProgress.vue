<script setup lang="ts">
/**
 * 数据看板 - 进度模块
 * 保留原 DashboardPage 雷达图 + 矩阵，集成管网/物探数据
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import type { ZhiwenData } from '@/zhiwen/engine'
import StatusTag from '@/components/StatusTag.vue'

const props = defineProps<{ data: ZhiwenData; community: string }>()

// 项目里 7 项检测项定义
const ITEMS = [
  { code: 'JOINT_VERIFY', name: '① 绝缘接头位置和绝缘性能复核' },
  { code: 'SOIL_RESISTIVITY', name: '② 土壤电阻率检测' },
  { code: 'DC_STRAY_CURRENT', name: '③ 直流杂散电流检测' },
  { code: 'COATING_DETECT', name: '④ 防腐层非开挖检测' },
  { code: 'PIPE_GROUND_POTENTIAL', name: '⑤ 管地腐蚀电位检测' },
  { code: 'ELECTRIC_CONTINUITY', name: '⑥ 管道电联通性检测' },
  { code: 'INLET_PARAM', name: '⑦ 引入口参数测量' },
]

const units = computed(() => filterByCommunity(props.data.units, props.community))
const records = computed(() => filterByCommunity(props.data.records, props.community))

function filterByCommunity<T extends { community?: string }>(rows: T[], community: string): T[] {
  if (!community || community === '全部') return rows
  return rows.filter((r) => r.community === community)
}

interface UnitRow {
  unit_id: number
  unit_name: string
  community: string
  status: string
  progress: number
  items: Array<{ code: string; name: string; status: string }>
}

const unitRows = computed<UnitRow[]>(() => {
  return units.value.map((u) => {
    const uRecords = records.value.filter((r) => r.unit_id === u.id)
    const recMap = new Map<string, any>()
    uRecords.forEach((r) => recMap.set(r.item_code, r))
    const items = ITEMS.map((it) => ({
      code: it.code,
      name: it.name,
      status: recMap.get(it.code)?.status || 'pending',
    }))
    const passed = items.filter((i) => i.status === 'passed').length
    const progress = items.length ? passed / items.length : 0
    return {
      unit_id: u.id,
      unit_name: u.name,
      community: u.community,
      status: u.inspection_status,
      progress,
      items,
    }
  })
})

const stats = computed(() => {
  const total = unitRows.value.length
  const completed = unitRows.value.filter((u) => u.status === 'completed').length
  const inProgress = unitRows.value.filter((u) => u.status === 'in_progress').length
  const pending = unitRows.value.filter((u) => u.status === 'pending').length
  const exception = unitRows.value.filter((u) => u.status === 'exception').length
  return { total, completed, inProgress, pending, exception }
})

const chartRef = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null

function renderChart() {
  if (!chartRef.value || unitRows.value.length === 0) return
  if (!chart) chart = echarts.init(chartRef.value)
  const indicators = ITEMS.map((it) => ({ name: it.name.length > 8 ? it.name.slice(0, 8) + '…' : it.name, max: 1 }))
  const seriesData = unitRows.value.map((r) => ({
    name: r.unit_name,
    value: r.items.map((i) => (i.status === 'passed' ? 1 : 0)),
    itemStyle: { opacity: 0.6 },
  }))
  chart.setOption({
    tooltip: {
      trigger: 'item',
      formatter: (params: any) => {
        const row = unitRows.value.find((r) => r.unit_name === params.name)
        if (!row) return ''
        const passed = row.items.filter((i) => i.status === 'passed').length
        return `<b>${row.unit_name}</b><br/>完成 ${passed} / ${row.items.length} 项 (${Math.round(row.progress * 100)}%)`
      },
    },
    legend: { bottom: 0, type: 'scroll' },
    radar: {
      indicator: indicators,
      radius: '65%',
      splitArea: { areaStyle: { color: ['rgba(64,158,255,0.02)', 'rgba(64,158,255,0.05)'] } },
      axisName: { color: '#606266', fontSize: 11 },
    },
    series: [{
      type: 'radar',
      data: seriesData,
      areaStyle: { opacity: 0.15 },
      lineStyle: { width: 2 },
    }],
  })
}

function handleResize() { chart?.resize() }
onMounted(() => nextTick(renderChart))
onBeforeUnmount(() => {
  chart?.dispose()
  chart = null
  window.removeEventListener('resize', handleResize)
})
watch(() => [props.community, props.data], () => nextTick(renderChart), { deep: false })
</script>

<template>
  <div class="dash-progress">
    <el-row :gutter="16">
      <el-col :xs="12" :md="6">
        <div class="kpi-card kpi-blue">
          <div class="kpi-icon">🎯</div>
          <div class="kpi-body">
            <div class="kpi-value">{{ stats.total }}</div>
            <div class="kpi-label">腐控单元</div>
            <div class="kpi-sub">覆盖本数据范围</div>
          </div>
        </div>
      </el-col>
      <el-col :xs="12" :md="6">
        <div class="kpi-card kpi-green">
          <div class="kpi-icon">✅</div>
          <div class="kpi-body">
            <div class="kpi-value">{{ stats.completed }}</div>
            <div class="kpi-label">已完成</div>
            <div class="kpi-sub">{{ stats.total ? ((stats.completed / stats.total) * 100).toFixed(0) : 0 }}% 完成率</div>
          </div>
        </div>
      </el-col>
      <el-col :xs="12" :md="6">
        <div class="kpi-card kpi-orange">
          <div class="kpi-icon">🔄</div>
          <div class="kpi-body">
            <div class="kpi-value">{{ stats.inProgress }}</div>
            <div class="kpi-label">进行中</div>
            <div class="kpi-sub">检测中</div>
          </div>
        </div>
      </el-col>
      <el-col :xs="12" :md="6">
        <div class="kpi-card kpi-red">
          <div class="kpi-icon">⚠️</div>
          <div class="kpi-body">
            <div class="kpi-value">{{ stats.exception }}</div>
            <div class="kpi-label">异常</div>
            <div class="kpi-sub">需关注</div>
          </div>
        </div>
      </el-col>
    </el-row>

    <el-card shadow="never" style="margin-top:16px">
      <template #header>
        <div style="display:flex;align-items:center">
          <b style="font-size:15px">各腐控单元 7 项检测完成度（雷达图）</b>
          <div style="flex:1"></div>
          <span style="font-size:12px;color:#909399">外环 = 已完成，内环 = 待开始</span>
        </div>
      </template>
      <div ref="chartRef" style="width:100%;height:420px"></div>
    </el-card>

    <el-card shadow="never" style="margin-top:16px">
      <template #header>
        <b style="font-size:15px">详情矩阵（点击单元格可查看）</b>
      </template>
      <el-table :data="unitRows" stripe size="small" border max-height="500">
        <el-table-column prop="unit_name" label="单元" width="120" fixed />
        <el-table-column prop="community" label="小区" width="100" />
        <el-table-column v-for="it in ITEMS" :key="it.code" :label="it.name.length > 6 ? it.name.slice(0, 6) + '…' : it.name" align="center" min-width="100">
          <template #default="{ row }">
            <el-tooltip :content="it.name" placement="top">
              <StatusTag :status="row.items.find((i: any) => i.code === it.code)?.status || 'pending'" short />
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="总进度" width="160" fixed="right">
          <template #default="{ row }">
            <el-progress :percentage="Math.round(row.progress * 100)" :stroke-width="10" />
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.dash-progress { width: 100%; }
.kpi-card {
  display: flex; align-items: center; gap: 14px;
  background: #fff; border-radius: 8px; padding: 18px 20px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04); border-left: 4px solid;
  margin-bottom: 12px;
}
.kpi-blue { border-left-color: #409eff; }
.kpi-green { border-left-color: #67c23a; }
.kpi-orange { border-left-color: #e6a23c; }
.kpi-red { border-left-color: #f56c6c; }
.kpi-icon { font-size: 32px; }
.kpi-body { flex: 1; min-width: 0; }
.kpi-value { font-size: 28px; font-weight: 700; color: #303133; line-height: 1.1; }
.kpi-label { font-size: 13px; color: #606266; margin-top: 4px; }
.kpi-sub { font-size: 11px; color: #909399; margin-top: 2px; }
</style>
