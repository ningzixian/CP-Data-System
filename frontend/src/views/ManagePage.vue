<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { UploadRequestOptions } from 'element-plus'
import { useCpStore } from '@/stores/cp'
import { unitsApi } from '@/api/units'
import { recordsApi } from '@/api/records'
import { importApi } from '@/api/import'
import RecordFormDialog from '@/components/RecordFormDialog.vue'
import StatusTag from '@/components/StatusTag.vue'
import { INSPECTION_ITEMS } from '@/types/items'
import { communitiesFromUnits, communityOfUnit, downloadCSV, toCSV } from '@/utils/community'
import type { CorrosionUnitInput, InspectionItemCode, InspectionRecord, RecordStatus } from '@/types/models'

type RecordDialogMode = 'create' | 'edit' | 'view'

const store = useCpStore()
const route = useRoute()
const createUnitVisible = ref(false)
const recordDialogVisible = ref(false)
const recordDialogMode = ref<RecordDialogMode>('create')
const activeRecord = ref<InspectionRecord | null>(null)
const selectedCommunity = ref('')
const selectedUnitId = ref<number | null>(null)
const selectedItemCode = ref<InspectionItemCode | ''>('')
const selectedStatus = ref<RecordStatus | ''>('')
const keyword = ref('')
const currentPage = ref(1)
const pageSize = ref(20)

const newUnit = reactive<CorrosionUnitInput>({
  pipeline_id: 1,
  name: '',
  start_mileage: 0,
  end_mileage: 0,
  lng: 118.85,
  lat: 31.95,
  address: '',
})

const communityGroups = computed(() => communitiesFromUnits(store.units).filter((group) => group.units.length))
const unitOptions = computed(() => selectedCommunity.value
  ? communityGroups.value.find((group) => group.name === selectedCommunity.value)?.units ?? []
  : store.units)

const filteredRecords = computed(() => {
  const query = keyword.value.trim().toLocaleLowerCase('zh-CN')
  return [...store.records]
    .filter((record) => {
      const unit = store.units.find((item) => item.id === record.unit_id)
      if (selectedCommunity.value && communityOfUnit(unit) !== selectedCommunity.value) return false
      if (selectedUnitId.value !== null && record.unit_id !== selectedUnitId.value) return false
      if (selectedItemCode.value && record.item_code !== selectedItemCode.value) return false
      if (selectedStatus.value && record.status !== selectedStatus.value) return false
      if (!query) return true
      return [record.item_name, unit?.name, record.inspector, record.result_summary, record.note]
        .some((value) => String(value ?? '').toLocaleLowerCase('zh-CN').includes(query))
    })
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
})

const pagedRecords = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredRecords.value.slice(start, start + pageSize.value)
})

watch([selectedCommunity, selectedUnitId, selectedItemCode, selectedStatus, keyword], () => { currentPage.value = 1 })
watch(selectedCommunity, () => {
  if (selectedUnitId.value !== null && !unitOptions.value.some((unit) => unit.id === selectedUnitId.value)) selectedUnitId.value = null
})
watch(
  () => [route.query.unit_id, route.query.item_code] as const,
  ([unitId, itemCode]) => {
    const parsedUnitId = Number(Array.isArray(unitId) ? unitId[0] : unitId)
    selectedUnitId.value = Number.isFinite(parsedUnitId) && parsedUnitId > 0 ? parsedUnitId : null
    const code = Array.isArray(itemCode) ? itemCode[0] : itemCode
    selectedItemCode.value = INSPECTION_ITEMS.some((item) => item.code === code) ? code as InspectionItemCode : ''
  },
  { immediate: true },
)

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—'
}

function openRecordDialog(mode: RecordDialogMode, record: InspectionRecord | null = null) {
  activeRecord.value = record
  recordDialogMode.value = mode
  recordDialogVisible.value = true
}

async function submitNewUnit() {
  if (!newUnit.name.trim()) return void ElMessage.warning('请输入单元名称')
  await unitsApi.create(newUnit)
  ElMessage.success('腐控单元已创建')
  createUnitVisible.value = false
  Object.assign(newUnit, { name: '', start_mileage: 0, end_mileage: 0, address: '' })
  await store.loadAll()
}

