import type { CarouselBlock, DealBlock, HeroBlock } from '../api/homepage'
import type { ProductCard } from '../api/types'

export const product = (overrides: Partial<ProductCard> = {}): ProductCard => ({
  id: 1,
  slug: 'elden-ring',
  title: 'ELDEN RING',
  cover_url: 'https://cdn.test/cover.jpg',
  banner_url: 'https://cdn.test/banner.jpg',
  platform: 'steam',
  region: 'global',
  product_type: 'game',
  msrp_cents: 5999,
  price_cents: 2759,
  discount_percent: 54,
  offer_count: 4,
  ...overrides,
})

export const heroBlock: HeroBlock = {
  id: 10,
  type: 'hero_carousel',
  title: 'Featured',
  position: 10,
  data: {
    interval_ms: 6000,
    slides: [
      { title: 'ELDEN RING', subtitle: 'Rise, Tarnished.', image_url: 'https://cdn.test/hero1.jpg', cta_label: 'Shop now', cta_href: '/product/elden-ring', product: product() },
      { title: 'Hades II', image_url: 'https://cdn.test/hero2.jpg', cta_label: 'Shop now', cta_href: '/product/hades-ii' },
    ],
  },
}

export const dealBlock = (endsAt: string): DealBlock => ({
  id: 20,
  type: 'deal',
  title: 'Deal of the day',
  position: 20,
  data: { product: product({ id: 7, slug: 'god-of-war', title: 'God of War', region: 'europe' }), ends_at: endsAt },
})

export const carouselBlock: CarouselBlock = {
  id: 30,
  type: 'product_carousel',
  title: 'Best sellers',
  position: 30,
  data: {
    products: [
      product(),
      product({ id: 2, slug: 'hades', title: 'Hades', msrp_cents: 2450, price_cents: 2450, discount_percent: 0, offer_count: 1 }),
    ],
  },
}
