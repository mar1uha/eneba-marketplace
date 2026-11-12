import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { fetchSuggestions } from '../../api/products'
import type { ProductCard } from '../../api/types'
import { searchUrl } from '../../features/store/storeParams'
import { formatPrice, platformLabels, regionLabels } from '../../lib/format'
import { useDebouncedValue } from '../../lib/useDebouncedValue'
import { SearchIcon } from '../icons'
import styles from './SearchBox.module.css'

const MIN_CHARS = 2
const DEBOUNCE_MS = 200

type Option = { kind: 'product'; product: ProductCard } | { kind: 'did_you_mean'; title: string } | { kind: 'all' }

/** Header search: live suggestions while typing (ARIA combobox), full results in the Store on Enter. */
export function SearchBox({ className }: { className?: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const storeQuery = location.pathname === '/store' ? (new URLSearchParams(location.search).get('q') ?? '') : null

  const [text, setText] = useState(storeQuery ?? '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [syncedQuery, setSyncedQuery] = useState(storeQuery)
  const rootRef = useRef<HTMLFormElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()

  // The box shows the Store's search text, and empties when leaving the Store.
  if (storeQuery !== syncedQuery) {
    setSyncedQuery(storeQuery)
    setText(storeQuery ?? '')
    setOpen(false)
    setActive(-1)
  }

  const typed = text.trim()
  const term = useDebouncedValue(typed, DEBOUNCE_MS)
  const { data, isPlaceholderData } = useQuery({
    queryKey: ['suggestions', term],
    queryFn: ({ signal }) => fetchSuggestions(term, signal),
    enabled: open && term.length >= MIN_CHARS,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })

  const expanded = open && typed.length >= MIN_CHARS
  const options: Option[] = data
    ? [
        ...data.items.map((product) => ({ kind: 'product' as const, product })),
        ...(data.total === 0 && data.did_you_mean ? [{ kind: 'did_you_mean' as const, title: data.did_you_mean }] : []),
        ...(data.total > 0 ? [{ kind: 'all' as const }] : []),
      ]
    : []
  const optionId = (i: number) => `${listboxId}-${i}`

  useEffect(() => {
    if (!expanded) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [expanded])

  const close = () => {
    setOpen(false)
    setActive(-1)
  }

  const go = (to: string) => {
    close()
    inputRef.current?.blur()
    navigate(to)
  }

  const choose = (option: Option) => {
    if (option.kind === 'product') {
      setText('')
      go(`/product/${option.product.slug}`)
    } else {
      go(searchUrl(option.kind === 'did_you_mean' ? option.title : typed))
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (expanded && options[active]) choose(options[active])
    else go(searchUrl(typed))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!expanded) {
        setOpen(true)
        return
      }
      const n = options.length
      if (n === 0) return
      setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % n : a <= 0 ? n - 1 : a - 1))
    } else if (e.key === 'Escape' && expanded) {
      e.preventDefault()
      close()
    }
  }

  return (
    <form
      ref={rootRef}
      role="search"
      className={`${styles.search} ${className ?? ''}`}
      onSubmit={onSubmit}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) close()
      }}
    >
      <label htmlFor="site-search" className="visually-hidden">
        Search
      </label>
      <SearchIcon className={styles.icon} />
      <input
        ref={inputRef}
        id="site-search"
        name="q"
        type="search"
        role="combobox"
        placeholder="Search for games, top-ups and more"
        autoComplete="off"
        spellCheck={false}
        maxLength={100}
        value={text}
        aria-expanded={expanded}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={expanded && options[active] ? optionId(active) : undefined}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />

      <div className={styles.popup} hidden={!expanded}>
        {!data ? (
          <p className={styles.note}>Searching…</p>
        ) : (
          data.total === 0 && !isPlaceholderData && <p className={styles.note}>No results for “{typed}”.</p>
        )}
        {/* Keep focus in the input when clicking an option, so blur does not close the list first. */}
        <ul id={listboxId} role="listbox" aria-label="Search suggestions" className={styles.listbox} onMouseDown={(e) => e.preventDefault()}>
          {options.map((option, i) => (
            <li
              key={option.kind === 'product' ? option.product.id : option.kind}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              className={styles.option}
              data-kind={option.kind}
              onClick={() => choose(option)}
              onMouseMove={() => i !== active && setActive(i)}
            >
              {option.kind === 'product' ? (
                <ProductOption product={option.product} />
              ) : option.kind === 'did_you_mean' ? (
                <span>
                  Did you mean <strong>{option.title}</strong>?
                </span>
              ) : (
                <span>
                  {isPlaceholderData || !data
                    ? `See all results for “${typed}”`
                    : `See all ${data.total} ${data.total === 1 ? 'result' : 'results'} for “${typed}”`}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
      <p className="visually-hidden" aria-live="polite">
        {expanded && data && !isPlaceholderData ? `${data.total} ${data.total === 1 ? 'result' : 'results'} found` : ''}
      </p>
    </form>
  )
}

function ProductOption({ product }: { product: ProductCard }) {
  return (
    <>
      <img src={product.cover_url} alt="" width={36} height={50} className={styles.thumb} />
      <span className={styles.optionText}>
        <span className={styles.optionTitle}>{product.title}</span>
        <span className={styles.optionMeta}>
          {platformLabels[product.platform]} · {regionLabels[product.region]}
        </span>
      </span>
      <span className={styles.optionPrice}>{formatPrice(product.price_cents)}</span>
    </>
  )
}
