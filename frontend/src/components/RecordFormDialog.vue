<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { recordsApi } from '@/api/records'
import { useCpStore } from '@/stores/cp'
import { INSPECTION_ITEMS } from '@/types/items'
import { communitiesFromUnits, communityOfUnit } from '@/utils/community'
import type { InspectionItemCode, InspectionRecord, InspectionRecordInput, RecordStatus } from '@/types/models'

type DialogMode = 'create' | 'edit' | 'view'

const props = defineProps<{
  visible: boolean
  mode: DialogMode
  record?: InspectionRecord | null
}>()

const emit = defineEmits<{
  (event: 'update:visible', visible: boolean): void
  (event: 'saved'): void
}>()

const store = useCpStore()
const saving = ref(false)
const recordId = ref<number | null>(null)
const resultFieldValues = reactive<Record<string, string>>({})
const resultFieldKinds = new Map<string, 'number' | 'boolean' | 'json' | 'string'>()

const form = reactive({
  unit_id: null as number | null,
  item_code: '' as InspectionItemCode | '',
  inspector: '',
  work_hours: null as number | null,
  personnel_count: 2 as number | null,
  personnel_level: '中级' as '初级' | '中级' | '高级' | '专家',
  inspection_date: '',
  status: 'pending' as RecordStatus,
  result_summary: '',
  measured_value: null as number | null,
  unit: '',
  bd_coord: '',
  note: '',
  result_data: {} as Record<string, unknown>,
})

const isReadOnly = computed(() => props.mode === 'view')
const identityReadOnly = computed(() => props.mode !== 'create')
const itemDefinition = computed(() => INSPECTION_ITEMS.find((item) => item.code === form.item_code))
const communityGroups = computed(() => communitiesFromUnits(store.units).filter((group) => group.units.length))
const selectedCommunity = computed(() => communityOfUnit(store.units.find((unit) => unit.id === form.unit_id)))
const dialogTitle = computed(() => props.mode === 'create' ? '新增检测记录' : props.mode === 'edit' ? '编辑检测记录' : '查看检测记录')

const unitIdModel = computed({
  get: () => form.unit_id === null ? '' : String(form.unit_id),
  set: (value: string) => { form.unit_id = value ? Number(value) : null },
})

function nowText(): string {
  const date = new Date()
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 19)
}

function clearResultFields() {
  Object.keys(resultFieldValues).forEach((key) => delete resultFieldValues[key])
  resultFieldKinds.clear()
}

function valueKind(value: unknown): 'number' | 'boolean' | 'json' | 'string' {
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (value !== null && typeof value === 'object') return 'json'
  return 'string'
}

function syncResultFields() {
  clearResultFields()
  itemDefinition.value?.fields.forEach((field) => {
    const value = form.result_data[field.key]
    const kind = valueKind(value)
    resultFieldKinds.set(field.key, kind)
    resultFieldValues[field.key] = kind === 'json'
      ? JSON.stringify(value, null, 2)
      : value === null || value === undefined ? '' : String(value)
  })
}

function reset() {
  recordId.value = null
  form.unit_id = null
  form.item_code = ''
  form.inspector = ''
  form.work_hours = null
  form.personnel_count = 2
  form.personnel_level = '中级'
  form.inspection_date = nowText()
  form.status = 'pending'
  form.result_summary = ''
  form.measured_value = null
  form.unit = ''
  form.bd_coord = ''
  form.note = ''
  form.result_data = {}
  clearResultFields()
}

function loadRecord(record: InspectionRecord) {
  recordId.value = record.id
  form.unit_id = record.unit_id
  form.item_code = record.item_code
  form.inspector = record.inspector ?? ''
  form.work_hours = record.work_hours ?? null
  form.personnel_count = record.personnel_count ?? 2
  form.personnel_level = record.personnel_level ?? '中级'
  form.inspection_date = record.inspection_date?.slice(0, 19) ?? nowText()
  form.status = record.status
  form.result_summary = record.result_summary ?? ''
  form.measured_value = record.measured_value ?? null
  form.unit = record.unit ?? ''
  form.bd_coord = record.bd_coord ?? ''
  form.note = record.note ?? ''
  form.result_data = { ...(record.result_data ?? {}) }
  syncResultFields()
}

watch(
  () => [props.visible, props.mode, props.record?.id] as const,
  ([visible]) => {
    if (!visible) return
    if (props.mode === 'create' || !props.record) reset()
    else loadRecord(props.record)
  },
  { immediate: true },
)

watch(() => form.item_code, () => {
  if (!props.visible || identityReadOnly.value) return
  form.result_data = {}
  syncResultFields()
})

function parsedResultData(): Record<string, unknown> {
  const result = { ...form.result_data }
  itemDefinition.value?.fields.forEach((field) => {
    const raw = resultFieldValues[field.key]?.trim() ?? ''
    const kind = resultFieldKinds.get(field.key) ?? 'string'
    if (!raw) {
      result[field.key] = ''
      return
    }
    if (kind === 'json') {
      try {
        result[field.key] = JSON.parse(raw)
      } catch {
        throw new Error(`“${field.label}”不是有效的 JSON`)
      }
      return
    }
    if (kind === 'number' || /^-?\d+(\.\d+)?$/.test(raw)) {
      result[field.key] = Number(raw)
      return
    }
    if (kind === 'boolean') {
      result[field.key] = raw === 'true'
      return
    }
    result[field.key] = raw
  })
  return result
}

