<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { recordsApi } from '@/api/records'
import { useCpStore } from '@/stores/cp'
import { addInspectionPhotos, deleteInspectionPhoto, listInspectionPhotos, type InspectionPhotoRecord } from '@/utils/inspectionPhotos'
import {
  computeInletDiameterStats,
  hasInletParameterResult,
  inletParameterPhotoOwnerKey,
  inletParameterReadings,
  type InletParameterReading,
} from '@/utils/inletParameters'
import type { CsvInlet } from '@/utils/facilities'
import type { InspectionRecord, InspectionRecordInput, RecordStatus } from '@/types/models'

const props = defineProps<{ unitId: number; inlets: CsvInlet[] }>()
const emit = defineEmits<{ (e: 'saved'): void }>()
const store = useCpStore()
interface PhotoView extends InspectionPhotoRecord { url: string }

const loading = ref(false)
const saving = ref(false)
const recordId = ref<number | null>(null)
const readings = ref<InletParameterReading[]>([])
const orderedInlets = ref<CsvInlet[]>([])
const openedInlets = ref<string[]>([])
const photoViews = ref<Record<number, PhotoView[]>>({})
const photoSaving = ref<Record<number, boolean>>({})
let loadSequence = 0

const metadata = reactive({ inspector: '', inspection_date: new Date().toISOString(), status: 'pending' as RecordStatus, result_summary: '', note: '', method: '数显游标卡尺测量法' })
const completedCount = computed(() => readings.value.filter(hasInletParameterResult).length)

function emptyReading(inlet: CsvInlet): InletParameterReading {
  return { inlet_id: inlet.fid, inlet_code: inlet.ecode || String(inlet.fid), diameter_readings: [], average_diameter: null, diameter_difference: null, out_of_roundness: null, wall_thickness: null, instrument: '数显游标卡尺', note: '' }
}

function sortInlets() { orderedInlets.value = [...props.inlets].sort((a, b) => a.lng - b.lng || a.lat - b.lat) }

function recalculate(reading: InletParameterReading) {
  const stats = computeInletDiameterStats(reading.diameter_readings)
  Object.assign(reading, stats)
}

function addDiameterReading(reading: InletParameterReading) { reading.diameter_readings.push(0); recalculate(reading) }
function removeDiameterReading(reading: InletParameterReading, index: number) { reading.diameter_readings.splice(index, 1); recalculate(reading) }

function revokePhotoViews() { Object.values(photoViews.value).flat().forEach((photo) => URL.revokeObjectURL(photo.url)); photoViews.value = {} }

async function loadPhotos(sequence: number) {
  const entries = await Promise.all(orderedInlets.value.map(async (inlet) => {
    const photos = await listInspectionPhotos(inletParameterPhotoOwnerKey(props.unitId, inlet.fid))
    return [inlet.fid, photos.map((photo): PhotoView => ({ ...photo, url: URL.createObjectURL(photo.blob) }))] as const
  }))
  if (sequence !== loadSequence) { entries.flatMap(([, photos]) => photos).forEach((photo) => URL.revokeObjectURL(photo.url)); return }
  revokePhotoViews()
  photoViews.value = Object.fromEntries(entries)
}

function applyRecord(record?: InspectionRecord) {
  recordId.value = record?.id ?? null
  const saved = inletParameterReadings(record)
  readings.value = orderedInlets.value.map((inlet) => saved.get(inlet.fid) ?? emptyReading(inlet))
  metadata.inspector = record?.inspector ?? ''
  metadata.inspection_date = record?.inspection_date ?? new Date().toISOString()
  metadata.status = record?.status ?? 'pending'
  metadata.result_summary = record?.result_summary ?? ''
  metadata.note = record?.note ?? ''
  metadata.method = String(record?.result_data?.method ?? '数显游标卡尺测量法')
  openedInlets.value = orderedInlets.value[0] ? [String(orderedInlets.value[0].fid)] : []
}

