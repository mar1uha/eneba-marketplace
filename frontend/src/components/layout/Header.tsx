import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import type { User } from '../../api/auth'
import type { Platform } from '../../api/types'
import { useMe, useSignOut } from '../../features/auth/useAuth'
import { platformLabels } from '../../lib/format'
import { CartIcon, UserIcon } from '../icons'
import { SearchBox } from './SearchBox'
import styles from './Header.module.css'

const BROWSE_PLATFORMS: Platform[] = ['steam', 'xbox', 'playstation', 'nintendo', 'ea_app', 'ubisoft_connect']

export function Header() {
  return (
    <header className={styles.header}>
      <div className={`container ${styles.bar}`}>
        <Link to="/" className={styles.logo} aria-label="Eneba Marketplace home">
          <svg className={styles.mark} viewBox="0 0 40 40" aria-hidden="true">
            <circle cx="15" cy="15" r="11" />
            <circle cx="25" cy="15" r="11" />
            <circle cx="20" cy="25" r="11" />
          </svg>
          eneba
        </Link>

        <SearchBox className={styles.search} />

        <nav className={styles.actions} aria-label="Account">
          <Link to="/cart" className={styles.iconLink} aria-label="Cart">
            <CartIcon />
          </Link>
          <AccountEntry />
        </nav>
      </div>
      <BrowseNav />
    </header>
  )
}

/** Marks the link matching the Store's platform filter: one platform, or none for "All products". */
function BrowseNav() {
  const location = useLocation()
  const onStore = location.pathname === '/store'
  const platform = onStore ? (new URLSearchParams(location.search).get('platform') ?? '') : null
  const links = [
    { to: '/store', label: 'All products', current: platform === '' },
    ...BROWSE_PLATFORMS.map((p) => ({ to: `/store?platform=${p}`, label: platformLabels[p], current: platform === p })),
  ]
  return (
    <nav className={styles.browse} aria-label="Browse">
      <ul className={`container ${styles.browseList}`}>
        {links.map((link) => (
          <li key={link.to}>
            <Link to={link.to} className={styles.browseLink} aria-current={link.current ? 'page' : undefined}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

const AUTH_PAGES = ['/login', '/register', '/forgot-password', '/reset-password']

function AccountEntry() {
  const { data: user, isPending } = useMe()
  const location = useLocation()

  if (isPending) return <span className={styles.accountPlaceholder} />
  if (user) return <UserMenu user={user} />

  const here = location.pathname + location.search
  const next = AUTH_PAGES.includes(location.pathname) || here === '/' ? '' : `?next=${encodeURIComponent(here)}`
  return (
    <Link to={`/login${next}`} className={styles.account}>
      <UserIcon />
      <span className={styles.accountText}>Log in | Register</span>
    </Link>
  )
}

function UserMenu({ user }: { user: User }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const signOut = useSignOut()
  const close = () => setOpen(false)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className={styles.userMenu}>
      <button
        type="button"
        className={styles.userButton}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.avatar} aria-hidden="true">
          {user.display_name.charAt(0).toUpperCase()}
        </span>
        <span className={styles.accountText}>{user.display_name}</span>
      </button>
      {open && (
        <div id={menuId} className={styles.menu}>
          <p className={styles.menuEmail}>{user.email}</p>
          <Link to="/account" onClick={close}>
            Account &amp; security
          </Link>
          <Link to="/account/orders" onClick={close}>
            Orders
          </Link>
          <button type="button" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
