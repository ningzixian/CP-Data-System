<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { loadAMap } from '@/map/amap-loader'
import { escapeHtml as e } from '@/utils/html'
import {
  addSurveyPhotos,
  deleteSurveyPhoto,
  deleteSurveyPhotos,
  listSurveyPhotos,
  type SurveyPhotoRecord,
} from '@/utils/surveyPhotos'
import type { CsvInlet, CsvJoint, CsvPipe, CsvRegulator } from '@/utils/facilities'
import type { CorrosionUnit } from '@/types/models'
import type { SurveyBox, SurveyEndpointId, SurveyLine, SurveyPoint, SurveyPointType } from '@/types/survey'

const props = defineProps<{
  pipes: CsvPipe[]
  inlets: CsvInlet[]
  units: CorrosionUnit[]
  joints: CsvJoint[]
  regulators: CsvRegulator[]
  surveyPoints: SurveyPoint[]
  surveyLines: SurveyLine[]
  surveyBoxes: SurveyBox[]
  visible: boolean
  inletsVisible: boolean
  unitsVisible: boolean
  jointsVisible: boolean
  regulatorsVisible: boolean
  surveyPointsVisible: boolean
  surveyLinesVisible: boolean
  mode: 'view' | 'add-point' | 'connect' | 'edit' | 'box'
  editingPointId: string | null
}>()

const emit = defineEmits<{
  (e: 'create-point', payload: { lat: number; lng: number; type: SurveyPointType }): void
  (e: 'point-click', id: string): void
  (e: 'clear-point-selection'): void
  (e: 'update-point', payload: { id: string; patch: Partial<SurveyPoint> }): void
  (e: 'delete-point', id: string): void
  (e: 'close-editor'): void
  (e: 'create-line', payload: { fromId: SurveyEndpointId; toId: SurveyEndpointId }): void
  (e: 'remove-line', id: string): void
  (e: 'create-box', bounds: Omit<SurveyBox, 'id' | 'createdAt'>): void
  (e: 'update-box', payload: { id: string; bounds: Omit<SurveyBox, 'id' | 'createdAt'> }): void
  (e: 'update-box-note', payload: { id: string; note: string }): void
  (e: 'remove-box', id: string): void
}>()

const mapRef = ref<HTMLDivElement | null>(null)
const loadError = ref('')
let AMapApi: any = null
let map: any = null
let tipWindow: any = null
let menuWindow: any = null

type LayerKey = 'unit' | 'pipe' | 'joint' | 'regulator' | 'inlet' | 'point' | 'line' | 'arrow' | 'box' | 'temp'
const layers: Record<LayerKey, any[]> = {
  unit: [], pipe: [], joint: [], regulator: [], inlet: [], point: [], line: [], arrow: [], box: [], temp: [],
}
const pointMarkerMap = new Map<string, any>()
const unitPolygonMap = new Map<number, any>()
const boxOverlayMap = new Map<string, any>()
let focusedPointId: string | null = null
let selectedUnitId: number | null = null
let selectedBoxId: string | null = null
let boxDeleteEnableSequence = 0
type SelectableFacilityKind = 'pipe' | 'joint' | 'regulator' | 'inlet'
let selectedFacility: { kind: SelectableFacilityKind; overlay: any; element?: HTMLElement } | null = null

function currentMapStyle() {
  return document.documentElement.classList.contains('dark') ? 'amap://styles/darkblue' : 'amap://styles/normal'
}

function handleThemeChange() {
  map?.setMapStyle?.(currentMapStyle())
}
let suppressNextMapClear = false

let connectPendingFrom: SurveyEndpointId | null = null
let connectPendingPosition: [number, number] | null = null
let connectTempLine: any = null
let suppressPointClickUntil = 0
const SNAP_PX = 50
const FACILITY_FOCUS_ZOOM = 19

const PIPE_STYLE = { strokeColor: '#67c23a', strokeWeight: 3, strokeOpacity: 0.75, lineCap: 'round', lineJoin: 'round', zIndex: 300 }
const PIPE_ACTIVE_STYLE = { strokeColor: '#8B4513', strokeWeight: 6, strokeOpacity: 1, zIndex: 810 }
const SURVEY_LINE_STYLE = { strokeColor: '#e6c800', strokeWeight: 4, strokeOpacity: 1, lineCap: 'round', lineJoin: 'round', zIndex: 500 }
const TEMP_LINE_STYLE = { strokeColor: '#409eff', strokeWeight: 3, strokeOpacity: 0.85, strokeStyle: 'dashed', strokeDasharray: [4, 4], zIndex: 700 }
const SURVEY_BOX_STYLE = { strokeColor: '#ff0000', strokeWeight: 2, strokeOpacity: 1, strokeStyle: 'dashed', strokeDasharray: [8, 6], fillColor: '#ff0000', fillOpacity: 0.05, zIndex: 490 }
const SURVEY_BOX_SELECTED_STYLE = { ...SURVEY_BOX_STYLE, strokeWeight: 4, fillOpacity: 0.1, zIndex: 740 }
const SURVEY_ARROW_SIZE_PX = 14
const SURVEY_ARROW_MIN_LINE_LENGTH_PX = SURVEY_ARROW_SIZE_PX + 4

function contentElement(className: string, html: string) {
  const element = document.createElement('div')
  element.className = className
  element.innerHTML = html
  return element
}

function createMarker(position: [number, number], className: string, html: string, zIndex: number, clickable = true, draggable = false) {
  const content = contentElement(className, html)
  // AMap 自定义 Marker 的按下事件会继续落到地图画布，短点击可能让地图残留在拖拽状态。
  // 只拦截拖拽起始事件，click 仍交给 Marker 的 AMap 事件处理。
  const stopMapDrag = (event: Event) => event.stopPropagation()
  if (!draggable) {
    content.addEventListener('pointerdown', stopMapDrag)
    content.addEventListener('mousedown', stopMapDrag)
    content.addEventListener('touchstart', stopMapDrag, { passive: true })
  }
  const item = new AMapApi.Marker({ position, content, anchor: 'center', zIndex, clickable, draggable, cursor: 'pointer', bubble: false })
  ;(item as any).__content = content
  ;(item as any).__baseZIndex = zIndex
  return item
}

function pointIconHtml(point: SurveyPoint) {
  let svg = ''
  if (point.type === 'tee') {
    svg = '<line x1="14" y1="3" x2="14" y2="25" stroke="#303133" stroke-width="3"/><line x1="14" y1="14" x2="25" y2="14" stroke="#303133" stroke-width="3"/><circle cx="14" cy="14" r="3.5" fill="#fff" stroke="#303133" stroke-width="2"/>'
  } else if (point.type === 'elbow') {
    svg = '<line x1="14" y1="3" x2="14" y2="14" stroke="#303133" stroke-width="3"/><line x1="14" y1="14" x2="25" y2="14" stroke="#303133" stroke-width="3"/><circle cx="14" cy="14" r="3.5" fill="#fff" stroke="#303133" stroke-width="2"/>'
  } else if (point.type === 'joint') {
    svg = '<line x1="7" y1="7" x2="21" y2="21" stroke="#f56c6c" stroke-width="4" stroke-linecap="round"/><line x1="21" y1="7" x2="7" y2="21" stroke="#f56c6c" stroke-width="4" stroke-linecap="round"/><circle cx="14" cy="14" r="3" fill="#fff" stroke="#f56c6c" stroke-width="2"/>'
  } else if (point.type === 'inlet') {
    svg = '<path d="M14 5 L23 14 L14 23 L5 14 Z" fill="#16a085" stroke="#fff" stroke-width="1.5"/>'
  } else {
    const fill = point.source === 'manual' ? '#409eff' : '#e6a23c'
    svg = `<circle cx="14" cy="14" r="5" fill="${fill}" stroke="#fff" stroke-width="2"/>`
  }
  const transform = point.type === 'tee' || point.type === 'elbow' ? `transform:rotate(${point.rotation}deg);transition:transform .15s` : ''
  return `<div class="survey-point-icon" style="width:28px;height:28px"><svg width="28" height="28" viewBox="0 0 28 28" style="${transform}">${svg}</svg></div>`
}

