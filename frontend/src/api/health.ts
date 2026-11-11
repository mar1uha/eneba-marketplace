import { ApiError, apiGet } from './client'

export interface Health {
  status: 'ok' | 'degraded'
  db: 'ok' | 'down'
}

export async function getHealth(signal?: AbortSignal): Promise<Health> {
  try {
    return await apiGet<Health>('/api/health', signal)
  } catch (err) {
    // 503 means the API answered but a dependency is down; the body still describes it.
    if (err instanceof ApiError && err.status === 503 && err.body) return err.body as Health
    throw err
  }
}
