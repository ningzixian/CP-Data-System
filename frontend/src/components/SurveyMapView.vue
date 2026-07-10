<script setup lang="ts">
/**
 * 管线勘测地图(独立组件)
 *
 * Step 4:连接模式(connect)+ 管线箭头
 *  - connect 模式:点 A 点位/引入口 → 拖到 B → 松手生成管线
 *  - Snap 吸附:50px 范围内最近点位/引入口
 *  - 管线带箭头:每条线末端叠加方向箭头(SVG + rotate)
 *  - 引入口可作为端点
 *
 * 之前 Step:
 *  - add-point 模式:点击地图弹三选菜单创建点位
 *  - view 模式:点击点位弹编辑浮层
 */
import { ref, onMounted, onBeforeUnmount, watch, computed, reactive } from 'vue'
import L, { type Map as LeafletMap, type LayerGroup } from 'leaflet'
import type { CsvPipe, CsvInlet } from '@/utils/facilities'
import type { SurveyPoint, SurveyLine, SurveyEndpointId, SurveyPointType } from '@/types/survey'

// 高德瓦片
//  - 有 key(从 VITE_AMAP_KEY 读):用 key 拼到 URL,瓦片能到 20 级(高德 expandZoomRange 上限)
//  - 无 key:用公共瓦片 URL,实际只能到 18 级
const AMAP_KEY = (import.meta.env.VITE_AMAP_KEY as string | undefined) || ''
const AMAP_URL = AMAP_KEY
  ? `https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&key=${AMAP_KEY}&x={x}&y={y}&z={z}`
  : 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}'

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
  /** connect 模式拖拽完成,生成一条管线
   *  - fromId/toId: 端点 ID(可能是 'point:xx' 或 'inlet:xx')
   *  - Snap 已在 SurveyMapView 内部完成,父组件只管入库
   */
  (e: 'create-line', payload: { fromId: SurveyEndpointId; toId: SurveyEndpointId }): void
  /** 点击管线 → 弹删除菜单 → 用户点删除按钮才触发
   *  - 不要直接 confirm 删,用户要有"确认"的明确动作
   */
  (e: 'remove-line', id: string): void
}>()

const mapRef = ref<HTMLDivElement | null>(null)
let map: LeafletMap | null = null
let pipeLayer: LayerGroup | null = null
let inletLayer: LayerGroup | null = null
let surveyPointLayer: LayerGroup | null = null
let surveyLineLayer: LayerGroup | null = null
let surveyLineArrowLayer: LayerGroup | null = null  // 管线箭头层
let connectTempLayer: LayerGroup | null = null    // connect 模式临时虚线层
const pointMarkerMap = new Map<string, any>()

// ============ connect 模式:click → 跟随 → click ============
/** 待连接起点(端点 ID,可能是 point:xx 或 inlet:xx),null 表示没在 pending 状态 */
let connectPendingFrom: SurveyEndpointId | null = null
/** 待连接起点的地理坐标,用于实时画临时虚线 */
let connectPendingLatLng: [number, number] | null = null
/** 临时虚线 polyline 引用(complete 或 cancel 时清) */
let connectTempLine: any = null
const SNAP_PX = 50  // snap 阈值:屏幕像素

// ============ 样式 ============
const PIPE_STYLE = {
  color: '#67c23a',
  weight: 3,
  opacity: 0.75,
  lineCap: 'round',
  lineJoin: 'round',
} as const

const SURVEY_LINE_STYLE = {
  color: '#f56c6c',
  weight: 3,
  opacity: 0.9,
  lineCap: 'round',
  lineJoin: 'round',
} as const

const CONNECT_TEMP_STYLE = {
  color: '#409eff',
  weight: 3,
  opacity: 0.85,
  lineCap: 'round',
  lineJoin: 'round',
  dashArray: '4, 4',
} as const

// ============ 图标 ============

