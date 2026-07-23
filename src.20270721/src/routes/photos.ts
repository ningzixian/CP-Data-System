import type { FastifyPluginAsync } from "fastify"
import { authPlugin, type AuthPluginOptions } from "../auth/authPlugin.js"
import { savePhoto, resolvePhotoPath } from "../storage/photoStore.js"
import { promises as fs } from "node:fs"
import path from "node:path"

/**
 * 照片上传路由（需鉴权）。
 *
 * - POST /photos  multipart/form-data, field "file" -> { path }
 *
 * 照片以原始格式落盘到 photosDir，返回相对 dataDir 的路径。
 * 文件缺失或超限时返回 400。
 */
export interface PhotosRouteOptions extends AuthPluginOptions {
  /** 数据根目录（绝对路径），用于计算照片相对路径 */
  dataDir: string
  /** 照片存储目录（绝对路径） */
  photosDir: string
}

export const photosRoutes: FastifyPluginAsync<PhotosRouteOptions> = async (app, opts) => {
  const requireAuth = authPlugin(opts)

  app.post("/photos", { preHandler: requireAuth }, async (req, reply) => {
    const file = await req.file()
    if (!file) {
      return reply.code(400).send({ error: "missing file field" })
    }
    const buffer = await file.toBuffer()
    // 先从文件名推断扩展名，无扩展名时回退到 mimetype
    const ext = extFromName(file.filename) ?? extFromMime(file.mimetype)
    const relPath = await savePhoto(opts.photosDir, opts.dataDir, ext, buffer)
    return reply.code(201).send({ path: relPath })
  })

  // serve photo files: GET /photos/file/*
  app.get("/photos/file/*", async (req, reply) => {
    const url = req.url
    const prefix = "/photos/file/"
    const relPath = decodeURIComponent(url.slice(url.indexOf(prefix) + prefix.length))
    const abs = resolvePhotoPath(opts.dataDir, relPath)
    const dataDirResolved = path.resolve(opts.dataDir)
    if (!abs.startsWith(dataDirResolved)) {
      return reply.code(403).send({ error: "forbidden" })
    }
    try {
      const buffer = await fs.readFile(abs)
      const ext = path.extname(abs).toLowerCase()
      const mime = ext === ".png" ? "image/png"
        : ext === ".gif" ? "image/gif"
        : ext === ".webp" ? "image/webp"
        : "image/jpeg"
      return reply.type(mime).send(buffer)
    } catch {
      return reply.code(404).send({ error: "photo not found" })
    }
  })
}

/** 从文件名提取扩展名（含点号），无则返回空字符串 */
/** 从文件名提取扩展名（含点号），无扩展名时返回 undefined */
function extFromName(filename: string | undefined): string | undefined {
  if (!filename) return undefined
  const idx = filename.lastIndexOf('.')
  return idx > 0 ? filename.slice(idx) : undefined
}

/** 从 mimetype 推断扩展名（仅覆盖常见图片类型） */
function extFromMime(mime: string | undefined): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
  }
  return (mime && map[mime]) ?? '.bin'
}
