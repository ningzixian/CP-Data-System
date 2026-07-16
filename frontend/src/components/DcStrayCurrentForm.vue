<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { recordsApi } from '@/api/records'
import { useCpStore } from '@/stores/cp'
import {
  addInspectionPhotos,
  deleteInspectionPhoto,
  deleteInspectionPhotos,
  listInspectionPhotos,
  type InspectionPhotoRecord,
} from '@/utils/inspectionPhotos'
import {
  calculateDcStrayStatistics,
  dcStrayCurrentPoints,
  dcStrayPhotoOwnerKey,
  hasCompleteDcStrayReading,
  type DcStrayCurrentPoint,
} from '@/utils/dcStrayCurrent'
import type { InspectionRecord, InspectionRecordInput, RecordStatus } from '@/types/models'

const props = defineProps<{ unitId: number; unitLng?: number; unitLat?: number }>()
const emit = defineEmits<{ (e: 'saved'): void }>()
const store = useCpStore()

interface PhotoView extends InspectionPhotoRecord { url: string }

const points = ref<DcStrayCurrentPoint[]>([])
const openedPoints = ref<string[]>([])
const photoViews = ref<Record<number, PhotoView[]>>({})
const photoSaving = ref<Record<number, boolean>>({})
const loading = ref(false)
const saving = ref(false)
const recordId = ref<number | null>(null)
let loadSequence = 0

const metadata = reactive({
  inspector: '',
  inspection_date: new Date().toISOString(),
  status: 'pending' as RecordStatus,
  result_summary: '',
  note: '',
})

const completedCount = computed(() => points.value.filter(hasCompleteDcStrayReading).length)

function createPoint(index = points.value.length): DcStrayCurrentPoint {
  return {
    id: Date.now() + index,
    name: `直流电位监测点 ${index + 1}`,
    lng: props.unitLng ?? null,
    lat: props.unitLat ?? null,
    potential_readings: [],
    min_potential: null,
    max_potential: null,
    average_potential: null,
    potential_fluctuation: null,
    reference_electrode: 'Cu/CuSO₄',
    note: '',
    photo_urls: [],
  }
}

function recalculate(point: DcStrayCurrentPoint) {
  const stats = calculateDcStrayStatistics(point.potential_readings)
  point.min_potential = stats.min
  point.max_potential = stats.max
  point.average_potential = stats.average
  point.potential_fluctuation = stats.fluctuation
}

function addReading(point: DcStrayCurrentPoint) {
  point.potential_readings.push(0)
  recalculate(point)
}

function removeReading(point: DcStrayCurrentPoint, index: number) {
  point.potential_readings.splice(index, 1)
  recalculate(point)
}

function revokePhotoViews() {
  Object.values(photoViews.value).flat().forEach((photo) => URL.revokeObjectURL(photo.url))
  photoViews.value = {}
}

