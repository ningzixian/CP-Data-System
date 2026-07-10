/**
 * 管线勘测 store
 *
 * 设计:
 *  - localStorage 持久化(版本 v1)
 *  - ID 自动生成:NHJY-SL-001 / NHJY-LN-001(后续按小区动态化)
 *  - 撤销/重做:history stack + cursor,每次 mutate push 一份完整 snapshot
 *  - 导入坐标 CSV:批量创建 straight 点位
 */
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { SurveyPoint, SurveyLine, SurveyEndpointId, SurveyPointSource } from '@/types/survey'

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
  magic = 1 - 0.00669342162296594323 * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180.0) / ((6378245.0 * (1 - 0.00669342162296594323)) / (magic * sqrtMagic) * Math.PI)
  dLng = (dLng * 180.0) / (6378245.0 / sqrtMagic * Math.cos(radLat) * Math.PI)
  return [lng + dLng, lat + dLat]
}

interface Persisted {
  points: SurveyPoint[]
  lines: SurveyLine[]
}

function loadFromStorage(): Persisted {
  if (typeof window === 'undefined') return { points: [], lines: [] }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { points: [], lines: [] }
}

function saveToStorage(state: Persisted) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (e) {
    console.warn('[Survey] localStorage 写入失败:', e)
  }
}

export const useSurveyStore = defineStore('survey', () => {
  // ========== 业务数据 ==========
  const initial = loadFromStorage()
  const points = ref<SurveyPoint[]>(initial.points)
  const lines = ref<SurveyLine[]>(initial.lines)

  // 每次变化自动持久化(不包含 history——history 是会话级,不持久化)
  watch(
    [points, lines],
    () => saveToStorage({ points: points.value, lines: lines.value }),
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

  // ========== CRUD(每次 mutate 都要 pushHistory) ==========

  function addPoint(p: Omit<SurveyPoint, 'id' | 'createdAt'>): SurveyPoint {
    // source 字段默认 'manual'(用户手动添加)
    // 调用方可以传 source 覆盖,但通常 addPoint 只用于用户手动加的点位
    const payload = { source: 'manual' as SurveyPointSource, ...p }
    const point: SurveyPoint = {
      ...payload,
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
    next[idx] = { ...next[idx], ...patch }
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

  function addLine(l: Omit<SurveyLine, 'id' | 'createdAt'>): SurveyLine {
    // 防重复:同 fromId+toId 不允许两条
    if (lines.value.some((x) => x.fromId === l.fromId && x.toId === l.toId)) {
      console.warn('[Survey] 管线已存在:', l.fromId, '→', l.toId)
      return lines.value.find((x) => x.fromId === l.fromId && x.toId === l.toId)!
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

  // ========== 撤销/重做 ==========
  /**
   * 历史栈策略:
   *  - history[]: 完整 state 快照数组
   *  - historyCursor: 当前指向
   *  - undo: cursor > 0 时 cursor--,把 state 恢复到 history[cursor]
   *  - redo: cursor < history.length-1 时 cursor++,同理
   *  - 任何 mutate pushHistory:截掉 cursor 之后的历史,append 新 snapshot
   *
   *  - 初始化时 history = [loadFromStorage()],cursor = 0
   *  - loadPointsFromCsv 完成后也 pushHistory 一次
   */
  const initialSnap: Persisted = { points: [...points.value], lines: [...lines.value] }
  const history = ref<Persisted[]>([JSON.parse(JSON.stringify(initialSnap))])
  const historyCursor = ref(0)
  const canUndo = computed(() => historyCursor.value > 0)
  const canRedo = computed(() => historyCursor.value < history.value.length - 1)

  function snapshot(): Persisted {
    return {
      points: JSON.parse(JSON.stringify(points.value)),
      lines: JSON.parse(JSON.stringify(lines.value)),
    }
  }

  function applySnapshot(snap: Persisted) {
    points.value = JSON.parse(JSON.stringify(snap.points))
    lines.value = JSON.parse(JSON.stringify(snap.lines))
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
   *  - 自动定位"纬度"/"经度"列(不依赖列序)
   *  - lng/lat 解析失败的行跳过
   *  - WGS-84 → GCJ-02 转换(GPS 设备输出 WGS-84,高德瓦片用 GCJ-02,直接用会偏移 ~533m)
   *  - 去重:同 (lng, lat) 已有点位跳过(防止重复加载)
   */
  async function loadPointsFromCsv(url: string) {
    try {
      const buf = await fetch(url).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      const view = new Uint8Array(buf)
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
      const latIdx = headers.findIndex((h) => h.includes('纬度') || h.toLowerCase().includes('lat'))
      const lngIdx = headers.findIndex((h) => h.includes('经度') || h.toLowerCase().includes('lng') || h.toLowerCase().includes('lon'))
      if (latIdx < 0 || lngIdx < 0) {
        console.warn('[Survey] CSV 表头找不到 经度/纬度 列:', headers)
        return
      }
      let count = 0
      let skipped = 0
      for (let i = 1; i < csvLines.length; i++) {
        const cells = csvLines[i].split(',')
        const wgsLat = parseFloat(cells[latIdx])
        const wgsLng = parseFloat(cells[lngIdx])
        if (isNaN(wgsLat) || isNaN(wgsLng)) continue
        // WGS-84 → GCJ-02
        const [lng, lat] = wgs84ToGcj02(wgsLng, wgsLat)
        // 去重:同 (lng, lat) 已有就跳过
        const dup = points.value.some(
          (p) => Math.abs(p.lng - lng) < 1e-6 && Math.abs(p.lat - lat) < 1e-6,
        )
        if (dup) { skipped++; continue }
        points.value = [
          ...points.value,
          {
            id: nextPointId(),
            lng, lat,
            type: 'straight' as const,
            rotation: 0,
            source: 'csv' as SurveyPointSource,  // 标记来源:从 CSV 导入
            createdAt: new Date().toISOString(),
          },
        ]
        count++
      }
      console.log(`[Survey] 从 CSV 加载了 ${count} 个新点位(跳过 ${skipped} 个重复)`)
      pushHistory()
    } catch (e) {
      console.warn('[Survey] CSV 加载失败:', e)
    }
  }

  return {
    points, lines,
    canUndo, canRedo,
    addPoint, updatePoint, removePoint,
    addLine, removeLine,
    undo, redo,
    loadPointsFromCsv,
  }
})
