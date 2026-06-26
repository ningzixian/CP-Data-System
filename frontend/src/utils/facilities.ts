/**
 * 设施数据加载器 + 拓扑归属算法
 *
 * 关键改进（v2）：
 *   绝缘接头的归属不再用「点-多边形几何包含」判断，
 *   而是基于管道网络拓扑：
 *     1. 把 pipe 端点 + joint + inlet + regulator 合并成一张图
 *     2. 对每个 joint 做 BFS，遍历不跨越其他 joint 能到达的所有 inlet
 *     3. 用可达 inlet 的坐标反查它所在的控制单元 = 该 joint 的归属
 *
 *   这样归属结果完全基于实际管道连通性，比几何包含准。
 */
import { parseCSV, parseWKTPoint, parseWKTLine, parseWKTPolygon } from './csv'
import { pointInPolygon, polygonBBox, polygonCenter } from './geo'
import type { CorrosionUnit } from '@/types/models'

// ============== 原始数据结构 ==============
export interface CsvJoint {
  fid: number
  lng: number
  lat: number
  ecode: string
  type: string
  pressured: string
  pipeno?: string
  unit_id?: number
}

export interface CsvPipe {
  fid: number
  coords: Array<[number, number]>
  pipeno: string
  pressured: string
  material: string
  diametero: string
  thickness: string
  length: string
}

export interface CsvRegulator {
  fid: number
  lng: number
  lat: number
  ecode: string
  name: string
  pressured: string
}

export interface CsvInlet {
  fid: number
  lng: number
  lat: number
  ecode: string
  pipeno: string
  pressured: string
  unit_id?: number
}

// ============== 加载结果 ==============
export interface FacilitiesData {
  units: CorrosionUnit[]
  joints: CsvJoint[]
  pipes: CsvPipe[]
  regulators: CsvRegulator[]
  inlets: CsvInlet[]
  jointCountByUnit: Record<number, number>
  inletCountByUnit: Record<number, number>
}

const BASE = '/data'

// 坐标合并精度（约 0.1 m），pipe 端点、joint、inlet 坐标对齐到这一步
const COORD_PRECISION = 6

function coordKey(lng: number, lat: number): string {
  return `${lng.toFixed(COORD_PRECISION)},${lat.toFixed(COORD_PRECISION)}`
}

// ============== 网络图节点 ==============
interface GraphNode {
  id: number
  lng: number
  lat: number
  type: 'joint' | 'inlet' | 'regulator' | 'pipe_endpoint'
  jointId?: number    // 当 type==='joint'
  inletId?: number    // 当 type==='inlet'
  regulatorId?: number // 当 type==='regulator'
}

/**
 * 构建网络图：
 *   - 把 joint / inlet / regulator / pipe 端点 合并为统一节点
 *   - 坐标相近（< ~0.1m）的会合并为同一节点
 *   - 邻接表: nodeId -> [neighborNodeId, ...]
 */
function buildNetwork(
  joints: CsvJoint[],
  pipes: CsvPipe[],
  inlets: CsvInlet[],
  regulators: CsvRegulator[],
): { nodes: GraphNode[]; adj: Map<number, number[]> } {
  const nodes: GraphNode[] = []
  const keyToId = new Map<string, number>()

  function getOrCreateNode(lng: number, lat: number, type: GraphNode['type'], refId: number): number {
    const key = coordKey(lng, lat)
    const existing = keyToId.get(key)
    if (existing !== undefined) {
      // 节点已存在，更新类型（如端点合并到 joint）
      const n = nodes[existing]
      if (type === 'joint') n.type = 'joint', n.jointId = refId
      else if (type === 'inlet') n.type = 'inlet', n.inletId = refId
      else if (type === 'regulator') n.type = 'regulator', n.regulatorId = refId
      return existing
    }
    const id = nodes.length
    const node: GraphNode = { id, lng, lat, type }
    if (type === 'joint') node.jointId = refId
    else if (type === 'inlet') node.inletId = refId
    else if (type === 'regulator') node.regulatorId = refId
    nodes.push(node)
    keyToId.set(key, id)
    return id
  }

  const adj = new Map<number, number[]>()

  function addEdge(a: number, b: number) {
    if (a === b) return
    if (!adj.has(a)) adj.set(a, [])
    if (!adj.has(b)) adj.set(b, [])
    if (!adj.get(a)!.includes(b)) adj.get(a)!.push(b)
    if (!adj.get(b)!.includes(a)) adj.get(b)!.push(a)
  }

  // 1) 先放 joint / inlet / regulator（优先级高，pipe 端点会合并进来）
  joints.forEach((j) => getOrCreateNode(j.lng, j.lat, 'joint', j.fid))
  inlets.forEach((i) => getOrCreateNode(i.lng, i.lat, 'inlet', i.fid))
  regulators.forEach((r) => getOrCreateNode(r.lng, r.lat, 'regulator', r.fid))

  // 2) 加 pipe 段（端点合并到已有节点或新建）
  pipes.forEach((p) => {
    if (p.coords.length < 2) return
    const [fromLng, fromLat] = p.coords[0]
    const [toLng, toLat] = p.coords[p.coords.length - 1]
    const fromId = getOrCreateNode(fromLng, fromLat, 'pipe_endpoint', p.fid)
    const toId = getOrCreateNode(toLng, toLat, 'pipe_endpoint', p.fid)
    addEdge(fromId, toId)
  })

  return { nodes, adj }
}

