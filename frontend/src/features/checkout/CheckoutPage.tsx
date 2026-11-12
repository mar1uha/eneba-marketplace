import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { ApiError, errorMessage } from '../../api/client'
import { cancelOrder, fetchOrder, payOrder, type CardForm, type Order } from '../../api/orders'
import button from '../../components/Button.module.css'
import { Field, FormAlert } from '../../components/forms/Field'
import { formatCardNumber, formatExpiry, TEST_CARDS, validateCard } from '../../lib/card'
import { formatPrice, platformLabels, regionLabels } from '../../lib/format'
import { splitDuration, useCountdown } from '../../lib/useCountdown'
import { StatusPage } from '../../pages/StatusPage'
import { orderQueryKey, ordersQueryKey } from '../account/orders'
import { cartQueryKey } from '../cart/useCart'
import styles from './Checkout.module.css'

export function CheckoutPage() {
  const id = Number(useParams().orderId)
  const valid = Number.isInteger(id) && id > 0
  const { data: order, error, dataUpdatedAt, refetch } = useQuery({
    queryKey: orderQueryKey(id),
    queryFn: ({ signal }) => fetchOrder(id, signal),
    enabled: valid,
  })

  const backToCart = (
    <Link to="/cart" className={`${button.button} ${button.primary}`}>
      Back to cart
    </Link>
  )
  if (!valid || (error instanceof ApiError && error.status === 404)) {
    return <StatusPage title="Checkout not found" message="This checkout doesn't exist or belongs to another account." action={backToCart} />
  }
  if (error) {
    const retry = (
      <button type="button" className={`${button.button} ${button.primary}`} onClick={() => void refetch()}>
        Try again
      </button>
    )
    return <StatusPage role="alert" title="We couldn't load your checkout" message="Check your connection and try again." action={retry} />
  }
  if (!order) return <p className={`container ${styles.loading}`}>Loading checkout…</p>
  // Paying stores the paid order, which lands here too: one redirect for both paths.
  if (order.status === 'paid') return <Navigate to={`/account/orders/${order.id}?paid=1`} replace />
  if (order.status === 'expired') {
    const message = 'Keys are held for 10 minutes. They went back on sale; your cart still has them, so you can check out again.'
    return <StatusPage role="status" title="Your reservation ran out" message={message} action={backToCart} />
  }
  if (order.status === 'cancelled') {
    return <StatusPage role="status" title="Checkout cancelled" message="The keys went back on sale. Your cart still has them." action={backToCart} />
  }
  return <Payment order={order} clockOffsetMs={Date.parse(order.server_time) - dataUpdatedAt} onExpired={() => void refetch()} />
}

const emptyCard: CardForm = { name: '', number: '', expiry: '', cvc: '' }

