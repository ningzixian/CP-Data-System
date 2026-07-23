/**
 * 现场检测后端鉴权 store
 *
 * 安全策略：**不持久化 token**
 *   - 不写 localStorage / sessionStorage / cookie
 *   - token 只存在内存（store ref + http module 变量）
 *   - 刷新页面 → 内存清空 → 路由守卫跳登录页 → 必须重新登录
 *
 * 数据流：
 *   登录页 → login() → POST /api/auth/login → 拿 token
 *          → token 存内存（store + http.setAuthToken）
 *   路由守卫 → isLoggedIn 永远反映"当前内存里有没有 token"
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { http, setAuthToken } from '@/api/http'

/** 解码 JWT payload（不验签，只为拿用户名/过期时间显示用） */
function parseJwtPayload(token: string): { sub: string; username: string; exp?: number } | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '==='.slice((b64.length + 3) % 4)
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

export const useAuthStore = defineStore('field-auth', () => {
  // 启动时 token 永远为 null（不读 localStorage，强制每次刷新重新登录）
  const token = ref<string | null>(null)
  const user = ref<{ id: string; username: string } | null>(null)

  const isLoggedIn = computed(() => !!token.value)
  const username = computed(() => user.value?.username || '')

  /**
   * 登录：POST /api/auth/login
   * - 成功：token 存到 store + http module（不写 localStorage）
   * - 失败：抛错
   */
  async function login(username: string, password: string): Promise<void> {
    const { data } = await http.post<{ token: string }>('/auth/login', { username, password })
    if (!data?.token) {
      throw new Error('登录响应无 token')
    }
    token.value = data.token
    setAuthToken(data.token)  // 同步给 http 拦截器
    const payload = parseJwtPayload(data.token)
    user.value = {
      id: payload?.sub || '',
      username: payload?.username || username,
    }
  }

  function logout() {
    token.value = null
    user.value = null
    setAuthToken(null)
  }

  return {
    token,
    user,
    isLoggedIn,
    username,
    login,
    logout,
  }
})
