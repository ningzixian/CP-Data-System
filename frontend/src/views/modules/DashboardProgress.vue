<script setup lang="ts">
/**
 * 数据看板 - 进度模块
 * 保留原 DashboardPage 雷达图 + 矩阵，集成管网/物探数据
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import * as echarts from 'echarts'
import { Search } from '@element-plus/icons-vue'
import type { ZhiwenData } from '@/zhiwen/engine'
import StatusTag from '@/components/StatusTag.vue'

const props = defineProps<{ data: ZhiwenData; community: string }>()
const router = useRouter()

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

function buildUnitRows(unitList: typeof units.value, recordList: typeof records.value): UnitRow[] {
  return unitList.map((u) => {
    const uRecords = recordList.filter((r) => r.unit_id === u.id)
    const recMap = new Map<string, any>()
    uRecords.forEach((record) => {
      const previous = recMap.get(record.item_code)
      if (!previous || (record.updated_at || '').localeCompare(previous.updated_at || '') > 0) {
        recMap.set(record.item_code, record)
      }
    })
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
}

const unitRows = computed<UnitRow[]>(() => buildUnitRows(units.value, records.value))

const matrixCommunity = ref(props.community || '全部')
const matrixSearch = ref('')
const matrixCommunities = computed(() => [
  '全部',
  ...new Set(props.data.units.map((unit) => unit.community).filter(Boolean)),
])
const matrixRows = computed<UnitRow[]>(() => {
  const selectedUnits = filterByCommunity(props.data.units, matrixCommunity.value)
  const selectedRecords = filterByCommunity(props.data.records, matrixCommunity.value)
  const rows = buildUnitRows(selectedUnits, selectedRecords)
  const keyword = matrixSearch.value.trim().toLowerCase()
  if (!keyword) return rows
  return rows.filter((row) =>
    row.unit_name.toLowerCase().includes(keyword)
    || row.community.toLowerCase().includes(keyword),
  )
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
let resizeObserver: ResizeObserver | null = null
let resizeFrame = 0

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
      radius: '70%',
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

function handleResize() {
  cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(() => {
    if (chartRef.value?.clientWidth && chartRef.value.clientHeight) chart?.resize()
  })
}
function openRecord(unitId: number, itemCode: string) {
  void router.push({ name: 'manage', query: { unit_id: String(unitId), item_code: itemCode } })
}
onMounted(() => {
  resizeObserver = new ResizeObserver(handleResize)
  if (chartRef.value) resizeObserver.observe(chartRef.value)
  window.addEventListener('resize', handleResize)
  void nextTick(() => {
    renderChart()
    handleResize()
  })
})
onBeforeUnmount(() => {
  cancelAnimationFrame(resizeFrame)
  resizeObserver?.disconnect()
  resizeObserver = null
  chart?.dispose()
  chart = null
  window.removeEventListener('resize', handleResize)
})
watch(() => [props.community, props.data], () => nextTick(() => {
  renderChart()
  handleResize()
}), { deep: false })
watch(() => props.community, (community) => {
  matrixCommunity.value = community || '全部'
})
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
      <div ref="chartRef" class="progress-radar"></div>
    </el-card>

    <el-card shadow="never" style="margin-top:16px">
      <template #header>
        <div class="matrix-header">
          <b>详情矩阵（点击单元格可查看）</b>
          <div class="matrix-filter">
            <span>小区</span>
            <el-select v-model="matrixCommunity" size="small" style="width:170px">
              <el-option
                v-for="communityName in matrixCommunities"
                :key="communityName"
                :label="communityName === '全部' ? '全部小区' : communityName.replace('南海家园', '')"
                :value="communityName"
              />
            </el-select>
            <el-input
              v-model="matrixSearch"
              :prefix-icon="Search"
              placeholder="搜索单元名称"
              clearable
              size="small"
              style="width:200px"
            />
            <span class="matrix-count">{{ matrixRows.length }} 个单元</span>
          </div>
        </div>
      </template>
      <el-table :data="matrixRows" stripe size="small" border max-height="500">
        <el-table-column prop="unit_name" label="单元" width="120" fixed />
        <el-table-column prop="community" label="小区" width="100" />
        <el-table-column v-for="it in ITEMS" :key="it.code" :label="it.name.length > 6 ? it.name.slice(0, 6) + '…' : it.name" align="center" min-width="100">
          <template #default="{ row }">
            <button class="progress-record-cell" type="button" :aria-label="`查看 ${row.unit_name} ${it.name}`" @click="openRecord(row.unit_id, it.code)">
              <el-tooltip :content="`${it.name} · 点击前往数据管理`" placement="top">
                <StatusTag :status="row.items.find((i: any) => i.code === it.code)?.status || 'pending'" short />
              </el-tooltip>
            </button>
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
.progress-radar { width: 100%; height: 420px; min-width: 0; }
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
.matrix-header { display:flex; align-items:center; justify-content:space-between; gap:16px; font-size:15px; }
.matrix-filter { display:flex; align-items:center; gap:8px; color:var(--app-text-secondary); font-size:13px; font-weight:400; }
.matrix-count { min-width:64px; color:var(--app-text-muted); font-size:12px; }
.progress-record-cell { width:100%; padding:5px; border:0; background:transparent; cursor:pointer; }
.progress-record-cell:hover { border-radius:6px; background:color-mix(in srgb,var(--app-accent) 10%,transparent); }

@media (max-width: 720px) {
  .matrix-header { align-items:flex-start; flex-direction:column; }
  .matrix-filter { width:100%; flex-wrap:wrap; }
}
</style>
