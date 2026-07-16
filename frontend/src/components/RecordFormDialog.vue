<script setup lang="ts">
/**
 * 检测记录表单弹窗（统一新增/编辑/查看）
 *  - 模式由 props.mode 控制：'create' | 'edit' | 'view'
 *  - 单元 + 检测项 在 create 模式下可改，view/edit 模式下只读
 *  - 复用 INSPECTION_ITEMS 的字段定义（result_data 自动渲染对应输入）
 */
import { ref, reactive, watch, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { recordsApi } from '@/api/records'
import { useCpStore } from '@/stores/cp'
import { INSPECTION_ITEMS, STATUS_LABELS } from '@/types/items'
import type { InspectionItemCode, InspectionRecord, InspectionRecordInput } from '@/types/models'
import { communityOfUnit } from '@/utils/community'

const props = defineProps<{
  visible: boolean
  mode: 'create' | 'edit' | 'view'
  record?: InspectionRecord | null  // 编辑/查看时传入
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'saved'): void
}>()

const store = useCpStore()

const form = reactive<{
  unit_id: number | null
  item_code: InspectionItemCode | ''
  inspector: string
  work_hours: number | null
  personnel_count: number | null
  personnel_level: '初级' | '中级' | '高级' | '专家'
  inspection_date: string
  status: 'pending' | 'passed' | 'exception'
  result_summary: string
  measured_value: number | null
  unit: string
  bd_coord: string
  note: string
  result_data: Record<string, unknown>
}>({
  unit_id: null,
  item_code: '',
  inspector: '',
  work_hours: null,
  personnel_count: 2,
  personnel_level: '中级',
  inspection_date: new Date().toISOString().slice(0, 19),
  status: 'pending',
  result_summary: '',
  measured_value: null,
  unit: '',
  bd_coord: '',
  note: '',
  result_data: {},
})

const recordId = ref<number | null>(null)
const saving = ref(false)
const loading = ref(false)

const isReadOnly = computed(() => props.mode === 'view')

const itemDef = computed(() => INSPECTION_ITEMS.find((i) => i.code === form.item_code))

// 单元按小区分组
const communityGroups = computed(() => {
  const groups = new Map<string, typeof store.units>()
  for (const u of store.units) {
    const c = communityOfUnit(u)
    let arr = groups.get(c)
    if (!arr) {
      arr = []
      groups.set(c, arr)
    }
    arr.push(u)
  }
  return Array.from(groups.entries())
    .map(([name, units]) => ({ name, units }))
    .sort((a, b) => a.name.localeCompare(b.name))
})

const unitIdString = computed({
  get: () => form.unit_id === null ? '' : String(form.unit_id),
  set: (v: string) => { form.unit_id = v ? Number(v) : null },
})

function reset() {
  form.unit_id = null
  form.item_code = ''
  form.inspector = ''
  form.work_hours = null
  form.personnel_count = 2
  form.personnel_level = '中级'
  form.inspection_date = new Date().toISOString().slice(0, 19)
  form.status = 'pending'
  form.result_summary = ''
  form.measured_value = null
  form.unit = ''
  form.bd_coord = ''
  form.note = ''
  form.result_data = {}
  recordId.value = null
}

function loadFromRecord() {
  const r = props.record
  if (!r) {
    reset()
    return
  }
  form.unit_id = r.unit_id
  form.item_code = r.item_code
  form.inspector = r.inspector || ''
  form.work_hours = r.work_hours ?? null
  form.personnel_count = r.personnel_count ?? 2
  form.personnel_level = (r.personnel_level as any) || '中级'
  form.inspection_date = r.inspection_date
    ? r.inspection_date.slice(0, 19)
    : new Date().toISOString().slice(0, 19)
  form.status = r.status
  form.result_summary = r.result_summary || ''
  form.measured_value = r.measured_value ?? null
  form.unit = r.unit || ''
  form.bd_coord = r.bd_coord || ''
  form.note = r.note || ''
  form.result_data = { ...(r.result_data || {}) }
  recordId.value = r.id
}

watch(
  () => [props.visible, props.record?.id, props.mode],
  ([v]) => {
    if (!v) return
    if (props.mode === 'create') reset()
    else loadFromRecord()
  },
  { immediate: true },
)

onMounted(() => {
  if (props.mode !== 'create' && props.record) loadFromRecord()
})

async function save() {
  if (saving.value) return
  if (form.unit_id === null) {
    ElMessage.warning('请选择单元')
    return
  }
  if (!form.item_code) {
    ElMessage.warning('请选择检测项')
    return
  }
  saving.value = true
  try {
    const payload: InspectionRecordInput = {
      unit_id: form.unit_id,
      item_code: form.item_code as InspectionItemCode,
      inspector: form.inspector || undefined,
      work_hours: form.work_hours ?? undefined,
      personnel_count: form.personnel_count ?? undefined,
      personnel_level: form.personnel_level,
      inspection_date: form.inspection_date,
      status: form.status,
      result_summary: form.result_summary || undefined,
      measured_value: form.measured_value ?? undefined,
      unit: form.unit || undefined,
      bd_coord: form.bd_coord || undefined,
      note: form.note || undefined,
      result_data: form.result_data,
    }
    if (recordId.value) {
      await recordsApi.update(recordId.value, payload)
    } else {
      await recordsApi.create(payload)
    }
    ElMessage.success('保存成功')
    await store.refreshRecords()
    emit('saved')
    close()
  } catch (e: unknown) {
    ElMessage.error('保存失败：' + (e instanceof Error ? e.message : '未知错误'))
  } finally {
    saving.value = false
  }
}

