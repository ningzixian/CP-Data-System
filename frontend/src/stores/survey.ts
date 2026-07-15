/**
 * 管线勘测 store
 *
 * 设计:
 *  - IndexedDB 持久化；CSV 只作为不可变的数据集快照来源
 *  - ID 自动生成:NHJY-SL-001 / NHJY-LN-001(后续按小区动态化)
 *  - 撤销/重做:history stack + cursor,每次 mutate push 一份完整 snapshot
 *  - 导入坐标 CSV:批量创建 straight 点位
 */
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { loadSurveyState, saveSurveyState, type SurveyDatabaseState } from '@/utils/surveyDatabase'
import type { SurveyPoint, SurveyLine, SurveyBox, SurveyEndpointId, SurveyPointSource } from '@/types/survey'

/**
 * STORAGE_KEY 版本号:
 *  - v1: 第一次实现,坐标直接用 CSV 原始 WGS-84(在 GCJ-02 高德瓦片上偏移 ~533m)
 *  - v2: 加了 WGS-84 → GCJ-02 转换,旧 v1 数据需清空重新加载
 *  - 改版本号 → 旧 key 自然被忽略,新 key 空表启动
 */
const STORAGE_KEY = 'cp-data-system:survey-data:v2'

// ============ 坐标系转换:WGS-84 → GCJ-02 ============
/** 国内范围判断(中国境内需要火星坐标偏移) */
function outOfChina(lng: number, lat: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}
function transformLat(x: number, y: number): number {
  let r = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  r += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0
  r += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0
  r += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320.0 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0
  return r
}
function transformLng(x: number, y: number): number {
  let r = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  r += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0
  r += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0
  r += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0
  return r
}
/** WGS-84 坐标系 → GCJ-02 火星坐标系
 *  - 国内 GPS 设备输出 WGS-84,高德/腾讯地图瓦片用 GCJ-02,需转换
 *  - 不在国内直接返回原值
 *  - 算法参考:https://lbsyun.baidu.com/jsdemo.htm#a5_2
 */
export function wgs84ToGcj02(lng: number, lat: number): [number, number] {
  if (outOfChina(lng, lat)) return [lng, lat]
  let dLat = transformLat(lng - 105.0, lat - 35.0)
  let dLng = transformLng(lng - 105.0, lat - 35.0)
  const radLat = (lat / 180.0) * Math.PI
  let magic = Math.sin(radLat)
  magic = 1 - 0.006693421622965943 * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180.0) / ((6378245.0 * (1 - 0.006693421622965943)) / (magic * sqrtMagic) * Math.PI)
  dLng = (dLng * 180.0) / (6378245.0 / sqrtMagic * Math.cos(radLat) * Math.PI)
  return [lng + dLng, lat + dLat]
}

/** WGS84 / UTM 北半球坐标转经纬度。三里现场文件使用 50N 带。 */
function utmToWgs84(easting: number, northing: number, zone = 50): [number, number] {
  const a = 6378137
  const eccSquared = 0.00669438
  const k0 = 0.9996
  const eccPrimeSquared = eccSquared / (1 - eccSquared)
  const e1 = (1 - Math.sqrt(1 - eccSquared)) / (1 + Math.sqrt(1 - eccSquared))
  const x = easting - 500000
  const y = northing
  const longOrigin = (zone - 1) * 6 - 180 + 3
  const m = y / k0
  const mu = m / (a * (1 - eccSquared / 4 - 3 * eccSquared ** 2 / 64 - 5 * eccSquared ** 3 / 256))
  const phi1Rad = mu
    + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
    + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu)
  const n1 = a / Math.sqrt(1 - eccSquared * Math.sin(phi1Rad) ** 2)
  const t1 = Math.tan(phi1Rad) ** 2
  const c1 = eccPrimeSquared * Math.cos(phi1Rad) ** 2
  const r1 = a * (1 - eccSquared) / (1 - eccSquared * Math.sin(phi1Rad) ** 2) ** 1.5
  const d = x / (n1 * k0)
  const lat = phi1Rad - (n1 * Math.tan(phi1Rad) / r1) * (
    d ** 2 / 2
    - (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * eccPrimeSquared) * d ** 4 / 24
    + (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * eccPrimeSquared - 3 * c1 ** 2) * d ** 6 / 720
  )
  const lng = (
    d
    - (1 + 2 * t1 + c1) * d ** 3 / 6
    + (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * eccPrimeSquared + 24 * t1 ** 2) * d ** 5 / 120
  ) / Math.cos(phi1Rad)
  return [longOrigin + lng * 180 / Math.PI, lat * 180 / Math.PI]
}

