<script setup lang="ts">
/**
 * 数据管理（重写版）
 *
 * 整合所有可管理数据：
 *  - 管道 Pipeline（store.pipelines）
 *  - 腐控单元 CorrosionUnit（store.units + records 算进度）
 *  - 检测记录 InspectionRecord（store.records）
 *  - 管网设施（GIS + 物探，调压箱/引入口/绝缘接头/物探点）
 *
 * 每个 tab：
 *  - 4 个统计卡片
 *  - 工具栏（搜索/筛选/刷新/新增/导入导出）
 *  - 数据表 + 分页
 */
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Refresh, Plus, Download, Delete, Edit, View } from '@element-plus/icons-vue'
import { useCpStore } from '@/stores/cp'
import { unitsApi } from '@/api/units'
import { recordsApi } from '@/api/records'
import { pipelinesApi } from '@/api/pipelines'
import { importApi } from '@/api/import'
import { loadZhiwenNetworkData, projectCpData } from '@/zhiwen/dataLoader'
import { communityOfUnit } from '@/utils/community'
import RecordFormDialog from '@/components/RecordFormDialog.vue'
import StatusTag from '@/components/StatusTag.vue'
import type { CorrosionUnitInput, InspectionItemCode, InspectionRecord, CorrosionUnit, Pipeline } from '@/types/models'
import type { ZhiwenData } from '@/zhiwen/engine'

const store = useCpStore()
const route = useRoute()
type RecordDialogMode = 'create' | 'edit' | 'view'

// ============== 状态 ==============
const activeTab = ref<'units' | 'records' | 'pipelines' | 'facilities'>('units')
const network = ref<ZhiwenData>({
  pipes: [], inlets: [], controls: [], joints: [], regulators: [],
  units: [], records: [], communities: [],
  topology: null,
})

// 各 tab 通用：分页 + 搜索
const pagination = reactive({ page: 1, pageSize: 10 })
function resetPage() { pagination.page = 1 }

// 腐控单元
const unitSearch = ref('')
const unitStatusFilter = ref<string>('')
const editingUnit = ref<CorrosionUnit | null>(null)
const unitDialogVisible = ref(false)
const unitForm = reactive<CorrosionUnitInput>({
  pipeline_id: 1, name: '', start_mileage: 0, end_mileage: 0,
  lng: 116.494, lat: 39.757, address: '',
})

// 检测记录
const recordSearch = ref('')
const recordStatusFilter = ref<string>('')
const recordItemFilter = ref<string>('')
const recordUnitFilter = ref<number | null>(null)
const recordDialogVisible = ref(false)
const recordDialogMode = ref<RecordDialogMode>('create')
const activeRecord = ref<InspectionRecord | null>(null)

// 管道
const pipelineDialogVisible = ref(false)
const pipelineForm = reactive<Partial<Pipeline>>({
  name: '', code: '', start_point: '', end_point: '',
  length_km: 0, diameter_mm: 0, install_year: 2012, description: '',
})

// 管网设施筛选
const facilityTypeFilter = ref<string>('all')
const facilityCommunityFilter = ref<string>('')

const ITEMS = [
  { code: 'JOINT_VERIFY', name: '绝缘接头' },
  { code: 'SOIL_RESISTIVITY', name: '土壤电阻率' },
  { code: 'DC_STRAY_CURRENT', name: '杂散电流' },
  { code: 'COATING_DETECT', name: '防腐层' },
  { code: 'PIPE_GROUND_POTENTIAL', name: '管地电位' },
  { code: 'ELECTRIC_CONTINUITY', name: '电联通' },
  { code: 'INLET_PARAM', name: '引入口' },
]

const STATUS_OPTIONS = [
  { value: 'pending', label: '待开始', color: '#909399' },
  { value: 'in_progress', label: '进行中', color: '#e6a23c' },
  { value: 'passed', label: '通过', color: '#67c23a' },
  { value: 'exception', label: '异常', color: '#f56c6c' },
  { value: 'completed', label: '已完成', color: '#67c23a' },
]

