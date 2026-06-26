/**
 * API 客户端基础配置
 *
 * 切换 mock / 真实后端：在 .env.development 里设置 VITE_USE_MOCK=true|false
 * 真实后端地址：VITE_API_BASE_URL
 */
import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios'
import { ElMessage } from 'element-plus'

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'  // 默认 true
const BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

const http: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
})

http.interceptors.response.use(
  (r) => r,
  (err) => {
    if (USE_MOCK) return Promise.reject(err)
    const msg = err.response?.data?.detail || err.response?.data?.message || err.message
    if (msg) ElMessage.error(msg)
    return Promise.reject(err)
  },
)

/** 通过 mock 适配器转发请求（开发期不依赖后端） */
async function request<T>(config: AxiosRequestConfig): Promise<T> {
  if (USE_MOCK) {
    const { mockAdapter } = await import('@/mock/adapter')
    const mockRes = await mockAdapter(config)
    // mockAdapter 返回的是 AxiosResponse 形状，需要解 .data
    return (mockRes as any).data as T
  }
  const r = await http.request<T>(config)
  return r.data
}

export { http, request, USE_MOCK, BASE_URL }