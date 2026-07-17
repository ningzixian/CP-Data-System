<script setup lang="ts">
/**
 * 数据看板 - 检测模块
 * 整合：检测记录 + 异常分析 + 检测项分布 + 检测员表现
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import type { ZhiwenData } from '@/zhiwen/engine'

const props = defineProps<{ data: ZhiwenData; community: string }>()

const records = computed(() => filterByCommunity(props.data.records, props.community))
const exceptions = computed(() => records.value.filter((r) => r.status === 'exception'))
const passed = computed(() => records.value.filter((r) => r.status === 'passed'))
const pending = computed(() => records.value.filter((r) => r.status === 'pending'))

const exceptionRate = computed(() => records.value.length ? ((exceptions.value.length / records.value.length) * 100).toFixed(1) : '0')
const passRate = computed(() => records.value.length ? ((passed.value.length / records.value.length) * 100).toFixed(1) : '0')

function filterByCommunity<T extends { community?: string }>(rows: T[], community: string): T[] {
  if (!community || community === '全部') return rows
  return rows.filter((r) => r.community === community)
}

function groupCount<T>(rows: T[], field: keyof T) {
  const m = new Map<string, number>()
  rows.forEach((r) => {
    const k = String((r as any)[field] ?? '(空)')
    m.set(k, (m.get(k) || 0) + 1)
  })
  return Array.from(m.entries()).map(([name, value]) => ({ name, value }))
}

const charts: Record<string, echarts.ECharts> = {}
const refs: Record<string, any> = {}
function setRef(key: string) { return (el: any) => { if (el) refs[key] = el.$el || el } }

function renderAll() {
  renderItemStatus()
  renderItemException()
  renderInspector()
  renderCommunityBar()
  renderExceptionInspector()
}

function renderItemStatus() {
  const el = refs.itemStatus
  if (!el) return
  if (!charts.itemStatus) { charts.itemStatus = echarts.init(el); window.addEventListener('resize', () => charts.itemStatus?.resize()) }
  // 按检测项统计：通过/异常
  const m = new Map<string, { passed: number; exception: number; pending: number }>()
  records.value.forEach((r) => {
    const k = r.item_name || r.item_code
    if (!m.has(k)) m.set(k, { passed: 0, exception: 0, pending: 0 })
    const item = m.get(k)!
    if (r.status === 'passed') item.passed++
    else if (r.status === 'exception') item.exception++
    else item.pending++
  })
  const categories = Array.from(m.keys())
  charts.itemStatus.setOption({
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0 },
    grid: { top: 30, left: 50, right: 30, bottom: 60 },
    xAxis: { type: 'category', data: categories, axisLabel: { rotate: 25, fontSize: 11 } },
    yAxis: { type: 'value', name: '条数' },
    series: [
      { name: '通过', type: 'bar', stack: 's', data: categories.map((c) => m.get(c)!.passed), itemStyle: { color: '#67c23a' } },
      { name: '异常', type: 'bar', stack: 's', data: categories.map((c) => m.get(c)!.exception), itemStyle: { color: '#f56c6c' } },
      { name: '待开始', type: 'bar', stack: 's', data: categories.map((c) => m.get(c)!.pending), itemStyle: { color: '#909399' } },
    ],
  })
}

function renderItemException() {
  const el = refs.itemException
  if (!el) return
  if (!charts.itemException) { charts.itemException = echarts.init(el); window.addEventListener('resize', () => charts.itemException?.resize()) }
  charts.itemException.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie', radius: ['40%', '70%'],
      data: groupCount(exceptions.value, 'item_name'),
      label: { formatter: '{b}\n{c} ({d}%)' },
    }],
  })
}

function renderInspector() {
  const el = refs.inspector
  if (!el) return
  if (!charts.inspector) { charts.inspector = echarts.init(el); window.addEventListener('resize', () => charts.inspector?.resize()) }
  const data = groupCount(records.value, 'inspector').sort((a, b) => b.value - a.value).slice(0, 10)
  charts.inspector.setOption({
    tooltip: { trigger: 'axis' },
    grid: { top: 30, left: 50, right: 30, bottom: 80 },
    xAxis: { type: 'category', data: data.map((d) => d.name), axisLabel: { rotate: 30 } },
    yAxis: { type: 'value', name: '条数' },
    series: [{ type: 'bar', data: data.map((d) => ({ ...d, itemStyle: { color: '#409eff' } })), label: { show: true, position: 'top' } }],
  })
}

function renderCommunityBar() {
  const el = refs.communityBar
  if (!el) return
  if (!charts.communityBar) { charts.communityBar = echarts.init(el); window.addEventListener('resize', () => charts.communityBar?.resize()) }
  charts.communityBar.setOption({
    tooltip: { trigger: 'axis' },
    grid: { top: 30, left: 50, right: 30, bottom: 30 },
    xAxis: { type: 'category', data: Array.from(new Set(records.value.map((r) => r.community))) },
    yAxis: { type: 'value', name: '条数' },
    series: [{ type: 'bar', data: groupCount(records.value, 'community').map((d) => ({ ...d, itemStyle: { color: '#67c23a' } })), label: { show: true, position: 'top' } }],
  })
}

function renderExceptionInspector() {
  const el = refs.exceptionInspector
  if (!el) return
  if (!charts.exceptionInspector) { charts.exceptionInspector = echarts.init(el); window.addEventListener('resize', () => charts.exceptionInspector?.resize()) }
  charts.exceptionInspector.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie', radius: ['40%', '70%'],
      data: groupCount(exceptions.value, 'inspector'),
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

// 异常明细
const exceptionDetails = computed(() => exceptions.value.slice(0, 20))
</script>

<template>
  <div class="dash-inspection">
    <!-- 4 个 KPI -->
    <el-row :gutter="16">
      <el-col :xs="12" :md="6">
        <div class="kpi-card kpi-blue">
          <div class="kpi-icon">📋</div>
          <div class="kpi-body">
            <div class="kpi-value">{{ records.length }}</div>
            <div class="kpi-label">检测记录</div>
            <div class="kpi-sub">总记录数</div>
          </div>
        </div>
      </el-col>
      <el-col :xs="12" :md="6">
        <div class="kpi-card kpi-green">
          <div class="kpi-icon">✅</div>
          <div class="kpi-body">
            <div class="kpi-value">{{ passed.length }}</div>
            <div class="kpi-label">通过</div>
            <div class="kpi-sub">通过率 {{ passRate }}%</div>
          </div>
        </div>
      </el-col>
      <el-col :xs="12" :md="6">
        <div class="kpi-card kpi-red">
          <div class="kpi-icon">⚠️</div>
          <div class="kpi-body">
            <div class="kpi-value">{{ exceptions.length }}</div>
            <div class="kpi-label">异常</div>
            <div class="kpi-sub">异常率 {{ exceptionRate }}%</div>
          </div>
        </div>
      </el-col>
      <el-col :xs="12" :md="6">
        <div class="kpi-card kpi-orange">
          <div class="kpi-icon">⏳</div>
          <div class="kpi-body">
            <div class="kpi-value">{{ pending.length }}</div>
            <div class="kpi-label">待开始</div>
            <div class="kpi-sub">需安排检测</div>
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 图表区 -->
    <el-row :gutter="16" style="margin-top:16px">
      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <template #header><b>📊 各检测项状态分布（堆叠柱状）</b></template>
          <div :ref="setRef('itemStatus')" style="width:100%;height:280px"></div>
        </el-card>
      </el-col>
      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <template #header><b>🚨 异常检测项占比</b></template>
          <div :ref="setRef('itemException')" style="width:100%;height:280px"></div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" style="margin-top:16px">
      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <template #header><b>👷 检测员工作量 TOP 10</b></template>
          <div :ref="setRef('inspector')" style="width:100%;height:280px"></div>
        </el-card>
      </el-col>
      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <template #header><b>🏘️ 各小区检测记录数</b></template>
          <div :ref="setRef('communityBar')" style="width:100%;height:280px"></div>
        </el-card>
      </el-col>
    </el-row>

    <el-row v-if="exceptions.length > 0" :gutter="16" style="margin-top:16px">
      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <template #header><b>👤 异常记录检测员分布</b></template>
          <div :ref="setRef('exceptionInspector')" style="width:100%;height:280px"></div>
        </el-card>
      </el-col>
      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <template #header>
            <b>📝 异常记录明细（最近 {{ exceptionDetails.length }} 条）</b>
          </template>
          <el-table :data="exceptionDetails" stripe size="small" max-height="280">
            <el-table-column prop="item_name" label="检测项" width="120" />
            <el-table-column prop="community" label="小区" width="100" />
            <el-table-column prop="unit_name" label="单元" width="100" />
            <el-table-column label="测量值" width="120">
              <template #default="{ row }">
                <span :style="{ color: '#f56c6c', fontWeight: 600 }">{{ row.measured_value }} {{ row.unit || '' }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="inspector" label="检测员" width="80" />
            <el-table-column label="时间" width="100">
              <template #default="{ row }">
                {{ row.inspection_date ? new Date(row.inspection_date).toLocaleDateString('zh-CN') : '-' }}
              </template>
            </el-table-column>
            <el-table-column prop="result_summary" label="摘要" show-overflow-tooltip />
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.dash-inspection { width: 100%; }
.kpi-card {
  display: flex; align-items: center; gap: 14px;
  background: #fff; border-radius: 8px; padding: 18px 20px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04); border-left: 4px solid;
  margin-bottom: 12px;
}
.kpi-blue { border-left-color: #409eff; }
.kpi-green { border-left-color: #67c23a; }
.kpi-red { border-left-color: #f56c6c; }
.kpi-orange { border-left-color: #e6a23c; }
.kpi-icon { font-size: 32px; }
.kpi-body { flex: 1; min-width: 0; }
.kpi-value { font-size: 28px; font-weight: 700; color: #303133; line-height: 1.1; }
.kpi-label { font-size: 13px; color: #606266; margin-top: 4px; }
.kpi-sub { font-size: 11px; color: #909399; margin-top: 2px; }
</style>
