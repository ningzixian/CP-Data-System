import { request } from './client'
import type { Pipeline, PipelineInput } from '@/types/models'

export const pipelinesApi = {
  list: () => request<Pipeline[]>({ url: '/api/pipelines', method: 'GET' }),
  get: (id: number) => request<Pipeline>({ url: `/api/pipelines/${id}`, method: 'GET' }),
  create: (data: PipelineInput) => request<Pipeline>({ url: '/api/pipelines', method: 'POST', data }),
}