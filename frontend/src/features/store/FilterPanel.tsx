import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { FacetCount, SearchResult } from '../../api/products'
import { PLATFORMS, REGIONS } from '../../api/types'
import button from '../../components/Button.module.css'
import form from '../../components/forms/Form.module.css'
import { formatPrice, platformLabels, regionLabels } from '../../lib/format'
import { centsToEuros, eurosToCents, type StoreFilters } from './storeParams'
import styles from './Store.module.css'

interface Props {
  id: string
  filters: StoreFilters
  facets?: SearchResult['facets']
  total?: number
  /** Only matters on small screens, where the panel is a full-screen overlay. */
  open: boolean
  onClose: () => void
  onChange: (patch: Partial<StoreFilters>) => void
}

const countOf = (counts: FacetCount[] | undefined, value: string) => counts?.find((c) => c.value === value)?.count

export function FilterPanel({ id, filters, facets, total, open, onClose, onChange }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  return (
    <aside id={id} className={styles.sidebar} data-open={open} aria-label="Filters">
      <div className={styles.sidebarHead}>
        <h2 className={styles.sidebarTitle}>Filters</h2>
        <button ref={closeRef} type="button" className={styles.closeButton} onClick={onClose} aria-label="Close filters">
          ×
        </button>
      </div>

      <CheckboxGroup
        legend="Platform"
        options={PLATFORMS.map((p) => ({ value: p, label: platformLabels[p], count: countOf(facets?.platforms, p) }))}
        selected={filters.platforms}
        onChange={(platforms) => onChange({ platforms: platforms as StoreFilters['platforms'] })}
      />
      <CheckboxGroup
        legend="Region"
        options={REGIONS.map((r) => ({ value: r, label: regionLabels[r], count: countOf(facets?.regions, r) }))}
        selected={filters.regions}
        onChange={(regions) => onChange({ regions: regions as StoreFilters['regions'] })}
      />
      <CheckboxGroup
        legend="Genre"
        options={(facets?.genres ?? []).map((g) => ({ value: g.value, label: g.label ?? g.value, count: g.count }))}
        selected={filters.genres}
        onChange={(genres) => onChange({ genres })}
        collapseAfter={8}
      />
      <PriceFilter
        key={`${filters.minPrice}|${filters.maxPrice}`}
        min={filters.minPrice}
        max={filters.maxPrice}
        range={facets?.price ?? null}
        onApply={(minPrice, maxPrice) => onChange({ minPrice, maxPrice })}
      />

      <div className={styles.sidebarFoot}>
        <button type="button" className={`${button.button} ${button.primary}`} onClick={onClose}>
          {total === undefined ? 'Show results' : `Show ${total} ${total === 1 ? 'result' : 'results'}`}
        </button>
      </div>
    </aside>
  )
}

interface Option {
  value: string
  label: string
  count?: number
}

interface GroupProps {
  legend: string
  options: Option[]
  selected: string[]
  onChange: (selected: string[]) => void
  collapseAfter?: number
}

function CheckboxGroup({ legend, options, selected, onChange, collapseAfter }: GroupProps) {
  const [expanded, setExpanded] = useState(false)
  if (options.length === 0) return null

  // Selected options stay visible even when the list is collapsed.
  const collapsible = collapseAfter !== undefined && options.length > collapseAfter
  const visible =
    collapsible && !expanded
      ? options.filter((o, i) => i < collapseAfter || selected.includes(o.value))
      : options

  const toggle = (value: string, checked: boolean) =>
    onChange(checked ? [...selected, value] : selected.filter((v) => v !== value))

  return (
    <fieldset className={styles.group}>
      <legend className={styles.groupTitle}>{legend}</legend>
      <ul className={styles.options}>
        {visible.map((o) => {
          const checked = selected.includes(o.value)
          return (
            <li key={o.value}>
              <label className={styles.option} data-empty={o.count === 0 && !checked}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={o.count === 0 && !checked}
                  onChange={(e) => toggle(o.value, e.target.checked)}
                />
                <span className={styles.optionLabel}>{o.label}</span>
                {o.count !== undefined && <span className={styles.optionCount}>{o.count}</span>}
              </label>
            </li>
          )
        })}
      </ul>
      {collapsible && (
        <button type="button" className={styles.moreButton} onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
          {expanded ? 'Show less' : `Show all ${options.length}`}
        </button>
      )}
    </fieldset>
  )
}

interface PriceProps {
  min: string
  max: string
  range: { min_cents: number; max_cents: number } | null
  onApply: (min: string, max: string) => void
}

function PriceFilter({ min, max, range, onApply }: PriceProps) {
  const [minInput, setMinInput] = useState(min)
  const [maxInput, setMaxInput] = useState(max)
  const [error, setError] = useState('')
  const minId = useId()
  const maxId = useId()
  const errorId = useId()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const lo = minInput.trim() ? eurosToCents(minInput) : 0
    const hi = maxInput.trim() ? eurosToCents(maxInput) : 0
    if (lo === null || hi === null) {
      setError('Enter amounts like 10 or 9.99.')
      return
    }
    if (lo && hi && lo > hi) {
      setError('The minimum is higher than the maximum.')
      return
    }
    setError('')
    onApply(lo ? centsToEuros(lo) : '', hi ? centsToEuros(hi) : '')
  }

  return (
    <form className={styles.group} onSubmit={submit} noValidate aria-label="Price">
      <p className={styles.groupTitle} aria-hidden="true">
        Price
      </p>
      <div className={styles.priceRow}>
        <label htmlFor={minId} className={styles.priceField}>
          <span>Min €</span>
          <input
            id={minId}
            className={form.input}
            inputMode="decimal"
            autoComplete="off"
            value={minInput}
            onChange={(e) => setMinInput(e.target.value)}
            placeholder={range ? centsToEuros(Math.floor(range.min_cents / 100) * 100) : ''}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
        </label>
        <label htmlFor={maxId} className={styles.priceField}>
          <span>Max €</span>
          <input
            id={maxId}
            className={form.input}
            inputMode="decimal"
            autoComplete="off"
            value={maxInput}
            onChange={(e) => setMaxInput(e.target.value)}
            placeholder={range ? centsToEuros(Math.ceil(range.max_cents / 100) * 100) : ''}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
        </label>
        <button type="submit" className={`${button.button} ${button.outline} ${styles.priceApply}`}>
          Apply
        </button>
      </div>
      {error ? (
        <p id={errorId} className={form.error} role="alert">
          {error}
        </p>
      ) : (
        range && (
          <p className={form.hint}>
            Prices here: {formatPrice(range.min_cents)} – {formatPrice(range.max_cents)}
          </p>
        )
      )}
    </form>
  )
}
