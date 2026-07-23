import type { FastifyPluginAsync } from "fastify"
import { z } from "zod"
import { readCollection, updateCollection, generateId } from "../storage/jsonStore.js"
import type { DetectionReport, DetectionPoint, Task } from "../types/index.js"
import {
  DetectionReportItemsSchema,
} from "../types/index.js"
import { authPlugin, type AuthPluginOptions } from "../auth/authPlugin.js"

/**
 * 检测填报 CRUD 路由（需鉴权）。
 * 填报归属于任务与检测点。
 *
 * - GET  /tasks/:taskId/reports         列出该任务下的填报（可选 pointId 过滤）
 * - POST /tasks/:taskId/reports         创建填报（body 含 pointId + items）
 *
 * 任务或检测点不存在时返回 404；body 不合法返回 400。
 */
export interface ReportsRouteOptions extends AuthPluginOptions {
  /** JSON collection root directory (jsonDir). */
  jsonDir: string
}

/** 创建填报的请求体 schema（含 pointId 与 items） */
const ReportBodySchema = z.object({
  pointId: z.string().min(1),
  items: DetectionReportItemsSchema,
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

/** 检查指定检测点是否属于该任务 */
async function pointBelongsToTask(
  jsonDir: string,
  taskId: string,
  pointId: string,
): Promise<boolean> {
  const points = await readCollection<DetectionPoint>(jsonDir, "points")
  return points.some((p) => p.id === pointId && p.taskId === taskId)
}

export const reportsRoutes: FastifyPluginAsync<ReportsRouteOptions> = async (app, opts) => {
  const requireAuth = authPlugin(opts)
  const jsonDir = opts.jsonDir
  const collection = "reports"

  app.get("/tasks/:taskId/reports", { preHandler: requireAuth }, async (req, reply) => {
    const { taskId } = req.params as { taskId: string }
    if (!(await taskExists(jsonDir, taskId))) {
      return reply.code(404).send({ error: "task not found" })
    }
    const query = req.query as { pointId?: string }
    const all = await readCollection<DetectionReport>(jsonDir, collection)
    const reports = all.filter((r) => {
      if (r.taskId !== taskId) return false
      if (query.pointId && r.pointId !== query.pointId) return false
      return true
    })
    return reply.send(reports)
  })

  app.post("/tasks/:taskId/reports", { preHandler: requireAuth }, async (req, reply) => {
    const { taskId } = req.params as { taskId: string }
    if (!(await taskExists(jsonDir, taskId))) {
      return reply.code(404).send({ error: "task not found" })
    }
    const parsed = ReportBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request body" })
    }
    const { pointId, items } = parsed.data
    if (!(await pointBelongsToTask(jsonDir, taskId, pointId))) {
      return reply.code(404).send({ error: "point not found" })
    }
    const report: DetectionReport = {
      id: generateId(),
      taskId,
      pointId,
      items,
      createdAt: now(),
    }
    await updateCollection<DetectionReport>(jsonDir, collection, (current) => [...current, report])
    return reply.code(201).send(report)
  })
}
