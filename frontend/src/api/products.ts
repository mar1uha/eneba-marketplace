import { apiGet } from './client'
import type { Platform, ProductCard, Region } from './types'

export interface Offer {
  id: number
  price_cents: number
  discount_percent: number
  /** Keys for sale right now; 0 means sold out. */
  stock: number
  seller: { name: string; rating: number; review_count: number }
}

export interface Edition {
  slug: string
  title: string
  platform: Platform
  region: Region
  /** Cheapest offer with stock; null when the edition has nothing to buy. */
  price_cents: number | null
  current: boolean
}

export interface ProductDetail {
  id: number
  slug: string
  title: string
  description: string
  cover_url: string
  banner_url: string
  platform: Platform
  region: Region
  product_type: string
  msrp_cents: number
  release_date: string | null
  genres: { slug: string; name: string }[]
  editions: Edition[]
  /** In stock first, cheapest first; sold-out offers last. */
  offers: Offer[]
}

export const fetchProduct = (slug: string, signal?: AbortSignal) =>
  apiGet<ProductDetail>(`/api/products/${encodeURIComponent(slug)}`, signal)

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
