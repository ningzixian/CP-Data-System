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
  community: string
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
  community: string
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
  community: string
  fid: number
  lng: number
  lat: number
  ecode: string
  name: string
  pressured: string
}

export interface CsvInlet {
  community: string
  fid: number
  lng: number
  lat: number
  ecode: string
  pipeno: string
  pressured: string
  unit_id?: number
}

export interface CommunityBoundary {
  name: string
  rings: Array<Array<[number, number]>>
  center: [number, number]
}

interface RawUnit {
  community: string
  fid: number
  name: string
  press: string
  type: string
  area: number
  length: number
  rings: Array<Array<[number, number]>>
  center: [number, number]
}

// ============== 加载结果 ==============
export interface FacilitiesData {
  units: CorrosionUnit[]
  joints: CsvJoint[]
  pipes: CsvPipe[]
  regulators: CsvRegulator[]
  inlets: CsvInlet[]
  communityBoundaries: CommunityBoundary[]
  jointCountByUnit: Record<number, number>
  inletCountByUnit: Record<number, number>
}

const BASE = '/data'

// 坐标合并精度（约 0.1 m），pipe 端点、joint、inlet 坐标对齐到这一步
const COORD_PRECISION = 6
const WEB_MERCATOR_LIMIT = 20037508.342789244

/** 边界文件兼容经纬度与 EPSG:3857（Web Mercator）米制坐标。 */
function normalizeBoundaryCoordinate([x, y]: [number, number]): [number, number] {
  if (Math.abs(x) <= 180 && Math.abs(y) <= 90) return [x, y]
  const looksLikeWebMercator = Math.abs(x) > 1_000_000
    && Math.abs(y) > 1_000_000
    && Math.abs(x) <= WEB_MERCATOR_LIMIT
    && Math.abs(y) <= WEB_MERCATOR_LIMIT
  if (!looksLikeWebMercator) return [x, y]
  const lng = x / WEB_MERCATOR_LIMIT * 180
  const mercatorLat = y / WEB_MERCATOR_LIMIT * 180
  const lat = 180 / Math.PI * (2 * Math.atan(Math.exp(mercatorLat * Math.PI / 180)) - Math.PI / 2)
  return [lng, lat]
}

function normalizeBoundaryRings(rings: Array<Array<[number, number]>>) {
  return rings.map((ring) => ring.map(normalizeBoundaryCoordinate))
}

/** 加载的小区列表
 *  - 这里列的小区,public/data/ 下必须有对应的 5 份 CSV(命名格式:<小区名>-{低压|引入口_录入|控制单元|绝缘接头|调压箱}.csv)
 *  - 以后新增小区:把 CSV 丢进 public/data,然后把这个数组加上一行就行
 */
const COMMUNITIES = [
  '南海家园七里',
  '南海家园六里',
  '南海家园三里',
] as const

/** 加载并解析一个小区的全部 5 份 CSV
 *  - 返回该小区的 rawUnits(单元多边形)+ joints/pipes/regulators/inlets(都是点/线)
 *  - rawUnit 带 community 字段,后面拼 address 用
 *  - 容错:任何一步 fetch 失败(404 / 解析错)都返回空数据,不阻断其他小区
 *    (之前用 Promise.all,一个社区失败整个加载崩溃,六里也跟着没数据)
 */
async function loadCommunityData(community: string): Promise<{
  community?: string
  rawUnits: RawUnit[]
  joints: CsvJoint[]
  pipes: CsvPipe[]
  regulators: CsvRegulator[]
  inlets: CsvInlet[]
  boundary?: CommunityBoundary
}> {
  async function fetchCsv(suffix: string, required = true): Promise<string> {
    try {
      const response = await fetch(`${BASE}/${community}-${suffix}.csv`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.text()
    } catch (error) {
      if (required) console.warn(`[Facilities] ${community}-${suffix}.csv 加载失败：`, error)
      return ''
    }
  }

    const [jointsText, pipesText, regulatorsText, inletsText, unitsText, boundaryText] = await Promise.all([
      fetchCsv('绝缘接头'),
      fetchCsv('低压'),
      fetchCsv('调压箱'),
      fetchCsv('引入口_录入'),
      fetchCsv('控制单元'),
      fetchCsv('边界', false),
    ])

    // ============ 控制单元 ============
    const rawUnits: RawUnit[] = parseCSV(unitsText)
      .map((r) => {
        const rings = parseWKTPolygon(r.WKT)
        if (rings.length === 0) return null
        const press = (r.Press || '').replace(/[,，]/g, '').trim()
        if (press && press !== '低压') return null
        const outerRing = rings[0]
        const center = polygonCenter(outerRing)
        return {
          community,  // 记录这个小区的名字,后面拼 address 用
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

    // ============ 解析其他设施 ============
    const joints: CsvJoint[] = parseCSV(jointsText)
      .map((r) => {
        const pt = parseWKTPoint(r.WKT)
        return pt
          ? ({
              community, fid: parseInt(r.fid) || 0,
              lng: pt[0], lat: pt[1],
              ecode: r.ECODE || '', type: r.TYPE || '绝缘接头',
              pressured: r.PRESSURED || '', pipeno: r.PIPENO,
            } as CsvJoint)
          : null
      })
      .filter((x): x is CsvJoint => !!x)

    const pipes: CsvPipe[] = parseCSV(pipesText)
      .map((r) => {
        const coords = parseWKTLine(r.WKT)
        return coords
          ? {
              community, fid: parseInt(r.fid) || 0, coords,
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
              community, fid: parseInt(r.fid) || 0, lng: pt[0], lat: pt[1],
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
              community, fid: parseInt(r.fid) || 0, lng: pt[0], lat: pt[1],
              ecode: r.ECODE || '', pipeno: r.PIPENO || '',
              pressured: r.PRESSURED || '',
            }
          : null
      })
      .filter((x): x is CsvInlet => !!x)

    const boundaryRow = boundaryText ? parseCSV(boundaryText)[0] : undefined
    const boundaryRings = boundaryRow ? normalizeBoundaryRings(parseWKTPolygon(boundaryRow.WKT)) : []
    const boundary = boundaryRings.length > 0
      ? {
          name: community,
          rings: boundaryRings,
          center: polygonCenter(boundaryRings[0]),
        }
      : undefined

    return { community, rawUnits, joints, pipes, regulators, inlets, boundary }
}

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
  // 并行加载所有小区,合并数据
  const communities = await Promise.all(COMMUNITIES.map(loadCommunityData))

  const rawUnits = communities.flatMap((c) => c.rawUnits)
  const joints = communities.flatMap((c) => c.joints)
  const pipes = communities.flatMap((c) => c.pipes)
  const regulators = communities.flatMap((c) => c.regulators)
  const inlets = communities.flatMap((c) => c.inlets)
  const communityBoundaries = communities.flatMap((c) => c.boundary ? [c.boundary] : [])

  // ============ 控制单元(全局唯一 ID,跨小区不冲突)============
  const units: CorrosionUnit[] = rawUnits.map((u, idx) => ({
    id: idx + 1,
    pipeline_id: 1,
    name: u.name,
    lng: u.center[0],
    lat: u.center[1],
    // address 动态拼:不再写死"南海家园七里"
    address: `${u.community} · 单元 ${u.name}`,
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

  return {
    units,
    joints,
    pipes,
    regulators,
    inlets,
    communityBoundaries,
    jointCountByUnit,
    inletCountByUnit,
  }
}