function arrowHtml(angle: number) {
  return `<div style="transform:rotate(${angle}deg);transform-origin:50% 50%"><svg width="${SURVEY_ARROW_SIZE_PX}" height="${SURVEY_ARROW_SIZE_PX}" viewBox="0 0 14 14" style="overflow:visible"><path d="M 7 0 L 14 14 L 0 14 z" fill="#e6c800" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg></div>`
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

let pinnedSurveyPointId: string | null = null

function bindTip(overlay: any, html: string) {
  overlay.on('mouseover', (event: any) => {
    if (props.mode !== 'view' || pinnedSurveyPointId) return
    const pos = event.lnglat ?? overlay.getPosition?.() ?? overlay.getBounds?.()?.getCenter?.()
    if (pos) openTip([pos.getLng(), pos.getLat()], html)
  })
  overlay.on('mouseout', () => { if (!pinnedSurveyPointId) tipWindow?.close() })
}

let hoverPhotoLoadSequence = 0
let hoverPhotoUrls: string[] = []

function releaseHoverPhotoUrls() {
  hoverPhotoUrls.forEach((url) => URL.revokeObjectURL(url))
  hoverPhotoUrls = []
}

function surveyPointTipHtml(point: SurveyPoint, photoContent: string, pinned = false): string {
  const type = point.type === 'tee' ? '三通' : point.type === 'elbow' ? '弯头' : point.type === 'joint' ? '绝缘接头' : point.type === 'inlet' ? '引入口' : '普通点位'
  const note = point.note?.trim()
  const noteHtml = note ? `<div class="survey-point-hover-note"><span>备注</span><strong>${e(note)}</strong></div>` : ''
  return `<div class="survey-point-hover-card${pinned ? ' is-pinned' : ''}"><div class="survey-point-hover-main"><div class="survey-point-hover-title">${e(point.id)}</div><div class="survey-point-hover-type">${type}</div><div class="survey-point-hover-data"><span>埋深</span><strong>${point.depth !== undefined ? `${e(point.depth)} m` : '未记录'}</strong><span>电流</span><strong>${point.current !== undefined ? `${e(point.current)} mA` : '未记录'}</strong></div>${noteHtml}</div>${photoContent}</div>`
}

function emptyHoverPhotoHtml(message: string): string {
  return `<div class="survey-point-hover-photo"><div class="survey-point-hover-photo-icon">▧</div><span>照片留痕</span><small>${e(message)}</small></div>`
}

async function showSurveyPointTip(point: SurveyPoint, position: [number, number], pinned = false) {
  const sequence = ++hoverPhotoLoadSequence
  releaseHoverPhotoUrls()
  if (pinned) pinnedSurveyPointId = point.id
  openTip(position, surveyPointTipHtml(point, emptyHoverPhotoHtml('正在读取照片…'), pinned))
  try {
    const photos = await listSurveyPhotos(photoOwnerKey(point))
    if (sequence !== hoverPhotoLoadSequence) return
    if (photos.length === 0) {
      openTip(position, surveyPointTipHtml(point, emptyHoverPhotoHtml('暂无照片'), pinned))
      return
    }
    const previewPhotos = photos.slice(0, 4).map((photo) => {
      const url = URL.createObjectURL(photo.blob)
      hoverPhotoUrls.push(url)
      return `<button type="button" class="survey-point-hover-image" data-photo-url="${e(url)}"><img class="survey-point-hover-thumb" src="${e(url)}" alt="${e(photo.name)}"><img class="survey-point-hover-zoom" src="${e(url)}" alt="" aria-hidden="true"></button>`
    }).join('')
    const photoContent = `<div class="survey-point-hover-photo has-photos"><div class="survey-point-hover-photo-grid photo-count-${previewPhotos.length}">${previewPhotos}</div></div>`
    openTip(position, surveyPointTipHtml(point, photoContent, pinned))
  } catch (error) {
    if (sequence === hoverPhotoLoadSequence) {
      openTip(position, surveyPointTipHtml(point, emptyHoverPhotoHtml('照片读取失败'), pinned))
    }
    console.warn('[Survey] 点位照片读取失败：', error)
  }
}

function clearPinnedSurveyPointTip() {
  pinnedSurveyPointId = null
  hoverPhotoLoadSequence++
  releaseHoverPhotoUrls()
  tipWindow?.close()
}

function clearSurveyPointSelection() {
  clearPinnedSurveyPointTip()
  markFocusedPoint(null)
  emit('clear-point-selection')
}

function bindSurveyPointTip(overlay: any, point: SurveyPoint) {
  overlay.on('mouseover', (event: any) => {
    const pos = event.lnglat ?? overlay.getPosition?.()
    if (!pos) return
    const position: [number, number] = [pos.getLng(), pos.getLat()]
    if (props.mode === 'view') {
      if (pinnedSurveyPointId) return
      void showSurveyPointTip(point, position)
    } else if (props.mode === 'edit' || props.mode === 'connect') {
      openTip(position, `<div class="survey-point-id-tip">${e(point.id)}</div>`)
    }
  })
  overlay.on('mouseout', () => {
    if (pinnedSurveyPointId) return
    hoverPhotoLoadSequence++
    releaseHoverPhotoUrls()
    tipWindow?.close()
  })
}

function restoreMapDrag() {
  map?.setStatus?.({ dragEnable: true })
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
    bindSelectableFacility('pipe', line, `<b>${e(pipe.pipeno || `#${pipe.fid}`)}</b><br>管材：${e(pipe.material || '—')} | 外径：${e(pipe.diametero || '—')}mm<br>壁厚：${e(pipe.thickness || '—')}mm | 长度：${e(pipe.length || '—')}m<br>压力：${e(pipe.pressured || '—')}`)
    addLayer('pipe', line)
  })
  toggleLayer('pipe', props.visible)
}

function clearFacilitySelection() {
  if (!selectedFacility) return
  if (selectedFacility.kind === 'pipe') selectedFacility.overlay.setOptions(PIPE_STYLE)
  else {
    selectedFacility.element?.classList.remove('selected', 'hovered')
    selectedFacility.overlay.setzIndex?.((selectedFacility.overlay as any).__baseZIndex ?? 500)
  }
  selectedFacility = null
}

function focusFacility(overlay: any) {
  const position = overlay.getPosition?.() ?? overlay.getBounds?.()?.getCenter?.()
  if (position) map.setZoomAndCenter(FACILITY_FOCUS_ZOOM, position, false, 500)
}

function preventImmediateMapClear() {
  suppressNextMapClear = true
  window.setTimeout(() => { suppressNextMapClear = false }, 0)
}

