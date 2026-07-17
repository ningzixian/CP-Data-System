/**
 * 智问数据加载器
 *
 * 从 /public/data/ 加载管网 CSV，转成 NLQ 引擎所需的 ZhiwenData 结构。
 * 复用 csv.ts 的 WKT 解析，保留所有原始字段。
 */

import { parseCSV, parseWKTPoint, parseWKTLine } from '@/utils/csv'
import { loadTopologyData, mergeTopology, type TopologyData } from './topologyLoader'
import type { PipeRow, PointRow, UnitRow, RecordRow, ZhiwenData } from './engine'

const BASE = '/data'

const COMMUNITIES = ['南海家园七里', '南海家园三里', '南海家园六里']

async function fetchText(path: string, required = true): Promise<string> {
  try {
    const r = await fetch(path)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.text()
  } catch (e) {
    if (required) console.warn(`[zhiwen] ${path} 加载失败`, e)
    return ''
  }
}

function loadPipes(community: string): PipeRow[] {
  // 同步，由 loadAll 调用方 await
  return []
}

function parsePipes(community: string, text: string): PipeRow[] {
  return parseCSV(text).map((r) => ({
    community,
    fid: parseInt(r.fid) || 0,
    coords: parseWKTLine(r.WKT) || [],
    pipeno: r.PIPENO || '',
    pressured: r.PRESSURED || '',
    pressurer: r.PRESSURER || '',
    material: r.MATERIAL || '',
    diametero: r.DIAMETERO || '',
    thickness: r.THICKNESS || '',
    length: r.LENGTH || '0',
  }))
}

function parsePoints(community: string, text: string, type: PointRow['type']): PointRow[] {
  return parseCSV(text).map((r) => {
    const pt = parseWKTPoint(r.WKT) || [0, 0]
    return {
      community,
      fid: parseInt(r.fid) || 0,
      lng: pt[0],
      lat: pt[1],
      ecode: r.ECODE || '',
      name: r.NAME || '',
      type,
      pressured: r.PRESSURED || '',
      pipeno: r.PIPENO || '',
    }
  })
}

/** 加载全部管网原始数据（含物探拓扑数据） */
export async function loadZhiwenNetworkData(): Promise<{
  pipes: PipeRow[]
  inlets: PointRow[]
  controls: PointRow[]
  joints: PointRow[]
  regulators: PointRow[]
  communities: string[]
  topology: TopologyData | null
}> {
  const pipes: PipeRow[] = []
  const inlets: PointRow[] = []
  const controls: PointRow[] = []
  const joints: PointRow[] = []
  const regulators: PointRow[] = []

  for (const c of COMMUNITIES) {
    const [pipesText, inletsText, controlsText, jointsText, regulatorsText] = await Promise.all([
      fetchText(`${BASE}/${c}-低压.csv`),
      fetchText(`${BASE}/${c}-引入口_录入.csv`),
      fetchText(`${BASE}/${c}-控制单元.csv`),
      fetchText(`${BASE}/${c}-绝缘接头.csv`),
      fetchText(`${BASE}/${c}-调压箱.csv`),
    ])
    pipes.push(...parsePipes(c, pipesText))
    inlets.push(...parsePoints(c, inletsText, '引入口'))
    controls.push(...parsePoints(c, controlsText, '控制单元'))
    joints.push(...parsePoints(c, jointsText, '绝缘接头'))
    regulators.push(...parsePoints(c, regulatorsText, '调压箱'))
  }

  // 加载并合并物探拓扑数据
  let topology: TopologyData | null = null
  try {
    topology = await loadTopologyData()
    if (topology.pipes.length > 0) {
      const merged = mergeTopology(pipes, { inlets, controls, joints, regulators }, topology)
      console.log(`[zhiwen] 物探数据并入: +${topology.pipes.length} 条线, +${topology.points.length} 个点`)
      return {
        pipes: merged.pipes,
        inlets: merged.points.inlets,
        controls: merged.points.controls,
        joints: merged.points.joints,
        regulators: merged.points.regulators,
        communities: [...COMMUNITIES],
        topology,
      }
    }
  } catch (e) {
    console.warn('[zhiwen] 物探数据加载失败，跳过', e)
  }

  return { pipes, inlets, controls, joints, regulators, communities: [...COMMUNITIES], topology: null }
}

/** 从 CP store 获取 units + records → ZhiwenData 格式 */
export function projectCpData(
  units: any[],
  records: any[],
  communityByUnit?: Record<number, string>,
): { units: UnitRow[]; records: RecordRow[] } {
  const uMap = new Map<number, any>()
  for (const u of units) uMap.set(u.id, u)

  const projectedUnits: UnitRow[] = units.map((u) => ({
    id: u.id,
    pipeline_id: u.pipeline_id,
    name: u.name,
    community: communityByUnit?.[u.id] || guessCommunity(u.address, u.name),
    address: u.address,
    lng: u.lng,
    lat: u.lat,
    inspection_progress: u.inspection_progress,
    inspection_status: u.inspection_status,
  }))

  const projectedRecords: RecordRow[] = records.map((r) => {
    const u = uMap.get(r.unit_id)
    return {
      id: r.id,
      unit_id: r.unit_id,
      unit_name: u?.name,
      community: communityByUnit?.[r.unit_id] || guessCommunity(u?.address, u?.name),
      item_code: r.item_code,
      item_name: r.item_name || '',
      status: r.status,
      measured_value: r.measured_value,
      unit: r.unit,
      inspector: r.inspector,
      inspection_date: r.inspection_date,
      result_data: r.result_data,
    }
  })

  return { units: projectedUnits, records: projectedRecords }
}

function guessCommunity(address?: string, name?: string): string {
  const s = `${address || ''}${name || ''}`
  if (/七里|QL/.test(s)) return '南海家园七里'
  if (/三里|SL/.test(s)) return '南海家园三里'
  if (/六里|LL/.test(s)) return '南海家园六里'
  return '南海家园七里'
}
