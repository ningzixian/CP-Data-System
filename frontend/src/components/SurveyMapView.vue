<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { loadAMap } from '@/map/amap-loader'
import type { CsvInlet, CsvPipe } from '@/utils/facilities'
import type { SurveyEndpointId, SurveyLine, SurveyPoint, SurveyPointType } from '@/types/survey'

const props = defineProps<{
  pipes: CsvPipe[]
  inlets: CsvInlet[]
  surveyPoints: SurveyPoint[]
  surveyLines: SurveyLine[]
  visible: boolean
  inletsVisible: boolean
  surveyPointsVisible: boolean
  surveyLinesVisible: boolean
  mode: 'view' | 'add-point' | 'connect'
  editingPointId: string | null
}>()

const emit = defineEmits<{
  (e: 'create-point', payload: { lat: number; lng: number; type: SurveyPointType }): void
  (e: 'point-click', id: string): void
  (e: 'update-point', payload: { id: string; patch: Partial<SurveyPoint> }): void
  (e: 'delete-point', id: string): void
  (e: 'close-editor'): void
  (e: 'create-line', payload: { fromId: SurveyEndpointId; toId: SurveyEndpointId }): void
  (e: 'remove-line', id: string): void
}>()

const mapRef = ref<HTMLDivElement | null>(null)
const loadError = ref('')
let AMapApi: any = null
let map: any = null
let tipWindow: any = null
let menuWindow: any = null

type LayerKey = 'pipe' | 'inlet' | 'point' | 'line' | 'arrow' | 'temp'
const layers: Record<LayerKey, any[]> = { pipe: [], inlet: [], point: [], line: [], arrow: [], temp: [] }
const pointMarkerMap = new Map<string, any>()

let connectPendingFrom: SurveyEndpointId | null = null
let connectPendingPosition: [number, number] | null = null
let connectTempLine: any = null
const SNAP_PX = 50

const PIPE_STYLE = { strokeColor: '#67c23a', strokeWeight: 3, strokeOpacity: 0.75, lineCap: 'round', lineJoin: 'round', zIndex: 300 }
const SURVEY_LINE_STYLE = { strokeColor: '#f56c6c', strokeWeight: 3, strokeOpacity: 0.9, lineCap: 'round', lineJoin: 'round', zIndex: 500 }
const TEMP_LINE_STYLE = { strokeColor: '#409eff', strokeWeight: 3, strokeOpacity: 0.85, strokeStyle: 'dashed', strokeDasharray: [4, 4], zIndex: 700 }

function contentElement(className: string, html: string) {
  const element = document.createElement('div')
  element.className = className
  element.innerHTML = html
  return element
}

function createMarker(position: [number, number], className: string, html: string, zIndex: number, clickable = true) {
  const content = contentElement(className, html)
  const item = new AMapApi.Marker({ position, content, anchor: 'center', zIndex, clickable, bubble: false })
  ;(item as any).__content = content
  return item
}

function pointIconHtml(point: SurveyPoint) {
  let svg = ''
  if (point.type === 'tee') {
    svg = '<line x1="14" y1="3" x2="14" y2="25" stroke="#303133" stroke-width="3"/><line x1="14" y1="14" x2="25" y2="14" stroke="#303133" stroke-width="3"/><circle cx="14" cy="14" r="3.5" fill="#fff" stroke="#303133" stroke-width="2"/>'
  } else if (point.type === 'elbow') {
    svg = '<line x1="14" y1="3" x2="14" y2="14" stroke="#303133" stroke-width="3"/><line x1="14" y1="14" x2="25" y2="14" stroke="#303133" stroke-width="3"/><circle cx="14" cy="14" r="3.5" fill="#fff" stroke="#303133" stroke-width="2"/>'
  } else {
    const fill = point.source === 'manual' ? '#409eff' : '#e6a23c'
    svg = `<circle cx="14" cy="14" r="5" fill="${fill}" stroke="#fff" stroke-width="2"/>`
  }
  const transform = point.type === 'straight' ? '' : `transform:rotate(${point.rotation}deg);transition:transform .15s`
  return `<div class="survey-point-icon" style="width:28px;height:28px"><svg width="28" height="28" viewBox="0 0 28 28" style="${transform}">${svg}</svg></div>`
}

function arrowHtml(angle: number) {
  return `<div style="transform:rotate(${angle}deg);transform-origin:50% 50%"><svg width="14" height="14" viewBox="0 0 14 14" style="overflow:visible"><path d="M 7 0 L 14 14 L 0 14 z" fill="#f56c6c" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg></div>`
}

