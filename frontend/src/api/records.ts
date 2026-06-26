import { request } from './client'
import type { InspectionRecord, InspectionRecordInput, InspectionItemCode } from '@/types/models'

export const recordsApi = {
  list: (params?: { unit_id?: number; item_code?: InspectionItemCode }) =>
    request<InspectionRecord[]>({
      url: '/api/records',
      method: 'GET',
      params,
    }),
  create: (data: InspectionRecordInput) =>
    request<InspectionRecord>({ url: '/api/records', method: 'POST', data }),
  update: (id: number, data: InspectionRecordInput) =>
    request<InspectionRecord>({ url: `/api/records/${id}`, method: 'PUT', data }),
  remove: (id: number) =>
    request<{ ok: boolean }>({ url: `/api/records/${id}`, method: 'DELETE' }),
}