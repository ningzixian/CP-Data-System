<script setup lang="ts">
/**
 * 地图视图
 *
 * 所有数据从 store 获取：
 *   - units（含 polyline 边界）来自 store.units（CSV 加载）
 *   - points（绝缘接头）来自 store.points
 *   - pipes / regulators / inlets 来自 store.facilities
 */
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import L, { type Map as LeafletMap, type LayerGroup, type Marker } from 'leaflet'
import { STATUS_COLORS } from '@/types/items'
import { useCpStore } from '@/stores/cp'
import type { CorrosionUnit } from '@/types/models'

// 高德瓦片（国内合规免费，无需 key）
const AMAP_URL = 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}'

const emit = defineEmits<{
  (e: 'select', u: CorrosionUnit): void
  (e: 'detail', u: CorrosionUnit): void
  (e: 'community-focus', name: string): void
}>()
const store = useCpStore()

const mapRef = ref<HTMLDivElement | null>(null)
let map: LeafletMap | null = null

// 图层
let unitPolyLayer: LayerGroup | null = null   // 控制单元多边形（外环）
const unitPolyMap = new Map<number, any>()    // unitId -> polygon ref（用于 hover/selected 高亮同步）
const unitMarkerMap = new Map<number, any>()  // unitId -> 进度圆圈 marker ref（用于同步 border 颜色）
let pipeLayer: LayerGroup | null = null       // 低压管道
let jointLayer: LayerGroup | null = null      // 绝缘接头（红叉）
let regulatorLayer: LayerGroup | null = null  // 调压箱
let inletLayer: LayerGroup | null = null      // 引入口
let unitMarkerLayer: LayerGroup | null = null // 单元业务标记（圆+百分比）

// 缩放阈值：zoom < COMMUNITY_VIEW_ZOOM 时切换到"小区概览"模式
// （隐藏管线/引入口/控制单元进度圆圈，显示小区合并多边形 + 大进度圆圈）
const COMMUNITY_VIEW_ZOOM = 17
let isCommunityView = false

// 小区概览图层（zoom < 15 时显示）
let communityLayer: LayerGroup | null = null
let communityMarkerLayer: LayerGroup | null = null

