import { useEffect, useRef, useState } from 'react'
import type { HeroBlock } from '../../../api/homepage'
import button from '../../../components/Button.module.css'
import { ChevronLeftIcon, ChevronRightIcon } from '../../../components/icons'
import { SmartLink } from '../../../components/SmartLink'
import { formatPrice } from '../../../lib/format'
import styles from './HeroCarousel.module.css'

const SIDE_TILES = 3
const SWIPE_THRESHOLD_PX = 50

export function HeroCarousel({ block }: { block: HeroBlock }) {
  const { slides, interval_ms } = block.data
  const count = slides.length
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)
  const touchStartX = useRef<number | null>(null)

  const go = (index: number) => setActive(((index % count) + count) % count)

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (paused || count < 2 || reduceMotion) return
    const id = setTimeout(() => setActive((a) => (a + 1) % count), interval_ms)
    return () => clearTimeout(id)
  }, [active, paused, count, interval_ms])

  const upcoming = Array.from({ length: Math.min(SIDE_TILES, count - 1) }, (_, k) => (active + 1 + k) % count)

  return (
    <section
      className={styles.hero}
      aria-roledescription="carousel"
      aria-label={block.title || 'Featured'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div
        className={styles.stage}
        onTouchStart={(e) => (touchStartX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchStartX.current === null) return
          const dx = e.changedTouches[0].clientX - touchStartX.current
          touchStartX.current = null
          if (Math.abs(dx) > SWIPE_THRESHOLD_PX) go(active + (dx < 0 ? 1 : -1))
        }}
      >
        {slides.map((slide, i) => {
          const isActive = i === active
          const product = slide.product
          return (
            <div
              key={i}
              className={styles.slide}
              data-active={isActive}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}`}
              aria-hidden={!isActive}
              inert={!isActive}
            >
              <img
                className={styles.image}
                src={slide.image_url}
                alt=""
                fetchPriority={i === 0 ? 'high' : 'low'}
              />
              <div className={styles.content}>
                <h2 className={styles.title}>{slide.title}</h2>
                {slide.subtitle && <p className={styles.subtitle}>{slide.subtitle}</p>}
                {product && (
                  <p className={styles.price}>
                    From <strong>{formatPrice(product.price_cents)}</strong>
                    {product.discount_percent > 0 && (
                      <span className={styles.discount}> -{product.discount_percent}%</span>
                    )}
                  </p>
                )}
                <SmartLink href={slide.cta_href} className={`${button.button} ${button.primary} ${styles.cta}`}>
                  {slide.cta_label}
                </SmartLink>
              </div>
            </div>
          )
        })}

        {count > 1 && (
          <>
            <button type="button" className={`${styles.arrow} ${styles.prev}`} onClick={() => go(active - 1)} aria-label="Previous slide">
              <ChevronLeftIcon />
            </button>
            <button type="button" className={`${styles.arrow} ${styles.next}`} onClick={() => go(active + 1)} aria-label="Next slide">
              <ChevronRightIcon />
            </button>
            <div className={styles.dots}>
              {slides.map((slide, i) => (
                <button
                  key={i}
                  type="button"
                  className={styles.dot}
                  aria-label={`Go to slide ${i + 1}: ${slide.title}`}
                  aria-current={i === active}
                  onClick={() => go(i)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {upcoming.length > 0 && (
        <div className={styles.tiles}>
          {upcoming.map((i) => (
            <button key={i} type="button" className={styles.tile} onClick={() => go(i)} aria-label={`Show ${slides[i].title}`}>
              <img src={slides[i].product?.cover_url ?? slides[i].image_url} alt="" loading="lazy" />
              <span className={styles.tileLabel}>{slides[i].title}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
