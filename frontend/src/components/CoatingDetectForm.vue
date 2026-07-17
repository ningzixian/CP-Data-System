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
  coatingDamagePhotoOwnerKey,
  coatingDamagePoints,
  hasCompleteCoatingDamagePoint,
  type CoatingDamagePoint,
} from '@/utils/coatingDetect'
import type { InspectionRecord, InspectionRecordInput, RecordStatus } from '@/types/models'

const props = defineProps<{ unitId: number; unitLng?: number; unitLat?: number }>()
const emit = defineEmits<{ (e: 'saved'): void }>()
const store = useCpStore()

interface PhotoView extends InspectionPhotoRecord { url: string }

const points = ref<CoatingDamagePoint[]>([])
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
  status: 'exception' as RecordStatus,
  result_summary: '',
  note: '',
  pipeline_length: 3756,
  device: '皮尔逊 SL-2818',
})

const completedCount = computed(() => points.value.filter(hasCompleteCoatingDamagePoint).length)

function createPoint(index = points.value.length): CoatingDamagePoint {
  return {
    id: Date.now() + index,
    name: `破损点 ${index + 1}`,
    building: '',
    location_desc: '',
    lng: props.unitLng ?? null,
    lat: props.unitLat ?? null,
    source_x: null,
    source_y: null,
    buried_depth: null,
    leakage_potential: null,
    surface: '',
    severity: '疑似破损',
    note: '',
    photo_urls: [],
  }
}

function revokePhotoViews() {
  Object.values(photoViews.value).flat().forEach((photo) => URL.revokeObjectURL(photo.url))
  photoViews.value = {}
}