/**
 * 从某节点出发做 BFS，不跨越其他 joint，找到可达的所有 inlet
 */
function bfsReachableInlets(
  startNodeId: number,
  nodes: GraphNode[],
  adj: Map<number, number[]>,
): GraphNode[] {
  const visited = new Set<number>([startNodeId])
  const queue: number[] = []
  // 从起点邻居开始（不含起点）
  adj.get(startNodeId)?.forEach((n) => {
    if (!visited.has(n)) {
      visited.add(n)
      queue.push(n)
    }
  })

  const reachableInlets: GraphNode[] = []
  while (queue.length) {
    const nodeId = queue.shift()!
    const node = nodes[nodeId]
    if (node.type === 'inlet') reachableInlets.push(node)
    const neighbors = adj.get(nodeId) ?? []
    for (const n of neighbors) {
      if (visited.has(n)) continue
      const next = nodes[n]
      if (next.type === 'joint') {
        // 遇到其他 joint 不跨越，但 mark visited
        visited.add(n)
        continue
      }
      visited.add(n)
      queue.push(n)
    }
  }
  return reachableInlets
}

/** 主入口 */
export async function loadFacilities(): Promise<FacilitiesData> {
  const [jointsText, pipesText, regulatorsText, inletsText, unitsText] = await Promise.all([
    fetch(`${BASE}/南海家园七里-绝缘接头.csv`).then((r) => r.text()),
    fetch(`${BASE}/南海家园七里-低压.csv`).then((r) => r.text()),
    fetch(`${BASE}/南海家园七里-调压箱.csv`).then((r) => r.text()),
    fetch(`${BASE}/南海家园七里-引入口_录入.csv`).then((r) => r.text()),
    fetch(`${BASE}/南海家园七里-控制单元.csv`).then((r) => r.text()),
  ])

  // ============ 控制单元 ============
  const rawUnits = parseCSV(unitsText)
    .map((r) => {
      const rings = parseWKTPolygon(r.WKT)
      if (rings.length === 0) return null
      const press = (r.Press || '').replace(/[,，]/g, '').trim()
      if (press && press !== '低压') return null
      const outerRing = rings[0]
      const center = polygonCenter(outerRing)
      return {
        fid: parseInt(r.fid) || 0,
        name: r.NAME || r.fid,
        press,
        type: r.type || '',
        area: parseFloat(r.SHAPE_Area) || 0,
        length: parseFloat(r.SHAPE_Leng) || 0,
        rings,
        center,
      }
    })
    .filter((x): x is NonNullable<typeof x> => !!x)

  const units: CorrosionUnit[] = rawUnits.map((u, idx) => ({
    id: idx + 1,
    pipeline_id: 1,
    name: u.name,
    lng: u.center[0],
    lat: u.center[1],
    address: `南海家园七里 · 单元 ${u.name}`,
    polyline: u.rings[0].map(([lng, lat]) => [lat, lng] as [number, number]),
    inspection_progress: 0,
    inspection_status: 'pending',
    note: `${u.type || '低压控制单元'} · 面积 ${u.area.toFixed(1)} m²`,
    created_at: new Date().toISOString(),
  }))

  // 用多边形几何判断任意点属于哪个控制单元（inlet 归属用）
  const unitBboxes = rawUnits.map((u) => polygonBBox(u.rings[0]))
  function findUnitByPoint(lng: number, lat: number): number | undefined {
    for (let i = 0; i < rawUnits.length; i++) {
      if (lng < unitBboxes[i][0] || lng > unitBboxes[i][2] ||
          lat < unitBboxes[i][1] || lat > unitBboxes[i][3]) continue
      const rings = rawUnits[i].rings
      if (!pointInPolygon([lng, lat], rings[0])) continue
      let inHole = false
      for (let r = 1; r < rings.length; r++) {
        if (pointInPolygon([lng, lat], rings[r])) { inHole = true; break }
      }
      if (inHole) continue
      return units[i].id
    }
    return undefined
  }

  // ============ 解析其他设施 ============
  const joints: CsvJoint[] = parseCSV(jointsText)
    .map((r) => {
      const pt = parseWKTPoint(r.WKT)
      return pt
        ? {
            fid: parseInt(r.fid) || 0,
            lng: pt[0], lat: pt[1],
            ecode: r.ECODE || '', type: r.TYPE || '绝缘接头',
            pressured: r.PRESSURED || '', pipeno: r.PIPENO,
          }
        : null
    })
    .filter((x): x is CsvJoint => !!x)

  const pipes: CsvPipe[] = parseCSV(pipesText)
    .map((r) => {
      const coords = parseWKTLine(r.WKT)
      return coords
        ? {
            fid: parseInt(r.fid) || 0, coords,
            pipeno: r.PIPENO || '', pressured: r.PRESSURED || '',
            material: r.MATERIAL || '', diametero: r.DIAMETERO || '',
            thickness: r.THICKNESS || '', length: r.LENGTH || '',
          }
        : null
    })
    .filter((x): x is CsvPipe => !!x)

  const regulators: CsvRegulator[] = parseCSV(regulatorsText)
    .map((r) => {
      const pt = parseWKTPoint(r.WKT)
      return pt
        ? {
            fid: parseInt(r.fid) || 0, lng: pt[0], lat: pt[1],
            ecode: r.ECODE || '', name: r.NAME || r.ECODE,
            pressured: r.PRESSURED || '',
          }
        : null
    })
    .filter((x): x is CsvRegulator => !!x)

  const inlets: CsvInlet[] = parseCSV(inletsText)
    .map((r) => {
      const pt = parseWKTPoint(r.WKT)
      return pt
        ? {
            fid: parseInt(r.fid) || 0, lng: pt[0], lat: pt[1],
            ecode: r.ECODE || '', pipeno: r.PIPENO || '',
            pressured: r.PRESSURED || '',
          }
        : null
    })
    .filter((x): x is CsvInlet => !!x)

  // ============ 构建网络图 ============
  const { nodes, adj } = buildNetwork(joints, pipes, inlets, regulators)

  // ============ 1. 归属 joint：用 BFS 找可达 inlet 的几何归属 ============
  // 给每个 joint 找到图节点
  const jointNodeMap = new Map<number, GraphNode>()  // joint.fid -> node
  for (const n of nodes) {
    if (n.type === 'joint' && n.jointId !== undefined) {
      jointNodeMap.set(n.jointId, n)
    }
  }

  const jointCountByUnit: Record<number, number> = {}
  joints.forEach((j) => {
    const node = jointNodeMap.get(j.fid)
    if (!node) return
    const reachable = bfsReachableInlets(node.id, nodes, adj)
    // 找到第一个能确定控制单元的 inlet
    for (const inletNode of reachable) {
      const unitId = findUnitByPoint(inletNode.lng, inletNode.lat)
      if (unitId !== undefined) {
        j.unit_id = unitId
        jointCountByUnit[unitId] = (jointCountByUnit[unitId] || 0) + 1
        return  // break out of joints.forEach
      }
    }
    // 没有找到单元归属（BFS 找不到 inlet），回退到几何归属
    const fallback = findUnitByPoint(j.lng, j.lat)
    if (fallback !== undefined) {
      j.unit_id = fallback
      jointCountByUnit[fallback] = (jointCountByUnit[fallback] || 0) + 1
    }
  })

  // ============ 2. 归属 inlet：用几何归属（每个 inlet 自己独立属于某个单元） ============
  const inletCountByUnit: Record<number, number> = {}
  inlets.forEach((i) => {
    const unitId = findUnitByPoint(i.lng, i.lat)
    if (unitId !== undefined) {
      i.unit_id = unitId
      inletCountByUnit[unitId] = (inletCountByUnit[unitId] || 0) + 1
    }
  })

  console.log(
    `[Facilities] 加载完成：${units.length} 个低压控制单元、` +
    `${joints.length} 个绝缘接头（已归属 ${joints.filter((j) => j.unit_id !== undefined).length} 个）、` +
    `${inlets.length} 个引入口（已归属 ${inlets.filter((i) => i.unit_id !== undefined).length} 个）、` +
    `${pipes.length} 段管道、` +
    `${regulators.length} 个调压箱`,
  )
  console.log('[Facilities] 网络图节点数：', nodes.length)
  console.log('[Facilities] joint 归属分布：', jointCountByUnit)
  console.log('[Facilities] inlet 归属分布：', inletCountByUnit)

  return {
    units,
    joints,
    pipes,
    regulators,
    inlets,
    jointCountByUnit,
    inletCountByUnit,
  }
}