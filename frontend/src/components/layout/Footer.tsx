import styles from './Footer.module.css'

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.inner}`}>
        <p>Eneba Marketplace · Intern Assignment 2027 demo. No real payments are taken. Prices in EUR.</p>
        <p>Game artwork belongs to its publishers and is served from Steam&apos;s public CDN.</p>
      </div>
    </footer>
  )
}