// ============== 图标 ==============
function buildUnitMarkerIcon(status: string, progress: number) {
  const color = STATUS_COLORS[status] || '#909399'
  return L.divIcon({
    className: 'unit-marker',
    html: `<div style="
      background:${color};color:#fff;border-radius:50%;width:38px;height:38px;
      display:flex;align-items:center;justify-content:center;
      border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.35);
      font-weight:600;font-size:11px;font-family:-apple-system,sans-serif;">${Math.round(progress * 100)}%</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  })
}

function buildJointIcon() {
  return L.divIcon({
    className: 'joint-marker',
    html: `<div style="
      color:#f56c6c;font-size:22px;font-weight:900;line-height:22px;
      text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 3px #fff;
      font-family:Arial,sans-serif;">✕</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  })
}

/** 进度圆圈 divIcon
 *  - borderColor：边框颜色（#fff 默认 / #fdd835 selected）
 *  - fillColorOverride：可选，覆盖 status 默认的内部色
 *  - size：圆圈直径（默认 50；hover/selected 放大到 62）
 *  - fontSize：圆圈内数字字号（默认 14；hover/selected 放大到 18）
 *
 *  容器固定 64×64，内部 div 动态变化（用 CSS transition 平滑过渡）；
 *  外层 className `.unit-progress-marker` 通过 flex 让内部 div 始终居中。
 */
function buildProgressIcon(unit: any, borderColor: string, fillColorOverride?: string, size = 50, fontSize = 14) {
  const fill = fillColorOverride || STATUS_COLORS[unit.inspection_status] || '#909399'
  return L.divIcon({
    className: 'unit-progress-marker',
    html: `<div style="
      background:${fill};
      color:#fff;border-radius:50%;
      width:${size}px;height:${size}px;
      display:flex;align-items:center;justify-content:center;
      border:2px solid ${borderColor};
      box-shadow:0 2px 8px rgba(0,0,0,0.35);
      font-weight:600;font-size:${fontSize}px;font-family:-apple-system,sans-serif;
      transition:width 0.25s ease,height 0.25s ease,font-size 0.25s ease,background 0.25s ease,border-color 0.25s ease;
    ">${Math.round(unit.inspection_progress * 100)}%</div>`,
    iconSize: [64, 64],
    iconAnchor: [32, 32],
  })
}

function buildRegulatorIcon() {
  return L.divIcon({
    className: 'regulator-marker',
    html: `<div style="
      background:#1890ff;color:#fff;border-radius:4px;width:32px;height:32px;
      display:flex;align-items:center;justify-content:center;
      border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);
      font-weight:700;font-size:14px;">调</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  })
}

function buildInletIcon() {
  return L.divIcon({
    className: 'inlet-marker',
    html: `<div style="
      background:#909399;color:#fff;border-radius:50%;width:14px;height:14px;
      border:1.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  })
}

/** 小区进度大圆圈（小区概览模式使用）
 *  - 显示百分比 + 小区名 + 单元数
 *  - 颜色优先级（异常最高，进度次之）：
 *      异常（任一单元 exception） → 红 #f56c6c
 *      100%                        → 绿 #67c23a（已完成）
 *      80-99%                      → 浅绿 #85ce61（即将完成）
 *      1-79%                       → 橙 #e6a23c（进行中）
 *      0%                          → 浅灰 #c0c4cc（未开始）
 */
function buildCommunityProgressIcon(name: string, unitCount: number, avgProgress: number, hasException = false) {
  const percent = Math.round(avgProgress * 100)
  const color = hasException ? '#f56c6c'
    : avgProgress >= 1 ? '#67c23a'
    : avgProgress >= 0.8 ? '#85ce61'
    : avgProgress > 0 ? '#e6a23c'
    : '#c0c4cc'
  return L.divIcon({
    className: 'community-progress-marker',
    html: `<div style="
      background:${color};color:#fff;border-radius:50%;
      width:130px;height:130px;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      border:4px solid #fff;box-shadow:0 6px 24px rgba(0,0,0,0.35);
      font-family:-apple-system,sans-serif;
      transition: background 0.4s ease;
    ">
      <div style="font-size:30px;font-weight:700;line-height:1;letter-spacing:0.5px">${percent}%</div>
      <div style="font-size:13px;margin-top:6px;opacity:0.95;font-weight:600">${name}</div>
      <div style="font-size:11px;margin-top:3px;opacity:0.85">${unitCount} 个单元</div>
    </div>`,
    iconSize: [130, 130],
    iconAnchor: [65, 65],
  })
}

// ============== 样式常量（顶层共享）==============
const POLY_STYLE_DEFAULT = {
  color: '#67c23a', weight: 2, opacity: 0.9,
  fillColor: '#67c23a', fillOpacity: 0.12,
  dashArray: '4, 4',
}
const POLY_STYLE_HOVER = {
  color: '#409eff', weight: 3, opacity: 1,
  fillColor: '#409eff', fillOpacity: 0.25,
  dashArray: null,
}
const POLY_STYLE_SELECTED = {
  color: '#7c3aed', weight: 3, opacity: 1,
  fillColor: '#7c3aed', fillOpacity: 0.28,
  dashArray: null,
}

function applyPolyStyle(poly: any, mode: 'default' | 'hover' | 'selected') {
  const s = mode === 'hover' ? POLY_STYLE_HOVER
    : mode === 'selected' ? POLY_STYLE_SELECTED
    : POLY_STYLE_DEFAULT
  poly.setStyle({
    color: s.color, weight: s.weight, opacity: s.opacity,
    fillColor: s.fillColor, fillOpacity: s.fillOpacity,
    dashArray: s.dashArray ?? undefined,
  })
}

/** 统一高亮入口：同时控制多边形样式 + 进度圆圈 border/fill/size
 *  mode: 'default' 还原 / 'hover' 蓝色 / 'selected' 紫色
 *  圆圈（同一 DOM 元素直接改 style，配合 divIcon 里的 CSS transition 平滑过渡）：
 *    default: 38px 白边 + 按 status 填充
 *    hover:   46px 白边 + 浅蓝填充
 *    selected:46px 黄边 + 标准蓝填充
 */
function highlightUnit(unitId: number, mode: 'default' | 'hover' | 'selected') {
  const poly = unitPolyMap.get(unitId)
  if (poly) applyPolyStyle(poly, mode)
  const mk = unitMarkerMap.get(unitId)
  if (mk) {
    const u = store.units.find((x) => x.id === unitId)
    if (!u) return
    const el = mk.getElement()?.firstElementChild as HTMLElement | null
    if (!el) return
    const isEnlarged = mode !== 'default'
    const size = isEnlarged ? 62 : 50
    const fontSize = isEnlarged ? 18 : 14
    const fill = mode === 'hover' ? '#5dadec'
      : mode === 'selected' ? '#409eff'
      : (STATUS_COLORS[u.inspection_status] || '#909399')
    const borderColor = mode === 'selected' ? '#fdd835' : '#fff'
    el.style.width = size + 'px'
    el.style.height = size + 'px'
    el.style.fontSize = fontSize + 'px'
    el.style.background = fill
    el.style.borderColor = borderColor
    // 层级：hover/selected 提到最上（zIndex 1000），默认压到最下（zIndex -1000，被管道/引入口覆盖）
    mk.setZIndexOffset(isEnlarged ? 1000 : -1000)
  }
}

// ============== 渲染 ==============
function renderUnitPolygons() {
  if (!map || !unitPolyLayer) return
  unitPolyLayer.clearLayers()
  unitPolyMap.clear()  // 清空引用缓存
  unitMarkerMap.clear()
  const fac = store.facilities
  if (!fac) return

  fac.units.forEach((u) => {
    if (!u.polyline || u.polyline.length < 3) return
    const latLngRing = u.polyline.map(([lat, lng]) => [lat, lng] as [number, number])
    const joints = fac.jointCountByUnit[u.id] ?? 0
    const inlets = fac.inletCountByUnit[u.id] ?? 0

    const poly: any = L.polygon(latLngRing, POLY_STYLE_DEFAULT)
    poly.bindTooltip(
      `<b>控制单元 ${u.name}</b><br/>` +
      `${u.note || '低压控制单元'}<br/>` +
      `绝缘接头：${joints} 个｜引入口：${inlets} 个`,
      { sticky: true },
    )

    // 初始样式：按 store.selectedUnit / hoveredUnit 判断
    if (store.selectedUnit?.id === u.id) applyPolyStyle(poly, 'selected')
    else if (store.hoveredUnit?.id === u.id) applyPolyStyle(poly, 'hover')

    // hover：交给 store.hoveredUnit 统一管理（避免与 watcher 冲突）
    poly.on('mouseover', () => {
      store.hoverUnit(u)
    })
    poly.on('mouseout', () => {
      // 只有当当前 hoveredUnit 仍然是这个 unit 时才清掉（避免快速切换时误清）
      if (store.hoveredUnit?.id === u.id) store.hoverUnit(null)
    })

    // click → 选中（阻止冒泡到 map，避免触发取消选中）
    poly.on('click', (e: any) => {
      L.DomEvent.stopPropagation(e)
      const unit = store.units.find((x) => x.id === u.id)
      if (unit) { store.selectUnit(unit); emit('select', unit) }
    })
    // dblclick → 打开详情（同时也会触发 click，但顺序是 click 先，dblclick 后）
    poly.on('dblclick', (e: any) => {
      L.DomEvent.stopPropagation(e)  // 阻止地图 dblclick 缩放
      const unit = store.units.find((x) => x.id === u.id)
      if (unit) { store.selectUnit(unit); emit('detail', unit) }
    })

    poly.addTo(unitPolyLayer!)
    unitPolyMap.set(u.id, poly)  // 存引用供后续高亮同步

    // 进度圆圈：单独放在多边形中心，编号通过 hover tooltip / 侧边栏查看
    // border：选中=黄边，其他=白边
    // fill：选中=紫填充，其他=按 status 默认色（hover 时圆圈也按 status 色，多边形高亮即可）
    const liveUnit = store.units.find((x) => x.id === u.id) || u
    const isSelected = store.selectedUnit?.id === u.id
    const borderColor = isSelected ? '#fdd835' : '#fff'
    const fillOverride = isSelected ? '#409eff' : undefined
    const size = isSelected ? 62 : 50
    const fontSize = isSelected ? 18 : 14
    const labelIcon = buildProgressIcon(liveUnit, borderColor, fillOverride, size, fontSize)
    if (u.lat && u.lng) {
      // 初始 zIndex = -1000（最下，被管道/引入口覆盖）；hover/selected 时通过 highlightUnit 提到最上
      const label = L.marker([u.lat, u.lng], { icon: labelIcon, interactive: false, zIndexOffset: -1000 })
      label.addTo(unitPolyLayer!)
      unitMarkerMap.set(u.id, label)
    }
  })
}

function renderPipes() {
  if (!map || !pipeLayer) return
  pipeLayer.clearLayers()
  const pipes = store.facilities?.pipes ?? []
  pipes.forEach((p) => {
    if (p.coords.length < 2) return
    const line = L.polyline(p.coords.map(([lng, lat]) => [lat, lng]), {
      color: '#67c23a', weight: 3, opacity: 0.75, lineCap: 'round', lineJoin: 'round',
    })
    line.bindTooltip(
      `<b>${p.pipeno || p.fid}</b><br/>` +
      `管材：${p.material || '—'}　外径：${p.diametero || '—'}mm<br/>` +
      `壁厚：${p.thickness || '—'}mm　长度：${p.length || '—'}m<br/>` +
      `压力：${p.pressured}`,
      { sticky: true },
    )
    line.addTo(pipeLayer!)
  })
}

function renderJoints() {
  if (!map || !jointLayer) return
  jointLayer.clearLayers()
  const joints = store.facilities?.joints ?? []
  joints.forEach((j) => {
    const marker = L.marker([j.lat, j.lng], { icon: buildJointIcon() })
    const belongsTo = j.unit_id
      ? store.units.find((u) => u.id === j.unit_id)?.name
      : null
    marker.bindTooltip(
      `<b>✕ ${j.type}</b><br/>编码：${j.ecode}<br/>` +
      `压力：${j.pressured}<br/>管号：${j.pipeno || '—'}` +
      (belongsTo ? `<br/>归属：${belongsTo}` : '<br/><span style="color:#f56c6c">⚠ 未归属</span>'),
      { direction: 'top', offset: [0, -8] },
    )
    marker.addTo(jointLayer!)
  })
}

function renderRegulators() {
  if (!map || !regulatorLayer) return
  regulatorLayer.clearLayers()
  const regulators = store.facilities?.regulators ?? []
  regulators.forEach((r) => {
    const marker = L.marker([r.lat, r.lng], { icon: buildRegulatorIcon() })
    marker.bindTooltip(
      `<b>调压箱 ${r.name}</b><br/>编码：${r.ecode}<br/>压力：${r.pressured}`,
      { direction: 'top', offset: [0, -10] },
    )
    marker.addTo(regulatorLayer!)
  })
}

function renderInlets() {
  if (!map || !inletLayer) return
  inletLayer.clearLayers()
  const inlets = store.facilities?.inlets ?? []
  inlets.forEach((i) => {
    const marker = L.marker([i.lat, i.lng], { icon: buildInletIcon() })
    const belongsTo = i.unit_id
      ? store.units.find((u) => u.id === i.unit_id)?.name
      : null
    marker.bindTooltip(
      `<b>引入口 ${i.ecode}</b><br/>压力：${i.pressured}<br/>管号：${i.pipeno}` +
      (belongsTo ? `<br/>归属：${belongsTo}` : ''),
      { direction: 'top', offset: [0, -6] },
    )
    marker.addTo(inletLayer!)
  })
}

function renderUnitMarkers() {
  if (!map || !unitMarkerLayer) return
  unitMarkerLayer.clearLayers()
  // 不再画独立大圆圈 — 进度圆圈已经在 unitPolyLayer 的组合标签里
  // 这个 layer 暂时保留为空图层（保留给后续"选中单元高亮"等用途）
}

/** 按 unit.address 前缀分组单元到小区
 *  例：address = "南海家园七里 · 单元 FSKZ755916" → 归到 "南海家园七里"
 */
function groupUnitsByCommunity(): Map<string, CorrosionUnit[]> {
  const groups = new Map<string, CorrosionUnit[]>()
  for (const u of store.units) {
    const prefix = (u.address || '').split('·')[0].trim() || '未分类'
    if (!groups.has(prefix)) groups.set(prefix, [])
    groups.get(prefix)!.push(u)
  }
  return groups
}

/** 渲染小区概览图层（zoom < COMMUNITY_VIEW_ZOOM 时显示）
 *  - 只在每个小区中心放一个大进度圆圈（百分比 + 小区名 + 单元数）
 *  - 不画控制单元边界多边形，避免缩小后视觉过密
 */
function renderCommunityLayers() {
  if (!map || !communityLayer || !communityMarkerLayer) return
  communityLayer.clearLayers()
  communityMarkerLayer.clearLayers()

  const groups = groupUnitsByCommunity()
  for (const [name, units] of groups) {
    // 计算小区中心（所有 unit polyline 顶点的平均）
    const allPts: [number, number][] = []
    units.forEach((u) => {
      if (u.polyline && u.polyline.length >= 3) {
        u.polyline.forEach((pt) => allPts.push(pt))
      } else if (u.lat && u.lng) {
        allPts.push([u.lat, u.lng])
      }
    })

    if (allPts.length === 0) continue

    const center = avgLatLng(allPts)
    const avg = avgProgress(units)
    // 小区内任一单元异常 → 整体显示红色（异常状态优先级最高）
    const hasException = units.some((u) => u.inspection_status === 'exception')

    // 大进度圆圈（点击 → 地图放大到 18 看单元细节）
    const marker = L.marker([center.lat, center.lng], {
      icon: buildCommunityProgressIcon(name, units.length, avg, hasException),
      interactive: true,
      zIndexOffset: 500,
    })
    marker.on('click', () => {
      if (map) {
        map.flyTo([center.lat, center.lng], 18, { duration: 0.8 })
      }
      // 通知左侧列表展开对应小区
      emit('community-focus', name)
    })
    marker.addTo(communityMarkerLayer)
  }
}

function avgProgress(units: CorrosionUnit[]): number {
  if (units.length === 0) return 0
  const sum = units.reduce((s, u) => s + (u.inspection_progress || 0), 0)
  return sum / units.length
}

function avgLatLng(pts: [number, number][]) {
  const lat = pts.reduce((s, p) => s + p[0], 0) / pts.length
  const lng = pts.reduce((s, p) => s + p[1], 0) / pts.length
  return { lat, lng }
}

/** 切换到"小区概览"模式：隐藏细节图层，显示小区图层 */
function showCommunityView() {
  isCommunityView = true
  // 隐藏细节图层（不 clearLayers，只是从地图上移除）
  unitPolyLayer?.remove()
  pipeLayer?.remove()
  jointLayer?.remove()
  regulatorLayer?.remove()
  inletLayer?.remove()
  unitMarkerLayer?.remove()
  // 显示小区图层
  communityLayer?.addTo(map!)
  communityMarkerLayer?.addTo(map!)
  renderCommunityLayers()
}

/** 切换到"细节视图"模式：显示细节图层，隐藏小区图层 */
function showDetailView() {
  isCommunityView = false
  // 隐藏小区图层
  communityLayer?.remove()
  communityMarkerLayer?.remove()
  // 显示细节图层（按 onMounted 顺序）
  unitPolyLayer?.addTo(map!)
  pipeLayer?.addTo(map!)
  regulatorLayer?.addTo(map!)
  inletLayer?.addTo(map!)
  jointLayer?.addTo(map!)
  unitMarkerLayer?.addTo(map!)
}

/** 根据当前 zoom 决定显示模式 */
function syncViewMode() {
  if (!map) return
  const z = map.getZoom()
  if (z < COMMUNITY_VIEW_ZOOM && !isCommunityView) {
    showCommunityView()
  } else if (z >= COMMUNITY_VIEW_ZOOM && isCommunityView) {
    showDetailView()
  }
}

function fitToAll() {
  if (!map) return
  const allLatLngs: [number, number][] = []
  const fac = store.facilities
  if (!fac) return
  fac.units.forEach((u) => {
    if (u.lat && u.lng) allLatLngs.push([u.lat, u.lng])
    u.polyline?.forEach((pt) => allLatLngs.push(pt))
  })
  fac.joints.forEach((j) => allLatLngs.push([j.lat, j.lng]))
  fac.regulators.forEach((r) => allLatLngs.push([r.lat, r.lng]))
  fac.inlets.forEach((i) => allLatLngs.push([i.lat, i.lng]))
  fac.pipes.forEach((p) => p.coords.forEach(([lng, lat]) => allLatLngs.push([lat, lng])))
  if (allLatLngs.length > 0) {
    map.fitBounds(allLatLngs, { padding: [60, 60], maxZoom: 16 })
  }
}

function renderAll() {
  renderUnitPolygons()
  renderPipes()
  renderJoints()
  renderRegulators()
  renderInlets()
  renderUnitMarkers()
  fitToAll()
}

/** 飞向单元：按多边形边界 fitBounds，自动放大到最大（maxZoom 18）
 *  抽屉弹出后地图容器变小，先 invalidateSize 避免视野错位
 */
function flyTo(unit: CorrosionUnit | null) {
  if (!map || !unit) return
  map.invalidateSize()
  const pts = (unit.polyline && unit.polyline.length >= 3)
    ? unit.polyline
    : (unit.lat && unit.lng ? [[unit.lat, unit.lng] as [number, number]] : [])
  if (pts.length === 0) return
  const bounds = L.latLngBounds(pts)
  map.flyToBounds(bounds, { maxZoom: 18, duration: 0.8, padding: [60, 60] })
}

defineExpose({ flyTo, invalidate: () => map?.invalidateSize() })

onMounted(async () => {
  if (!mapRef.value) return
  map = L.map(mapRef.value, { zoomControl: true, attributionControl: false })
    .setView([39.757, 116.494], 16)
  L.tileLayer(AMAP_URL, { subdomains: '1234', maxZoom: 18 }).addTo(map)

  // 点击地图空白处（不是 poly）→ 取消选中
  map.on('click', () => {
    if (store.selectedUnit) store.selectUnit(null)
  })

  // 图层顺序：底图 → 多边形 → 管道 → 调压箱 → 引入口 → 接头 → 业务标记
  unitPolyLayer = L.layerGroup().addTo(map)
  pipeLayer = L.layerGroup().addTo(map)
  regulatorLayer = L.layerGroup().addTo(map)
  inletLayer = L.layerGroup().addTo(map)
  jointLayer = L.layerGroup().addTo(map)
  unitMarkerLayer = L.layerGroup().addTo(map)

  // 小区概览图层（zoom < COMMUNITY_VIEW_ZOOM 时 addTo，否则保持 remove）
  communityLayer = L.layerGroup()
  communityMarkerLayer = L.layerGroup()

  // 监听 zoomend：自动切换细节 / 小区概览模式
  map.on('zoomend', syncViewMode)
  // 初始化时根据当前 zoom 决定
  syncViewMode()

  // facilities 还没加载时（首屏），先画已知单元（store.units 此时为 []）
  renderAll()
})

// 监听 store.facilities 加载完成
watch(
  () => store.facilities,
  () => renderAll(),
  { deep: false },
)

// 监听 store.units 变化（records 加载后 progress/status 被回写到 units）
watch(
  () => store.units.map((u) => `${u.id}:${u.inspection_progress.toFixed(2)}:${u.inspection_status}`).join(','),
  () => {
    // 只重画组合标签（性能考虑，不重新画所有图层）
    if (unitPolyLayer) {
      const labels: any[] = []
      unitPolyLayer.eachLayer((l: any) => { if (l.options?.icon?.options?.className === 'unit-combo-label') labels.push(l) })
      labels.forEach((l) => unitPolyLayer.removeLayer(l))
      renderUnitPolygons()
    }
    // 如果当前是小区概览模式，重新画小区图层（进度更新）
    if (isCommunityView) {
      renderCommunityLayers()
    }
  },
)

// 监听 store.selectedUnit 变化（侧边栏或别处切换选中单元时，多边形边框高亮 + 圆圈 border 变橙）
watch(
  () => store.selectedUnit?.id,
  (newId, oldId) => {
    if (!unitPolyLayer) return
    // 还原旧的：如果当前有 hover 它就保留 hover，否则还原默认
    if (oldId !== undefined) {
      if (store.hoveredUnit?.id === oldId) highlightUnit(oldId, 'hover')
      else highlightUnit(oldId, 'default')
    }
    // 应用新的（紫色 + 橙边）
    if (newId !== undefined) highlightUnit(newId, 'selected')
  },
)

// 监听 store.hoveredUnit 变化（UnitCard 或 poly hover 触发 → 地图上对应单元变蓝）
watch(
  () => store.hoveredUnit?.id,
  (newId, oldId) => {
    if (!unitPolyLayer) return
    // 还原旧的（如果不是 selected）
    if (oldId !== undefined && store.selectedUnit?.id !== oldId) {
      highlightUnit(oldId, 'default')
    }
    // 应用新的（如果不是 selected，避免覆盖紫色）
    if (newId !== undefined && store.selectedUnit?.id !== newId) {
      highlightUnit(newId, 'hover')
    }
  },
)

// 监听 store.selectedUnit 变化（单击 UnitCard / poly → 单元居中并放大到最大）
watch(
  () => store.selectedUnit,
  (u) => {
    if (!map || !u) return
    const pts = (u.polyline && u.polyline.length >= 3)
      ? u.polyline
      : (u.lat && u.lng ? [[u.lat, u.lng] as [number, number]] : [])
    if (pts.length === 0) return
    map.invalidateSize()
    map.flyToBounds(L.latLngBounds(pts), { maxZoom: 18, duration: 0.6, padding: [60, 60] })
  },
)

onBeforeUnmount(() => {
  map?.remove()
  map = null
})
</script>

<template>
  <div ref="mapRef" id="map"></div>
</template>