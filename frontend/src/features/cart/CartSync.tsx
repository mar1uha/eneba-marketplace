import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { mergeCart } from '../../api/cart'
import { useMe } from '../auth/useAuth'
import { guestCart } from './guestCart'
import { cartQueryKey, useGuestCartItems } from './useCart'

/** Moves a guest's cart into the account once someone is signed in (log in, register, or Google redirect). */
export function CartSync() {
  const { data: user } = useMe()
  const items = useGuestCartItems()
  const queryClient = useQueryClient()
  const merging = useRef(false)

  useEffect(() => {
    if (!user || items.length === 0 || merging.current) return
    merging.current = true
    mergeCart(items)
      .then((cart) => {
        guestCart.clear()
        queryClient.setQueryData(cartQueryKey, cart)
      })
      // On failure the guest cart stays in the browser and is merged on the next change.
      .catch(() => {})
      .finally(() => {
        merging.current = false
      })
  }, [user, items, queryClient])

  return null
}
