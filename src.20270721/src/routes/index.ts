import type { FastifyPluginAsync } from 'fastify'
import { healthRoutes } from './health.js'
import { authRoutes } from './auth.js'
import { tasksRoutes } from './tasks.js'
import { pointsRoutes } from './points.js'
import { reportsRoutes } from './reports.js'
import { photosRoutes } from './photos.js'
import type { AppConfig } from '../config.js'

/**
 * 聚合路由注册器。
 * 所有业务路由统一挂载到 /api 前缀下，后续功能项在此追加：
 *   - tasks   任务 CRUD
 *   - points  检测点 CRUD
 *   - reports 检测填报 CRUD
 *   - photos  照片上传（multipart）
 *
 * 本阶段仅注册 health，作为路由骨架。
 */
export const apiRoutes: FastifyPluginAsync<AppConfig> = async (app, opts) => {
  // 子路由选项：仅透传 AppConfig 字段（jsonDir 等），不携带 Fastify 的 prefix，
  // 否则子插件会再次叠加前缀，导致 /api/api/... 双重前缀。
  const subOpts: AppConfig = {
    port: opts.port,
    host: opts.host,
    dataDir: opts.dataDir,
    photosDir: opts.photosDir,
    jsonDir: opts.jsonDir,
    corsOrigin: opts.corsOrigin,
  }

  // 健康检查：GET /api/health
  await app.register(healthRoutes)

  // 登录鉴权：POST /api/auth/login（无需鉴权）
  await app.register(authRoutes, subOpts)

  // 任务列表查询（需鉴权）
  await app.register(tasksRoutes, subOpts)

  // 检测点 CRUD（需鉴权）
  await app.register(pointsRoutes, subOpts)

  // 检测填报 CRUD（需鉴权）
  await app.register(reportsRoutes, subOpts)

  // 照片上传（multipart，需鉴权）
  await app.register(photosRoutes, subOpts)
}
