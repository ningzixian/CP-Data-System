<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { recordsApi } from '@/api/records'
import { useCpStore } from '@/stores/cp'
import {
  hasCompleteInsulationReading,
  inletInsulationReadings,
  insulationPhotoOwnerKey,
  insulationValues,
  type InletInsulationReading,
  type InsulationResistanceUnit,
} from '@/utils/insulation'
import {
  addInsulationPhotos,
  deleteInsulationPhoto,
  listInsulationPhotos,
  type InsulationPhotoRecord,
} from '@/utils/insulationPhotos'
import type { CsvInlet } from '@/utils/facilities'
import type { InspectionRecord, InspectionRecordInput, RecordStatus } from '@/types/models'

const props = defineProps<{
  unitId: number
  inlets: CsvInlet[]
}>()

const emit = defineEmits<{ (e: 'saved'): void }>()
const store = useCpStore()

interface PhotoView extends InsulationPhotoRecord {
  url: string
}

const loading = ref(false)
const saving = ref(false)
const recordId = ref<number | null>(null)
const readings = ref<InletInsulationReading[]>(props.inlets.map(emptyReading))
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

const completedCount = computed(() => readings.value.filter(hasCompleteInsulationReading).length)
const resistanceUnits: InsulationResistanceUnit[] = ['Ω', 'kΩ', 'MΩ']

function emptyReading(inlet: CsvInlet): InletInsulationReading {
  return {
    inlet_id: inlet.fid,
    inlet_code: inlet.ecode || String(inlet.fid),
    bolt_resistances: [null, null, null, null],
    bolt_resistance_units: ['MΩ', 'MΩ', 'MΩ', 'MΩ'],
    flange_resistance: null,
    flange_resistance_unit: 'MΩ',
  }
}

function revokePhotoViews() {
  Object.values(photoViews.value).flat().forEach((photo) => URL.revokeObjectURL(photo.url))
  photoViews.value = {}
}

