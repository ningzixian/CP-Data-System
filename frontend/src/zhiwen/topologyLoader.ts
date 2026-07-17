/**
 * 物探拓扑数据加载器
 *
 * 数据源：`public/data/topology/`
 *  - 南海家园七里-物探点.xlsx (345 个点，七里)
 *  - 南海家园七里-物探线.xlsx (339 条线，七里)
 *  - 南海家园三里-物探点.csv (三里，GBK 编码)
 *
 * LINE 表通过 起点点号 / 连接方向 引用 POINT 表的"物探点号"。
 * 把每条线段合并成 PipeRow（用社区中心作为兜底经纬度）。
 *
 * 关键字段：
 *  - 物探点号 / 特征 (弯头/三通/四通)
 *  - 材质 / 管径 / 电压压力 / 建设年代 / 道路名称
 *  - 起点埋深 / 终点埋深 / 埋设类型
 */

import type { PipeRow, PointRow } from './engine'

const BASE = '/data/topology'

/** 社区中心（作为拓扑数据在地图上的兜底定位） */
const COMMUNITY_CENTER: Record<string, [number, number]> = {
  '南海家园七里': [116.4940, 39.7570],
  '南海家园三里': [116.4970, 39.7620],
  '南海家园六里': [116.4920, 39.7550],
}

interface RawPoint {
  物探点号: string | number
  特征?: string
  X?: number
  Y?: number
  道路名称?: string
}

interface RawLine {
  ID: number
  起点点号: string | number
  连接方向: string | number
  起点埋深?: number
  终点埋深?: number
  埋设类型?: string
  材质?: string
  管径?: string | number
  电压压力?: string
  建设年代?: string
  辅助类型?: string
  管线权属代码?: string
  道路名称?: string
}

/** 异步加载 SheetJS（动态 import） */
async function loadXLSX() {
  const mod = await import('xlsx')
  return (mod as any).default || mod
}

/**
 * 优先读取原始资源；仓库中二进制物探文件使用 Base64 文本保存，
 * 避免不同工具写入 xlsx 时损坏。运行时按需还原为 ArrayBuffer。
 */
