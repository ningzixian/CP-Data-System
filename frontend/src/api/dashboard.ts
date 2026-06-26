import { request } from './client'
import type { DashboardData } from '@/types/models'

export const dashboardApi = {
  get: (pipeline_id?: number) =>
    request<DashboardData>({
      url: '/api/dashboard',
      method: 'GET',
      params: pipeline_id ? { pipeline_id } : undefined,
    }),
}