async function loadPhotos(sequence: number) {
  const entries = await Promise.all(props.inlets.map(async (inlet) => {
    const records = await listInsulationPhotos(insulationPhotoOwnerKey(props.unitId, inlet.fid))
    return [inlet.fid, records.map((photo): PhotoView => ({ ...photo, url: URL.createObjectURL(photo.blob) }))] as const
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
  const saved = inletInsulationReadings(record)
  readings.value = props.inlets.map((inlet) => saved.get(inlet.fid) ?? emptyReading(inlet))
  metadata.inspector = record?.inspector ?? ''
  metadata.inspection_date = record?.inspection_date ?? new Date().toISOString()
  metadata.status = record?.status ?? 'pending'
  metadata.result_summary = record?.result_summary ?? ''
  metadata.note = record?.note ?? ''
  if (!openedInlets.value.length && props.inlets[0]) openedInlets.value = [String(props.inlets[0].fid)]
}

async function load() {
  const sequence = ++loadSequence
  readings.value = props.inlets.map(emptyReading)
  openedInlets.value = props.inlets[0] ? [String(props.inlets[0].fid)] : []
  loading.value = true
  try {
    const records = await recordsApi.list({ unit_id: props.unitId, item_code: 'JOINT_VERIFY' })
    if (sequence !== loadSequence) return
    const latest = [...records].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
    applyRecord(latest)
    await loadPhotos(sequence)
  } catch (error) {
    if (sequence === loadSequence) {
      ElMessage.error(`绝缘性能数据加载失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    const values = insulationValues(readings.value)
    const representative = values.length
      ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3))
      : undefined
    const payload: InspectionRecordInput = {
      unit_id: props.unitId,
      item_code: 'JOINT_VERIFY',
      inspector: metadata.inspector,
      inspection_date: metadata.inspection_date,
      status: metadata.status,
      result_summary: metadata.result_summary || `已完成 ${completedCount.value}/${readings.value.length} 个引入口绝缘性能检测`,
      result_data: {
        inlet_count: readings.value.length,
        completed_inlet_count: completedCount.value,
        insulation_resistance: representative,
        inlets: readings.value,
      },
      measured_value: representative,
      unit: 'MΩ',
      note: metadata.note,
    }
    if (recordId.value) await recordsApi.update(recordId.value, payload)
    else await recordsApi.create(payload)
    await store.refreshRecords()
    ElMessage.success('绝缘性能数据已保存')
    emit('saved')
    window.dispatchEvent(new CustomEvent('insulationdatachange', { detail: { unitId: props.unitId } }))
    await load()
  } catch (error) {
    ElMessage.error(`保存失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    saving.value = false
  }
}

async function onPhotosSelected(inletId: number, inletCode: string, event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length || photoSaving.value[inletId]) return
  photoSaving.value = { ...photoSaving.value, [inletId]: true }
  try {
    await addInsulationPhotos(insulationPhotoOwnerKey(props.unitId, inletId), inletId, files)
    await loadPhotos(loadSequence)
    ElMessage.success(`引入口 ${inletCode} 已保存 ${files.length} 张照片`)
    window.dispatchEvent(new CustomEvent('insulationdatachange', { detail: { unitId: props.unitId } }))
  } catch (error) {
    ElMessage.error(`照片保存失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    photoSaving.value = { ...photoSaving.value, [inletId]: false }
  }
}

async function removePhoto(photo: PhotoView) {
  if (!confirm(`确认删除照片“${photo.name}”？`)) return
  try {
    await deleteInsulationPhoto(photo.id)
    await loadPhotos(loadSequence)
    window.dispatchEvent(new CustomEvent('insulationdatachange', { detail: { unitId: props.unitId } }))
  } catch (error) {
    ElMessage.error(`照片删除失败：${error instanceof Error ? error.message : '未知错误'}`)
  }
}

onMounted(load)
watch(() => [props.unitId, props.inlets.map((inlet) => inlet.fid).join(',')], load)
onBeforeUnmount(() => {
  loadSequence++
  revokePhotoViews()
})
</script>

<template>
  <section class="insulation-form" v-loading="loading">
    <div class="insulation-form-summary">
      <div>
        <strong>引入口绝缘性能</strong>
              <span>四套螺栓、上下法兰之间电阻及现场照片统一维护</span>
      </div>
      <div class="insulation-form-progress">
        <b>{{ completedCount }}</b><span>/ {{ readings.length }} 已完整录入</span>
      </div>
    </div>

    <el-form label-width="92px" class="insulation-meta-form">
      <el-row :gutter="16">
        <el-col :span="8"><el-form-item label="检测人员"><el-input v-model="metadata.inspector" placeholder="请输入检测人员" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="检测时间"><el-date-picker v-model="metadata.inspection_date" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" format="YYYY-MM-DD HH:mm" style="width:100%" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="检测状态"><el-radio-group v-model="metadata.status"><el-radio-button value="pending">待开始</el-radio-button><el-radio-button value="passed">合格</el-radio-button><el-radio-button value="exception">异常</el-radio-button></el-radio-group></el-form-item></el-col>
      </el-row>
    </el-form>

    <el-collapse v-model="openedInlets" class="insulation-inlet-list">
      <el-collapse-item v-for="(reading, inletIndex) in readings" :key="reading.inlet_id" :name="String(reading.inlet_id)">
        <template #title>
          <div class="insulation-inlet-heading">
            <span class="insulation-inlet-index">{{ reading.inlet_code }}</span>
            <span>{{ inlets[inletIndex]?.pipeno || '未标注管号' }} · {{ inlets[inletIndex]?.pressured || '压力未知' }}</span>
            <span class="insulation-inlet-state" :class="{ complete: hasCompleteInsulationReading(reading) }">
              {{ hasCompleteInsulationReading(reading) ? '数据完整' : '待补充' }}
            </span>
            <span class="insulation-inlet-photo-count">{{ photoViews[reading.inlet_id]?.length || 0 }} 张照片</span>
          </div>
        </template>

        <div class="insulation-inlet-editor">
          <div class="insulation-flange-diagram" aria-hidden="true">
            <div class="insulation-flange upper">上法兰</div>
            <div class="insulation-bolt-ring"><i v-for="index in 4" :key="index">{{ index }}</i></div>
            <div class="insulation-gasket">绝缘垫片</div>
            <div class="insulation-flange lower">下法兰</div>
          </div>

          <div class="insulation-resistance-grid">
            <label v-for="(_, index) in reading.bolt_resistances" :key="index">
              <span>第 {{ index + 1 }} 套螺栓</span>
              <el-input-number v-model="reading.bolt_resistances[index]" :min="0" :precision="3" controls-position="right" />
              <el-select v-model="reading.bolt_resistance_units[index]" class="insulation-resistance-unit">
                <el-option v-for="unit in resistanceUnits" :key="unit" :label="unit" :value="unit" />
              </el-select>
            </label>
            <label class="is-wide">
              <span>上下法兰之间</span>
              <el-input-number v-model="reading.flange_resistance" :min="0" :precision="3" controls-position="right" />
              <el-select v-model="reading.flange_resistance_unit" class="insulation-resistance-unit">
                <el-option v-for="unit in resistanceUnits" :key="unit" :label="unit" :value="unit" />
              </el-select>
            </label>
          </div>

          <div class="insulation-photo-editor">
            <div class="insulation-photo-editor-head">
              <strong>现场照片</strong>
              <label class="insulation-photo-upload" :class="{ saving: photoSaving[reading.inlet_id] }">
                <input type="file" accept="image/*" multiple :disabled="photoSaving[reading.inlet_id]" @change="onPhotosSelected(reading.inlet_id, reading.inlet_code, $event)" />
                {{ photoSaving[reading.inlet_id] ? '正在保存…' : '＋ 上传照片' }}
              </label>
            </div>
            <div v-if="photoViews[reading.inlet_id]?.length" class="insulation-photo-list">
              <div v-for="photo in photoViews[reading.inlet_id]" :key="photo.id" class="insulation-photo-card">
                <a :href="photo.url" target="_blank" rel="noopener noreferrer"><img :src="photo.url" :alt="photo.name" /></a>
                <span :title="photo.name">{{ photo.name }}</span>
                <button type="button" title="删除照片" @click="removePhoto(photo)">×</button>
              </div>
            </div>
            <div v-else class="insulation-photo-empty">暂无照片，可上传法兰、螺栓及垫片现场照片</div>
          </div>
        </div>
      </el-collapse-item>
    </el-collapse>

    <el-form label-width="92px" class="insulation-result-form">
      <el-form-item label="结果摘要"><el-input v-model="metadata.result_summary" type="textarea" :rows="2" placeholder="不填写时将按已完成引入口数量自动生成" /></el-form-item>
      <el-form-item label="备注"><el-input v-model="metadata.note" type="textarea" :rows="2" /></el-form-item>
      <el-form-item><el-button type="primary" :loading="saving" :disabled="loading" @click="save">保存绝缘性能数据</el-button><span v-if="recordId" class="insulation-record-id">记录 #{{ recordId }}</span></el-form-item>
    </el-form>
  </section>
</template>
