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
  (e: 'view-mode', mode: 'community' | 'detail'): void  // 缩放到小区/细节视图时通知父组件
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
// 进度圆分两个 layer,两个 pane,分别管"默认状态"和"hover/selected 状态"
// - progressDefaultLayer   → pane z=350,在 overlayPane(400) 之下,被管线和单元边界覆盖
// - progressHighlightLayer → pane z=700,在 markerPane(600) 之上,所有 marker 之顶
// hover/selected 时由 highlightUnit 把 marker 在两个 layer 间切换
let progressDefaultLayer: LayerGroup | null = null
let progressHighlightLayer: LayerGroup | null = null
// 设施(joint/regulator/inlet)高亮层:selected 时把对应 marker 搬到这里,在所有 marker + 进度圆高亮之上
// - facilityHighlightPane z=750 → 比 progressPaneHighlight(700) 更高,选中设施永远在最顶
// - 跟进度圆一样,marker.options.pane 不会被 layer group 的 pane 传播,这里只是组织作用
//   真正搬 marker 用 DOM 操作(moveFacilityToHighlight / moveFacilityToDefault)
let facilityHighlightLayer: LayerGroup | null = null
const PROGRESS_PANE_MOVE_DELAY = 280
const FACILITY_PANE_MOVE_DELAY = 220

// click-to-lock 状态：任一时刻最多选中一个设施(管道/引入口/接头/调压箱)
// 合并成一个对象,互斥天然成立(选新的会自动 clearSelection 旧的)
// - kind: 区分设施类型(pipe 用 setStyle,其他用 .selected class)
// - item: Leaflet 对象引用,重新渲染会丢,需配合 clearLayers 时清空
let selected: { kind: 'pipe' | 'inlet' | 'joint' | 'regulator', item: any } | null = null
let hoveredFacility: any | null = null

/** 统一清空当前选中(互斥的核心)
 *  - pipe 用 setStyle 还原
 *  - 其他用 remove .selected class + 把 marker 搬回默认 pane
 *  - 没选中就直接返回
 */
function clearSelection() {
  if (!selected) return
  if (selected.kind === 'pipe') {
    selected.item._path?.classList.remove('selected')
    selected.item.setStyle({ color: '#67c23a', weight: 3, opacity: 0.75 })
  } else {
    bumpFacilityVisualToken(selected.item)
    selected.item.getElement()?.classList.remove('selected')
    selected.item.getElement()?.classList.remove('hovered')
    moveFacilityToDefault(selected.item)
  }
  selected = null
}

/** 统一清空"全部"选中(设施 + 控制单元)
 *  - 设施清空走 clearSelection()
 *  - 控制单元清空走 store.selectUnit(null)
 *  - 设施 click / map.on('click) / poly click 都用这个
 *  - 注意:不在内部调 watch 触发的回调,避免循环
 */
function clearAll() {
  clearSelection()
  if (store.selectedUnit) store.selectUnit(null)
}

/** 地图居中到当前选中的设施
 *  - pipe: 用 flyToBounds 整条管道 fit 进视图
 *  - 其他(marker): flyTo 单点放大到 zoom 18
 *  - 没选中 / 没地图就直接返回
 *  - ⚠️ marker 已经在屏幕中心 ± 50 像素内时,跳过 flyTo 避免 0.6s 动画"晃一下":
 *    Leaflet flyTo 即使 pan 距离只有几像素,仍会播 0.6s 平移动画,视觉上像地图抖动
 *  - 屏幕像素距离比地理距离可靠 — zoom 不同 1 像素对应的地理距离差几十倍,
 *    屏幕像素距离不受 zoom 影响,直接反映"肉眼是否偏离中心"
 */
