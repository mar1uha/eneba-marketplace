import type { ReactNode } from 'react'
import { Link } from 'react-router'
import button from '../components/Button.module.css'
import styles from './StatusPage.module.css'

interface Props {
  title: string
  message: string
  /** Defaults to a link back to the homepage. */
  action?: ReactNode
  role?: 'alert' | 'status'
}

export function StatusPage({ title, message, action, role }: Props) {
  return (
    <section className={`container ${styles.page}`} role={role}>
      <title>{`${title} · Eneba Marketplace`}</title>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.text}>{message}</p>
      {action ?? (
        <Link to="/" className={`${button.button} ${button.primary}`}>
          Back to homepage
        </Link>
      )}
    </section>
  )
}

export function NotFound() {
  return <StatusPage title="Page not found" message="The page you are looking for does not exist." />
}

export function RouteError() {
  return <StatusPage title="Something went wrong" message="An unexpected error occurred. Please try again." />
}