async function loadPhotos(sequence: number) {
  const entries = await Promise.all(points.value.map(async (point) => {
    const records = await listInspectionPhotos(dcStrayPhotoOwnerKey(props.unitId, point.id))
    return [point.id, records.map((photo): PhotoView => ({ ...photo, url: URL.createObjectURL(photo.blob) }))] as const
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
  points.value = dcStrayCurrentPoints(record)
  metadata.inspector = record?.inspector ?? ''
  metadata.inspection_date = record?.inspection_date ?? new Date().toISOString()
  metadata.status = record?.status ?? 'pending'
  metadata.result_summary = record?.result_summary ?? ''
  metadata.note = record?.note ?? ''
  openedPoints.value = points.value[0] ? [String(points.value[0].id)] : []
}

async function load() {
  const sequence = ++loadSequence
  points.value = []
  loading.value = true
  try {
    const records = await recordsApi.list({ unit_id: props.unitId, item_code: 'DC_STRAY_CURRENT' })
    if (sequence !== loadSequence) return
    applyRecord([...records].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0])
    await loadPhotos(sequence)
  } catch (error) {
    if (sequence === loadSequence) ElMessage.error(`直流杂散电流数据加载失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

function addPoint() {
  const point = createPoint()
  points.value.push(point)
  openedPoints.value = [String(point.id)]
}

async function removePoint(point: DcStrayCurrentPoint) {
  if (!confirm(`确认删除“${point.name}”及其全部照片？`)) return
  await deleteInspectionPhotos(dcStrayPhotoOwnerKey(props.unitId, point.id))
  points.value = points.value.filter((item) => item.id !== point.id)
  await loadPhotos(loadSequence)
  window.dispatchEvent(new CustomEvent('dcstraycurrentdatachange', { detail: { unitId: props.unitId } }))
}

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    points.value.forEach(recalculate)
    const readings = points.value.flatMap((point) => point.potential_readings).map(Number).filter(Number.isFinite)
    const representative = readings.length ? Number((readings.reduce((sum, value) => sum + value, 0) / readings.length).toFixed(4)) : undefined
    const payload: InspectionRecordInput = {
      unit_id: props.unitId,
      item_code: 'DC_STRAY_CURRENT',
      inspector: metadata.inspector,
      inspection_date: metadata.inspection_date,
      status: metadata.status,
      result_summary: metadata.result_summary || `已完成 ${completedCount.value}/${points.value.length} 个位置的直流电位监测`,
      result_data: {
        method: '管地直流电位法',
        point_count: points.value.length,
        completed_point_count: completedCount.value,
        average_potential: representative,
        monitoring_points: points.value,
      },
      measured_value: representative,
      unit: 'V',
      note: metadata.note,
    }
    if (recordId.value) await recordsApi.update(recordId.value, payload)
    else await recordsApi.create(payload)
    await store.refreshRecords()
    ElMessage.success('直流杂散电流数据已保存')
    emit('saved')
    window.dispatchEvent(new CustomEvent('dcstraycurrentdatachange', { detail: { unitId: props.unitId } }))
    await load()
  } catch (error) {
    ElMessage.error(`保存失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    saving.value = false
  }
}

async function onPhotosSelected(point: DcStrayCurrentPoint, event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length || photoSaving.value[point.id]) return
  photoSaving.value = { ...photoSaving.value, [point.id]: true }
  try {
    await addInspectionPhotos(dcStrayPhotoOwnerKey(props.unitId, point.id), point.id, files)
    await loadPhotos(loadSequence)
    ElMessage.success(`${point.name} 已保存 ${files.length} 张照片`)
    window.dispatchEvent(new CustomEvent('dcstraycurrentdatachange', { detail: { unitId: props.unitId } }))
  } finally {
    photoSaving.value = { ...photoSaving.value, [point.id]: false }
  }
}

async function removePhoto(photo: PhotoView) {
  if (!confirm(`确认删除照片“${photo.name}”？`)) return
  await deleteInspectionPhoto(photo.id)
  await loadPhotos(loadSequence)
  window.dispatchEvent(new CustomEvent('dcstraycurrentdatachange', { detail: { unitId: props.unitId } }))
}

function removeBuiltInPhoto(point: DcStrayCurrentPoint, url: string) {
  if (!confirm('确认从该监测点移除这张照片？')) return
  point.photo_urls = point.photo_urls.filter((photo) => photo.url !== url)
}

onMounted(load)
watch(() => props.unitId, load)
onBeforeUnmount(() => { loadSequence++; revokePhotoViews() })
</script>

<template>
  <section class="soil-form dc-form" v-loading="loading">
    <div class="soil-form-summary dc-form-summary"><div><strong>直流杂散电流检测</strong><span>监测点、管地直流电位样本与现场照片统一管理</span></div><div class="soil-form-progress"><b>{{ completedCount }}</b><span>/ {{ points.length }} 已完整录入</span></div></div>
    <el-form label-width="92px" class="soil-meta-form"><el-row :gutter="16"><el-col :span="8"><el-form-item label="检测人员"><el-input v-model="metadata.inspector" /></el-form-item></el-col><el-col :span="8"><el-form-item label="检测时间"><el-date-picker v-model="metadata.inspection_date" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" format="YYYY-MM-DD HH:mm" style="width:100%" /></el-form-item></el-col><el-col :span="8"><el-form-item label="检测状态"><el-radio-group v-model="metadata.status"><el-radio-button value="pending">待开始</el-radio-button><el-radio-button value="passed">合格</el-radio-button><el-radio-button value="exception">异常</el-radio-button></el-radio-group></el-form-item></el-col></el-row></el-form>
    <div class="soil-location-actions"><span>监测位置共 {{ points.length }} 处</span><el-button type="primary" plain @click="addPoint">＋ 新增监测点</el-button></div>
    <el-collapse v-model="openedPoints" class="soil-point-list"><el-collapse-item v-for="(point, index) in points" :key="point.id" :name="String(point.id)">
      <template #title><div class="soil-point-heading"><span class="soil-point-index">{{ index + 1 }}</span><strong>{{ point.name }}</strong><span>{{ point.lng !== null && point.lat !== null ? `${point.lng.toFixed(6)}, ${point.lat.toFixed(6)}` : '坐标待录入' }}</span><i :class="{ complete: hasCompleteDcStrayReading(point) }">{{ hasCompleteDcStrayReading(point) ? '数据完整' : '待补充' }}</i><em>{{ point.photo_urls.length + (photoViews[point.id]?.length || 0) }} 张照片</em></div></template>
      <div class="soil-point-editor dc-point-editor">
        <div class="soil-point-fields"><h4>监测位置</h4><label><span>位置名称</span><el-input v-model="point.name" /></label><label><span>经度</span><el-input-number v-model="point.lng" :precision="8" :controls="false" /></label><label><span>纬度</span><el-input-number v-model="point.lat" :precision="8" :controls="false" /></label><label><span>参比电极</span><el-input v-model="point.reference_electrode" /></label></div>
        <div class="soil-point-fields dc-reading-fields"><h4>直流电位样本</h4><div v-for="(_, readingIndex) in point.potential_readings" :key="readingIndex" class="dc-reading-row"><span>样本 {{ readingIndex + 1 }}</span><el-input-number v-model="point.potential_readings[readingIndex]" :precision="4" :controls="false" @change="recalculate(point)" /><em>VDC</em><button type="button" @click="removeReading(point, readingIndex)">×</button></div><button type="button" class="soil-calculate-btn" @click="addReading(point)">＋ 添加读数</button><div class="dc-stat-grid"><span>最小值 <b>{{ point.min_potential ?? '—' }} V</b></span><span>最大值 <b>{{ point.max_potential ?? '—' }} V</b></span><span>平均值 <b>{{ point.average_potential ?? '—' }} V</b></span><span>波动幅度 <b>{{ point.potential_fluctuation ?? '—' }} mV</b></span></div></div>
        <div class="soil-photo-editor"><div class="insulation-photo-editor-head"><strong>现场照片</strong><label class="insulation-photo-upload" :class="{ saving: photoSaving[point.id] }"><input type="file" accept="image/*" multiple :disabled="photoSaving[point.id]" @change="onPhotosSelected(point, $event)" />{{ photoSaving[point.id] ? '正在保存…' : '＋ 上传照片' }}</label></div><div v-if="point.photo_urls.length || photoViews[point.id]?.length" class="insulation-photo-list"><div v-for="photo in point.photo_urls" :key="photo.url" class="insulation-photo-card"><a :href="photo.url" target="_blank" rel="noopener noreferrer"><img :src="photo.url" :alt="photo.name" /></a><span>{{ photo.name }}</span><button type="button" @click="removeBuiltInPhoto(point, photo.url)">×</button></div><div v-for="photo in photoViews[point.id]" :key="photo.id" class="insulation-photo-card"><a :href="photo.url" target="_blank" rel="noopener noreferrer"><img :src="photo.url" :alt="photo.name" /></a><span>{{ photo.name }}</span><button type="button" @click="removePhoto(photo)">×</button></div></div><div v-else class="insulation-photo-empty">暂无照片</div></div>
        <div class="soil-point-note"><el-input v-model="point.note" type="textarea" :rows="2" placeholder="该监测点的备注信息" /><el-button type="danger" plain @click="removePoint(point)">删除监测点</el-button></div>
      </div>
    </el-collapse-item></el-collapse>
    <div v-if="!points.length && !loading" class="soil-point-empty">尚未添加监测点</div>
    <el-form label-width="92px" class="soil-result-form"><el-form-item label="结果摘要"><el-input v-model="metadata.result_summary" type="textarea" :rows="2" /></el-form-item><el-form-item label="备注"><el-input v-model="metadata.note" type="textarea" :rows="2" /></el-form-item><el-form-item><el-button type="primary" :loading="saving" :disabled="loading" @click="save">保存直流杂散电流数据</el-button><span v-if="recordId" class="insulation-record-id">记录 #{{ recordId }}</span></el-form-item></el-form>
  </section>
</template>