function centerOnSelected() {
  if (!map || !selected) return
  // 计算 marker 当前屏幕位置到屏幕中心的像素距离
  const targetLatLng = selected.kind === 'pipe'
    ? selected.item.getBounds().getCenter()
    : selected.item.getLatLng()
  const targetPoint = map.latLngToContainerPoint(targetLatLng)
  const size = map.getSize()
  const centerPoint = { x: size.x / 2, y: size.y / 2 }
  const dx = targetPoint.x - centerPoint.x
  const dy = targetPoint.y - centerPoint.y
  const pixelDistance = Math.sqrt(dx * dx + dy * dy)
  // 已经在屏幕中心 ± 50 像素内 → 不动(肉眼感觉不到地图在动,flyTo 反而"晃")
  if (pixelDistance < 50) return
  if (selected.kind === 'pipe') {
    map.flyToBounds(selected.item.getBounds(), { maxZoom: 18, duration: 0.6, padding: [60, 60] })
  } else {
    map.flyTo(targetLatLng, 18, { duration: 0.6 })
  }
}

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
    html: `<div class="facility-anim"><div style="
      color:#f56c6c;font-size:22px;font-weight:900;line-height:22px;
      text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 3px #fff;
      font-family:Arial,sans-serif;">✕</div></div>`,
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
    html: `<div class="facility-anim"><div style="
      background:#1890ff;color:#fff;border-radius:4px;width:32px;height:32px;
      display:flex;align-items:center;justify-content:center;
      border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);
      font-weight:700;font-size:14px;">调</div></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  })
}

function buildInletIcon() {
  return L.divIcon({
    className: 'inlet-marker',
    html: `<div class="facility-anim"><div style="
      background:#909399;color:#fff;border-radius:50%;width:14px;height:14px;
      border:1.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div></div>`,
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
 *  - index：用于错位出场（每个圆圈延迟 120ms 出现）
 *  - 出场动效 communityPopIn 在 style.css 定义（scale + opacity + 轻微回弹）
 */
function buildCommunityProgressIcon(name: string, unitCount: number, avgProgress: number, hasException = false, index = 0) {
  const percent = Math.round(avgProgress * 100)
  const color = hasException ? '#f56c6c'
    : avgProgress >= 1 ? '#67c23a'
    : avgProgress >= 0.8 ? '#85ce61'
    : avgProgress > 0 ? '#e6a23c'
    : '#c0c4cc'
  const delay = (index * 0.12).toFixed(2)
  return L.divIcon({
    className: 'community-progress-marker',
    html: `<div class="community-anim" style="
      width:130px;height:130px;
      display:flex;align-items:center;justify-content:center;
      animation: communityPopIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) ${delay}s both;
      transform-origin: center center;
    ">
      <div class="community-hover-target" style="
        background:${color};color:#fff;border-radius:50%;
        width:130px;height:130px;
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        border:4px solid #fff;box-shadow:0 6px 24px rgba(0,0,0,0.35);
        font-family:-apple-system,sans-serif;
      ">
        <div style="font-size:30px;font-weight:700;line-height:1;letter-spacing:0.5px">${percent}%</div>
        <div style="font-size:13px;margin-top:6px;opacity:0.95;font-weight:600">${name}</div>
        <div style="font-size:11px;margin-top:3px;opacity:0.85">${unitCount} 个单元</div>
      </div>
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

function moveMarkerToPane(marker: any, targetPane: string) {
  marker.__paneMoveToken = (marker.__paneMoveToken || 0) + 1
  if (marker.options.pane === targetPane) return
  const m = marker._map
  const iconEl = marker.getElement()
  if (!m || !iconEl) return
  const oldPane = iconEl.parentElement
  const newPane = m.getPane(targetPane)
  if (oldPane && newPane) {
    oldPane.removeChild(iconEl)
    newPane.appendChild(iconEl)
    marker.options.pane = targetPane
  }
}

function moveMarkerToPaneAfter(marker: any, targetPane: string, delay: number) {
  const token = (marker.__paneMoveToken || 0) + 1
  marker.__paneMoveToken = token
  window.setTimeout(() => {
    if (marker.__paneMoveToken !== token) return
    moveMarkerToPane(marker, targetPane)
  }, delay)
}

