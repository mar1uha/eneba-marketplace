import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { carouselBlock, dealBlock, heroBlock } from '../../test/fixtures'
import { HomePage } from './HomePage'

const SERVER_TIME = '2026-11-11T22:59:30Z'
const MIDNIGHT = '2026-11-12T00:00:00Z'

const page = (blocks: unknown[], serverTime = SERVER_TIME) => ({ server_time: serverTime, blocks })

function mockFetch(...responses: Array<{ status: number; body: unknown }>) {
  const fetchMock = vi.fn()
  for (const r of responses) {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } }),
    )
  }
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('HomePage', () => {
  it('shows a skeleton, then renders API blocks in order and ignores unknown types', async () => {
    const unknown = { id: 99, type: 'mystery_box', title: 'Mystery', position: 15, data: {} }
    const fetchMock = mockFetch({ status: 200, body: page([heroBlock, unknown, dealBlock(MIDNIGHT), carouselBlock]) })
    renderHome()

    expect(screen.getByTestId('home-skeleton')).toBeInTheDocument()
    const carousel = await screen.findByRole('region', { name: 'Best sellers' })
    expect(screen.queryByTestId('home-skeleton')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/homepage', expect.anything())

    const hero = screen.getByRole('region', { name: 'Featured' })
    const deal = screen.getByRole('region', { name: 'Deal of the day' })
    expect(hero.compareDocumentPosition(deal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(deal.compareDocumentPosition(carousel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('Mystery')).not.toBeInTheDocument()
  })

  it('renders product cards with cheapest price, discount, and offer count', async () => {
    mockFetch({ status: 200, body: page([carouselBlock]) })
    renderHome()

    const carousel = await screen.findByRole('region', { name: 'Best sellers' })
    const cards = within(carousel).getAllByRole('link')
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveAttribute('href', '/product/elden-ring')
    expect(cards[0]).toHaveTextContent('€27.59')
    expect(cards[0]).toHaveTextContent('-54%')
    expect(cards[0]).toHaveTextContent('4 offers')
    expect(cards[1]).not.toHaveTextContent('%')
    expect(cards[1]).toHaveTextContent('1 offer')
  })

  it('counts the deal down on the server clock, not the browser clock', async () => {
    mockFetch({ status: 200, body: page([dealBlock(MIDNIGHT)]) })
    renderHome()

    const timer = await screen.findByRole('timer')
    expect(timer.getAttribute('aria-label')).toMatch(/^Deal ends in 01:00:(29|30)$/)
  })

  it('refetches when the deal expires so the next deal appears', async () => {
    const fetchMock = mockFetch(
      { status: 200, body: page([dealBlock(SERVER_TIME)]) },
      { status: 200, body: page([dealBlock(MIDNIGHT)]) },
    )
    renderHome()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('timer').getAttribute('aria-label')).toMatch(/01:00/))
  })

  it('shows an error with a working retry button', async () => {
    mockFetch({ status: 500, body: { error: 'could not load homepage' } }, { status: 200, body: page([carouselBlock]) })
    renderHome()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("couldn't load the homepage")
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('region', { name: 'Best sellers' })).toBeInTheDocument()
  })

  it('moves the hero carousel with the arrow buttons', async () => {
    mockFetch({ status: 200, body: page([heroBlock]) })
    renderHome()

    const hero = await screen.findByRole('region', { name: 'Featured' })
    expect(within(hero).getByRole('group', { name: '1 of 2' })).toHaveTextContent('ELDEN RING')
    expect(within(hero).queryByRole('group', { name: '2 of 2' })).not.toBeInTheDocument()

    fireEvent.click(within(hero).getByRole('button', { name: 'Next slide' }))
    expect(within(hero).getByRole('group', { name: '2 of 2' })).toHaveTextContent('Hades II')
    expect(within(hero).queryByRole('group', { name: '1 of 2' })).not.toBeInTheDocument()
  })
})
