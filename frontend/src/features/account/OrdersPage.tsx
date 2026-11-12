import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { fetchOrders } from '../../api/orders'
import button from '../../components/Button.module.css'
import { FormAlert } from '../../components/forms/Field'
import { accountQueryKey } from '../auth/useAuth'
import styles from './Account.module.css'

export function OrdersPage() {
  const { data: orders, isPending, isError } = useQuery({
    queryKey: [...accountQueryKey, 'orders'],
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
      </section>
    </>
  )
}
