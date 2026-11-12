import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SearchResult } from '../../api/products'
import { PLATFORMS, REGIONS } from '../../api/types'
import { fakeApi } from '../../test/fakeApi'
import { product } from '../../test/fixtures'
import { renderApp } from '../../test/renderApp'

const guestApi = {
  'GET /api/auth/me': { status: 200, body: { user: null } },
  'GET /api/homepage': { status: 200, body: { server_time: '2026-11-11T10:00:00Z', blocks: [] } },
}

const result = (overrides: Partial<SearchResult> = {}): SearchResult => ({
  items: [product(), product({ id: 2, slug: 'hades', title: 'Hades', platform: 'gog', price_cents: 1299 })],
  total: 2,
  page: 1,
  page_size: 24,
  sort: 'best_selling',
  facets: {
    platforms: PLATFORMS.map((value) => ({ value, count: value === 'steam' || value === 'gog' ? 1 : 0 })),
    regions: REGIONS.map((value) => ({ value, count: value === 'global' ? 2 : 0 })),
    genres: [
      { value: 'action', label: 'Action', count: 2 },
      { value: 'rpg', label: 'RPG', count: 1 },
    ],
    price: { min_cents: 1299, max_cents: 2759 },
  },
  ...overrides,
})

const ok = (body: unknown) => ({ status: 200, body })

function storeApi(reply: (query: URLSearchParams) => { status: number; body?: unknown } = () => ok(result())) {
  return fakeApi({ ...guestApi, 'GET /api/products': (_body, query) => reply(query) })
}

const lastProductsQuery = (api: ReturnType<typeof fakeApi>) =>
  Object.fromEntries(api.calls.filter((c) => c.path === '/api/products').at(-1)?.query ?? [])

afterEach(() => vi.unstubAllGlobals())

