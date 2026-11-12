import { apiGet, apiSend, apiUrl } from './client'

export interface User {
  id: number
  email: string
  display_name: string
  has_password: boolean
  google_linked: boolean
  created_at: string
}

export interface SessionInfo {
  id: number
  user_agent: string
  ip: string
  created_at: string
  last_seen_at: string
  current: boolean
}

export interface Credentials {
  email: string
  password: string
}

type UserResponse = { user: User }

export const fetchMe = (signal?: AbortSignal) =>
  apiGet<{ user: User | null }>('/api/auth/me', signal).then((r) => r.user)

export const fetchProviders = (signal?: AbortSignal) => apiGet<{ google: boolean }>('/api/auth/providers', signal)

export const login = (c: Credentials) => apiSend<UserResponse>('POST', '/api/auth/login', c).then((r) => r.user)

export const register = (c: Credentials) => apiSend<UserResponse>('POST', '/api/auth/register', c).then((r) => r.user)

export const logout = () => apiSend('POST', '/api/auth/logout')

export const requestPasswordReset = (email: string) => apiSend('POST', '/api/auth/password-reset/request', { email })

export const confirmPasswordReset = (token: string, password: string) =>
  apiSend<UserResponse>('POST', '/api/auth/password-reset/confirm', { token, password }).then((r) => r.user)

export const changePassword = (currentPassword: string, newPassword: string) =>
  apiSend('POST', '/api/auth/password', { current_password: currentPassword, new_password: newPassword })

export const fetchSessions = (signal?: AbortSignal) =>
  apiGet<{ sessions: SessionInfo[] }>('/api/auth/sessions', signal).then((r) => r.sessions)

export const revokeSession = (id: number) => apiSend('DELETE', `/api/auth/sessions/${id}`)

export const revokeOtherSessions = () => apiSend<{ revoked: number }>('POST', '/api/auth/sessions/revoke-others')

/** Google sign-in is a full-page redirect, not a fetch. */
export const googleStartUrl = (next: string) => apiUrl(`/api/auth/google/start?next=${encodeURIComponent(next)}`)
