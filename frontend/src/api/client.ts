/**
 * API 客户端基础配置
 *
 * 切换 mock / 真实后端：在 .env.development 里设置 VITE_USE_MOCK=true|false
 * 真实后端地址：VITE_API_BASE_URL
 */
import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios'

export const AUTH_TOKEN_KEY = 'cp-data-system-token'

export function saveAuthToken(token: string) {
  window.localStorage.setItem(AUTH_TOKEN_KEY, token)
}

export function clearAuthToken() {
  window.localStorage.removeItem(AUTH_TOKEN_KEY)
}

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'  // 默认 true
const BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

const http: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
})

http.interceptors.request.use((config) => {
  const token = window.localStorage.getItem(AUTH_TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

http.interceptors.response.use(
  (r) => r,
  (err) => {
    const msg = err.response?.data?.detail || err.response?.data?.message || err.response?.data?.error
    if (msg && err instanceof Error) err.message = msg
    if (err.response?.status === 401 && err.config?.url !== '/api/auth/login') {
      clearAuthToken()
      window.dispatchEvent(new CustomEvent('auth:expired'))
      const currentPath = window.location.hash.replace(/^#/, '') || '/map'
      window.location.hash = `/login?redirect=${encodeURIComponent(currentPath || '/map')}`
    }
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
