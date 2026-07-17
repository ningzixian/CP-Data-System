<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { STATUS_COLORS } from '@/types/items'
import { useCpStore } from '@/stores/cp'
import { loadAMap } from '@/map/amap-loader'
import { escapeHtml as e } from '@/utils/html'
import { inletInsulationReadings, insulationPhotoOwnerKey } from '@/utils/insulation'
import { listInsulationPhotos } from '@/utils/insulationPhotos'
import { listInspectionPhotos } from '@/utils/inspectionPhotos'
import { hasSoilCoordinates, soilPhotoOwnerKey, soilResistivityPoints } from '@/utils/soilResistivity'
import { dcStrayCurrentPoints, dcStrayPhotoOwnerKey, hasDcStrayCoordinates } from '@/utils/dcStrayCurrent'
import { coatingDamagePhotoOwnerKey, coatingDamagePoints, hasCoatingDamageCoordinates } from '@/utils/coatingDetect'
import { hasNaturalPotential, inletPotentialReadings, pipePotentialPhotoOwnerKey } from '@/utils/pipeGroundPotential'
import { electricContinuityPhotoOwnerKey, electricContinuityPoints, hasElectricContinuityCoordinates, hasElectricContinuityResult } from '@/utils/electricContinuity'
import { hasInletParameterResult, inletParameterPhotoOwnerKey, inletParameterReadings } from '@/utils/inletParameters'
import type { CorrosionUnit, InspectionItemCode } from '@/types/models'

const emit = defineEmits<{
  (e: 'select', unit: CorrosionUnit): void
  (e: 'community-focus', name: string): void
  (e: 'view-mode', mode: 'community' | 'detail'): void
  (e: 'clear-data-module'): void
}>()

export type FacilityKey = 'unit' | 'pipe' | 'joint' | 'regulator' | 'inlet'
export type FacilityVisibility = Record<FacilityKey, boolean>

const props = withDefaults(defineProps<{
  units: CorrosionUnit[]
  points: unknown[]
  visibility?: FacilityVisibility
  activeDataModule?: InspectionItemCode | null
  dataModuleMode?: boolean
}>(), {
  visibility: () => ({ unit: true, pipe: true, joint: true, regulator: true, inlet: true }),
  activeDataModule: null,
  dataModuleMode: false,
})

const store = useCpStore()
const mapRef = ref<HTMLDivElement | null>(null)
const loading = ref(true)
const loadError = ref('')

let AMapApi: any = null
let map: any = null
let infoWindow: any = null
let isCommunityView = false
let selectedFacility: { kind: FacilityKey; overlay: any; element?: HTMLElement } | null = null

function currentMapStyle() {
  return document.documentElement.classList.contains('dark') ? 'amap://styles/darkblue' : 'amap://styles/normal'
}

function handleThemeChange() {
  map?.setMapStyle?.(currentMapStyle())
}

const overlays: Record<FacilityKey | 'community' | 'insulation' | 'soil' | 'dcStray' | 'coating' | 'potential' | 'continuity' | 'inletParameter', any[]> = {
  unit: [], pipe: [], joint: [], regulator: [], inlet: [], community: [], insulation: [], soil: [], dcStray: [], coating: [], potential: [], continuity: [], inletParameter: [],
}
const unitPolygons = new Map<number, any>()
const unitMarkers = new Map<number, any>()
const insulationPhotoUrls = new Set<string>()
let insulationRenderSequence = 0
const soilPhotoUrls = new Set<string>()
let soilRenderSequence = 0
const dcStrayPhotoUrls = new Set<string>()
let dcStrayRenderSequence = 0
const coatingPhotoUrls = new Set<string>()
let coatingRenderSequence = 0
const potentialPhotoUrls = new Set<string>()
let potentialRenderSequence = 0
const continuityPhotoUrls = new Set<string>()
let continuityRenderSequence = 0
const inletParameterPhotoUrls = new Set<string>()
let inletParameterRenderSequence = 0

const COMMUNITY_VIEW_ZOOM = 17
const COMMUNITY_INFO_MIN_ZOOM = 16
const DETAIL_ZOOM = 19
const MAX_ZOOM = 20

const POLY_STYLES = {
  default: { strokeColor: '#67c23a', strokeWeight: 2, strokeOpacity: 0.9, fillColor: '#67c23a', fillOpacity: 0.12, strokeStyle: 'dashed' },
  hover: { strokeColor: '#409eff', strokeWeight: 3, strokeOpacity: 1, fillColor: '#409eff', fillOpacity: 0.25, strokeStyle: 'solid' },
  selected: { strokeColor: '#7c3aed', strokeWeight: 3, strokeOpacity: 1, fillColor: '#7c3aed', fillOpacity: 0.28, strokeStyle: 'solid' },
}
const PIPE_DEFAULT = { strokeColor: '#67c23a', strokeWeight: 3, strokeOpacity: 0.75, zIndex: 400 }
const PIPE_ACTIVE = { strokeColor: '#8B4513', strokeWeight: 6, strokeOpacity: 1, zIndex: 810 }

function htmlElement(className: string, html: string): HTMLElement {
  const el = document.createElement('div')
  el.className = className
  el.innerHTML = html
  return el
}

function marker(options: { position: [number, number]; className: string; html: string; size: [number, number]; zIndex: number; clickable?: boolean }) {
  const content = htmlElement(options.className, options.html)
  const item = new AMapApi.Marker({
    position: options.position,
    content,
    anchor: 'center',
    offset: new AMapApi.Pixel(0, 0),
    zIndex: options.zIndex,
    clickable: options.clickable !== false,
    bubble: false,
  })
  ;(item as any).__content = content
  ;(item as any).__baseZIndex = options.zIndex
  return item
}

function progressHtml(unit: CorrosionUnit) {
  const fill = STATUS_COLORS[unit.inspection_status] || '#909399'
  return `<div class="unit-progress-core" style="--progress-fill:${fill};--progress-border:#fff"><span class="unit-progress-value">${Math.round(unit.inspection_progress * 100)}%</span></div>`
}

function communityColor(progress: number, exception = false) {
  return exception ? '#f56c6c' : progress >= 1 ? '#67c23a' : progress >= 0.8 ? '#85ce61' : progress > 0 ? '#e6a23c' : '#c0c4cc'
}

function communityHtml(name: string, count: number, progress: number, exception: boolean, index: number) {
  const color = communityColor(progress, exception)
  return `<div class="community-anim" style="width:130px;height:130px;display:flex;align-items:center;justify-content:center;animation:communityPopIn .6s cubic-bezier(.34,1.56,.64,1) ${(index * 0.12).toFixed(2)}s both;transform-origin:center"><div class="community-hover-target" style="background:${color};color:#fff;border-radius:50%;width:130px;height:130px;display:flex;flex-direction:column;align-items:center;justify-content:center;border:4px solid #fff;box-shadow:0 6px 24px rgba(0,0,0,.35);font-family:-apple-system,sans-serif"><div style="font-size:30px;font-weight:700;line-height:1">${Math.round(progress * 100)}%</div><div style="font-size:13px;margin-top:6px;font-weight:600">${e(name)}</div><div style="font-size:11px;margin-top:3px;opacity:.85">${count} 个单元</div></div></div>`
}

function boundaryInfoHtml(name: string, progress: number, count: number, length: number) {
  return `<div class="community-boundary-info-content"><div class="community-boundary-info-name">${e(name)}</div><div class="community-boundary-info-metrics"><div class="community-boundary-info-row"><span>进度</span><span>：</span><span>${Math.round(progress * 100)}%</span></div><div class="community-boundary-info-row"><span>单元</span><span>：</span><span>${count} 个</span></div><div class="community-boundary-info-row"><span>管线</span><span>：</span><span>${Math.round(length).toLocaleString('zh-CN')} 米</span></div></div></div>`
}

function add(kind: keyof typeof overlays, overlay: any) {
  overlays[kind].push(overlay)
  map.add(overlay)
}

