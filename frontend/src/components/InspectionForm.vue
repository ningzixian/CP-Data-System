<script setup lang="ts">
import { ref, reactive, watch, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { recordsApi } from '@/api/records'
import { useCpStore } from '@/stores/cp'
import type { InspectionItemDef, InspectionItemCode, InspectionRecordInput } from '@/types/models'

const props = defineProps<{
  unitId: number
  item: InspectionItemDef
}>()

const emit = defineEmits<{ (e: 'saved'): void }>()

const store = useCpStore()
type InspectionFormState = Omit<
  InspectionRecordInput,
  'unit_id' | 'item_code' | 'point_id' | 'work_hours' | 'measured_value' | 'inspection_date' | 'result_data'
> & {
  point_id: number | null
  work_hours: number | null
  measured_value: number | null
  inspection_date: string
  result_data: Record<string, unknown>
}

function defaultForm(): InspectionFormState {
  return {
  point_id: null,
  work_hours: null,
  personnel_count: 2,
  personnel_level: '中级',
  inspector: '',
  status: 'pending',
  result_summary: '',
  result_data: {},
  measured_value: null,
  unit: '',
  bd_coord: '',
  note: '',
  inspection_date: new Date().toISOString(),
  }
}

const form = reactive<InspectionFormState>(defaultForm())
const recordId = ref<number | null>(null)
const loading = ref(false)
const saving = ref(false)
let loadSequence = 0

function resetForm() {
  Object.assign(form, defaultForm())
  recordId.value = null
}

async function load() {
  const sequence = ++loadSequence
  const unitId = props.unitId
  const itemCode = props.item.code as InspectionItemCode
  resetForm()
  loading.value = true
  try {
  const list = await recordsApi.list({ unit_id: unitId, item_code: itemCode })
  if (sequence !== loadSequence || unitId !== props.unitId || itemCode !== props.item.code) return
  if (list.length > 0) {
    const r = [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
    recordId.value = r.id
    Object.assign(form, {
      point_id: r.point_id ?? null,
      work_hours: r.work_hours,
      personnel_count: r.personnel_count,
      personnel_level: r.personnel_level,
      inspector: r.inspector,
      status: r.status,
      result_summary: r.result_summary,
      result_data: r.result_data ?? {},
      measured_value: r.measured_value,
      unit: r.unit,
      bd_coord: r.bd_coord,
      note: r.note,
      inspection_date: r.inspection_date ?? new Date().toISOString(),
    })
  }
  } catch (e: unknown) {
    if (sequence === loadSequence) {
      ElMessage.error('加载检测记录失败：' + (e instanceof Error ? e.message : '未知错误'))
    }
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    const payload: InspectionRecordInput = {
      ...form,
      point_id: form.point_id ?? undefined,
      work_hours: form.work_hours ?? undefined,
      measured_value: form.measured_value ?? undefined,
      unit_id: props.unitId,
      item_code: props.item.code,
    }
    if (recordId.value) {
      await recordsApi.update(recordId.value, payload)
    } else {
      await recordsApi.create(payload)
    }
    ElMessage.success('保存成功')
    await store.refreshRecords()
    emit('saved')
    await load()
  } catch (e: unknown) {
    ElMessage.error('保存失败：' + (e instanceof Error ? e.message : '未知错误'))
  } finally {
    saving.value = false
  }
}

onMounted(load)
watch(() => [props.unitId, props.item.code], load)
</script>

<template>
  <div class="inspection-form">
    <el-form label-width="120px" v-loading="loading">
      <el-row :gutter="20">
        <el-col :span="12">
          <el-form-item label="检测员">
            <el-input v-model="form.inspector" placeholder="现场检测人员姓名" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="检测时间">
            <el-date-picker
              v-model="form.inspection_date"
              type="datetime"
              style="width:100%"
              format="YYYY-MM-DD HH:mm"
              value-format="YYYY-MM-DDTHH:mm:ss"
            />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="工日">
            <el-input-number v-model="form.work_hours" :precision="2" :step="0.05" :min="0" style="width:100%" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="人员数量">
            <el-input-number v-model="form.personnel_count" :min="0" style="width:100%" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="人员等级">
            <el-select v-model="form.personnel_level" style="width:100%">
              <el-option label="初级 (1000元/日)" value="初级" />
              <el-option label="中级 (1350元/日)" value="中级" />
              <el-option label="高级 (1800元/日)" value="高级" />
              <el-option label="专家 (2500元/日)" value="专家" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>

      <el-divider>检测结果数据</el-divider>

      <el-row :gutter="20">
        <el-col v-for="f in item.fields" :key="f.key" :span="12">
          <el-form-item :label="f.label">
            <el-input v-model="form.result_data[f.key]" :placeholder="`输入 ${f.label}`" />
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="20">
        <el-col :span="12">
          <el-form-item label="主测量值">
            <el-input-number v-model="form.measured_value" :precision="4" style="width:60%" />
            <el-input v-model="form.unit" placeholder="单位" style="width:35%;margin-left:5%" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="北斗坐标">
            <el-input v-model="form.bd_coord" placeholder="如 E118.8400 N31.9520" />
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item label="结果摘要">
        <el-input v-model="form.result_summary" type="textarea" :rows="2" />
      </el-form-item>

      <el-form-item label="状态">
        <el-radio-group v-model="form.status">
          <el-radio-button value="pending">待开始</el-radio-button>
          <el-radio-button value="passed">合格</el-radio-button>
          <el-radio-button value="exception">异常</el-radio-button>
        </el-radio-group>
      </el-form-item>

      <el-form-item label="备注">
        <el-input v-model="form.note" type="textarea" :rows="2" />
      </el-form-item>

      <el-form-item>
        <el-button type="primary" :loading="saving" :disabled="loading" @click="save">保存</el-button>
        <el-button v-if="recordId" disabled>已存在记录 ID #{{ recordId }}</el-button>
      </el-form-item>
    </el-form>
  </div>
</template>
