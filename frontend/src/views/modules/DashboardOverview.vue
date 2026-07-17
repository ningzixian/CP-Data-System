<script setup lang="ts">
/**
 * 数据看板 - 概览模块
 * 整合：管线(GIS+物探) + 设施 + 检测 + 进度  全部数据源
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import type { ZhiwenData } from '@/zhiwen/engine'

const props = defineProps<{ data: ZhiwenData; community: string }>()

const pipes = computed(() => filterByCommunity(props.data.pipes, props.community))
const regulators = computed(() => filterByCommunity(props.data.regulators, props.community))
const inlets = computed(() => filterByCommunity(props.data.inlets, props.community))
const joints = computed(() => filterByCommunity(props.data.joints, props.community))
const records = computed(() => filterByCommunity(props.data.records, props.community))
const units = computed(() => filterByCommunity(props.data.units, props.community))

const totalLength = computed(() => pipes.value.reduce((s, p) => s + toNumber(p.length), 0))
const topoCount = computed(() => pipes.value.filter((p) => p.source === 'topology').length)
const exceptions = computed(() => records.value.filter((r) => r.status === 'exception').length)
const passed = computed(() => records.value.filter((r) => r.status === 'passed').length)
const completedUnits = computed(() => units.value.filter((u) => u.inspection_status === 'completed').length)
const inProgressUnits = computed(() => units.value.filter((u) => u.inspection_status === 'in_progress').length)
const exceptionUnits = computed(() => units.value.filter((u) => u.inspection_status === 'exception').length)

function toNumber(v: any) {
  if (v === null || v === undefined || v === '') return 0
  const n = parseFloat(String(v))
  return isNaN(n) ? 0 : n
}
function filterByCommunity<T extends { community?: string }>(rows: T[], community: string): T[] {
  if (!community || community === '全部') return rows
  return rows.filter((r) => r.community === community)
}

const charts: Record<string, echarts.ECharts> = {}
const refs: Record<string, any> = {}

function setRef(key: string) {
  return (el: any) => { if (el) refs[key] = el.$el || el }
}

function renderAll() {
  renderLengthByCommunity()
  renderStatusPie()
  renderCompletionBar()
  renderExceptionBar()
}

function renderLengthByCommunity() {
  const el = refs.lengthBar
  if (!el) return
  if (!charts.lengthBar) {
    charts.lengthBar = echarts.init(el)
    window.addEventListener('resize', () => charts.lengthBar?.resize())
  }
  // 算各小区管线总长（基于 props.data 全量）
  const m = new Map<string, number>()
  props.data.pipes.forEach((p) => {
    if (props.community !== '全部' && p.community !== props.community) return
    m.set(p.community, (m.get(p.community) || 0) + toNumber(p.length))
  })
  charts.lengthBar.setOption({
    tooltip: { trigger: 'axis' },
    grid: { top: 30, left: 60, right: 30, bottom: 30 },
    xAxis: { type: 'category', data: Array.from(m.keys()) },
    yAxis: { type: 'value', name: '长度(m)' },
    series: [{
      type: 'bar',
      data: Array.from(m.entries()).map(([name, value]) => ({
        name, value: Math.round(value),
        itemStyle: { color: name === props.community ? '#67c23a' : '#409eff' },
      })),
      label: { show: true, position: 'top', formatter: (p: any) => p.value.toFixed(0) },
    }],
  })
}

function renderStatusPie() {
  const el = refs.statusPie
  if (!el) return
  if (!charts.statusPie) {
    charts.statusPie = echarts.init(el)
    window.addEventListener('resize', () => charts.statusPie?.resize())
  }
  const data = [
    { name: '通过', value: passed.value, itemStyle: { color: '#67c23a' } },
    { name: '异常', value: exceptions.value, itemStyle: { color: '#f56c6c' } },
    { name: '待开始', value: records.value.filter((r) => r.status === 'pending').length, itemStyle: { color: '#909399' } },
  ].filter((x) => x.value > 0)
  charts.statusPie.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      data,
      label: { formatter: '{b}\n{c} ({d}%)' },
    }],
  })
}

function renderCompletionBar() {
  const el = refs.completionBar
  if (!el) return
  if (!charts.completionBar) {
    charts.completionBar = echarts.init(el)
    window.addEventListener('resize', () => charts.completionBar?.resize())
  }
  // 各小区完成率
  const m = new Map<string, { total: number; completed: number }>()
  props.data.units.forEach((u) => {
    if (props.community !== '全部' && u.community !== props.community) return
    if (!m.has(u.community)) m.set(u.community, { total: 0, completed: 0 })
    const item = m.get(u.community)!
    item.total++
    if (u.inspection_status === 'completed') item.completed++
  })
  charts.completionBar.setOption({
    tooltip: { trigger: 'axis' },
    grid: { top: 30, left: 60, right: 30, bottom: 30 },
    xAxis: { type: 'category', data: Array.from(m.keys()) },
    yAxis: { type: 'value', name: '完成率(%)', max: 100 },
    series: [{
      type: 'bar',
      data: Array.from(m.entries()).map(([name, v]) => ({
        name,
        value: v.total ? Math.round((v.completed / v.total) * 100) : 0,
        itemStyle: { color: '#67c23a' },
      })),
      label: { show: true, position: 'top', formatter: '{c}%' },
    }],
  })
}

function renderExceptionBar() {
  const el = refs.exceptionBar
  if (!el) return
  if (!charts.exceptionBar) {
    charts.exceptionBar = echarts.init(el)
    window.addEventListener('resize', () => charts.exceptionBar?.resize())
  }
  // 异常按检测项
  const m = new Map<string, number>()
  records.value.filter((r) => r.status === 'exception').forEach((r) => {
    m.set(r.item_name || r.item_code, (m.get(r.item_name || r.item_code) || 0) + 1)
  })
  const data = Array.from(m.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  charts.exceptionBar.setOption({
    tooltip: { trigger: 'axis' },
    grid: { top: 30, left: 60, right: 30, bottom: 60 },
    xAxis: { type: 'category', data: data.map((d) => d.name), axisLabel: { rotate: 30, fontSize: 11 } },
    yAxis: { type: 'value', name: '异常数' },
    series: [{
      type: 'bar',
      data: data.map((d) => ({ ...d, itemStyle: { color: '#f56c6c' } })),
      label: { show: true, position: 'top' },
    }],
  })
}

onMounted(() => nextTick(renderAll))
onBeforeUnmount(() => {
  Object.values(charts).forEach((c) => c?.dispose())
  window.removeEventListener('resize', () => {})
})

watch(() => [props.community, props.data], () => nextTick(renderAll), { deep: false })

const communityDisplay = computed(() => props.community === '全部' ? '全部小区' : props.community.replace('南海家园', ''))
const exceptionRate = computed(() => records.value.length ? ((exceptions.value / records.value.length) * 100).toFixed(1) : '0')
const completionRate = computed(() => units.value.length ? ((completedUnits.value / units.value.length) * 100).toFixed(1) : '0')
</script>

<template>
  <div class="dash-overview">
    <!-- 核心 KPI -->
    <el-row :gutter="16">
      <el-col :xs="12" :md="6">
        <div class="kpi-card kpi-blue">
          <div class="kpi-icon">🔧</div>
          <div class="kpi-body">
            <div class="kpi-value">{{ pipes.length }}</div>
            <div class="kpi-label">管线段数</div>
            <div class="kpi-sub">总长 {{ totalLength.toFixed(1) }} m · 物探 {{ topoCount }} 条</div>
          </div>
        </div>
      </el-col>
      <el-col :xs="12" :md="6">
        <div class="kpi-card kpi-orange">
          <div class="kpi-icon">📍</div>
          <div class="kpi-body">
            <div class="kpi-value">{{ regulators.length + inlets.length + joints.length }}</div>
            <div class="kpi-label">设施总数</div>
            <div class="kpi-sub">调压箱 {{ regulators.length }} · 引入口 {{ inlets.length }} · 接头 {{ joints.length }}</div>
          </div>
        </div>
      </el-col>
      <el-col :xs="12" :md="6">
        <div class="kpi-card kpi-red">
          <div class="kpi-icon">⚠️</div>
          <div class="kpi-body">
            <div class="kpi-value">{{ exceptions }}</div>
            <div class="kpi-label">异常检测</div>
            <div class="kpi-sub">异常率 {{ exceptionRate }}% · 共 {{ records.length }} 条记录</div>
          </div>
        </div>
      </el-col>
      <el-col :xs="12" :md="6">
        <div class="kpi-card kpi-green">
          <div class="kpi-icon">✅</div>
          <div class="kpi-body">
            <div class="kpi-value">{{ completionRate }}%</div>
            <div class="kpi-label">腐控完成率</div>
            <div class="kpi-sub">完成 {{ completedUnits }}/{{ units.length }} · 进行 {{ inProgressUnits }}</div>
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 图表区 -->
    <el-row :gutter="16" style="margin-top:16px">
      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <template #header><b>📏 各小区管线总长对比（m）</b></template>
          <div :ref="setRef('lengthBar')" style="width:100%;height:280px"></div>
        </el-card>
      </el-col>
      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <template #header><b>📊 检测状态分布</b></template>
          <div :ref="setRef('statusPie')" style="width:100%;height:280px"></div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" style="margin-top:16px">
      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <template #header><b>📈 各小区腐控单元完成率</b></template>
          <div :ref="setRef('completionBar')" style="width:100%;height:280px"></div>
        </el-card>
      </el-col>
      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <template #header><b>🚨 异常检测项分布</b></template>
          <div :ref="setRef('exceptionBar')" style="width:100%;height:280px"></div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 关键洞察 -->
    <el-card shadow="never" style="margin-top:16px">
      <template #header><b>💡 关键洞察（{{ communityDisplay }}）</b></template>
      <ul class="insight-list">
        <li v-if="pipes.length > 0">
          管网规模：<b>{{ pipes.length }}</b> 条管线，总长 <b>{{ totalLength.toFixed(1) }} m</b>
          <span v-if="topoCount > 0">，其中 <b>{{ topoCount }}</b> 条来自物探数据（管径/建设年代/权属/埋设类型已建档）</span>
        </li>
        <li v-if="regulators.length + inlets.length + joints.length > 0">
          设施分布：<b>{{ regulators.length }}</b> 调压箱 + <b>{{ inlets.length }}</b> 引入口 + <b>{{ joints.length }}</b> 绝缘接头
        </li>
        <li :class="exceptions > 0 ? 'insight-bad' : 'insight-good'">
          检测质量：{{ exceptions > 0 ? `共发现 ${exceptions} 条异常（异常率 ${exceptionRate}%），建议立即复核整改` : `所有检测均通过或待开始，状态良好` }}
        </li>
        <li :class="Number(completionRate) >= 80 ? 'insight-good' : 'insight-warn'">
          进度情况：完成率 <b>{{ completionRate }}%</b>，{{ Number(completionRate) >= 80 ? '进度良好' : '仍需加快推进' }}
        </li>
      </ul>
    </el-card>
  </div>
</template>

<style scoped>
.dash-overview { width: 100%; }
.kpi-card {
  display: flex;
  align-items: center;
  gap: 14px;
  background: #fff;
  border-radius: 8px;
  padding: 18px 20px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
  border-left: 4px solid;
  margin-bottom: 12px;
}
.kpi-blue { border-left-color: #409eff; }
.kpi-orange { border-left-color: #e6a23c; }
.kpi-red { border-left-color: #f56c6c; }
.kpi-green { border-left-color: #67c23a; }
.kpi-icon { font-size: 32px; }
.kpi-body { flex: 1; min-width: 0; }
.kpi-value { font-size: 28px; font-weight: 700; color: #303133; line-height: 1.1; }
.kpi-label { font-size: 13px; color: #606266; margin-top: 4px; }
.kpi-sub { font-size: 11px; color: #909399; margin-top: 2px; }
.insight-list { margin: 0; padding-left: 20px; line-height: 2; color: #606266; }
.insight-good { color: #67c23a; }
.insight-bad { color: #f56c6c; }
.insight-warn { color: #e6a23c; }
</style>
