/**
 * 勘测点位照片持久化。
 *
 * 图片 Blob 存在 IndexedDB，避免使用 localStorage/base64 导致容量迅速耗尽。
 * ownerKey 同时包含点位 ID 和 createdAt，防止 CSV 换版后复用相同 ID 时串照片。
 */
export interface SurveyPhotoRecord {
  id: string
  ownerKey: string
  pointId: string
  name: string
  type: string
  size: number
  createdAt: string
  blob: Blob
}

const DB_NAME = 'cp-data-system-survey'
const DB_VERSION = 1
const STORE_NAME = 'point-photos'
const OWNER_INDEX = 'ownerKey'

let databasePromise: Promise<IDBDatabase> | null = null

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 写入失败'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 写入已取消'))
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
      reject(request.error ?? new Error('照片数据库打开失败'))
    }
  })
  return databasePromise
}

export async function listSurveyPhotos(ownerKey: string): Promise<SurveyPhotoRecord[]> {
  const database = await openDatabase()
  const transaction = database.transaction(STORE_NAME, 'readonly')
  const records = await requestResult(
    transaction.objectStore(STORE_NAME).index(OWNER_INDEX).getAll(ownerKey),
  ) as SurveyPhotoRecord[]
  return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function addSurveyPhotos(
  ownerKey: string,
  pointId: string,
  files: File[],
): Promise<void> {
  if (files.length === 0) return
  const database = await openDatabase()
  const transaction = database.transaction(STORE_NAME, 'readwrite')
  const store = transaction.objectStore(STORE_NAME)
  const now = Date.now()
  files.forEach((file, index) => {
    const id = `${ownerKey}:${now + index}:${crypto.randomUUID()}`
    const record: SurveyPhotoRecord = {
      id,
      ownerKey,
      pointId,
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      createdAt: new Date(now + index).toISOString(),
      blob: file,
    }
    store.put(record)
  })
  await transactionDone(transaction)
}

export async function deleteSurveyPhoto(id: string): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(STORE_NAME, 'readwrite')
  transaction.objectStore(STORE_NAME).delete(id)
  await transactionDone(transaction)
}

export async function deleteSurveyPhotos(ownerKey: string): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(STORE_NAME, 'readwrite')
  const index = transaction.objectStore(STORE_NAME).index(OWNER_INDEX)
  const request = index.openKeyCursor(IDBKeyRange.only(ownerKey))
  request.onsuccess = () => {
    const cursor = request.result
    if (!cursor) return
    transaction.objectStore(STORE_NAME).delete(cursor.primaryKey)
    cursor.continue()
  }
  await transactionDone(transaction)
}

export async function surveyPhotoCounts(): Promise<Record<string, number>> {
  const database = await openDatabase()
  const transaction = database.transaction(STORE_NAME, 'readonly')
  const index = transaction.objectStore(STORE_NAME).index(OWNER_INDEX)
  const counts: Record<string, number> = {}
  await new Promise<void>((resolve, reject) => {
    const request = index.openKeyCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve()
        return
      }
      const ownerKey = String(cursor.key)
      counts[ownerKey] = (counts[ownerKey] ?? 0) + 1
      cursor.continue()
    }
    request.onerror = () => reject(request.error ?? new Error('照片数量读取失败'))
  })
  return counts
}