function afterNextFrame(fn: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(fn))
}

function bumpFacilityVisualToken(marker: any) {
  marker.__facilityVisualToken = (marker.__facilityVisualToken || 0) + 1
  return marker.__facilityVisualToken
}

function bumpUnitMarkerVisualToken(marker: any) {
  marker.__unitMarkerVisualToken = (marker.__unitMarkerVisualToken || 0) + 1
  return marker.__unitMarkerVisualToken
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
    const token = bumpUnitMarkerVisualToken(mk)
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
    const applyProgressVisual = () => {
      el.style.width = size + 'px'
      el.style.height = size + 'px'
      el.style.fontSize = fontSize + 'px'
      el.style.background = fill
      el.style.borderColor = borderColor
    }
    // 跨 pane 切换进度圆 icon:
    // - default       → progressPaneDefault(z=350,被管道覆盖)
    // - hover/selected → progressPaneHighlight(z=700,在所有 marker 之上)
    // ⚠️ Leaflet 没有 setPane() API,只能直接操作 DOM:把 icon 元素从旧 pane 搬到新 pane
    //   marker.options.pane 同步更新,保证后续 Leaflet 内部操作(如 removeIcon)找对 pane
    const targetPane = mode === 'default' ? 'progressPaneDefault' : 'progressPaneHighlight'
    if (mode === 'default') {
      applyProgressVisual()
      moveMarkerToPaneAfter(mk, targetPane, PROGRESS_PANE_MOVE_DELAY)
    } else {
      moveMarkerToPane(mk, targetPane)
      afterNextFrame(() => {
        if (mk.__unitMarkerVisualToken !== token) return
        applyProgressVisual()
      })
    }
  }
}

/** 把设施 marker 搬到 facilityHighlightPane(z=750)
 *  - 调用场景:joint/regulator/inlet 被点击 → selected
 *  - Leaflet 没有 setPane() API,只能直接操作 DOM:把 icon 元素从旧 pane 搬到新 pane
 *  - marker.options.pane 同步更新,保证后续 Leaflet 内部操作(如 removeIcon)找对 pane
 *  - 同 pane 不重复搬
 */
function moveFacilityToHighlight(marker: any) {
  moveMarkerToPane(marker, 'facilityHighlightPane')
}

/** 把设施 marker 搬回 markerPane(z=600,Leaflet 默认 marker pane)
 *  - 调用场景:joint/regulator/inlet 取消选中 / hover 移走
 *  - 逻辑跟 moveFacilityToHighlight 对称,DOM 操作 + options.pane 同步
 *  - 同 pane 不重复搬
 */
function moveFacilityToDefault(marker: any) {
  moveMarkerToPaneAfter(marker, 'markerPane', FACILITY_PANE_MOVE_DELAY)
}

function activateFacilityMarker(marker: any, className: 'hovered' | 'selected') {
  const el = marker.getElement()
  const token = bumpFacilityVisualToken(marker)
  moveFacilityToHighlight(marker)
  afterNextFrame(() => {
    if (marker.__facilityVisualToken !== token) return
    el?.classList.add(className)
  })
}

function deactivateFacilityHover(marker: any) {
  const el = marker.getElement()
  el?.classList.remove('hovered')
  if (selected?.item === marker) return
  bumpFacilityVisualToken(marker)
  moveFacilityToDefault(marker)
}

