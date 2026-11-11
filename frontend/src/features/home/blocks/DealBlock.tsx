import { useId } from 'react'
import { Link } from 'react-router'
import type { DealBlock as Deal } from '../../../api/homepage'
import button from '../../../components/Button.module.css'
import { formatPrice, platformLabels, regionLabels } from '../../../lib/format'
import { splitDuration, useCountdown } from '../useCountdown'
import styles from './DealBlock.module.css'

interface Props {
  block: Deal
  clockOffsetMs: number
  onExpire: () => void
}

const pad = (n: number) => String(n).padStart(2, '0')

export function DealBlock({ block, clockOffsetMs, onExpire }: Props) {
  const headingId = useId()
  const { product, ends_at } = block.data
  const left = splitDuration(useCountdown(ends_at, clockOffsetMs, onExpire))
  const href = `/product/${product.slug}`

  const units = [
    ...(left.days > 0 ? [{ label: 'Days', value: left.days }] : []),
    { label: 'Hrs.', value: left.hours },
    { label: 'Min.', value: left.minutes },
    { label: 'Sec.', value: left.seconds },
  ]

  return (
    <section className={styles.deal} aria-labelledby={headingId}>
      <img className={styles.backdrop} src={product.banner_url} alt="" aria-hidden="true" loading="lazy" />
      <div className={`container ${styles.inner}`}>
        <Link to={href} className={styles.cover} tabIndex={-1} aria-hidden="true">
          <img src={product.cover_url} alt="" loading="lazy" />
        </Link>

        <div className={styles.info}>
          <h2 id={headingId} className={styles.label}>
            {block.title}
          </h2>
          <Link to={href} className={styles.name}>
            {product.title}
          </Link>
          <p className={styles.meta}>
            {platformLabels[product.platform]} · <span className={styles.region}>{regionLabels[product.region]}</span>
          </p>
          {product.discount_percent > 0 && (
            <p className={styles.was}>
              <s>{formatPrice(product.msrp_cents)}</s> <span className={styles.discount}>-{product.discount_percent}%</span>
            </p>
          )}
          <p className={styles.price}>{formatPrice(product.price_cents)}</p>
          <p className={styles.offers}>
            Best of {product.offer_count} seller {product.offer_count === 1 ? 'offer' : 'offers'}
          </p>
        </div>

        <div className={styles.timer}>
          <p className={styles.endsIn}>Ends in</p>
          <div
            className={styles.digits}
            role="timer"
            aria-label={`Deal ends in ${pad(left.days * 24 + left.hours)}:${pad(left.minutes)}:${pad(left.seconds)}`}
          >
            {units.map((u) => (
              <div key={u.label} className={styles.unit} aria-hidden="true">
                <span className={styles.value}>{pad(u.value)}</span>
                <span className={styles.unitLabel}>{u.label}</span>
              </div>
            ))}
          </div>
          <Link to={href} className={`${button.button} ${button.primary} ${styles.cta}`}>
            See the deal
          </Link>
        </div>
      </div>
    </section>
  )
}
