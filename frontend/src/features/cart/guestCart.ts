import { MAX_QUANTITY, type CartItem } from '../../api/cart'

/**
 * A guest's cart lives in localStorage and is merged into the account at sign-in.
 * Components read it through useSyncExternalStore, so every tab and component stays in sync.
 */
const STORAGE_KEY = 'eneba.cart'
const EMPTY: CartItem[] = []

let cache: CartItem[] | null = null
const listeners = new Set<() => void>()

const isItem = (x: unknown): x is CartItem =>
  typeof x === 'object' &&
  x !== null &&
  Number.isInteger((x as CartItem).offer_id) &&
  Number.isInteger((x as CartItem).quantity) &&
  (x as CartItem).quantity > 0

function load(): CartItem[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) && parsed.length ? parsed.filter(isItem) : EMPTY
  } catch {
    return EMPTY
  }
}

export function getGuestCart(): CartItem[] {
  cache ??= load()
  return cache
}

export function subscribeGuestCart(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) {
      cache = null
      listener()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

function save(items: CartItem[]) {
  cache = items.length ? items : EMPTY
  try {
    if (items.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage can be full or blocked (private mode); the cart still works for this page view.
  }
  listeners.forEach((l) => l())
}

export const guestCart = {
  add(offerId: number, quantity: number, priceCents: number) {
    const items = getGuestCart()
    const existing = items.find((i) => i.offer_id === offerId)
    save(
      existing
        ? items.map((i) => (i === existing ? { ...i, quantity: Math.min(i.quantity + quantity, MAX_QUANTITY) } : i))
        : [...items, { offer_id: offerId, quantity: Math.min(quantity, MAX_QUANTITY), added_price_cents: priceCents }],
    )
  },
  set(offerId: number, quantity: number) {
    save(getGuestCart().map((i) => (i.offer_id === offerId ? { ...i, quantity } : i)))
  },
  remove(offerId: number) {
    save(getGuestCart().filter((i) => i.offer_id !== offerId))
  },
  clear() {
    save([])
  },
}
