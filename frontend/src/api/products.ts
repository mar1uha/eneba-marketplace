import { apiGet } from './client'
import type { ProductCard } from './types'

export type SearchSort = 'relevance' | 'best_selling' | 'price_asc' | 'price_desc'

export interface FacetCount {
  value: string
  /** Present for genres; platform and region labels live in lib/format. */
  label?: string
  count: number
}

export interface SearchResult {
  items: ProductCard[]
  total: number
  page: number
  page_size: number
  /** The sort the server applied: relevance when searching, best selling otherwise, unless one was chosen. */
  sort: SearchSort
  facets?: {
    platforms: FacetCount[]
    regions: FacetCount[]
    genres: FacetCount[]
    /** Cheapest-offer range before the price filter; null when nothing matches. */
    price: { min_cents: number; max_cents: number } | null
  }
  /** Closest title when the search text matches nothing at all. */
  did_you_mean?: string
}

/** `query` is the API query string, e.g. "q=witcher&platform=steam". */
export const searchProducts = (query: string, signal?: AbortSignal) =>
  apiGet<SearchResult>(`/api/products${query ? `?${query}` : ''}`, signal)

export const fetchSuggestions = (q: string, signal?: AbortSignal) =>
  apiGet<SearchResult>(`/api/search/suggestions?q=${encodeURIComponent(q)}`, signal)
