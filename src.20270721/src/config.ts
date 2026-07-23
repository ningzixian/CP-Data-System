import path from 'node:path'

/**
 * 应用配置。
 * - 端口默认 3000，可通过 PORT 覆盖
 * - 数据目录默认 ./server/data，可通过 DATA_DIR 覆盖（相对路径基于 cwd 解析为绝对路径）
 * - photos 子目录固定为 data 目录下的 photos
 */
export interface AppConfig {
  /** 服务监听端口 */
  readonly port: number
  /** 服务监听主机 */
  readonly host: string
  /** 数据根目录（绝对路径） */
  readonly dataDir: string
  /** 照片存储目录（绝对路径，位于 dataDir 下） */
  readonly photosDir: string
  /** JSON 集合存储目录（绝对路径，位于 dataDir 下） */
  readonly jsonDir: string
  /** CORS 允许来源 */
  readonly corsOrigin: string | string[]
}

/**
 * 将可能为相对路径的目录解析为绝对路径（基于当前工作目录）。
 * 允许通过 DATA_DIR=./server/data 或 /tmp/data 等配置。
 */
function resolveDir(dir: string | undefined, fallback: string): string {
  const raw = dir && dir.trim().length > 0 ? dir : fallback
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw)
}

/**
 * 读取并构造配置实例。
 * 设计为可注入环境变量，便于测试时构造自定义配置。
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataDir = resolveDir(env['DATA_DIR'], path.resolve(process.cwd(), 'server', 'data'))
  const photosDir = path.join(dataDir, 'photos')
  const jsonDir = path.join(dataDir, 'json')
  // corsOrigin 支持逗号分隔的多来源，或单一字符串
  const corsRaw = env['CORS_ORIGIN'] ?? '*'
  const corsOrigin = corsRaw.includes(',')
    ? corsRaw.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    : corsRaw
  return {
    port: Number(env['PORT'] ?? '3000'),
    host: env['HOST'] ?? '0.0.0.0',
    dataDir,
    photosDir,
    jsonDir,
    corsOrigin,
  }
}

/** 默认单例配置，供非测试场景直接引用 */
export const config = loadConfig()
