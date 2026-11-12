import { Outlet, ScrollRestoration } from 'react-router'
import { CartSync } from '../../features/cart/CartSync'
import { Footer } from './Footer'
import { Header } from './Header'
import styles from './AppLayout.module.css'

export function AppLayout() {
  return (
    <div className={styles.app}>
      <Header />
      <main className={styles.main}>
        <Outlet />
      </main>
      <Footer />
      <ScrollRestoration />
      <CartSync />
    </div>
  )
}
