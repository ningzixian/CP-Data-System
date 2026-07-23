import path from 'node:path'
import Fastify, { type FastifyPluginOptions } from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import httpProxy  from '@fastify/http-proxy'
import { apiRoutes } from './routes/index.js'
import { loadConfig, type AppConfig } from './config.js'
import { ensurePhotosDir } from './storage/photoStore.js'
import { promises as fs } from 'node:fs'
import { readFileSync } from 'node:fs'

/**
 * 构建并返回 Fastify 应用实例（工厂模式）。
 *
 * 设计为工厂而非单例，便于：
 * - 测试中以自定义 opts 构造独立实例（fastify inject）
 * - 后续按需注入不同的配置（如临时数据目录）
 *
 * @param opts 可选配置覆盖；未提供时使用 loadConfig() 默认值
 */
export interface BuildAppOptions {
  /** 覆盖默认配置（端口/数据目录等） */
  config?: AppConfig
  /** 是否在启动时确保数据目录存在（测试可关闭） */
  ensureDirs?: boolean
  /** 透传给 Fastify 构造器的选项 */
  fastifyOptions?: FastifyPluginOptions
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<any> {
  const cfg = opts.config ?? loadConfig()

  // 创建数据目录（测试可关闭以避免副作用）
  if (opts.ensureDirs !== false) {
    await fs.mkdir(cfg.jsonDir, { recursive: true })
    await ensurePhotosDir(cfg.photosDir)
  }

  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
    http2: true,
    https: {
      allowHTTP1: true,
      key: readFileSync(path.join(process.cwd(), 'server', 'data', 'openssl','key.pem')),
      cert: readFileSync(path.join(process.cwd(), 'server', 'data', 'openssl','cert.pem'))
    },
    ...opts.fastifyOptions,
  })

  // 注册 CORS：允许跨域，来源可配置
  await app.register(cors, {
    origin: cfg.corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })

  // 注册 multipart：照片上传预留
  await app.register(multipart, {
    // 限制单文件 50MB，避免大照片耗尽内存
    limits: {
      fileSize: 50 * 1024 * 1024,
    },
  })

  // 注册 staticPlugin：静态文件服务（如 www 目录,用于client静态资源访问）
  const wwwRootDir = path.join(process.cwd(), 'www')
  console.log('client root dir:', wwwRootDir, fastifyStatic)
  await app.register(fastifyStatic, {
    root: wwwRootDir,
    prefix: '/',
  })

  // 反向代理地图组件
  await app.register(httpProxy, {
    upstream: 'http://192.168.20.40:9001',
    prefix: '/api/pipes-tiles', // optional
    rewritePrefix: '/pipes',
    http2: false, // optional
  })


  // 统一挂载业务路由到 /api 前缀
  // 将应用配置（jsonDir/JWT 密钥等）透传给聚合路由，下游 auth/tasks 据此读写集合与签发 token
  await app.register(apiRoutes, { prefix: '/api', ...cfg })

  return app
}
