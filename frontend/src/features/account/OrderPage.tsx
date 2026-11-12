import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ApiError } from '../../api/client'
import { fetchOrder, revealKey, type DigitalKey, type Order } from '../../api/orders'
import button from '../../components/Button.module.css'
import { FormAlert } from '../../components/forms/Field'
import { formatDate, formatRelative } from '../../lib/dates'
import { formatPrice, platformLabels, regionLabels } from '../../lib/format'
import { orderQueryKey, statusLabels } from './orders'
import styles from './Account.module.css'

const brandLabels: Record<string, string> = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express' }

export function OrderPage() {
  const id = Number(useParams().orderId)
  const valid = Number.isInteger(id) && id > 0
  const [params] = useSearchParams()
  const { data: order, error } = useQuery({
    queryKey: orderQueryKey(id),
    queryFn: ({ signal }) => fetchOrder(id, signal),
    enabled: valid,
  })

  if (!valid || error) {
    const missing = !valid || (error instanceof ApiError && error.status === 404)
    return (
      <section className={styles.panel}>
        <FormAlert>{missing ? 'This order does not exist.' : 'Could not load this order.'}</FormAlert>
        <Link to="/account/orders" className={styles.textButton}>
          Back to orders
        </Link>
      </section>
    )
  }
  if (!order) return <p className={styles.muted}>Loading order…</p>

  return (
    <>
      <title>{`Order #${order.id} · Eneba Marketplace`}</title>
      <Link to="/account/orders" className={styles.textButton}>
        ← All orders
      </Link>
      <div className={styles.panelHead}>
        <h1 className={styles.heading}>Order #{order.id}</h1>
        <span className={styles.status} data-status={order.status}>
          {statusLabels[order.status]}
        </span>
      </div>
      {params.get('paid') === '1' && order.status === 'paid' && (
        <FormAlert tone="success">Payment successful. Your keys are ready below.</FormAlert>
      )}

      <section className={styles.panel}>
        <dl className={styles.details}>
          <dt>Placed</dt>
          <dd>{formatDate(order.created_at)}</dd>
          <dt>Total</dt>
          <dd>{formatPrice(order.total_cents)}</dd>
          {order.payment && (
            <>
              <dt>Paid with</dt>
              <dd>
                {brandLabels[order.payment.card_brand] ?? 'Card'} ending in {order.payment.card_last4}
              </dd>
            </>
          )}
        </dl>
        {order.status === 'pending' && (
          <Link to={`/checkout/${order.id}`} className={`${button.button} ${button.primary} ${styles.formButton}`}>
            Complete payment
          </Link>
        )}
      </section>

      {order.items.map((item) => (
        <section key={item.id} className={styles.panel} aria-label={item.product.title}>
          <div className={styles.orderItem}>
            <img src={item.product.cover_url} alt="" width={64} height={88} />
            <div className={styles.orderText}>
              <Link to={`/product/${item.product.slug}`} className={styles.panelTitle}>
                {item.product.title}
              </Link>
              <span className={styles.muted}>
                {platformLabels[item.product.platform]} · {regionLabels[item.product.region]} · sold by {item.seller_name}
              </span>
              <span className={styles.muted}>
                {item.quantity} × {formatPrice(item.unit_price_cents)}
              </span>
            </div>
          </div>
          {item.keys.length > 0 && (
            <ul className={styles.keys} aria-label={`Keys for ${item.product.title}`}>
              {item.keys.map((k, i) => (
                <KeyRow key={k.id} order={order} digitalKey={k} label={`Key ${i + 1} for ${item.product.title}`} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </>
  )
}

function KeyRow({ order, digitalKey, label }: { order: Order; digitalKey: DigitalKey; label: string }) {
  const queryClient = useQueryClient()
  const [copied, setCopied] = useState(false)
  const reveal = useMutation({
    mutationFn: () => revealKey(order.id, digitalKey.id),
    onSuccess: (k) =>
      queryClient.setQueryData<Order>(orderQueryKey(order.id), (o) =>
        o && {
          ...o,
          items: o.items.map((it) => ({ ...it, keys: it.keys.map((x) => (x.id === k.id ? k : x)) })),
        },
      ),
  })

  const code = digitalKey.code
  return (
    <li className={styles.key}>
      <code className={styles.code} aria-label={code ? label : `${label}, hidden`}>
        {code ?? '•••••-•••••-•••••'}
      </code>
      {code ? (
        <button
          type="button"
          className={`${button.button} ${button.outline}`}
          onClick={() => navigator.clipboard.writeText(code).then(() => setCopied(true), () => {})}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      ) : (
        <button
          type="button"
          className={`${button.button} ${button.primary}`}
          disabled={reveal.isPending}
          onClick={() => reveal.mutate()}
          aria-label={`Reveal ${label.toLowerCase()}`}
        >
          Reveal key
        </button>
      )}
      {digitalKey.revealed_at && <span className={styles.muted}>Revealed {formatRelative(digitalKey.revealed_at)}</span>}
      {reveal.isError && <span className={styles.keyError}>Could not reveal the key. Try again.</span>}
    </li>
  )
}
