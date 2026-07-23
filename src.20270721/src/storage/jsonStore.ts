import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * JSON 集合存储骨架。
 * - 数值/结构化数据以 JSON 文件形式持久化于 dataDir/json 下
 * - 采用“读全量 -> 改 -> 原子写（临时文件 + rename）”模式，降低并发写入损坏风险
 * - 提供 process 级互斥锁（基于 Map），保证同一集合的串行写入
 *
 * 本阶段为骨架，后续功能项在此之上实现 tasks/points/reports 的 CRUD。
 */

/** 集合元素基类：要求有 id 字段以便查找 */
export interface HasId {
  id: string
}

/** 进程内按集合名持有的锁状态 */
interface LockEntry {
  readonly promise: Promise<void>
  resolve: () => void
}

const locks = new Map<string, LockEntry>()

/**
 * 获取指定集合的写入锁，返回释放函数。
 * 同一 collection 串行执行临界区，避免并发写竞争。
 */
async function acquireLock(collection: string): Promise<() => void> {
  const prev = locks.get(collection)?.promise ?? Promise.resolve()
  let resolve!: () => void
  const next = new Promise<void>((res) => {
    resolve = res
  })
  locks.set(collection, { promise: next, resolve })
  await prev
  return resolve
}

/** 确保目标目录存在 */
async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

/** 单个集合的文件路径 */
function collectionFile(jsonDir: string, collection: string): string {
  return path.join(jsonDir, `${collection}.json`)
}

/**
 * 读取整个集合并返回数组。文件不存在或解析失败时返回空数组。
 * @param jsonDir JSON 根目录
 * @param collection 集合名（文件名，不含扩展名）
 */
export async function readCollection<T extends HasId>(
  jsonDir: string,
  collection: string,
): Promise<T[]> {
  const file = collectionFile(jsonDir, collection)
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed as T[]
  } catch (err) {
    // 文件不存在视为空集合；其它错误向上抛出以便定位
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw err
  }
}

/**
 * 原子写入整个集合（全量覆盖）。
 * 通过临时文件 + rename 实现原子性，避免半写入态被读到。
 *
 * 注意：此函数会获取集合写锁；若调用方已持有同一集合的锁（如
 * updateCollection 内部），应改用 writeCollectionUnlocked 以避免死锁。
 */
export async function writeCollection<T extends HasId>(
  jsonDir: string,
  collection: string,
  items: T[],
): Promise<void> {
  const release = await acquireLock(collection)
  try {
    await writeCollectionUnlocked(jsonDir, collection, items)
  } finally {
    release()
  }
}

/**
 * 不加锁的原子写入实现，供已持有锁的调用方复用。
 * 通过临时文件 + rename 实现原子性。
 */
async function writeCollectionUnlocked<T extends HasId>(
  jsonDir: string,
  collection: string,
  items: T[],
): Promise<void> {
  await ensureDir(jsonDir)
  const file = collectionFile(jsonDir, collection)
  const tmp = `${file}.${randomUUID()}.tmp`
  const data = JSON.stringify(items, null, 2)
  await fs.writeFile(tmp, data, 'utf8')
  // rename 在同分区下为原子操作
  await fs.rename(tmp, file)
}

/**
 * 读取集合后用 updater 变换再写回，便于 CRUD 复用。
 * updater 接收当前数组，返回新数组。
 *
 * 在同一把锁内完成读-改-写，避免与 writeCollection 重复获取锁导致死锁。
 */
export async function updateCollection<T extends HasId>(
  jsonDir: string,
  collection: string,
  updater: (current: T[]) => T[] | Promise<T[]>,
): Promise<T[]> {
  const release = await acquireLock(collection)
  try {
    const current = await readCollection<T>(jsonDir, collection)
    const next = await updater(current)
    await writeCollectionUnlocked(jsonDir, collection, next)
    return next
  } finally {
    release()
  }
}

/** 按 id 查找单个元素 */
export async function findById<T extends HasId>(
  jsonDir: string,
  collection: string,
  id: string,
): Promise<T | undefined> {
  const all = await readCollection<T>(jsonDir, collection)
  return all.find((item) => item.id === id)
}

/** 生成新 id（基于 crypto.randomUUID，避免引入 uuid 依赖冲突，保留 uuid 作为可选） */
export function generateId(): string {
  return randomUUID()
}