function bindSelectableFacility(kind: SelectableFacilityKind, overlay: any, html: string) {
  const element = (overlay as any).__content as HTMLElement | undefined
  overlay.on('mouseover', (event: any) => {
    if (kind === 'pipe') overlay.setOptions(PIPE_ACTIVE_STYLE)
    else {
      element?.classList.add('hovered')
      overlay.setzIndex?.(810)
    }
    if (props.mode !== 'view' || pinnedSurveyPointId) return
    const pos = event.lnglat ?? overlay.getPosition?.() ?? overlay.getBounds?.()?.getCenter?.()
    if (pos) openTip([pos.getLng(), pos.getLat()], html)
  })
  overlay.on('mouseout', () => {
    if (selectedFacility?.overlay !== overlay) {
      if (kind === 'pipe') overlay.setOptions(PIPE_STYLE)
      else {
        element?.classList.remove('hovered')
        overlay.setzIndex?.((overlay as any).__baseZIndex ?? 500)
      }
    }
    if (!pinnedSurveyPointId) tipWindow?.close()
  })
  const select = () => {
    if (props.mode !== 'view') return
    preventImmediateMapClear()
    clearSurveyPointSelection()
    if (selectedFacility?.overlay === overlay) {
      clearFacilitySelection()
      return
    }
    clearFacilitySelection()
    selectedUnitId = null
    syncUnitSelection()
    if (kind === 'pipe') overlay.setOptions(PIPE_ACTIVE_STYLE)
    else {
      element?.classList.add('selected')
      overlay.setzIndex?.(820)
    }
    selectedFacility = { kind, overlay, element }
    focusFacility(overlay)
  }
  // 自定义 Marker 的 DOM 事件可能不会继续触发高德 Marker.click，直接绑定内容节点。
  if (element) {
    element.addEventListener('click', (event) => {
      event.stopPropagation()
      select()
    })
  } else {
    overlay.on('click', select)
  }
}

const UNIT_DEFAULT_STYLE = { strokeColor: '#67c23a', strokeWeight: 2, strokeOpacity: 0.9, fillColor: '#67c23a', fillOpacity: 0.12, strokeStyle: 'dashed', zIndex: 300 }
const UNIT_HOVER_STYLE = { strokeColor: '#409eff', strokeWeight: 3, strokeOpacity: 1, fillColor: '#409eff', fillOpacity: 0.25, strokeStyle: 'solid', zIndex: 300 }
const UNIT_SELECTED_STYLE = { strokeColor: '#7c3aed', strokeWeight: 3, strokeOpacity: 1, fillColor: '#7c3aed', fillOpacity: 0.28, strokeStyle: 'solid', zIndex: 300 }

function syncUnitSelection() {
  unitPolygonMap.forEach((polygon, id) => {
    polygon.setOptions(id === selectedUnitId ? UNIT_SELECTED_STYLE : UNIT_DEFAULT_STYLE)
  })
}

function renderUnits() {
  if (!map) return
  clearLayer('unit')
  unitPolygonMap.clear()
  props.units.forEach((unit) => {
    const path = unit.polyline?.map(([lat, lng]) => [lng, lat] as [number, number]) ?? []
    if (path.length < 3) return
    const polygon = new AMapApi.Polygon({ path, ...UNIT_DEFAULT_STYLE, bubble: true })
    polygon.on('mouseover', () => {
      if (selectedUnitId !== unit.id) polygon.setOptions(UNIT_HOVER_STYLE)
    })
    polygon.on('mouseout', syncUnitSelection)
    polygon.on('click', () => {
      if (props.mode !== 'view') return
      preventImmediateMapClear()
      clearSurveyPointSelection()
      clearFacilitySelection()
      selectedUnitId = selectedUnitId === unit.id ? null : unit.id
      syncUnitSelection()
      if (selectedUnitId === unit.id) focusFacility(polygon)
    })
    bindTip(polygon, `<b>控制单元 ${e(unit.name)}</b><br>${e(unit.address || '')}`)
    unitPolygonMap.set(unit.id, polygon)
    addLayer('unit', polygon)
  })
  syncUnitSelection()
  toggleLayer('unit', props.unitsVisible)
}

function renderJoints() {
  if (!map) return
  clearLayer('joint')
  props.joints.forEach((joint) => {
    const item = createMarker(
      [joint.lng, joint.lat],
      'joint-marker amap-facility-marker',
      '<div class="facility-anim"><div style="color:#f56c6c;font-size:22px;font-weight:900;line-height:22px;text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 3px #fff;font-family:Arial">✕</div></div>',
      520,
    )
    bindSelectableFacility('joint', item, `<b>绝缘接头 ${e(joint.ecode)}</b><br>压力：${e(joint.pressured || '—')}<br>管号：${e(joint.pipeno || '—')}`)
    addLayer('joint', item)
  })
  toggleLayer('joint', props.jointsVisible)
}

function renderRegulators() {
  if (!map) return
  clearLayer('regulator')
  props.regulators.forEach((regulator) => {
    const item = createMarker(
      [regulator.lng, regulator.lat],
      'regulator-marker amap-facility-marker',
      '<div class="facility-anim"><div style="background:#1890ff;color:#fff;border-radius:4px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);font-weight:700;font-size:14px">调</div></div>',
      510,
    )
    bindSelectableFacility('regulator', item, `<b>调压箱 ${e(regulator.name || regulator.ecode)}</b><br>编码：${e(regulator.ecode)}<br>压力：${e(regulator.pressured || '—')}`)
    addLayer('regulator', item)
  })
  toggleLayer('regulator', props.regulatorsVisible)
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
    const item = createMarker([inlet.lng, inlet.lat], 'inlet-marker amap-facility-marker survey-inlet-marker', '<div class="facility-anim"><div style="background:#909399;color:#fff;border-radius:50%;width:14px;height:14px;border:1.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div></div>', 500)
    ;((item as any).__content as HTMLElement).addEventListener('click', (event) => {
      event.stopPropagation()
      handleEndpointClick(`inlet:${inlet.fid}`, [inlet.lng, inlet.lat])
    })
    bindSelectableFacility('inlet', item, `<b>引入口 ${e(inlet.ecode)}</b><br>压力：${e(inlet.pressured || '—')}<br>管号：${e(inlet.pipeno || '—')}`)
    addLayer('inlet', item)
  })
  toggleLayer('inlet', props.inletsVisible)
}

function renderSurveyPoints() {
  if (!map) return
  hoverPhotoLoadSequence++
  releaseHoverPhotoUrls()
  clearLayer('point')
  pointMarkerMap.clear()
  props.surveyPoints.forEach((point) => {
    const draggable = props.mode === 'edit'
    const baseZIndex = point.type === 'inlet' ? 640 : point.type === 'tee' || point.type === 'elbow' ? 660 : 650
    const item = createMarker([point.lng, point.lat], `survey-point-marker source-${point.source || 'csv'}${draggable ? ' is-draggable' : ''}`, pointIconHtml(point), baseZIndex, true, draggable)
    ;((item as any).__content as HTMLElement).addEventListener('click', (event) => {
      event.stopPropagation()
      if (props.mode === 'add-point' || props.mode === 'box') return
      if (props.mode === 'edit') {
        if (performance.now() >= suppressPointClickUntil) emit('point-click', point.id)
        return
      }
      if (props.mode === 'connect') handleEndpointClick(`point:${point.id}`, [point.lng, point.lat])
      else emit('point-click', point.id)
    })
    if (draggable) {
      item.on('dragstart', () => {
        ;((item as any).__content as HTMLElement | undefined)?.classList.add('is-dragging')
        tipWindow?.close()
        menuWindow?.close()
      })
      item.on('dragend', (event: any) => {
        ;((item as any).__content as HTMLElement | undefined)?.classList.remove('is-dragging')
        const position = event.lnglat ?? item.getPosition?.()
        if (!position) return
        // 拖动结束后浏览器可能补发 click，短暂抑制，避免误开编辑卡片。
        suppressPointClickUntil = performance.now() + 350
        emit('update-point', {
          id: point.id,
          patch: { lng: position.getLng(), lat: position.getLat() },
        })
      })
    }
    bindSurveyPointTip(item, point)
    addLayer('point', item)
    pointMarkerMap.set(point.id, item)
  })
  markFocusedPoint(focusedPointId)
  toggleLayer('point', props.surveyPointsVisible)
}

