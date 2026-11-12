import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { User } from '../../api/auth'
import { createQueryClient } from '../../queryClient'
import { routes } from '../../router'
import { fakeApi } from '../../test/fakeApi'

const ada: User = {
  id: 1,
  email: 'ada@example.com',
  display_name: 'ada',
  has_password: true,
  google_linked: false,
  created_at: '2026-11-01T10:00:00Z',
}

const guestApi = {
  'GET /api/auth/me': { status: 200, body: { user: null } },
  'GET /api/auth/providers': { status: 200, body: { google: false } },
  'GET /api/homepage': { status: 200, body: { server_time: '2026-11-11T10:00:00Z', blocks: [] } },
}

function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

afterEach(() => vi.unstubAllGlobals())

describe('authentication', () => {
  it('sends guests from a protected page to log in, then back to that page', async () => {
    const api = fakeApi({
      ...guestApi,
      'POST /api/auth/login': { status: 200, body: { user: ada } },
      'GET /api/orders': { status: 200, body: { orders: [] } },
    })
    const router = renderApp('/account/orders')

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toBe('?next=%2Faccount%2Forders')

    fill('Email', 'ada@example.com')
    fill('Password', 'correct-password')
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByText('No orders yet')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/account/orders')
    expect(api.calls.find((c) => c.path === '/api/auth/login')?.body).toEqual({ email: 'ada@example.com', password: 'correct-password' })
    expect(screen.getByRole('button', { name: 'ada' })).toBeInTheDocument()
  })

  it('shows a wrong-password error without leaving the page', async () => {
    fakeApi({ ...guestApi, 'POST /api/auth/login': { status: 401, body: { error: 'Incorrect email or password.' } } })
    const router = renderApp('/login')

    await screen.findByRole('heading', { name: 'Log in' })
    fill('Email', 'ada@example.com')
    fill('Password', 'wrong-password')
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.')
    expect(router.state.location.pathname).toBe('/login')
  })

  it('puts server validation errors next to the right field', async () => {
    fakeApi({
      ...guestApi,
      'POST /api/auth/register': { status: 409, body: { error: 'An account with this email already exists.', field: 'email' } },
    })
    renderApp('/register')

    await screen.findByRole('heading', { name: 'Create an account' })
    fill('Email', 'ada@example.com')
    fill('Password', 'long-enough-password')
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true'))
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('An account with this email already exists.')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('sends signed-in users away from the log-in page', async () => {
    fakeApi({ ...guestApi, 'GET /api/auth/me': { status: 200, body: { user: ada } } })
    const router = renderApp('/login?next=/account')

    await screen.findByRole('heading', { name: 'Account & security' })
    expect(router.state.location.pathname).toBe('/account')
  })

  it('refuses to follow a next link to another website', async () => {
    fakeApi({ ...guestApi, 'POST /api/auth/login': { status: 200, body: { user: ada } } })
    const router = renderApp('/login?next=//evil.test/phish')

    await screen.findByRole('heading', { name: 'Log in' })
    fill('Email', 'ada@example.com')
    fill('Password', 'correct-password')
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('signs out from the header menu', async () => {
    let user: User | null = ada
    const api = fakeApi({
      ...guestApi,
      'GET /api/auth/me': () => ({ status: 200, body: { user } }),
      'POST /api/auth/logout': () => {
        user = null
        return { status: 204 }
      },
      'GET /api/auth/sessions': { status: 200, body: { sessions: [] } },
    })
    const router = renderApp('/account')

    fireEvent.click(await screen.findByRole('button', { name: 'ada' }))
    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('link', { name: 'Log in | Register' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(api.calls.some((c) => c.method === 'POST' && c.path === '/api/auth/logout')).toBe(true)
  })

  it('shows "Continue with Google" only when the backend has it configured', async () => {
    fakeApi({ ...guestApi, 'GET /api/auth/providers': { status: 200, body: { google: true } } })
    renderApp('/login?next=/account/orders')

    const google = await screen.findByRole('link', { name: 'Continue with Google' })
    expect(google).toHaveAttribute('href', '/api/auth/google/start?next=%2Faccount%2Forders')
  })

  it('explains a failed Google sign-in', async () => {
    fakeApi(guestApi)
    renderApp('/login?error=google_unverified')

    expect(await screen.findByRole('alert')).toHaveTextContent('Google email address is not verified')
  })

  it('returns to log in when the session was revoked on another device', async () => {
    fakeApi({
      ...guestApi,
      'GET /api/auth/me': { status: 200, body: { user: ada } },
      'GET /api/auth/sessions': { status: 401, body: { error: 'Sign in required.' } },
    })
    const router = renderApp('/account')

    await screen.findByRole('heading', { name: 'Log in' })
    expect(router.state.location.search).toBe('?next=%2Faccount')
  })

  it('lists sessions and signs out another device', async () => {
    let sessions = [
      { id: 1, user_agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/150.0', ip: '10.0.0.1', created_at: '2026-11-01T10:00:00Z', last_seen_at: new Date().toISOString(), current: true },
      { id: 2, user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0) Safari/605.1', ip: '10.0.0.2', created_at: '2026-11-02T10:00:00Z', last_seen_at: '2026-11-03T10:00:00Z', current: false },
    ]
    fakeApi({
      ...guestApi,
      'GET /api/auth/me': { status: 200, body: { user: ada } },
      'GET /api/auth/sessions': () => ({ status: 200, body: { sessions } }),
      'DELETE /api/auth/sessions/2': () => {
        sessions = sessions.filter((s) => s.id !== 2)
        return { status: 204 }
      },
    })
    renderApp('/account')

    const list = await screen.findByRole('list')
    expect(within(list).getByText(/Chrome on Windows/)).toHaveTextContent('This device')
    expect(within(list).getByText(/Safari on iOS/)).toBeInTheDocument()

    fireEvent.click(within(list).getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(screen.queryByText(/Safari on iOS/)).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Sign out all other devices' })).not.toBeInTheDocument()
  })

  it('catches mismatched passwords on the reset form before calling the API', async () => {
    const api = fakeApi(guestApi)
    renderApp('/reset-password?token=abc')

    await screen.findByRole('heading', { name: 'Choose a new password' })
    fill('New password', 'new-password-1')
    fill('Repeat new password', 'new-password-2')
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }))

    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument()
    expect(api.calls.some((c) => c.path.includes('password-reset'))).toBe(false)
  })
})
