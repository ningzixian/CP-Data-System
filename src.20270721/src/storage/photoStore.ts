import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * 照片存储骨架。
 * - 照片以原始格式（jpg/png 等）直接落盘到 photosDir
 * - 返回相对 dataDir 的路径，前端可通过 /static 或 /api/photos/:name 访问
 * - 本阶段提供 savePhoto 与 ensurePhotosDir 基础能力，上传端点预留
 */

/** 确保照片目录存在 */
export async function ensurePhotosDir(photosDir: string): Promise<void> {
  await fs.mkdir(photosDir, { recursive: true })
}

/**
 * 保存原始照片文件。
 * @param photosDir 照片根目录（绝对路径）
 * @param dataDir 数据根目录（绝对路径），用于计算返回的相对路径
 * @param ext 文件扩展名（如 .jpg），无则默认 .bin
 * @param bytes 原始字节内容
 * @returns 相对 dataDir 的路径，例如 photos/xxxx.jpg
 */
export async function savePhoto(
  photosDir: string,
  dataDir: string,
  ext: string,
  bytes: Buffer,
): Promise<string> {
  await ensurePhotosDir(photosDir)
  const safeExt = ext && ext.startsWith('.') ? ext : ext ? `.${ext}` : '.bin'
  const filename = `${randomUUID()}${safeExt}`
  const abs = path.join(photosDir, filename)
  await fs.writeFile(abs, bytes)
  // 返回相对 dataDir 的路径，保持可移植
  const rel = path.relative(dataDir, abs).split(path.sep).join('/')
  return rel
}

/**
 * 将相对路径解析回绝对路径，便于后续静态服务读取。
 */
export function resolvePhotoPath(dataDir: string, relPath: string): string {
  return path.join(dataDir, relPath)
}
