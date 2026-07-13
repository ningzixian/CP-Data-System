/**
 * 检测项定义 — 前端直接用静态常量，不走 API。
 * 后端若提供 /api/items，前端会优先调用以支持动态配置。
 */
import { INSPECTION_ITEMS } from '@/types/items'
import type { InspectionItemDef } from '@/types/models'
import { request } from './client'

export async function fetchItems(): Promise<InspectionItemDef[]> {
  try {
    return await request<InspectionItemDef[]>({ url: '/api/items' })
  } catch (error) {
    console.warn('[Items] 动态检测项加载失败，使用前端静态定义：', error)
    return INSPECTION_ITEMS
  }
}