async function deleteRecord(record: InspectionRecord) {
  try {
    await ElMessageBox.confirm(`确认删除“${record.item_name || record.item_code}”记录？此操作不可撤销。`, '删除检测记录', { type: 'warning' })
  } catch {
    return
  }
  await recordsApi.remove(record.id)
  await store.refreshRecords()
  ElMessage.success('检测记录已删除')
}

async function uploadExcel(request: UploadRequestOptions) {
  try {
    const result = await importApi.excel(request.file)
    ElMessage.success(`导入完成：成功 ${result.imported} 条，失败 ${result.errors.length} 条`)
    if (result.errors.length) console.warn('导入错误：', result.errors)
    await store.loadAll()
  } catch (error) {
    ElMessage.error(`导入失败：${error instanceof Error ? error.message : '未知错误'}`)
  }
}

function exportRecords() {
  const rows = filteredRecords.value.map((record) => {
    const unit = store.units.find((item) => item.id === record.unit_id)
    return [record.id, communityOfUnit(unit), unit?.name ?? `#${record.unit_id}`, record.item_name ?? record.item_code, record.status, record.measured_value, record.unit, record.inspector, record.inspection_date, record.result_summary, record.note]
  })
  downloadCSV(`检测记录-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(
    ['ID', '所属小区', '所属单元', '检测项', '状态', '测量值', '单位', '检测人员', '检测时间', '结果摘要', '备注'],
    rows,
  ))
  ElMessage.success(`已导出 ${rows.length} 条检测记录`)
}

function clearFilters() {
  selectedCommunity.value = ''
  selectedUnitId.value = null
  selectedItemCode.value = ''
  selectedStatus.value = ''
  keyword.value = ''
}
</script>

<template>
  <div class="page-container manage-page">
    <el-card shadow="never">
      <template #header>
        <div class="manage-header">
          <div><b>检测记录管理</b><span>共 {{ store.records.length }} 条，当前筛选 {{ filteredRecords.length }} 条</span></div>
          <div class="manage-actions">
            <el-button type="primary" @click="openRecordDialog('create')">＋ 新增检测记录</el-button>
            <el-upload :http-request="uploadExcel" :show-file-list="false" accept=".xlsx,.xls"><el-button type="primary" plain>Excel 批量导入</el-button></el-upload>
            <el-button @click="exportRecords">导出筛选结果</el-button>
            <el-button type="success" plain @click="createUnitVisible = true">＋ 新增腐控单元</el-button>
            <el-button @click="store.loadAll()">刷新</el-button>
          </div>
        </div>
      </template>

      <div class="manage-filters">
        <el-select v-model="selectedCommunity" clearable placeholder="全部小区"><el-option v-for="group in communityGroups" :key="group.name" :label="`${group.name}（${group.units.length}）`" :value="group.name" /></el-select>
        <el-select v-model="selectedUnitId" clearable filterable placeholder="全部单元"><el-option v-for="unit in unitOptions" :key="unit.id" :label="unit.name" :value="unit.id" /></el-select>
        <el-select v-model="selectedItemCode" clearable placeholder="全部检测项"><el-option v-for="item in store.items" :key="item.code" :label="item.name" :value="item.code" /></el-select>
        <el-select v-model="selectedStatus" clearable placeholder="全部状态"><el-option label="待开始" value="pending" /><el-option label="合格" value="passed" /><el-option label="异常" value="exception" /></el-select>
        <el-input v-model="keyword" clearable placeholder="搜索单元、人员、摘要或备注" />
        <el-button @click="clearFilters">重置</el-button>
      </div>

      <el-table :data="pagedRecords" stripe border @row-dblclick="openRecordDialog('view', $event)">
        <el-table-column prop="id" label="ID" width="72" />
        <el-table-column label="所属小区" width="130"><template #default="{ row }">{{ communityOfUnit(store.units.find((unit) => unit.id === row.unit_id)) }}</template></el-table-column>
        <el-table-column label="所属单元" width="150"><template #default="{ row }">{{ store.unitName(row.unit_id) }}</template></el-table-column>
        <el-table-column prop="item_name" label="检测项" min-width="210" show-overflow-tooltip />
        <el-table-column label="状态" width="92"><template #default="{ row }"><StatusTag :status="row.status" /></template></el-table-column>
        <el-table-column label="测量值" width="130"><template #default="{ row }"><span v-if="row.measured_value !== null && row.measured_value !== undefined">{{ row.measured_value }} <small>{{ row.unit }}</small></span><span v-else class="manage-empty">—</span></template></el-table-column>
        <el-table-column prop="inspector" label="检测人员" width="110" />
        <el-table-column label="检测时间" width="170"><template #default="{ row }">{{ formatDate(row.inspection_date) }}</template></el-table-column>
        <el-table-column prop="result_summary" label="摘要" min-width="190" show-overflow-tooltip />
        <el-table-column label="操作" width="178" fixed="right">
          <template #default="{ row }"><el-button size="small" link @click="openRecordDialog('view', row)">查看</el-button><el-button size="small" type="primary" link @click="openRecordDialog('edit', row)">编辑</el-button><el-button size="small" type="danger" link @click="deleteRecord(row)">删除</el-button></template>
        </el-table-column>
      </el-table>

      <div class="manage-pagination"><el-pagination v-model:current-page="currentPage" v-model:page-size="pageSize" :page-sizes="[10,20,50,100]" layout="total, sizes, prev, pager, next" :total="filteredRecords.length" /></div>
    </el-card>

    <RecordFormDialog v-model:visible="recordDialogVisible" :mode="recordDialogMode" :record="activeRecord" />

    <el-dialog v-model="createUnitVisible" title="新增腐控单元" width="500px" append-to-body>
      <el-form :model="newUnit" label-width="100px">
        <el-form-item label="单元名称" required><el-input v-model="newUnit.name" placeholder="如 FSKZ755856" /></el-form-item>
        <el-form-item label="所属管道"><el-select v-model="newUnit.pipeline_id" style="width:100%"><el-option v-for="pipeline in store.pipelines" :key="pipeline.id" :label="pipeline.name" :value="pipeline.id" /></el-select></el-form-item>
        <el-form-item label="起点里程"><el-input-number v-model="newUnit.start_mileage" :precision="2" :step="100" style="width:100%" /></el-form-item>
        <el-form-item label="终点里程"><el-input-number v-model="newUnit.end_mileage" :precision="2" :step="100" style="width:100%" /></el-form-item>
        <el-form-item label="经度"><el-input-number v-model="newUnit.lng" :precision="6" style="width:100%" /></el-form-item>
        <el-form-item label="纬度"><el-input-number v-model="newUnit.lat" :precision="6" style="width:100%" /></el-form-item>
        <el-form-item label="地址"><el-input v-model="newUnit.address" placeholder="小区名称 · 具体位置" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="createUnitVisible = false">取消</el-button><el-button type="primary" @click="submitNewUnit">创建</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.manage-header,.manage-actions,.manage-filters,.manage-pagination { display:flex; align-items:center; }
.manage-header { justify-content:space-between; gap:20px; }
.manage-header > div:first-child { display:flex; flex-direction:column; gap:4px; }
.manage-header b { font-size:16px; }
.manage-header span { color:var(--app-text-muted); font-size:12px; }
.manage-actions { flex-wrap:wrap; justify-content:flex-end; gap:8px; }
.manage-actions :deep(.el-button + .el-button) { margin-left:0; }
.manage-filters { margin-bottom:16px; display:grid; grid-template-columns:160px 170px 210px 130px minmax(220px,1fr) auto; gap:10px; }
.manage-pagination { justify-content:flex-end; padding-top:16px; }
.manage-empty { color:var(--app-text-muted); }
small { color:var(--app-text-muted); }
@media (max-width:1200px) { .manage-header { align-items:flex-start; flex-direction:column; }.manage-filters { grid-template-columns:repeat(3,minmax(0,1fr)); } }
</style>
