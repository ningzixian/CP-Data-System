<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import { useCpStore } from '@/stores/cp'
import StatusTag from '@/components/StatusTag.vue'

const store = useCpStore()
const chartRef = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null

function renderChart() {
  if (!chartRef.value || !store.dashboard) return
  if (!chart) chart = echarts.init(chartRef.value)

  const indicators = store.dashboard.items.map((it) => ({
    name: it.name.length > 8 ? it.name.slice(0, 8) + '…' : it.name,
    max: 1,
  }))

  const seriesData = store.dashboard.rows.map((r) => ({
    name: r.unit_name,
    value: r.items.map((it) => (it.status === 'passed' ? 1 : 0)),
    itemStyle: { opacity: 0.6 },
  }))

  const dark = document.documentElement.classList.contains('dark')
  const textColor = dark ? '#cbd5e1' : '#606266'
  const splitLineColor = dark ? '#334155' : '#e4e7ed'
  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: {
      backgroundColor: dark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.96)',
      borderColor: dark ? '#334155' : '#e4e7ed',
      textStyle: { color: dark ? '#e5edf7' : '#303133' },
      trigger: 'item',
      formatter: (params: any) => {
        const row = store.dashboard?.rows.find((r) => r.unit_name === params.name)
        if (!row) return ''
        const passed = row.items.filter((i) => i.status === 'passed').length
        return `<b>${row.unit_name}</b><br/>完成 ${passed} / ${row.items.length} 项 (${Math.round(row.progress * 100)}%)`
      },
    },
    legend: { bottom: 0, type: 'scroll', textStyle: { color: textColor }, pageTextStyle: { color: textColor } },
    radar: {
      indicator: indicators,
      radius: '65%',
      splitArea: { areaStyle: { color: dark ? ['rgba(30, 64, 175, 0.08)', 'rgba(30, 64, 175, 0.16)'] : ['rgba(64,158,255,0.02)', 'rgba(64,158,255,0.05)'] } },
      splitLine: { lineStyle: { color: splitLineColor } },
      axisLine: { lineStyle: { color: splitLineColor } },
      axisName: { color: textColor, fontSize: 11 },
    },
    series: [
      {
        type: 'radar',
        data: seriesData,
        areaStyle: { opacity: 0.15 },
        lineStyle: { width: 2 },
      },
    ],
  })
}

function handleResize() {
  chart?.resize()
}

function handleThemeChange() {
  renderChart()
}

onMounted(async () => {
  await nextTick()
  renderChart()
  window.addEventListener('resize', handleResize)
  window.addEventListener('themechange', handleThemeChange)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('themechange', handleThemeChange)
  chart?.dispose()
  chart = null
})

watch(() => store.dashboard, () => nextTick(renderChart), { deep: true })
</script>

<template>
  <div class="page-container">
    <el-row :gutter="20">
      <el-col :xs="12" :md="6">
        <el-card shadow="hover">
          <div style="text-align:center">
            <div style="font-size:36px;color:#409eff;font-weight:600">{{ store.stats.total }}</div>
            <div style="color:#909399;margin-top:4px">腐控单元总数</div>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="12" :md="6">
        <el-card shadow="hover">
          <div style="text-align:center">
            <div style="font-size:36px;color:#67c23a;font-weight:600">{{ store.stats.completed }}</div>
            <div style="color:#909399;margin-top:4px">已完成</div>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="12" :md="6">
        <el-card shadow="hover">
          <div style="text-align:center">
            <div style="font-size:36px;color:#e6a23c;font-weight:600">{{ store.stats.in_progress }}</div>
            <div style="color:#909399;margin-top:4px">进行中</div>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="12" :md="6">
        <el-card shadow="hover">
          <div style="text-align:center">
            <div style="font-size:36px;color:#f56c6c;font-weight:600">{{ store.stats.exception }}</div>
            <div style="color:#909399;margin-top:4px">异常单元</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-card style="margin-top:20px" shadow="never">
      <template #header>
        <div style="display:flex;align-items:center">
          <b style="font-size:15px">各腐控单元 7 项检测完成度（雷达图）</b>
          <div style="flex:1"></div>
          <span style="font-size:12px;color:#909399">外环 = 已完成，内环 = 待开始</span>
        </div>
      </template>
      <div ref="chartRef" style="width:100%;height:420px"></div>
    </el-card>

    <el-card style="margin-top:20px" shadow="never">
      <template #header>
        <b style="font-size:15px">详情矩阵（点击单元格可跳到录入）</b>
      </template>
      <el-table :data="store.dashboard?.rows ?? []" stripe style="width:100%" border>
        <el-table-column prop="unit_name" label="单元" width="120" fixed />
        <el-table-column
          v-for="it in store.dashboard?.items ?? []"
          :key="it.code"
          :label="it.name.length > 6 ? it.name.slice(0, 6) + '…' : it.name"
          align="center"
          min-width="100"
        >
          <template #default="{ row }">
            <el-tooltip :content="it.name" placement="top">
              <StatusTag
                :status="row.items.find((i: any) => i.code === it.code)?.status || 'pending'"
                short
              />
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="总进度" width="140" fixed="right">
          <template #default="{ row }">
            <el-progress :percentage="Math.round(row.progress * 100)" :stroke-width="10" />
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>