async function load() {
  const sequence = ++loadSequence
  sortInlets(); loading.value = true
  try {
    const records = await recordsApi.list({ unit_id: props.unitId, item_code: 'INLET_PARAM' })
    if (sequence !== loadSequence) return
    applyRecord([...records].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0])
    await loadPhotos(sequence)
  } catch (error) {
    if (sequence === loadSequence) ElMessage.error(`引入口参数加载失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally { if (sequence === loadSequence) loading.value = false }
}

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    readings.value.forEach(recalculate)
    const values = readings.value.flatMap((reading) => reading.average_diameter === null ? [] : [reading.average_diameter])
    const representative = values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : undefined
    const status: RecordStatus = metadata.status === 'passed' || metadata.status === 'exception' ? metadata.status : 'pending'
    const payload: InspectionRecordInput = {
      unit_id: props.unitId, item_code: 'INLET_PARAM', inspector: metadata.inspector, inspection_date: metadata.inspection_date, status,
      result_summary: metadata.result_summary || `已完成 ${completedCount.value}/${readings.value.length} 个引入口参数测量`,
      result_data: { method: metadata.method, inlet_count: readings.value.length, completed_inlet_count: completedCount.value, diameter: representative, average_diameter: representative, inlets: readings.value },
      measured_value: representative, unit: 'mm', note: metadata.note,
    }
    if (recordId.value) await recordsApi.update(recordId.value, payload); else await recordsApi.create(payload)
    await store.refreshRecords()
    ElMessage.success('引入口参数数据已保存')
    emit('saved')
    window.dispatchEvent(new CustomEvent('inletparameterdatachange', { detail: { unitId: props.unitId } }))
    await load()
  } catch (error) { ElMessage.error(`保存失败：${error instanceof Error ? error.message : '未知错误'}`) }
  finally { saving.value = false }
}

async function onPhotosSelected(reading: InletParameterReading, event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? []); input.value = ''
  if (!files.length || photoSaving.value[reading.inlet_id]) return
  photoSaving.value = { ...photoSaving.value, [reading.inlet_id]: true }
  try {
    await addInspectionPhotos(inletParameterPhotoOwnerKey(props.unitId, reading.inlet_id), reading.inlet_id, files)
    await loadPhotos(loadSequence)
    ElMessage.success(`引入口 ${reading.inlet_code} 已保存 ${files.length} 张照片`)
    window.dispatchEvent(new CustomEvent('inletparameterdatachange', { detail: { unitId: props.unitId } }))
  } catch (error) { ElMessage.error(`照片保存失败：${error instanceof Error ? error.message : '未知错误'}`) }
  finally { photoSaving.value = { ...photoSaving.value, [reading.inlet_id]: false } }
}

async function removePhoto(photo: PhotoView) {
  if (!confirm(`确认删除照片“${photo.name}”？`)) return
  await deleteInspectionPhoto(photo.id); await loadPhotos(loadSequence)
  window.dispatchEvent(new CustomEvent('inletparameterdatachange', { detail: { unitId: props.unitId } }))
}

onMounted(load)
watch(() => [props.unitId, props.inlets.map((inlet) => inlet.fid).join(',')], load)
onBeforeUnmount(() => { loadSequence++; revokePhotoViews() })
</script>

<template>
  <section class="inlet-parameter-form insulation-form" v-loading="loading">
    <div class="inlet-parameter-summary"><div><strong>引入口参数测量</strong><span>逐一维护引入口外径、圆度、壁厚和现场照片</span></div><div><b>{{ completedCount }}</b><span>/ {{ readings.length }} 已检测</span></div></div>
    <el-form label-width="92px" class="insulation-meta-form">
      <el-row :gutter="16">
        <el-col :span="6"><el-form-item label="检测人员"><el-input v-model="metadata.inspector" /></el-form-item></el-col>
        <el-col :span="7"><el-form-item label="检测时间"><el-date-picker v-model="metadata.inspection_date" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" format="YYYY-MM-DD HH:mm" style="width:100%" /></el-form-item></el-col>
        <el-col :span="5"><el-form-item label="检测方法"><el-input v-model="metadata.method" /></el-form-item></el-col>
        <el-col :span="6"><el-form-item label="检测状态"><el-radio-group v-model="metadata.status"><el-radio-button label="pending">进行中</el-radio-button><el-radio-button label="passed">合格</el-radio-button><el-radio-button label="exception">异常</el-radio-button></el-radio-group></el-form-item></el-col>
      </el-row>
    </el-form>
    <el-collapse v-model="openedInlets" class="insulation-inlet-list">
      <el-collapse-item v-for="(reading, index) in readings" :key="reading.inlet_id" :name="String(reading.inlet_id)">
        <template #title><div class="inlet-parameter-heading"><span>{{ index + 1 }}</span><strong>{{ reading.inlet_code }}</strong><em>{{ orderedInlets[index]?.pipeno || '未标注管号' }}</em><i :class="{ complete: hasInletParameterResult(reading) }">{{ hasInletParameterResult(reading) ? `${reading.average_diameter?.toFixed(1)} mm` : '待录入' }}</i><b>{{ photoViews[reading.inlet_id]?.length || 0 }} 张照片</b></div></template>
        <div class="inlet-parameter-editor">
          <div class="inlet-diameter-panel">
            <div class="inlet-diameter-head"><strong>外径多点测量</strong><button type="button" @click="addDiameterReading(reading)">＋ 添加读数</button></div>
            <label v-for="(_, readingIndex) in reading.diameter_readings" :key="readingIndex"><span>第 {{ readingIndex + 1 }} 次</span><el-input-number v-model="reading.diameter_readings[readingIndex]" :precision="2" :step="0.1" :controls="false" @change="recalculate(reading)" /><em>mm</em><button type="button" @click="removeDiameterReading(reading, readingIndex)">×</button></label>
            <div v-if="!reading.diameter_readings.length" class="inlet-diameter-empty">暂无读数，点击“添加读数”录入</div>
          </div>
          <div class="inlet-parameter-fields">
            <label><span>平均外径</span><b>{{ reading.average_diameter?.toFixed(2) ?? '—' }} mm</b></label>
            <label><span>最大偏差</span><b>{{ reading.diameter_difference?.toFixed(2) ?? '—' }} mm</b></label>
            <label><span>不圆度</span><b>{{ reading.out_of_roundness?.toFixed(3) ?? '—' }} %</b></label>
            <label><span>壁厚</span><el-input-number v-model="reading.wall_thickness" :precision="2" :step="0.1" :controls="false" /><em>mm</em></label>
            <label><span>仪器</span><el-input v-model="reading.instrument" /></label>
            <label class="wide"><span>备注</span><el-input v-model="reading.note" /></label>
          </div>
          <div class="insulation-photo-editor-head"><strong>现场照片</strong><label class="insulation-photo-upload" :class="{ saving: photoSaving[reading.inlet_id] }"><input type="file" accept="image/*" multiple :disabled="photoSaving[reading.inlet_id]" @change="onPhotosSelected(reading, $event)" />{{ photoSaving[reading.inlet_id] ? '正在保存…' : '＋ 上传照片' }}</label></div>
          <div v-if="photoViews[reading.inlet_id]?.length" class="insulation-photo-list"><div v-for="photo in photoViews[reading.inlet_id]" :key="photo.id" class="insulation-photo-card"><a :href="photo.url" target="_blank" rel="noopener noreferrer"><img :src="photo.url" :alt="photo.name" /></a><span>{{ photo.name }}</span><button type="button" @click="removePhoto(photo)">×</button></div></div>
          <div v-else class="insulation-photo-empty">照片接口已保留，可上传卡尺读数及引入口现场照片</div>
        </div>
      </el-collapse-item>
    </el-collapse>
    <el-form label-width="92px" class="inlet-parameter-result"><el-form-item label="结果摘要"><el-input v-model="metadata.result_summary" type="textarea" :rows="2" /></el-form-item><el-form-item label="备注"><el-input v-model="metadata.note" type="textarea" :rows="2" /></el-form-item><el-form-item><el-button type="primary" :loading="saving" :disabled="loading" @click="save">保存引入口参数</el-button><span v-if="recordId" class="insulation-record-id">记录 #{{ recordId }}</span></el-form-item></el-form>
  </section>
</template>

<style scoped>
.inlet-parameter-summary { display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; padding:16px 18px; border:1px solid rgba(162,28,175,.22); border-radius:12px; background:linear-gradient(135deg,rgba(217,70,239,.1),rgba(217,70,239,.025)); }
.inlet-parameter-summary strong { display:block; color:#a21caf; font-size:18px; }.inlet-parameter-summary span { color:#73767a; font-size:12px; }.inlet-parameter-summary b { margin-right:4px; color:#c026d3; font-size:24px; }
.inlet-parameter-heading { display:grid; grid-template-columns:30px 120px 1fr auto auto; gap:10px; align-items:center; width:100%; padding-right:18px; }.inlet-parameter-heading > span { width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:#fae8ff;color:#a21caf;font-size:11px; }.inlet-parameter-heading em,.inlet-parameter-heading b { color:#909399;font-size:12px;font-style:normal;font-weight:400; }.inlet-parameter-heading i { padding:2px 8px;border-radius:10px;background:#f4f4f5;color:#909399;font-size:11px;font-style:normal; }.inlet-parameter-heading i.complete { background:#fae8ff;color:#a21caf; }
.inlet-parameter-editor { padding:8px 14px 20px 42px; }.inlet-diameter-panel { margin-bottom:14px;padding:14px;border-radius:10px;background:rgba(217,70,239,.055); }.inlet-diameter-head { display:flex;justify-content:space-between;margin-bottom:10px; }.inlet-diameter-head button { border:0;background:none;color:#a21caf;cursor:pointer; }.inlet-diameter-panel label { display:grid;grid-template-columns:60px minmax(0,1fr) 28px 24px;align-items:center;gap:7px;margin:6px 0;color:#73767a;font-size:12px; }.inlet-diameter-panel label button { border:0;border-radius:4px;background:#fee2e2;color:#dc2626;cursor:pointer; }.inlet-diameter-panel :deep(.el-input-number) { width:100%; }.inlet-diameter-empty { color:#909399;font-size:12px;text-align:center; }
.inlet-parameter-fields { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:16px; }.inlet-parameter-fields label { display:flex;align-items:center;gap:7px; }.inlet-parameter-fields label.wide { grid-column:span 2; }.inlet-parameter-fields label > span { flex:0 0 62px;color:#73767a;font-size:12px; }.inlet-parameter-fields b { color:#7e2287; }.inlet-parameter-fields em { color:#909399;font-size:12px;font-style:normal; }.inlet-parameter-fields :deep(.el-input-number) { width:100%; }.inlet-parameter-result { margin-top:20px;padding-top:18px;border-top:1px solid var(--el-border-color-lighter); }:global(html.dark) .inlet-parameter-summary { background:linear-gradient(135deg,rgba(217,70,239,.17),rgba(217,70,239,.04)); }:global(html.dark) .inlet-parameter-summary strong { color:#f0abfc; }
</style>