/** 设施(joint/regulator/inlet)交互统一处理:click 选中 + hover 高亮
 *  - click        → 持久 .selected,搬到 facilityHighlightPane(z=750)
 *  - mouseover    → 临时 .hovered,搬到 facilityHighlightPane(如果未 selected)
 *  - mouseout     → 移除 .hovered,搬回 markerPane(如果未 selected)
 *  - 重复点同 marker → 取消 .selected + .hovered,搬回 markerPane
 *  - 互斥:clearAll() 清掉旧的设施 + 控制单元选中
 *
 *  跟 selected 同样待遇(都搬 facilityHighlightPane),保证 hover/selected 的 marker
 *  永远在 markerPane(z=600)内的其他普通 marker 之顶
 *
 *  ⚠️ 三种状态共享同一套 CSS 视觉(.hovered / .selected / :hover 都触发 transform: scale(1.7))
 *  - :hover 是浏览器原生 pseudo-class,鼠标在 marker 上就生效
 *  - .hovered 是 JS 持久化的 hover 状态,mouseover 加,mouseout 移
 *  - .selected 是 click-to-lock 状态,点击后持续生效不依赖鼠标
 *  - 三者视觉效果一致,只是生命周期不同
 */
function setupFacilityInteraction(marker: any, kind: 'joint' | 'regulator' | 'inlet') {
  // ============ click:持久选中 ============
  marker.on('click', (e: any) => {
    L.DomEvent.stopPropagation(e)  // 阻止冒泡到 map(避免触发 clearAll)
    const el = marker.getElement() as HTMLElement | null
    // 重复点同一 marker → 取消选中
    if (selected?.kind === kind && selected.item === marker) {
      bumpFacilityVisualToken(marker)
      el?.classList.remove('selected')
      el?.classList.remove('hovered')
      moveFacilityToDefault(marker)
      selected = null
      if (hoveredFacility === marker) hoveredFacility = null
      return
    }
    // 点新 marker → 清空旧的 + 选中
    clearAll()
    activateFacilityMarker(marker, 'selected')
    selected = { kind, item: marker }
    centerOnSelected()  // 居中并放大
  })

  // ============ mouseover:临时高亮 ============
  marker.on('mouseover', () => {
    // 已 selected → 已经在 facilityHighlightPane,跳过(不重复搬)
    if (selected?.item === marker) return
    if (hoveredFacility && hoveredFacility !== marker) {
      deactivateFacilityHover(hoveredFacility)
    }
    hoveredFacility = marker
    activateFacilityMarker(marker, 'hovered')
  })

  // ============ mouseout:还原 ============
  marker.on('mouseout', () => {
    if (hoveredFacility === marker) hoveredFacility = null
    deactivateFacilityHover(marker)
  })
}

/** 管线交互:click 选中 + hover 高亮(移到 SVG 末尾保证最上)
 *  - 用 SVG 文档顺序代替 z-index:把 path 移到 _rootGroup 末尾 → SVG 绘制顺序最后 → 视觉最上
 *    (SVG 同容器内,文档顺序决定 z 序,后画的盖前画的;CSS z-index 在 SVG 上需要 position != static,
 *     Leaflet 没给 path 设 position,所以最稳的做法就是 appendChild 到末尾)
 *  - mouseout 不移回原位置,反正下次 hover 又会 appendChild 到末尾,顺序累积但视觉无问题
 *    (目标只是"hover/selected 的 path 总在最上",具体顺序不重要)
 *  - 视觉:hover 样式由 CSS .pipe-line:hover 负责(褐色 + 6 + 1),JS 只负责 z 序
 *  - 互斥:clearAll() 清掉旧的设施 + 控制单元选中
 */
