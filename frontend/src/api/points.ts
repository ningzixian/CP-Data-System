import { request } from './client'
import type { InspectionPoint, InspectionPointInput } from '@/types/models'

export const pointsApi = {
  list: (unit_id?: number) =>
    request<InspectionPoint[]>({
      url: '/api/points',
      method: 'GET',
      params: unit_id ? { unit_id } : undefined,
    }),
  create: (data: InspectionPointInput) =>
    request<InspectionPoint>({ url: '/api/points', method: 'POST', data }),
}