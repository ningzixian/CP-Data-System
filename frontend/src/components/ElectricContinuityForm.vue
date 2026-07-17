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
  electricContinuityAverage,
  electricContinuityPhotoOwnerKey,
  electricContinuityPoints,
  hasElectricContinuityResult,
  type ElectricContinuityPoint,
} from '@/utils/electricContinuity'
import type { InspectionRecord, InspectionRecordInput, RecordStatus } from '@/types/models'

const props = defineProps<{ unitId: number; unitLng?: number; unitLat?: number }>()
const emit = defineEmits<{ (e: 'saved'): void }>()
const store = useCpStore()

interface PhotoView extends InspectionPhotoRecord { url: string }

const loading = ref(false)
const saving = ref(false)
const recordId = ref<number | null>(null)
const points = ref<ElectricContinuityPoint[]>([])
const openedPoints = ref<string[]>([])
const photoViews = ref<Record<number, PhotoView[]>>({})
const photoSaving = ref<Record<number, boolean>>({})
let loadSequence = 0

const metadata = reactive({
  inspector: '',
  inspection_date: new Date().toISOString(),
  status: 'pending' as RecordStatus,
  method: '电阻测量法',
  result_summary: '',
  note: '',
})

const completedCount = computed(() => points.value.filter(hasElectricContinuityResult).length)
const connectedCount = computed(() => points.value.filter((point) => point.is_connected === true).length)

function revokePhotoViews() {
  Object.values(photoViews.value).flat().forEach((photo) => URL.revokeObjectURL(photo.url))
  photoViews.value = {}
}

