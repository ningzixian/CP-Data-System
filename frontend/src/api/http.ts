/**
 * 现场检测后端专用的 axios 实例（module 级别）
 *
 * 设计要点：
 *   - axios 实例放 module 级别（避免 store setup 上下文问题）
 *   - token 用 module 级变量 + 显式 setAuthToken / getAuthToken 控制
 *   - token **不写 localStorage**：刷新页面 = 必须重新登录
 *   - 401 时清 token + 跳登录页
 *
 * Vite proxy：/api/* → https://192.168.20.40:3000
 */
import axios, { type AxiosInstance } from 'axios'

// ============ module 级 token 状态 ============
// 不持久化：刷新页面 = token 丢失 = 强制重新登录
let _token: string | null = null

export function setAuthToken(token: string | null): void {
  _token = token
}
export function getAuthToken(): string | null {
  return _token
}

export const http: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

// 请求拦截器：自动从 module 变量读 token 加到 Authorization 头
http.interceptors.request.use((config) => {
  const token = getAuthToken()
  if (token) {
    config.headers = config.headers || {}
    config.headers['Authorization'] = `Bearer ${token}`
  }
  return config
})

// 响应拦截器：401 时清 token + 跳登录页
http.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      // 清掉失效的 token
      setAuthToken(null)
      // 避免在登录页时循环跳转
      const isLogin = window.location.hash.includes('/login')
      if (!isLogin) {
        const redirect = encodeURIComponent(window.location.hash.replace('#', '') || '/field-tasks')
        window.location.hash = `#/login?redirect=${redirect}&reason=token_expired`
      }
    }
    const msg = err.response?.data?.error || err.message
    if (msg && err instanceof Error) err.message = msg
    return Promise.reject(err)
  },
)
