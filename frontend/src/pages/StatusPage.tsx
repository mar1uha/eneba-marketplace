import { Link } from 'react-router'
import button from '../components/Button.module.css'
import styles from './StatusPage.module.css'

interface Props {
  title: string
  message: string
}

function StatusPage({ title, message }: Props) {
  return (
    <section className={`container ${styles.page}`}>
      <title>{`${title} · Eneba Marketplace`}</title>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.text}>{message}</p>
      <Link to="/" className={`${button.button} ${button.primary}`}>
        Back to homepage
      </Link>
    </section>
  )
}

export function ComingSoon({ feature, part }: { feature: string; part: number }) {
  return <StatusPage title={feature} message={`This page is built in Part ${part} of the assignment.`} />
}

export function NotFound() {
  return <StatusPage title="Page not found" message="The page you are looking for does not exist." />
}

export function RouteError() {
  return <StatusPage title="Something went wrong" message="An unexpected error occurred. Please try again." />
}