function addLayer(kind: LayerKey, overlay: any) {
  layers[kind].push(overlay)
  map.add(overlay)
}

function clearLayer(kind: LayerKey) {
  if (layers[kind].length) map?.remove(layers[kind])
  layers[kind] = []
}

function toggleLayer(kind: LayerKey, visible: boolean) {
  layers[kind].forEach((overlay) => visible ? overlay.show() : overlay.hide())
}

function openTip(position: [number, number], html: string) {
  tipWindow?.setContent(`<div class="amap-business-tip">${html}</div>`)
  tipWindow?.open(map, position)
}

function bindTip(overlay: any, html: string) {
  overlay.on('mouseover', (event: any) => {
    const pos = event.lnglat ?? overlay.getPosition?.() ?? overlay.getBounds?.()?.getCenter?.()
    if (pos) openTip([pos.getLng(), pos.getLat()], html)
  })
  overlay.on('mouseout', () => tipWindow?.close())
}

function resolveEndpoint(id: SurveyEndpointId): [number, number] | null {
  if (id.startsWith('inlet:')) {
    const inlet = props.inlets.find((item) => item.fid === Number(id.slice(6)))
    return inlet ? [inlet.lng, inlet.lat] : null
  }
  const point = props.surveyPoints.find((item) => item.id === id.slice(6))
  return point ? [point.lng, point.lat] : null
}

function snapCandidates() {
  return [
    ...props.surveyPoints.map((point) => ({ id: `point:${point.id}` as SurveyEndpointId, position: [point.lng, point.lat] as [number, number] })),
    ...props.inlets.map((inlet) => ({ id: `inlet:${inlet.fid}` as SurveyEndpointId, position: [inlet.lng, inlet.lat] as [number, number] })),
  ]
}

function findSnap(
  position: [number, number],
  exclude: SurveyEndpointId | null,
): { id: SurveyEndpointId; position: [number, number]; distance: number } | null {
  if (!map) return null
  const mouse = map.lngLatToContainer(position)
  let best: { id: SurveyEndpointId; position: [number, number]; distance: number } | null = null
  for (const candidate of snapCandidates()) {
    if (candidate.id === exclude) continue
    const pixel = map.lngLatToContainer(candidate.position)
    const distance = Math.hypot(pixel.getX() - mouse.getX(), pixel.getY() - mouse.getY())
    if (distance <= SNAP_PX && (!best || distance < best.distance)) best = { ...candidate, distance }
  }
  return best
}