async function fetchAssetBuffer(path: string): Promise<ArrayBuffer> {
  const response = await fetch(path)
  if (response.ok) return response.arrayBuffer()

  const encodedResponse = await fetch(`${path}.base64`)
  if (!encodedResponse.ok) throw new Error(`HTTP ${response.status} / Base64 HTTP ${encodedResponse.status}`)
  const encoded = (await encodedResponse.text()).replace(/\s+/g, '')
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

/** 读取 xlsx → JSON 数组 */
async function readXlsx(path: string): Promise<any[]> {
  try {
    const buf = await fetchAssetBuffer(path)
    const XLSX = await loadXLSX()
    const wb = XLSX.read(buf, { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    return XLSX.utils.sheet_to_json(sheet)
  } catch (e) {
    console.warn(`[topology] xlsx 加载失败: ${path}`, e)
    return []
  }
}

/** 读取 GBK 编码的 CSV */
async function readGBKCSV(path: string): Promise<any[]> {
  try {
    const buf = await fetchAssetBuffer(path)
    // GBK 解码
    const decoder = new TextDecoder('gbk')
    const text = decoder.decode(buf)
    // 简易 CSV 解析（用 "," 分隔，支持引号）
    return parseCSVSimple(text)
  } catch (e) {
    console.warn(`[topology] csv 加载失败: ${path}`, e)
    return []
  }
}

function parseCSVSimple(text: string): any[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return []
  const headers = splitCSVLine(lines[0])
  return lines.slice(1).map((line) => {
    const cells = splitCSVLine(line)
    const obj: Record<string, any> = {}
    headers.forEach((h, i) => {
      obj[h] = (cells[i] ?? '').trim()
    })
    return obj
  })
}

function splitCSVLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++ }
      else { inQuote = !inQuote }
    } else if (ch === ',' && !inQuote) {
      out.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

// ============== 主入口 ==============

export interface TopologyData {
  /** 拓扑线段（已经合并成 PipeRow 格式） */
  pipes: PipeRow[]
  /** 拓扑点（弯头/三通等） */
  points: PointRow[]
  /** 原始 LINE 数据（用于元信息展示） */
  rawLines: any[]
  /** 原始 POINT 数据 */
  rawPoints: any[]
  /** 数据来源描述 */
  source: string
}

/**
 * 加载全部物探数据
 *  - 七里：xlsx（POINT + LINE）
 *  - 三里：csv（只有点）
 */
export async function loadTopologyData(): Promise<TopologyData> {
  const [qlPoints, qlLines, slPoints] = await Promise.all([
    readXlsx(`${BASE}/南海家园七里-物探点.xlsx`),
    readXlsx(`${BASE}/南海家园七里-物探线.xlsx`),
    readGBKCSV(`${BASE}/南海家园三里-物探点.csv`),
  ])

  // 建索引：物探点号 → POINT
  const pointIndex = new Map<string, RawPoint>()
  ;(qlPoints as RawPoint[]).forEach((p) => {
    const k = String(p.物探点号 ?? '').trim()
    if (k) pointIndex.set(k, p)
  })

  // 转 LINE → PipeRow（用社区中心作为兜底坐标）
  const pipes: PipeRow[] = []
  ;(qlLines as RawLine[]).forEach((line) => {
    const community = '南海家园七里'
    const center = COMMUNITY_CENTER[community]
    const startKey = String(line.起点点号 ?? '').trim()
    const endKey = String(line.连接方向 ?? '').trim()
    pipes.push({
      community,
      fid: line.ID,
      coords: [center, center],  // 社区中心兜底
      pipeno: `${startKey}->${endKey}`,
      pressured: line.电压压力 || '',
      material: line.材质 || '',
      diametero: String(line.管径 || ''),
      thickness: '',
      length: '',  // 没有经纬度，无法算真实长度
      build_year: line.建设年代 ? String(line.建设年代) : '',
      source: 'topology',
      bury_type: line.埋设类型 || '',
      owner: line.管线权属代码 || '',
    })
  })

  // 转 POINT → PointRow
  const points: PointRow[] = []
  ;(qlPoints as RawPoint[]).forEach((p, i) => {
    const community = '南海家园七里'
    const center = COMMUNITY_CENTER[community]
    points.push({
      community,
      fid: p.物探点号 ? Number(p.物探点号) || i : i,
      lng: center[0],
      lat: center[1],
      ecode: '',
      name: `${p.特征 || '点'}-${p.物探点号 ?? ''}`,
      type: p.特征 || '物探点',
      pressured: '',
      pipeno: '',
    })
  })
  // 三里的点也加上
  slPoints.forEach((p: any, i: number) => {
    const community = '南海家园三里'
    const center = COMMUNITY_CENTER[community]
    const code = p.物探点号 ?? p['点编号'] ?? p['编号'] ?? p['id'] ?? i
    points.push({
      community,
      fid: typeof code === 'number' ? code : i + 10000,
      lng: center[0],
      lat: center[1],
      ecode: '',
      name: `${community.replace('南海家园', '')}物探-${code}`,
      type: '物探点',
      pressured: '',
      pipeno: '',
    })
  })

  return {
    pipes,
    points,
    rawLines: qlLines,
    rawPoints: qlPoints,
    source: '物探数据：南海家园七里（TQ_LINE+TQ_POINT，339 线 + 345 点），三里（CSV）',
  }
}

/** 拓扑数据并入到现有管网数据中 */
export function mergeTopology(
  basePipes: PipeRow[],
  basePoints: { inlets: PointRow[]; controls: PointRow[]; joints: PointRow[]; regulators: PointRow[] },
  topo: TopologyData,
): { pipes: PipeRow[]; points: typeof basePoints } {
  return {
    pipes: [...basePipes, ...topo.pipes],
    points: {
      // 把拓扑点当成"控制单元"类型加入（特征：弯头/三通等）
      controls: [...basePoints.controls, ...topo.points],
      inlets: basePoints.inlets,
      joints: basePoints.joints,
      regulators: basePoints.regulators,
    },
  }
}
