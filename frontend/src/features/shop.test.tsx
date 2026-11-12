import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { User } from '../api/auth'
import type { Cart, CartLine } from '../api/cart'
import type { Order } from '../api/orders'
import type { ProductDetail } from '../api/products'
import { formatCardNumber, formatExpiry, luhnValid, validateCard } from '../lib/card'
import { fakeApi } from '../test/fakeApi'
import { renderApp } from '../test/renderApp'
import { guestCart } from './cart/guestCart'

const ok = (body: unknown) => ({ status: 200, body })

const ada: User = {
  id: 1,
  email: 'ada@example.com',
  display_name: 'ada',
  has_password: true,
  google_linked: false,
  created_at: '2026-11-01T10:00:00Z',
}

const guest = {
  'GET /api/auth/me': ok({ user: null }),
  'GET /api/auth/providers': ok({ google: false }),
}
const signedIn = { ...guest, 'GET /api/auth/me': ok({ user: ada }) }

const hades: ProductDetail = {
  id: 9,
  slug: 'hades',
  title: 'Hades',
  description: 'Battle out of the Underworld.',
  cover_url: 'https://cdn.test/hades.jpg',
  banner_url: 'https://cdn.test/hades-wide.jpg',
  platform: 'steam',
  region: 'global',
  product_type: 'game',
  msrp_cents: 2450,
  release_date: '2020-09-17',
  genres: [{ slug: 'roguelike', name: 'Roguelike' }],
  editions: [
    { slug: 'hades', title: 'Hades', platform: 'steam', region: 'global', price_cents: 779, current: true },
    { slug: 'hades-nintendo', title: 'Hades', platform: 'nintendo', region: 'europe', price_cents: 809, current: false },
  ],
  offers: [
    { id: 11, price_cents: 779, discount_percent: 68, stock: 2, seller: { name: 'NovaKeys', rating: 99.5, review_count: 64002 } },
    { id: 12, price_cents: 879, discount_percent: 64, stock: 18, seller: { name: 'KeyForge', rating: 98.7, review_count: 31544 } },
    { id: 13, price_cents: 699, discount_percent: 71, stock: 0, seller: { name: 'LootLane', rating: 96.4, review_count: 8650 } },
  ],
}

const line = (overrides: Partial<CartLine> = {}): CartLine => ({
  offer_id: 11,
  quantity: 1,
  price_cents: 779,
  added_price_cents: 779,
  line_total_cents: 779,
  stock: 2,
  available: true,
  product: { slug: 'hades', title: 'Hades', cover_url: 'https://cdn.test/hades.jpg', platform: 'steam', region: 'global' },
  seller: { name: 'NovaKeys', rating: 99.5 },
  ...overrides,
})

const cartOf = (...lines: CartLine[]): Cart => ({
  lines,
  item_count: lines.reduce((n, l) => n + l.quantity, 0),
  total_cents: lines.filter((l) => l.available).reduce((n, l) => n + l.price_cents * l.quantity, 0),
})

const order = (overrides: Partial<Order> = {}): Order => ({
  id: 42,
  status: 'pending',
  total_cents: 1558,
  created_at: '2026-11-12T10:00:00Z',
  server_time: new Date().toISOString(),
  reserved_until: new Date(Date.now() + 10 * 60_000).toISOString(),
  paid_at: null,
  items: [
    {
      id: 1,
      offer_id: 11,
      product: { slug: 'hades', title: 'Hades', cover_url: 'https://cdn.test/hades.jpg', platform: 'steam', region: 'global' },
      seller_name: 'NovaKeys',
      unit_price_cents: 779,
      quantity: 2,
      keys: [],
    },
  ],
  payment: null,
  ...overrides,
})

const paidOrder = order({
  status: 'paid',
  paid_at: '2026-11-12T10:02:00Z',
  payment: { card_brand: 'visa', card_last4: '4242' },
  items: [{ ...order().items[0], keys: [{ id: 501, code: null, revealed_at: null }, { id: 502, code: null, revealed_at: null }] }],
})

afterEach(() => {
  guestCart.clear()
  vi.unstubAllGlobals()
})