function openLineMenu(line: SurveyLine, from: [number, number], to: [number, number]) {
  if (props.mode !== 'edit') return
  const mid: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
  menuWindow.setContent(`<div class="survey-line-menu"><div class="survey-line-menu-title">${e(line.id)}</div><div class="survey-line-menu-meta">${e(line.fromId)} → ${e(line.toId)}</div><button class="survey-line-menu-btn danger" data-line-action="remove" data-line-id="${e(line.id)}"><span class="icon">🗑</span>删除该管线</button></div>`)
  menuWindow.open(map, mid)
}

type LineHit = { line: SurveyLine; from: [number, number]; to: [number, number] }
let linePointerGesture: {
  pointerId: number
  startX: number
  startY: number
  hit: LineHit
} | null = null
let boxPointerGesture: {
  pointerId: number
  startX: number
  startY: number
  currentX: number
  currentY: number
  start: [number, number]
  current: [number, number]
  preview: any
} | null = null
let boxMoveGesture: {
  pointerId: number
  startX: number
  startY: number
  currentX: number
  currentY: number
  start: [number, number]
  current: [number, number]
  box: SurveyBox
  overlay: any
} | null = null
type BoxResizeHandle = 'north' | 'south' | 'west' | 'east' | 'north-west' | 'north-east' | 'south-west' | 'south-east'
let boxResizeGesture: {
  pointerId: number
  startX: number
  startY: number
  currentX: number
  currentY: number
  current: [number, number]
  box: SurveyBox
  overlay: any
  handle: BoxResizeHandle
} | null = null
let suppressLineClickUntil = 0

function pointToSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay)
  const ratio = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + ratio * dx), py - (ay + ratio * dy))
}

/** 在 AMap 收到 pointerdown 之前，用屏幕坐标判断是否按中了勘测线。 */
function findLineAtClientPoint(clientX: number, clientY: number): LineHit | null {
  if (!map || !mapRef.value || !props.surveyLinesVisible) return null
  const rect = mapRef.value.getBoundingClientRect()
  const x = clientX - rect.left
  const y = clientY - rect.top
  let nearest: { distance: number; hit: LineHit } | null = null
  for (const line of props.surveyLines) {
    const from = resolveEndpoint(line.fromId)
    const to = resolveEndpoint(line.toId)
    if (!from || !to) continue
    const a = map.lngLatToContainer(from)
    const b = map.lngLatToContainer(to)
    const distance = pointToSegmentDistance(x, y, a.getX(), a.getY(), b.getX(), b.getY())
    if (distance <= 10 && (!nearest || distance < nearest.distance)) {
      nearest = { distance, hit: { line, from, to } }
    }
  }
  return nearest?.hit ?? null
}

function stopLinePointerEvent(event: PointerEvent) {
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}

function findBoxAtClientPoint(clientX: number, clientY: number, borderOnly = false): { box: SurveyBox; overlay: any } | null {
  if (!map || !mapRef.value) return null
  const rect = mapRef.value.getBoundingClientRect()
  const x = clientX - rect.left
  const y = clientY - rect.top
  for (let index = props.surveyBoxes.length - 1; index >= 0; index--) {
    const box = props.surveyBoxes[index]
    const overlay = boxOverlayMap.get(box.id)
    if (!overlay) continue
    const cornerA = map.lngLatToContainer([box.west, box.south])
    const cornerB = map.lngLatToContainer([box.east, box.north])
    const left = Math.min(cornerA.getX(), cornerB.getX())
    const right = Math.max(cornerA.getX(), cornerB.getX())
    const top = Math.min(cornerA.getY(), cornerB.getY())
    const bottom = Math.max(cornerA.getY(), cornerB.getY())
    if (x < left - 10 || x > right + 10 || y < top - 10 || y > bottom + 10) continue
    const borderDistance = Math.min(Math.abs(x - left), Math.abs(x - right), Math.abs(y - top), Math.abs(y - bottom))
    if (!borderOnly || borderDistance <= 10) return { box, overlay }
  }
  return null
}

function findSelectedBoxResizeHandle(clientX: number, clientY: number): { box: SurveyBox; overlay: any; handle: BoxResizeHandle } | null {
  if (!map || !mapRef.value || !selectedBoxId) return null
  const box = props.surveyBoxes.find((item) => item.id === selectedBoxId)
  const overlay = box ? boxOverlayMap.get(box.id) : null
  if (!box || !overlay) return null
  const rect = mapRef.value.getBoundingClientRect()
  const x = clientX - rect.left
  const y = clientY - rect.top
  const cornerA = map.lngLatToContainer([box.west, box.south])
  const cornerB = map.lngLatToContainer([box.east, box.north])
  const left = Math.min(cornerA.getX(), cornerB.getX())
  const right = Math.max(cornerA.getX(), cornerB.getX())
  const top = Math.min(cornerA.getY(), cornerB.getY())
  const bottom = Math.max(cornerA.getY(), cornerB.getY())
  const tolerance = 10
  if (x < left - tolerance || x > right + tolerance || y < top - tolerance || y > bottom + tolerance) return null
  const nearWest = Math.abs(x - left) <= tolerance
  const nearEast = Math.abs(x - right) <= tolerance
  const nearNorth = Math.abs(y - top) <= tolerance
  const nearSouth = Math.abs(y - bottom) <= tolerance
  const handle: BoxResizeHandle | null = nearWest && nearNorth ? 'north-west'
    : nearEast && nearNorth ? 'north-east'
      : nearWest && nearSouth ? 'south-west'
        : nearEast && nearSouth ? 'south-east'
          : nearNorth ? 'north'
            : nearSouth ? 'south'
              : nearWest ? 'west'
                : nearEast ? 'east'
                  : null
  return handle ? { box, overlay, handle } : null
}

function resizeCursor(handle: BoxResizeHandle): string {
  if (handle === 'north' || handle === 'south') return 'ns-resize'
  if (handle === 'west' || handle === 'east') return 'ew-resize'
  if (handle === 'north-west' || handle === 'south-east') return 'nwse-resize'
  return 'nesw-resize'
}

function setMapResizeCursor(cursor = '') {
  if (mapRef.value) {
    if (cursor) mapRef.value.style.setProperty('cursor', cursor, 'important')
    else mapRef.value.style.removeProperty('cursor')
  }
  map?.setDefaultCursor?.(cursor || 'default')
}

function clientToLngLat(clientX: number, clientY: number): [number, number] | null {
  if (!map || !mapRef.value) return null
  const rect = mapRef.value.getBoundingClientRect()
  const position = map.containerToLngLat(new AMapApi.Pixel(clientX - rect.left, clientY - rect.top))
  return position ? [position.getLng(), position.getLat()] : null
}

function normalizedBox(start: [number, number], end: [number, number]): Omit<SurveyBox, 'id' | 'createdAt'> {
  return {
    west: Math.min(start[0], end[0]),
    south: Math.min(start[1], end[1]),
    east: Math.max(start[0], end[0]),
    north: Math.max(start[1], end[1]),
  }
}

function startBoxPointerGesture(event: PointerEvent) {
  const target = event.target as HTMLElement
  if (target.closest('.survey-point-marker, .survey-editor-panel, .survey-line-menu, .amap-info-window, .amap-info-contentContainer, .amap-control')) return
  const start = clientToLngLat(event.clientX, event.clientY)
  if (!start) return
  stopLinePointerEvent(event)
  map?.setStatus?.({ dragEnable: false })
  clearLayer('temp')
  const bounds = normalizedBox(start, start)
  const preview = new AMapApi.Rectangle({ bounds: boxBounds(bounds), ...SURVEY_BOX_STYLE, zIndex: 760, bubble: false })
  addLayer('temp', preview)
  boxPointerGesture = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    currentX: event.clientX,
    currentY: event.clientY,
    start,
    current: start,
    preview,
  }
  mapRef.value?.setPointerCapture?.(event.pointerId)
}