function renderPipes() {
  if (!map) return
  clearLayer('pipe')
  props.pipes.forEach((pipe) => {
    if (pipe.coords.length < 2) return
    const line = new AMapApi.Polyline({ path: pipe.coords, ...PIPE_STYLE })
    bindTip(line, `<b>${pipe.pipeno || `#${pipe.fid}`}</b><br>管材：${pipe.material || '—'}　外径：${pipe.diametero || '—'}mm<br>壁厚：${pipe.thickness || '—'}mm　长度：${pipe.length || '—'}m<br>压力：${pipe.pressured || '—'}`)
    addLayer('pipe', line)
  })
  toggleLayer('pipe', props.visible)
}

function handleEndpointClick(id: SurveyEndpointId, position: [number, number]) {
  if (props.mode !== 'connect') return
  if (!connectPendingFrom) setPending(id, position)
  else {
    if (id !== connectPendingFrom) emit('create-line', { fromId: connectPendingFrom, toId: id })
    clearPending()
  }
}

function renderInlets() {
  if (!map) return
  clearLayer('inlet')
  props.inlets.forEach((inlet) => {
    const item = createMarker([inlet.lng, inlet.lat], 'survey-inlet-marker', '<div style="background:#909399;color:#fff;border-radius:50%;width:14px;height:14px;border:1.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>', 420)
    item.on('click', (event: any) => {
      event.originEvent?.stopPropagation?.()
      handleEndpointClick(`inlet:${inlet.fid}`, [inlet.lng, inlet.lat])
    })
    bindTip(item, `<b>引入口 ${inlet.ecode}</b><br>压力：${inlet.pressured || '—'}<br>管号：${inlet.pipeno || '—'}`)
    addLayer('inlet', item)
  })
  toggleLayer('inlet', props.inletsVisible)
}

function renderSurveyPoints() {
  if (!map) return
  clearLayer('point')
  pointMarkerMap.clear()
  props.surveyPoints.forEach((point) => {
    const item = createMarker([point.lng, point.lat], `survey-point-marker source-${point.source || 'csv'}`, pointIconHtml(point), 650)
    item.on('click', (event: any) => {
      event.originEvent?.stopPropagation?.()
      if (props.mode === 'add-point') return
      if (props.mode === 'connect') handleEndpointClick(`point:${point.id}`, [point.lng, point.lat])
      else emit('point-click', point.id)
    })
    const type = point.type === 'tee' ? '三通' : point.type === 'elbow' ? '弯头' : '普通点位'
    bindTip(item, `<b>${point.id}</b> (${type}${point.type !== 'straight' ? ` ${point.rotation}°` : ''})<br>${point.depth !== undefined ? `埋深：${point.depth} m<br>` : ''}${point.current !== undefined ? `电流：${point.current}<br>` : ''}${point.note ? `备注：${point.note}` : ''}`)
    addLayer('point', item)
    pointMarkerMap.set(point.id, item)
  })
  toggleLayer('point', props.surveyPointsVisible)
}

function openLineMenu(line: SurveyLine, from: [number, number], to: [number, number]) {
  if (props.mode !== 'view') return
  const mid: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
  menuWindow.setContent(`<div class="survey-line-menu"><div class="survey-line-menu-title">${line.id}</div><div class="survey-line-menu-meta">${line.fromId} → ${line.toId}</div><button class="survey-line-menu-btn danger" data-line-action="remove" data-line-id="${line.id}"><span class="icon">🗑</span>删除该管线</button></div>`)
  menuWindow.open(map, mid)
}

function renderSurveyLines() {
  if (!map) return
  clearLayer('line')
  clearLayer('arrow')
  props.surveyLines.forEach((lineData) => {
    const from = resolveEndpoint(lineData.fromId)
    const to = resolveEndpoint(lineData.toId)
    if (!from || !to) return
    const line = new AMapApi.Polyline({ path: [from, to], ...SURVEY_LINE_STYLE, bubble: false })
    bindTip(line, `<b>${lineData.id}</b><br>${lineData.fromId} → ${lineData.toId}`)
    addLayer('line', line)
    // AMap Canvas 对 3px 细线的命中范围较小，增加透明宽热区提升点击可用性。
    const hitArea = new AMapApi.Polyline({
      path: [from, to],
      strokeColor: '#f56c6c',
      strokeWeight: 16,
      strokeOpacity: 0.01,
      zIndex: 510,
      cursor: 'pointer',
      bubble: false,
    })
    hitArea.on('click', (event: any) => {
      event.originEvent?.stopPropagation?.()
      openLineMenu(lineData, from, to)
    })
    bindTip(hitArea, `<b>${lineData.id}</b><br>${lineData.fromId} → ${lineData.toId}`)
    addLayer('line', hitArea)
    const mid: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
    const angle = Math.atan2(to[0] - from[0], to[1] - from[1]) * 180 / Math.PI
    const arrow = createMarker(mid, 'survey-line-arrow', arrowHtml(angle), 720, true)
    arrow.on('click', (event: any) => {
      event.originEvent?.stopPropagation?.()
      openLineMenu(lineData, from, to)
    })
    addLayer('arrow', arrow)
  })
  toggleLayer('line', props.surveyLinesVisible)
  toggleLayer('arrow', props.surveyLinesVisible)
}

function setPending(id: SurveyEndpointId, position: [number, number]) {
  clearLayer('temp')
  connectPendingFrom = id
  connectPendingPosition = position
  connectTempLine = new AMapApi.Polyline({ path: [position, position], ...TEMP_LINE_STYLE })
  addLayer('temp', connectTempLine)
}

function clearPending() {
  connectPendingFrom = null
  connectPendingPosition = null
  connectTempLine = null
  clearLayer('temp')
}

function handleConnectMapClick(position: [number, number]) {
  const hit = findSnap(position, null)
  if (!hit) {
    if (connectPendingFrom) clearPending()
    return
  }
  handleEndpointClick(hit.id, hit.position)
}

function showAddMenu(position: [number, number]) {
  const [lng, lat] = position
  menuWindow.setContent(`<div class="survey-add-menu"><div class="survey-add-menu-title">选择点位类型</div><button class="survey-add-menu-btn" data-type="tee" data-lat="${lat}" data-lng="${lng}"><span class="survey-add-menu-icon type-tee"></span>三通</button><button class="survey-add-menu-btn" data-type="elbow" data-lat="${lat}" data-lng="${lng}"><span class="survey-add-menu-icon type-elbow"></span>弯头</button><button class="survey-add-menu-btn" data-type="straight" data-lat="${lat}" data-lng="${lng}"><span class="survey-add-menu-icon type-straight"></span>普通</button></div>`)
  menuWindow.open(map, position)
}

function handleMapClick(event: any) {
  // 自定义 Marker 的 DOM 点击也会到达地图；端点由 Marker 自己处理，这里必须跳过。
  const target = event.originEvent?.target as HTMLElement | undefined
  if (target?.closest?.('.survey-point-marker, .survey-inlet-marker')) return
  const position: [number, number] = [event.lnglat.getLng(), event.lnglat.getLat()]
  if (props.mode === 'add-point') showAddMenu(position)
  else if (props.mode === 'connect') handleConnectMapClick(position)
  else menuWindow?.close()
}

function handleMouseMove(event: any) {
  if (props.mode !== 'connect' || !connectPendingFrom || !connectPendingPosition || !connectTempLine) return
  const position: [number, number] = [event.lnglat.getLng(), event.lnglat.getLat()]
  const snap = findSnap(position, connectPendingFrom)
  connectTempLine.setPath([connectPendingPosition, snap?.position ?? position])
}

function onDocumentClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  const addButton = target.closest('.survey-add-menu-btn') as HTMLElement | null
  if (addButton) {
    const type = addButton.dataset.type as SurveyPointType
    const lat = Number(addButton.dataset.lat)
    const lng = Number(addButton.dataset.lng)
    if (Number.isFinite(lat) && Number.isFinite(lng)) emit('create-point', { lat, lng, type })
    menuWindow?.close()
    return
  }
  const lineButton = target.closest('.survey-line-menu-btn') as HTMLElement | null
  if (lineButton?.dataset.lineAction === 'remove' && lineButton.dataset.lineId) {
    emit('remove-line', lineButton.dataset.lineId)
    menuWindow?.close()
  }
}