function clearKind(kind: keyof typeof overlays) {
  if (overlays[kind].length) map?.remove(overlays[kind])
  overlays[kind] = []
}

function setShown(kind: keyof typeof overlays, shown: boolean) {
  overlays[kind].forEach((item) => shown ? item.show() : item.hide())
}

function openInfo(position: [number, number], html: string) {
  if (!map || !infoWindow) return
  infoWindow.setContent(`<div class="amap-business-tip">${html}</div>`)
  infoWindow.open(map, position)
}

function closeInfo() {
  infoWindow?.close()
}

function clearFacilitySelection() {
  if (!selectedFacility) return
  const { kind, overlay, element } = selectedFacility
  if (kind === 'pipe') overlay.setOptions(PIPE_DEFAULT)
  else {
    element?.classList.remove('selected', 'hovered')
    overlay.setzIndex?.((overlay as any).__baseZIndex ?? 500)
  }
  selectedFacility = null
}

function clearAll() {
  clearFacilitySelection()
  if (props.dataModuleMode) {
    if (props.activeDataModule) emit('clear-data-module')
    return
  }
  if (store.selectedUnit) store.selectUnit(null)
}

function selectFacility(kind: FacilityKey, overlay: any) {
  if (props.dataModuleMode) {
    clearFacilitySelection()
    if (props.activeDataModule) emit('clear-data-module')
    return
  }
  if (selectedFacility?.overlay === overlay) {
    clearFacilitySelection()
    return
  }
  clearAll()
  const element = (overlay as any).__content as HTMLElement | undefined
  if (kind === 'pipe') overlay.setOptions(PIPE_ACTIVE)
  else {
    element?.classList.add('selected')
    overlay.setzIndex?.(820)
  }
  selectedFacility = { kind, overlay, element }
  const bounds = overlay.getBounds?.()
  if (bounds) map.setFitView([overlay], false, [60, 60, 60, 60], DETAIL_ZOOM)
  else map.setZoomAndCenter(DETAIL_ZOOM, overlay.getPosition(), false, 600)
}

function bindFacility(kind: FacilityKey, overlay: any, position: [number, number] | null, tip: string) {
  const element = (overlay as any).__content as HTMLElement | undefined
  overlay.on('mouseover', () => {
    if (kind === 'pipe') overlay.setOptions(PIPE_ACTIVE)
    else {
      element?.classList.add('hovered')
      overlay.setzIndex?.(810)
    }
    const pos = position ?? overlay.getBounds?.()?.getCenter?.()
    if (pos) openInfo([pos.getLng?.() ?? pos[0], pos.getLat?.() ?? pos[1]], tip)
  })
  overlay.on('mouseout', () => {
    if (selectedFacility?.overlay !== overlay) {
      if (kind === 'pipe') overlay.setOptions(PIPE_DEFAULT)
      else {
        element?.classList.remove('hovered')
        overlay.setzIndex?.((overlay as any).__baseZIndex ?? 500)
      }
    }
    closeInfo()
  })
  overlay.on('click', () => selectFacility(kind, overlay))
}

function setUnitStyle(id: number, mode: 'default' | 'hover' | 'selected') {
  const polygon = unitPolygons.get(id)
  const progress = unitMarkers.get(id)
  const unit = store.units.find((item) => item.id === id)
  if (polygon) polygon.setOptions(POLY_STYLES[mode])
  if (progress && unit) {
    const element = (progress as any).__content as HTMLElement
    const core = element.querySelector<HTMLElement>('.unit-progress-core')
    const value = element.querySelector<HTMLElement>('.unit-progress-value')
    element.classList.toggle('is-hovered', mode === 'hover')
    element.classList.toggle('is-selected', mode === 'selected')
    core?.style.setProperty('--progress-fill', mode === 'hover'
      ? '#79bbff'
      : mode === 'selected'
        ? '#409eff'
        : (STATUS_COLORS[unit.inspection_status] || '#909399'))
    core?.style.setProperty('--progress-border', mode === 'selected' ? '#fdd835' : '#fff')
    if (value) value.textContent = `${Math.round(unit.inspection_progress * 100)}%`
    progress.setzIndex(mode === 'default' ? 200 : 800)
  }
}

function renderUnits() {
  if (!map || !store.facilities) return
  clearKind('unit')
  unitPolygons.clear()
  unitMarkers.clear()

  store.facilities.units.forEach((source) => {
    if (!source.polyline || source.polyline.length < 3) return
    const unit = store.units.find((item) => item.id === source.id) ?? source
    const path = source.polyline.map(([lat, lng]) => [lng, lat])
    const polygon = new AMapApi.Polygon({ path, ...POLY_STYLES.default, zIndex: 300, bubble: false })
    const joints = store.facilities?.jointCountByUnit[source.id] ?? 0
    const inlets = store.facilities?.inletCountByUnit[source.id] ?? 0
    const tip = `<b>控制单元 ${source.name}</b><br>${source.note || '低压控制单元'}<br>绝缘接头：${joints} 个｜引入口：${inlets} 个`
    polygon.on('mouseover', (event: any) => {
      store.hoverUnit(unit)
      openInfo([event.lnglat.getLng(), event.lnglat.getLat()], tip)
    })
    polygon.on('mouseout', () => {
      if (store.hoveredUnit?.id === unit.id) store.hoverUnit(null)
      closeInfo()
    })
    polygon.on('click', () => {
      clearFacilitySelection()
      if (props.dataModuleMode) {
        if (props.activeDataModule) emit('clear-data-module')
        emit('select', unit)
        return
      }
      emit('select', unit)
    })
    add('unit', polygon)
    unitPolygons.set(unit.id, polygon)

    if (source.lng && source.lat) {
      const progress = marker({ position: [source.lng, source.lat], className: 'unit-progress-marker amap-unit-progress', html: progressHtml(unit), size: [64, 64], zIndex: 200, clickable: false })
      add('unit', progress)
      unitMarkers.set(unit.id, progress)
    }
  })

  if (store.selectedUnit) setUnitStyle(store.selectedUnit.id, 'selected')
  if (store.hoveredUnit && store.hoveredUnit.id !== store.selectedUnit?.id) setUnitStyle(store.hoveredUnit.id, 'hover')
}

function renderPipes() {
  clearKind('pipe')
  ;(store.facilities?.pipes ?? []).forEach((pipe) => {
    if (pipe.coords.length < 2) return
    const line = new AMapApi.Polyline({ path: pipe.coords, ...PIPE_DEFAULT, lineJoin: 'round', lineCap: 'round', bubble: false })
    const tip = `<b>${e(pipe.pipeno || pipe.fid)}</b><br>管材：${e(pipe.material || '—')} | 外径：${e(pipe.diametero || '—')}mm<br>壁厚：${e(pipe.thickness || '—')}mm | 长度：${e(pipe.length || '—')}m<br>压力：${e(pipe.pressured)}`
    bindFacility('pipe', line, null, tip)
    add('pipe', line)
  })
}

function renderJoints() {
  clearKind('joint')
  ;(store.facilities?.joints ?? []).forEach((joint) => {
    const item = marker({ position: [joint.lng, joint.lat], className: 'joint-marker amap-facility-marker', html: '<div class="facility-anim"><div style="color:#f56c6c;font-size:22px;font-weight:900;line-height:22px;text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 3px #fff;font-family:Arial">✕</div></div>', size: [22, 22], zIndex: 520 })
    const belongs = joint.unit_id ? store.units.find((unit) => unit.id === joint.unit_id)?.name : null
    bindFacility('joint', item, [joint.lng, joint.lat], `<b>✕ ${e(joint.type)}</b><br>编码：${e(joint.ecode)}<br>压力：${e(joint.pressured)}<br>管号：${e(joint.pipeno || '—')}${belongs ? `<br>归属：${e(belongs)}` : '<br><span style="color:#f56c6c">⚠ 未归属</span>'}`)
    add('joint', item)
  })
}

