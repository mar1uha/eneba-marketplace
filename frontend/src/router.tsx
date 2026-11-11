import { createBrowserRouter } from 'react-router'
import { AppLayout } from './components/layout/AppLayout'
import { HomePage } from './features/home/HomePage'
import { ComingSoon, NotFound, RouteError } from './pages/StatusPage'

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'product/:slug', element: <ComingSoon feature="Product page" part={5} /> },
      { path: 'search', element: <ComingSoon feature="Search" part={4} /> },
      { path: 'login', element: <ComingSoon feature="Sign in" part={3} /> },
      { path: 'cart', element: <ComingSoon feature="Cart" part={5} /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])
