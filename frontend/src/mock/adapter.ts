/**
 * Mock 适配器 — 拦截 axios 请求，返回内存里的数据
 * 用法：api 调用走 axios → 这里捕获 → 返回 mockStore 数据
 */
import type { AxiosRequestConfig } from 'axios'
import {
  mockStore, buildDashboard, computeUnitProgress,
} from './data'
import { INSPECTION_ITEMS } from '@/types/items'

function delay<T>(data: T, ms = 200): Promise<T> {
  return new Promise((res) => setTimeout(() => res(data), ms))
}

function ok<T>(data: T) {
  return { data, status: 200, statusText: 'OK', headers: {}, config: {} as AxiosRequestConfig }
}

function err(status: number, message: string) {
  const e: any = new Error(message)
  e.response = { status, data: { detail: message } }
  return e
}

export async function mockAdapter(config: AxiosRequestConfig): Promise<any> {
  const { url = '', method = 'GET', data, params } = config
  const path = url.split('?')[0]
  const query = new URLSearchParams(url.includes('?') ? url.split('?')[1] : '')
  const getParam = (k: string) => params?.[k] ?? query.get(k) ?? undefined

  // ----- 检测项定义 -----
  if (path === '/api/items' && method.toUpperCase() === 'GET') {
    return delay(ok(INSPECTION_ITEMS))
  }

  // ----- 管道 -----
  if (path === '/api/pipelines' && method.toUpperCase() === 'GET') {
    return delay(ok([...mockStore.pipelines]))
  }
  if (path === '/api/pipelines' && method.toUpperCase() === 'POST') {
    const body = typeof data === 'string' ? JSON.parse(data) : data
    const obj = { ...body, id: mockStore.nextId++, created_at: new Date().toISOString() }
    mockStore.pipelines.push(obj)
    return delay(ok(obj))
  }
  const pipelineMatch = path.match(/^\/api\/pipelines\/(\d+)$/)
  if (pipelineMatch) {
    const id = +pipelineMatch[1]
    const p = mockStore.pipelines.find((x) => x.id === id)
    if (!p) throw err(404, '管道不存在')
    return delay(ok(p))
  }

  // ----- 腐控单元 -----
  if (path === '/api/units' && method.toUpperCase() === 'GET') {
    const pipelineId = getParam('pipeline_id')
    let list = [...mockStore.units]
    if (pipelineId) list = list.filter((u) => u.pipeline_id === +pipelineId)
    return delay(ok(list))
  }
  if (path === '/api/units' && method.toUpperCase() === 'POST') {
    const body = typeof data === 'string' ? JSON.parse(data) : data
    const obj: any = {
      id: mockStore.nextId++,
      ...body,
      inspection_progress: 0,
      inspection_status: 'pending',
      created_at: new Date().toISOString(),
    }
    mockStore.units.push(obj)
    return delay(ok(obj))
  }
  const unitMatch = path.match(/^\/api\/units\/(\d+)$/)
  if (unitMatch) {
    const id = +unitMatch[1]
    const idx = mockStore.units.findIndex((u) => u.id === id)
    if (idx < 0) throw err(404, '单元不存在')
    if (method.toUpperCase() === 'GET') return delay(ok(mockStore.units[idx]))
    if (method.toUpperCase() === 'PUT') {
      const body = typeof data === 'string' ? JSON.parse(data) : data
      mockStore.units[idx] = { ...mockStore.units[idx], ...body }
      return delay(ok(mockStore.units[idx]))
    }
    if (method.toUpperCase() === 'DELETE') {
      mockStore.units.splice(idx, 1)
      mockStore.records = mockStore.records.filter((r) => r.unit_id !== id)
      return delay(ok({ ok: true }))
    }
  }

  // ----- 检测点 -----
  if (path === '/api/points' && method.toUpperCase() === 'GET') {
    const unitId = getParam('unit_id')
    let list = [...mockStore.points]
    if (unitId) list = list.filter((p) => p.unit_id === +unitId)
    return delay(ok(list))
  }
  if (path === '/api/points' && method.toUpperCase() === 'POST') {
    const body = typeof data === 'string' ? JSON.parse(data) : data
    const obj = { ...body, id: mockStore.nextId++, created_at: new Date().toISOString() }
    mockStore.points.push(obj)
    return delay(ok(obj))
  }

  // ----- 检测记录 -----
  if (path === '/api/records' && method.toUpperCase() === 'GET') {
    const unitId = getParam('unit_id') ? +getParam('unit_id') : undefined
    const itemCode = getParam('item_code')
    let list = [...mockStore.records]
    console.log('[mock] /api/records GET, total records:', list.length, 'unit_id:', unitId)
    if (unitId !== undefined) list = list.filter((r) => r.unit_id === unitId)
    if (itemCode) list = list.filter((r) => r.item_code === itemCode)
    return delay(ok(list))
  }
  if (path === '/api/records' && method.toUpperCase() === 'POST') {
    const body = typeof data === 'string' ? JSON.parse(data) : data
    const obj: any = {
      id: mockStore.nextId++,
      ...body,
      item_name: INSPECTION_ITEMS.find((i) => i.code === body.item_code)?.name,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    mockStore.records.push(obj)
    refreshUnit(obj.unit_id)
    return delay(ok(obj))
  }
  const recordMatch = path.match(/^\/api\/records\/(\d+)$/)
  if (recordMatch) {
    const id = +recordMatch[1]
    const idx = mockStore.records.findIndex((r) => r.id === id)
    if (idx < 0) throw err(404, '记录不存在')
    if (method.toUpperCase() === 'PUT') {
      const body = typeof data === 'string' ? JSON.parse(data) : data
      mockStore.records[idx] = {
        ...mockStore.records[idx], ...body,
        updated_at: new Date().toISOString(),
      }
      refreshUnit(mockStore.records[idx].unit_id)
      return delay(ok(mockStore.records[idx]))
    }
    if (method.toUpperCase() === 'DELETE') {
      const uid = mockStore.records[idx].unit_id
      mockStore.records.splice(idx, 1)
      refreshUnit(uid)
      return delay(ok({ ok: true }))
    }
  }

  // ----- 仪表盘 -----
  if (path === '/api/dashboard' && method.toUpperCase() === 'GET') {
    return delay(ok(buildDashboard()))
  }

  // ----- Excel 导入 -----
  if (path === '/api/import/excel' && method.toUpperCase() === 'POST') {
    return delay(ok({ imported: 0, errors: ['mock 模式下 Excel 导入未实现，请在后端真实环境中使用'] }))
  }

  throw err(404, `Mock 路由未实现：${method} ${path}`)
}

function refreshUnit(unitId: number) {
  const idx = mockStore.units.findIndex((u) => u.id === unitId)
  if (idx < 0) return
  const { progress, status } = computeUnitProgress(unitId)
  mockStore.units[idx].inspection_progress = progress
  mockStore.units[idx].inspection_status = status
  const latest = mockStore.records
    .filter((r) => r.unit_id === unitId)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
  if (latest) mockStore.units[idx].last_inspection_at = latest.updated_at
}

export default mockAdapter