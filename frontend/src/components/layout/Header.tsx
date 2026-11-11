import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { CartIcon, SearchIcon, UserIcon } from '../icons'
import styles from './Header.module.css'

export function Header() {
  const navigate = useNavigate()

  const onSearch = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = String(new FormData(e.currentTarget).get('q') ?? '').trim()
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`)
  }

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

        <form role="search" className={styles.search} onSubmit={onSearch}>
          <label htmlFor="site-search" className="visually-hidden">
            Search
          </label>
          <SearchIcon className={styles.searchIcon} />
          <input
            id="site-search"
            name="q"
            type="search"
            placeholder="Search for games, top-ups and more"
            autoComplete="off"
          />
        </form>

        <nav className={styles.actions} aria-label="Account">
          <Link to="/cart" className={styles.iconLink} aria-label="Cart">
            <CartIcon />
          </Link>
          <Link to="/login" className={styles.account}>
            <UserIcon />
            <span className={styles.accountText}>Log in | Register</span>
          </Link>
        </nav>
      </div>
    </header>
  )
}
