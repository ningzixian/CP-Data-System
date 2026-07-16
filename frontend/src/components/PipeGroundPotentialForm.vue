<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { recordsApi } from '@/api/records'
import { useCpStore } from '@/stores/cp'
import {
  addInspectionPhotos,
  deleteInspectionPhoto,
  listInspectionPhotos,
  type InspectionPhotoRecord,
} from '@/utils/inspectionPhotos'
import {
  hasNaturalPotential,
  inletPotentialReadings,
  pipePotentialPhotoOwnerKey,
  pipePotentialValues,
  type InletPotentialReading,
} from '@/utils/pipeGroundPotential'
import type { CsvInlet } from '@/utils/facilities'
import type { InspectionRecord, InspectionRecordInput, RecordStatus } from '@/types/models'

const props = defineProps<{ unitId: number; inlets: CsvInlet[] }>()
const emit = defineEmits<{ (e: 'saved'): void }>()
const store = useCpStore()

interface PhotoView extends InspectionPhotoRecord { url: string }

const loading = ref(false)
const saving = ref(false)
const recordId = ref<number | null>(null)
const readings = ref<InletPotentialReading[]>([])
const orderedInlets = ref<CsvInlet[]>([])
const openedInlets = ref<string[]>([])
const photoViews = ref<Record<number, PhotoView[]>>({})
const photoSaving = ref<Record<number, boolean>>({})
let loadSequence = 0

const metadata = reactive({
  inspector: '',
  inspection_date: new Date().toISOString(),
  status: 'pending' as RecordStatus,
  result_summary: '',
  note: '',
})

const completedCount = computed(() => readings.value.filter(hasNaturalPotential).length)

function emptyReading(inlet: CsvInlet): InletPotentialReading {
  return {
    inlet_id: inlet.fid,
    inlet_code: inlet.ecode || String(inlet.fid),
    natural_potential: null,
    reference_electrode: 'Cu/CuSO₄',
    test_method: '自然电位法',
    note: '',
  }
}

function sortInlets() {
  orderedInlets.value = [...props.inlets].sort((a, b) => a.lng - b.lng || a.lat - b.lat)
}

function revokePhotoViews() {
  Object.values(photoViews.value).flat().forEach((photo) => URL.revokeObjectURL(photo.url))
  photoViews.value = {}
}

async function loadPhotos(sequence: number) {
  const entries = await Promise.all(orderedInlets.value.map(async (inlet) => {
    const photos = await listInspectionPhotos(pipePotentialPhotoOwnerKey(props.unitId, inlet.fid))
    return [inlet.fid, photos.map((photo): PhotoView => ({ ...photo, url: URL.createObjectURL(photo.blob) }))] as const
  }))
  if (sequence !== loadSequence) {
    entries.flatMap(([, photos]) => photos).forEach((photo) => URL.revokeObjectURL(photo.url))
    return
  }
  revokePhotoViews()
  photoViews.value = Object.fromEntries(entries)
}

function applyRecord(record?: InspectionRecord) {
  recordId.value = record?.id ?? null
  const saved = inletPotentialReadings(record)
  readings.value = orderedInlets.value.map((inlet) => saved.get(inlet.fid) ?? emptyReading(inlet))
  metadata.inspector = record?.inspector ?? ''
  metadata.inspection_date = record?.inspection_date ?? new Date().toISOString()
  metadata.status = record?.status ?? 'pending'
  metadata.result_summary = record?.result_summary ?? ''
  metadata.note = record?.note ?? ''
  openedInlets.value = orderedInlets.value[0] ? [String(orderedInlets.value[0].fid)] : []
}