async function loadPhotos(sequence: number) {
  const entries = await Promise.all(points.value.map(async (point) => {
    const photos = await listInspectionPhotos(electricContinuityPhotoOwnerKey(props.unitId, point.id))
    return [point.id, photos.map((photo): PhotoView => ({ ...photo, url: URL.createObjectURL(photo.blob) }))] as const
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
  points.value = electricContinuityPoints(record)
  metadata.inspector = record?.inspector ?? ''
  metadata.inspection_date = record?.inspection_date ?? new Date().toISOString()
  metadata.status = record?.status ?? 'pending'
  metadata.method = String(record?.result_data?.method ?? '电阻测量法')
  metadata.result_summary = record?.result_summary ?? ''
  metadata.note = record?.note ?? ''
  openedPoints.value = points.value[0] ? [String(points.value[0].id)] : []
}

async function load() {
  const sequence = ++loadSequence
  loading.value = true
  try {
    const records = await recordsApi.list({ unit_id: props.unitId, item_code: 'ELECTRIC_CONTINUITY' })
    if (sequence !== loadSequence) return
    applyRecord([...records].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0])
    await loadPhotos(sequence)
  } catch (error) {
    if (sequence === loadSequence) ElMessage.error(`管道电联通性数据加载失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

function addPoint() {
  const id = Date.now()
  points.value.push({
    id,
    name: `电联通测试点 ${points.value.length + 1}`,
    target_type: '外部接地体',
    lng: props.unitLng ?? null,
    lat: props.unitLat ?? null,
    measured_resistance: null,
    resistance_unit: 'kΩ',
    is_connected: null,
    conclusion: '待判定',
    note: '',
    photo_urls: [],
  })
  openedPoints.value = [...openedPoints.value, String(id)]
}

function setConclusion(point: ElectricContinuityPoint, conclusion: string) {
  point.conclusion = conclusion
  point.is_connected = conclusion === '联通' ? true : conclusion === '未联通' ? false : null
}

function removePoint(point: ElectricContinuityPoint) {
  if (!confirm(`确认删除测试位置“${point.name}”？已上传照片不会自动删除。`)) return
  points.value = points.value.filter((item) => item.id !== point.id)
}

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    const status: RecordStatus = metadata.status === 'passed' || metadata.status === 'exception'
      ? metadata.status
      : 'pending'
    const average = electricContinuityAverage(points.value)
    const aggregate = connectedCount.value > 0 ? '发现电联通' : completedCount.value > 0 ? '未发现电联通' : '待检测'
    const payload: InspectionRecordInput = {
      unit_id: props.unitId,
      item_code: 'ELECTRIC_CONTINUITY',
      inspector: metadata.inspector,
      inspection_date: metadata.inspection_date,
      status,
      result_summary: metadata.result_summary || `已完成 ${completedCount.value}/${points.value.length} 处电联通性测试，${aggregate}`,
      result_data: {
        method: metadata.method,
        point_count: points.value.length,
        completed_point_count: completedCount.value,
        connected_count: connectedCount.value,
        is_connected: aggregate,
        average_resistance: average,
        test_points: points.value,
      },
      measured_value: average ?? undefined,
      unit: 'kΩ',
      note: metadata.note,
    }
    if (recordId.value) await recordsApi.update(recordId.value, payload)
    else await recordsApi.create(payload)
    await store.refreshRecords()
    ElMessage.success('管道电联通性数据已保存')
    emit('saved')
    window.dispatchEvent(new CustomEvent('electriccontinuitydatachange', { detail: { unitId: props.unitId } }))
    await load()
  } catch (error) {
    ElMessage.error(`保存失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    saving.value = false
  }
}

async function onPhotosSelected(point: ElectricContinuityPoint, event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length || photoSaving.value[point.id]) return
  photoSaving.value = { ...photoSaving.value, [point.id]: true }
  try {
    await addInspectionPhotos(electricContinuityPhotoOwnerKey(props.unitId, point.id), point.id, files)
    await loadPhotos(loadSequence)
    ElMessage.success(`${point.name} 已保存 ${files.length} 张照片`)
    window.dispatchEvent(new CustomEvent('electriccontinuitydatachange', { detail: { unitId: props.unitId } }))
  } catch (error) {
    ElMessage.error(`照片保存失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    photoSaving.value = { ...photoSaving.value, [point.id]: false }
  }
}

async function removePhoto(photo: PhotoView) {
  if (!confirm(`确认删除照片“${photo.name}”？`)) return
  await deleteInspectionPhoto(photo.id)
  await loadPhotos(loadSequence)
  window.dispatchEvent(new CustomEvent('electriccontinuitydatachange', { detail: { unitId: props.unitId } }))
}

onMounted(load)
watch(() => props.unitId, load)
onBeforeUnmount(() => { loadSequence++; revokePhotoViews() })
</script>

<template>
  <section class="continuity-form insulation-form" v-loading="loading">
    <div class="continuity-form-summary">
      <div><strong>管道电联通性</strong><span>维护管道与周边接地体的测试电阻、判定结果及现场照片</span></div>
      <div class="continuity-form-progress"><b>{{ completedCount }}</b><span>/ {{ points.length }} 已检测</span></div>
    </div>

    <el-form label-width="92px" class="insulation-meta-form">
      <el-row :gutter="16">
        <el-col :span="6"><el-form-item label="检测人员"><el-input v-model="metadata.inspector" /></el-form-item></el-col>
        <el-col :span="7"><el-form-item label="检测时间"><el-date-picker v-model="metadata.inspection_date" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" format="YYYY-MM-DD HH:mm" style="width:100%" /></el-form-item></el-col>
        <el-col :span="5"><el-form-item label="检测方法"><el-input v-model="metadata.method" /></el-form-item></el-col>
        <el-col :span="6"><el-form-item label="检测状态"><el-radio-group v-model="metadata.status"><el-radio-button label="pending">进行中</el-radio-button><el-radio-button label="passed">合格</el-radio-button><el-radio-button label="exception">异常</el-radio-button></el-radio-group></el-form-item></el-col>
      </el-row>
    </el-form>

    <div class="continuity-actions"><span>发现电联通 {{ connectedCount }} 处</span><el-button type="primary" plain @click="addPoint">＋ 新增测试位置</el-button></div>
    <el-collapse v-model="openedPoints" class="insulation-inlet-list">
      <el-collapse-item v-for="(point, index) in points" :key="point.id" :name="String(point.id)">
        <template #title>
          <div class="continuity-point-heading">
            <span>{{ index + 1 }}</span><strong>{{ point.name }}</strong><em>{{ point.target_type }}</em>
            <i :class="{ complete: hasElectricContinuityResult(point) }">{{ hasElectricContinuityResult(point) ? `${point.measured_resistance} ${point.resistance_unit}` : '待录入' }}</i>
            <b>{{ photoViews[point.id]?.length || 0 }} 张照片</b>
          </div>
        </template>
        <div class="continuity-point-editor">
          <div class="continuity-reading-panel">
            <label><span>位置名称</span><el-input v-model="point.name" /></label>
            <label><span>对象类型</span><el-input v-model="point.target_type" /></label>
            <label class="resistance-field"><span>测试电阻</span><el-input-number v-model="point.measured_resistance" :precision="3" :step="0.1" :controls="false" /><el-select v-model="point.resistance_unit" class="resistance-unit"><el-option label="kΩ" value="kΩ" /><el-option label="MΩ" value="MΩ" /></el-select></label>
            <label><span>经度</span><el-input-number v-model="point.lng" :precision="8" :step="0.00001" :controls="false" /></label>
            <label><span>纬度</span><el-input-number v-model="point.lat" :precision="8" :step="0.00001" :controls="false" /></label>
            <label><span>判定结果</span><el-select :model-value="point.conclusion" @update:model-value="setConclusion(point, $event)"><el-option label="未联通" value="未联通" /><el-option label="联通" value="联通" /><el-option label="待判定" value="待判定" /></el-select></label>
            <label class="wide"><span>备注</span><el-input v-model="point.note" /></label>
          </div>
          <div class="insulation-photo-editor-head"><strong>现场照片</strong><label class="insulation-photo-upload" :class="{ saving: photoSaving[point.id] }"><input type="file" accept="image/*" multiple :disabled="photoSaving[point.id]" @change="onPhotosSelected(point, $event)" />{{ photoSaving[point.id] ? '正在保存…' : '＋ 上传照片' }}</label></div>
          <div v-if="photoViews[point.id]?.length" class="insulation-photo-list">
            <div v-for="photo in photoViews[point.id]" :key="photo.id" class="insulation-photo-card"><a :href="photo.url" target="_blank" rel="noopener noreferrer"><img :src="photo.url" :alt="photo.name" /></a><span>{{ photo.name }}</span><button type="button" @click="removePhoto(photo)">×</button></div>
          </div>
          <div v-else class="insulation-photo-empty">照片接口已保留，可上传仪表读数和测试位置现场照片</div>
          <div class="continuity-remove"><el-button type="danger" text @click="removePoint(point)">删除此测试位置</el-button></div>
        </div>
      </el-collapse-item>
    </el-collapse>

    <el-form label-width="92px" class="continuity-result-form">
      <el-form-item label="结果摘要"><el-input v-model="metadata.result_summary" type="textarea" :rows="2" /></el-form-item>
      <el-form-item label="备注"><el-input v-model="metadata.note" type="textarea" :rows="2" /></el-form-item>
      <el-form-item><el-button type="primary" :loading="saving" :disabled="loading" @click="save">保存电联通性数据</el-button><span v-if="recordId" class="insulation-record-id">记录 #{{ recordId }}</span></el-form-item>
    </el-form>
  </section>
</template>

<style scoped>
.continuity-form-summary { display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; padding:16px 18px; border:1px solid rgba(21,128,61,.22); border-radius:12px; background:linear-gradient(135deg,rgba(34,197,94,.1),rgba(34,197,94,.025)); }
.continuity-form-summary strong { display:block; color:#15803d; font-size:18px; }
.continuity-form-summary span { color:#73767a; font-size:12px; }
.continuity-form-progress b { margin-right:4px; color:#16a34a; font-size:24px; }
.continuity-actions { display:flex; align-items:center; justify-content:space-between; margin:6px 0 12px; color:#73767a; font-size:12px; }
.continuity-point-heading { display:grid; grid-template-columns:30px 180px 1fr auto auto; gap:10px; align-items:center; width:100%; padding-right:18px; }
.continuity-point-heading > span { width:22px; height:22px; display:inline-flex; align-items:center; justify-content:center; border-radius:50%; background:#dcfce7; color:#15803d; font-size:11px; }
.continuity-point-heading em,.continuity-point-heading b { color:#909399; font-size:12px; font-style:normal; font-weight:400; }
.continuity-point-heading i { padding:2px 8px; border-radius:10px; background:#f4f4f5; color:#909399; font-size:11px; font-style:normal; }
.continuity-point-heading i.complete { background:#dcfce7; color:#15803d; }
.continuity-point-editor { padding:8px 14px 20px 42px; }
.continuity-reading-panel { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; margin-bottom:18px; padding:16px; border-radius:10px; background:rgba(34,197,94,.055); }
.continuity-reading-panel label { display:flex; align-items:center; gap:7px; }
.continuity-reading-panel label.wide { grid-column:span 3; }
.continuity-reading-panel label > span { flex:0 0 62px; color:#73767a; font-size:12px; }
.continuity-reading-panel em { color:#909399; font-size:12px; font-style:normal; }
.continuity-reading-panel :deep(.el-input-number),.continuity-reading-panel :deep(.el-select) { width:100%; }
.continuity-reading-panel .resistance-field :deep(.el-input-number) { min-width:0; }
.continuity-reading-panel .resistance-unit { flex:0 0 76px; width:76px; }
.continuity-remove { display:flex; justify-content:flex-end; margin-top:6px; }
.continuity-result-form { margin-top:20px; padding-top:18px; border-top:1px solid var(--el-border-color-lighter); }
:global(html.dark) .continuity-form-summary { background:linear-gradient(135deg,rgba(34,197,94,.17),rgba(34,197,94,.04)); }
:global(html.dark) .continuity-form-summary strong { color:#86efac; }
</style>