async function save() {
  if (saving.value) return
  if (form.unit_id === null) return void ElMessage.warning('请选择所属单元')
  if (!form.item_code) return void ElMessage.warning('请选择检测项')
  saving.value = true
  try {
    const payload: InspectionRecordInput = {
      unit_id: form.unit_id,
      item_code: form.item_code,
      inspector: form.inspector || undefined,
      work_hours: form.work_hours ?? undefined,
      personnel_count: form.personnel_count ?? undefined,
      personnel_level: form.personnel_level,
      inspection_date: form.inspection_date || undefined,
      status: form.status,
      result_summary: form.result_summary || undefined,
      result_data: parsedResultData(),
      measured_value: form.measured_value ?? undefined,
      unit: form.unit || undefined,
      bd_coord: form.bd_coord || undefined,
      note: form.note || undefined,
    }
    if (recordId.value !== null) await recordsApi.update(recordId.value, payload)
    else await recordsApi.create(payload)
    await store.refreshRecords()
    ElMessage.success(recordId.value === null ? '检测记录已新增' : '检测记录已更新')
    emit('saved')
    close()
  } catch (error) {
    ElMessage.error(`保存失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    saving.value = false
  }
}

function close() {
  emit('update:visible', false)
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="dialogTitle"
    width="780px"
    append-to-body
    destroy-on-close
    :close-on-click-modal="false"
    @update:model-value="emit('update:visible', $event)"
  >
    <el-form label-width="104px" class="record-dialog-form">
      <el-row :gutter="18">
        <el-col :span="12"><el-form-item label="所属小区"><el-input :model-value="selectedCommunity" readonly /></el-form-item></el-col>
        <el-col :span="12">
          <el-form-item label="所属单元" required>
            <el-select v-model="unitIdModel" filterable :disabled="identityReadOnly" placeholder="请选择单元" style="width:100%">
              <el-option-group v-for="group in communityGroups" :key="group.name" :label="group.name">
                <el-option v-for="unitItem in group.units" :key="unitItem.id" :label="unitItem.name" :value="String(unitItem.id)" />
              </el-option-group>
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="检测项" required>
            <el-select v-model="form.item_code" :disabled="identityReadOnly" placeholder="请选择检测项" style="width:100%">
              <el-option v-for="item in INSPECTION_ITEMS" :key="item.code" :label="item.name" :value="item.code" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12"><el-form-item label="检测人员"><el-input v-model="form.inspector" :readonly="isReadOnly" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="工日"><el-input-number v-model="form.work_hours" :min="0" :precision="2" :step="0.05" :disabled="isReadOnly" style="width:100%" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="人员数量"><el-input-number v-model="form.personnel_count" :min="0" :disabled="isReadOnly" style="width:100%" /></el-form-item></el-col>
        <el-col :span="8">
          <el-form-item label="人员等级"><el-select v-model="form.personnel_level" :disabled="isReadOnly" style="width:100%"><el-option label="初级" value="初级" /><el-option label="中级" value="中级" /><el-option label="高级" value="高级" /><el-option label="专家" value="专家" /></el-select></el-form-item>
        </el-col>
        <el-col :span="12"><el-form-item label="检测时间"><el-date-picker v-model="form.inspection_date" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" format="YYYY-MM-DD HH:mm" :disabled="isReadOnly" style="width:100%" /></el-form-item></el-col>
        <el-col :span="12"><el-form-item label="状态"><el-radio-group v-model="form.status" :disabled="isReadOnly"><el-radio-button value="pending">待开始</el-radio-button><el-radio-button value="passed">合格</el-radio-button><el-radio-button value="exception">异常</el-radio-button></el-radio-group></el-form-item></el-col>
      </el-row>

      <template v-if="itemDefinition">
        <el-divider>{{ itemDefinition.name }}结果数据</el-divider>
        <el-row :gutter="18">
          <el-col v-for="field in itemDefinition.fields" :key="field.key" :span="resultFieldKinds.get(field.key) === 'json' ? 24 : 12">
            <el-form-item :label="field.label">
              <el-input v-model="resultFieldValues[field.key]" :type="resultFieldKinds.get(field.key) === 'json' ? 'textarea' : 'text'" :rows="resultFieldKinds.get(field.key) === 'json' ? 4 : undefined" :readonly="isReadOnly" />
            </el-form-item>
          </el-col>
        </el-row>
      </template>

      <el-row :gutter="18">
        <el-col :span="12"><el-form-item label="主测量值"><div class="record-measurement"><el-input-number v-model="form.measured_value" :precision="4" :controls="false" :disabled="isReadOnly" /><el-input v-model="form.unit" :readonly="isReadOnly" placeholder="单位" /></div></el-form-item></el-col>
        <el-col :span="12"><el-form-item label="北斗坐标"><el-input v-model="form.bd_coord" :readonly="isReadOnly" /></el-form-item></el-col>
      </el-row>
      <el-form-item label="结果摘要"><el-input v-model="form.result_summary" type="textarea" :rows="2" :readonly="isReadOnly" /></el-form-item>
      <el-form-item label="备注"><el-input v-model="form.note" type="textarea" :rows="2" :readonly="isReadOnly" /></el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="close">{{ isReadOnly ? '关闭' : '取消' }}</el-button>
      <el-button v-if="!isReadOnly" type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.record-measurement { width:100%; display:grid; grid-template-columns:minmax(0,1fr) 90px; gap:8px; }
.record-measurement :deep(.el-input-number) { width:100%; }
.record-dialog-form :deep(.el-divider__text) { color:var(--app-text-secondary); background:var(--app-surface-raised); }
</style>
