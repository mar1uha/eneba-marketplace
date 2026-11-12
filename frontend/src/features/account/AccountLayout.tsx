import { NavLink, Outlet } from 'react-router'
import { useMe, useSignOut } from '../auth/useAuth'
import styles from './Account.module.css'

export function AccountLayout() {
  const { data: user } = useMe()
  const signOut = useSignOut()

  return (
    <div className={`container ${styles.layout}`}>
      <aside className={styles.sidebar}>
        <p className={styles.who}>
          <span className={styles.avatar} aria-hidden="true">
            {user?.display_name.charAt(0).toUpperCase()}
          </span>
          <span className={styles.identity}>
            <strong className={styles.name}>{user?.display_name}</strong>
            <span className={styles.email}>{user?.email}</span>
          </span>
        </p>
        <nav aria-label="Account" className={styles.nav}>
          <NavLink to="/account" end className={({ isActive }) => (isActive ? styles.active : undefined)}>
            Account &amp; security
          </NavLink>
          <NavLink to="/account/orders" className={({ isActive }) => (isActive ? styles.active : undefined)}>
            Orders
          </NavLink>
        </nav>
        <button type="button" className={styles.signOut} onClick={() => signOut.mutate()} disabled={signOut.isPending}>
          Sign out
        </button>
      </aside>
      <div className={styles.content}>
        <Outlet />
      </div>
    </div>
  )
}