function startBoxMoveGesture(event: PointerEvent, hit: { box: SurveyBox; overlay: any }) {
  const start = clientToLngLat(event.clientX, event.clientY)
  if (!start) return
  stopLinePointerEvent(event)
  map?.setStatus?.({ dragEnable: false })
  menuWindow?.close()
  setMapResizeCursor('move')
  selectedBoxId = hit.box.id
  syncBoxSelection()
  boxMoveGesture = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    currentX: event.clientX,
    currentY: event.clientY,
    start,
    current: start,
    box: hit.box,
    overlay: hit.overlay,
  }
  mapRef.value?.setPointerCapture?.(event.pointerId)
}

function startBoxResizeGesture(event: PointerEvent, hit: { box: SurveyBox; overlay: any; handle: BoxResizeHandle }) {
  const current = clientToLngLat(event.clientX, event.clientY)
  if (!current) return
  stopLinePointerEvent(event)
  map?.setStatus?.({ dragEnable: false })
  menuWindow?.close()
  setMapResizeCursor(resizeCursor(hit.handle))
  boxResizeGesture = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    currentX: event.clientX,
    currentY: event.clientY,
    current,
    box: hit.box,
    overlay: hit.overlay,
    handle: hit.handle,
  }
  mapRef.value?.setPointerCapture?.(event.pointerId)
}

function movedBoxBounds(gesture: NonNullable<typeof boxMoveGesture>) {
  const deltaLng = gesture.current[0] - gesture.start[0]
  const deltaLat = gesture.current[1] - gesture.start[1]
  return {
    west: gesture.box.west + deltaLng,
    south: gesture.box.south + deltaLat,
    east: gesture.box.east + deltaLng,
    north: gesture.box.north + deltaLat,
  }
}

function resizedBoxBounds(gesture: NonNullable<typeof boxResizeGesture>) {
  let { west, south, east, north } = gesture.box
  const [lng, lat] = gesture.current
  if (gesture.handle.includes('west')) west = lng
  if (gesture.handle.includes('east')) east = lng
  if (gesture.handle.includes('north')) north = lat
  if (gesture.handle.includes('south')) south = lat
  return {
    west: Math.min(west, east),
    south: Math.min(south, north),
    east: Math.max(west, east),
    north: Math.max(south, north),
  }
}

function onMapPointerDownCapture(event: PointerEvent) {
  if (event.button !== 0) return
  const target = event.target as HTMLElement
  // 信息窗及其按钮必须优先响应，不能被框拖动或管线命中逻辑截获。
  if (target.closest('.survey-line-menu, .amap-info-window, .amap-info-contentContainer, .survey-editor-panel')) return
  if (props.mode === 'box') {
    startBoxPointerGesture(event)
    return
  }
  if (props.mode !== 'edit') return
  // 点位和引入口优先处理自身点击，编辑面板/弹窗也不能被线命中逻辑截获。
  if (target.closest('.survey-point-marker, .survey-inlet-marker, .joint-marker, .regulator-marker, .survey-line-arrow')) return
  const resizeHit = findSelectedBoxResizeHandle(event.clientX, event.clientY)
  if (resizeHit) {
    startBoxResizeGesture(event, resizeHit)
    return
  }
  const boxBorderHit = findBoxAtClientPoint(event.clientX, event.clientY, true)
  if (boxBorderHit) {
    startBoxMoveGesture(event, boxBorderHit)
    return
  }
  const hit = findLineAtClientPoint(event.clientX, event.clientY)
  if (hit) {
    stopLinePointerEvent(event)
    map?.setStatus?.({ dragEnable: false })
    linePointerGesture = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, hit }
    mapRef.value?.setPointerCapture?.(event.pointerId)
    return
  }
  const boxHit = findBoxAtClientPoint(event.clientX, event.clientY)
  if (boxHit) startBoxMoveGesture(event, boxHit)
}

function onMapPointerMoveCapture(event: PointerEvent) {
  if (boxPointerGesture && event.pointerId === boxPointerGesture.pointerId) {
    stopLinePointerEvent(event)
    const end = clientToLngLat(event.clientX, event.clientY)
    if (end) {
      boxPointerGesture.currentX = event.clientX
      boxPointerGesture.currentY = event.clientY
      boxPointerGesture.current = end
      boxPointerGesture.preview.setBounds(boxBounds(normalizedBox(boxPointerGesture.start, end)))
    }
    return
  }
  if (boxResizeGesture && event.pointerId === boxResizeGesture.pointerId) {
    stopLinePointerEvent(event)
    const current = clientToLngLat(event.clientX, event.clientY)
    if (current) {
      boxResizeGesture.currentX = event.clientX
      boxResizeGesture.currentY = event.clientY
      boxResizeGesture.current = current
      boxResizeGesture.overlay.setBounds(boxBounds(resizedBoxBounds(boxResizeGesture)))
    }
    return
  }
  if (boxMoveGesture && event.pointerId === boxMoveGesture.pointerId) {
    stopLinePointerEvent(event)
    const current = clientToLngLat(event.clientX, event.clientY)
    if (current) {
      boxMoveGesture.currentX = event.clientX
      boxMoveGesture.currentY = event.clientY
      boxMoveGesture.current = current
      boxMoveGesture.overlay.setBounds(boxBounds(movedBoxBounds(boxMoveGesture)))
    }
    return
  }
  if (!linePointerGesture && props.mode === 'edit') {
    const resizeHit = findSelectedBoxResizeHandle(event.clientX, event.clientY)
    const boxHit = resizeHit ? null : findBoxAtClientPoint(event.clientX, event.clientY)
    setMapResizeCursor(resizeHit ? resizeCursor(resizeHit.handle) : boxHit ? 'move' : '')
  }
  if (!linePointerGesture || event.pointerId !== linePointerGesture.pointerId) return
  stopLinePointerEvent(event)
}

function finishBoxPointer(event: PointerEvent, save: boolean) {
  const gesture = boxPointerGesture
  if (!gesture || event.pointerId !== gesture.pointerId) return false
  stopLinePointerEvent(event)
  mapRef.value?.releasePointerCapture?.(event.pointerId)
  boxPointerGesture = null
  restoreMapDrag()
  suppressLineClickUntil = performance.now() + 500
  const moved = Math.hypot(gesture.currentX - gesture.startX, gesture.currentY - gesture.startY)
  const end = gesture.current
  if (save && moved > 6) {
    const bounds = normalizedBox(gesture.start, end)
    gesture.preview.setBounds(boxBounds(bounds))
    // 先把预览框提升为正式图层，避免等待 Vue 更新期间短暂消失。
    layers.temp = layers.temp.filter((overlay) => overlay !== gesture.preview)
    layers.box.push(gesture.preview)
    emit('create-box', bounds)
  } else {
    clearLayer('temp')
  }
  return true
}

function finishBoxMove(event: PointerEvent, save: boolean, openMenu = true) {
  const gesture = boxMoveGesture
  if (!gesture || event.pointerId !== gesture.pointerId) return false
  stopLinePointerEvent(event)
  mapRef.value?.releasePointerCapture?.(event.pointerId)
  boxMoveGesture = null
  restoreMapDrag()
  setMapResizeCursor()
  suppressLineClickUntil = performance.now() + 500
  const moved = Math.hypot(gesture.currentX - gesture.startX, gesture.currentY - gesture.startY)
  if (save && moved > 6) {
    emit('update-box', { id: gesture.box.id, bounds: movedBoxBounds(gesture) })
    menuWindow?.close()
  } else {
    gesture.overlay.setBounds(boxBounds(gesture.box))
    if (save && openMenu) openBoxMenu(gesture.box)
  }
  return true
}

