import { apiGet, apiSend } from './client'
import type { ProductRef } from './types'

export const MAX_QUANTITY = 10

/** A cart line as the browser stores it for guests. */
export interface CartItem {
  offer_id: number
  quantity: number
  /** Price when added, so the cart can point out a price change. */
  added_price_cents: number
}

export interface CartLine {
  offer_id: number
  quantity: number
  price_cents: number
  added_price_cents: number
  line_total_cents: number
  stock: number
  /** False when the seller withdrew the offer. */
  available: boolean
  product: ProductRef
  seller: { name: string; rating: number }
}

export interface Cart {
  lines: CartLine[]
  item_count: number
  total_cents: number
}

export interface StockProblem {
  offer_id: number
  available: number
}

export const fetchCart = (signal?: AbortSignal) => apiGet<Cart>('/api/cart', signal)
export const quoteCart = (items: CartItem[]) => apiSend<Cart>('POST', '/api/cart/quote', { items })
export const mergeCart = (items: CartItem[]) => apiSend<Cart>('POST', '/api/cart/merge', { items })
export const addCartItem = (offerId: number, quantity: number) =>
  apiSend<Cart>('POST', '/api/cart/items', { offer_id: offerId, quantity })
export const setCartItem = (offerId: number, quantity: number) =>
  apiSend<Cart>('PUT', `/api/cart/items/${offerId}`, { quantity })
export const removeCartItem = (offerId: number) => apiSend<Cart>('DELETE', `/api/cart/items/${offerId}`)
