import { apiGet } from './client'

// Order fields are defined in Part 5, when checkout creates orders.
export const fetchOrders = (signal?: AbortSignal) =>
  apiGet<{ orders: unknown[] }>('/api/orders', signal).then((r) => r.orders)
