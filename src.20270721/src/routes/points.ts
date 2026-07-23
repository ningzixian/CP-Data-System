import type { FastifyPluginAsync } from "fastify"
import { z } from "zod"
import { readCollection, updateCollection, generateId } from "../storage/jsonStore.js"
import type { DetectionPoint, Task } from "../types/index.js"
import { DataTypeSchema } from "../types/index.js"
import { authPlugin, type AuthPluginOptions } from "../auth/authPlugin.js"

/**
 * 检测点 CRUD 路由（需鉴权）。
 * 检测点归属于任务，路径含 taskId。
 *
 * - GET    /tasks/:taskId/points         列出该任务下所有检测点
 * - POST   /tasks/:taskId/points         在该任务下创建检测点
 * - DELETE /tasks/:taskId/points/:pointId 删除检测点
 *
 * 任务不存在时返回 404；检测点不存在时返回 404。
 */
export interface PointsRouteOptions extends AuthPluginOptions {
  /** JSON collection root directory (jsonDir). */
  jsonDir: string
}

/** 创建检测点的请求体 schema */
const PointBodySchema = z.object({
  location: z.string().min(1),
  lng: z.number(),
  lat: z.number(),
  dataTypes: z.array(DataTypeSchema),
})

/** 当前 ISO 时间戳 */
function now(): string {
  return new Date().toISOString()
}

/** 检查指定任务是否存在 */
async function taskExists(jsonDir: string, taskId: string): Promise<boolean> {
  const tasks = await readCollection<Task>(jsonDir, "tasks")
  return tasks.some((t) => t.id === taskId)
}

export const pointsRoutes: FastifyPluginAsync<PointsRouteOptions> = async (app, opts) => {
  const requireAuth = authPlugin(opts)
  const jsonDir = opts.jsonDir
  const collection = "points"

  app.get("/tasks/:taskId/points", { preHandler: requireAuth }, async (req, reply) => {
    const { taskId } = req.params as { taskId: string }
    if (!(await taskExists(jsonDir, taskId))) {
      return reply.code(404).send({ error: "task not found" })
    }
    const all = await readCollection<DetectionPoint>(jsonDir, collection)
    const points = all.filter((p) => p.taskId === taskId)
    return reply.send(points)
  })

  app.post("/tasks/:taskId/points", { preHandler: requireAuth }, async (req, reply) => {
    const { taskId } = req.params as { taskId: string }
    if (!(await taskExists(jsonDir, taskId))) {
      return reply.code(404).send({ error: "task not found" })
    }
    const parsed = PointBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request body" })
    }

    // 计算序号: 同一任务内已有点的最大 seq + 1, 首个为 1
    const all = await readCollection<DetectionPoint>(jsonDir, collection)
    const taskPoints = all.filter((p) => p.taskId === taskId)
    const maxSeq = taskPoints.reduce((max, p) => {
      const s = (p as { seq?: number }).seq ?? 0
      return s > max ? s : max
    }, 0)
    const seq = maxSeq + 1

    const point: DetectionPoint = {
      id: generateId(),
      taskId,
      seq,
      ...parsed.data,
      createdAt: now(),
    }
    await updateCollection<DetectionPoint>(jsonDir, collection, (current) => [...current, point])
    return reply.code(201).send(point)
  })

  app.delete(
    "/tasks/:taskId/points/:pointId",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { taskId, pointId } = req.params as { taskId: string; pointId: string }
      if (!(await taskExists(jsonDir, taskId))) {
        return reply.code(404).send({ error: "task not found" })
      }
      let found = false
      await updateCollection<DetectionPoint>(jsonDir, collection, (current) => {
        found = current.some((p) => p.id === pointId && p.taskId === taskId)
        return found ? current.filter((p) => p.id !== pointId) : current
      })
      if (!found) {
        return reply.code(404).send({ error: "point not found" })
      }
      return reply.code(204).send()
    },
  )
}