function renderRegulators() {
  clearKind('regulator')
  ;(store.facilities?.regulators ?? []).forEach((regulator) => {
    const item = marker({ position: [regulator.lng, regulator.lat], className: 'regulator-marker amap-facility-marker', html: '<div class="facility-anim"><div style="background:#1890ff;color:#fff;border-radius:4px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);font-weight:700;font-size:14px">调</div></div>', size: [32, 32], zIndex: 510 })
    bindFacility('regulator', item, [regulator.lng, regulator.lat], `<b>调压箱 ${e(regulator.name)}</b><br>编码：${e(regulator.ecode)}<br>压力：${e(regulator.pressured)}`)
    add('regulator', item)
  })
}

function renderInlets() {
  clearKind('inlet')
  ;(store.facilities?.inlets ?? []).forEach((inlet) => {
    const item = marker({ position: [inlet.lng, inlet.lat], className: 'inlet-marker amap-facility-marker', html: '<div class="facility-anim"><div style="background:#909399;color:#fff;border-radius:50%;width:14px;height:14px;border:1.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div></div>', size: [14, 14], zIndex: 500 })
    const belongs = inlet.unit_id ? store.units.find((unit) => unit.id === inlet.unit_id)?.name : null
    bindFacility('inlet', item, [inlet.lng, inlet.lat], `<b>引入口 ${e(inlet.ecode)}</b><br>压力：${e(inlet.pressured)}<br>管号：${e(inlet.pipeno)}${belongs ? `<br>归属：${e(belongs)}` : ''}`)
    add('inlet', item)
  })
}

