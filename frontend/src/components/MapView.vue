<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { STATUS_COLORS } from '@/types/items'
import { useCpStore } from '@/stores/cp'
import { loadAMap } from '@/map/amap-loader'
import { escapeHtml as e } from '@/utils/html'
import type { CorrosionUnit } from '@/types/models'

const emit = defineEmits<{
  (e: 'select', unit: CorrosionUnit): void
  (e: 'community-focus', name: string): void
  (e: 'view-mode', mode: 'community' | 'detail'): void
}>()

export type FacilityKey = 'unit' | 'pipe' | 'joint' | 'regulator' | 'inlet'
export type FacilityVisibility = Record<FacilityKey, boolean>

const props = withDefaults(defineProps<{
  units: CorrosionUnit[]
  points: unknown[]
  visibility?: FacilityVisibility
}>(), {
  visibility: () => ({ unit: true, pipe: true, joint: true, regulator: true, inlet: true }),
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

const overlays: Record<FacilityKey | 'community', any[]> = {
  unit: [], pipe: [], joint: [], regulator: [], inlet: [], community: [],
}
const unitPolygons = new Map<number, any>()
const unitMarkers = new Map<number, any>()

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
  if (store.selectedUnit) store.selectUnit(null)
}

function selectFacility(kind: FacilityKey, overlay: any) {
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
    syncCommunityInfoVisibility()
    return
  }
  setShown('community', false)
  ;(['unit', 'pipe', 'joint', 'regulator', 'inlet'] as FacilityKey[]).forEach((kind) => setShown(kind, props.visibility[kind]))
}

function handleZoomEnd() {
  syncViewMode()
  syncCommunityInfoVisibility()
}

function syncViewMode() {
  if (!map) return
  const next = map.getZoom() < COMMUNITY_VIEW_ZOOM
  if (next === isCommunityView) return
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
  applyVisibility()
  fitToAll()
}

function zoomToCommunityView() {
  if (!map) return
  if (store.selectedUnit) store.selectUnit(null)
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
