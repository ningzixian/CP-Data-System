<script setup lang="ts">
/**
 * 数据看板 - 管网模块
 * 整合：GIS 导出 + 物探数据  (管径/材质/压力/建设年代/权属/埋设类型)
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import type { ZhiwenData } from '@/zhiwen/engine'

const props = defineProps<{ data: ZhiwenData; community: string }>()

const pipes = computed(() => filterByCommunity(props.data.pipes, props.community))
const regulators = computed(() => filterByCommunity(props.data.regulators, props.community))
const inlets = computed(() => filterByCommunity(props.data.inlets, props.community))
const joints = computed(() => filterByCommunity(props.data.joints, props.community))

const totalLength = computed(() => pipes.value.reduce((s, p) => s + toNumber(p.length), 0))
const topoPipes = computed(() => pipes.value.filter((p) => p.source === 'topology'))
const gisPipes = computed(() => pipes.value.filter((p) => p.source !== 'topology'))

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
  renderDiameterBar()
  renderMaterialPie()
  renderPressurePie()
  renderYearBar()
  renderOwnerBar()
  renderBuryPie()
}

function groupCount<T>(rows: T[], field: keyof T) {
  const m = new Map<string, number>()
  rows.forEach((r) => {
    const k = String((r as any)[field] ?? '(空)')
    m.set(k, (m.get(k) || 0) + 1)
  })
  return Array.from(m.entries()).map(([name, value]) => ({ name, value }))
}

function renderDiameterBar() {
  const el = refs.diameterBar
  if (!el) return
  if (!charts.diameterBar) { charts.diameterBar = echarts.init(el); window.addEventListener('resize', () => charts.diameterBar?.resize()) }
  // 管径按数值排序
  const data = groupCount(topoPipes.value, 'diametero')
    .map((d) => ({ ...d, _v: parseInt(d.name) || 0 }))
    .sort((a, b) => a._v - b._v)
    .map(({ _v, ...rest }) => rest)
  charts.diameterBar.setOption({
    tooltip: { trigger: 'axis' },
    grid: { top: 30, left: 50, right: 30, bottom: 60 },
    xAxis: { type: 'category', data: data.map((d) => 'DN' + d.name), axisLabel: { rotate: 30 } },
    yAxis: { type: 'value', name: '条数' },
    series: [{
      type: 'bar', data: data.map((d) => ({ ...d, itemStyle: { color: '#409eff' } })),
      label: { show: true, position: 'top' },
    }],
  })
}

function renderMaterialPie() {
  const el = refs.materialPie
  if (!el) return
  if (!charts.materialPie) { charts.materialPie = echarts.init(el); window.addEventListener('resize', () => charts.materialPie?.resize()) }
  charts.materialPie.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie', radius: ['40%', '70%'],
      data: groupCount(topoPipes.value, 'material'),
      label: { formatter: '{b}\n{c} ({d}%)' },
    }],
  })
}

function renderPressurePie() {
  const el = refs.pressurePie
  if (!el) return
  if (!charts.pressurePie) { charts.pressurePie = echarts.init(el); window.addEventListener('resize', () => charts.pressurePie?.resize()) }
  charts.pressurePie.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie', radius: ['40%', '70%'],
      data: groupCount(topoPipes.value, 'pressured'),
      label: { formatter: '{b}\n{c} ({d}%)' },
    }],
  })
}

function renderYearBar() {
  const el = refs.yearBar
  if (!el) return
  if (!charts.yearBar) { charts.yearBar = echarts.init(el); window.addEventListener('resize', () => charts.yearBar?.resize()) }
  const data = groupCount(topoPipes.value, 'build_year')
    .map((d) => ({ ...d, _v: parseInt(d.name) || 9999 }))
    .sort((a, b) => a._v - b._v)
    .map(({ _v, ...rest }) => rest)
  charts.yearBar.setOption({
    tooltip: { trigger: 'axis' },
    grid: { top: 30, left: 50, right: 30, bottom: 60 },
    xAxis: { type: 'category', data: data.map((d) => d.name + '年'), axisLabel: { rotate: 30 } },
    yAxis: { type: 'value', name: '条数' },
    series: [{
      type: 'bar', data: data.map((d) => ({ ...d, itemStyle: { color: '#e6a23c' } })),
      label: { show: true, position: 'top' },
    }],
  })
}

function renderOwnerBar() {
  const el = refs.ownerBar
  if (!el) return
  if (!charts.ownerBar) { charts.ownerBar = echarts.init(el); window.addEventListener('resize', () => charts.ownerBar?.resize()) }
  const data = groupCount(topoPipes.value, 'owner').sort((a, b) => b.value - a.value)
  charts.ownerBar.setOption({
    tooltip: { trigger: 'axis' },
    grid: { top: 30, left: 50, right: 30, bottom: 60 },
    xAxis: { type: 'category', data: data.map((d) => d.name), axisLabel: { rotate: 30 } },
    yAxis: { type: 'value', name: '条数' },
    series: [{
      type: 'bar', data: data.map((d) => ({ ...d, itemStyle: { color: '#67c23a' } })),
      label: { show: true, position: 'top' },
    }],
  })
}

function renderBuryPie() {
  const el = refs.buryPie
  if (!el) return
  if (!charts.buryPie) { charts.buryPie = echarts.init(el); window.addEventListener('resize', () => charts.buryPie?.resize()) }
  charts.buryPie.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie', radius: ['40%', '70%'],
      data: groupCount(topoPipes.value, 'bury_type'),
      label: { formatter: '{b}\n{c} ({d}%)' },
    }],
  })
}

onMounted(() => nextTick(renderAll))
onBeforeUnmount(() => {
  Object.values(charts).forEach((c) => c?.dispose())
  window.removeEventListener('resize', () => {})
})
watch(() => [props.community, props.data], () => nextTick(renderAll), { deep: false })

// 物探数据可用性
const hasTopo = computed(() => topoPipes.value.length > 0)
const oldPipes = computed(() => topoPipes.value.filter((p) => parseInt(p.build_year || '9999') < 2010).length)
</script>

<template>
  <div class="dash-network">
    <!-- 顶部 4 个 KPI -->
    <el-row :gutter="16">
      <el-col :xs="12" :md="6">
        <div class="kpi-card kpi-blue">
          <div class="kpi-icon">🔧</div>
          <div class="kpi-body">
            <div class="kpi-value">{{ pipes.length }}</div>
            <div class="kpi-label">管线段数</div>
            <div class="kpi-sub">GIS {{ gisPipes.length }} · 物探 {{ topoPipes.length }}</div>
          </div>
        </div>
      </el-col>
      <el-col :xs="12" :md="6">
        <div class="kpi-card kpi-orange">
          <div class="kpi-icon">🏭</div>
          <div class="kpi-body">
            <div class="kpi-value">{{ regulators.length }}</div>
            <div class="kpi-label">调压箱</div>
            <div class="kpi-sub">供气枢纽</div>
          </div>
        </div>
      </el-col>
      <el-col :xs="12" :md="6">
        <div class="kpi-card kpi-green">
          <div class="kpi-icon">🔌</div>
          <div class="kpi-body">
            <div class="kpi-value">{{ inlets.length }}</div>
            <div class="kpi-label">引入口</div>
            <div class="kpi-sub">用户接入点</div>
          </div>
        </div>
      </el-col>
      <el-col :xs="12" :md="6">
        <div class="kpi-card kpi-purple">
          <div class="kpi-icon">⚡</div>
          <div class="kpi-body">
            <div class="kpi-value">{{ joints.length }}</div>
            <div class="kpi-label">绝缘接头</div>
            <div class="kpi-sub">隔离分段</div>
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 物探数据图表 -->
    <el-card v-if="hasTopo" shadow="never" style="margin-top:16px">
      <template #header>
        <b>🏗️ 物探数据多维度分析（基于 {{ topoPipes.length }} 条物探线段）</b>
      </template>
      <el-row :gutter="16">
        <el-col :xs="24" :md="12">
          <div class="chart-title">📏 管径分布</div>
          <div :ref="setRef('diameterBar')" style="width:100%;height:260px"></div>
        </el-col>
        <el-col :xs="24" :md="12">
          <div class="chart-title">🔩 材质分布</div>
          <div :ref="setRef('materialPie')" style="width:100%;height:260px"></div>
        </el-col>
      </el-row>
      <el-row :gutter="16" style="margin-top:8px">
        <el-col :xs="24" :md="12">
          <div class="chart-title">💨 压力等级分布</div>
          <div :ref="setRef('pressurePie')" style="width:100%;height:260px"></div>
        </el-col>
        <el-col :xs="24" :md="12">
          <div class="chart-title">📅 建设年代分布</div>
          <div :ref="setRef('yearBar')" style="width:100%;height:260px"></div>
        </el-col>
      </el-row>
      <el-row :gutter="16" style="margin-top:8px">
        <el-col :xs="24" :md="12">
          <div class="chart-title">🏢 权属单位分布</div>
          <div :ref="setRef('ownerBar')" style="width:100%;height:260px"></div>
        </el-col>
        <el-col :xs="24" :md="12">
          <div class="chart-title">🕳️ 埋设类型分布</div>
          <div :ref="setRef('buryPie')" style="width:100%;height:260px"></div>
        </el-col>
      </el-row>
    </el-card>

    <el-alert v-else type="info" :closable="false" show-icon style="margin-top:16px">
      <template #title>暂无物探数据</template>
      物探数据通过 /public/data/topology/ 加载，目前没有该小区的物探记录。
    </el-alert>

    <!-- 物探数据明细表 -->
    <el-card v-if="hasTopo" shadow="never" style="margin-top:16px">
      <template #header>
        <b>📋 物探数据明细（按建设年代排序）</b>
        <el-tag v-if="oldPipes > 0" type="danger" effect="dark" size="small" style="margin-left: 8px">
          {{ oldPipes }} 条老旧管线（2010 年前）
        </el-tag>
      </template>
      <el-table :data="topoPipes.slice(0, 20).sort((a, b) => parseInt(a.build_year || '9999') - parseInt(b.build_year || '9999'))" stripe size="small" max-height="400">
        <el-table-column prop="fid" label="ID" width="70" />
        <el-table-column prop="pipeno" label="线段" width="130" />
        <el-table-column prop="community" label="小区" width="100" />
        <el-table-column label="管径 (mm)" width="100">
          <template #default="{ row }">DN{{ row.diametero }}</template>
        </el-table-column>
        <el-table-column prop="pressured" label="压力" width="180" show-overflow-tooltip />
        <el-table-column prop="material" label="材质" width="80" />
        <el-table-column label="建设年代" width="100">
          <template #default="{ row }">
            <el-tag v-if="parseInt(row.build_year || '9999') < 2010" type="danger" size="small">{{ row.build_year }}</el-tag>
            <el-tag v-else type="info" size="small">{{ row.build_year }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="bury_type" label="埋设类型" width="100" />
        <el-table-column prop="owner" label="权属" width="100" />
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.dash-network { width: 100%; }
.kpi-card {
  display: flex; align-items: center; gap: 14px;
  background: #fff; border-radius: 8px; padding: 18px 20px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04); border-left: 4px solid;
  margin-bottom: 12px;
}
.kpi-blue { border-left-color: #409eff; }
.kpi-orange { border-left-color: #e6a23c; }
.kpi-green { border-left-color: #67c23a; }
.kpi-purple { border-left-color: #9c64f0; }
.kpi-icon { font-size: 32px; }
.kpi-body { flex: 1; min-width: 0; }
.kpi-value { font-size: 28px; font-weight: 700; color: #303133; line-height: 1.1; }
.kpi-label { font-size: 13px; color: #606266; margin-top: 4px; }
.kpi-sub { font-size: 11px; color: #909399; margin-top: 2px; }
.chart-title { font-size: 13px; font-weight: 600; color: #606266; margin-bottom: 6px; }
</style>
