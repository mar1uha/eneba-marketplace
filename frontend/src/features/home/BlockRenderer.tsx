import type { HomepageBlock } from '../../api/homepage'
import { DealBlock } from './blocks/DealBlock'
import { HeroCarousel } from './blocks/HeroCarousel'
import { ProductCarousel } from './blocks/ProductCarousel'

interface Props {
  block: HomepageBlock
  index: number
  clockOffsetMs: number
  onDealExpired: () => void
}

export function BlockRenderer({ block, index, clockOffsetMs, onDealExpired }: Props) {
  switch (block.type) {
    case 'hero_carousel':
      return <HeroCarousel block={block} />
    case 'product_carousel':
      return <ProductCarousel block={block} tone={index % 2 === 0 ? 'base' : 'deep'} />
    case 'deal':
      return <DealBlock block={block} clockOffsetMs={clockOffsetMs} onExpire={onDealExpired} />
    default:
      // A newer backend may send block types this build does not know yet.
      return null
  }
}
