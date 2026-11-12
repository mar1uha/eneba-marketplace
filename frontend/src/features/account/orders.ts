import type { OrderStatus } from '../../api/orders'
import { accountQueryKey } from '../auth/useAuth'

export const ordersQueryKey = [...accountQueryKey, 'orders'] as const
export const orderQueryKey = (id: number) => [...accountQueryKey, 'order', id] as const

export const statusLabels: Record<OrderStatus, string> = {
  pending: 'Awaiting payment',
  paid: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Expired',
}
