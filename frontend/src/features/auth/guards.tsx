import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router'
import button from '../../components/Button.module.css'
import statusStyles from '../../pages/StatusPage.module.css'
import { safeNext, useMe } from './useAuth'

function AuthCheckFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <section className={`container ${statusStyles.page}`} role="alert">
      <h1 className={statusStyles.title}>We couldn&apos;t check your sign-in</h1>
      <p className={statusStyles.text}>Check your connection and try again.</p>
      <button type="button" className={`${button.button} ${button.primary}`} onClick={onRetry}>
        Try again
      </button>
    </section>
  )
}

/** Protected routes: guests are sent to /login and come back here afterwards. */
export function RequireAuth() {
  const { data: user, isPending, isError, refetch } = useMe()
  const location = useLocation()

  if (isPending) return <div className={statusStyles.page} aria-busy="true" />
  if (isError) return <AuthCheckFailed onRetry={() => void refetch()} />
  if (!user) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  }
  return <Outlet />
}

/** Sign-in pages: once a user is stored (after sign-in or for a returning visitor), go to ?next=. */
export function GuestOnly() {
  const { data: user, isPending } = useMe()
  const [params] = useSearchParams()

  if (isPending) return <div className={statusStyles.page} aria-busy="true" />
  if (user) return <Navigate to={safeNext(params.get('next'))} replace />
  return <Outlet />
}
