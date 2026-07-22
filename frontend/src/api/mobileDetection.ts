import { http } from './client'

export interface MobileTask {
  id: string
  name: string
  area: string
  unit: string
  buildings: string[]
  pressureLevel: 'low' | 'medA' | 'medB'
  createdAt: string
  updatedAt: string
  pointsCount?: number
}

export interface MobileDetectionPoint {
  id: string
  taskId: string
  seq: number
  location: string
  lng: number
  lat: number
  dataTypes: Array<'位置' | '土壤电阻率' | '土壤酸碱值' | '管线探测' | '馈电实验'>
  createdAt: string
}

export interface MobileReportItems {
  土壤电阻率?: { 地钎距离: number; 电阻值: number; 电阻率: number; photos: string[] }
  土壤酸碱值?: { 酸碱度: number; photos: string[] }
  管线探测?: { rtkNo: string; 埋深: number; 破损点: boolean; photos: string[] }
}

export interface MobileDetectionReport {
  id: string
  taskId: string
  pointId: string
  items: MobileReportItems
  createdAt: string
}

export interface MobileDetectionData {
  tasks: MobileTask[]
  points: MobileDetectionPoint[]
  reports: MobileDetectionReport[]
}

/** 只读加载手机端实测数据，不包含任何写操作。 */
export async function fetchMobileDetectionData(): Promise<MobileDetectionData> {
  const tasks = (await http.get<MobileTask[]>('/api/tasks')).data
  const details = await Promise.all(tasks.map(async (task) => {
    const [pointsResponse, reportsResponse] = await Promise.all([
      http.get<MobileDetectionPoint[]>(`/api/tasks/${task.id}/points`),
      http.get<MobileDetectionReport[]>(`/api/tasks/${task.id}/reports`),
    ])
    return { points: pointsResponse.data, reports: reportsResponse.data }
  }))

  return {
    tasks,
    points: details.flatMap((item) => item.points),
    reports: details.flatMap((item) => item.reports),
  }
}
