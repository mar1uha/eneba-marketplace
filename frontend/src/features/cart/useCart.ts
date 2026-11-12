import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { addCartItem, fetchCart, quoteCart, removeCartItem, setCartItem, type Cart } from '../../api/cart'
import { accountQueryKey, useMe } from '../auth/useAuth'
import { getGuestCart, guestCart, subscribeGuestCart } from './guestCart'

export const cartQueryKey = [...accountQueryKey, 'cart'] as const

const EMPTY_CART: Cart = { lines: [], item_count: 0, total_cents: 0 }

export const useGuestCartItems = () => useSyncExternalStore(subscribeGuestCart, getGuestCart)

const useServerCart = (enabled: boolean) =>
  useQuery({ queryKey: cartQueryKey, queryFn: ({ signal }) => fetchCart(signal), enabled })

/** Cart actions that work the same for guests (browser storage) and signed-in users (server cart). */
export function useCartActions() {
  const { data: user } = useMe()
  const queryClient = useQueryClient()
  const store = (cart: Cart) => queryClient.setQueryData(cartQueryKey, cart)

  return {
    add: async (offerId: number, quantity: number, priceCents: number) => {
      if (user) store(await addCartItem(offerId, quantity))
      else guestCart.add(offerId, quantity, priceCents)
    },
    setQuantity: async (offerId: number, quantity: number) => {
      if (user) store(await setCartItem(offerId, quantity))
      else guestCart.set(offerId, quantity)
    },
    remove: async (offerId: number) => {
      if (user) store(await removeCartItem(offerId))
      else guestCart.remove(offerId)
    },
  }
}

/** The full cart with current prices and stock. Guests' carts are priced by the server without being stored. */
export function useCart() {
  const { data: user, isPending: userPending } = useMe()
  const guestItems = useGuestCartItems()
  const server = useServerCart(!!user)
  const guest = useQuery({
    queryKey: ['guest-cart', guestItems],
    queryFn: () => quoteCart(guestItems),
    enabled: !userPending && !user && guestItems.length > 0,
    placeholderData: keepPreviousData,
  })

  if (userPending) return { cart: undefined, signedIn: false, error: null, refetch: server.refetch }
  if (user) return { cart: server.data, signedIn: true, error: server.error, refetch: server.refetch }
  if (guestItems.length === 0) return { cart: EMPTY_CART, signedIn: false, error: null, refetch: guest.refetch }
  return { cart: guest.data, signedIn: false, error: guest.error, refetch: guest.refetch }
}

/** Lines already in the cart (offer and quantity), without pricing a guest's whole cart. */
export function useCartLines(): { offer_id: number; quantity: number }[] {
  const { data: user } = useMe()
  const guestItems = useGuestCartItems()
  const server = useServerCart(!!user)
  return user ? (server.data?.lines ?? []) : guestItems
}

export const useCartCount = () => useCartLines().reduce((n, l) => n + l.quantity, 0)
