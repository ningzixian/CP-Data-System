import type { FastifyPluginAsync } from "fastify"
import { z } from "zod"
import { readCollection, findById, updateCollection, generateId } from "../storage/jsonStore.js"
import type { Task, DetectionPoint } from "../types/index.js"
import { authPlugin, type AuthPluginOptions } from "../auth/authPlugin.js"

/**
 * Task CRUD routes (auth required).
 *
 * - GET    /tasks       returns all tasks (sorted by createdAt desc)
 * - GET    /tasks/:id   returns a single task; 404 when missing
 * - POST   /tasks       creates a new task; 400 on invalid body
 * - PUT    /tasks/:id   updates a task; 404 when missing; 400 on invalid body
 * - DELETE /tasks/:id   deletes a task; 404 when missing
 */
export interface TasksRouteOptions extends AuthPluginOptions {
  /** JSON collection root directory (jsonDir). */
  jsonDir: string
}

/** 创建/更新任务的请求体 schema（不含服务端生成的字段） */
const TaskBodySchema = z.object({
  name: z.string().min(1),
  area: z.string().min(1),
  unit: z.string().min(1),
  buildings: z.array(z.string()),
  pressureLevel: z.enum(['low', 'medA', 'medB']),
})

/** 当前 ISO 时间戳 */
function now(): string {
  return new Date().toISOString()
}

/**
 * Sort tasks by createdAt descending (newest first). When two tasks share a
 * timestamp, fall back to id ordering (descending) for stable ordering.
 *
 * Returns a negative number when `a` should come before `b`. Uses a single
 * expression so there are no unreachable branches: when createdAt values are
 * equal, the createdAt comparison yields 0 and the id comparison decides.
 */
function sortByCreatedAtDesc(a: Task, b: Task): number {
  // Primary: createdAt descending (b - a). localeCompare gives -1/0/1.
  const byTime = b.createdAt.localeCompare(a.createdAt)
  // Tie-break: id descending (b - a).
  return byTime !== 0 ? byTime : b.id.localeCompare(a.id)
}

export const tasksRoutes: FastifyPluginAsync<TasksRouteOptions> = async (app, opts) => {
  // Create a single authPlugin instance; all task routes reuse it.
  const requireAuth = authPlugin(opts)
  const jsonDir = opts.jsonDir
  const collection = "tasks"

  app.get("/tasks", { preHandler: requireAuth }, async (_req, reply) => {
    const tasks = await readCollection<Task>(jsonDir, collection)
    tasks.sort(sortByCreatedAtDesc)

    // 计算每个任务的检测点数量
    const points = await readCollection<DetectionPoint>(jsonDir, "points")
    const countMap = new Map<string, number>()
    for (const p of points) {
      countMap.set(p.taskId, (countMap.get(p.taskId) ?? 0) + 1)
    }
    const enriched = tasks.map((t) => ({
      ...t,
      pointsCount: countMap.get(t.id) ?? 0,
    }))

    return reply.send(enriched)
  })

  app.get("/tasks/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const task = await findById<Task>(jsonDir, collection, id)
    if (!task) {
      return reply.code(404).send({ error: "task not found" })
    }
    return reply.send(task)
  })

  app.post("/tasks", { preHandler: requireAuth }, async (req, reply) => {
    const parsed = TaskBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request body" })
    }
    const ts = now()
    const task: Task = {
      id: generateId(),
      ...parsed.data,
      createdAt: ts,
      updatedAt: ts,
    }
    await updateCollection<Task>(jsonDir, collection, (current) => [...current, task])
    return reply.code(201).send(task)
  })

  app.put("/tasks/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = TaskBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request body" })
    }
    let updated: Task | null = null
    await updateCollection<Task>(jsonDir, collection, (current) => {
      const idx = current.findIndex((t) => t.id === id)
      if (idx === -1) {
        return current
      }
      const prev: Task = current[idx]!
      const nextTask: Task = {
        id: prev.id,
        name: parsed.data.name,
        area: parsed.data.area,
        unit: parsed.data.unit,
        buildings: parsed.data.buildings,
        pressureLevel: parsed.data.pressureLevel,
        createdAt: prev.createdAt,
        updatedAt: now(),
      }
      updated = nextTask
      const next = [...current]
      next[idx] = nextTask
      return next
    })
    if (!updated) {
      return reply.code(404).send({ error: "task not found" })
    }
    return reply.send(updated)
  })

  app.delete("/tasks/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    let found = false
    await updateCollection<Task>(jsonDir, collection, (current) => {
      found = current.some((t) => t.id === id)
      return found ? current.filter((t) => t.id !== id) : current
    })
    if (!found) {
      return reply.code(404).send({ error: "task not found" })
    }
    return reply.code(204).send()
  })
}