function setupPipeInteraction(line: any) {
  /** 把 path 移到 SVG _rootGroup 末尾 — SVG 文档顺序最后 = 视觉最上 */
  function bringToFront() {
    const path = line._path
    const rootGroup = line._renderer?._rootGroup
    // lastChild 已经是 path 就跳过,避免无谓 DOM 操作
    if (path && rootGroup && rootGroup.lastChild !== path) {
      rootGroup.appendChild(path)
    }
  }

  // ============ click:持久选中 ============
  line.on('click', (e: any) => {
    L.DomEvent.stopPropagation(e)  // 阻止冒泡到 map
    // 重复点同一 line → 取消选中
    if (selected?.kind === 'pipe' && selected.item === line) {
      line._path?.classList.remove('selected')
      line.setStyle({ color: '#67c23a', weight: 3, opacity: 0.75 })
      selected = null
      return
    }
    // 点新 line → 清空旧的 + 选中
    clearAll()
    bringToFront()
    line._path?.classList.add('selected')
    line.setStyle({ color: '#8B4513', weight: 6, opacity: 1 })
    selected = { kind: 'pipe', item: line }
    centerOnSelected()  // 居中并放大
  })

  // ============ mouseover:临时高亮(只移 z 序,样式由 CSS :hover 负责) ============
  line.on('mouseover', () => {
    // 已 selected → 已经在 SVG 末尾(click 时已搬),跳过
    if (selected?.item === line) return
    bringToFront()
  })

  // ============ mouseout:不动 z 序,只 setStyle 兜底还原 ============
  line.on('mouseout', () => {
    // 已 selected → 保留样式 + 末尾位置
    if (selected?.item === line) return
    // setStyle 还原默认(CSS :hover 撤销已经够,但显式 setStyle 更稳,防止边界情况)
    line.setStyle({ color: '#67c23a', weight: 3, opacity: 0.75 })
  })
}

// ============== 渲染 ==============
function renderUnitPolygons() {
  if (!map || !unitPolyLayer || !progressDefaultLayer) return
  unitMarkerMap.forEach((marker) => bumpUnitMarkerVisualToken(marker))
  if (store.hoveredUnit) store.hoverUnit(null)
  unitPolyLayer.clearLayers()
  progressDefaultLayer.clearLayers()
  progressHighlightLayer?.clearLayers()  // 清掉任何留在 highlight pane 的旧 marker
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
    // 互斥：先清掉设施选中,再选这个 poly
    poly.on('click', (e: any) => {
      L.DomEvent.stopPropagation(e)
      clearSelection()
      const unit = store.units.find((x) => x.id === u.id)
      // 只 emit：选中逻辑交给 MapPage.selectUnit 处理（带 toggle 语义）
      // 这里不再 store.selectUnit，避免 MapView 提前选中后 MapPage.toggle 误判为"重复点"
      if (unit) emit('select', unit)
    })
    // dblclick → 打开详情（同时也会触发 click，但顺序是 click 先，dblclick 后）
    poly.on('dblclick', (e: any) => {
      L.DomEvent.stopPropagation(e)  // 阻止地图 dblclick 缩放
      clearSelection()
      const unit = store.units.find((x) => x.id === u.id)
      // 只 emit：选中逻辑交给 MapPage.openDetail 处理
      if (unit) emit('detail', unit)
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
      // 进度圆 marker 必须显式设 pane:'progressPaneDefault'(z=350,被管线和多边形覆盖)
      // - ⚠️ Leaflet L.LayerGroup 的 pane 选项不会传播给子 marker,marker 只认自己的 options.pane
      // - 这里 addTo(progressDefaultLayer) 只是为了组织/跟踪,真正的视觉 pane 由 options.pane 决定
      // - hover/selected 时由 highlightUnit 用 DOM 操作把 icon 搬到 progressPaneHighlight(z=700)
      const label = L.marker([u.lat, u.lng], {
        icon: labelIcon,
        interactive: false,
        pane: 'progressPaneDefault',
      })
      label.addTo(progressDefaultLayer!)
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
      className: 'pipe-line',  // 用于 CSS :hover 放大(见 style.css .pipe-line:hover)
    })
    line.bindTooltip(
      `<b>${p.pipeno || p.fid}</b><br/>` +
      `管材：${p.material || '—'}　外径：${p.diametero || '—'}mm<br/>` +
      `壁厚：${p.thickness || '—'}mm　长度：${p.length || '—'}m<br/>` +
      `压力：${p.pressured}`,
      { sticky: true },
    )
    // 统一交互:click 选中 + hover 高亮(移到 SVG 末尾保证最上)
    setupPipeInteraction(line)
    line.addTo(pipeLayer!)
  })
}

