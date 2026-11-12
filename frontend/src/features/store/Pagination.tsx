import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ChevronLeftIcon, ChevronRightIcon } from '../../components/icons'
import { pageWindow } from './pageWindow'
import styles from './Store.module.css'

interface Props {
  page: number
  totalPages: number
  hrefFor: (page: number) => string
}

export function Pagination({ page, totalPages, hrefFor }: Props) {
  return (
    <nav className={styles.pagination} aria-label="Pagination">
      <PageStep to={page > 1 ? hrefFor(page - 1) : undefined} label="Previous page">
        <ChevronLeftIcon />
      </PageStep>
      <ul className={styles.pageList}>
        {pageWindow(page, totalPages).map((p, i) =>
          p === 'gap' ? (
            <li key={`gap-${i}`} className={styles.pageGap} aria-hidden="true">
              …
            </li>
          ) : (
            <li key={p}>
              <Link
                to={hrefFor(p)}
                className={styles.pageLink}
                aria-current={p === page ? 'page' : undefined}
                aria-label={`Page ${p}`}
              >
                {p}
              </Link>
            </li>
          ),
        )}
      </ul>
      <PageStep to={page < totalPages ? hrefFor(page + 1) : undefined} label="Next page">
        <ChevronRightIcon />
      </PageStep>
    </nav>
  )
}

function PageStep({ to, label, children }: { to?: string; label: string; children: ReactNode }) {
  if (!to) {
    return (
      <span className={styles.pageLink} aria-disabled="true" aria-label={label} role="link">
        {children}
      </span>
    )
  }
  return (
    <Link to={to} className={styles.pageLink} aria-label={label}>
      {children}
    </Link>
  )
}
