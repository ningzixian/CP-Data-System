import type { SurveyBox, SurveyLine, SurveyPoint } from '@/types/survey'

export interface SurveyDatabaseState {
  points: SurveyPoint[]
  lines: SurveyLine[]
  boxes: SurveyBox[]
  csvDataset: string
}

const DB_NAME = 'cp-data-system-survey-state'
const DB_VERSION = 1
const STORE_NAME = 'survey-state'
const STATE_KEY = 'current'

let databasePromise: Promise<IDBDatabase> | null = null

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('勘测数据库请求失败'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('勘测数据库写入失败'))
    transaction.onabort = () => reject(transaction.error ?? new Error('勘测数据库写入已取消'))
  })
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('当前浏览器不支持 IndexedDB'))
      return
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      databasePromise = null
      reject(request.error ?? new Error('勘测数据库打开失败'))
    }
  })
  return databasePromise
}

export async function loadSurveyState(): Promise<SurveyDatabaseState | null> {
  const database = await openDatabase()
  const transaction = database.transaction(STORE_NAME, 'readonly')
  const record = await requestResult(transaction.objectStore(STORE_NAME).get(STATE_KEY)) as
    | { key: string; state: SurveyDatabaseState }
    | undefined
  return record?.state ?? null
}

export async function saveSurveyState(state: SurveyDatabaseState): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(STORE_NAME, 'readwrite')
  transaction.objectStore(STORE_NAME).put({ key: STATE_KEY, state })
  await transactionDone(transaction)
}
