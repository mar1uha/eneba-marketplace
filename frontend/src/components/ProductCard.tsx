import { Link } from 'react-router'
import type { ProductCard as Product } from '../api/types'
import { formatPrice, platformLabels, regionLabels } from '../lib/format'
import styles from './ProductCard.module.css'

export function ProductCard({ product }: { product: Product }) {
  const hasDiscount = product.discount_percent > 0

  return (
    <Link to={`/product/${product.slug}`} className={styles.card}>
      <div className={styles.media}>
        <img src={product.cover_url} alt="" loading="lazy" width={600} height={900} />
        <span className={styles.platform}>{platformLabels[product.platform]}</span>
      </div>
      <div className={styles.info}>
        <h3 className={styles.title}>{product.title}</h3>
        <span className={styles.region}>{regionLabels[product.region]}</span>
        <p className={styles.from}>
          From
          {hasDiscount && (
            <>
              {' '}
              <s aria-label={`was ${formatPrice(product.msrp_cents)}`}>{formatPrice(product.msrp_cents)}</s>{' '}
              <span className={styles.discount}>-{product.discount_percent}%</span>
            </>
          )}
        </p>
        <p className={styles.price}>{formatPrice(product.price_cents)}</p>
        <p className={styles.offers}>
          {product.offer_count} {product.offer_count === 1 ? 'offer' : 'offers'}
        </p>
      </div>
    </Link>
  )
}
