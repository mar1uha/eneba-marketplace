import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { MAX_QUANTITY, type CartLine, type StockProblem } from '../../api/cart'
import { ApiError, errorMessage } from '../../api/client'
import { checkout } from '../../api/orders'
import button from '../../components/Button.module.css'
import { FormAlert } from '../../components/forms/Field'
import { formatPrice, platformLabels, regionLabels } from '../../lib/format'
import { orderQueryKey } from '../account/orders'
import { cartQueryKey, useCart, useCartActions } from './useCart'
import styles from './Cart.module.css'

/** Why a line blocks checkout, if it does. */
function lineProblem(line: CartLine): string | null {
  if (!line.available) return 'This offer is no longer sold. Remove it to continue.'
  if (line.stock === 0) return 'Sold out. Remove it to continue.'
  if (line.quantity > line.stock) return `Only ${line.stock} left. Lower the quantity to continue.`
  return null
}

export function CartPage() {
  const { cart, signedIn, error, refetch } = useCart()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [checkoutError, setCheckoutError] = useState('')

  const startCheckout = useMutation({
    mutationFn: checkout,
    onSuccess: (order) => {
      queryClient.setQueryData(orderQueryKey(order.id), order)
      void navigate(`/checkout/${order.id}`)
    },
    onError: (err) => {
      if (err instanceof ApiError && (err.body as { problems?: StockProblem[] } | null)?.problems) {
        setCheckoutError('Some keys sold out while you were shopping. Your cart has been updated.')
        void queryClient.invalidateQueries({ queryKey: cartQueryKey })
      } else {
        setCheckoutError(errorMessage(err, 'Checkout failed. Please try again.'))
      }
    },
  })

  return (
    <div className={`container ${styles.page}`}>
      <title>Cart · Eneba Marketplace</title>
      <h1 className={styles.title}>
        Your cart{cart && cart.item_count > 0 && <span className={styles.count}> ({cart.item_count})</span>}
      </h1>

      {error && !cart ? (
        <div className={styles.empty} role="alert">
          <p className={styles.emptyTitle}>We couldn&apos;t load your cart</p>
          <button type="button" className={`${button.button} ${button.primary}`} onClick={() => void refetch()}>
            Try again
          </button>
        </div>
      ) : !cart ? (
        <p className={styles.muted} aria-busy="true">
          Loading your cart…
        </p>
      ) : cart.lines.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Your cart is empty</p>
          <p className={styles.muted}>Find a game and add an offer to your cart.</p>
          <Link to="/store" className={`${button.button} ${button.primary}`}>
            Browse the store
          </Link>
        </div>
      ) : (
        <div className={styles.layout}>
          <ul className={styles.lines} aria-label="Cart items">
            {cart.lines.map((line) => (
              <Line key={line.offer_id} line={line} />
            ))}
          </ul>

          <aside className={styles.summary} aria-label="Order summary">
            <h2 className={styles.summaryTitle}>Summary</h2>
            <dl className={styles.totals}>
              <dt>
                {cart.item_count} {cart.item_count === 1 ? 'key' : 'keys'}
              </dt>
              <dd>{formatPrice(cart.total_cents)}</dd>
              <dt className={styles.grand}>Total</dt>
              <dd className={styles.grand}>{formatPrice(cart.total_cents)}</dd>
            </dl>
            {checkoutError && <FormAlert>{checkoutError}</FormAlert>}
            {signedIn ? (
              <button
                type="button"
                className={`${button.button} ${button.primary} ${styles.checkout}`}
                disabled={cart.lines.some((l) => lineProblem(l)) || startCheckout.isPending}
                onClick={() => {
                  setCheckoutError('')
                  startCheckout.mutate()
                }}
              >
                {startCheckout.isPending ? 'Reserving your keys…' : 'Continue to payment'}
              </button>
            ) : (
              <>
                <Link to="/login?next=%2Fcart" className={`${button.button} ${button.primary} ${styles.checkout}`}>
                  Log in to check out
                </Link>
                <p className={styles.note}>Your cart is saved in this browser and moves to your account when you log in.</p>
              </>
            )}
            <p className={styles.note}>Keys are reserved for 10 minutes while you pay.</p>
          </aside>
        </div>
      )}
    </div>
  )
}

function Line({ line }: { line: CartLine }) {
  const { setQuantity, remove } = useCartActions()
  const change = useMutation({ mutationFn: (q: number) => setQuantity(line.offer_id, q) })
  const drop = useMutation({ mutationFn: () => remove(line.offer_id) })
  const problem = lineProblem(line)
  const priceDelta = line.price_cents - line.added_price_cents
  const max = Math.min(MAX_QUANTITY, Math.max(line.stock, 1))
  const busy = change.isPending || drop.isPending
  const error = change.error ?? drop.error
  const title = line.product.title
  // The same game can sit in the cart twice, from different sellers.
  const name = `${title} from ${line.seller.name}`

  return (
    <li className={styles.line} data-problem={problem !== null}>
      <Link to={`/product/${line.product.slug}`} className={styles.thumb} tabIndex={-1} aria-hidden="true">
        <img src={line.product.cover_url} alt="" width={72} height={100} />
      </Link>
      <div className={styles.info}>
        <Link to={`/product/${line.product.slug}`} className={styles.name}>
          {title}
        </Link>
        <span className={styles.meta}>
          {platformLabels[line.product.platform]} · <span className={styles.region}>{regionLabels[line.product.region]}</span>
        </span>
        <span className={styles.sellerLine}>Sold by {line.seller.name}</span>
        {priceDelta !== 0 && line.available && (
          <span className={priceDelta > 0 ? styles.priceUp : styles.priceDown}>
            Price {priceDelta > 0 ? 'went up' : 'dropped'} from {formatPrice(line.added_price_cents)}
          </span>
        )}
        {problem && (
          <span className={styles.problem} role="alert">
            {problem}
          </span>
        )}
        {error && (
          <span className={styles.problem} role="alert">
            {errorMessage(error, 'Could not update the cart.')}
          </span>
        )}
      </div>
      <div className={styles.quantity} role="group" aria-label={`Quantity of ${name}`}>
        <button
          type="button"
          aria-label={`One fewer ${name}`}
          disabled={busy || line.quantity <= 1}
          onClick={() => change.mutate(line.quantity - 1)}
        >
          −
        </button>
        <output aria-live="polite">{line.quantity}</output>
        <button
          type="button"
          aria-label={`One more ${name}`}
          disabled={busy || !line.available || line.quantity >= max}
          onClick={() => change.mutate(line.quantity + 1)}
        >
          +
        </button>
      </div>
      <div className={styles.price}>
        <strong>{formatPrice(line.line_total_cents)}</strong>
        {line.quantity > 1 && <span className={styles.each}>{formatPrice(line.price_cents)} each</span>}
      </div>
      <button type="button" className={styles.remove} disabled={busy} onClick={() => drop.mutate()} aria-label={`Remove ${name}`}>
        Remove
      </button>
    </li>
  )
}
