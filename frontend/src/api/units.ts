import { request } from './client'
import type { CorrosionUnit, CorrosionUnitInput } from '@/types/models'

export const unitsApi = {
  list: (pipeline_id?: number) =>
    request<CorrosionUnit[]>({
      url: '/api/units',
      method: 'GET',
      params: pipeline_id ? { pipeline_id } : undefined,
    }),
  get: (id: number) => request<CorrosionUnit>({ url: `/api/units/${id}`, method: 'GET' }),
  create: (data: CorrosionUnitInput) =>
    request<CorrosionUnit>({ url: '/api/units', method: 'POST', data }),
  update: (id: number, data: Partial<CorrosionUnitInput>) =>
    request<CorrosionUnit>({ url: `/api/units/${id}`, method: 'PUT', data }),
  remove: (id: number) =>
    request<{ ok: boolean }>({ url: `/api/units/${id}`, method: 'DELETE' }),
}