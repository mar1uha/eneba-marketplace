const API_BASE = import.meta.env.VITE_API_URL ?? ''

export const apiUrl = (path: string) => `${API_BASE}${path}`

export class ApiError extends Error {
  readonly status: number
  readonly body: unknown
  /** Form field the server blamed, when the error is a validation error. */
  readonly field?: string

  constructor(status: number, message: string, body: unknown) {
    super(message)
    this.status = status
    this.body = body
    const field = (body as { field?: unknown } | null)?.field
    this.field = typeof field === 'string' ? field : undefined
  }
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method,
    signal,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? res.statusText, data)
  }
  return data as T
}

/** The server's message for a request the user can fix (4xx); otherwise the fallback. */
export const errorMessage = (error: unknown, fallback: string) =>
  error instanceof ApiError && error.status < 500 ? error.message : fallback

export const apiGet =<T>(path: string, signal?: AbortSignal) => request<T>('GET', path, undefined, signal)

export const apiSend = <T = void>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) =>
  request<T>(method, path, body)