function Payment({ order, clockOffsetMs, onExpired }: { order: Order; clockOffsetMs: number; onExpired: () => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [card, setCard] = useState(emptyCard)
  const [errors, setErrors] = useState<Partial<Record<keyof CardForm, string>>>({})
  const [formError, setFormError] = useState('')
  const remaining = useCountdown(order.reserved_until, clockOffsetMs, onExpired)
  const { minutes, seconds } = splitDuration(remaining)
  const timeLeft = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  const pay = useMutation({
    mutationFn: () => payOrder(order.id, card),
    onSuccess: (paid) => {
      void queryClient.invalidateQueries({ queryKey: cartQueryKey })
      void queryClient.invalidateQueries({ queryKey: ordersQueryKey })
      queryClient.setQueryData(orderQueryKey(order.id), paid)
    },
    onError: (err) => {
      if (err instanceof ApiError && err.field) {
        setErrors({ [err.field]: err.message })
      } else if (err instanceof ApiError && err.status === 402) {
        setFormError(`${err.message} Try another card; your keys stay reserved until the timer runs out.`)
      } else if (err instanceof ApiError && err.status === 409) {
        onExpired()
      } else {
        setFormError(errorMessage(err, 'Payment failed. Check your connection and try again.'))
      }
    },
  })
  const cancel = useMutation({
    mutationFn: () => cancelOrder(order.id),
    onSuccess: () => void navigate('/cart'),
  })

  const update = (field: keyof CardForm, value: string) => {
    setCard((c) => ({ ...c, [field]: value }))
    setErrors((e) => ({ ...e, [field]: undefined }))
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setFormError('')
    const found = validateCard(card)
    setErrors(found)
    if (Object.keys(found).length === 0) pay.mutate()
  }

  return (
    <div className={`container ${styles.page}`}>
      <title>Payment · Eneba Marketplace</title>
      <div className={styles.head}>
        <h1 className={styles.title}>Payment</h1>
        <p className={styles.timer} data-urgent={remaining < 60_000}>
          Keys reserved for{' '}
          <span role="timer" aria-label={`Reservation ends in ${timeLeft}`}>
            {timeLeft}
          </span>
        </p>
      </div>

      <div className={styles.layout}>
        <form className={styles.form} onSubmit={submit} noValidate aria-label="Card details">
          <p className={styles.demo}>
            This is a demo: no money is taken and only test cards work. Use any future expiry date and any 3 digits.
          </p>
          <ul className={styles.testCards} aria-label="Test cards">
            {TEST_CARDS.map((c) => (
              <li key={c.number}>
                <button type="button" onClick={() => update('number', c.number)}>
                  {c.number}
                </button>
                <span>{c.outcome}</span>
              </li>
            ))}
          </ul>

          {formError && <FormAlert>{formError}</FormAlert>}
          <Field
            label="Name on card"
            name="cc-name"
            autoComplete="cc-name"
            value={card.name}
            error={errors.name}
            onChange={(e) => update('name', e.target.value)}
          />
          <Field
            label="Card number"
            name="cc-number"
            autoComplete="cc-number"
            inputMode="numeric"
            placeholder="1234 1234 1234 1234"
            value={card.number}
            error={errors.number}
            onChange={(e) => update('number', formatCardNumber(e.target.value))}
          />
          <div className={styles.row}>
            <Field
              label="Expiry (MM/YY)"
              name="cc-exp"
              autoComplete="cc-exp"
              inputMode="numeric"
              placeholder="MM/YY"
              value={card.expiry}
              error={errors.expiry}
              onChange={(e) => update('expiry', formatExpiry(e.target.value))}
            />
            <Field
              label="CVC"
              name="cc-csc"
              autoComplete="cc-csc"
              inputMode="numeric"
              placeholder="123"
              maxLength={3}
              value={card.cvc}
              error={errors.cvc}
              onChange={(e) => update('cvc', e.target.value.replace(/\D/g, ''))}
            />
          </div>
          <button type="submit" className={`${button.button} ${button.primary} ${styles.pay}`} disabled={pay.isPending}>
            {pay.isPending ? 'Processing…' : `Pay ${formatPrice(order.total_cents)}`}
          </button>
          <button type="button" className={styles.cancel} disabled={cancel.isPending || pay.isPending} onClick={() => cancel.mutate()}>
            Cancel and return to cart
          </button>
          {cancel.isError && <FormAlert>Could not cancel the checkout. Try again.</FormAlert>}
        </form>

        <aside className={styles.summary} aria-label="Order summary">
          <h2 className={styles.summaryTitle}>Order #{order.id}</h2>
          <ul className={styles.items}>
            {order.items.map((it) => (
              <li key={it.id}>
                <img src={it.product.cover_url} alt="" width={48} height={66} />
                <span className={styles.itemText}>
                  <strong>{it.product.title}</strong>
                  <span>
                    {platformLabels[it.product.platform]} · {regionLabels[it.product.region]} · {it.seller_name}
                  </span>
                  <span>
                    {it.quantity} × {formatPrice(it.unit_price_cents)}
                  </span>
                </span>
                <strong>{formatPrice(it.unit_price_cents * it.quantity)}</strong>
              </li>
            ))}
          </ul>
          <p className={styles.total}>
            <span>Total</span>
            <strong>{formatPrice(order.total_cents)}</strong>
          </p>
        </aside>
      </div>
    </div>
  )
}