function fitToAll() {
  if (!map) return
  const candidates = [...layers.pipe, ...layers.point, ...layers.line]
  if (!candidates.length) return
  map.setFitView(candidates, false, [60, 60, 60, 60], 20)
  window.setTimeout(() => { if (map && map.getZoom() < 18) map.setZoom(18) }, 300)
}

const editingPoint = computed(() => props.editingPointId ? props.surveyPoints.find((point) => point.id === props.editingPointId) ?? null : null)
const editForm = reactive<{ type: SurveyPointType; rotation: number; depth: number | null; current: number | null; note: string }>({ type: 'straight', rotation: 0, depth: null, current: null, note: '' })

watch(() => props.editingPointId, (id) => {
  const point = id ? props.surveyPoints.find((item) => item.id === id) : null
  if (!point) return
  editForm.type = point.type
  editForm.rotation = point.rotation
  editForm.depth = point.depth ?? null
  editForm.current = point.current ?? null
  editForm.note = point.note ?? ''
})
watch(() => editForm.type, (type) => { if (type === 'straight') editForm.rotation = 0 })
watch(() => editForm.rotation, (rotation) => {
  const point = editingPoint.value
  const item = point ? pointMarkerMap.get(point.id) : null
  const element = item ? (item as any).__content as HTMLElement : null
  if (point && element) element.innerHTML = pointIconHtml({ ...point, rotation })
})

function saveEdit() {
  if (!props.editingPointId) return
  emit('update-point', { id: props.editingPointId, patch: { type: editForm.type, rotation: editForm.type === 'straight' ? 0 : editForm.rotation, depth: editForm.depth ?? undefined, current: editForm.current ?? undefined, note: editForm.note || undefined } })
  emit('close-editor')
}
function deleteEdit() {
  if (!props.editingPointId || !confirm(`确认删除 ${props.editingPointId} ?`)) return
  emit('delete-point', props.editingPointId)
  emit('close-editor')
}
function closeEdit() { emit('close-editor') }

const mapContainerClass = computed(() => props.mode === 'add-point' ? 'mode-add-point' : props.mode === 'connect' ? 'mode-connect' : '')