function close() {
  emit('update:visible', false)
}

function statusType(s: string) {
  return s === 'passed' || s === 'completed' ? 'success'
    : s === 'exception' ? 'danger'
    : s === 'in_progress' ? 'warning'
    : 'info'
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="mode === 'create' ? '新增检测记录' : mode === 'edit' ? '编辑检测记录' : '查看检测记录'"
    width="780px"
    :close-on-click-modal="false"
    @update:model-value="(v: boolean) => emit('update:visible', v)"
    @closed="reset"
  >
    <el-form label-width="110px" v-loading="loading">
      <el-row :gutter="20">
        <el-col :span="12">
          <el-form-item label="所属小区">
            <el-select
              :model-value="form.unit_id !== null ? communityOfUnit(store.units.find((u) => u.id === form.unit_id) || null) : ''"
              placeholder="（随单元联动）"
              disabled
              style="width:100%"
            >
              <el-option
                v-for="g in communityGroups"
                :key="g.name"
                :label="g.name"
                :value="g.name"
              />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="所属单元" required>
            <el-select
              v-model="unitIdString"
              placeholder="选择单元"
              :disabled="isReadOnly"
              filterable
              style="width:100%"
            >
              <el-option-group
                v-for="g in communityGroups"
                :key="g.name"
                :label="g.name"
              >
                <el-option
                  v-for="u in g.units"
                  :key="u.id"
                  :label="u.name"
                  :value="String(u.id)"
                />
              </el-option-group>
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="检测项" required>
            <el-select
              v-model="form.item_code"
              placeholder="选择检测项"
              :disabled="isReadOnly"
              style="width:100%"
            >
              <el-option
                v-for="it in INSPECTION_ITEMS"
                :key="it.code"
                :label="it.name"
                :value="it.code"
              />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="检测员">
            <el-input v-model="form.inspector" :readonly="isReadOnly" placeholder="现场检测人员姓名" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="工日">
            <el-input-number
              v-model="form.work_hours"
              :precision="2" :step="0.05" :min="0"
              :readonly="isReadOnly"
              style="width:100%"
            />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="人员数量">
            <el-input-number
              v-model="form.personnel_count"
              :min="0"
              :readonly="isReadOnly"
              style="width:100%"
            />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="人员等级">
            <el-select
              v-model="form.personnel_level"
              :disabled="isReadOnly"
              style="width:100%"
            >
              <el-option label="初级" value="初级" />
              <el-option label="中级" value="中级" />
              <el-option label="高级" value="高级" />
              <el-option label="专家" value="专家" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="检测时间">
            <el-date-picker
              v-model="form.inspection_date"
              type="datetime"
              :readonly="isReadOnly"
              style="width:100%"
              format="YYYY-MM-DD HH:mm"
              value-format="YYYY-MM-DDTHH:mm:ss"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="状态">
            <el-radio-group v-model="form.status" :disabled="isReadOnly">
              <el-radio-button value="pending">待开始</el-radio-button>
              <el-radio-button value="passed">合格</el-radio-button>
              <el-radio-button value="exception">异常</el-radio-button>
            </el-radio-group>
          </el-form-item>
        </el-col>
      </el-row>

      <template v-if="itemDef">
        <el-divider>检测结果数据（{{ itemDef.name }}）</el-divider>
        <el-row :gutter="20">
          <el-col v-for="f in itemDef.fields" :key="f.key" :span="12">
            <el-form-item :label="f.label">
              <el-input
                v-model="form.result_data[f.key]"
                :readonly="isReadOnly"
                :placeholder="`输入 ${f.label}`"
              />
            </el-form-item>
          </el-col>
        </el-row>
      </template>

      <el-row :gutter="20">
        <el-col :span="12">
          <el-form-item label="主测量值">
            <el-input-number
              v-model="form.measured_value"
              :precision="4"
              :readonly="isReadOnly"
              style="width:60%"
            />
            <el-input
              v-model="form.unit"
              :readonly="isReadOnly"
              placeholder="单位"
              style="width:35%;margin-left:5%"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="北斗坐标">
            <el-input
              v-model="form.bd_coord"
              :readonly="isReadOnly"
              placeholder="如 E118.8400 N31.9520"
            />
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item label="结果摘要">
        <el-input
          v-model="form.result_summary"
          type="textarea"
          :rows="2"
          :readonly="isReadOnly"
        />
      </el-form-item>

      <el-form-item label="备注">
        <el-input
          v-model="form.note"
          type="textarea"
          :rows="2"
          :readonly="isReadOnly"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="close">{{ isReadOnly ? '关闭' : '取消' }}</el-button>
      <el-button
        v-if="!isReadOnly"
        type="primary"
        :loading="saving"
        @click="save"
      >保存</el-button>
    </template>
  </el-dialog>
</template>