function finishBoxResize(event: PointerEvent, save: boolean, openMenu = true) {
  const gesture = boxResizeGesture
  if (!gesture || event.pointerId !== gesture.pointerId) return false
  stopLinePointerEvent(event)
  mapRef.value?.releasePointerCapture?.(event.pointerId)
  boxResizeGesture = null
  restoreMapDrag()
  setMapResizeCursor()
  suppressLineClickUntil = performance.now() + 500
  const moved = Math.hypot(gesture.currentX - gesture.startX, gesture.currentY - gesture.startY)
  if (save && moved > 3) {
    emit('update-box', { id: gesture.box.id, bounds: resizedBoxBounds(gesture) })
    menuWindow?.close()
  } else {
    gesture.overlay.setBounds(boxBounds(gesture.box))
    if (save && openMenu) openBoxMenu(gesture.box)
  }
  return true
}

function finishLinePointer(event: PointerEvent, openMenu: boolean) {
  const gesture = linePointerGesture
  if (!gesture || event.pointerId !== gesture.pointerId) return
  stopLinePointerEvent(event)
  mapRef.value?.releasePointerCapture?.(event.pointerId)
  linePointerGesture = null
  restoreMapDrag()
  suppressLineClickUntil = performance.now() + 500
  const moved = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY)
  if (openMenu && moved <= 6) openLineMenu(gesture.hit.line, gesture.hit.from, gesture.hit.to)
}

function onMapPointerUpCapture(event: PointerEvent) {
  if (finishBoxPointer(event, true)) return
  if (finishBoxResize(event, true)) return
  if (finishBoxMove(event, true)) return
  finishLinePointer(event, true)
}

function onMapPointerCancelCapture(event: PointerEvent) {
  if (finishBoxPointer(event, true)) return
  if (finishBoxResize(event, true, false)) return
  if (finishBoxMove(event, true, false)) return
  finishLinePointer(event, false)
}

function onMapClickCapture(event: MouseEvent) {
  const target = event.target as HTMLElement
  // 点击抑制只针对地图画布，不能拦截刚弹出的删除菜单。
  if (target.closest('.survey-line-menu, .amap-info-window, .amap-info-contentContainer')) return
  if (performance.now() >= suppressLineClickUntil) return
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
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
    bindTip(line, `<b>${e(lineData.id)}</b><br>${e(lineData.fromId)} → ${e(lineData.toId)}`)
    addLayer('line', line)
    // AMap Canvas 对 3px 细线的命中范围较小，增加透明宽热区提升点击可用性。
    const hitArea = new AMapApi.Polyline({
      path: [from, to],
      strokeColor: '#e6c800',
      strokeWeight: 16,
      strokeOpacity: 0.01,
      zIndex: 510,
      cursor: 'pointer',
      bubble: false,
    })
    bindTip(hitArea, `<b>${e(lineData.id)}</b><br>${e(lineData.fromId)} → ${e(lineData.toId)}`)
    addLayer('line', hitArea)
    const fromPixel = map.lngLatToContainer(from)
    const toPixel = map.lngLatToContainer(to)
    const linePixelLength = Math.hypot(toPixel.getX() - fromPixel.getX(), toPixel.getY() - fromPixel.getY())
    if (linePixelLength < SURVEY_ARROW_MIN_LINE_LENGTH_PX) return
    const mid: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
    const angle = Math.atan2(to[0] - from[0], to[1] - from[1]) * 180 / Math.PI
    const arrow = createMarker(mid, 'survey-line-arrow', arrowHtml(angle), 620, true)
    ;((arrow as any).__content as HTMLElement).addEventListener('click', (event) => {
      event.stopPropagation()
      openLineMenu(lineData, from, to)
    })
    addLayer('arrow', arrow)
  })
  toggleLayer('line', props.surveyLinesVisible)
  toggleLayer('arrow', props.surveyLinesVisible)
}

function boxBounds(box: Pick<SurveyBox, 'west' | 'south' | 'east' | 'north'>) {
  return new AMapApi.Bounds([box.west, box.south], [box.east, box.north])
}

function openBoxMenu(box: SurveyBox) {
  if (props.mode !== 'edit') return
  selectedBoxId = box.id
  syncBoxSelection()
  const enableSequence = ++boxDeleteEnableSequence
  const center: [number, number] = [(box.west + box.east) / 2, (box.south + box.north) / 2]
  menuWindow.setContent(`<div class="survey-line-menu survey-box-menu"><div class="survey-line-menu-title">差异标识 ${e(box.id)}</div><button class="survey-line-menu-btn" data-box-action="note" data-box-id="${e(box.id)}"><span class="icon">📝</span><span class="label">${box.note ? '编辑备注' : '添加备注'}</span></button><button class="survey-line-menu-btn danger" data-box-action="remove" data-box-id="${e(box.id)}" disabled title="请稍候 500ms，防止误删"><span class="icon">🗑</span><span class="label">删除标识框</span></button></div>`)
  menuWindow.open(map, center)
  window.setTimeout(() => {
    if (enableSequence !== boxDeleteEnableSequence || selectedBoxId !== box.id) return
    const button = document.querySelector<HTMLButtonElement>(`.survey-line-menu-btn[data-box-action="remove"][data-box-id="${box.id}"]`)
    if (button) {
      button.disabled = false
      button.title = '删除标识框'
    }
  }, 500)
}

function syncBoxSelection() {
  boxOverlayMap.forEach((rectangle, id) => {
    rectangle.setOptions(id === selectedBoxId ? SURVEY_BOX_SELECTED_STYLE : SURVEY_BOX_STYLE)
  })
}

function clearBoxSelection() {
  selectedBoxId = null
  if (!boxResizeGesture && !boxMoveGesture) setMapResizeCursor()
  syncBoxSelection()
}

function renderSurveyBoxes() {
  if (!map) return
  clearLayer('box')
  boxOverlayMap.clear()
  props.surveyBoxes.forEach((box) => {
    const rectangle = new AMapApi.Rectangle({ bounds: boxBounds(box), ...SURVEY_BOX_STYLE, bubble: false, cursor: 'default' })
    rectangle.on('click', () => openBoxMenu(box))
    const noteHtml = box.note?.trim() ? `<br><span class="survey-box-tip-note">${e(box.note.trim())}</span>` : ''
    const tipHtml = `<div class="survey-box-tip"><b>差异标识 ${e(box.id)}</b>${noteHtml}</div>`
    rectangle.on('mouseover', () => {
      if (props.mode !== 'view' || pinnedSurveyPointId) return
      const topCenter: [number, number] = [(box.west + box.east) / 2, box.north]
      openTip(topCenter, tipHtml)
    })
    rectangle.on('mouseout', () => {
      if (!pinnedSurveyPointId) tipWindow?.close()
    })
    addLayer('box', rectangle)
    boxOverlayMap.set(box.id, rectangle)
  })
  if (selectedBoxId && !props.surveyBoxes.some((box) => box.id === selectedBoxId)) selectedBoxId = null
  syncBoxSelection()
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
  menuWindow.setContent(`<div class="survey-add-menu"><div class="survey-add-menu-title">选择点位类型</div><button class="survey-add-menu-btn" data-type="tee" data-lat="${lat}" data-lng="${lng}"><span class="survey-add-menu-icon type-tee"></span>三通</button><button class="survey-add-menu-btn" data-type="elbow" data-lat="${lat}" data-lng="${lng}"><span class="survey-add-menu-icon type-elbow"></span>弯头</button><button class="survey-add-menu-btn" data-type="straight" data-lat="${lat}" data-lng="${lng}"><span class="survey-add-menu-icon type-straight"></span>普通</button><button class="survey-add-menu-btn" data-type="joint" data-lat="${lat}" data-lng="${lng}"><span class="survey-add-menu-icon type-joint"></span>绝缘接头</button><button class="survey-add-menu-btn" data-type="inlet" data-lat="${lat}" data-lng="${lng}"><span class="survey-add-menu-icon type-inlet"></span>引入口</button></div>`)
  menuWindow.open(map, position)
}

