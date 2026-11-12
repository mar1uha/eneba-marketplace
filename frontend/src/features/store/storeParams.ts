import type { SearchSort } from '../../api/products'
import { PLATFORMS, REGIONS, type Platform, type Region } from '../../api/types'

/**
 * Store state lives in the URL so results can be shared and Back undoes a filter:
 * /store?q=witcher&platform=steam,gog&region=europe&genre=rpg&min_price=10&max_price=29.99&sort=price_asc&page=2
 * Prices in the URL are euros; the API takes cents.
 */
export interface StoreFilters {
  q: string
  platforms: Platform[]
  regions: Region[]
  genres: string[]
  /** Normalized euro amounts such as "10" or "9.99"; empty when unset. */
  minPrice: string
  maxPrice: string
  /** Unset means the server default: relevance when searching, best selling otherwise. */
  sort?: SearchSort
  page: number
}

const SORTS: readonly SearchSort[] = ['relevance', 'best_selling', 'price_asc', 'price_desc']
const GENRE_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
const MAX_PRICE_CENTS = 1_000_000
const MAX_PAGE = 1000

const includes = <T extends string>(allowed: readonly T[], value: string): value is T =>
  (allowed as readonly string[]).includes(value)

const list = (raw: string | null) => [...new Set((raw ?? '').split(',').map((s) => s.trim()).filter(Boolean))]

/** Parses a euro amount typed by a person ("10", "9.99", "9,99"); null when invalid or out of range. */
export function eurosToCents(input: string): number | null {
  const s = input.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const cents = Math.round(Number(s) * 100)
  return cents >= 1 && cents <= MAX_PRICE_CENTS ? cents : null
}

export const centsToEuros = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2))

const priceParam = (raw: string | null) => {
  const cents = eurosToCents(raw ?? '')
  return cents === null ? '' : centsToEuros(cents)
}

/** Reads the URL leniently: unknown values are dropped rather than breaking the page. */
export function readFilters(params: URLSearchParams): StoreFilters {
  const sort = params.get('sort') ?? ''
  const page = Number(params.get('page'))
  let minPrice = priceParam(params.get('min_price'))
  let maxPrice = priceParam(params.get('max_price'))
  if (minPrice && maxPrice && Number(minPrice) > Number(maxPrice)) [minPrice, maxPrice] = [maxPrice, minPrice]
  return {
    q: (params.get('q') ?? '').trim().slice(0, 100),
    platforms: list(params.get('platform')).filter((p) => includes(PLATFORMS, p)),
    regions: list(params.get('region')).filter((r) => includes(REGIONS, r)),
    genres: list(params.get('genre')).filter((g) => GENRE_SLUG.test(g)).slice(0, 20),
    minPrice,
    maxPrice,
    sort: includes(SORTS, sort) ? sort : undefined,
    page: Number.isInteger(page) && page >= 1 && page <= MAX_PAGE ? page : 1,
  }
}

/** The Store page URL for these filters. Commas stay readable instead of becoming %2C. */
export function storeUrl(f: StoreFilters): string {
  const parts: string[] = []
  const add = (key: string, value: string) => value && parts.push(`${key}=${encodeURIComponent(value).replace(/%2C/g, ',')}`)
  add('q', f.q)
  add('platform', f.platforms.join(','))
  add('region', f.regions.join(','))
  add('genre', f.genres.join(','))
  add('min_price', f.minPrice)
  add('max_price', f.maxPrice)
  add('sort', f.sort ?? '')
  if (f.page > 1) add('page', String(f.page))
  return parts.length ? `/store?${parts.join('&')}` : '/store'
}

export const emptyFilters: StoreFilters = { q: '', platforms: [], regions: [], genres: [], minPrice: '', maxPrice: '', page: 1 }

export const searchUrl = (q: string) => storeUrl({ ...emptyFilters, q: q.trim() })

/** Query string for GET /api/products. */
export function toApiQuery(f: StoreFilters): string {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  if (f.platforms.length) p.set('platform', f.platforms.join(','))
  if (f.regions.length) p.set('region', f.regions.join(','))
  if (f.genres.length) p.set('genre', f.genres.join(','))
  const min = eurosToCents(f.minPrice)
  const max = eurosToCents(f.maxPrice)
  if (min) p.set('min_price_cents', String(min))
  if (max) p.set('max_price_cents', String(max))
  if (f.sort) p.set('sort', f.sort)
  if (f.page > 1) p.set('page', String(f.page))
  return p.toString()
}

export const hasActiveFilters = (f: StoreFilters) =>
  f.platforms.length > 0 || f.regions.length > 0 || f.genres.length > 0 || f.minPrice !== '' || f.maxPrice !== ''
