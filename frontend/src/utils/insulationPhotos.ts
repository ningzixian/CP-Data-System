export interface InsulationPhotoRecord {
  id: string
  ownerKey: string
  inletId: number
  name: string
  type: string
  size: number
  createdAt: string
  blob: Blob
}

const DB_NAME = 'cp-data-system-insulation'
const DB_VERSION = 1
const STORE_NAME = 'inlet-photos'
const OWNER_INDEX = 'ownerKey'

let databasePromise: Promise<IDBDatabase> | null = null
const photoListRequests = new Map<string, Promise<InsulationPhotoRecord[]>>()
const photoListCache = new Map<string, InsulationPhotoRecord[]>()

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('照片写入失败'))
    transaction.onabort = () => reject(transaction.error ?? new Error('照片写入已取消'))
  })
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('当前浏览器不支持照片本地持久化'))
      return
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      const store = database.objectStoreNames.contains(STORE_NAME)
        ? request.transaction!.objectStore(STORE_NAME)
        : database.createObjectStore(STORE_NAME, { keyPath: 'id' })
      if (!store.indexNames.contains(OWNER_INDEX)) {
        store.createIndex(OWNER_INDEX, OWNER_INDEX, { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      databasePromise = null
      reject(request.error ?? new Error('绝缘性能照片数据库打开失败'))
    }
  })
  return databasePromise
}

export async function listInsulationPhotos(ownerKey: string): Promise<InsulationPhotoRecord[]> {
  const cached = photoListCache.get(ownerKey)
  if (cached) return cached
  const pending = photoListRequests.get(ownerKey)
  if (pending) return pending

  const request = (async () => {
    const database = await openDatabase()
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const records = await requestResult(
      transaction.objectStore(STORE_NAME).index(OWNER_INDEX).getAll(ownerKey),
    ) as InsulationPhotoRecord[]
    const sorted = records.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    photoListCache.set(ownerKey, sorted)
    return sorted
  })()
  photoListRequests.set(ownerKey, request)
  try {
    return await request
  } finally {
    if (photoListRequests.get(ownerKey) === request) photoListRequests.delete(ownerKey)
  }
}

/** 在同一个 IndexedDB 事务中批量读取多个检测位置的照片。 */
export async function listInsulationPhotosForOwners(ownerKeys: string[]): Promise<Map<string, InsulationPhotoRecord[]>> {
  const keys = [...new Set(ownerKeys)]
  const result = new Map<string, InsulationPhotoRecord[]>()
  const missing = keys.filter((key) => {
    const cached = photoListCache.get(key)
    if (cached) result.set(key, cached)
    return !cached
  })
  if (!missing.length) return result

  const database = await openDatabase()
  const transaction = database.transaction(STORE_NAME, 'readonly')
  const index = transaction.objectStore(STORE_NAME).index(OWNER_INDEX)
  const records = await Promise.all(missing.map(async (key) => {
    const items = await requestResult(index.getAll(key)) as InsulationPhotoRecord[]
    items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    photoListCache.set(key, items)
    return [key, items] as const
  }))
  records.forEach(([key, items]) => result.set(key, items))
  return result
}

export async function addInsulationPhotos(ownerKey: string, inletId: number, files: File[]): Promise<void> {
  if (!files.length) return
  const database = await openDatabase()
  const transaction = database.transaction(STORE_NAME, 'readwrite')
  const store = transaction.objectStore(STORE_NAME)
  const now = Date.now()
  files.forEach((file, index) => {
    const record: InsulationPhotoRecord = {
      id: `${ownerKey}:${now + index}:${crypto.randomUUID()}`,
      ownerKey,
      inletId,
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      createdAt: new Date(now + index).toISOString(),
      blob: file,
    }
    store.put(record)
  })
  await transactionDone(transaction)
  photoListCache.delete(ownerKey)
}

export async function deleteInsulationPhoto(id: string): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(STORE_NAME, 'readwrite')
  transaction.objectStore(STORE_NAME).delete(id)
  await transactionDone(transaction)
  photoListCache.clear()
}

export async function deleteInsulationPhotos(ownerKey: string): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(STORE_NAME, 'readwrite')
  const store = transaction.objectStore(STORE_NAME)
  const index = store.index(OWNER_INDEX)
  const request = index.openKeyCursor(IDBKeyRange.only(ownerKey))
  request.onsuccess = () => {
    const cursor = request.result
    if (!cursor) return
    store.delete(cursor.primaryKey)
    cursor.continue()
  }
  await transactionDone(transaction)
  photoListCache.delete(ownerKey)
}
