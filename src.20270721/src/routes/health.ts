import type { FastifyPluginAsync } from 'fastify'
import type { HealthResponse } from '../types/index.js'

/**
 * 健康检查路由。
 * GET /api/health -> { status: "ok" }
 *
 * 作为基础基座探活端点，后续功能项路由在各子模块中注册。
 */
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', {
    handler: async (): Promise<HealthResponse> => {
      return { status: 'ok' }
    },
  })
}
