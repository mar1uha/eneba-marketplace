import { apiGet, apiSend } from './client'
import type { ProductRef } from './types'

export type OrderStatus = 'pending' | 'paid' | 'cancelled' | 'expired'

export interface DigitalKey {
  id: number
  /** Null until the buyer reveals it. */
  code: string | null
  revealed_at: string | null
}

export interface Order {
  id: number
  status: OrderStatus
  total_cents: number
  created_at: string
  reserved_until: string
  paid_at: string | null
  server_time: string
  items: Array<{
    id: number
    offer_id: number
    product: ProductRef
    seller_name: string
    unit_price_cents: number
    quantity: number
    keys: DigitalKey[]
  }>
  payment: { card_brand: string; card_last4: string } | null
}

export interface OrderSummary {
  id: number
  status: OrderStatus
  total_cents: number
  created_at: string
  item_count: number
  products: ProductRef[]
}

export interface CardForm {
  name: string
  number: string
  /** MM/YY */
  expiry: string
  cvc: string
}

export const fetchOrders = (signal?: AbortSignal) =>
  apiGet<{ orders: OrderSummary[] }>('/api/orders', signal).then((r) => r.orders)
export const fetchOrder = (id: number, signal?: AbortSignal) => apiGet<Order>(`/api/orders/${id}`, signal)
export const checkout = () => apiSend<Order>('POST', '/api/checkout')
export const payOrder = (id: number, card: CardForm) => apiSend<Order>('POST', `/api/orders/${id}/pay`, card)
export const cancelOrder = (id: number) => apiSend<Order>('POST', `/api/orders/${id}/cancel`)
export const revealKey = (orderId: number, keyId: number) =>
  apiSend<DigitalKey>('POST', `/api/orders/${orderId}/keys/${keyId}/reveal`)
