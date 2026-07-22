import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { authApi } from '@/api/auth'
import { AUTH_TOKEN_KEY, clearAuthToken, saveAuthToken } from '@/api/client'

const USERNAME_KEY = 'cp-data-system-username'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(window.localStorage.getItem(AUTH_TOKEN_KEY) || '')
  const username = ref(window.localStorage.getItem(USERNAME_KEY) || '')
  const isAuthenticated = computed(() => Boolean(token.value))

  async function login(nextUsername: string, password: string) {
    const result = await authApi.login(nextUsername.trim(), password)
    if (!result.token) throw new Error('登录响应中缺少 Token')

    token.value = result.token
    username.value = nextUsername.trim()
    saveAuthToken(result.token)
    window.localStorage.setItem(USERNAME_KEY, username.value)
  }

  function logout() {
    token.value = ''
    username.value = ''
    clearAuthToken()
    window.localStorage.removeItem(USERNAME_KEY)
  }

  return { token, username, isAuthenticated, login, logout }
})
