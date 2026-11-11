import { useQuery } from '@tanstack/react-query'
import { getHomepage } from '../../api/homepage'
import button from '../../components/Button.module.css'
import { BlockRenderer } from './BlockRenderer'
import styles from './HomePage.module.css'

export function HomePage() {
  const { data, isPending, refetch, isRefetching } = useQuery({
    queryKey: ['homepage'],
    queryFn: ({ signal }) => getHomepage(signal),
  })

  return (
    <>
      <title>Eneba Marketplace · Buy games cheaper</title>
      <h1 className="visually-hidden">Eneba Marketplace</h1>
      {data ? (
        data.blocks.map((block, i) => (
          <BlockRenderer
            key={block.id}
            block={block}
            index={i}
            clockOffsetMs={data.clockOffsetMs}
            onDealExpired={() => void refetch()}
          />
        ))
      ) : isPending ? (
        <HomeSkeleton />
      ) : (
        <div className={`container ${styles.error}`} role="alert">
          <h2 className={styles.errorTitle}>We couldn&apos;t load the homepage</h2>
          <p>Check your connection and try again.</p>
          <button
            type="button"
            className={`${button.button} ${button.primary}`}
            onClick={() => void refetch()}
            disabled={isRefetching}
          >
            {isRefetching ? 'Retrying…' : 'Try again'}
          </button>
        </div>
      )}
    </>
  )
}

function HomeSkeleton() {
  return (
    <div aria-busy="true" data-testid="home-skeleton">
      <span className="visually-hidden">Loading homepage…</span>
      <div className={`${styles.shimmer} ${styles.heroSkeleton}`} />
      {[0, 1].map((row) => (
        <div key={row} className={`container ${styles.rowSkeleton}`}>
          <div className={`${styles.shimmer} ${styles.titleSkeleton}`} />
          <div className={styles.cardsSkeleton}>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className={`${styles.shimmer} ${styles.cardSkeleton}`} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
