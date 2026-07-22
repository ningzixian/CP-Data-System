/**
 * 检测项定义 — 前端直接用静态常量，不走 API。
 * 后端若提供 /api/items，前端会优先调用以支持动态配置。
 */
import { INSPECTION_ITEMS } from '@/types/items'
import type { InspectionItemDef } from '@/types/models'
import { request } from './client'

export async function fetchItems(): Promise<InspectionItemDef[]> {
  try {
    const backendItems = await request<InspectionItemDef[]>({ url: '/api/items' })
    // 手机端的土壤酸碱值并入土壤电阻率模块，不再作为第 8 个独立模块展示。
    return backendItems
      .filter((item) => item.code !== ('SOIL_PH' as InspectionItemDef['code']))
      .map((item) => item.code === 'SOIL_RESISTIVITY'
        ? { ...item, name: '② 土壤电阻率检测' }
        : item)
  } catch (error) {
    console.warn('[Items] 动态检测项加载失败，使用前端静态定义：', error)
    return INSPECTION_ITEMS
  }
}
