import { vi } from 'vitest'

type Reply = { status: number; body?: unknown }
type Handler = (body: unknown) => Reply

/**
 * Stubs fetch with a tiny in-memory backend. Routes are keyed "METHOD /path" (query string ignored).
 * Unhandled requests fail the test loudly instead of hanging.
 */
export function fakeApi(routes: Record<string, Reply | Handler>) {
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path: url.pathname, body })
    const route = routes[`${method} ${url.pathname}`]
    if (!route) throw new Error(`Unexpected request: ${method} ${url.pathname}`)
    const reply = typeof route === 'function' ? route(body) : route
    return new Response(reply.status === 204 ? null : JSON.stringify(reply.body ?? {}), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, routes }
}
