import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { fetchOrders } from '../../api/orders'
import button from '../../components/Button.module.css'
import { FormAlert } from '../../components/forms/Field'
import { formatDate } from '../../lib/dates'
import { formatPrice } from '../../lib/format'
import { ordersQueryKey, statusLabels } from './orders'
import styles from './Account.module.css'

export function OrdersPage() {
  const { data: orders, isPending, isError } = useQuery({
    queryKey: ordersQueryKey,
    queryFn: ({ signal }) => fetchOrders(signal),
  })

  return (
    <>
      <title>Orders · Eneba Marketplace</title>
      <h1 className={styles.heading}>Orders</h1>
      <section className={styles.panel}>
        {isPending && <p className={styles.muted}>Loading orders…</p>}
        {isError && <FormAlert>Could not load your orders.</FormAlert>}
        {orders?.length === 0 && (
          <div className={styles.empty}>
            <p className={styles.panelTitle}>No orders yet</p>
            <p className={styles.muted}>Keys you buy appear here, ready to redeem.</p>
            <Link to="/" className={`${button.button} ${button.primary}`}>
              Browse games
            </Link>
          </div>
        )}
        {orders && orders.length > 0 && (
          <ul className={styles.orders}>
            {orders.map((o) => {
              const [first, ...rest] = o.products
              return (
                <li key={o.id}>
                  <Link to={`/account/orders/${o.id}`} className={styles.orderRow}>
                    <img src={first?.cover_url} alt="" width={48} height={66} />
                    <span className={styles.orderText}>
                      <strong>
                        {first?.title}
                        {rest.length > 0 && ` + ${rest.length} more`}
                      </strong>
                      <span className={styles.muted}>
                        Order #{o.id} · {formatDate(o.created_at)} · {o.item_count} {o.item_count === 1 ? 'key' : 'keys'}
                      </span>
                    </span>
                    <span className={styles.status} data-status={o.status}>
                      {statusLabels[o.status]}
                    </span>
                    <strong className={styles.orderTotal}>{formatPrice(o.total_cents)}</strong>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}