// ============== 工具 ==============
function fmt(d?: string) {
  if (!d) return '—'
  return new Date(d).toLocaleString('zh-CN')
}
function progressOf(unitId: number): number {
  const recs = store.records.filter((r) => r.unit_id === unitId)
  const latestByItem = new Map<string, InspectionRecord>()
  recs.forEach((record) => {
    const previous = latestByItem.get(record.item_code)
    if (!previous || record.updated_at.localeCompare(previous.updated_at) > 0) latestByItem.set(record.item_code, record)
  })
  return [...latestByItem.values()].filter((record) => record.status === 'passed').length / ITEMS.length
}
function latestInspection(unitId: number): string {
  const recs = store.records.filter((r) => r.unit_id === unitId)
  if (!recs.length) return '—'
  return recs.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))[0].updated_at
}

// ============== 加载 ==============
async function loadAll(force = false) {
  const [net] = await Promise.all([
    loadZhiwenNetworkData(force),
    store.loadAll(force),
  ])
  const communityByUnit = Object.fromEntries(store.units.map((unit) => [unit.id, communityOfUnit(unit)]))
  const cp = projectCpData(store.units as any, store.records as any, communityByUnit)
  network.value = {
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
}
onMounted(() => void loadAll())
watch([unitSearch, unitStatusFilter, recordSearch, recordStatusFilter, recordItemFilter, recordUnitFilter, facilityTypeFilter, facilityCommunityFilter], resetPage)

// ============== 概览统计 ==============
const stats = computed(() => {
  const totalUnits = store.units.length
  const completedUnits = store.units.filter((u) => u.inspection_status === 'completed').length
  const exceptionUnits = store.units.filter((u) => u.inspection_status === 'exception').length
  const totalRecords = store.records.length
  const exceptionRecords = store.records.filter((r) => r.status === 'exception').length
  return {
    units: { total: totalUnits, completed: completedUnits, inProgress: store.units.filter((u) => u.inspection_status === 'in_progress').length, exception: exceptionUnits },
    records: { total: totalRecords, passed: store.records.filter((r) => r.status === 'passed').length, exception: exceptionRecords, pending: store.records.filter((r) => r.status === 'pending').length },
    pipelines: { total: store.pipelines.length },
    facilities: { total: network.value.regulators.length + network.value.inlets.length + network.value.joints.length + network.value.controls.length, regulators: network.value.regulators.length, inlets: network.value.inlets.length, joints: network.value.joints.length, controls: network.value.controls.length },
  }
})

// ============== 腐控单元 ==============
const filteredUnits = computed(() => {
  let list = [...store.units]
  if (unitSearch.value) {
    const q = unitSearch.value.toLowerCase()
    list = list.filter((u) =>
      u.name.toLowerCase().includes(q) ||
      (u.address || '').toLowerCase().includes(q)
    )
  }
  if (unitStatusFilter.value) {
    list = list.filter((u) => u.inspection_status === unitStatusFilter.value)
  }
  return list
})
const pagedUnits = computed(() => {
  const start = (pagination.page - 1) * pagination.pageSize
  return filteredUnits.value.slice(start, start + pagination.pageSize)
})
function openUnitDialog(unit?: CorrosionUnit) {
  if (unit) {
    editingUnit.value = unit
    Object.assign(unitForm, {
      pipeline_id: unit.pipeline_id, name: unit.name,
      start_mileage: unit.start_mileage, end_mileage: unit.end_mileage,
      lng: unit.lng, lat: unit.lat, address: unit.address || '',
    })
  } else {
    editingUnit.value = null
    Object.assign(unitForm, {
      pipeline_id: 1, name: '', start_mileage: 0, end_mileage: 0,
      lng: 116.494, lat: 39.757, address: '',
    })
  }
  unitDialogVisible.value = true
}
async function submitUnit() {
  if (!unitForm.name) { ElMessage.warning('请输入单元名称'); return }
  try {
    if (editingUnit.value) {
      await unitsApi.update(editingUnit.value.id, unitForm)
      ElMessage.success('已更新')
    } else {
      await unitsApi.create(unitForm)
      ElMessage.success('已创建')
    }
    unitDialogVisible.value = false
    await store.loadAll(true)
  } catch (e: any) {
    ElMessage.error('保存失败：' + (e?.message || '未知错误'))
  }
}
async function deleteUnit(unit: CorrosionUnit) {
  try { await ElMessageBox.confirm(`确认删除「${unit.name}」及其全部检测记录？`, '提示', { type: 'warning' }) } catch { return }
  await unitsApi.remove(unit.id)
  ElMessage.success('已删除')
  await store.loadAll(true)
}

// ============== 检测记录 ==============
const filteredRecords = computed(() => {
  let list = [...store.records]
  if (recordSearch.value) {
    const q = recordSearch.value.toLowerCase()
    list = list.filter((r) =>
      (r.item_name || '').toLowerCase().includes(q) ||
      (r.inspector || '').toLowerCase().includes(q) ||
      (r.result_summary || '').toLowerCase().includes(q)
    )
  }
  if (recordStatusFilter.value) list = list.filter((r) => r.status === recordStatusFilter.value)
  if (recordItemFilter.value) list = list.filter((r) => r.item_code === recordItemFilter.value)
  if (recordUnitFilter.value !== null) list = list.filter((r) => r.unit_id === recordUnitFilter.value)
  return list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
})
const pagedRecords = computed(() => {
  const start = (pagination.page - 1) * pagination.pageSize
  return filteredRecords.value.slice(start, start + pagination.pageSize)
})
function openRecordDialog(mode: RecordDialogMode, record: InspectionRecord | null = null) {
  recordDialogMode.value = mode
  activeRecord.value = record
  recordDialogVisible.value = true
}
async function handleRecordSaved() { await store.loadAll(true) }
async function deleteRecord(row: InspectionRecord) {
  try { await ElMessageBox.confirm(`确认删除「${row.item_name}」的记录？`, '提示', { type: 'warning' }) } catch { return }
  await recordsApi.remove(row.id)
  ElMessage.success('已删除')
  await store.loadAll(true)
}

watch(
  () => [route.query.unit_id, route.query.item_code] as const,
  ([unitId, itemCode]) => {
    const parsedUnitId = Number(Array.isArray(unitId) ? unitId[0] : unitId)
    recordUnitFilter.value = Number.isFinite(parsedUnitId) && parsedUnitId > 0 ? parsedUnitId : null
    const code = Array.isArray(itemCode) ? itemCode[0] : itemCode
    recordItemFilter.value = ITEMS.some((item) => item.code === code) ? code as InspectionItemCode : ''
    if (recordUnitFilter.value !== null || recordItemFilter.value) activeTab.value = 'records'
    resetPage()
  },
  { immediate: true },
)

// ============== 管道 ==============
const filteredPipelines = computed(() => {
  return [...store.pipelines]
})
const pagedPipelines = computed(() => {
  const start = (pagination.page - 1) * pagination.pageSize
  return filteredPipelines.value.slice(start, start + pagination.pageSize)
})
function openPipelineDialog(p?: Pipeline) {
  if (p) Object.assign(pipelineForm, { ...p })
  else Object.assign(pipelineForm, { name: '', code: '', start_point: '', end_point: '', length_km: 0, diameter_mm: 0, install_year: 2012, description: '' })
  pipelineDialogVisible.value = true
}
async function submitPipeline() {
  if (!pipelineForm.name) { ElMessage.warning('请输入管道名称'); return }
  try {
    await pipelinesApi.create(pipelineForm as any)
    ElMessage.success('已创建')
    pipelineDialogVisible.value = false
    await store.loadAll(true)
  } catch (e: any) {
    ElMessage.error('保存失败：' + (e?.message || '未知错误'))
  }
}
async function deletePipeline(p: Pipeline) {
  try { await ElMessageBox.confirm(`确认删除管道「${p.name}」？`, '提示', { type: 'warning' }) } catch { return }
  ElMessage.warning('后端未实现管道删除接口')
}

// ============== 管网设施 ==============
const filteredFacilities = computed(() => {
  let list: any[] = []
  if (facilityTypeFilter.value === 'all' || facilityTypeFilter.value === 'regulator') {
    list = list.concat(network.value.regulators.map((f) => ({ ...f, _type: '调压箱' })))
  }
  if (facilityTypeFilter.value === 'all' || facilityTypeFilter.value === 'inlet') {
    list = list.concat(network.value.inlets.map((f) => ({ ...f, _type: '引入口' })))
  }
  if (facilityTypeFilter.value === 'all' || facilityTypeFilter.value === 'joint') {
    list = list.concat(network.value.joints.map((f) => ({ ...f, _type: '绝缘接头' })))
  }
  if (facilityTypeFilter.value === 'all' || facilityTypeFilter.value === 'topology') {
    list = list.concat(network.value.controls.map((f) => ({ ...f, _type: '物探点' })))
  }
  if (facilityCommunityFilter.value) {
    list = list.filter((f) => f.community === facilityCommunityFilter.value)
  }
  return list
})
const pagedFacilities = computed(() => {
  const start = (pagination.page - 1) * pagination.pageSize
  return filteredFacilities.value.slice(start, start + pagination.pageSize)
})

// ============== 通用 ==============
function exportCurrentTab() {
  // 简化版：导出当前 tab 的可见数据为 CSV
  let data: any[] = []
  let name = ''
  if (activeTab.value === 'units') { data = filteredUnits.value; name = '腐控单元' }
  else if (activeTab.value === 'records') { data = filteredRecords.value; name = '检测记录' }
  else if (activeTab.value === 'pipelines') { data = filteredPipelines.value; name = '管道' }
  else if (activeTab.value === 'facilities') { data = filteredFacilities.value; name = '管网设施' }
  if (!data.length) { ElMessage.warning('当前无数据可导出'); return }
  const headers = Object.keys(data[0]).filter((k) => !k.startsWith('_'))
  const csv = '\uFEFF' + [
    headers.join(','),
    ...data.map((row) => headers.map((h) => {
      const v = row[h]
      if (v === null || v === undefined) return ''
      const s = String(v).replace(/"/g, '""')
      return /[",\n]/.test(s) ? `"${s}"` : s
    }).join(',')),
  ].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success(`已导出 ${data.length} 条`)
}

async function uploadExcel(req: any) {
  try {
    const r = await importApi.excel(req.file)
    ElMessage.success(`导入完成：成功 ${r.imported} 条，失败 ${r.errors.length} 条`)
    if (r.errors.length) console.warn('导入错误：', r.errors)
    await loadAll(true)
  } catch (e: any) {
    ElMessage.error('导入失败：' + (e?.message || '未知错误'))
  }
}
</script>

<template>
  <div class="page-container">
    <!-- 顶部：全局统计 + 标题 -->
    <div class="mg-header">
      <div class="mg-title">
        <span style="font-size:20px;font-weight:600">📋 数据管理</span>
        <el-tag size="small" type="info" effect="plain">CRUD + 导入导出</el-tag>
      </div>
      <div class="mg-actions">
        <el-upload :http-request="uploadExcel" :show-file-list="false" accept=".xlsx,.xls">
          <el-button :icon="Download" type="success" plain>📥 Excel 批量导入</el-button>
        </el-upload>
        <el-button :icon="Refresh" @click="loadAll(true)">刷新数据</el-button>
      </div>
    </div>

    <!-- 全局统计卡片 -->
    <el-row :gutter="16" class="mg-stats">
      <el-col :xs="12" :sm="6">
        <div class="stat-card" style="border-left-color:#409eff">
          <div class="stat-icon">🎯</div>
          <div class="stat-body">
            <div class="stat-value">{{ stats.units.total }}</div>
            <div class="stat-label">腐控单元</div>
            <div class="stat-sub">完成 {{ stats.units.completed }} · 异常 {{ stats.units.exception }}</div>
          </div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="6">
        <div class="stat-card" style="border-left-color:#67c23a">
          <div class="stat-icon">📋</div>
          <div class="stat-body">
            <div class="stat-value">{{ stats.records.total }}</div>
            <div class="stat-label">检测记录</div>
            <div class="stat-sub">通过 {{ stats.records.passed }} · 异常 {{ stats.records.exception }}</div>
          </div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="6">
        <div class="stat-card" style="border-left-color:#e6a23c">
          <div class="stat-icon">🛢️</div>
          <div class="stat-body">
            <div class="stat-value">{{ stats.pipelines.total }}</div>
            <div class="stat-label">管道</div>
            <div class="stat-sub">项目级管道</div>
          </div>
        </div>
      </el-col>
      <el-col :xs="12" :sm="6">
        <div class="stat-card" style="border-left-color:#9c64f0">
          <div class="stat-icon">📍</div>
          <div class="stat-body">
            <div class="stat-value">{{ stats.facilities.total }}</div>
            <div class="stat-label">管网设施</div>
            <div class="stat-sub">调压箱 {{ stats.facilities.regulators }} · 接头 {{ stats.facilities.joints }}</div>
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- Tab 切换 -->
    <el-tabs v-model="activeTab" class="mg-tabs" @tab-change="resetPage">
      <!-- 1. 腐控单元 -->
      <el-tab-pane :label="`🎯 腐控单元 (${stats.units.total})`" name="units">
        <div class="mg-toolbar">
          <el-input v-model="unitSearch" placeholder="搜索单元名称 / 地址" :prefix-icon="Search" clearable style="width:260px" />
          <el-select v-model="unitStatusFilter" placeholder="状态" clearable style="width:140px">
            <el-option v-for="s in STATUS_OPTIONS" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
          <el-button :icon="Plus" type="primary" @click="openUnitDialog()">新增单元</el-button>
          <div class="mg-spacer"></div>
          <el-button :icon="Download" @click="exportCurrentTab">导出当前页</el-button>
        </div>
        <el-table :data="pagedUnits" stripe border>
          <el-table-column prop="id" label="ID" width="70" />
          <el-table-column prop="name" label="单元名称" width="140" fixed />
          <el-table-column label="所属管道" width="180" show-overflow-tooltip>
            <template #default="{ row }">{{ store.pipelines.find((p) => p.id === row.pipeline_id)?.name || '-' }}</template>
          </el-table-column>
          <el-table-column label="里程 (m)" width="160">
            <template #default="{ row }">{{ row.start_mileage }} ~ {{ row.end_mileage }}</template>
          </el-table-column>
          <el-table-column label="经纬度" width="170">
            <template #default="{ row }">
              <span style="font-family:monospace;font-size:11px">{{ row.lng?.toFixed(4) }}, {{ row.lat?.toFixed(4) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="address" label="地址" min-width="160" show-overflow-tooltip />
          <el-table-column label="进度" width="120">
            <template #default="{ row }">
              <el-progress :percentage="Math.round(progressOf(row.id) * 100)" :stroke-width="6" />
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.inspection_status === 'completed' ? 'success' : row.inspection_status === 'exception' ? 'danger' : row.inspection_status === 'in_progress' ? 'warning' : 'info'" size="small">
                {{ row.inspection_status }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="最近检测" width="170">
            <template #default="{ row }">{{ fmt(latestInspection(row.id)) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="160" fixed="right">
            <template #default="{ row }">
              <el-button size="small" :icon="View" link @click="$router.push('/map')">地图</el-button>
              <el-button size="small" :icon="Edit" link type="primary" @click="openUnitDialog(row)">编辑</el-button>
              <el-button size="small" :icon="Delete" link type="danger" @click="deleteUnit(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-pagination
          v-model:current-page="pagination.page"
          :page-size="pagination.pageSize"
          :total="filteredUnits.length"
          layout="total, prev, pager, next, jumper"
          style="margin-top:16px;justify-content:flex-end;display:flex"
        />
      </el-tab-pane>

      <!-- 2. 检测记录 -->
      <el-tab-pane :label="`📋 检测记录 (${stats.records.total})`" name="records">
        <div class="mg-toolbar">
          <el-input v-model="recordSearch" placeholder="搜索检测项/检测员/摘要" :prefix-icon="Search" clearable style="width:260px" />
          <el-select v-model="recordUnitFilter" placeholder="腐控单元" clearable filterable style="width:170px">
            <el-option v-for="unit in store.units" :key="unit.id" :label="unit.name" :value="unit.id" />
          </el-select>
          <el-select v-model="recordItemFilter" placeholder="检测项" clearable style="width:140px">
            <el-option v-for="i in ITEMS" :key="i.code" :label="i.name" :value="i.code" />
          </el-select>
          <el-select v-model="recordStatusFilter" placeholder="状态" clearable style="width:120px">
            <el-option v-for="s in STATUS_OPTIONS.filter((x) => ['passed','exception','pending'].includes(x.value))" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
          <el-button :icon="Plus" type="primary" @click="openRecordDialog('create')">新增记录</el-button>
          <div class="mg-spacer"></div>
          <el-button :icon="Download" @click="exportCurrentTab">导出当前页</el-button>
        </div>
        <el-table :data="pagedRecords" stripe border>
          <el-table-column prop="id" label="ID" width="70" />
          <el-table-column label="单元" width="140">
            <template #default="{ row }">{{ store.unitName(row.unit_id) }}</template>
          </el-table-column>
          <el-table-column prop="item_name" label="检测项" min-width="180" />
          <el-table-column label="状态" width="90">
            <template #default="{ row }"><StatusTag :status="row.status" /></template>
          </el-table-column>
          <el-table-column label="测量值" width="140">
            <template #default="{ row }">
              <span v-if="row.measured_value !== null && row.measured_value !== undefined">
                <b>{{ row.measured_value }}</b> <small style="color:#909399">{{ row.unit }}</small>
              </span>
              <span v-else style="color:#c0c4cc">—</span>
            </template>
          </el-table-column>
          <el-table-column prop="inspector" label="检测员" width="100" />
          <el-table-column label="检测时间" width="160">
            <template #default="{ row }">{{ fmt(row.inspection_date) }}</template>
          </el-table-column>
          <el-table-column label="更新时间" width="160">
            <template #default="{ row }">{{ fmt(row.updated_at) }}</template>
          </el-table-column>
          <el-table-column prop="result_summary" label="摘要" min-width="180" show-overflow-tooltip />
          <el-table-column label="操作" width="132" fixed="right">
            <template #default="{ row }">
              <el-button size="small" :icon="View" link @click="openRecordDialog('view', row)" />
              <el-button size="small" :icon="Edit" link type="primary" @click="openRecordDialog('edit', row)" />
              <el-button size="small" :icon="Delete" link type="danger" @click="deleteRecord(row)" />
            </template>
          </el-table-column>
        </el-table>
        <el-pagination
          v-model:current-page="pagination.page"
          :page-size="pagination.pageSize"
          :total="filteredRecords.length"
          layout="total, prev, pager, next, jumper"
          style="margin-top:16px;justify-content:flex-end;display:flex"
        />
      </el-tab-pane>

      <!-- 3. 管道 -->
      <el-tab-pane :label="`🛢️ 管道 (${stats.pipelines.total})`" name="pipelines">
        <div class="mg-toolbar">
          <el-button :icon="Plus" type="primary" @click="openPipelineDialog()">新增管道</el-button>
          <div class="mg-spacer"></div>
          <el-button :icon="Download" @click="exportCurrentTab">导出当前页</el-button>
        </div>
        <el-table :data="pagedPipelines" stripe border>
          <el-table-column prop="id" label="ID" width="70" />
          <el-table-column prop="name" label="管道名称" min-width="220" fixed />
          <el-table-column prop="code" label="代码" width="160" />
          <el-table-column prop="start_point" label="起点" min-width="160" show-overflow-tooltip />
          <el-table-column prop="end_point" label="终点" min-width="160" show-overflow-tooltip />
          <el-table-column label="长度" width="100">
            <template #default="{ row }">{{ row.length_km }} km</template>
          </el-table-column>
          <el-table-column label="管径" width="100">
            <template #default="{ row }">DN{{ row.diameter_mm }}</template>
          </el-table-column>
          <el-table-column label="建设年份" width="100">
            <template #default="{ row }">{{ row.install_year }}</template>
          </el-table-column>
          <el-table-column prop="description" label="说明" min-width="200" show-overflow-tooltip />
          <el-table-column label="操作" width="120" fixed="right">
            <template #default="{ row }">
              <el-button size="small" :icon="View" link @click="$router.push('/map')">地图</el-button>
              <el-button size="small" :icon="Delete" link type="danger" @click="deletePipeline(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-pagination
          v-model:current-page="pagination.page"
          :page-size="pagination.pageSize"
          :total="filteredPipelines.length"
          layout="total, prev, pager, next, jumper"
          style="margin-top:16px;justify-content:flex-end;display:flex"
        />
      </el-tab-pane>

      <!-- 4. 管网设施（GIS + 物探）-->
      <el-tab-pane :label="`📍 管网设施 (${stats.facilities.total})`" name="facilities">
        <el-alert type="info" :closable="false" show-icon style="margin-bottom:12px">
          管网设施数据来自 <b>GIS 导出（管线/调压箱/引入口/绝缘接头）</b> + <b>物探数据（控制单元/物探点）</b>，存储在 /public/data/ 目录。
        </el-alert>
        <div class="mg-toolbar">
          <el-select v-model="facilityTypeFilter" placeholder="设施类型" style="width:140px">
            <el-option label="全部" value="all" />
            <el-option label="调压箱" value="regulator" />
            <el-option label="引入口" value="inlet" />
            <el-option label="绝缘接头" value="joint" />
            <el-option label="物探点" value="topology" />
          </el-select>
          <el-select v-model="facilityCommunityFilter" placeholder="小区" clearable style="width:140px">
            <el-option v-for="c in network.communities" :key="c" :label="c.replace('南海家园', '')" :value="c" />
          </el-select>
          <div class="mg-spacer"></div>
          <el-button :icon="Download" @click="exportCurrentTab">导出当前页</el-button>
        </div>
        <el-table :data="pagedFacilities" stripe border>
          <el-table-column label="类型" width="100" fixed>
            <template #default="{ row }">
              <el-tag :type="row._type === '调压箱' ? 'warning' : row._type === '引入口' ? 'success' : row._type === '绝缘接头' ? 'info' : ''" size="small">
                {{ row._type }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="fid" label="Fid" width="80" />
          <el-table-column prop="community" label="小区" width="100" />
          <el-table-column prop="name" label="名称" min-width="160" show-overflow-tooltip />
          <el-table-column prop="type" label="特征" width="120" />
          <el-table-column prop="pressured" label="压力" width="160" show-overflow-tooltip />
          <el-table-column prop="ecode" label="ECode" width="100" />
          <el-table-column label="经纬度" width="200">
            <template #default="{ row }">
              <span style="font-family:monospace;font-size:11px">{{ row.lng?.toFixed(6) }}, {{ row.lat?.toFixed(6) }}</span>
            </template>
          </el-table-column>
        </el-table>
        <el-pagination
          v-model:current-page="pagination.page"
          :page-size="pagination.pageSize"
          :total="filteredFacilities.length"
          layout="total, prev, pager, next, jumper"
          style="margin-top:16px;justify-content:flex-end;display:flex"
        />
      </el-tab-pane>
    </el-tabs>

    <!-- 腐控单元 Dialog -->
    <el-dialog v-model="unitDialogVisible" :title="editingUnit ? '编辑腐控单元' : '新增腐控单元'" width="560px">
      <el-form :model="unitForm" label-width="100px">
        <el-form-item label="单元名称" required><el-input v-model="unitForm.name" /></el-form-item>
        <el-form-item label="所属管道">
          <el-select v-model="unitForm.pipeline_id" style="width:100%">
            <el-option v-for="p in store.pipelines" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="起点里程 (m)"><el-input-number v-model="unitForm.start_mileage" :precision="2" :step="100" style="width:100%" /></el-form-item>
        <el-form-item label="终点里程 (m)"><el-input-number v-model="unitForm.end_mileage" :precision="2" :step="100" style="width:100%" /></el-form-item>
        <el-form-item label="经度"><el-input-number v-model="unitForm.lng" :precision="6" style="width:100%" /></el-form-item>
        <el-form-item label="纬度"><el-input-number v-model="unitForm.lat" :precision="6" style="width:100%" /></el-form-item>
        <el-form-item label="地址"><el-input v-model="unitForm.address" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="unitDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitUnit">保存</el-button>
      </template>
    </el-dialog>

    <RecordFormDialog
      v-model:visible="recordDialogVisible"
      :mode="recordDialogMode"
      :record="activeRecord"
      @saved="handleRecordSaved"
    />

    <!-- 管道 Dialog -->
    <el-dialog v-model="pipelineDialogVisible" title="新增管道" width="560px">
      <el-form :model="pipelineForm" label-width="100px">
        <el-form-item label="管道名称" required><el-input v-model="pipelineForm.name" /></el-form-item>
        <el-form-item label="代码"><el-input v-model="pipelineForm.code" /></el-form-item>
        <el-form-item label="起点"><el-input v-model="pipelineForm.start_point" /></el-form-item>
        <el-form-item label="终点"><el-input v-model="pipelineForm.end_point" /></el-form-item>
        <el-form-item label="长度 (km)"><el-input-number v-model="pipelineForm.length_km" :precision="2" :step="0.1" style="width:100%" /></el-form-item>
        <el-form-item label="管径 (mm)"><el-input-number v-model="pipelineForm.diameter_mm" :precision="0" :step="10" style="width:100%" /></el-form-item>
        <el-form-item label="建设年份"><el-input-number v-model="pipelineForm.install_year" :min="1900" :max="2100" style="width:100%" /></el-form-item>
        <el-form-item label="说明"><el-input v-model="pipelineForm.description" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pipelineDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitPipeline">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-container { padding: 16px 24px 32px; }

.mg-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 16px; background: #fff; padding: 16px 20px;
  border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.04);
  flex-wrap: wrap; gap: 12px;
}
.mg-title { display: flex; align-items: center; gap: 12px; }
.mg-actions { display: flex; align-items: center; gap: 8px; }

.mg-stats { margin-bottom: 16px; }
.stat-card {
  display: flex; align-items: center; gap: 14px;
  background: #fff; border-radius: 8px; padding: 18px 20px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04); border-left: 4px solid;
  margin-bottom: 12px;
}
.stat-icon { font-size: 30px; }
.stat-body { flex: 1; min-width: 0; }
.stat-value { font-size: 26px; font-weight: 700; color: #303133; line-height: 1.1; }
.stat-label { font-size: 13px; color: #606266; margin-top: 4px; }
.stat-sub { font-size: 11px; color: #909399; margin-top: 2px; }

.mg-tabs {
  background: #fff; border-radius: 8px;
  padding: 4px 20px 20px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
}
:deep(.el-tabs__item) { font-size: 14px; height: 44px; line-height: 44px; }
:deep(.el-tabs__content) { padding-top: 8px; }

.mg-toolbar {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 12px; padding: 12px;
  background: #fafbfc; border-radius: 6px; flex-wrap: wrap;
}
.mg-spacer { flex: 1; }
</style>