function renderJoints() {
  if (!map || !jointLayer) return
  jointLayer.clearLayers()
  // 清掉任何留在 facilityHighlightPane 的旧 marker icon
  // (搬过去的 marker 已被 clearLayers 失去 layer 引用,但 DOM 还可能在 pane 里残留)
  map.getPane('facilityHighlightPane')!.innerHTML = ''
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
    // 统一交互:click 选中 + hover 高亮(都搬到 facilityHighlightPane z=750)
    setupFacilityInteraction(marker, 'joint')
    marker.addTo(jointLayer!)
  })
}

function renderRegulators() {
  if (!map || !regulatorLayer) return
  regulatorLayer.clearLayers()
  // 清掉任何留在 facilityHighlightPane 的旧 marker icon
  map.getPane('facilityHighlightPane')!.innerHTML = ''
  const regulators = store.facilities?.regulators ?? []
  regulators.forEach((r) => {
    const marker = L.marker([r.lat, r.lng], { icon: buildRegulatorIcon() })
    marker.bindTooltip(
      `<b>调压箱 ${r.name}</b><br/>编码：${r.ecode}<br/>压力：${r.pressured}`,
      { direction: 'top', offset: [0, -10] },
    )
    // 统一交互:click 选中 + hover 高亮(都搬到 facilityHighlightPane z=750)
    setupFacilityInteraction(marker, 'regulator')
    marker.addTo(regulatorLayer!)
  })
}

function renderInlets() {
  if (!map || !inletLayer) return
  inletLayer.clearLayers()
  // 清掉任何留在 facilityHighlightPane 的旧 marker icon
  map.getPane('facilityHighlightPane')!.innerHTML = ''
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
    // 统一交互:click 选中 + hover 高亮(都搬到 facilityHighlightPane z=750)
    setupFacilityInteraction(marker, 'inlet')
    marker.addTo(inletLayer!)
  })
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
  let index = 0
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
      icon: buildCommunityProgressIcon(name, units.length, avg, hasException, index),
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
    index++
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
  progressDefaultLayer?.remove()
  progressHighlightLayer?.remove()
  facilityHighlightLayer?.remove()
  // 显示小区图层
  communityLayer?.addTo(map!)
  communityMarkerLayer?.addTo(map!)
  renderCommunityLayers()
}

/** 切换到"细节视图"模式：显示细节图层，隐藏小区图层
 *  - 0ms 起：小区大圆渐隐（0.45s 过渡）+ 细节图层加进来 + 设施错峰下落
 *  - 关键：不要立即 remove 小区图层，DOM 必须在过渡跑完后才能移除
 *  - 错峰：每个设施随机 animation-delay 0~400ms，落地时间错开
 *  - 总时长：0.75s 落地 + 0.4s 错峰 + 50ms buffer = 1.2s 后移除 .detail-fading
 */
