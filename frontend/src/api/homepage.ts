import { apiGet } from './client'
import type { ProductCard } from './types'

export interface HeroSlide {
  title: string
  subtitle?: string
  image_url: string
  cta_label: string
  cta_href: string
  product?: ProductCard
}

interface BlockBase<T extends string, D> {
  id: number
  type: T
  title: string
  position: number
  data: D
}

export type HeroBlock = BlockBase<'hero_carousel', { interval_ms: number; slides: HeroSlide[] }>
export type CarouselBlock = BlockBase<'product_carousel', { products: ProductCard[] }>
export type DealBlock = BlockBase<'deal', { product: ProductCard; ends_at: string }>
export type HomepageBlock = HeroBlock | CarouselBlock | DealBlock

export interface Homepage {
  blocks: HomepageBlock[]
  /** Server clock minus client clock, so countdowns ignore a wrong local clock. */
  clockOffsetMs: number
}

interface HomepageResponse {
  server_time: string
  blocks: HomepageBlock[]
}

export async function getHomepage(signal?: AbortSignal): Promise<Homepage> {
  const res = await apiGet<HomepageResponse>('/api/homepage', signal)
  return { blocks: res.blocks, clockOffsetMs: Date.parse(res.server_time) - Date.now() }
}
