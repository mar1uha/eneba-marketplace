import { vi } from 'vitest'

type Reply = { status: number; body?: unknown }
type Handler = (body: unknown, query: URLSearchParams) => Reply

/**
 * Stubs fetch with a tiny in-memory backend. Routes are keyed "METHOD /path"; handlers get the query string.
 * Unhandled requests fail the test loudly instead of hanging.
 */
export function fakeApi(routes: Record<string, Reply | Handler>) {
  const calls: Array<{ method: string; path: string; query: URLSearchParams; body: unknown }> = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path: url.pathname, query: url.searchParams, body })
    const route = routes[`${method} ${url.pathname}`]
    if (!route) throw new Error(`Unexpected request: ${method} ${url.pathname}`)
    const reply = typeof route === 'function' ? route(body, url.searchParams) : route
    return new Response(reply.status === 204 ? null : JSON.stringify(reply.body ?? {}), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, routes }
}
