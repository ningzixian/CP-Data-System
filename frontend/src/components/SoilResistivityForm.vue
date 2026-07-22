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
  hasCompleteSoilReading,
  soilPhotoOwnerKey,
  soilResistivityPoints,
  soilResistivityPointsFromRecords,
  type SoilResistivityPoint,
} from '@/utils/soilResistivity'
import type { InspectionRecord, InspectionRecordInput, RecordStatus } from '@/types/models'

const props = defineProps<{
  unitId: number
  unitLng?: number
  unitLat?: number
}>()

const emit = defineEmits<{ (e: 'saved'): void }>()
const store = useCpStore()

interface PhotoView extends InspectionPhotoRecord {
  url: string
}

const points = ref<SoilResistivityPoint[]>([])
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

const completedCount = computed(() => points.value.filter(hasCompleteSoilReading).length)

function createPoint(index = points.value.length): SoilResistivityPoint {
  return {
    id: Date.now() + index,
    name: `土壤测试点 ${index + 1}`,
    lng: props.unitLng ?? null,
    lat: props.unitLat ?? null,
    ground_rod_count: 4,
    ground_rod_spacing: null,
    test_current: null,
    test_voltage: null,
    measured_resistance: null,
    geometric_coefficient: null,
    resistivity: null,
    ph: null,
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
    const records = await listInspectionPhotos(soilPhotoOwnerKey(props.unitId, point.id))
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
  points.value = soilResistivityPoints(record)
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
  openedPoints.value = []
  loading.value = true
  try {
    const records = await recordsApi.list({ unit_id: props.unitId, item_code: 'SOIL_RESISTIVITY' })
    if (sequence !== loadSequence) return
    const latest = [...records].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
    applyRecord(latest)
    points.value = soilResistivityPointsFromRecords(records)
    await loadPhotos(sequence)
  } catch (error) {
    if (sequence === loadSequence) ElMessage.error(`土壤电阻率数据加载失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

function addPoint() {
  const point = createPoint()
  points.value.push(point)
  openedPoints.value = [String(point.id)]
}

async function removePoint(point: SoilResistivityPoint) {
  if (!confirm(`确认删除“${point.name}”及其全部照片？`)) return
  try {
    await deleteInspectionPhotos(soilPhotoOwnerKey(props.unitId, point.id))
    points.value = points.value.filter((item) => item.id !== point.id)
    await loadPhotos(loadSequence)
    window.dispatchEvent(new CustomEvent('soilresistivitydatachange', { detail: { unitId: props.unitId } }))
  } catch (error) {
    ElMessage.error(`测试位置删除失败：${error instanceof Error ? error.message : '未知错误'}`)
  }
}

function calculatePoint(point: SoilResistivityPoint) {
  if (point.measured_resistance === null && point.test_voltage !== null && point.test_current) {
    point.measured_resistance = Number((point.test_voltage / point.test_current).toFixed(4))
  }
  if (point.geometric_coefficient === null && point.ground_rod_spacing !== null) {
    point.geometric_coefficient = Number((2 * Math.PI * point.ground_rod_spacing).toFixed(4))
  }
  if (point.measured_resistance !== null && point.geometric_coefficient !== null) {
    point.resistivity = Number((point.measured_resistance * point.geometric_coefficient).toFixed(3))
  }
}

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    const resistivities = points.value.map((point) => point.resistivity).filter((value): value is number => value !== null)
    const representative = resistivities.length
      ? Number((resistivities.reduce((sum, value) => sum + value, 0) / resistivities.length).toFixed(3))
      : undefined
    const payload: InspectionRecordInput = {
      unit_id: props.unitId,
      item_code: 'SOIL_RESISTIVITY',
      inspector: metadata.inspector,
      inspection_date: metadata.inspection_date,
      status: metadata.status,
      result_summary: metadata.result_summary || `已完成 ${completedCount.value}/${points.value.length} 个位置的土壤电阻率检测`,
      result_data: {
        method: '四极法',
        point_count: points.value.length,
        completed_point_count: completedCount.value,
        resistivity: representative,
        ph: points.value.find((point) => point.ph !== null)?.ph ?? null,
        test_points: points.value,
      },
      measured_value: representative,
      unit: 'Ω·m',
      note: metadata.note,
    }
    if (recordId.value) await recordsApi.update(recordId.value, payload)
    else await recordsApi.create(payload)
    await store.refreshRecords()
    ElMessage.success('土壤电阻率数据已保存')
    emit('saved')
    window.dispatchEvent(new CustomEvent('soilresistivitydatachange', { detail: { unitId: props.unitId } }))
    await load()
  } catch (error) {
    ElMessage.error(`保存失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    saving.value = false
  }
}

async function onPhotosSelected(point: SoilResistivityPoint, event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length || photoSaving.value[point.id]) return
  photoSaving.value = { ...photoSaving.value, [point.id]: true }
  try {
    await addInspectionPhotos(soilPhotoOwnerKey(props.unitId, point.id), point.id, files)
    await loadPhotos(loadSequence)
    ElMessage.success(`${point.name} 已保存 ${files.length} 张照片`)
    window.dispatchEvent(new CustomEvent('soilresistivitydatachange', { detail: { unitId: props.unitId } }))
  } catch (error) {
    ElMessage.error(`照片保存失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    photoSaving.value = { ...photoSaving.value, [point.id]: false }
  }
}

async function removePhoto(photo: PhotoView) {
  if (!confirm(`确认删除照片“${photo.name}”？`)) return
  try {
    await deleteInspectionPhoto(photo.id)
    await loadPhotos(loadSequence)
    window.dispatchEvent(new CustomEvent('soilresistivitydatachange', { detail: { unitId: props.unitId } }))
  } catch (error) {
    ElMessage.error(`照片删除失败：${error instanceof Error ? error.message : '未知错误'}`)
  }
}

function removeBuiltInPhoto(point: SoilResistivityPoint, url: string) {
  if (!confirm('确认从该测试位置移除这张照片？')) return
  point.photo_urls = point.photo_urls.filter((photo) => photo.url !== url)
}

onMounted(load)
watch(() => props.unitId, load)
onBeforeUnmount(() => {
  loadSequence++
  revokePhotoViews()
})
</script>

<template>
  <section class="soil-form" v-loading="loading">
    <div class="soil-form-summary">
      <div><strong>土壤电阻率检测</strong><span>测试位置、地钎布置、四极法参数及现场照片统一维护</span></div>
      <div class="soil-form-progress"><b>{{ completedCount }}</b><span>/ {{ points.length }} 已完整录入</span></div>
    </div>

    <el-form label-width="92px" class="soil-meta-form">
      <el-row :gutter="16">
        <el-col :span="8"><el-form-item label="检测人员"><el-input v-model="metadata.inspector" placeholder="请输入检测人员" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="检测时间"><el-date-picker v-model="metadata.inspection_date" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" format="YYYY-MM-DD HH:mm" style="width:100%" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="检测状态"><el-radio-group v-model="metadata.status"><el-radio-button value="pending">待开始</el-radio-button><el-radio-button value="passed">合格</el-radio-button><el-radio-button value="exception">异常</el-radio-button></el-radio-group></el-form-item></el-col>
      </el-row>
    </el-form>

    <div class="soil-location-actions"><span>测试位置共 {{ points.length }} 处</span><el-button type="primary" plain @click="addPoint">＋ 新增测试位置</el-button></div>
    <el-collapse v-model="openedPoints" class="soil-point-list">
      <el-collapse-item v-for="(point, index) in points" :key="point.id" :name="String(point.id)">
        <template #title>
          <div class="soil-point-heading">
            <span class="soil-point-index">{{ index + 1 }}</span>
            <strong>{{ point.name }}</strong>
            <span>{{ point.lng !== null && point.lat !== null ? `${point.lng.toFixed(6)}, ${point.lat.toFixed(6)}` : '坐标待录入' }}</span>
            <i :class="{ complete: hasCompleteSoilReading(point) }">{{ hasCompleteSoilReading(point) ? '数据完整' : '待补充' }}</i>
            <em>{{ point.photo_urls.length + (photoViews[point.id]?.length || 0) }} 张照片</em>
          </div>
        </template>

        <div class="soil-point-editor">
          <div class="soil-point-fields">
            <h4>位置与地钎布置</h4>
            <label><span>位置名称</span><el-input v-model="point.name" /></label>
            <label><span>经度</span><el-input-number v-model="point.lng" :precision="8" :controls="false" /></label>
            <label><span>纬度</span><el-input-number v-model="point.lat" :precision="8" :controls="false" /></label>
            <label><span>地钎数量</span><el-input-number v-model="point.ground_rod_count" :min="1" :precision="0" /><em>根</em></label>
            <label><span>地钎间距</span><el-input-number v-model="point.ground_rod_spacing" :min="0" :precision="3" /><em>m</em></label>
          </div>

          <div class="soil-point-fields soil-method-fields">
            <h4>四极法测量参数</h4>
            <label><span>测试电流</span><el-input-number v-model="point.test_current" :precision="4" /><em>mA</em></label>
            <label><span>测试电压</span><el-input-number v-model="point.test_voltage" :precision="4" /><em>mV</em></label>
            <label><span>实测电阻 R</span><el-input-number v-model="point.measured_resistance" :min="0" :precision="4" /><em>Ω</em></label>
            <label><span>几何系数 K</span><el-input-number v-model="point.geometric_coefficient" :min="0" :precision="4" /></label>
            <label class="soil-resistivity-result"><span>土壤电阻率 ρ</span><el-input-number v-model="point.resistivity" :min="0" :precision="3" /><em>Ω·m</em></label>
            <label><span>土壤酸碱度</span><el-input-number v-model="point.ph" :min="0" :max="14" :precision="2" /><em>pH</em></label>
            <button type="button" class="soil-calculate-btn" @click="calculatePoint(point)">按 ρ = K × R 计算</button>
          </div>

          <div class="soil-photo-editor">
            <div class="insulation-photo-editor-head"><strong>现场照片</strong><label class="insulation-photo-upload" :class="{ saving: photoSaving[point.id] }"><input type="file" accept="image/*" multiple :disabled="photoSaving[point.id]" @change="onPhotosSelected(point, $event)" />{{ photoSaving[point.id] ? '正在保存…' : '＋ 上传照片' }}</label></div>
            <div v-if="point.photo_urls.length || photoViews[point.id]?.length" class="insulation-photo-list">
              <div v-for="photo in point.photo_urls" :key="photo.url" class="insulation-photo-card"><a :href="photo.url" target="_blank" rel="noopener noreferrer"><img :src="photo.url" :alt="photo.name" /></a><span :title="photo.name">{{ photo.name }}</span><button type="button" title="移除照片" @click="removeBuiltInPhoto(point, photo.url)">×</button></div>
              <div v-for="photo in photoViews[point.id]" :key="photo.id" class="insulation-photo-card"><a :href="photo.url" target="_blank" rel="noopener noreferrer"><img :src="photo.url" :alt="photo.name" /></a><span :title="photo.name">{{ photo.name }}</span><button type="button" title="删除照片" @click="removePhoto(photo)">×</button></div>
            </div>
            <div v-else class="insulation-photo-empty">暂无照片，可上传地钎布置、仪表读数及现场环境照片</div>
          </div>

          <div class="soil-point-note"><el-input v-model="point.note" type="textarea" :rows="2" placeholder="该测试位置的备注信息" /><el-button type="danger" plain @click="removePoint(point)">删除测试位置</el-button></div>
        </div>
      </el-collapse-item>
    </el-collapse>
    <div v-if="!points.length && !loading" class="soil-point-empty">尚未添加测试位置，点击“新增测试位置”开始录入</div>

    <el-form label-width="92px" class="soil-result-form">
      <el-form-item label="结果摘要"><el-input v-model="metadata.result_summary" type="textarea" :rows="2" placeholder="不填写时将按已完成测试位置数量自动生成" /></el-form-item>
      <el-form-item label="备注"><el-input v-model="metadata.note" type="textarea" :rows="2" /></el-form-item>
      <el-form-item><el-button type="primary" :loading="saving" :disabled="loading" @click="save">保存土壤电阻率数据</el-button><span v-if="recordId" class="insulation-record-id">记录 #{{ recordId }}</span></el-form-item>
    </el-form>
  </section>
</template>
