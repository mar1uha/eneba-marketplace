import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { CarouselBlock } from '../../../api/homepage'
import { ChevronLeftIcon, ChevronRightIcon } from '../../../components/icons'
import { ProductCard } from '../../../components/ProductCard'
import styles from './ProductCarousel.module.css'

interface Props {
  block: CarouselBlock
  tone: 'base' | 'deep'
}

export function ProductCarousel({ block, tone }: Props) {
  const headingId = useId()
  const trackRef = useRef<HTMLUListElement>(null)
  const [edges, setEdges] = useState({ atStart: true, atEnd: false })

  const updateEdges = useCallback(() => {
    const el = trackRef.current
    if (!el) return
    setEdges({
      atStart: el.scrollLeft <= 1,
      atEnd: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
    })
  }, [])

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    updateEdges()
    const observer = new ResizeObserver(updateEdges)
    observer.observe(el)
    return () => observer.disconnect()
  }, [updateEdges])

  const scrollByPage = (direction: 1 | -1) => {
    const el = trackRef.current
    el?.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: 'smooth' })
  }

  return (
    <section className={styles.section} data-tone={tone} aria-labelledby={headingId}>
      <div className="container">
        <div className={styles.head}>
          <h2 id={headingId} className={styles.title}>
            {block.title}
          </h2>
          <div className={styles.nav}>
            <button
              type="button"
              className={styles.navButton}
              onClick={() => scrollByPage(-1)}
              disabled={edges.atStart}
              aria-label={`Scroll ${block.title} back`}
            >
              <ChevronLeftIcon />
            </button>
            <button
              type="button"
              className={styles.navButton}
              onClick={() => scrollByPage(1)}
              disabled={edges.atEnd}
              aria-label={`Scroll ${block.title} forward`}
            >
              <ChevronRightIcon />
            </button>
          </div>
        </div>
        <ul ref={trackRef} className={styles.track} onScroll={updateEdges}>
          {block.data.products.map((product) => (
            <li key={product.id} className={styles.item}>
              <ProductCard product={product} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