describe('product page', () => {
  it('shows the product, its editions, and every offer with stock', async () => {
    fakeApi({ ...guest, 'GET /api/products/hades': ok(hades) })
    renderApp('/product/hades')

    expect(await screen.findByRole('heading', { level: 1, name: 'Hades' })).toBeInTheDocument()
    const editions = screen.getByRole('navigation', { name: 'Editions' })
    expect(within(editions).getByRole('link', { name: /Steam · Global/ })).toHaveAttribute('aria-current', 'page')
    expect(within(editions).getByRole('link', { name: /Nintendo · Europe €8.09/ })).toHaveAttribute('href', '/product/hades-nintendo')

    const best = screen.getByRole('complementary', { name: 'Best offer' })
    expect(best).toHaveTextContent('€7.79')
    expect(best).toHaveTextContent('Sold by NovaKeys')
    expect(best).toHaveTextContent('Only 2 left')

    const offers = within(screen.getByRole('region', { name: /All offers/ })).getAllByRole('listitem')
    expect(offers.map((o) => o.textContent)).toEqual([
      expect.stringContaining('NovaKeysBest price'),
      expect.stringContaining('KeyForge'),
      expect.stringContaining('LootLane'),
    ])
    expect(screen.getByRole('button', { name: 'Sold out: LootLane' })).toBeDisabled()
  })

  it('adds keys to a guest cart up to the stock and updates the header', async () => {
    fakeApi({ ...guest, 'GET /api/products/hades': ok(hades) })
    renderApp('/product/hades')

    const add = await screen.findByRole('button', { name: 'Add to cart from NovaKeys' })
    fireEvent.click(add)
    expect(await screen.findByRole('link', { name: 'Cart, 1 item' })).toBeInTheDocument()
    fireEvent.click(add)
    expect(await screen.findByRole('link', { name: 'Cart, 2 items' })).toBeInTheDocument()
    // Stock is 2, so a third key cannot be added.
    expect(add).toBeDisabled()
    expect(JSON.parse(localStorage.getItem('eneba.cart')!)).toEqual([{ offer_id: 11, quantity: 2, added_price_cents: 779 }])
  })

  it('Buy now adds the best offer and opens the cart, priced by the server', async () => {
    const api = fakeApi({
      ...guest,
      'GET /api/products/hades': ok(hades),
      'POST /api/cart/quote': ok(cartOf(line())),
    })
    const router = renderApp('/product/hades')

    fireEvent.click(await screen.findByRole('button', { name: 'Buy now' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/cart'))
    expect(await screen.findByRole('link', { name: 'Hades' })).toBeInTheDocument()
    expect(api.calls.find((c) => c.path === '/api/cart/quote')?.body).toEqual({
      items: [{ offer_id: 11, quantity: 1, added_price_cents: 779 }],
    })
    expect(screen.getByRole('link', { name: 'Log in to check out' })).toHaveAttribute('href', '/login?next=%2Fcart')
  })

  it('shows a not-found page for an unknown product', async () => {
    fakeApi({ ...guest, 'GET /api/products/nope': { status: 404, body: { error: 'Product not found.' } } })
    renderApp('/product/nope')
    expect(await screen.findByRole('heading', { name: 'Product not found' })).toBeInTheDocument()
  })
})

describe('cart', () => {
  it('moves a guest cart into the account at log in', async () => {
    guestCart.add(11, 2, 779)
    const merged = cartOf(line({ quantity: 2, line_total_cents: 1558 }))
    let user: User | null = null
    const api = fakeApi({
      ...guest,
      'GET /api/auth/me': () => ok({ user }),
      'POST /api/auth/login': () => {
        user = ada
        return ok({ user: ada })
      },
      'POST /api/cart/quote': ok(merged),
      'POST /api/cart/merge': ok(merged),
      'GET /api/cart': ok(merged),
    })
    const router = renderApp('/login?next=%2Fcart')

    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'ada@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/cart'))
    await waitFor(() =>
      expect(api.calls.find((c) => c.path === '/api/cart/merge')?.body).toEqual({
        items: [{ offer_id: 11, quantity: 2, added_price_cents: 779 }],
      }),
    )
    await waitFor(() => expect(localStorage.getItem('eneba.cart')).toBeNull())
    expect(await screen.findByRole('button', { name: 'Continue to payment' })).toBeEnabled()
  })

  it('changes quantities, removes lines, and points out price changes', async () => {
    let cart = cartOf(line(), line({ offer_id: 12, price_cents: 899, added_price_cents: 879, line_total_cents: 899, stock: 18, seller: { name: 'KeyForge', rating: 98.7 } }))
    const api = fakeApi({
      ...signedIn,
      'GET /api/cart': () => ok(cart),
      'PUT /api/cart/items/11': (body) => {
        const q = (body as { quantity: number }).quantity
        cart = cartOf(line({ quantity: q, line_total_cents: 779 * q }), cart.lines[1])
        return ok(cart)
      },
      'DELETE /api/cart/items/12': () => {
        cart = cartOf(cart.lines[0])
        return ok(cart)
      },
    })
    renderApp('/cart')

    const items = await screen.findByRole('list', { name: 'Cart items' })
    expect(within(items).getByText('Price went up from €8.79')).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Order summary' })).toHaveTextContent('€16.78')

    fireEvent.click(screen.getByRole('button', { name: 'One more Hades from NovaKeys' }))
    await waitFor(() => expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({ quantity: 2 }))
    expect(await screen.findByText('€7.79 each')).toBeInTheDocument()
    // Stock is 2: no third key.
    expect(screen.getByRole('button', { name: 'One more Hades from NovaKeys' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Hades from KeyForge' }))
    await waitFor(() => expect(within(items).getAllByRole('listitem')).toHaveLength(1))
  })

  it('blocks checkout while a line is sold out or above stock', async () => {
    fakeApi({ ...signedIn, 'GET /api/cart': ok(cartOf(line({ quantity: 3, stock: 1, line_total_cents: 2337 }))) })
    renderApp('/cart')

    expect(await screen.findByRole('alert')).toHaveTextContent('Only 1 left. Lower the quantity to continue.')
    expect(screen.getByRole('button', { name: 'Continue to payment' })).toBeDisabled()
  })

  it('refreshes the cart when keys sell out during checkout', async () => {
    let calls = 0
    fakeApi({
      ...signedIn,
      'GET /api/cart': () => ok(++calls === 1 ? cartOf(line()) : cartOf(line({ stock: 0 }))),
      'POST /api/checkout': {
        status: 409,
        body: { error: "Some items don't have enough keys left.", code: 'insufficient_stock', problems: [{ offer_id: 11, available: 0 }] },
      },
    })
    renderApp('/cart')

    fireEvent.click(await screen.findByRole('button', { name: 'Continue to payment' }))
    expect(await screen.findByText('Some keys sold out while you were shopping. Your cart has been updated.')).toBeInTheDocument()
    expect(await screen.findByText('Sold out. Remove it to continue.')).toBeInTheDocument()
  })
})

describe('checkout', () => {
  it('reserves keys, validates the card, survives a decline, and delivers hidden keys', async () => {
    let current: Order = order()
    const api = fakeApi({
      ...signedIn,
      'GET /api/cart': ok(cartOf(line({ quantity: 2, line_total_cents: 1558 }))),
      'POST /api/checkout': () => ok(current),
      'GET /api/orders/42': () => ok(current),
      'POST /api/orders/42/pay': (body) => {
        if ((body as { number: string }).number === '4000 0000 0000 0002') {
          return { status: 402, body: { error: 'Your card was declined.', code: 'card_declined' } }
        }
        current = paidOrder
        return ok(current)
      },
      'POST /api/orders/42/keys/501/reveal': () => ok({ id: 501, code: 'ABCDE-12345-FGHIJ', revealed_at: new Date().toISOString() }),
    })
    const router = renderApp('/cart')

    fireEvent.click(await screen.findByRole('button', { name: 'Continue to payment' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/checkout/42'))
    expect(await screen.findByRole('timer')).toHaveAccessibleName(/^Reservation ends in (10:00|09:5\d)$/)
    expect(screen.getByRole('complementary', { name: 'Order summary' })).toHaveTextContent('2 × €7.79')

    // Nothing is sent while the form has mistakes.
    fireEvent.click(screen.getByRole('button', { name: 'Pay €15.58' }))
    expect(await screen.findByText('Enter the name on the card.')).toBeInTheDocument()
    expect(screen.getByText('Enter a valid card number.')).toBeInTheDocument()
    expect(screen.getByText('Enter the expiry date as MM/YY.')).toBeInTheDocument()
    expect(screen.getByText('Enter the 3-digit security code.')).toBeInTheDocument()
    expect(api.calls.some((c) => c.path.endsWith('/pay'))).toBe(false)

    fireEvent.change(screen.getByLabelText('Name on card'), { target: { value: 'Ada Lovelace' } })
    fireEvent.click(screen.getByRole('button', { name: '4000 0000 0000 0002' }))
    expect(screen.getByLabelText('Card number')).toHaveValue('4000 0000 0000 0002')
    fireEvent.change(screen.getByLabelText('Expiry (MM/YY)'), { target: { value: '1234' } })
    expect(screen.getByLabelText('Expiry (MM/YY)')).toHaveValue('12/34')
    fireEvent.change(screen.getByLabelText('CVC'), { target: { value: '123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pay €15.58' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Your card was declined. Try another card')

    fireEvent.change(screen.getByLabelText('Card number'), { target: { value: '4242424242424242' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pay €15.58' }))
    await waitFor(() => expect(router.state.location.pathname + router.state.location.search).toBe('/account/orders/42?paid=1'))
    expect(await screen.findByText('Payment successful. Your keys are ready below.')).toBeInTheDocument()
    expect(screen.getByText('Visa ending in 4242')).toBeInTheDocument()

    const keys = screen.getByRole('list', { name: 'Keys for Hades' })
    expect(within(keys).queryByText('ABCDE-12345-FGHIJ')).not.toBeInTheDocument()
    fireEvent.click(within(keys).getByRole('button', { name: 'Reveal key 1 for hades' }))
    expect(await within(keys).findByText('ABCDE-12345-FGHIJ')).toBeInTheDocument()
    expect(within(keys).getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    expect(within(keys).getByRole('button', { name: 'Reveal key 2 for hades' })).toBeInTheDocument()
  })

  it('shows when the reservation has run out', async () => {
    let current = order({ reserved_until: new Date(Date.now() + 1000).toISOString() })
    fakeApi({
      ...signedIn,
      'GET /api/orders/42': () => {
        const res = ok(current)
        current = order({ status: 'expired' })
        return res
      },
    })
    renderApp('/checkout/42')

    expect(await screen.findByRole('timer')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Your reservation ran out' }, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to cart' })).toHaveAttribute('href', '/cart')
  })

  it('lists orders with their status', async () => {
    fakeApi({
      ...signedIn,
      'GET /api/orders': ok({
        orders: [
          { id: 43, status: 'pending', total_cents: 899, created_at: '2026-11-12T11:00:00Z', item_count: 1, products: [paidOrder.items[0].product] },
          { id: 42, status: 'paid', total_cents: 1558, created_at: '2026-11-12T10:00:00Z', item_count: 2, products: [paidOrder.items[0].product, paidOrder.items[0].product] },
        ],
      }),
    })
    renderApp('/account/orders')

    const rows = await screen.findAllByRole('link', { name: /Order #/ })
    expect(rows[0]).toHaveTextContent('Awaiting payment')
    expect(rows[1]).toHaveTextContent('Hades + 1 more')
    expect(rows[1]).toHaveTextContent('Completed')
    expect(rows[1]).toHaveAttribute('href', '/account/orders/42')
  })
})

describe('card helpers', () => {
  it('formats as people type and validates like the server', () => {
    expect(formatCardNumber('4242424242424242')).toBe('4242 4242 4242 4242')
    expect(formatCardNumber('4242-42ab42')).toBe('4242 4242')
    expect(formatExpiry('1')).toBe('1')
    expect(formatExpiry('123')).toBe('12/3')
    expect(formatExpiry('12/345')).toBe('12/34')
    expect(luhnValid('4242424242424242')).toBe(true)
    expect(luhnValid('4242424242424241')).toBe(false)

    const now = new Date(Date.UTC(2026, 10, 12))
    const card = { name: 'Ada', number: '4242 4242 4242 4242', expiry: '11/26', cvc: '123' }
    expect(validateCard(card, now)).toEqual({})
    expect(validateCard({ ...card, expiry: '10/26' }, now)).toEqual({ expiry: 'This card has expired.' })
    expect(validateCard({ ...card, expiry: '13/30' }, now)).toEqual({ expiry: 'Enter the expiry date as MM/YY.' })
  })
})
