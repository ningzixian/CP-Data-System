/**
 * 现场检测后端 API 封装（src.20270721）
 *
 * 通过 module 级的 http 实例（src/api/http.ts）发请求：
 * - 自动从 localStorage 读 token 加到 Authorization 头
 * - 401 时清 token + 自动跳登录页
 *
 * Vite proxy 把 /api/* 转发到 https://192.168.20.40:3000
 *
 * 接口契约参考 src.20270721/src/types/index.ts
 */
import { http } from './http'

// ============ 类型（与后端 zod schema 同步）============
export type PressureLevel = 'low' | 'medA' | 'medB'
export type DataType = '位置' | '土壤电阻率' | '土壤酸碱值' | '管线探测' | '馈电实验'

export interface Task {
  id: string
  name: string
  area: string
  unit: string
  buildings: string[]
  pressureLevel: PressureLevel
  createdAt: string
  updatedAt: string
}

export interface TaskWithCount extends Task {
  /** 该任务下的检测点数量（后端 GET /tasks 已带） */
  pointsCount: number
}

export interface DetectionPoint {
  id: string
  taskId: string
  /** 任务内序号（1, 2, 3, ...） */
  seq: number
  location: string
  lng: number
  lat: number
  dataTypes: DataType[]
  createdAt: string
}

export interface SoilResistivityItem {
  地钎距离: number
  电阻值: number
  电阻率: number
  photos: string[]
}
export interface SoilPhItem {
  酸碱度: number
  photos: string[]
}
export interface PipelineDetectionItem {
  rtkNo: string
  埋深: number
  破损点: boolean
  photos: string[]
}
export interface DetectionReportItems {
  土壤电阻率?: SoilResistivityItem
  土壤酸碱值?: SoilPhItem
  管线探测?: PipelineDetectionItem
}
export interface DetectionReport {
  id: string
  taskId: string
  pointId: string
  items: DetectionReportItems
  createdAt: string
}

export interface PhotoUploadResp {
  path: string
}

// ============ API 客户端 ============
export const fieldApi = {
  // ---- Auth ----
  /** 登录（不走鉴权 axios，直接调 /api/auth/login，返回 { token }） */
  login: (username: string, password: string) =>
    http
      .post<{ token: string }>('/auth/login', { username, password })
      .then((r) => r.data),

  // ---- Tasks ----
  listTasks: () => http.get<TaskWithCount[]>('/tasks').then((r) => r.data),
  getTask: (id: string) => http.get<Task>(`/tasks/${id}`).then((r) => r.data),
  createTask: (body: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) =>
    http.post<Task>('/tasks', body).then((r) => r.data),
  updateTask: (id: string, body: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) =>
    http.put<Task>(`/tasks/${id}`, body).then((r) => r.data),
  deleteTask: (id: string) => http.delete(`/tasks/${id}`).then((r) => r.data),

  // ---- Points ----
  listPoints: (taskId: string) =>
    http.get<DetectionPoint[]>(`/tasks/${taskId}/points`).then((r) => r.data),
  createPoint: (
    taskId: string,
    body: { location: string; lng: number; lat: number; dataTypes: DataType[] },
  ) => http.post<DetectionPoint>(`/tasks/${taskId}/points`, body).then((r) => r.data),
  deletePoint: (taskId: string, pointId: string) =>
    http.delete(`/tasks/${taskId}/points/${pointId}`).then((r) => r.data),

  // ---- Reports ----
  listReports: (taskId: string, pointId?: string) => {
    const params = pointId ? { pointId } : undefined
    return http
      .get<DetectionReport[]>(`/tasks/${taskId}/reports`, { params })
      .then((r) => r.data)
  },
  createReport: (
    taskId: string,
    body: { pointId: string; items: DetectionReportItems },
  ) => http.post<DetectionReport>(`/tasks/${taskId}/reports`, body).then((r) => r.data),

  // ---- Photos ----
  /** 上传照片（multipart/form-data, field=file），返回 { path } */
  uploadPhoto: (file: File | Blob) => {
    const fd = new FormData()
    fd.append('file', file)
    return http
      .post<PhotoUploadResp>('/photos', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data)
  },
  /** 拼出照片可访问 URL（后端通过 /api/photos/file/<rel> 暴露） */
  photoUrl: (relPath: string) => `/api/photos/file/${relPath}`,
}
