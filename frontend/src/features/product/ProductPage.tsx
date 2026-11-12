import { useMutation, useQuery } from '@tanstack/react-query'
import type { CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { MAX_QUANTITY } from '../../api/cart'
import { ApiError, errorMessage } from '../../api/client'
import { fetchProduct, type Offer, type ProductDetail } from '../../api/products'
import button from '../../components/Button.module.css'
import { formatDay } from '../../lib/dates'
import { formatPrice, platformLabels, regionLabels } from '../../lib/format'
import { StatusPage } from '../../pages/StatusPage'
import { useCartActions, useCartLines } from '../cart/useCart'
import styles from './Product.module.css'

export function ProductPage() {
  const { slug = '' } = useParams()
  const { data: product, error, isPending, refetch } = useQuery({
    queryKey: ['product', slug],
    queryFn: ({ signal }) => fetchProduct(slug, signal),
  })

  if (isPending) return <ProductSkeleton />
  if (error instanceof ApiError && error.status === 404) {
    const browse = (
      <Link to="/store" className={`${button.button} ${button.primary}`}>
        Browse the store
      </Link>
    )
    return <StatusPage role="alert" title="Product not found" message="It may have been removed, or the link is wrong." action={browse} />
  }
  if (error) {
    const retry = (
      <button type="button" className={`${button.button} ${button.primary}`} onClick={() => void refetch()}>
        Try again
      </button>
    )
    return <StatusPage role="alert" title="We couldn't load this product" message="Check your connection and try again." action={retry} />
  }
  return <Product product={product} />
}

function Product({ product }: { product: ProductDetail }) {
  const best = product.offers.find((o) => o.stock > 0)
  const region = regionLabels[product.region]

  return (
    <article>
      <title>{`${product.title} (${platformLabels[product.platform]}, ${region}) · Eneba Marketplace`}</title>
      <section className={styles.hero} style={{ '--banner': `url("${product.banner_url}")` } as CSSProperties}>
        <div className={`container ${styles.heroInner}`}>
          <img className={styles.cover} src={product.cover_url} alt="" width={600} height={900} />
          <div className={styles.summary}>
            <h1 className={styles.title}>{product.title}</h1>
            <p className={styles.badges}>
              <span className={styles.platform}>{platformLabels[product.platform]}</span>
              <span className={styles.region}>{region}</span>
              {product.release_date && <span className={styles.meta}>Released {formatDay(product.release_date)}</span>}
            </p>
            {product.genres.length > 0 && (
              <ul className={styles.genres} aria-label="Genres">
                {product.genres.map((g) => (
                  <li key={g.slug}>
                    <Link to={`/store?genre=${g.slug}`}>{g.name}</Link>
                  </li>
                ))}
              </ul>
            )}
            {product.editions.length > 1 && <Editions product={product} />}
          </div>
          <aside className={styles.buyBox} aria-label="Best offer">
            {best ? (
              <>
                <p className={styles.buyLabel}>Best price</p>
                <WasPrice msrp={product.msrp_cents} discount={best.discount_percent} className={styles.was} />
                <p className={styles.bestPrice}>{formatPrice(best.price_cents)}</p>
                <p className={styles.seller}>
                  Sold by <strong>{best.seller.name}</strong> · {best.seller.rating}% positive
                </p>
                <StockLabel stock={best.stock} />
                <AddToCart offer={best} buyNow />
              </>
            ) : (
              <>
                <p className={styles.buyLabel}>Out of stock</p>
                <p className={styles.muted}>Every seller is sold out for this edition.</p>
              </>
            )}
          </aside>
        </div>
      </section>

      <div className={`container ${styles.body}`}>
        <section aria-labelledby="offers-title" className={styles.section}>
          <h2 id="offers-title" className={styles.sectionTitle}>
            All offers <span className={styles.count}>({product.offers.length})</span>
          </h2>
          {product.offers.length === 0 ? (
            <p className={styles.muted}>No seller offers this edition right now.</p>
          ) : (
            <ul className={styles.offers}>
              {product.offers.map((offer) => (
                <li key={offer.id} className={styles.offer} data-sold-out={offer.stock === 0}>
                  <div className={styles.offerSeller}>
                    <span className={styles.sellerName}>
                      {offer.seller.name}
                      {offer === best && <span className={styles.bestBadge}>Best price</span>}
                    </span>
                    <span className={styles.rating}>
                      {offer.seller.rating}% positive · {offer.seller.review_count.toLocaleString('en-IE')} reviews
                    </span>
                  </div>
                  <StockLabel stock={offer.stock} />
                  <div className={styles.offerPrice}>
                    <WasPrice msrp={product.msrp_cents} discount={offer.discount_percent} className={styles.offerWas} />
                    <strong>{formatPrice(offer.price_cents)}</strong>
                  </div>
                  <AddToCart offer={offer} />
                </li>
              ))}
            </ul>
          )}
        </section>
        {product.description && (
          <section aria-labelledby="about-title" className={styles.section}>
            <h2 id="about-title" className={styles.sectionTitle}>
              About the game
            </h2>
            <p className={styles.description}>{product.description}</p>
          </section>
        )}
      </div>
    </article>
  )
}

function Editions({ product }: { product: ProductDetail }) {
  return (
    <nav aria-label="Editions" className={styles.editions}>
      <p className={styles.editionsLabel}>Choose edition</p>
      <ul>
        {product.editions.map((e) => (
          <li key={e.slug}>
            <Link to={`/product/${e.slug}`} className={styles.edition} aria-current={e.current ? 'page' : undefined}>
              <span>
                {platformLabels[e.platform]} · {regionLabels[e.region]}
              </span>{' '}
              <strong>{e.price_cents === null ? 'Sold out' : formatPrice(e.price_cents)}</strong>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** Adds one key of an offer, within its stock and the per-offer limit. The buy box adds a Buy now button. */
function AddToCart({ offer, buyNow }: { offer: Offer; buyNow?: boolean }) {
  const navigate = useNavigate()
  const { add } = useCartActions()
  const inCart = useCartLines().find((l) => l.offer_id === offer.id)?.quantity ?? 0
  const canAdd = inCart < Math.min(offer.stock, MAX_QUANTITY)
  const mutation = useMutation({ mutationFn: () => add(offer.id, 1, offer.price_cents) })
  const soldOut = offer.stock === 0

  return (
    <div className={buyNow ? styles.buyActions : styles.offerAction}>
      {buyNow && (
        <button
          type="button"
          className={`${button.button} ${button.primary}`}
          disabled={mutation.isPending}
          onClick={() => (canAdd ? mutation.mutate(undefined, { onSuccess: () => void navigate('/cart') }) : void navigate('/cart'))}
        >
          Buy now
        </button>
      )}
      <button
        type="button"
        className={`${button.button} ${buyNow || soldOut ? button.outline : button.primary}`}
        disabled={!canAdd || mutation.isPending}
        onClick={() => mutation.mutate()}
        aria-label={buyNow ? undefined : soldOut ? `Sold out: ${offer.seller.name}` : `Add to cart from ${offer.seller.name}`}
      >
        {soldOut ? 'Sold out' : 'Add to cart'}
      </button>
      {inCart > 0 && <span className={styles.inCart}>{inCart} in cart</span>}
      {mutation.error ? (
        <p className={styles.addError} role="alert">
          {errorMessage(mutation.error, 'Could not add to cart. Try again.')}
        </p>
      ) : (
        mutation.isSuccess && (
          <p className={styles.added} role="status">
            Added to cart · <Link to="/cart">View cart</Link>
          </p>
        )
      )}
    </div>
  )
}

function WasPrice({ msrp, discount, className }: { msrp: number; discount: number; className: string }) {
  if (discount <= 0) return null
  return (
    <span className={className}>
      <s>{formatPrice(msrp)}</s> <span className={styles.discount}>-{discount}%</span>
    </span>
  )
}

function StockLabel({ stock }: { stock: number }) {
  const [level, text] = stock === 0 ? ['out', 'Sold out'] : stock <= 3 ? ['low', `Only ${stock} left`] : ['ok', 'In stock']
  return (
    <span className={styles.stock} data-level={level}>
      {text}
    </span>
  )
}

function ProductSkeleton() {
  return (
    <div aria-busy="true" data-testid="product-skeleton" className={`container ${styles.skeleton}`}>
      <span className="visually-hidden">Loading product…</span>
      <div className={`shimmer ${styles.skeletonCover}`} />
      <div className={styles.skeletonLines}>
        <div className="shimmer" />
        <div className="shimmer" />
        <div className="shimmer" />
      </div>
    </div>
  )
}