async function load() {
  const sequence = ++loadSequence
  sortInlets()
  readings.value = orderedInlets.value.map(emptyReading)
  loading.value = true
  try {
    const records = await recordsApi.list({ unit_id: props.unitId, item_code: 'PIPE_GROUND_POTENTIAL' })
    if (sequence !== loadSequence) return
    applyRecord([...records].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0])
    await loadPhotos(sequence)
  } catch (error) {
    if (sequence === loadSequence) ElMessage.error(`管地腐蚀电位数据加载失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    const values = pipePotentialValues(readings.value)
    const representative = values.length
      ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4))
      : undefined
    const payload: InspectionRecordInput = {
      unit_id: props.unitId,
      item_code: 'PIPE_GROUND_POTENTIAL',
      inspector: metadata.inspector,
      inspection_date: metadata.inspection_date,
      status: metadata.status,
      result_summary: metadata.result_summary || `已完成 ${completedCount.value}/${readings.value.length} 个引入口自然电位测试`,
      result_data: {
        method: '自然电位法',
        inlet_count: readings.value.length,
        completed_inlet_count: completedCount.value,
        natural_potential: representative,
        inlets: readings.value,
      },
      measured_value: representative,
      unit: 'V',
      note: metadata.note,
    }
    if (recordId.value) await recordsApi.update(recordId.value, payload)
    else await recordsApi.create(payload)
    await store.refreshRecords()
    ElMessage.success('管地腐蚀电位数据已保存')
    emit('saved')
    window.dispatchEvent(new CustomEvent('pipegroundpotentialdatachange', { detail: { unitId: props.unitId } }))
    await load()
  } catch (error) {
    ElMessage.error(`保存失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    saving.value = false
  }
}

