/**
 * 智能提示生成器 — 根据当前数据状态动态生成"猜您想问"
 *
 * 设计原则：
 *  - 最多 6 条
 *  - 每条带 emoji + 标题 + 子标题
 *  - 点击直接触发查询
 *  - 优先级：异常 > 进度 > 长度对比 > 分布
 */

import type { ZhiwenData } from './engine'
import { PRESET_QUERIES } from './engine'

export interface Suggestion {
  icon: string
  title: string
  subtitle: string
  query: string
  priority: number   // 数字越大越靠前
  kind: 'alert' | 'hint' | 'preset' | 'auto'
}

export function generateSuggestions(data: ZhiwenData): Suggestion[] {
  const out: Suggestion[] = []

  // ===== 1) 异常检测（最高优先级） =====
  const exceptions = data.records.filter((r) => r.status === 'exception')
  if (exceptions.length > 0) {
    out.push({
      icon: '⚠️',
      title: `有 ${exceptions.length} 条异常检测记录`,
      subtitle: `涉及 ${exceptions[0].item_name} 等检测项，建议立即查看`,
      query: '异常检测记录',
      priority: 100,
      kind: 'alert',
    })
  }

  // ===== 2) 待开始检测提醒 =====
  const pending = data.records.filter((r) => r.status === 'pending')
  if (pending.length >= 5) {
    out.push({
      icon: '📋',
      title: `${pending.length} 条检测待开始`,
      subtitle: '看看各检测项的待办情况',
      query: '待开始检测项',
      priority: 80,
      kind: 'hint',
    })
  }

  // ===== 3) 进度异常（< 50%）的小区 =====
  const slowUnits = data.units.filter((u) => u.inspection_progress < 0.5 && u.inspection_status !== 'completed')
  if (slowUnits.length > 0) {
    const communities = Array.from(new Set(slowUnits.map((u) => u.community)))
    out.push({
      icon: '🐢',
      title: `${communities.join('、')}的腐控单元进度较慢`,
      subtitle: `共 ${slowUnits.length} 个单元，进度 < 50%`,
      query: '各小区腐控单元进度',
      priority: 70,
      kind: 'hint',
    })
  }

  // ===== 4) 管线总长对比（自动算） =====
  const pipeByCommunity: Record<string, number> = {}
  data.pipes.forEach((p) => {
    const v = parseFloat(p.length) || 0
    pipeByCommunity[p.community] = (pipeByCommunity[p.community] || 0) + v
  })
  const communityList = Object.keys(pipeByCommunity)
  if (communityList.length >= 2) {
    const max = communityList.reduce((a, b) => pipeByCommunity[a] > pipeByCommunity[b] ? a : b)
    const total = communityList.reduce((s, c) => s + pipeByCommunity[c], 0)
    out.push({
      icon: '📏',
      title: `${max.replace('南海家园', '')}管网最长`,
      subtitle: `总长 ${(pipeByCommunity[max] / 1000).toFixed(2)} km，占全小区 ${((pipeByCommunity[max] / total) * 100).toFixed(0)}%`,
      query: '各小区管线总长对比',
      priority: 60,
      kind: 'auto',
    })
  }

  // ===== 5) 材质分布 =====
  if (data.pipes.length > 0) {
    out.push({
      icon: '🔩',
      title: '看看管线材质分布',
      subtitle: '钢管、PE管各占多少',
      query: '管线材质分布',
      priority: 40,
      kind: 'preset',
    })
  }

  // ===== 6) 调压箱数量对比 =====
  if (data.regulators.length > 0) {
    out.push({
      icon: '🏭',
      title: '各小区调压箱数量',
      subtitle: `${data.regulators.length} 个调压箱分布在 ${new Set(data.regulators.map((r) => r.community)).size} 个小区`,
      query: '各小区调压箱数量',
      priority: 30,
      kind: 'preset',
    })
  }

  // ===== 7) 压力分布 =====
  if (data.pipes.length > 0) {
    out.push({
      icon: '💨',
      title: '压力等级分布',
      subtitle: '看看低压 / 中压A / 中压B 的比例',
      query: '管线压力分布',
      priority: 20,
      kind: 'preset',
    })
  }

  // 排序 + 截断
  return out.sort((a, b) => b.priority - a.priority).slice(0, 6)
}

/** 获取"猜您想问"卡片颜色（按 kind） */
export function getSuggestionColor(kind: Suggestion['kind']): string {
  switch (kind) {
    case 'alert': return '#f56c6c'
    case 'hint': return '#e6a23c'
    case 'auto': return '#409eff'
    case 'preset': return '#67c23a'
    default: return '#909399'
  }
}