function buildInletIcon() {
  return L.divIcon({
    className: 'survey-inlet-marker',
    html: `<div style="
      background:#909399;color:#fff;border-radius:50%;width:14px;height:14px;
      border:1.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  })
}

function buildSurveyPointIcon(p: SurveyPoint) {
  let svg = ''
  if (p.type === 'tee') {
    svg = `
      <line x1="14" y1="3" x2="14" y2="14" stroke="#303133" stroke-width="3"/>
      <line x1="14" y1="14" x2="14" y2="25" stroke="#303133" stroke-width="3"/>
      <line x1="14" y1="14" x2="25" y2="14" stroke="#303133" stroke-width="3"/>
      <circle cx="14" cy="14" r="3.5" fill="#fff" stroke="#303133" stroke-width="2"/>
    `
  } else if (p.type === 'elbow') {
    svg = `
      <line x1="14" y1="3" x2="14" y2="14" stroke="#303133" stroke-width="3"/>
      <line x1="14" y1="14" x2="25" y2="14" stroke="#303133" stroke-width="3"/>
      <circle cx="14" cy="14" r="3.5" fill="#fff" stroke="#303133" stroke-width="2"/>
    `
  } else {
    // straight 类型:按数据来源区分颜色
    //  - CSV 导入(默认 source='csv'):橙色 #e6a23c
    //  - 用户手动加(source='manual'):蓝色 #409eff
    const fillColor = p.source === 'manual' ? '#409eff' : '#e6a23c'
    svg = `<circle cx="14" cy="14" r="5" fill="${fillColor}" stroke="#fff" stroke-width="2"/>`
  }
  return L.divIcon({
    className: `survey-point-marker source-${p.source || 'csv'}`,
    html: `<div class="survey-point-icon" style="width:28px;height:28px;">
      <svg width="28" height="28" viewBox="0 0 28 28" style="${p.type !== 'straight' ? `transform: rotate(${p.rotation}deg); transition: transform 0.15s;` : ''}">${svg}</svg>
    </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
}

/**
 * 管线方向箭头(在 to 端点附近)
 *  - 三角形:尖端在上(北),尾巴在下(南)
 *  - transform: rotate(angle) 让尖端指向 from → to 方向
 *  - angle = atan2(toLng - fromLng, toLat - fromLat) 给出"从北顺时针"角度
 *  - transform: rotate(deg) 顺时针为正,跟 atan2 方向一致,直接用
 *  - 偏移:让箭头离 to 端点远一点(沿管线方向往外推),不盖在 marker 上
 */
/**
 * 计算箭头位置:管线中点(from→to 平均)
 *  - 箭头显示在管线中央(更直观的位置标记)
 *  - 不用屏幕像素计算,经纬度平均足够(短管线差异肉眼不可见)
 *  - 短管线(< 几米)时箭头会"贴"在某个端点附近,正常现象
 */
function computeMidArrowLatLng(
  from: [number, number],
  to: [number, number],
): [number, number] {
  return [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
}

/**
 * 构造箭头 icon
 *  - 形状:经典三角箭头(尖端在上,基线在下),描白边让箭头在任何颜色背景都清晰
 *  - 默认朝北(0° = 北),跟 atan2(dLng, dLat) 方向一致,直接 rotate 即可
 *  - iconAnchor 在尖端,marker 位置 = 锚点
 *  - ⚠️ transform-origin 必须是 50% 0%(尖端位置),不是 center!
 *    否则 SVG 绕中心旋转,旋转后尖端会偏移出锚点位置,看起来"飘了"
 *    改用 50% 0% 后,旋转绕尖端,尖端位置不动 = 锚点 = latlng,箭头始终在线上
 */
function buildArrowIcon(angleDeg: number): L.DivIcon {
  return L.divIcon({
    className: 'survey-line-arrow',
    html: `<div style="transform: rotate(${angleDeg}deg); transform-origin: 50% 0%;">
      <svg width="14" height="14" viewBox="0 0 14 14" style="overflow:visible;">
        <path d="M 7 0 L 14 14 L 0 14 z" fill="#f56c6c" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>
    </div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 0],  // 锚点在尖端 = latlng
  })
}

// ============ 端点坐标解析 ============
function resolveEndpoint(eid: SurveyEndpointId): [number, number] | null {
  if (eid.startsWith('inlet:')) {
    const fid = parseInt(eid.slice('inlet:'.length), 10)
    const inlet = props.inlets.find((i) => i.fid === fid)
    return inlet ? [inlet.lat, inlet.lng] : null
  }
  if (eid.startsWith('point:')) {
    const pid = eid.slice('point:'.length)
    const point = props.surveyPoints.find((p) => p.id === pid)
    return point ? [point.lat, point.lng] : null
  }
  return null
}

/** Snap 候选:所有点位 + 所有引入口,返回 [{id, latLng}] */
function getSnapCandidates(): Array<{ id: SurveyEndpointId; latLng: [number, number] }> {
  const list: Array<{ id: SurveyEndpointId; latLng: [number, number] }> = []
  for (const p of props.surveyPoints) {
    list.push({ id: `point:${p.id}`, latLng: [p.lat, p.lng] })
  }
  for (const i of props.inlets) {
    list.push({ id: `inlet:${i.fid}`, latLng: [i.lat, i.lng] })
  }
  return list
}

/** 找屏幕像素距离最近的端点(< 50px),返回 {id, latLng} 或 null */
function findSnapTarget(mouseLatLng: L.LatLng, excludeId: SurveyEndpointId | null): { id: SurveyEndpointId; latLng: [number, number] } | null {
  if (!map) return null
  const mousePoint = map.latLngToContainerPoint(mouseLatLng)
  let best: { id: SurveyEndpointId; latLng: [number, number]; dist: number } | null = null
  for (const c of getSnapCandidates()) {
    if (c.id === excludeId) continue  // 排除起点(不能 snap 到自己)
    const p = map.latLngToContainerPoint(L.latLng(c.latLng[0], c.latLng[1]))
    const d = Math.hypot(p.x - mousePoint.x, p.y - mousePoint.y)
    if (d <= SNAP_PX && (!best || d < best.dist)) {
      best = { id: c.id, latLng: c.latLng, dist: d }
    }
  }
  return best ? { id: best.id, latLng: best.latLng } : null
}

// ============ 渲染 ============

function renderPipes() {
  if (!map || !pipeLayer) return
  pipeLayer.clearLayers()
  props.pipes.forEach((p) => {
    if (p.coords.length < 2) return
    const line = L.polyline(
      p.coords.map(([lng, lat]) => [lat, lng] as [number, number]),
      { ...PIPE_STYLE, className: 'survey-pipe-line' },
    )
    line.bindTooltip(
      `<b>${p.pipeno || `#${p.fid}`}</b><br/>` +
      `管材：${p.material || '—'}　外径：${p.diametero || '—'}mm<br/>` +
      `壁厚：${p.thickness || '—'}mm　长度：${p.length || '—'}m<br/>` +
      `压力：${p.pressured || '—'}`,
      { sticky: true },
    )
    line.addTo(pipeLayer!)
  })
}

function renderInlets() {
  if (!map || !inletLayer) return
  inletLayer.clearLayers()
  props.inlets.forEach((i) => {
    const marker = L.marker([i.lat, i.lng], { icon: buildInletIcon() })
    // connect 模式:点引入口也走 connect 流程(可作为管线端点)
    marker.on('click', (e: any) => {
      L.DomEvent.stopPropagation(e)
      if (props.mode === 'connect') {
        handleConnectClick(marker.getLatLng())
      }
    })
    marker.bindTooltip(
      `<b>引入口 ${i.ecode}</b><br/>` +
      `压力：${i.pressured || '—'}<br/>` +
      `管号：${i.pipeno || '—'}`,
      { direction: 'top', offset: [0, -6] },
    )
    marker.addTo(inletLayer!)
  })
}

function renderSurveyPoints() {
  if (!map || !surveyPointLayer) return
  surveyPointLayer.clearLayers()
  pointMarkerMap.clear()
  // 导入的点位是固定的(现场 GPS 测的),任何模式都不可拖
  // - 改坐标必须先删了重建,避免误操作
  // - 即使加了点位也不允许拖(点位创建后位置就锁定)
  props.surveyPoints.forEach((p) => {
    const marker = L.marker([p.lat, p.lng], {
      icon: buildSurveyPointIcon(p),
      draggable: false,
    })
    marker.on('click', (e: any) => {
      // 阻止冒泡到 map(避免同时触发 map.click 导致 connect 逻辑跑两次)
      L.DomEvent.stopPropagation(e)
      if (props.mode === 'add-point') return
      if (props.mode === 'connect') {
        // connect 模式:点 marker 当作"在 marker 位置 click",走 connect 流程
        handleConnectClick(marker.getLatLng())
        return
      }
      // view 模式:打开编辑面板
      emit('point-click', p.id)
    })
    const typeLabel = p.type === 'tee' ? '三通' : p.type === 'elbow' ? '弯头' : '普通点位'
    marker.bindTooltip(
      `<b>${p.id}</b> (${typeLabel}${p.type !== 'straight' ? ` ${p.rotation}°` : ''})<br/>` +
      (p.depth !== undefined ? `埋深：${p.depth} m<br/>` : '') +
      (p.current !== undefined ? `电流：${p.current}<br/>` : '') +
      (p.note ? `备注：${p.note}` : ''),
      { direction: 'top', offset: [0, -8] },
    )
    marker.addTo(surveyPointLayer!)
    pointMarkerMap.set(p.id, marker)
  })
}

/** 渲染管线本体 + 末端方向箭头
 *  - 管线本体在 surveyLineLayer
 *  - 箭头在 surveyLineArrowLayer(独立层,方便显隐控制)
 *  - 箭头是独立 marker(不参与交互),位置在 to 端点外偏移处,旋转指向 from→to
 */
function renderSurveyLines() {
  if (!map || !surveyLineLayer || !surveyLineArrowLayer) return
  surveyLineLayer.clearLayers()
  surveyLineArrowLayer.clearLayers()
  props.surveyLines.forEach((l) => {
    const from = resolveEndpoint(l.fromId)
    const to = resolveEndpoint(l.toId)
    if (!from || !to) return
    // 管线本体(实线)
    const line = L.polyline([from, to], SURVEY_LINE_STYLE)
    // 点击管线 → 在中点弹 L.popup(显示 ID + 删除按钮)
    //  - 用 dataset 存 id 给按钮,document 委托读出
    //  - popup 关闭后不直接删,等用户点按钮
    line.on('click', (e: any) => {
      L.DomEvent.stopPropagation(e)  // 阻止冒泡到 map
      if (props.mode === 'connect' || props.mode === 'add-point') return  // 其他模式不响应
      if (!map) return
      const mid: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
      const html = `
        <div class="survey-line-menu">
          <div class="survey-line-menu-title">${l.id}</div>
          <div class="survey-line-menu-meta">${l.fromId} → ${l.toId}</div>
          <button class="survey-line-menu-btn danger" data-line-action="remove" data-line-id="${l.id}">
            <span class="icon">🗑</span>删除该管线
          </button>
        </div>
      `
      L.popup({ closeButton: true, autoClose: true, closeOnClick: true, className: 'survey-line-popup' })
        .setLatLng(mid)
        .setContent(html)
        .openOn(map)
    })
    line.bindTooltip(
      `<b>${l.id}</b><br/>${l.fromId} → ${l.toId}`,
      { sticky: true },
    )
    line.addTo(surveyLineLayer!)
    // 方向箭头:位置在管线中点,旋转 from→to
    //  - 角度 = atan2(dLng, dLat),SVG 默认 0° 朝北,跟 atan2 一致,直接 rotate
    const arrowPos = computeMidArrowLatLng(from, to)
    const angle = Math.atan2(to[1] - from[1], to[0] - from[0]) * 180 / Math.PI
    const arrow = L.marker(arrowPos, {
      icon: buildArrowIcon(angle),
      interactive: false,  // 箭头不响应 click
    })
    if (surveyLineArrowLayer) arrow.addTo(surveyLineArrowLayer)
  })
}

/** document 委托:管线 popup 内的"删除"按钮被点时触发 */
function onLineMenuClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const btn = target.closest('.survey-line-menu-btn') as HTMLElement | null
  if (!btn) return
  const action = btn.dataset.lineAction
  const id = btn.dataset.lineId
  if (!action || !id) return
  if (action === 'remove') {
    emit('remove-line', id)
  }
  map?.closePopup()
}

function fitToAll() {
  if (!map) return
  const allLatLngs: [number, number][] = []
  props.pipes.forEach((p) =>
    p.coords.forEach(([lng, lat]) => allLatLngs.push([lat, lng])),
  )
  props.surveyPoints.forEach((p) => allLatLngs.push([p.lat, p.lng]))
  props.surveyLines.forEach((l) => {
    const from = resolveEndpoint(l.fromId)
    const to = resolveEndpoint(l.toId)
    if (from) allLatLngs.push(from)
    if (to) allLatLngs.push(to)
  })
  if (allLatLngs.length > 0) {
    map.fitBounds(allLatLngs, { padding: [60, 60], maxZoom: 20 })
    if (map.getZoom() < 18) map.setZoom(18)
  }
}

// ============ map click 统一入口:根据 mode 分发 ============
/**
 * 一个统一 click handler,根据当前 mode 路由到 add-point / connect / view
 *  - add-point:弹三选菜单
 *  - connect:走 handleConnectClick(空白处取消 pending / 命中端点 → 设置/完成)
 *  - view:marker click 已经处理(会 stopPropagation 阻止冒泡到这里)
 */
function handleMapClick(e: L.LeafletMouseEvent) {
  if (!map) return
  if (props.mode === 'add-point') {
    handleAddPointMapClick(e)
  } else if (props.mode === 'connect') {
    handleConnectClick(e.latlng)
  }
  // view 模式:marker click 处理,这里不动
}

// ============ add-point 模式:点击地图弹三选菜单 ============
function handleAddPointMapClick(e: L.LeafletMouseEvent) {
  if (props.mode !== 'add-point' || !map) return
  const { lat, lng } = e.latlng
  const html = `
    <div class="survey-add-menu">
      <div class="survey-add-menu-title">选择点位类型</div>
      <button class="survey-add-menu-btn" data-type="tee" data-lat="${lat}" data-lng="${lng}">
        <span class="survey-add-menu-icon type-tee"></span>三通
      </button>
      <button class="survey-add-menu-btn" data-type="elbow" data-lat="${lat}" data-lng="${lng}">
        <span class="survey-add-menu-icon type-elbow"></span>弯头
      </button>
      <button class="survey-add-menu-btn" data-type="straight" data-lat="${lat}" data-lng="${lng}">
        <span class="survey-add-menu-icon type-straight"></span>普通
      </button>
    </div>
  `
  L.popup({ closeButton: true, autoClose: true, closeOnClick: true, className: 'survey-add-popup' })
    .setLatLng(e.latlng)
    .setContent(html)
    .openOn(map)
}

function onAddMenuClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const btn = target.closest('.survey-add-menu-btn') as HTMLElement | null
  if (!btn) return
  const type = btn.dataset.type as SurveyPointType
  const lat = parseFloat(btn.dataset.lat || '0')
  const lng = parseFloat(btn.dataset.lng || '0')
  if (isNaN(lat) || isNaN(lng)) return
  emit('create-point', { lat, lng, type })
  map?.closePopup()
}

// ============ connect 模式:click → 跟随 → click ============

/** 找 click 命中的端点(50px 范围内最近) */
function pickEndpointAt(mouseLatLng: L.LatLng): { id: SurveyEndpointId; latLng: [number, number] } | null {
  return findSnapTarget(mouseLatLng, null)
}

/** 设置 pending 起点 + 创建初始临时虚线 */
function setPending(id: SurveyEndpointId, latLng: [number, number]) {
  connectPendingFrom = id
  connectPendingLatLng = latLng
  if (connectTempLayer) {
    connectTempLayer.clearLayers()
    // 临时虚线起点 = id 端点,终点先 = 起点(mousemove 实时更新)
    connectTempLine = L.polyline([latLng, latLng], CONNECT_TEMP_STYLE)
    connectTempLine.addTo(connectTempLayer)
  }
}

/** 清除 pending 状态 + 移除临时虚线 */
function clearPending() {
  connectPendingFrom = null
  connectPendingLatLng = null
  if (connectTempLayer) connectTempLayer.clearLayers()
  connectTempLine = null
}

/**
 * connect 模式统一 click 处理:
 *  - 被点位/引入口 marker click 调用(传 marker 的 latlng)
 *  - 被 map click 调用(传 e.latlng)
 *  - marker click handler 内 stopPropagation,所以同一次点击不会重复触发
 *
 *  行为:
 *  - 无 pending + 命中端点:设置 pending 起点
 *  - 有 pending + 命中端点(≠ 起点):emit create-line,清 pending
 *  - 有 pending + 命中端点(= 起点):取消(同一点不连自己)
 *  - 无 pending + 空白处:忽略
 *  - 有 pending + 空白处:取消 pending
 */
function handleConnectClick(latlng: L.LatLng) {
  if (props.mode !== 'connect' || !map) return
  const hit = pickEndpointAt(latlng)
  if (!hit) {
    // 点空白处
    if (connectPendingFrom) clearPending()
    return
  }
  if (!connectPendingFrom) {
    // 第一次点击:设置起点
    setPending(hit.id, hit.latLng)
  } else {
    // 第二次点击:完成 / 取消
    if (hit.id !== connectPendingFrom) {
      emit('create-line', { fromId: connectPendingFrom, toId: hit.id })
    }
    clearPending()
  }
}

/** mousemove:有 pending 时让临时虚线跟随鼠标,snap 范围内时终点贴 snap 端点 */
function handleConnectMouseMove(e: L.LeafletMouseEvent) {
  if (props.mode !== 'connect' || !connectPendingFrom || !connectPendingLatLng || !connectTempLine) return
  const snap = findSnapTarget(e.latlng, connectPendingFrom)
  const endLatLng: [number, number] = snap ? snap.latLng : [e.latlng.lat, e.latlng.lng]
  connectTempLine.setLatLngs([connectPendingLatLng, endLatLng])
}

// ============ 编辑面板 ============
const editingPoint = computed(() => {
  if (!props.editingPointId) return null
  return props.surveyPoints.find((p) => p.id === props.editingPointId) ?? null
})

const editForm = reactive<{
  type: SurveyPointType
  rotation: number
  depth: number | null
  current: number | null
  note: string
}>({
  type: 'straight',
  rotation: 0,
  depth: null,
  current: null,
  note: '',
})

watch(
  () => props.editingPointId,
  (id) => {
    if (!id) return
    const p = props.surveyPoints.find((x) => x.id === id)
    if (!p) return
    editForm.type = p.type
    editForm.rotation = p.rotation
    editForm.depth = p.depth ?? null
    editForm.current = p.current ?? null
    editForm.note = p.note ?? ''
  },
  { immediate: false },
)

watch(() => editForm.type, (t) => {
  if (t === 'straight' && editForm.rotation !== 0) editForm.rotation = 0
})

watch(() => editForm.rotation, (newRot) => {
  if (!props.editingPointId) return
  const point = props.surveyPoints.find((p) => p.id === props.editingPointId)
  if (!point) return
  const marker = pointMarkerMap.get(props.editingPointId)
  if (!marker) return
  const previewPoint = { ...point, rotation: newRot }
  marker.setIcon(buildSurveyPointIcon(previewPoint))
})

function saveEdit() {
  if (!props.editingPointId) return
  const patch: Partial<SurveyPoint> = {
    type: editForm.type,
    rotation: editForm.type === 'straight' ? 0 : (editForm.rotation || 0),
    depth: editForm.depth ?? undefined,
    current: editForm.current ?? undefined,
    note: editForm.note || undefined,
  }
  emit('update-point', { id: props.editingPointId, patch })
  emit('close-editor')
}

function deleteEdit() {
  if (!props.editingPointId) return
  if (!confirm(`确认删除 ${props.editingPointId} ?`)) return
  emit('delete-point', props.editingPointId)
  emit('close-editor')
}

function closeEdit() {
  emit('close-editor')
}

// ============ 模式 class 反映鼠标 cursor ============
const mapContainerClass = computed(() => {
  if (props.mode === 'add-point') return 'mode-add-point'
  if (props.mode === 'connect') return 'mode-connect'
  return ''
})

// ============ 生命周期 ============
onMounted(() => {
  if (!mapRef.value) return
  map = L.map(mapRef.value, { zoomControl: true, attributionControl: false })
    .setView([39.763, 116.497], 18)
  // maxNativeZoom 20 = 瓦片实际能到的 zoom(高德 JS API + key + expandZoomRange: true)
  // maxZoom 20 = 禁止用户缩放到超过瓦片能力(避免拉伸模糊)
  L.tileLayer(AMAP_URL, { subdomains: '1234', maxNativeZoom: 20, maxZoom: 20 }).addTo(map)

  pipeLayer = L.layerGroup().addTo(map)
  inletLayer = L.layerGroup().addTo(map)
  surveyPointLayer = L.layerGroup().addTo(map)
  surveyLineLayer = L.layerGroup().addTo(map)
  surveyLineArrowLayer = L.layerGroup().addTo(map)
  connectTempLayer = L.layerGroup().addTo(map)

  map.on('click', handleMapClick)
  map.on('mousemove', handleConnectMouseMove)
  document.addEventListener('click', onAddMenuClick)
  document.addEventListener('click', onLineMenuClick)

  renderPipes()
  renderInlets()
  renderSurveyPoints()
  renderSurveyLines()
  fitToAll()
})

// ============ watch ============
watch(() => props.pipes, () => { renderPipes(); fitToAll() }, { deep: false })
watch(() => props.inlets, () => renderInlets(), { deep: false })
watch(() => props.surveyPoints, () => {
  renderSurveyPoints()
  renderSurveyLines()
}, { deep: false })
watch(() => props.surveyLines, () => renderSurveyLines(), { deep: false })

watch(() => props.visible, (v) => toggleLayer(pipeLayer, v))
watch(() => props.inletsVisible, (v) => toggleLayer(inletLayer, v))
watch(() => props.surveyPointsVisible, (v) => toggleLayer(surveyPointLayer, v))
watch(() => props.surveyLinesVisible, (v) => {
  toggleLayer(surveyLineLayer, v)
  toggleLayer(surveyLineArrowLayer, v)
})

/** mode 切换时清 pending 状态
 *  - 切到 view / add-point 时,connect 模式的 pending 应该清掉
 *  - 避免切到 view 还残留一条临时虚线
 */
watch(() => props.mode, (newMode) => {
  if (newMode !== 'connect') clearPending()
})

function toggleLayer(layer: LayerGroup | null, visible: boolean) {
  if (!map || !layer) return
  if (visible && !map.hasLayer(layer)) layer.addTo(map)
  else if (!visible && map.hasLayer(layer)) layer.remove()
}

onBeforeUnmount(() => {
  map?.off('click', handleMapClick)
  map?.off('mousemove', handleConnectMouseMove)
  document.removeEventListener('click', onAddMenuClick)
  document.removeEventListener('click', onLineMenuClick)
  map?.remove()
  map = null
})
</script>

<template>
  <div class="survey-map-wrapper" :class="mapContainerClass">
    <div ref="mapRef" id="map"></div>

    <!-- 编辑浮层:view 模式下点击点位打开 -->
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
              <el-slider
                v-model="editForm.rotation"
                :min="0"
                :max="359"
                :step="1"
                :show-input="true"
                :show-input-controls="false"
                input-size="small"
                style="flex: 1"
              />
              <div class="survey-rotation-num">{{ editForm.rotation }}°</div>
            </div>
            <div class="survey-rotation-presets">
              <button
                v-for="deg in [0, 45, 90, 135, 180, 225, 270, 315]"
                :key="deg"
                class="survey-rotation-preset"
                :class="{ active: editForm.rotation === deg }"
                @click="editForm.rotation = deg"
              >{{ deg }}°</button>
            </div>
            <div class="survey-editor-hint">拖动滑块实时预览,或点下方常用角度</div>
          </div>

          <div class="survey-editor-row">
            <label class="survey-editor-label">埋深(米)</label>
            <el-input-number
              v-model="editForm.depth"
              :min="0"
              :step="0.1"
              :precision="2"
              size="small"
              style="width: 100%"
            />
          </div>

          <div class="survey-editor-row">
            <label class="survey-editor-label">电流</label>
            <el-input-number
              v-model="editForm.current"
              :step="0.1"
              :precision="3"
              size="small"
              style="width: 100%"
            />
          </div>

          <div class="survey-editor-row">
            <label class="survey-editor-label">备注</label>
            <el-input
              v-model="editForm.note"
              type="textarea"
              :rows="2"
              size="small"
            />
          </div>

          <div class="survey-editor-coords">
            经度 {{ editingPoint.lng.toFixed(6) }}<br/>
            纬度 {{ editingPoint.lat.toFixed(6) }}
          </div>
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