function showDetailView() {
  isCommunityView = false

  // 1) 渐隐小区大圆（加 class，不立即 remove，让 CSS 过渡跑完）
  if (communityMarkerLayer) {
    communityMarkerLayer.eachLayer((mk: any) => {
      const el = mk.getElement() as HTMLElement | null
      if (el) el.classList.add('community-fading')
    })
  }

  // 2) 立即加细节图层（DOM 同步进 pane）
  unitPolyLayer?.addTo(map!)
  pipeLayer?.addTo(map!)
  regulatorLayer?.addTo(map!)
  inletLayer?.addTo(map!)
  jointLayer?.addTo(map!)
  progressDefaultLayer?.addTo(map!)
  progressHighlightLayer?.addTo(map!)
  facilityHighlightLayer?.addTo(map!)

  // 3) 给下落的 marker 加随机 animation-delay(0~180ms 错峰)
  // SVG path 只做轻量淡入，避免大量管线/边界同时 transform 导致掉帧。
  if (mapRef.value) {
    const els = mapRef.value.querySelectorAll<HTMLElement>(
      '.leaflet-marker-pane .leaflet-marker-icon > .facility-anim, .leaflet-progressDefault-pane .leaflet-marker-icon > *',
    )
    els.forEach((el) => {
      el.style.animationDelay = `${(Math.random() * 0.18).toFixed(3)}s`
    })
    // 4) 触发下落入场
    mapRef.value.classList.add('detail-fading')
    // 5) 动画结束后移除 .detail-fading(0.5s 落地 + 0.18s 错峰 + 70ms buffer = 0.75s)
    setTimeout(() => mapRef.value?.classList.remove('detail-fading'), 750)
  }

  // 6) 大圆渐隐完（0.45s + 30ms buffer）后再移除 DOM（这是之前漏掉的关键步骤）
  setTimeout(() => {
    communityLayer?.remove()
    communityMarkerLayer?.remove()
  }, 480)
}