async function onPhotosSelected(reading: InletPotentialReading, event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length || photoSaving.value[reading.inlet_id]) return
  photoSaving.value = { ...photoSaving.value, [reading.inlet_id]: true }
  try {
    await addInspectionPhotos(pipePotentialPhotoOwnerKey(props.unitId, reading.inlet_id), reading.inlet_id, files)
    await loadPhotos(loadSequence)
    ElMessage.success(`引入口 ${reading.inlet_code} 已保存 ${files.length} 张照片`)
    window.dispatchEvent(new CustomEvent('pipegroundpotentialdatachange', { detail: { unitId: props.unitId } }))
  } catch (error) {
    ElMessage.error(`照片保存失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    photoSaving.value = { ...photoSaving.value, [reading.inlet_id]: false }
  }
}

async function removePhoto(photo: PhotoView) {
  if (!confirm(`确认删除照片“${photo.name}”？`)) return
  await deleteInspectionPhoto(photo.id)
  await loadPhotos(loadSequence)
  window.dispatchEvent(new CustomEvent('pipegroundpotentialdatachange', { detail: { unitId: props.unitId } }))
}

onMounted(load)
watch(() => [props.unitId, props.inlets.map((inlet) => inlet.fid).join(',')], load)
onBeforeUnmount(() => { loadSequence++; revokePhotoViews() })
</script>

<template>
  <section class="potential-form insulation-form" v-loading="loading">
    <div class="potential-form-summary">
      <div><strong>引入口自然电位</strong><span>逐一维护各引入口的自然电位读数与现场照片</span></div>
      <div class="potential-form-progress"><b>{{ completedCount }}</b><span>/ {{ readings.length }} 已检测</span></div>
    </div>

    <el-form label-width="92px" class="insulation-meta-form">
      <el-row :gutter="16">
        <el-col :span="8"><el-form-item label="检测人员"><el-input v-model="metadata.inspector" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="检测时间"><el-date-picker v-model="metadata.inspection_date" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" format="YYYY-MM-DD HH:mm" style="width:100%" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="检测状态"><el-radio-group v-model="metadata.status"><el-radio-button value="pending">进行中</el-radio-button><el-radio-button value="passed">合格</el-radio-button><el-radio-button value="exception">异常</el-radio-button></el-radio-group></el-form-item></el-col>
      </el-row>
    </el-form>

    <el-collapse v-model="openedInlets" class="insulation-inlet-list">
      <el-collapse-item v-for="(reading, index) in readings" :key="reading.inlet_id" :name="String(reading.inlet_id)">
        <template #title>
          <div class="potential-inlet-heading">
            <span class="potential-inlet-index">{{ index + 1 }}</span><strong>{{ reading.inlet_code }}</strong>
            <span>{{ orderedInlets[index]?.pipeno || '未标注管号' }} · {{ orderedInlets[index]?.pressured || '压力未知' }}</span>
            <i :class="{ complete: hasNaturalPotential(reading) }">{{ hasNaturalPotential(reading) ? `${reading.natural_potential?.toFixed(4)} V` : '待录入' }}</i>
            <em>{{ photoViews[reading.inlet_id]?.length || 0 }} 张照片</em>
          </div>
        </template>
        <div class="potential-inlet-editor">
          <div class="potential-reading-panel">
            <label><span>自然电位</span><el-input-number v-model="reading.natural_potential" :precision="4" :step="0.0001" :controls="false" /><em>V</em></label>
            <label><span>参比电极</span><el-input v-model="reading.reference_electrode" /></label>
            <label><span>测试方法</span><el-input v-model="reading.test_method" /></label>
            <label class="wide"><span>备注</span><el-input v-model="reading.note" /></label>
          </div>
          <div class="insulation-photo-editor-head"><strong>现场照片</strong><label class="insulation-photo-upload" :class="{ saving: photoSaving[reading.inlet_id] }"><input type="file" accept="image/*" multiple :disabled="photoSaving[reading.inlet_id]" @change="onPhotosSelected(reading, $event)" />{{ photoSaving[reading.inlet_id] ? '正在保存…' : '＋ 上传照片' }}</label></div>
          <div v-if="photoViews[reading.inlet_id]?.length" class="insulation-photo-list">
            <div v-for="photo in photoViews[reading.inlet_id]" :key="photo.id" class="insulation-photo-card"><a :href="photo.url" target="_blank" rel="noopener noreferrer"><img :src="photo.url" :alt="photo.name" /></a><span>{{ photo.name }}</span><button type="button" @click="removePhoto(photo)">×</button></div>
          </div>
          <div v-else class="insulation-photo-empty">照片接口已保留，可上传仪表读数和引入口现场照片</div>
        </div>
      </el-collapse-item>
    </el-collapse>

    <el-form label-width="92px" class="potential-result-form">
      <el-form-item label="结果摘要"><el-input v-model="metadata.result_summary" type="textarea" :rows="2" /></el-form-item>
      <el-form-item label="备注"><el-input v-model="metadata.note" type="textarea" :rows="2" /></el-form-item>
      <el-form-item><el-button type="primary" :loading="saving" :disabled="loading" @click="save">保存自然电位数据</el-button><span v-if="recordId" class="insulation-record-id">记录 #{{ recordId }}</span></el-form-item>
    </el-form>
  </section>
</template>

<style scoped>
.potential-form-summary { display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; padding:16px 18px; border:1px solid rgba(3,105,161,.2); border-radius:12px; background:linear-gradient(135deg,rgba(14,165,233,.1),rgba(14,165,233,.025)); }
.potential-form-summary strong { display:block; color:#0369a1; font-size:18px; }
.potential-form-summary span { color:#73767a; font-size:12px; }
.potential-form-progress b { margin-right:4px; color:#0284c7; font-size:24px; }
.potential-inlet-heading { display:grid; grid-template-columns:30px 120px 1fr auto auto; gap:10px; align-items:center; width:100%; padding-right:18px; }
.potential-inlet-heading > span:nth-of-type(2) { overflow:hidden; color:#73767a; font-size:12px; text-overflow:ellipsis; white-space:nowrap; }
.potential-inlet-index { width:22px; height:22px; display:inline-flex; align-items:center; justify-content:center; border-radius:50%; background:#e0f2fe; color:#0369a1; font-size:11px; }
.potential-inlet-heading i { padding:2px 8px; border-radius:10px; background:#f4f4f5; color:#909399; font-size:11px; font-style:normal; }
.potential-inlet-heading i.complete { background:#e0f2fe; color:#0369a1; }
.potential-inlet-heading em { color:#909399; font-size:12px; font-style:normal; }
.potential-inlet-editor { padding:8px 14px 20px 42px; }
.potential-reading-panel { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; margin-bottom:18px; padding:16px; border-radius:10px; background:rgba(14,165,233,.055); }
.potential-reading-panel label { display:flex; align-items:center; gap:7px; }
.potential-reading-panel label.wide { grid-column:span 3; }
.potential-reading-panel label > span { flex:0 0 62px; color:#73767a; font-size:12px; }
.potential-reading-panel em { color:#909399; font-size:12px; font-style:normal; }
.potential-reading-panel :deep(.el-input-number) { width:100%; }
.potential-result-form { margin-top:20px; padding-top:18px; border-top:1px solid var(--el-border-color-lighter); }
:global(html.dark) .potential-form-summary { background:linear-gradient(135deg,rgba(14,165,233,.17),rgba(14,165,233,.04)); }
:global(html.dark) .potential-form-summary strong { color:#7dd3fc; }
</style>