function handleMapClick(event: any) {
  // 自定义 Marker 的 DOM 点击也会到达地图；端点由 Marker 自己处理，这里必须跳过。
  const target = event.originEvent?.target as HTMLElement | undefined
  if (target?.closest?.('.survey-point-marker, .survey-inlet-marker, .joint-marker, .regulator-marker')) return
  if (props.mode === 'view' && suppressNextMapClear) return
  const position: [number, number] = [event.lnglat.getLng(), event.lnglat.getLat()]
  if (props.mode === 'add-point') showAddMenu(position)
  else if (props.mode === 'connect') handleConnectMapClick(position)
  else {
    if (props.mode === 'view') clearSurveyPointSelection()
    menuWindow?.close()
    clearBoxSelection()
    clearFacilitySelection()
    selectedUnitId = null
    syncUnitSelection()
  }
}

function handleMouseMove(event: any) {
  if (props.mode !== 'connect' || !connectPendingFrom || !connectPendingPosition || !connectTempLine) return
  const position: [number, number] = [event.lnglat.getLng(), event.lnglat.getLat()]
  const snap = findSnap(position, connectPendingFrom)
  connectTempLine.setPath([connectPendingPosition, snap?.position ?? position])
}

function onDocumentClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  const photoButton = target.closest('.survey-point-hover-image') as HTMLElement | null
  if (photoButton?.dataset.photoUrl) {
    photoButton.classList.add('is-opened')
    photoButton.addEventListener('mouseleave', () => photoButton.classList.remove('is-opened'), { once: true })
    window.open(photoButton.dataset.photoUrl, '_blank', 'noopener,noreferrer')
    return
  }
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
    return
  }
  const boxButton = target.closest('.survey-line-menu-btn') as HTMLElement | null
  if (boxButton?.dataset.boxAction === 'note' && boxButton.dataset.boxId) {
    const box = props.surveyBoxes.find((item) => item.id === boxButton.dataset.boxId)
    menuWindow?.close()
    if (!box) return
    void ElMessageBox.prompt('请输入该差异标识框的备注信息', '方框备注', {
      inputValue: box.note ?? '',
      inputType: 'textarea',
      inputPlaceholder: '例如：勘测管线与官方管线存在位置差异',
      confirmButtonText: '保存',
      cancelButtonText: '取消',
    }).then(({ value }) => {
      emit('update-box-note', { id: box.id, note: value.trim() })
      ElMessage.success('备注已保存')
    }).catch(() => undefined)
    return
  }
  if (boxButton?.dataset.boxAction === 'remove' && boxButton.dataset.boxId) {
    boxDeleteEnableSequence++
    selectedBoxId = null
    syncBoxSelection()
    menuWindow?.close()
    emit('remove-box', boxButton.dataset.boxId)
  }
}

function fitToAll() {
  if (!map) return
  const candidates = [...layers.unit, ...layers.pipe, ...layers.point, ...layers.line, ...layers.box]
  if (!candidates.length) return
  map.setFitView(candidates, false, [60, 60, 60, 60], 20)
  window.setTimeout(() => { if (map && map.getZoom() < 18) map.setZoom(18) }, 300)
}

function markFocusedPoint(id: string | null) {
  focusedPointId = id
  pointMarkerMap.forEach((marker, pointId) => {
    const element = (marker as any).__content as HTMLElement | undefined
    const focused = pointId === id
    element?.classList.toggle('is-focused', focused)
    marker.setzIndex?.(focused ? 1200 : ((marker as any).__baseZIndex ?? 650))
  })
}

function focusPoint(id: string) {
  const point = props.surveyPoints.find((item) => item.id === id)
  if (!map || !point) return
  markFocusedPoint(id)
  // 容器已裁剪卡片进出场的横向溢出，可以安全使用平滑定位动画。
  map.setZoomAndCenter(20, [point.lng, point.lat], false, 500)
}

function showPointInfo(id: string) {
  const point = props.surveyPoints.find((item) => item.id === id)
  if (!map || !point) return
  focusPoint(id)
  menuWindow?.close()
  void showSurveyPointTip(point, [point.lng, point.lat], true)
}

function invalidate() {
  map?.resize?.()
}

defineExpose({ focusPoint, showPointInfo, clearPointInfo: clearPinnedSurveyPointTip, invalidate })

const editingPoint = computed(() => props.editingPointId ? props.surveyPoints.find((point) => point.id === props.editingPointId) ?? null : null)
const editForm = reactive<{ type: SurveyPointType; rotation: number; depth: number | null; current: number | null; note: string }>({ type: 'straight', rotation: 0, depth: null, current: null, note: '' })
const photoInputRef = ref<HTMLInputElement | null>(null)
const pointPhotos = ref<Array<SurveyPhotoRecord & { url: string }>>([])
const photosLoading = ref(false)
const photosSaving = ref(false)
let photoLoadSequence = 0

function photoOwnerKey(point: SurveyPoint): string {
  return `${point.id}:${point.createdAt}`
}

function releasePhotoUrls() {
  pointPhotos.value.forEach((photo) => URL.revokeObjectURL(photo.url))
  pointPhotos.value = []
}

