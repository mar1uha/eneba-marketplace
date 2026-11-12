import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Order } from './api/orders'
import type { ProductDetail } from './api/products'
import { PLATFORMS, REGIONS } from './api/types'
import { formatExpiry } from './lib/card'
import { fakeApi } from './test/fakeApi'
import { product } from './test/fixtures'
import { renderApp } from './test/renderApp'

/** Bugs found while reviewing Part 5; each test failed before its fix. */

const ok = (body: unknown) => ({ status: 200, body })
const ada = { id: 1, email: 'ada@example.com', display_name: 'ada', has_password: true, google_linked: false, created_at: '2026-11-01T10:00:00Z' }
const signedIn = {
  'GET /api/auth/me': ok({ user: ada }),
  'GET /api/cart': ok({ lines: [], item_count: 0, total_cents: 0 }),
}

const pendingOrder: Order = {
  id: 42,
  status: 'pending',
  total_cents: 779,
  created_at: '2026-11-12T10:00:00Z',
  server_time: new Date().toISOString(),
  reserved_until: new Date(Date.now() + 10 * 60_000).toISOString(),
  paid_at: null,
  items: [],
  payment: null,
}

afterEach(() => vi.unstubAllGlobals())

describe('regressions', () => {
  it('shows a release date on the same calendar day in every time zone', async () => {
    const detail: ProductDetail = {
      id: 9, slug: 'hades', title: 'Hades', description: '', cover_url: 'https://cdn.test/c.jpg', banner_url: 'https://cdn.test/b.jpg',
      platform: 'steam', region: 'global', product_type: 'game', msrp_cents: 2450, release_date: '2020-09-17',
      genres: [], editions: [], offers: [],
    }
    fakeApi({ ...signedIn, 'GET /api/products/hades': ok(detail) })
    renderApp('/product/hades')

    // Tests run west of UTC (vite.config.ts), where the bug shows.
    expect(new Date(2020, 8, 17).getTimezoneOffset()).toBeGreaterThan(0)
    // Read as UTC midnight, "2020-09-17" used to show as 16 Sept in the Americas.
    expect(await screen.findByText('Released 17 Sept 2020')).toBeInTheDocument()
  })

  it('reads a one-digit expiry month the way people type it', () => {
    // "1/30" used to become "13/0", and "4" stayed an impossible month 4X.
    expect(formatExpiry('1/')).toBe('01')
    expect(formatExpiry('1/3')).toBe('01/3')
    expect(formatExpiry('4')).toBe('04')
    expect(formatExpiry('42')).toBe('04/2')
    expect(formatExpiry('12/34')).toBe('12/34')
    expect(formatExpiry('0')).toBe('0')
    expect(formatExpiry('1')).toBe('1')
  })

  it('does not call an order missing when the network fails', async () => {
    fakeApi({
      ...signedIn,
      'GET /api/orders/42': () => {
        throw new TypeError('Failed to fetch')
      },
    })
    renderApp('/account/orders/42')

    expect(await screen.findByText('Could not load this order.', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.queryByText('This order does not exist.')).not.toBeInTheDocument()
  })

  it('says so when cancelling a checkout fails', async () => {
    fakeApi({
      ...signedIn,
      'GET /api/orders/42': ok(pendingOrder),
      'POST /api/orders/42/cancel': { status: 500, body: { error: 'internal error' } },
    })
    const router = renderApp('/checkout/42')

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel and return to cart' }))
    expect(await screen.findByText('Could not cancel the checkout. Try again.')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/checkout/42')
  })

  it('empties the header cart as soon as payment succeeds, without waiting for a refetch', async () => {
    // Found on the live site: with ~350 ms of latency the header said "Cart, 2 items" right after paying.
    const item = {
      id: 1, offer_id: 11, seller_name: 'NovaKeys', unit_price_cents: 779, quantity: 2, keys: [],
      product: { slug: 'hades', title: 'Hades', cover_url: 'https://cdn.test/c.jpg', platform: 'steam' as const, region: 'global' as const },
    }
    const pending = { ...pendingOrder, total_cents: 1558, items: [item] }
    const paid: Order = { ...pending, status: 'paid', paid_at: '2026-11-12T10:02:00Z', payment: { card_brand: 'visa', card_last4: '4242' } }
    const fullCart = {
      lines: [{ offer_id: 11, quantity: 2, price_cents: 779, added_price_cents: 779, line_total_cents: 1558, stock: 5, available: true, product: item.product, seller: { name: 'NovaKeys', rating: 99.5 } }],
      item_count: 2,
      total_cents: 1558,
    }
    let isPaid = false
    fakeApi({
      ...signedIn,
      'GET /api/cart': () =>
        isPaid ? new Promise((resolve) => setTimeout(() => resolve(ok({ lines: [], item_count: 0, total_cents: 0 })), 2000)) : ok(fullCart),
      'GET /api/orders/42': () => ok(isPaid ? paid : pending),
      'POST /api/orders/42/pay': () => {
        isPaid = true
        return ok(paid)
      },
    })
    renderApp('/checkout/42')

    expect(await screen.findByRole('link', { name: 'Cart, 2 items' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Name on card'), { target: { value: 'Ada Lovelace' } })
    fireEvent.change(screen.getByLabelText('Card number'), { target: { value: '4242424242424242' } })
    fireEvent.change(screen.getByLabelText('Expiry (MM/YY)'), { target: { value: '1234' } })
    fireEvent.change(screen.getByLabelText('CVC'), { target: { value: '123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pay €15.58' }))

    expect(await screen.findByText('Payment successful. Your keys are ready below.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cart' })).toBeInTheDocument()
  })

  it('signs out from a protected page straight to the homepage', async () => {
    // Found by a flaky test: the router renders navigations in a transition, so the account page was
    // still mounted when the user was cleared and RequireAuth replaced "/" with /login?next=/account.
    let user: typeof ada | null = ada
    fakeApi({
      ...signedIn,
      'GET /api/auth/me': () => ok({ user }),
      'GET /api/auth/providers': ok({ google: false }),
      'GET /api/homepage': ok({ server_time: '2026-11-11T10:00:00Z', blocks: [] }),
      'GET /api/auth/sessions': ok({ sessions: [] }),
      'POST /api/auth/logout': () => {
        user = null
        return { status: 204 }
      },
    })
    const router = renderApp('/account')
    const history: string[] = []
    router.subscribe((s) => history.push(`${s.historyAction} ${s.location.pathname}${s.location.search}`))

    fireEvent.click(await screen.findByRole('button', { name: 'ada' }))
    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Sign out' }))
    await screen.findByRole('link', { name: 'Log in | Register' })
    await new Promise((r) => setTimeout(r, 200))
    expect(history).toEqual(['PUSH /'])
  })

  it('survives a shared Store link whose search text is cut inside an emoji', async () => {
    // 99 letters + an emoji is 101 UTF-16 units; cutting at 100 left half an emoji, and building the
    // pagination links then threw "URI malformed" and took down the page.
    const q = 'a'.repeat(99) + '😀'
    fakeApi({
      ...signedIn,
      'GET /api/products': ok({
        items: [product()], total: 50, page: 1, page_size: 24, sort: 'relevance',
        facets: { platforms: PLATFORMS.map((value) => ({ value, count: 0 })), regions: REGIONS.map((value) => ({ value, count: 0 })), genres: [], price: null },
      }),
    })
    renderApp(`/store?q=${encodeURIComponent(q)}`)

    const nav = await screen.findByRole('navigation', { name: 'Pagination' })
    expect(within(nav).getByRole('link', { name: 'Page 2' })).toHaveAttribute('href', `/store?q=${encodeURIComponent(q)}&page=2`)
  })
})