async function loadPhotos(sequence: number) {
  const entries = await Promise.all(points.value.map(async (point) => {
    const photos = await listInspectionPhotos(coatingDamagePhotoOwnerKey(props.unitId, point.id))
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
  points.value = coatingDamagePoints(record)
  metadata.inspector = record?.inspector ?? ''
  metadata.inspection_date = record?.inspection_date ?? new Date().toISOString()
  metadata.status = record?.status ?? 'exception'
  metadata.result_summary = record?.result_summary ?? ''
  metadata.note = record?.note ?? ''
  metadata.pipeline_length = Number(record?.result_data?.pipeline_length ?? 3756)
  metadata.device = String(record?.result_data?.device ?? '皮尔逊 SL-2818')
  openedPoints.value = points.value[0] ? [String(points.value[0].id)] : []
}

async function load() {
  const sequence = ++loadSequence
  loading.value = true
  try {
    const records = await recordsApi.list({ unit_id: props.unitId, item_code: 'COATING_DETECT' })
    if (sequence !== loadSequence) return
    const latest = [...records].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
    applyRecord(latest)
    await loadPhotos(sequence)
  } catch (error) {
    if (sequence === loadSequence) ElMessage.error(`防腐层检测数据加载失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

function addPoint() {
  const point = createPoint()
  points.value.push(point)
  openedPoints.value = [String(point.id)]
}

async function removePoint(point: CoatingDamagePoint) {
  if (!confirm(`确认删除“${point.name}”及其全部照片？`)) return
  await deleteInspectionPhotos(coatingDamagePhotoOwnerKey(props.unitId, point.id))
  points.value = points.value.filter((item) => item.id !== point.id)
  await loadPhotos(loadSequence)
  window.dispatchEvent(new CustomEvent('coatingdetectdatachange', { detail: { unitId: props.unitId } }))
}

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    const status: RecordStatus = metadata.status === 'passed' || metadata.status === 'exception'
      ? metadata.status
      : 'pending'
    const payload: InspectionRecordInput = {
      unit_id: props.unitId,
      item_code: 'COATING_DETECT',
      inspector: metadata.inspector,
      inspection_date: metadata.inspection_date,
      status,
      result_summary: metadata.result_summary || `共记录 ${points.value.length} 处防腐层破损点`,
      result_data: {
        method: '皮尔逊法',
        device: metadata.device,
        pipeline_length: metadata.pipeline_length,
        damage_count: points.value.length,
        completed_point_count: completedCount.value,
        damage_locations: points.value,
      },
      measured_value: points.value.length,
      unit: '处',
      note: metadata.note,
    }
    if (recordId.value) await recordsApi.update(recordId.value, payload)
    else await recordsApi.create(payload)
    await store.refreshRecords()
    ElMessage.success('防腐层破损点数据已保存')
    emit('saved')
    window.dispatchEvent(new CustomEvent('coatingdetectdatachange', { detail: { unitId: props.unitId } }))
    await load()
  } catch (error) {
    ElMessage.error(`保存失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    saving.value = false
  }
}

async function onPhotosSelected(point: CoatingDamagePoint, event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length || photoSaving.value[point.id]) return
  photoSaving.value = { ...photoSaving.value, [point.id]: true }
  try {
    await addInspectionPhotos(coatingDamagePhotoOwnerKey(props.unitId, point.id), point.id, files)
    await loadPhotos(loadSequence)
    ElMessage.success(`${point.name} 已保存 ${files.length} 张照片`)
    window.dispatchEvent(new CustomEvent('coatingdetectdatachange', { detail: { unitId: props.unitId } }))
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
  window.dispatchEvent(new CustomEvent('coatingdetectdatachange', { detail: { unitId: props.unitId } }))
}

function removeBuiltInPhoto(point: CoatingDamagePoint, url: string) {
  if (!confirm('确认移除这张照片？')) return
  point.photo_urls = point.photo_urls.filter((photo) => photo.url !== url)
}

onMounted(load)
watch(() => props.unitId, load)
onBeforeUnmount(() => { loadSequence++; revokePhotoViews() })
</script>

<template>
  <section class="coating-form" v-loading="loading">
    <div class="coating-form-summary">
      <div><strong>防腐层破损点</strong><span>维护皮尔逊检测结果、地图位置和现场留痕照片</span></div>
      <div class="coating-form-progress"><b>{{ completedCount }}</b><span>/ {{ points.length }} 条完整记录</span></div>
    </div>

    <el-form label-width="92px" class="coating-meta-form">
      <el-row :gutter="16">
        <el-col :span="6"><el-form-item label="检测人员"><el-input v-model="metadata.inspector" /></el-form-item></el-col>
        <el-col :span="6"><el-form-item label="检测时间"><el-date-picker v-model="metadata.inspection_date" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" format="YYYY-MM-DD HH:mm" style="width:100%" /></el-form-item></el-col>
        <el-col :span="6"><el-form-item label="检测设备"><el-input v-model="metadata.device" /></el-form-item></el-col>
        <el-col :span="6"><el-form-item label="管线长度"><el-input-number v-model="metadata.pipeline_length" :min="0" :precision="0" /><span class="coating-field-unit">m</span></el-form-item></el-col>
      </el-row>
    </el-form>

    <div class="coating-location-actions"><span>破损点共 {{ points.length }} 处</span><el-button type="danger" plain @click="addPoint">＋ 新增破损点</el-button></div>
    <el-collapse v-model="openedPoints" class="coating-point-list">
      <el-collapse-item v-for="(point, index) in points" :key="point.id" :name="String(point.id)">
        <template #title>
          <div class="coating-point-heading">
            <span class="coating-heading-symbol">×</span><strong>{{ point.name }}</strong><span>{{ point.building }} · {{ point.location_desc }}</span>
            <i :class="{ complete: hasCompleteCoatingDamagePoint(point) }">{{ hasCompleteCoatingDamagePoint(point) ? '数据完整' : '待补录' }}</i>
            <em>{{ point.photo_urls.length + (photoViews[point.id]?.length || 0) }} 张照片</em>
          </div>
        </template>

        <div class="coating-point-editor">
          <div class="coating-point-fields">
            <h4>破损点信息</h4>
            <label><span>编号</span><el-input v-model="point.name" /></label>
            <label><span>所属楼栋</span><el-input v-model="point.building" /></label>
            <label class="wide"><span>参考位置</span><el-input v-model="point.location_desc" /></label>
            <label><span>埋深</span><el-input-number v-model="point.buried_depth" :min="0" :precision="2" /><em>m</em></label>
            <label><span>泄漏电位</span><el-input-number v-model="point.leakage_potential" :precision="1" /><em>mV</em></label>
            <label><span>地表</span><el-input v-model="point.surface" /></label>
            <label><span>判定</span><el-select v-model="point.severity"><el-option label="疑似破损" value="疑似破损" /><el-option label="确认破损" value="确认破损" /><el-option label="已修复" value="已修复" /></el-select></label>
          </div>

          <div class="coating-point-fields coating-coordinate-fields">
            <h4>坐标信息</h4>
            <label><span>地图经度</span><el-input-number v-model="point.lng" :precision="8" :controls="false" /></label>
            <label><span>地图纬度</span><el-input-number v-model="point.lat" :precision="8" :controls="false" /></label>
            <label><span>原始 X</span><el-input-number v-model="point.source_x" :precision="2" :controls="false" /></label>
            <label><span>原始 Y</span><el-input-number v-model="point.source_y" :precision="2" :controls="false" /></label>
          </div>

          <div class="coating-photo-editor">
            <div class="insulation-photo-editor-head"><strong>现场照片</strong><label class="insulation-photo-upload" :class="{ saving: photoSaving[point.id] }"><input type="file" accept="image/*" multiple :disabled="photoSaving[point.id]" @change="onPhotosSelected(point, $event)" />{{ photoSaving[point.id] ? '正在保存…' : '＋ 上传照片' }}</label></div>
            <div v-if="point.photo_urls.length || photoViews[point.id]?.length" class="insulation-photo-list">
              <div v-for="photo in point.photo_urls" :key="photo.url" class="insulation-photo-card"><a :href="photo.url" target="_blank" rel="noopener noreferrer"><img :src="photo.url" :alt="photo.name" /></a><span>{{ photo.name }}</span><button type="button" @click="removeBuiltInPhoto(point, photo.url)">×</button></div>
              <div v-for="photo in photoViews[point.id]" :key="photo.id" class="insulation-photo-card"><a :href="photo.url" target="_blank" rel="noopener noreferrer"><img :src="photo.url" :alt="photo.name" /></a><span>{{ photo.name }}</span><button type="button" @click="removePhoto(photo)">×</button></div>
            </div>
            <div v-else class="insulation-photo-empty">照片接口已保留，可上传破损标记、周边环境及仪器读数照片</div>
          </div>

          <div class="coating-point-note"><el-input v-model="point.note" type="textarea" :rows="2" placeholder="破损点备注" /><el-button type="danger" plain @click="removePoint(point)">删除破损点</el-button></div>
        </div>
      </el-collapse-item>
    </el-collapse>

    <el-form label-width="92px" class="coating-result-form">
      <el-form-item label="检测状态"><el-radio-group v-model="metadata.status"><el-radio-button label="pending">待开始</el-radio-button><el-radio-button label="passed">合格</el-radio-button><el-radio-button label="exception">异常</el-radio-button></el-radio-group></el-form-item>
      <el-form-item label="结果摘要"><el-input v-model="metadata.result_summary" type="textarea" :rows="2" /></el-form-item>
      <el-form-item label="备注"><el-input v-model="metadata.note" type="textarea" :rows="2" /></el-form-item>
      <el-form-item><el-button type="primary" :loading="saving" :disabled="loading" @click="save">保存防腐层检测数据</el-button><span v-if="recordId" class="insulation-record-id">记录 #{{ recordId }}</span></el-form-item>
    </el-form>
  </section>
</template>

<style scoped>
.coating-form { --coating-red:#e5484d; }
.coating-form-summary { display:flex; justify-content:space-between; align-items:center; padding:16px 18px; margin-bottom:18px; border:1px solid rgba(229,72,77,.22); border-radius:12px; background:linear-gradient(135deg,rgba(229,72,77,.1),rgba(229,72,77,.025)); }
.coating-form-summary strong { display:block; color:#c9343b; font-size:18px; }
.coating-form-summary span { color:#73767a; font-size:12px; }
.coating-form-progress b { color:var(--coating-red); font-size:24px; margin-right:4px; }
.coating-location-actions { display:flex; justify-content:space-between; align-items:center; margin:12px 0; font-weight:600; }
.coating-point-heading { display:grid; grid-template-columns:30px 80px 1fr auto auto; gap:10px; align-items:center; width:100%; padding-right:18px; }
.coating-point-heading > span:nth-of-type(2) { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#73767a; font-size:12px; }
.coating-point-heading i { padding:2px 8px; border-radius:10px; background:#f4f4f5; color:#909399; font-style:normal; font-size:11px; }
.coating-point-heading i.complete { background:#fef0f0; color:#d93840; }
.coating-point-heading em { color:#909399; font-style:normal; font-size:12px; }
.coating-heading-symbol { display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border:2px solid var(--coating-red); border-radius:50%; color:var(--coating-red); font-size:18px; font-weight:800; line-height:1; }
.coating-point-editor { padding:4px 12px 18px 42px; }
.coating-point-fields { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin-bottom:16px; }
.coating-point-fields h4 { grid-column:1/-1; margin:0; color:#4b4d51; }
.coating-point-fields label { display:flex; align-items:center; gap:6px; }
.coating-point-fields label > span { flex:0 0 66px; color:#73767a; font-size:12px; }
.coating-point-fields label.wide { grid-column:span 2; }
.coating-point-fields em,.coating-field-unit { color:#909399; font-style:normal; font-size:12px; margin-left:5px; }
.coating-point-fields :deep(.el-input-number),.coating-point-fields :deep(.el-select) { width:100%; }
.coating-coordinate-fields { padding:14px; border-radius:10px; background:rgba(229,72,77,.045); }
.coating-photo-editor { margin:14px 0; }
.coating-point-note { display:flex; gap:12px; align-items:flex-end; }
.coating-point-note :deep(.el-textarea) { flex:1; }
.coating-result-form { margin-top:20px; padding-top:18px; border-top:1px solid var(--el-border-color-lighter); }
:global(html.dark) .coating-form-summary { background:linear-gradient(135deg,rgba(229,72,77,.16),rgba(229,72,77,.04)); }
:global(html.dark) .coating-form-summary strong,:global(html.dark) .coating-point-fields h4 { color:#ff8589; }
</style>