describe('Store', () => {
  it('loads results for the filters in the URL and ignores values it does not know', async () => {
    const api = storeApi(() => ok(result({ sort: 'relevance' })))
    renderApp('/store?q=elden&platform=steam,ps5&min_price=30&max_price=9.5&sort=cheapest&page=x')

    expect(await screen.findByRole('heading', { name: 'Results for “elden”' })).toBeInTheDocument()
    expect(lastProductsQuery(api)).toEqual({ q: 'elden', platform: 'steam', min_price_cents: '950', max_price_cents: '3000' })
    expect(await screen.findByText('2 results')).toBeInTheDocument()
    const cards = within(screen.getByRole('region', { name: 'Products' })).getAllByRole('link')
    expect(cards.map((c) => c.getAttribute('href'))).toEqual(['/product/elden-ring', '/product/hades'])
    expect(screen.getByRole('combobox', { name: 'Search' })).toHaveValue('elden')
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('relevance')
  })

  it('applies a checkbox filter from page 1 and removes it with its chip', async () => {
    const api = storeApi()
    const router = renderApp('/store?genre=rpg&page=2')

    await screen.findByText('2 products')
    expect(screen.getByRole('checkbox', { name: /^Xbox Live/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /^GOG/ }))

    await waitFor(() => expect(router.state.location.search).toBe('?platform=gog&genre=rpg'))
    await waitFor(() => expect(lastProductsQuery(api)).toEqual({ platform: 'gog', genre: 'rpg' }))
    expect(screen.getByRole('checkbox', { name: /^GOG/ })).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'Remove filter: RPG' }))
    await waitFor(() => expect(router.state.location.search).toBe('?platform=gog'))
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
  })

  it('changes the sort order', async () => {
    const api = storeApi()
    const router = renderApp('/store')

    const sort = await screen.findByRole('combobox', { name: 'Sort by' })
    expect(within(sort).queryByRole('option', { name: 'Best match' })).not.toBeInTheDocument()
    fireEvent.change(sort, { target: { value: 'price_asc' } })

    await waitFor(() => expect(router.state.location.search).toBe('?sort=price_asc'))
    await waitFor(() => expect(lastProductsQuery(api)).toEqual({ sort: 'price_asc' }))
  })

  it('validates the price range before applying it', async () => {
    const api = storeApi()
    const router = renderApp('/store')
    const min = await screen.findByLabelText('Min €')
    const max = screen.getByLabelText('Max €')
    const apply = screen.getByRole('button', { name: 'Apply' })

    fireEvent.change(min, { target: { value: 'ten' } })
    fireEvent.click(apply)
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter amounts like 10 or 9.99.')

    fireEvent.change(min, { target: { value: '40' } })
    fireEvent.change(max, { target: { value: '30' } })
    fireEvent.click(apply)
    expect(await screen.findByRole('alert')).toHaveTextContent('The minimum is higher than the maximum.')
    expect(router.state.location.search).toBe('')

    fireEvent.change(min, { target: { value: '9,99' } })
    fireEvent.click(apply)
    await waitFor(() => expect(router.state.location.search).toBe('?min_price=9.99&max_price=30'))
    await waitFor(() => expect(lastProductsQuery(api)).toEqual({ min_price_cents: '999', max_price_cents: '3000' }))
    expect(screen.getByRole('button', { name: 'Remove filter: €9.99 – €30.00' })).toBeInTheDocument()
  })

  it('paginates with links that keep the filters', async () => {
    const api = storeApi((q) => ok(result({ total: 50, page: Number(q.get('page') ?? 1) })))
    const router = renderApp('/store?platform=steam')

    const nav = await screen.findByRole('navigation', { name: 'Pagination' })
    expect(within(nav).getByRole('link', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Page 3' })).toHaveAttribute('href', '/store?platform=steam&page=3')
    expect(within(nav).getByRole('link', { name: 'Previous page' })).toHaveAttribute('aria-disabled', 'true')

    fireEvent.click(within(nav).getByRole('link', { name: 'Next page' }))
    await waitFor(() => expect(router.state.location.search).toBe('?platform=steam&page=2'))
    await waitFor(() => expect(lastProductsQuery(api)).toEqual({ platform: 'steam', page: '2' }))
  })

  it('offers the closest title when a search matches nothing', async () => {
    const api = storeApi((q) =>
      q.get('q') === 'witcher game'
        ? ok(result({ items: [], total: 0, did_you_mean: 'The Witcher 3: Wild Hunt' }))
        : ok(result({ sort: 'relevance' })),
    )
    const router = renderApp('/store?q=witcher%20game')

    expect(await screen.findByRole('heading', { name: 'No results for “witcher game”' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'The Witcher 3: Wild Hunt' }))
    await waitFor(() => expect(router.state.location.search).toBe('?q=The%20Witcher%203%3A%20Wild%20Hunt'))
    await waitFor(() => expect(lastProductsQuery(api)).toEqual({ q: 'The Witcher 3: Wild Hunt' }))
  })

  it('offers to clear filters when they hide every result', async () => {
    storeApi((q) => ok(q.get('region') ? result({ items: [], total: 0 }) : result()))
    const router = renderApp('/store?region=united_kingdom')

    expect(await screen.findByRole('heading', { name: 'No products match these filters' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(await screen.findByText('2 products')).toBeInTheDocument()
  })

  it('explains a link with filters the server rejects', async () => {
    storeApi(() => ({ status: 400, body: { error: 'unknown genre "made-up"' } }))
    renderApp('/store?q=hades&genre=made-up')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("This link has filters we don't recognize")
    expect(within(alert).getByRole('link', { name: 'Reset filters' })).toHaveAttribute('href', '/store?q=hades')
  })

  it('retries after a server error', async () => {
    let calls = 0
    storeApi(() => (++calls <= 2 ? { status: 500, body: { error: 'could not load products' } } : ok(result())))
    renderApp('/store')

    const alert = await screen.findByRole('alert', {}, { timeout: 3000 })
    expect(alert).toHaveTextContent("We couldn't load products")
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('2 products')).toBeInTheDocument()
  })
})

describe('header search', () => {
  const suggestionsApi = (reply: (q: string) => SearchResult) =>
    fakeApi({ ...guestApi, 'GET /api/search/suggestions': (_body, query) => ok(reply(query.get('q') ?? '')), 'GET /api/products': ok(result()) })

  const suggestions = (q: string) =>
    result({ items: [product(), product({ id: 3, slug: 'elden-ring-gog', title: 'ELDEN RING', platform: 'gog' })], total: q ? 2 : 0, facets: undefined })

  it('suggests products while typing and opens one with the keyboard', async () => {
    const api = suggestionsApi(suggestions)
    const router = renderApp('/')
    const input = screen.getByRole('combobox', { name: 'Search' })

    fireEvent.change(input, { target: { value: 'e' } })
    fireEvent.change(input, { target: { value: 'eldn' } })
    const listbox = await screen.findByRole('listbox', { name: 'Search suggestions' })
    const options = await within(listbox).findAllByRole('option')
    expect(options).toHaveLength(3)
    expect(options[0]).toHaveTextContent('ELDEN RING')
    expect(options[0]).toHaveTextContent('Steam · Global')
    expect(options[2]).toHaveTextContent('See all 2 results for “eldn”')
    // Debounced: one request for the final text, none for the single letter.
    expect(api.calls.filter((c) => c.path === '/api/search/suggestions').map((c) => c.query.get('q'))).toEqual(['eldn'])

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant', options[1].id)
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.submit(input.closest('form')!)

    await waitFor(() => expect(router.state.location.pathname).toBe('/product/elden-ring-gog'))
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens the Store with full results when Enter is pressed without a highlighted suggestion', async () => {
    suggestionsApi(suggestions)
    const router = renderApp('/')
    const input = screen.getByRole('combobox', { name: 'Search' })

    fireEvent.change(input, { target: { value: '  witcher ' } })
    await screen.findByRole('listbox', { name: 'Search suggestions' })
    fireEvent.submit(input.closest('form')!)

    await waitFor(() => expect(router.state.location.pathname + router.state.location.search).toBe('/store?q=witcher'))
    expect(await screen.findByRole('heading', { name: 'Results for “witcher”' })).toBeInTheDocument()
    expect(input).toHaveValue('witcher')
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes suggestions with Escape', async () => {
    suggestionsApi(suggestions)
    renderApp('/')
    const input = screen.getByRole('combobox', { name: 'Search' })

    fireEvent.change(input, { target: { value: 'elden' } })
    await screen.findByRole('listbox', { name: 'Search suggestions' })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox', { name: 'Search suggestions' })).not.toBeInTheDocument()
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('suggests the closest title when nothing matches', async () => {
    suggestionsApi(() => result({ items: [], total: 0, facets: undefined, did_you_mean: 'The Witcher 3: Wild Hunt' }))
    const router = renderApp('/')
    const input = screen.getByRole('combobox', { name: 'Search' })

    fireEvent.change(input, { target: { value: 'witcher game' } })
    expect(await screen.findByText('No results for “witcher game”.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: 'Did you mean The Witcher 3: Wild Hunt?' }))
    await waitFor(() => expect(router.state.location.search).toBe('?q=The%20Witcher%203%3A%20Wild%20Hunt'))
  })
})