/**
 * 三里新测点文件采用本地工程北坐标。
 * 与现有三里低压管网校准后，标准 UTM 50N 北坐标需扣除 1760m：
 * 72 个点到管线的平均距离约 3.94m，中位数约 2.16m。
 */
const SURVEY_LOCAL_NORTHING_OFFSET_M = 1760

/** 解析十进制度或度分秒坐标，例如 116.49、116°29'24.5327"。 */
function parseSurveyCoordinate(value: string | undefined): number {
  if (!value) return NaN
  const normalized = value.trim().replace(/^"|"$/g, '')
  const decimal = Number(normalized)
  if (Number.isFinite(decimal)) return decimal

  const parts = normalized.match(/-?\d+(?:\.\d+)?/g)?.map(Number)
  if (!parts || parts.length < 3) return NaN
  const sign = parts[0] < 0 || /[SW西南]/i.test(normalized) ? -1 : 1
  return sign * (Math.abs(parts[0]) + parts[1] / 60 + parts[2] / 3600)
}

interface Persisted {
  points: SurveyPoint[]
  lines: SurveyLine[]
  boxes?: SurveyBox[]
  csvDataset?: string
}

function loadLegacyStorage(): Persisted {
  if (typeof window === 'undefined') return { points: [], lines: [] }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const persisted = JSON.parse(raw) as Persisted
      // 兼容短暂使用过的错误类型名“regulator”，统一迁移为绝缘接头。
      persisted.points = persisted.points.map((point) =>
        (point as SurveyPoint & { type: string }).type === 'regulator'
          ? { ...point, type: 'joint' as const }
          : point,
      )
      return persisted
    }
  } catch (error) {
    console.warn('[Survey] localStorage 数据无效，已忽略：', error)
  }
  return { points: [], lines: [] }
}

function normalizePoint(point: SurveyPoint): SurveyPoint {
  const originalLng = point.originalLng ?? point.lng
  const originalLat = point.originalLat ?? point.lat
  const movedLng = point.movedLng
  const movedLat = point.movedLat
  return {
    ...point,
    originalLng,
    originalLat,
    movedLng,
    movedLat,
    lng: movedLng ?? originalLng,
    lat: movedLat ?? originalLat,
  }
}

/** 按稳定编号去重；旧版本产生重复时优先保留数组中较早的已编辑点位。 */
function normalizeState(state: Persisted | SurveyDatabaseState): SurveyDatabaseState {
  const pointMap = new Map<string, SurveyPoint>()
  state.points.forEach((rawPoint) => {
    const rawType = (rawPoint as SurveyPoint & { type: string }).type
    const point = normalizePoint(rawType === 'regulator' ? { ...rawPoint, type: 'joint' as const } : rawPoint)
    if (!pointMap.has(point.id)) pointMap.set(point.id, point)
  })
  return {
    points: [...pointMap.values()],
    lines: state.lines ?? [],
    boxes: state.boxes ?? [],
    csvDataset: state.csvDataset ?? '',
  }
}

