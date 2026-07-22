import { http } from './client'

export interface LoginResponse {
  token: string
}

export const authApi = {
  async login(username: string, password: string): Promise<LoginResponse> {
    const response = await http.post<LoginResponse>('/api/auth/login', { username, password })
    return response.data
  },
}