onMounted(async () => {
  if (!mapRef.value) return
  try {
    AMapApi = await loadAMap()
    map = new AMapApi.Map(mapRef.value, { viewMode: '2D', zoom: 18, zooms: [3, 20], center: [116.497, 39.763], resizeEnable: true, animateEnable: true, jogEnable: false })
    tipWindow = new AMapApi.InfoWindow({ isCustom: true, offset: new AMapApi.Pixel(0, -10), autoMove: false })
    menuWindow = new AMapApi.InfoWindow({ isCustom: false, offset: new AMapApi.Pixel(0, -8), closeWhenClickMap: false })
    map.on('click', handleMapClick)
    map.on('mousemove', handleMouseMove)
    document.addEventListener('click', onDocumentClick)
    renderPipes()
    renderInlets()
    renderSurveyPoints()
    renderSurveyLines()
    fitToAll()
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '高德勘测地图加载失败'
    ElMessage.error(loadError.value)
  }
})

watch(() => props.pipes, () => { renderPipes(); fitToAll() }, { deep: false })
watch(() => props.inlets, renderInlets, { deep: false })
watch(() => props.surveyPoints, () => { renderSurveyPoints(); renderSurveyLines() }, { deep: false })
watch(() => props.surveyLines, renderSurveyLines, { deep: false })
watch(() => props.visible, (value) => toggleLayer('pipe', value))
watch(() => props.inletsVisible, (value) => toggleLayer('inlet', value))
watch(() => props.surveyPointsVisible, (value) => toggleLayer('point', value))
watch(() => props.surveyLinesVisible, (value) => { toggleLayer('line', value); toggleLayer('arrow', value) })
watch(() => props.mode, (mode) => { menuWindow?.close(); if (mode !== 'connect') clearPending() })

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  map?.off('click', handleMapClick)
  map?.off('mousemove', handleMouseMove)
  tipWindow?.close()
  menuWindow?.close()
  map?.destroy()
  map = null
  AMapApi = null
})
</script>

<template>
  <div class="survey-map-wrapper" :class="mapContainerClass">
    <div ref="mapRef" id="map"></div>
    <div v-if="loadError" class="amap-map-state amap-map-error"><strong>地图加载失败</strong><span>{{ loadError }}</span></div>

    <Transition name="slide-right">
      <div v-if="editingPoint" class="survey-editor-panel">
        <div class="survey-editor-header">
          <span class="survey-editor-id">{{ editingPoint.id }}</span>
          <button class="survey-editor-close" @click="closeEdit" title="关闭">×</button>
        </div>
        <div class="survey-editor-body">
          <div class="survey-editor-row">
            <label class="survey-editor-label">类型</label>
            <el-radio-group v-model="editForm.type" size="small">
              <el-radio-button value="tee">三通</el-radio-button>
              <el-radio-button value="elbow">弯头</el-radio-button>
              <el-radio-button value="straight">普通</el-radio-button>
            </el-radio-group>
          </div>
          <div v-if="editForm.type !== 'straight'" class="survey-editor-row">
            <label class="survey-editor-label">旋转角度</label>
            <div class="survey-rotation-row">
              <el-slider v-model="editForm.rotation" :min="0" :max="359" :step="1" :show-input="true" :show-input-controls="false" input-size="small" style="flex:1" />
              <div class="survey-rotation-num">{{ editForm.rotation }}°</div>
            </div>
            <div class="survey-rotation-presets">
              <button v-for="deg in [0,45,90,135,180,225,270,315]" :key="deg" class="survey-rotation-preset" :class="{ active: editForm.rotation === deg }" @click="editForm.rotation = deg">{{ deg }}°</button>
            </div>
            <div class="survey-editor-hint">拖动滑块实时预览,或点下方常用角度</div>
          </div>
          <div class="survey-editor-row"><label class="survey-editor-label">埋深(米)</label><el-input-number v-model="editForm.depth" :min="0" :step="0.1" :precision="2" size="small" style="width:100%" /></div>
          <div class="survey-editor-row"><label class="survey-editor-label">电流</label><el-input-number v-model="editForm.current" :step="0.1" :precision="3" size="small" style="width:100%" /></div>
          <div class="survey-editor-row"><label class="survey-editor-label">备注</label><el-input v-model="editForm.note" type="textarea" :rows="2" size="small" /></div>
          <div class="survey-editor-coords">经度 {{ editingPoint.lng.toFixed(6) }}<br>纬度 {{ editingPoint.lat.toFixed(6) }}</div>
        </div>
        <div class="survey-editor-footer">
          <el-button size="small" type="danger" @click="deleteEdit">删除</el-button>
          <el-button size="small" @click="closeEdit">取消</el-button>
          <el-button size="small" type="primary" @click="saveEdit">保存</el-button>
        </div>
      </div>
    </Transition>
  </div>
</template>
