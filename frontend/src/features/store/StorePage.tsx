import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useCallback, useId, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ApiError } from '../../api/client'
import { searchProducts, type SearchResult, type SearchSort } from '../../api/products'
import button from '../../components/Button.module.css'
import { ProductCard } from '../../components/ProductCard'
import { formatPrice, platformLabels, regionLabels } from '../../lib/format'
import { FilterPanel } from './FilterPanel'
import { Pagination } from './Pagination'
import {
  eurosToCents,
  hasActiveFilters,
  readFilters,
  searchUrl,
  storeUrl,
  toApiQuery,
  type StoreFilters,
} from './storeParams'
import styles from './Store.module.css'

const SORT_LABELS: Record<SearchSort, string> = {
  relevance: 'Best match',
  best_selling: 'Best selling',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
}

export function StorePage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const filters = readFilters(params)
  const apiQuery = toApiQuery(filters)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filtersButtonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  const { data, error, refetch, isRefetching, isPlaceholderData } = useQuery({
    queryKey: ['products', apiQuery],
    queryFn: ({ signal }) => searchProducts(apiQuery, signal),
    placeholderData: keepPreviousData,
  })

  // Filter changes keep the scroll position and start again from page 1; page links scroll to the top.
  const update = (patch: Partial<StoreFilters>) =>
    navigate(storeUrl({ ...filters, page: 1, ...patch }), { preventScrollReset: true })

  const closeFilters = useCallback(() => {
    setFiltersOpen(false)
    filtersButtonRef.current?.focus()
  }, [setFiltersOpen])

  // Mirrors the server: relevance needs search text.
  const sort: SearchSort =
    filters.sort && !(filters.sort === 'relevance' && !filters.q) ? filters.sort : filters.q ? 'relevance' : 'best_selling'
  const sortOptions = (Object.keys(SORT_LABELS) as SearchSort[]).filter((s) => s !== 'relevance' || filters.q)
  const activeCount =
    filters.platforms.length + filters.regions.length + filters.genres.length + (filters.minPrice || filters.maxPrice ? 1 : 0)

  return (
    <div className={`container ${styles.page}`}>
      <title>{`${filters.q ? `${filters.q} · Search` : 'Store'} · Eneba Marketplace`}</title>
      <div className={styles.head}>
        <h1 className={styles.title}>{filters.q ? `Results for “${filters.q}”` : 'Store'}</h1>
        <p className={styles.count} aria-live="polite">
          {data && !isPlaceholderData ? countLabel(data.total, filters.q !== '') : ''}
        </p>
      </div>

      <div className={styles.layout}>
        <FilterPanel
          id={panelId}
          filters={filters}
          facets={data?.facets}
          total={data?.total}
          open={filtersOpen}
          onClose={closeFilters}
          onChange={update}
        />

        <section className={styles.results} aria-label="Products">
          <div className={styles.toolbar}>
            <button
              ref={filtersButtonRef}
              type="button"
              className={`${button.button} ${button.outline} ${styles.filtersButton}`}
              aria-expanded={filtersOpen}
              aria-controls={panelId}
              onClick={() => setFiltersOpen(true)}
            >
              {activeCount ? `Filters (${activeCount})` : 'Filters'}
            </button>
            <label className={styles.sort}>
              <span>Sort by</span>
              <select value={sort} onChange={(e) => update({ sort: e.target.value as SearchSort })}>
                {sortOptions.map((s) => (
                  <option key={s} value={s}>
                    {SORT_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <ActiveFilters filters={filters} genres={data?.facets?.genres} onChange={update} />

          {error && !data ? (
            <LoadError error={error} filters={filters} retrying={isRefetching} onRetry={() => void refetch()} />
          ) : !data ? (
            <GridSkeleton />
          ) : data.total === 0 ? (
            <NoResults filters={filters} didYouMean={data.did_you_mean} onClear={() => update(clearedFilters)} />
          ) : data.items.length === 0 ? (
            <div className={styles.message} role="status">
              <h2 className={styles.messageTitle}>This page is empty</h2>
              <p>There are fewer results than this page number.</p>
              <Link to={storeUrl({ ...filters, page: 1 })} className={`${button.button} ${button.primary}`}>
                Go to page 1
              </Link>
            </div>
          ) : (
            <Results data={data} filters={filters} busy={isPlaceholderData} />
          )}
        </section>
      </div>
    </div>
  )
}

const clearedFilters: Partial<StoreFilters> = { platforms: [], regions: [], genres: [], minPrice: '', maxPrice: '' }

const countLabel = (total: number, searching: boolean) =>
  `${total.toLocaleString('en-IE')} ${searching ? (total === 1 ? 'result' : 'results') : total === 1 ? 'product' : 'products'}`

function Results({ data, filters, busy }: { data: SearchResult; filters: StoreFilters; busy: boolean }) {
  const totalPages = Math.ceil(data.total / data.page_size)
  return (
    <>
      <ul className={styles.grid} aria-busy={busy}>
        {data.items.map((product) => (
          <li key={product.id}>
            <ProductCard product={product} />
          </li>
        ))}
      </ul>
      {totalPages > 1 && (
        <Pagination page={filters.page} totalPages={totalPages} hrefFor={(page) => storeUrl({ ...filters, page })} />
      )}
    </>
  )
}

interface ActiveFiltersProps {
  filters: StoreFilters
  genres?: { value: string; label?: string }[]
  onChange: (patch: Partial<StoreFilters>) => void
}

function ActiveFilters({ filters, genres, onChange }: ActiveFiltersProps) {
  if (!hasActiveFilters(filters)) return null
  const min = eurosToCents(filters.minPrice)
  const max = eurosToCents(filters.maxPrice)
  const price = min && max ? `${formatPrice(min)} – ${formatPrice(max)}` : min ? `From ${formatPrice(min)}` : max ? `Up to ${formatPrice(max)}` : ''

  const chips = [
    ...filters.platforms.map((p) => ({ key: `p-${p}`, label: platformLabels[p], remove: { platforms: filters.platforms.filter((x) => x !== p) } })),
    ...filters.regions.map((r) => ({ key: `r-${r}`, label: regionLabels[r], remove: { regions: filters.regions.filter((x) => x !== r) } })),
    ...filters.genres.map((g) => ({
      key: `g-${g}`,
      label: genres?.find((x) => x.value === g)?.label ?? g,
      remove: { genres: filters.genres.filter((x) => x !== g) },
    })),
    ...(price ? [{ key: 'price', label: price, remove: { minPrice: '', maxPrice: '' } }] : []),
  ]

  return (
    <ul className={styles.chips} aria-label="Active filters">
      {chips.map((chip) => (
        <li key={chip.key}>
          <button type="button" className={styles.chip} onClick={() => onChange(chip.remove)} aria-label={`Remove filter: ${chip.label}`}>
            {chip.label}
            <span aria-hidden="true">×</span>
          </button>
        </li>
      ))}
      <li>
        <button type="button" className={styles.clearAll} onClick={() => onChange(clearedFilters)}>
          Clear all
        </button>
      </li>
    </ul>
  )
}

function NoResults({ filters, didYouMean, onClear }: { filters: StoreFilters; didYouMean?: string; onClear: () => void }) {
  if (didYouMean) {
    return (
      <div className={styles.message} role="status">
        <h2 className={styles.messageTitle}>No results for “{filters.q}”</h2>
        <p>
          Did you mean{' '}
          <Link to={searchUrl(didYouMean)} className={styles.suggestion}>
            {didYouMean}
          </Link>
          ?
        </p>
      </div>
    )
  }
  if (hasActiveFilters(filters)) {
    return (
      <div className={styles.message} role="status">
        <h2 className={styles.messageTitle}>No products match these filters</h2>
        <p>Remove some filters to see more products.</p>
        <button type="button" className={`${button.button} ${button.primary}`} onClick={onClear}>
          Clear all filters
        </button>
      </div>
    )
  }
  return (
    <div className={styles.message} role="status">
      <h2 className={styles.messageTitle}>No results for “{filters.q}”</h2>
      <p>Check the spelling, or try a shorter or different name.</p>
      <Link to="/store" className={`${button.button} ${button.primary}`}>
        Browse all products
      </Link>
    </div>
  )
}

interface LoadErrorProps {
  error: Error
  filters: StoreFilters
  retrying: boolean
  onRetry: () => void
}

function LoadError({ error, filters, retrying, onRetry }: LoadErrorProps) {
  if (error instanceof ApiError && error.status === 400) {
    return (
      <div className={styles.message} role="alert">
        <h2 className={styles.messageTitle}>This link has filters we don&apos;t recognize</h2>
        <p>{error.message}</p>
        <Link to={searchUrl(filters.q)} className={`${button.button} ${button.primary}`}>
          Reset filters
        </Link>
      </div>
    )
  }
  return (
    <div className={styles.message} role="alert">
      <h2 className={styles.messageTitle}>We couldn&apos;t load products</h2>
      <p>Check your connection and try again.</p>
      <button type="button" className={`${button.button} ${button.primary}`} onClick={onRetry} disabled={retrying}>
        {retrying ? 'Retrying…' : 'Try again'}
      </button>
    </div>
  )
}

function GridSkeleton() {
  return (
    <div aria-busy="true" data-testid="store-skeleton">
      <span className="visually-hidden">Loading products…</span>
      <div className={styles.grid}>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className={`shimmer ${styles.cardSkeleton}`} />
        ))}
      </div>
    </div>
  )
}
