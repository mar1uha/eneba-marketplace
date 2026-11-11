export type Platform = 'steam' | 'xbox' | 'playstation' | 'nintendo' | 'ea_app' | 'ubisoft_connect' | 'gog' | 'epic'

export type Region = 'global' | 'europe' | 'north_america' | 'united_kingdom'

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