function fileFingerprint(bytes: Uint8Array): string {
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export const useSurveyStore = defineStore('survey', () => {
  // ========== 业务数据 ==========
  const initial = normalizeState(loadLegacyStorage())
  const points = ref<SurveyPoint[]>(initial.points)
  const lines = ref<SurveyLine[]>(initial.lines)
  const boxes = ref<SurveyBox[]>(initial.boxes)
  const csvDataset = ref(initial.csvDataset)
  let hydrated = false
  let hydrationPromise: Promise<void> | null = null
  let persistenceQueue = Promise.resolve()

  function databaseState(): SurveyDatabaseState {
    return {
      points: JSON.parse(JSON.stringify(points.value)),
      lines: JSON.parse(JSON.stringify(lines.value)),
      boxes: JSON.parse(JSON.stringify(boxes.value)),
      csvDataset: csvDataset.value,
    }
  }

  function queuePersistence() {
    if (!hydrated) return
    const state = databaseState()
    persistenceQueue = persistenceQueue
      .then(() => saveSurveyState(state))
      .catch((error) => console.warn('[Survey] IndexedDB 持久化失败:', error))
  }

  async function ensureHydrated() {
    if (hydrationPromise) return hydrationPromise
    hydrationPromise = (async () => {
      try {
        const stored = await loadSurveyState()
        const state = normalizeState(stored ?? initial)
        points.value = state.points
        lines.value = state.lines
        boxes.value = state.boxes
        csvDataset.value = state.csvDataset
        hydrated = true
        resetHistory()
        await saveSurveyState(state)
        window.localStorage.removeItem(STORAGE_KEY)
      } catch (error) {
        hydrated = true
        console.warn('[Survey] IndexedDB 初始化失败，当前会话继续使用内存数据:', error)
      }
    })()
    return hydrationPromise
  }

  // 每次变化自动写入 IndexedDB（history 仍仅保留在当前会话）。
  watch(
    [points, lines, boxes, csvDataset],
    queuePersistence,
    { deep: true },
  )

  // ========== ID 生成(小区前缀固定 NHJY,后续按 community 动态化) ==========
  const COMMUNITY_PREFIX = 'NHJY'
  function nextPointId(): string {
    let max = 0
    for (const p of points.value) {
      const m = p.id.match(/-(\d+)$/)
      if (m) max = Math.max(max, parseInt(m[1], 10))
    }
    return `${COMMUNITY_PREFIX}-SL-${String(max + 1).padStart(3, '0')}`
  }
  function nextLineId(): string {
    let max = 0
    for (const l of lines.value) {
      const m = l.id.match(/-(\d+)$/)
      if (m) max = Math.max(max, parseInt(m[1], 10))
    }
    return `${COMMUNITY_PREFIX}-LN-${String(max + 1).padStart(3, '0')}`
  }
  function nextBoxId(): string {
    let max = 0
    for (const box of boxes.value) {
      const match = box.id.match(/-(\d+)$/)
      if (match) max = Math.max(max, parseInt(match[1], 10))
    }
    return `${COMMUNITY_PREFIX}-BX-${String(max + 1).padStart(3, '0')}`
  }

  // ========== CRUD(每次 mutate 都要 pushHistory) ==========

  function addPoint(p: Omit<SurveyPoint, 'id' | 'createdAt'>): SurveyPoint {
    // source 字段默认 'manual'(用户手动添加)
    // 调用方可以传 source 覆盖,但通常 addPoint 只用于用户手动加的点位
    const payload = { source: 'manual' as SurveyPointSource, ...p }
    const point: SurveyPoint = {
      ...payload,
      originalLng: p.originalLng ?? p.lng,
      originalLat: p.originalLat ?? p.lat,
      movedLng: p.movedLng,
      movedLat: p.movedLat,
      id: nextPointId(),
      createdAt: new Date().toISOString(),
    }
    points.value = [...points.value, point]
    pushHistory()
    return point
  }

  function updatePoint(id: string, patch: Partial<Omit<SurveyPoint, 'id' | 'createdAt'>>) {
    const idx = points.value.findIndex((p) => p.id === id)
    if (idx < 0) return
    const next = [...points.value]
    const current = normalizePoint(next[idx])
    const hasPositionUpdate = patch.lng !== undefined || patch.lat !== undefined
    const movedLng = hasPositionUpdate ? (patch.lng ?? current.lng) : current.movedLng
    const movedLat = hasPositionUpdate ? (patch.lat ?? current.lat) : current.movedLat
    next[idx] = {
      ...current,
      ...patch,
      originalLng: current.originalLng,
      originalLat: current.originalLat,
      movedLng,
      movedLat,
      lng: movedLng ?? current.originalLng!,
      lat: movedLat ?? current.originalLat!,
    }
    points.value = next
    pushHistory()
  }

  function removePoint(id: string) {
    const eid: SurveyEndpointId = `point:${id}`
    points.value = points.value.filter((p) => p.id !== id)
    // 关联管线也要删
    lines.value = lines.value.filter((l) => l.fromId !== eid && l.toId !== eid)
    pushHistory()
  }

  function addLine(l: Omit<SurveyLine, 'id' | 'createdAt'>): SurveyLine | null {
    // 管线没有方向：A→B 与 B→A 视为同一条，两个端点之间最多只能有一条。
    const existing = lines.value.find((x) =>
      (x.fromId === l.fromId && x.toId === l.toId) ||
      (x.fromId === l.toId && x.toId === l.fromId),
    )
    if (existing) {
      console.warn('[Survey] 管线已存在:', l.fromId, '→', l.toId)
      return null
    }
    const line: SurveyLine = {
      ...l,
      id: nextLineId(),
      createdAt: new Date().toISOString(),
    }
    lines.value = [...lines.value, line]
    pushHistory()
    return line
  }

  function removeLine(id: string) {
    lines.value = lines.value.filter((l) => l.id !== id)
    pushHistory()
  }

  function addBox(bounds: Omit<SurveyBox, 'id' | 'createdAt'>): SurveyBox {
    const box: SurveyBox = {
      ...bounds,
      id: nextBoxId(),
      createdAt: new Date().toISOString(),
    }
    boxes.value = [...boxes.value, box]
    pushHistory()
    return box
  }

  function removeBox(id: string) {
    boxes.value = boxes.value.filter((box) => box.id !== id)
    pushHistory()
  }

  function updateBox(id: string, patch: Partial<Omit<SurveyBox, 'id' | 'createdAt'>>) {
    const index = boxes.value.findIndex((box) => box.id === id)
    if (index < 0) return
    const next = [...boxes.value]
    next[index] = { ...next[index], ...patch }
    boxes.value = next
    pushHistory()
  }

  // ========== 撤销/重做 ==========
  /**
   * 历史栈策略:
   *  - history[]: 完整 state 快照数组
   *  - historyCursor: 当前指向
   *  - undo: cursor > 0 时 cursor--,把 state 恢复到 history[cursor]
   *  - redo: cursor < history.length-1 时 cursor++,同理
   *  - 任何 mutate pushHistory:截掉 cursor 之后的历史,append 新 snapshot
   *
   *  - 初始化时 history = [IndexedDB/旧数据迁移快照],cursor = 0
   *  - loadPointsFromCsv 完成后也 pushHistory 一次
   */
  const initialSnap: Persisted = { points: [...points.value], lines: [...lines.value], boxes: [...boxes.value], csvDataset: csvDataset.value }
  const history = ref<Persisted[]>([JSON.parse(JSON.stringify(initialSnap))])
  const historyCursor = ref(0)
  const canUndo = computed(() => historyCursor.value > 0)
  const canRedo = computed(() => historyCursor.value < history.value.length - 1)

  function snapshot(): Persisted {
    return {
      points: JSON.parse(JSON.stringify(points.value)),
      lines: JSON.parse(JSON.stringify(lines.value)),
      boxes: JSON.parse(JSON.stringify(boxes.value)),
      csvDataset: csvDataset.value,
    }
  }

  function resetHistory() {
    history.value = [JSON.parse(JSON.stringify(snapshot()))]
    historyCursor.value = 0
  }

  function applySnapshot(snap: Persisted) {
    points.value = JSON.parse(JSON.stringify(snap.points))
    lines.value = JSON.parse(JSON.stringify(snap.lines))
    boxes.value = JSON.parse(JSON.stringify(snap.boxes ?? []))
    csvDataset.value = snap.csvDataset ?? ''
  }

  function pushHistory() {
    const snap = snapshot()
    // 截掉 cursor 之后的所有历史(分支)
    history.value = history.value.slice(0, historyCursor.value + 1)
    history.value.push(snap)
    historyCursor.value = history.value.length - 1
  }

  function undo() {
    if (!canUndo.value) return
    historyCursor.value--
    applySnapshot(history.value[historyCursor.value])
  }
  function redo() {
    if (!canRedo.value) return
    historyCursor.value++
    applySnapshot(history.value[historyCursor.value])
  }

  // ========== 批量加载(从现场打点 CSV) ==========
  /**
   * 解析现场打点 CSV,批量创建 straight 点位
   *  - 自动识别编码:UTF-8 BOM > UTF-8 > GB18030(用是否含中文判断)
   *  - 自动识别经纬度列，或现场文件的 N/E（WGS84 / UTM 50N）投影坐标
   *  - lng/lat 解析失败的行跳过
   *  - WGS-84 → GCJ-02 转换(GPS 设备输出 WGS-84,高德瓦片用 GCJ-02,直接用会偏移 ~533m)
   *  - 点位按 CSV 名称生成的稳定编号合并，绝不再按坐标追加同名点位
   */
  async function loadPointsFromCsv(url: string) {
    try {
      await ensureHydrated()
      const buf = await fetch(url).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      const view = new Uint8Array(buf)
      const datasetKey = `${url}#${fileFingerprint(view)}:indexeddb-v1`
      // 同一数据集只复制一次；刷新页面直接使用 IndexedDB 中的编辑结果。
      if (csvDataset.value === datasetKey && points.value.length > 0) return

      let text: string
      // 1) UTF-8 BOM
      if (view[0] === 0xEF && view[1] === 0xBB && view[2] === 0xBF) {
        text = new TextDecoder('utf-8').decode(view.slice(3))
      } else {
        // 2) 试 UTF-8
        text = new TextDecoder('utf-8').decode(view)
        if (!/[\u4e00-\u9fff]/.test(text)) {
          // 3) GB18030(兼容 GBK / GB2312)
          try {
            text = new TextDecoder('gb18030').decode(view)
          } catch {
            // 浏览器不支持 gb18030,降级 GBK(大多数情况能 cover)
            text = new TextDecoder('gbk').decode(view)
          }
        }
      }
      const csvLines = text.split(/\r?\n/).filter((l) => l.trim())
      if (csvLines.length < 2) {
        console.warn('[Survey] CSV 内容为空')
        return
      }
      const headers = csvLines[0].split(',').map((h) => h.trim())
      const nameIdx = headers.findIndex((h) => h.includes('名称') || h.toLowerCase().includes('name'))
      const latIdx = headers.findIndex((h) => h.includes('纬度') || h.toLowerCase().includes('lat'))
      const lngIdx = headers.findIndex((h) => h.includes('经度') || h.toLowerCase().includes('lng') || h.toLowerCase().includes('lon'))
      const northingIdx = headers.findIndex((h) => ['n', 'northing', '北坐标'].includes(h.toLowerCase()))
      const eastingIdx = headers.findIndex((h) => ['e', 'easting', '东坐标'].includes(h.toLowerCase()))
      const usesLngLat = latIdx >= 0 && lngIdx >= 0
      const usesUtm = northingIdx >= 0 && eastingIdx >= 0
      if (!usesLngLat && !usesUtm) {
        console.warn('[Survey] CSV 表头找不到经纬度或 N/E 投影坐标列:', headers)
        return
      }

      // 编号是点位唯一键。旧版本若已产生同名重复点，只保留较早的编辑记录。
      const existingPointsById = new Map<string, SurveyPoint>()
      points.value.forEach((point) => {
        if (!existingPointsById.has(point.id)) existingPointsById.set(point.id, normalizePoint(point))
      })
      const previousDatasetWasIndexedDb = csvDataset.value.endsWith(':indexeddb-v1')
      const importedPoints: SurveyPoint[] = []
      const importedIds = new Set<string>()

      for (let i = 1; i < csvLines.length; i++) {
        const cells = csvLines[i].split(',')
        let wgsLng: number
        let wgsLat: number
        if (usesLngLat) {
          wgsLat = parseSurveyCoordinate(cells[latIdx])
          wgsLng = parseSurveyCoordinate(cells[lngIdx])
        } else {
          const northing = parseFloat(cells[northingIdx])
          const easting = parseFloat(cells[eastingIdx])
          ;[wgsLng, wgsLat] = utmToWgs84(
            easting,
            northing - SURVEY_LOCAL_NORTHING_OFFSET_M,
          )
        }
        if (!Number.isFinite(wgsLat) || !Number.isFinite(wgsLng)) continue

        const [originalLng, originalLat] = wgs84ToGcj02(wgsLng, wgsLat)
        const csvPointNumber = nameIdx >= 0 ? cells[nameIdx]?.match(/\d+/)?.[0] : undefined
        const pointId = csvPointNumber
          ? `${COMMUNITY_PREFIX}-SL-${String(Number(csvPointNumber)).padStart(3, '0')}`
          : `${COMMUNITY_PREFIX}-SL-${String(i).padStart(3, '0')}`
        if (importedIds.has(pointId)) {
          console.warn('[Survey] CSV 存在重复点位编号，已跳过:', pointId)
          continue
        }

        const existing = existingPointsById.get(pointId)
        const effectiveLng = existing?.movedLng ?? existing?.lng
        const effectiveLat = existing?.movedLat ?? existing?.lat
        const differsFromCsv = existing
          ? Math.abs(effectiveLng! - originalLng) > 1e-7 || Math.abs(effectiveLat! - originalLat) > 1e-7
          : false
        // 迁移旧版本时，坐标不同代表该编号曾被拖动；将当前位置转为移动覆盖字段。
        const movedLng = existing?.movedLng ?? (!previousDatasetWasIndexedDb && differsFromCsv ? effectiveLng : undefined)
        const movedLat = existing?.movedLat ?? (!previousDatasetWasIndexedDb && differsFromCsv ? effectiveLat : undefined)
        importedPoints.push({
          id: pointId,
          originalLng,
          originalLat,
          movedLng,
          movedLat,
          lng: movedLng ?? originalLng,
          lat: movedLat ?? originalLat,
          type: existing?.type ?? 'straight',
          rotation: existing?.rotation ?? 0,
          depth: existing?.depth,
          current: existing?.current,
          note: existing?.note,
          source: 'csv',
          createdAt: existing?.createdAt ?? new Date().toISOString(),
        })
        importedIds.add(pointId)
      }

      // 手工新增点位不属于 CSV 快照，新文件导入时继续保留。
      const manualPoints = [...existingPointsById.values()].filter(
        (point) => point.source === 'manual' && !importedIds.has(point.id),
      )
      points.value = [...importedPoints, ...manualPoints]
      const validPointIds = new Set(points.value.map((point) => `point:${point.id}` as SurveyEndpointId))
      lines.value = lines.value.filter((line) =>
        (!line.fromId.startsWith('point:') || validPointIds.has(line.fromId)) &&
        (!line.toId.startsWith('point:') || validPointIds.has(line.toId)),
      )
      csvDataset.value = datasetKey
      pushHistory()
      await saveSurveyState(databaseState())
      console.log(`[Survey] CSV 数据集已复制到 IndexedDB，共 ${importedPoints.length} 个文件点位`)
    } catch (e) {
      console.warn('[Survey] CSV 加载失败:', e)
    }
  }

  return {
    points, lines, boxes,
    canUndo, canRedo,
    addPoint, updatePoint, removePoint,
    addLine, removeLine,
    addBox, updateBox, removeBox,
    undo, redo,
    loadPointsFromCsv,
  }
})