function formatResistance(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${Number(value).toLocaleString('zh-CN')} MΩ`
}

function clearInsulationLayer() {
  insulationRenderSequence++
  clearKind('insulation')
  insulationPhotoUrls.forEach((url) => URL.revokeObjectURL(url))
  insulationPhotoUrls.clear()
}

async function renderInsulation() {
  clearInsulationLayer()
  if (!map || props.activeDataModule !== 'JOINT_VERIFY' || !store.selectedUnit) return
  const sequence = insulationRenderSequence
  const unitId = store.selectedUnit.id
  const inlets = (store.facilities?.inlets ?? []).filter((inlet) => inlet.unit_id === unitId)
  const record = [...store.records]
    .filter((item) => item.unit_id === unitId && item.item_code === 'JOINT_VERIFY')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
  const readings = inletInsulationReadings(record)

  const photoEntries = await Promise.all(inlets.map(async (inlet) => {
    try {
      return [inlet.fid, await listInsulationPhotos(insulationPhotoOwnerKey(unitId, inlet.fid))] as const
    } catch (error) {
      console.warn(`[Insulation] 引入口 ${inlet.ecode || inlet.fid} 照片读取失败：`, error)
      return [inlet.fid, []] as const
    }
  }))
  if (sequence !== insulationRenderSequence || props.activeDataModule !== 'JOINT_VERIFY' || store.selectedUnit?.id !== unitId) return
  const photosByInlet = new Map(photoEntries)

  inlets.forEach((inlet, index) => {
    const reading = readings.get(inlet.fid)
    const complete = !!reading && reading.bolt_resistances.every((value) => value !== null)
      && reading.flange_resistance !== null
    const photos = photosByInlet.get(inlet.fid) ?? []
    const photoViews = photos.map((photo) => {
      const url = URL.createObjectURL(photo.blob)
      insulationPhotoUrls.add(url)
      return `<a href="${e(url)}" target="_blank" rel="noopener noreferrer" title="${e(photo.name)}"><img src="${e(url)}" alt="${e(photo.name)}"></a>`
    })
    const photoHtml = photoViews.length
      ? `<div class="insulation-map-photos">${photoViews.join('')}</div>`
      : '<div class="insulation-map-photo-empty">暂无现场照片</div>'
    const bolts = Array.from({ length: 4 }, (_, boltIndex) =>
      `<div><span>螺栓 ${boltIndex + 1}</span><b>${formatResistance(reading?.bolt_resistances[boltIndex])}</b></div>`,
    ).join('')
    const content = htmlElement(
      `insulation-map-marker${complete ? ' is-complete' : ' is-pending'}`,
      `<div class="insulation-map-card"><header><span>引入口</span><strong>${e(inlet.ecode || inlet.fid)}</strong><i class="${complete ? 'complete' : ''}">${complete ? '数据完整' : '待录入'}</i></header><div class="insulation-map-values">${bolts}<div class="is-flange"><span>上下法兰之间</span><b>${formatResistance(reading?.flange_resistance)}</b></div></div>${photoHtml}</div><div class="insulation-map-pin"><span>${index + 1}</span></div>`,
    )
    content.addEventListener('click', (event) => event.stopPropagation())
    const item = new AMapApi.Marker({
      position: [inlet.lng, inlet.lat],
      content,
      anchor: 'bottom-center',
      offset: new AMapApi.Pixel(0, -4),
      zIndex: 900 + index,
      clickable: true,
      bubble: false,
    })
    content.addEventListener('mouseenter', () => item.setzIndex?.(1800))
    content.addEventListener('mouseleave', () => item.setzIndex?.(900 + index))
    add('insulation', item)
  })

  // 数据模块切换时只更换图层，保留用户当前的地图中心和缩放级别。
}

function handleInsulationDataChange(event: Event) {
  const unitId = Number((event as CustomEvent<{ unitId?: number }>).detail?.unitId)
  if (!Number.isFinite(unitId) || unitId === store.selectedUnit?.id) void renderInsulation()
}

function clearSoilLayer() {
  soilRenderSequence++
  clearKind('soil')
  soilPhotoUrls.forEach((url) => URL.revokeObjectURL(url))
  soilPhotoUrls.clear()
}

function formatSoilValue(value: number | null | undefined, unit = ''): string {
  return value === null || value === undefined ? '—' : `${Number(value).toLocaleString('zh-CN')}${unit ? ` ${unit}` : ''}`
}

async function renderSoilResistivity() {
  clearSoilLayer()
  if (!map || props.activeDataModule !== 'SOIL_RESISTIVITY' || !store.selectedUnit) return
  const sequence = soilRenderSequence
  const unitId = store.selectedUnit.id
  const record = [...store.records]
    .filter((item) => item.unit_id === unitId && item.item_code === 'SOIL_RESISTIVITY')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
  const points = soilResistivityPoints(record).filter(hasSoilCoordinates)
  const photoEntries = await Promise.all(points.map(async (point) => {
    try {
      return [point.id, await listInspectionPhotos(soilPhotoOwnerKey(unitId, point.id))] as const
    } catch (error) {
      console.warn(`[Soil] ${point.name} 照片读取失败：`, error)
      return [point.id, []] as const
    }
  }))
  if (sequence !== soilRenderSequence || props.activeDataModule !== 'SOIL_RESISTIVITY' || store.selectedUnit?.id !== unitId) return
  const photosByPoint = new Map(photoEntries)

  points.forEach((point, index) => {
    const photos = photosByPoint.get(point.id) ?? []
    const builtInPhotoHtml = point.photo_urls.map((photo) =>
      `<a href="${e(photo.url)}" target="_blank" rel="noopener noreferrer" title="${e(photo.name)}"><img src="${e(photo.url)}" alt="${e(photo.name)}"></a>`,
    )
    const savedPhotoHtml = photos.map((photo) => {
      const url = URL.createObjectURL(photo.blob)
      soilPhotoUrls.add(url)
      return `<a href="${e(url)}" target="_blank" rel="noopener noreferrer" title="${e(photo.name)}"><img src="${e(url)}" alt="${e(photo.name)}"></a>`
    })
    const photoItems = [...builtInPhotoHtml, ...savedPhotoHtml]
    const photoHtml = photoItems.length
      ? `<div class="soil-map-photos">${photoItems.join('')}</div>`
      : '<div class="soil-map-photo-empty">暂无现场照片</div>'
    const complete = point.ground_rod_count !== null && point.ground_rod_spacing !== null && point.resistivity !== null
    const content = htmlElement(
      `soil-map-marker${complete ? ' is-complete' : ' is-pending'}`,
      `<div class="soil-map-card"><header><span>测试位置</span><strong>${e(point.name)}</strong><i>${complete ? '数据完整' : '待录入'}</i></header><div class="soil-map-layout"><div class="soil-map-primary"><span>土壤电阻率</span><b>${formatSoilValue(point.resistivity, 'Ω·m')}</b></div><div class="soil-map-values"><div><span>地钎</span><b>${formatSoilValue(point.ground_rod_count, '根')}</b></div><div><span>间距</span><b>${formatSoilValue(point.ground_rod_spacing, 'm')}</b></div><div><span>电流 I</span><b>${formatSoilValue(point.test_current, 'mA')}</b></div><div><span>电压 U</span><b>${formatSoilValue(point.test_voltage, 'mV')}</b></div><div><span>电阻 R</span><b>${formatSoilValue(point.measured_resistance, 'Ω')}</b></div><div><span>系数 K</span><b>${formatSoilValue(point.geometric_coefficient)}</b></div></div><div class="soil-map-coords">${point.lng.toFixed(6)}, ${point.lat.toFixed(6)}</div>${photoHtml}</div></div><div class="soil-map-pin"><span>${index + 1}</span></div>`,
    )
    content.addEventListener('click', (event) => event.stopPropagation())
    const item = new AMapApi.Marker({
      position: [point.lng, point.lat],
      content,
      anchor: 'bottom-center',
      offset: new AMapApi.Pixel(0, -4),
      zIndex: 950 + index,
      clickable: true,
      bubble: false,
    })
    content.addEventListener('mouseenter', () => item.setzIndex?.(1850))
    content.addEventListener('mouseleave', () => item.setzIndex?.(950 + index))
    add('soil', item)
  })
  // 不在照片异步读取完成后再次自动定位，避免地图突然跳动。
}

function handleSoilDataChange(event: Event) {
  const unitId = Number((event as CustomEvent<{ unitId?: number }>).detail?.unitId)
  if (!Number.isFinite(unitId) || unitId === store.selectedUnit?.id) void renderSoilResistivity()
}

function clearDcStrayLayer() {
  dcStrayRenderSequence++
  clearKind('dcStray')
  dcStrayPhotoUrls.forEach((url) => URL.revokeObjectURL(url))
  dcStrayPhotoUrls.clear()
}

async function renderDcStrayCurrent() {
  clearDcStrayLayer()
  if (!map || props.activeDataModule !== 'DC_STRAY_CURRENT' || !store.selectedUnit) return
  const sequence = dcStrayRenderSequence
  const unitId = store.selectedUnit.id
  const record = [...store.records]
    .filter((item) => item.unit_id === unitId && item.item_code === 'DC_STRAY_CURRENT')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
  const points = dcStrayCurrentPoints(record).filter(hasDcStrayCoordinates)
  const photoEntries = await Promise.all(points.map(async (point) => {
    try {
      return [point.id, await listInspectionPhotos(dcStrayPhotoOwnerKey(unitId, point.id))] as const
    } catch (error) {
      console.warn(`[DC Stray] ${point.name} 照片读取失败：`, error)
      return [point.id, []] as const
    }
  }))
  if (sequence !== dcStrayRenderSequence || props.activeDataModule !== 'DC_STRAY_CURRENT' || store.selectedUnit?.id !== unitId) return
  const photosByPoint = new Map(photoEntries)

  points.forEach((point, index) => {
    const builtInPhotos = point.photo_urls.map((photo) => `<a href="${e(photo.url)}" target="_blank" rel="noopener noreferrer" title="${e(photo.name)}"><img src="${e(photo.url)}" alt="${e(photo.name)}"></a>`)
    const savedPhotos = (photosByPoint.get(point.id) ?? []).map((photo) => {
      const url = URL.createObjectURL(photo.blob)
      dcStrayPhotoUrls.add(url)
      return `<a href="${e(url)}" target="_blank" rel="noopener noreferrer" title="${e(photo.name)}"><img src="${e(url)}" alt="${e(photo.name)}"></a>`
    })
    const photoItems = [...builtInPhotos, ...savedPhotos]
    const photoHtml = photoItems.length ? `<div class="dc-map-photos">${photoItems.join('')}</div>` : '<div class="dc-map-photo-empty">暂无现场照片</div>'
    const readings = point.potential_readings.map((value, readingIndex) => `<div><span>样本 ${readingIndex + 1}</span><b>${Number(value).toFixed(4)} V</b></div>`).join('')
    const complete = point.potential_readings.length > 0
    const content = htmlElement(
      `dc-map-marker${complete ? ' is-complete' : ' is-pending'}`,
      `<div class="dc-map-card"><header><span>直流监测</span><strong>${e(point.name)}</strong><i>${complete ? '数据完整' : '待录入'}</i></header><div class="dc-map-primary"><span>平均管地电位</span><b>${formatSoilValue(point.average_potential, 'V')}</b></div><div class="dc-map-stats"><span>范围 <b>${formatSoilValue(point.min_potential, 'V')} ～ ${formatSoilValue(point.max_potential, 'V')}</b></span><span>波动 <b>${formatSoilValue(point.potential_fluctuation, 'mV')}</b></span><span>参比电极 <b>${e(point.reference_electrode)}</b></span></div><div class="dc-map-readings">${readings}</div><div class="dc-map-coords">${point.lng.toFixed(6)}, ${point.lat.toFixed(6)}</div>${photoHtml}</div><div class="dc-map-pin"><span>${index + 1}</span></div>`,
    )
    content.addEventListener('click', (event) => event.stopPropagation())
    const item = new AMapApi.Marker({ position: [point.lng, point.lat], content, anchor: 'bottom-center', offset: new AMapApi.Pixel(0, -4), zIndex: 970 + index, clickable: true, bubble: false })
    content.addEventListener('mouseenter', () => item.setzIndex?.(1900))
    content.addEventListener('mouseleave', () => item.setzIndex?.(970 + index))
    add('dcStray', item)
  })
}

function handleDcStrayDataChange(event: Event) {
  const unitId = Number((event as CustomEvent<{ unitId?: number }>).detail?.unitId)
  if (!Number.isFinite(unitId) || unitId === store.selectedUnit?.id) void renderDcStrayCurrent()
}

function clearCoatingLayer() {
  coatingRenderSequence++
  clearKind('coating')
  coatingPhotoUrls.forEach((url) => URL.revokeObjectURL(url))
  coatingPhotoUrls.clear()
}

async function renderCoatingDamage() {
  clearCoatingLayer()
  if (!map || props.activeDataModule !== 'COATING_DETECT' || !store.selectedUnit) return
  const sequence = coatingRenderSequence
  const unitId = store.selectedUnit.id
  const record = [...store.records]
    .filter((item) => item.unit_id === unitId && item.item_code === 'COATING_DETECT')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
  const points = coatingDamagePoints(record).filter(hasCoatingDamageCoordinates)
  const photoEntries = await Promise.all(points.map(async (point) => {
    try {
      return [point.id, await listInspectionPhotos(coatingDamagePhotoOwnerKey(unitId, point.id))] as const
    } catch (error) {
      console.warn(`[Coating] ${point.name} 照片读取失败：`, error)
      return [point.id, []] as const
    }
  }))
  if (sequence !== coatingRenderSequence || props.activeDataModule !== 'COATING_DETECT' || store.selectedUnit?.id !== unitId) return
  const photosByPoint = new Map(photoEntries)

  points.forEach((point, index) => {
    const builtInPhotos = point.photo_urls.map((photo) => `<a href="${e(photo.url)}" target="_blank" rel="noopener noreferrer" title="${e(photo.name)}"><img src="${e(photo.url)}" alt="${e(photo.name)}"></a>`)
    const savedPhotos = (photosByPoint.get(point.id) ?? []).map((photo) => {
      const url = URL.createObjectURL(photo.blob)
      coatingPhotoUrls.add(url)
      return `<a href="${e(url)}" target="_blank" rel="noopener noreferrer" title="${e(photo.name)}"><img src="${e(url)}" alt="${e(photo.name)}"></a>`
    })
    const photoItems = [...builtInPhotos, ...savedPhotos]
    const photoHtml = photoItems.length
      ? `<div class="coating-map-photos">${photoItems.join('')}</div>`
      : '<div class="coating-map-photo-empty">照片待上传</div>'
    const content = htmlElement(
      'coating-map-marker',
      `<div class="coating-map-card"><header><span>${e(point.building || '破损点')}</span><strong>${e(point.name)}</strong><i>${e(point.severity)}</i></header><div class="coating-map-location">${e(point.location_desc || '参考位置待补录')}</div><div class="coating-map-values"><div><span>埋深</span><b>${formatSoilValue(point.buried_depth, 'm')}</b></div><div><span>泄漏电位</span><b>${formatSoilValue(point.leakage_potential, 'mV')}</b></div><div><span>地表</span><b>${e(point.surface || '—')}</b></div><div><span>原始坐标</span><b>${formatSoilValue(point.source_x)}, ${formatSoilValue(point.source_y)}</b></div></div><div class="coating-map-coords">${point.lng.toFixed(6)}, ${point.lat.toFixed(6)}</div>${photoHtml}</div><div class="coating-map-pin" aria-label="防腐层破损点"><span>×</span></div>`,
    )
    content.addEventListener('click', (event) => event.stopPropagation())
    const item = new AMapApi.Marker({ position: [point.lng, point.lat], content, anchor: 'bottom-center', offset: new AMapApi.Pixel(0, -4), zIndex: 990 + index, clickable: true, bubble: false })
    content.addEventListener('mouseenter', () => item.setzIndex?.(1950))
    content.addEventListener('mouseleave', () => item.setzIndex?.(990 + index))
    add('coating', item)
  })
}

function handleCoatingDataChange(event: Event) {
  const unitId = Number((event as CustomEvent<{ unitId?: number }>).detail?.unitId)
  if (!Number.isFinite(unitId) || unitId === store.selectedUnit?.id) void renderCoatingDamage()
}

function clearPotentialLayer() {
  potentialRenderSequence++
  clearKind('potential')
  potentialPhotoUrls.forEach((url) => URL.revokeObjectURL(url))
  potentialPhotoUrls.clear()
}

async function renderPipeGroundPotential() {
  clearPotentialLayer()
  if (!map || props.activeDataModule !== 'PIPE_GROUND_POTENTIAL' || !store.selectedUnit) return
  const sequence = potentialRenderSequence
  const unitId = store.selectedUnit.id
  const inlets = (store.facilities?.inlets ?? [])
    .filter((inlet) => inlet.unit_id === unitId)
    .sort((a, b) => a.lng - b.lng || a.lat - b.lat)
  const record = [...store.records]
    .filter((item) => item.unit_id === unitId && item.item_code === 'PIPE_GROUND_POTENTIAL')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
  const readings = inletPotentialReadings(record)
  const photoEntries = await Promise.all(inlets.map(async (inlet) => {
    try {
      return [inlet.fid, await listInspectionPhotos(pipePotentialPhotoOwnerKey(unitId, inlet.fid))] as const
    } catch (error) {
      console.warn(`[Potential] ${inlet.ecode} 照片读取失败：`, error)
      return [inlet.fid, []] as const
    }
  }))
  if (sequence !== potentialRenderSequence || props.activeDataModule !== 'PIPE_GROUND_POTENTIAL' || store.selectedUnit?.id !== unitId) return
  const photosByInlet = new Map(photoEntries)

  inlets.forEach((inlet, index) => {
    const reading = readings.get(inlet.fid)
    const complete = hasNaturalPotential(reading)
    const photos = (photosByInlet.get(inlet.fid) ?? []).map((photo) => {
      const url = URL.createObjectURL(photo.blob)
      potentialPhotoUrls.add(url)
      return `<a href="${e(url)}" target="_blank" rel="noopener noreferrer" title="${e(photo.name)}"><img src="${e(url)}" alt="${e(photo.name)}"></a>`
    })
    const photoHtml = photos.length
      ? `<div class="potential-map-photos">${photos.join('')}</div>`
      : '<div class="potential-map-photo-empty">照片待上传</div>'
    const cardHtml = complete
      ? `<div class="potential-map-card"><header><span>引入口 ${index + 1}</span><strong>${e(inlet.ecode || String(inlet.fid))}</strong><i>已检测</i></header><div class="potential-map-primary"><span>自然电位</span><b>${Number(reading!.natural_potential).toFixed(4)} V</b></div><div class="potential-map-values"><div><span>参比电极</span><b>${e(reading?.reference_electrode || 'Cu/CuSO₄')}</b></div><div><span>测试方法</span><b>${e(reading?.test_method || '自然电位法')}</b></div><div><span>管号</span><b>${e(inlet.pipeno || '—')}</b></div><div><span>压力</span><b>${e(inlet.pressured || '—')}</b></div></div>${reading?.note ? `<div class="potential-map-note">${e(reading.note)}</div>` : ''}${photoHtml}</div>`
      : `<div class="potential-map-pending"><strong>${e(inlet.ecode || String(inlet.fid))}</strong><span>自然电位待录入</span></div>`
    const content = htmlElement(
      `potential-map-marker${complete ? ' is-complete' : ' is-pending'}`,
      `${cardHtml}<div class="potential-map-pin"><span>${index + 1}</span></div>`,
    )
    content.addEventListener('click', (event) => event.stopPropagation())
    const restingZIndex = complete ? 1650 : 1010 + index
    const item = new AMapApi.Marker({ position: [inlet.lng, inlet.lat], content, anchor: 'bottom-center', offset: new AMapApi.Pixel(0, -4), zIndex: restingZIndex, clickable: true, bubble: false })
    content.addEventListener('mouseenter', () => item.setzIndex?.(2050))
    content.addEventListener('mouseleave', () => item.setzIndex?.(restingZIndex))
    add('potential', item)
  })
}

function handlePotentialDataChange(event: Event) {
  const unitId = Number((event as CustomEvent<{ unitId?: number }>).detail?.unitId)
  if (!Number.isFinite(unitId) || unitId === store.selectedUnit?.id) void renderPipeGroundPotential()
}

function clearContinuityLayer() {
  continuityRenderSequence++
  clearKind('continuity')
  continuityPhotoUrls.forEach((url) => URL.revokeObjectURL(url))
  continuityPhotoUrls.clear()
}

async function renderElectricContinuity() {
  clearContinuityLayer()
  if (!map || props.activeDataModule !== 'ELECTRIC_CONTINUITY' || !store.selectedUnit) return
  const sequence = continuityRenderSequence
  const unitId = store.selectedUnit.id
  const record = [...store.records]
    .filter((item) => item.unit_id === unitId && item.item_code === 'ELECTRIC_CONTINUITY')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
  const points = electricContinuityPoints(record).filter(hasElectricContinuityCoordinates)
  const photoEntries = await Promise.all(points.map(async (point) => {
    try {
      return [point.id, await listInspectionPhotos(electricContinuityPhotoOwnerKey(unitId, point.id))] as const
    } catch (error) {
      console.warn(`[Continuity] ${point.name} 照片读取失败：`, error)
      return [point.id, []] as const
    }
  }))
  if (sequence !== continuityRenderSequence || props.activeDataModule !== 'ELECTRIC_CONTINUITY' || store.selectedUnit?.id !== unitId) return
  const photosByPoint = new Map(photoEntries)

  points.forEach((point, index) => {
    const builtInPhotos = point.photo_urls.map((photo) => `<a href="${e(photo.url)}" target="_blank" rel="noopener noreferrer" title="${e(photo.name)}"><img src="${e(photo.url)}" alt="${e(photo.name)}"></a>`)
    const savedPhotos = (photosByPoint.get(point.id) ?? []).map((photo) => {
      const url = URL.createObjectURL(photo.blob)
      continuityPhotoUrls.add(url)
      return `<a href="${e(url)}" target="_blank" rel="noopener noreferrer" title="${e(photo.name)}"><img src="${e(url)}" alt="${e(photo.name)}"></a>`
    })
    const photos = [...builtInPhotos, ...savedPhotos]
    const photoHtml = photos.length
      ? `<div class="continuity-map-photos">${photos.join('')}</div>`
      : '<div class="continuity-map-photo-empty">照片待上传</div>'
    const complete = hasElectricContinuityResult(point)
    const statusClass = point.is_connected === true ? ' is-connected' : point.is_connected === false ? ' is-isolated' : ''
    const cardHtml = complete
      ? `<div class="continuity-map-card"><header><span>测试位置 ${index + 1}</span><strong>${e(point.name)}</strong><i>${e(point.conclusion)}</i></header><div class="continuity-map-primary"><span>测试电阻</span><b>${Number(point.measured_resistance).toFixed(1)} ${e(point.resistance_unit)}</b></div><div class="continuity-map-values"><div><span>测试对象</span><b>${e(point.target_type)}</b></div><div><span>测试方法</span><b>${e(String(record?.result_data?.method ?? '电阻测量法'))}</b></div></div><div class="continuity-map-coords">${point.lng.toFixed(6)}, ${point.lat.toFixed(6)}</div>${point.note ? `<div class="continuity-map-note">${e(point.note)}</div>` : ''}${photoHtml}</div>`
      : `<div class="continuity-map-pending"><strong>${e(point.name)}</strong><span>电联通性待录入</span></div>`
    const content = htmlElement(
      `continuity-map-marker${complete ? ' is-complete' : ' is-pending'}${statusClass}`,
      `${cardHtml}<div class="continuity-map-pin"><span>↔</span></div>`,
    )
    content.addEventListener('click', (event) => event.stopPropagation())
    const restingZIndex = complete ? 1660 : 1020 + index
    const item = new AMapApi.Marker({ position: [point.lng, point.lat], content, anchor: 'bottom-center', offset: new AMapApi.Pixel(0, -4), zIndex: restingZIndex, clickable: true, bubble: false })
    content.addEventListener('mouseenter', () => item.setzIndex?.(2060))
    content.addEventListener('mouseleave', () => item.setzIndex?.(restingZIndex))
    add('continuity', item)
  })
}

function handleElectricContinuityDataChange(event: Event) {
  const unitId = Number((event as CustomEvent<{ unitId?: number }>).detail?.unitId)
  if (!Number.isFinite(unitId) || unitId === store.selectedUnit?.id) void renderElectricContinuity()
}

function clearInletParameterLayer() {
  inletParameterRenderSequence++
  clearKind('inletParameter')
  inletParameterPhotoUrls.forEach((url) => URL.revokeObjectURL(url))
  inletParameterPhotoUrls.clear()
}

async function renderInletParameters() {
  clearInletParameterLayer()
  if (!map || props.activeDataModule !== 'INLET_PARAM' || !store.selectedUnit) return
  const sequence = inletParameterRenderSequence
  const unitId = store.selectedUnit.id
  const inlets = (store.facilities?.inlets ?? []).filter((inlet) => inlet.unit_id === unitId).sort((a, b) => a.lng - b.lng || a.lat - b.lat)
  const record = [...store.records].filter((item) => item.unit_id === unitId && item.item_code === 'INLET_PARAM').sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
  const readings = inletParameterReadings(record)
  const photoEntries = await Promise.all(inlets.map(async (inlet) => {
    try { return [inlet.fid, await listInspectionPhotos(inletParameterPhotoOwnerKey(unitId, inlet.fid))] as const }
    catch (error) { console.warn(`[InletParameter] ${inlet.ecode} 照片读取失败：`, error); return [inlet.fid, []] as const }
  }))
  if (sequence !== inletParameterRenderSequence || props.activeDataModule !== 'INLET_PARAM' || store.selectedUnit?.id !== unitId) return
  const photosByInlet = new Map(photoEntries)

  inlets.forEach((inlet, index) => {
    const reading = readings.get(inlet.fid)
    const complete = hasInletParameterResult(reading)
    const photos = (photosByInlet.get(inlet.fid) ?? []).map((photo) => {
      const url = URL.createObjectURL(photo.blob); inletParameterPhotoUrls.add(url)
      return `<a href="${e(url)}" target="_blank" rel="noopener noreferrer" title="${e(photo.name)}"><img src="${e(url)}" alt="${e(photo.name)}"></a>`
    })
    const photoHtml = photos.length ? `<div class="inlet-parameter-map-photos">${photos.join('')}</div>` : '<div class="inlet-parameter-map-photo-empty">照片待上传</div>'
    const readingsHtml = reading?.diameter_readings.length
      ? `<div class="inlet-parameter-map-readings">${reading.diameter_readings.map((value, i) => `<span>测量${i + 1}<b>${value.toFixed(1)} mm</b></span>`).join('')}</div>`
      : ''
    const cardHtml = complete
      ? `<div class="inlet-parameter-map-card"><header><span>引入口 ${index + 1}</span><strong>${e(inlet.ecode || String(inlet.fid))}</strong><i>已检测</i></header><div class="inlet-parameter-map-primary"><span>平均外径</span><b>${Number(reading!.average_diameter).toFixed(1)} mm</b></div>${readingsHtml}<div class="inlet-parameter-map-values"><div><span>最大偏差</span><b>${reading?.diameter_difference?.toFixed(2) ?? '—'} mm</b></div><div><span>不圆度</span><b>${reading?.out_of_roundness?.toFixed(3) ?? '—'} %</b></div><div><span>壁厚</span><b>${reading?.wall_thickness !== null && reading?.wall_thickness !== undefined ? `${reading.wall_thickness.toFixed(2)} mm` : '待录入'}</b></div><div><span>仪器</span><b>${e(reading?.instrument || '数显游标卡尺')}</b></div></div>${reading?.note ? `<div class="inlet-parameter-map-note">${e(reading.note)}</div>` : ''}${photoHtml}</div>`
      : `<div class="inlet-parameter-map-pending"><strong>${e(inlet.ecode || String(inlet.fid))}</strong><span>引入口参数待录入</span></div>`
    const content = htmlElement(`inlet-parameter-map-marker${complete ? ' is-complete' : ' is-pending'}`, `${cardHtml}<div class="inlet-parameter-map-pin"><span>Ø</span></div>`)
    content.addEventListener('click', (event) => event.stopPropagation())
    const restingZIndex = complete ? 1670 : 1030 + index
    const item = new AMapApi.Marker({ position: [inlet.lng, inlet.lat], content, anchor: 'bottom-center', offset: new AMapApi.Pixel(0, -4), zIndex: restingZIndex, clickable: true, bubble: false })
    content.addEventListener('mouseenter', () => item.setzIndex?.(2070)); content.addEventListener('mouseleave', () => item.setzIndex?.(restingZIndex))
    add('inletParameter', item)
  })
}

function handleInletParameterDataChange(event: Event) {
  const unitId = Number((event as CustomEvent<{ unitId?: number }>).detail?.unitId)
  if (!Number.isFinite(unitId) || unitId === store.selectedUnit?.id) void renderInletParameters()
}

function groupsByCommunity() {
  const groups = new Map<string, CorrosionUnit[]>()
  store.units.forEach((unit) => {
    const name = (unit.address || '').split('·')[0].trim() || '未分类'
    groups.set(name, [...(groups.get(name) ?? []), unit])
  })
  return groups
}

function averageProgress(units: CorrosionUnit[]) {
  return units.length ? units.reduce((sum, unit) => sum + (unit.inspection_progress || 0), 0) / units.length : 0
}

/** 使用可见几何范围的包围盒中心，避免顶点数量不均造成算术平均中心偏移。 */
function boundsCenter(points: Array<[number, number]>): [number, number] | null {
  const valid = points.filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
  if (!valid.length) return null
  let minLng = Infinity
  let maxLng = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  valid.forEach(([lng, lat]) => {
    minLng = Math.min(minLng, lng)
    maxLng = Math.max(maxLng, lng)
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
  })
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2]
}

function focusCommunity(name: string, position: [number, number]) {
  map.setZoomAndCenter(18, position, false, 800)
  emit('community-focus', name)
}

function renderCommunities() {
  clearKind('community')
  const groups = groupsByCommunity()
  const boundaries = store.facilities?.communityBoundaries ?? []
  const rendered = new Set<string>()

  boundaries.forEach((boundary) => {
    const units = groups.get(boundary.name) ?? []
    const progress = averageProgress(units)
    const exception = units.some((unit) => unit.inspection_status === 'exception')
    const color = communityColor(progress, exception)
    const path = boundary.rings.filter((ring) => ring.length >= 3)
    const polygon = new AMapApi.Polygon({ path, strokeColor: color, strokeWeight: 2, strokeOpacity: 1, fillColor: color, fillOpacity: 0.6, zIndex: 100, bubble: false })
    const center = boundsCenter(path.flat()) ?? boundary.center
    const length = (store.facilities?.pipes ?? []).filter((pipe) => pipe.community === boundary.name).reduce((sum, pipe) => sum + (Number.parseFloat(pipe.length) || 0), 0)
    const info = marker({ position: center, className: 'community-boundary-info', html: boundaryInfoHtml(boundary.name, progress, units.length, length), size: [220, 96], zIndex: 610 })
    const active = (value: boolean) => {
      polygon.setOptions({ strokeWeight: value ? 4 : 2, fillOpacity: value ? 0.8 : 0.6 })
      ;((info as any).__content as HTMLElement).classList.toggle('hovered', value)
    }
    polygon.on('mouseover', () => active(true))
    polygon.on('mouseout', () => active(false))
    polygon.on('click', () => focusCommunity(boundary.name, center))
    info.on('mouseover', () => active(true))
    info.on('mouseout', () => active(false))
    info.on('click', () => focusCommunity(boundary.name, center))
    add('community', polygon)
    add('community', info)
    rendered.add(boundary.name)
  })

  let index = 0
  groups.forEach((units, name) => {
    if (rendered.has(name)) return
    const positions: Array<[number, number]> = []
    units.forEach((unit) => {
      if (unit.polyline && unit.polyline.length >= 3) {
        unit.polyline.forEach(([lat, lng]) => positions.push([lng, lat]))
      } else if (unit.lng && unit.lat) {
        positions.push([unit.lng, unit.lat])
      }
    })
    if (!positions.length) return
    const center = boundsCenter(positions)
    if (!center) return
    const progress = averageProgress(units)
    const item = marker({ position: center, className: 'community-progress-marker', html: communityHtml(name, units.length, progress, units.some((unit) => unit.inspection_status === 'exception'), index++), size: [130, 130], zIndex: 600 })
    item.on('click', () => focusCommunity(name, center))
    add('community', item)
  })
}

/** 三里边界文字仅在初始化层级及以上显示，继续缩小时隐藏以避免画面拥挤。 */
function syncCommunityInfoVisibility() {
  if (!map) return
  const visible = isCommunityView && map.getZoom() >= COMMUNITY_INFO_MIN_ZOOM
  overlays.community.forEach((overlay) => {
    const content = (overlay as any).__content as HTMLElement | undefined
    if (!content?.classList.contains('community-boundary-info')) return
    visible ? overlay.show() : overlay.hide()
  })
}

function applyVisibility() {
  if (!map) return
  if (isCommunityView) {
    setShown('community', true)
    ;(['unit', 'pipe', 'joint', 'regulator', 'inlet'] as FacilityKey[]).forEach((kind) => setShown(kind, false))
    setShown('insulation', false)
    setShown('soil', false)
    setShown('dcStray', false)
    setShown('coating', false)
    setShown('potential', false)
    setShown('continuity', false)
    setShown('inletParameter', false)
    syncCommunityInfoVisibility()
    return
  }
  setShown('community', false)
  if (props.activeDataModule === 'JOINT_VERIFY') {
    setShown('unit', true)
    setShown('pipe', true)
    setShown('joint', false)
    setShown('regulator', false)
    setShown('inlet', false)
    setShown('insulation', true)
    setShown('soil', false)
    setShown('dcStray', false)
    setShown('coating', false)
    setShown('potential', false)
    setShown('continuity', false)
    setShown('inletParameter', false)
    return
  }
  if (props.activeDataModule === 'SOIL_RESISTIVITY') {
    setShown('unit', true)
    setShown('pipe', true)
    setShown('joint', false)
    setShown('regulator', false)
    setShown('inlet', false)
    setShown('insulation', false)
    setShown('soil', true)
    setShown('dcStray', false)
    setShown('coating', false)
    setShown('potential', false)
    setShown('continuity', false)
    setShown('inletParameter', false)
    return
  }
  if (props.activeDataModule === 'DC_STRAY_CURRENT') {
    setShown('unit', true)
    setShown('pipe', true)
    setShown('joint', false)
    setShown('regulator', false)
    setShown('inlet', false)
    setShown('insulation', false)
    setShown('soil', false)
    setShown('dcStray', true)
    setShown('coating', false)
    setShown('potential', false)
    setShown('continuity', false)
    setShown('inletParameter', false)
    return
  }
  if (props.activeDataModule === 'COATING_DETECT') {
    setShown('unit', true)
    setShown('pipe', true)
    setShown('joint', false)
    setShown('regulator', false)
    setShown('inlet', false)
    setShown('insulation', false)
    setShown('soil', false)
    setShown('dcStray', false)
    setShown('coating', true)
    setShown('potential', false)
    setShown('continuity', false)
    setShown('inletParameter', false)
    return
  }
  if (props.activeDataModule === 'PIPE_GROUND_POTENTIAL') {
    setShown('unit', true)
    setShown('pipe', true)
    setShown('joint', false)
    setShown('regulator', false)
    setShown('inlet', false)
    setShown('insulation', false)
    setShown('soil', false)
    setShown('dcStray', false)
    setShown('coating', false)
    setShown('potential', true)
    setShown('continuity', false)
    setShown('inletParameter', false)
    return
  }
  if (props.activeDataModule === 'ELECTRIC_CONTINUITY') {
    setShown('unit', true)
    setShown('pipe', true)
    setShown('joint', false)
    setShown('regulator', false)
    setShown('inlet', false)
    setShown('insulation', false)
    setShown('soil', false)
    setShown('dcStray', false)
    setShown('coating', false)
    setShown('potential', false)
    setShown('continuity', true)
    setShown('inletParameter', false)
    return
  }
  if (props.activeDataModule === 'INLET_PARAM') {
    setShown('unit', true)
    setShown('pipe', true)
    setShown('joint', false)
    setShown('regulator', false)
    setShown('inlet', false)
    setShown('insulation', false)
    setShown('soil', false)
    setShown('dcStray', false)
    setShown('coating', false)
    setShown('potential', false)
    setShown('continuity', false)
    setShown('inletParameter', true)
    return
  }
  ;(['unit', 'pipe', 'joint', 'regulator', 'inlet'] as FacilityKey[]).forEach((kind) => setShown(kind, props.visibility[kind]))
  setShown('insulation', false)
  setShown('soil', false)
  setShown('dcStray', false)
  setShown('coating', false)
  setShown('potential', false)
  setShown('continuity', false)
  setShown('inletParameter', false)
}

function handleZoomEnd() {
  syncViewMode()
  syncCommunityInfoVisibility()
}

function syncViewMode() {
  if (!map) return
  const next = map.getZoom() < COMMUNITY_VIEW_ZOOM
  if (next === isCommunityView) return
  // 从设施详情地图切换到小区总览时，不保留任何设施或控制单元选中状态。
  if (next) {
    clearAll()
    if (store.hoveredUnit) store.hoverUnit(null)
  }
  isCommunityView = next
  applyVisibility()
  emit('view-mode', next ? 'community' : 'detail')
}

function fitToAll() {
  if (!map || !store.units.length) return
  const candidates = store.units.filter((unit) => unit.lng && unit.lat).map((unit) => new AMapApi.Marker({ position: [unit.lng!, unit.lat!] }))
  if (candidates.length) map.setFitView(candidates, false, [60, 60, 60, 60], 16)
}

function renderAll() {
  if (!map || !store.facilities) return
  clearFacilitySelection()
  renderUnits()
  renderPipes()
  renderJoints()
  renderRegulators()
  renderInlets()
  renderCommunities()
  void renderInsulation()
  void renderSoilResistivity()
  void renderDcStrayCurrent()
  void renderCoatingDamage()
  void renderPipeGroundPotential()
  void renderElectricContinuity()
  void renderInletParameters()
  applyVisibility()
  fitToAll()
}

function zoomToCommunityView() {
  if (!map) return
  clearAll()
  if (store.hoveredUnit) store.hoverUnit(null)
  if (map.getZoom() > 16) map.setZoom(16, false, 600)
}

function invalidate() {
  map?.resize?.()
}

defineExpose({ zoomToCommunityView, invalidate })

onMounted(async () => {
  if (!mapRef.value) return
  try {
    AMapApi = await loadAMap()
    map = new AMapApi.Map(mapRef.value, {
      viewMode: '2D',
      mapStyle: currentMapStyle(),
      zoom: 16,
      zooms: [3, MAX_ZOOM],
      center: [116.494, 39.757],
      resizeEnable: true,
      animateEnable: true,
      jogEnable: false,
      showLabel: true,
    })
    infoWindow = new AMapApi.InfoWindow({ isCustom: true, offset: new AMapApi.Pixel(0, -12), autoMove: false })
    map.addControl(new AMapApi.Scale())
    map.addControl(new AMapApi.ToolBar({ position: 'RT' }))
    map.on('click', clearAll)
    map.on('zoomend', handleZoomEnd)
    window.addEventListener('themechange', handleThemeChange)
    window.addEventListener('insulationdatachange', handleInsulationDataChange)
    window.addEventListener('soilresistivitydatachange', handleSoilDataChange)
    window.addEventListener('dcstraycurrentdatachange', handleDcStrayDataChange)
    window.addEventListener('coatingdetectdatachange', handleCoatingDataChange)
    window.addEventListener('pipegroundpotentialdatachange', handlePotentialDataChange)
    window.addEventListener('electriccontinuitydatachange', handleElectricContinuityDataChange)
    window.addEventListener('inletparameterdatachange', handleInletParameterDataChange)
    isCommunityView = map.getZoom() < COMMUNITY_VIEW_ZOOM
    renderAll()
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '高德地图加载失败'
    ElMessage.error(loadError.value)
  } finally {
    loading.value = false
  }
})

watch(() => store.facilities, () => renderAll(), { deep: false })
watch(() => props.visibility, applyVisibility, { deep: true })
watch(() => props.dataModuleMode, (active) => {
  if (active) clearFacilitySelection()
})
watch(() => props.activeDataModule, () => {
  applyVisibility()
  void renderInsulation()
  void renderSoilResistivity()
  void renderDcStrayCurrent()
  void renderCoatingDamage()
  void renderPipeGroundPotential()
  void renderElectricContinuity()
  void renderInletParameters()
})
watch(
  () => store.records.filter((record) => record.item_code === 'JOINT_VERIFY').map((record) => `${record.id}:${record.updated_at}`).join(','),
  () => void renderInsulation(),
)
watch(
  () => store.records.filter((record) => record.item_code === 'SOIL_RESISTIVITY').map((record) => `${record.id}:${record.updated_at}`).join(','),
  () => void renderSoilResistivity(),
)
watch(
  () => store.records.filter((record) => record.item_code === 'DC_STRAY_CURRENT').map((record) => `${record.id}:${record.updated_at}`).join(','),
  () => void renderDcStrayCurrent(),
)
watch(
  () => store.records.filter((record) => record.item_code === 'COATING_DETECT').map((record) => `${record.id}:${record.updated_at}`).join(','),
  () => void renderCoatingDamage(),
)
watch(
  () => store.records.filter((record) => record.item_code === 'PIPE_GROUND_POTENTIAL').map((record) => `${record.id}:${record.updated_at}`).join(','),
  () => void renderPipeGroundPotential(),
)
watch(
  () => store.records.filter((record) => record.item_code === 'ELECTRIC_CONTINUITY').map((record) => `${record.id}:${record.updated_at}`).join(','),
  () => void renderElectricContinuity(),
)
watch(
  () => store.records.filter((record) => record.item_code === 'INLET_PARAM').map((record) => `${record.id}:${record.updated_at}`).join(','),
  () => void renderInletParameters(),
)
watch(
  () => store.units.map((unit) => `${unit.id}:${unit.inspection_progress.toFixed(3)}:${unit.inspection_status}`).join(','),
  () => {
    if (!map) return
    renderUnits()
    renderCommunities()
    applyVisibility()
  },
)
watch(() => store.selectedUnit?.id, (next, previous) => {
  if (previous !== undefined) setUnitStyle(previous, store.hoveredUnit?.id === previous ? 'hover' : 'default')
  if (next !== undefined) {
    clearFacilitySelection()
    setUnitStyle(next, 'selected')
  }
  void renderInsulation()
  void renderSoilResistivity()
  void renderDcStrayCurrent()
  void renderCoatingDamage()
  void renderPipeGroundPotential()
  void renderElectricContinuity()
  void renderInletParameters()
})
watch(() => store.hoveredUnit?.id, (next, previous) => {
  if (previous !== undefined && previous !== store.selectedUnit?.id) setUnitStyle(previous, 'default')
  if (next !== undefined && next !== store.selectedUnit?.id) setUnitStyle(next, 'hover')
})
watch(() => store.selectedUnit, (unit) => {
  if (!map || !unit?.lng || !unit.lat) return
  const current = map.lngLatToContainer([unit.lng, unit.lat])
  const center = map.getContainer().getBoundingClientRect()
  const distance = Math.hypot(current.getX() - center.width / 2, current.getY() - center.height / 2)
  if (distance < 50 && map.getZoom() >= DETAIL_ZOOM) return
  map.setZoomAndCenter(DETAIL_ZOOM, [unit.lng, unit.lat], false, 600)
}, { deep: false })

onBeforeUnmount(() => {
  window.removeEventListener('themechange', handleThemeChange)
  window.removeEventListener('insulationdatachange', handleInsulationDataChange)
  window.removeEventListener('soilresistivitydatachange', handleSoilDataChange)
  window.removeEventListener('dcstraycurrentdatachange', handleDcStrayDataChange)
  window.removeEventListener('coatingdetectdatachange', handleCoatingDataChange)
  window.removeEventListener('pipegroundpotentialdatachange', handlePotentialDataChange)
  window.removeEventListener('electriccontinuitydatachange', handleElectricContinuityDataChange)
  window.removeEventListener('inletparameterdatachange', handleInletParameterDataChange)
  clearInsulationLayer()
  clearSoilLayer()
  clearDcStrayLayer()
  clearCoatingLayer()
  clearPotentialLayer()
  clearContinuityLayer()
  clearInletParameterLayer()
  clearFacilitySelection()
  if (store.selectedUnit) store.selectUnit(null)
  if (store.hoveredUnit) store.hoverUnit(null)
  infoWindow?.close()
  map?.destroy()
  map = null
  AMapApi = null
})
</script>

<template>
  <div class="amap-main-wrapper">
    <div ref="mapRef" id="map" class="amap-main-map"></div>
    <div v-if="loading" class="amap-map-state">正在加载高德地图…</div>
    <div v-else-if="loadError" class="amap-map-state amap-map-error">
      <strong>地图加载失败</strong>
      <span>{{ loadError }}</span>
    </div>
  </div>
</template>

<style scoped>
.amap-main-wrapper,
.amap-main-map {
  width: 100%;
  height: 100%;
}
.amap-main-wrapper {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.amap-map-state {
  position: absolute;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.92);
  color: #606266;
}
.amap-map-error {
  flex-direction: column;
  color: #f56c6c;
}
</style>
