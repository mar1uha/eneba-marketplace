export const PLATFORMS = ['steam', 'xbox', 'playstation', 'nintendo', 'ea_app', 'ubisoft_connect', 'gog', 'epic'] as const
export type Platform = (typeof PLATFORMS)[number]

export const REGIONS = ['global', 'europe', 'north_america', 'united_kingdom'] as const
export type Region = (typeof REGIONS)[number]

/** The product fields a cart line or order item shows. */
export interface ProductRef {
  slug: string
  title: string
  cover_url: string
  platform: Platform
  region: Region
}

export interface ProductCard {
  id: number
  slug: string
  title: string
  cover_url: string
  banner_url: string
  platform: Platform
  region: Region
  product_type: string
  msrp_cents: number
  price_cents: number
  discount_percent: number
  offer_count: number
}