async function loadPointPhotos(point: SurveyPoint | null) {
  const sequence = ++photoLoadSequence
  releasePhotoUrls()
  if (!point) return
  photosLoading.value = true
  try {
    const records = await listSurveyPhotos(photoOwnerKey(point))
    if (sequence !== photoLoadSequence || editingPoint.value?.id !== point.id) return
    pointPhotos.value = records.map((record) => ({
      ...record,
      url: URL.createObjectURL(record.blob),
    }))
  } catch (error) {
    if (sequence === photoLoadSequence) {
      ElMessage.error(`照片读取失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  } finally {
    if (sequence === photoLoadSequence) photosLoading.value = false
  }
}

function choosePhotos() {
  photoInputRef.value?.click()
}

async function onPhotosSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const point = editingPoint.value
  const files = Array.from(input.files ?? []).filter((file) => file.type.startsWith('image/'))
  input.value = ''
  if (!point || files.length === 0 || photosSaving.value) return
  photosSaving.value = true
  try {
    await addSurveyPhotos(photoOwnerKey(point), point.id, files)
    await loadPointPhotos(point)
    ElMessage.success(`已保存 ${files.length} 张照片`)
  } catch (error) {
    ElMessage.error(`照片保存失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    photosSaving.value = false
  }
}

async function removePhoto(photo: SurveyPhotoRecord) {
  const point = editingPoint.value
  if (!point || !confirm(`确认删除照片“${photo.name}”？`)) return
  try {
    await deleteSurveyPhoto(photo.id)
    await loadPointPhotos(point)
    ElMessage.success('照片已删除')
  } catch (error) {
    ElMessage.error(`照片删除失败：${error instanceof Error ? error.message : '未知错误'}`)
  }
}

watch(() => props.editingPointId, (id) => {
  markFocusedPoint(id)
  const point = id ? props.surveyPoints.find((item) => item.id === id) : null
  void loadPointPhotos(point ?? null)
  if (!point) return
  editForm.type = point.type
  editForm.rotation = point.rotation
  editForm.depth = point.depth ?? null
  editForm.current = point.current ?? null
  editForm.note = point.note ?? ''
})
watch(() => editForm.type, (type) => { if (type !== 'tee' && type !== 'elbow') editForm.rotation = 0 })
watch([() => editForm.type, () => editForm.rotation], ([type, rotation]) => {
  const point = editingPoint.value
  const item = point ? pointMarkerMap.get(point.id) : null
  const element = item ? (item as any).__content as HTMLElement : null
  if (point && element) element.innerHTML = pointIconHtml({ ...point, type, rotation })
})

function saveEdit() {
  if (!props.editingPointId) return
  emit('update-point', { id: props.editingPointId, patch: { type: editForm.type, rotation: editForm.type === 'tee' || editForm.type === 'elbow' ? editForm.rotation : 0, depth: editForm.depth ?? undefined, current: editForm.current ?? undefined, note: editForm.note || undefined } })
  emit('close-editor')
}
async function deleteEdit() {
  if (!props.editingPointId || !confirm(`确认删除 ${props.editingPointId} ?`)) return
  const point = editingPoint.value
  if (point) {
    try {
      await deleteSurveyPhotos(photoOwnerKey(point))
    } catch (error) {
      console.warn('[Survey] 删除点位照片失败：', error)
    }
  }
  emit('delete-point', props.editingPointId)
  emit('close-editor')
}
function closeEdit() {
  const point = editingPoint.value
  const marker = point ? pointMarkerMap.get(point.id) : null
  const element = marker ? (marker as any).__content as HTMLElement : null
  if (point && element) element.innerHTML = pointIconHtml(point)
  emit('close-editor')
}

const mapContainerClass = computed(() => ({
  'mode-add-point': props.mode === 'add-point',
  'mode-connect': props.mode === 'connect',
  'mode-edit': props.mode === 'edit',
  'mode-box': props.mode === 'box',
}))

onMounted(async () => {
  if (!mapRef.value) return
  try {
    AMapApi = await loadAMap()
    map = new AMapApi.Map(mapRef.value, { viewMode: '2D', mapStyle: currentMapStyle(), zoom: 18, zooms: [3, 20], center: [116.497, 39.763], resizeEnable: true, animateEnable: true, jogEnable: false })
    tipWindow = new AMapApi.InfoWindow({ isCustom: true, offset: new AMapApi.Pixel(0, -10), autoMove: false })
    menuWindow = new AMapApi.InfoWindow({ isCustom: false, offset: new AMapApi.Pixel(0, -8), closeWhenClickMap: false })
    map.on('click', handleMapClick)
    map.on('mousemove', handleMouseMove)
    map.on('zoomend', renderSurveyLines)
    mapRef.value?.addEventListener('pointerdown', onMapPointerDownCapture, true)
    mapRef.value?.addEventListener('pointermove', onMapPointerMoveCapture, true)
    mapRef.value?.addEventListener('pointerup', onMapPointerUpCapture, true)
    mapRef.value?.addEventListener('pointercancel', onMapPointerCancelCapture, true)
    mapRef.value?.addEventListener('click', onMapClickCapture, true)
    document.addEventListener('click', onDocumentClick)
    window.addEventListener('blur', restoreMapDrag)
    window.addEventListener('themechange', handleThemeChange)
    renderUnits()
    renderPipes()
    renderJoints()
    renderRegulators()
    renderInlets()
    renderSurveyPoints()
    renderSurveyLines()
    renderSurveyBoxes()
    fitToAll()
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '高德勘测地图加载失败'
    ElMessage.error(loadError.value)
  }
})

watch(() => props.pipes, () => { renderPipes(); fitToAll() }, { deep: false })
watch(() => props.units, () => { renderUnits(); fitToAll() }, { deep: false })
watch(() => props.joints, renderJoints, { deep: false })
watch(() => props.regulators, renderRegulators, { deep: false })
watch(() => props.inlets, renderInlets, { deep: false })
watch(() => props.surveyPoints, () => { renderSurveyPoints(); renderSurveyLines() }, { deep: false })
watch(() => props.surveyLines, renderSurveyLines, { deep: false })
watch(() => props.surveyBoxes, renderSurveyBoxes, { deep: false })
watch(() => props.visible, (value) => toggleLayer('pipe', value))
watch(() => props.inletsVisible, (value) => toggleLayer('inlet', value))
watch(() => props.unitsVisible, (value) => toggleLayer('unit', value))
watch(() => props.jointsVisible, (value) => toggleLayer('joint', value))
watch(() => props.regulatorsVisible, (value) => toggleLayer('regulator', value))
watch(() => props.surveyPointsVisible, (value) => toggleLayer('point', value))
watch(() => props.surveyLinesVisible, (value) => { toggleLayer('line', value); toggleLayer('arrow', value) })
watch(() => props.mode, (mode) => {
  setMapResizeCursor()
  menuWindow?.close()
  clearPinnedSurveyPointTip()
  clearBoxSelection()
  clearLayer('temp')
  if (mode !== 'connect') clearPending()
  renderSurveyPoints()
  renderSurveyBoxes()
})

onBeforeUnmount(() => {
  setMapResizeCursor()
  photoLoadSequence++
  releasePhotoUrls()
  hoverPhotoLoadSequence++
  releaseHoverPhotoUrls()
  clearFacilitySelection()
  selectedUnitId = null
  syncUnitSelection()
  mapRef.value?.removeEventListener('pointerdown', onMapPointerDownCapture, true)
  mapRef.value?.removeEventListener('pointermove', onMapPointerMoveCapture, true)
  mapRef.value?.removeEventListener('pointerup', onMapPointerUpCapture, true)
  mapRef.value?.removeEventListener('pointercancel', onMapPointerCancelCapture, true)
  mapRef.value?.removeEventListener('click', onMapClickCapture, true)
  document.removeEventListener('click', onDocumentClick)
  window.removeEventListener('blur', restoreMapDrag)
  window.removeEventListener('themechange', handleThemeChange)
  map?.off('click', handleMapClick)
  map?.off('mousemove', handleMouseMove)
  map?.off('zoomend', renderSurveyLines)
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

    <Transition name="survey-editor-slide" mode="out-in" appear>
      <div v-if="editingPoint" :key="editingPoint.id" class="survey-editor-panel">
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
              <el-radio-button value="joint">绝缘接头</el-radio-button>
              <el-radio-button value="inlet">引入口</el-radio-button>
            </el-radio-group>
          </div>
          <div v-if="editForm.type === 'tee' || editForm.type === 'elbow'" class="survey-editor-row">
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
          <div class="survey-editor-row"><label class="survey-editor-label">电流（mA）</label><el-input-number v-model="editForm.current" :step="0.1" :precision="3" size="small" style="width:100%" /></div>
          <div class="survey-editor-row survey-photo-entry">
            <label class="survey-editor-label">照片留痕</label>
            <input ref="photoInputRef" class="survey-photo-input" type="file" accept="image/*" multiple @change="onPhotosSelected" />
            <button type="button" class="survey-photo-add-btn" :disabled="photosSaving" @click="choosePhotos">
              {{ photosSaving ? '正在保存…' : '＋ 添加照片' }}
            </button>
            <div v-if="photosLoading" class="survey-photo-hint">正在读取照片…</div>
            <div v-else-if="pointPhotos.length" class="survey-photo-grid">
              <div v-for="photo in pointPhotos" :key="photo.id" class="survey-photo-item">
                <a :href="photo.url" target="_blank" rel="noopener noreferrer" class="survey-photo-preview" :title="`查看 ${photo.name}`">
                  <img :src="photo.url" :alt="photo.name" />
                </a>
                <button type="button" class="survey-photo-remove" :title="`删除 ${photo.name}`" @click="removePhoto(photo)">×</button>
                <div class="survey-photo-name" :title="photo.name">{{ photo.name }}</div>
              </div>
            </div>
            <div v-else class="survey-photo-hint">支持多张现场照片，添加后自动保存到当前浏览器</div>
          </div>
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