/** 根据当前 zoom 决定显示模式 */
function syncViewMode() {
  if (!map) return
  const z = map.getZoom()
  if (z < COMMUNITY_VIEW_ZOOM && !isCommunityView) {
    showCommunityView()
    emit('view-mode', 'community')  // 进入小区概览,通知父组件收起菜单
  } else if (z >= COMMUNITY_VIEW_ZOOM && isCommunityView) {
    showDetailView()
    emit('view-mode', 'detail')    // 进入细节视图
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

/** 缩小到小区概览缩放级(zoom 16),但保持当前中心,不平移
 *  - 菜单合上时调用:用户想看回更广的区域,但不想地图乱跑
 *  - 只在当前 zoom > 16 时生效(已经够广就不动),避免误触发缩进
 *  - 目标 zoom 16 = 初始视图级,刚好显示小区大圆
 */
function zoomToCommunityView() {
  if (!map) return
  if (map.getZoom() <= 16) return  // 已经够广,不动
  const c = map.getCenter()
  map.flyTo([c.lat, c.lng], 16, { duration: 0.6 })
}

/** 飞到指定小区中心(zoom 18,等同点击地图上的进度圆效果)
 *  - 复用 fitToCommunities 里的"小区中心"算法,跟 renderCommunityLayers 完全一致
 *  - 菜单点开小区时调用,实现"点菜单 = 点大圆"
 */
function flyToCommunity(name: string) {
  if (!map) return
  const groups = groupUnitsByCommunity()
  const units = groups.get(name)
  if (!units || units.length === 0) return
  const pts: [number, number][] = []
  units.forEach((u) => {
    if (u.polyline && u.polyline.length >= 3) {
      u.polyline.forEach((pt) => pts.push(pt))
    } else if (u.lat && u.lng) {
      pts.push([u.lat, u.lng])
    }
  })
  if (pts.length === 0) return
  const c = avgLatLng(pts)
  map.flyTo([c.lat, c.lng], 18, { duration: 0.8 })
}

function renderAll() {
  renderUnitPolygons()
  renderPipes()
  renderJoints()
  renderRegulators()
  renderInlets()
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

defineExpose({ flyTo, zoomToCommunityView, flyToCommunity, invalidate: () => map?.invalidateSize() })

onMounted(async () => {
  if (!mapRef.value) return
  map = L.map(mapRef.value, { zoomControl: true, attributionControl: false })
    .setView([39.757, 116.494], 16)
  L.tileLayer(AMAP_URL, { subdomains: '1234', maxZoom: 18 }).addTo(map)

  // canvas renderer 撤回:canvas 不读 path 的 className,CSS :hover 和 transform 入场动画都失效
  // 所有 path 用默认 SVG renderer(CSS .pipe-line:hover / .detail-fading .path 动画都生效)

  // 自定义三 pane 管 z 序分层
  // - 默认 Leaflet pane: tilePane(200) → overlayPane(400) → shadowPane(500) → markerPane(600)
  //   → tooltipPane(650) → popupPane(700)
  // - progressPaneDefault   z=350 → 夹在 tilePane 和 overlayPane 之间,管线和多边形都在它上面
  // - progressPaneHighlight z=700 → 在 markerPane 之上,所有 marker 之顶(包括调压箱/引入口/接头)
  // - facilityHighlightPane z=750 → 选中设施永远在最顶(比进度圆高亮还高,概念上"被选中的 > 高亮的")
  map.createPane('progressPaneDefault')
  map.getPane('progressPaneDefault')!.style.zIndex = '350'
  map.createPane('progressPaneHighlight')
  map.getPane('progressPaneHighlight')!.style.zIndex = '700'
  map.createPane('facilityHighlightPane')
  map.getPane('facilityHighlightPane')!.style.zIndex = '750'

  // 点击地图空白处（不是 poly/facility）→ 取消所有选中
  // clearAll() 内部按 selected.kind 分发,不用每个类型各写一遍
  map.on('click', () => {
    clearAll()
  })

  // 图层顺序：底图 → 进度圆(默认) → 多边形 → 管道 → 调压箱 → 引入口 → 接头 → 进度圆(高亮) → 设施高亮(留空备用)
  unitPolyLayer = L.layerGroup().addTo(map)
  pipeLayer = L.layerGroup().addTo(map)
  regulatorLayer = L.layerGroup().addTo(map)
  inletLayer = L.layerGroup().addTo(map)
  jointLayer = L.layerGroup().addTo(map)
  // 进度圆两个 layer 分别绑定上面创建的两个 pane
  progressDefaultLayer = L.layerGroup({ pane: 'progressPaneDefault' }).addTo(map)
  progressHighlightLayer = L.layerGroup({ pane: 'progressPaneHighlight' }).addTo(map)
  // 设施高亮 layer(初始空,marker 选中时通过 DOM 操作直接搬到 pane,不进 layer)
  facilityHighlightLayer = L.layerGroup({ pane: 'facilityHighlightPane' }).addTo(map)

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
// 同时承担互斥职责：单元被选中时(从 UnitCard 或其他入口),自动清掉设施选中
watch(
  () => store.selectedUnit?.id,
  (newId, oldId) => {
    if (!unitPolyLayer) return
    // 互斥：单元被选中 → 清设施（仅 newId 有值时,清空时不重复触发）
    if (newId !== undefined) clearSelection()
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
// ⚠️ poly 边界中心已经在屏幕中心 ± 50 像素内时,跳过 flyToBounds,避免 0.6s 动画"晃一下"
// (用屏幕像素距离判断,不受 zoom 影响,zoom 18 也能正常 fit 进视图)
watch(
  () => store.selectedUnit,
  (u) => {
    if (!map || !u) return
    const pts = (u.polyline && u.polyline.length >= 3)
      ? u.polyline
      : (u.lat && u.lng ? [[u.lat, u.lng] as [number, number]] : [])
    if (pts.length === 0) return
    // 计算 poly 中心当前屏幕位置到屏幕中心的像素距离
    const targetBounds = L.latLngBounds(pts)
    const targetCenter = targetBounds.getCenter()
    const targetPoint = map.latLngToContainerPoint(targetCenter)
    const size = map.getSize()
    const centerPoint = { x: size.x / 2, y: size.y / 2 }
    const dx = targetPoint.x - centerPoint.x
    const dy = targetPoint.y - centerPoint.y
    const pixelDistance = Math.sqrt(dx * dx + dy * dy)
    // 已经在屏幕中心 ± 50 像素内 → 不动(肉眼感觉不到地图在动,flyToBounds 反而"晃")
    if (pixelDistance < 50) return
    map.invalidateSize()
    map.flyToBounds(targetBounds, { maxZoom: 18, duration: 0.6, padding: [60, 60] })
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
