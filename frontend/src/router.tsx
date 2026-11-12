import { createBrowserRouter, type RouteObject } from 'react-router'
import { AppLayout } from './components/layout/AppLayout'
import { AccountLayout } from './features/account/AccountLayout'
import { OrdersPage } from './features/account/OrdersPage'
import { SecurityPage } from './features/account/SecurityPage'
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage'
import { GuestOnly, RequireAuth } from './features/auth/guards'
import { LoginPage } from './features/auth/LoginPage'
import { RegisterPage } from './features/auth/RegisterPage'
import { ResetPasswordPage } from './features/auth/ResetPasswordPage'
import { HomePage } from './features/home/HomePage'
import { StorePage } from './features/store/StorePage'
import { ComingSoon, NotFound, RouteError } from './pages/StatusPage'

export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'product/:slug', element: <ComingSoon feature="Product page" part={5} /> },
      { path: 'store', element: <StorePage /> },
      { path: 'cart', element: <ComingSoon feature="Cart" part={5} /> },
      { path: 'reset-password', element: <ResetPasswordPage /> },
      {
        element: <GuestOnly />,
        children: [
          { path: 'login', element: <LoginPage /> },
          { path: 'register', element: <RegisterPage /> },
          { path: 'forgot-password', element: <ForgotPasswordPage /> },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            path: 'account',
            element: <AccountLayout />,
            children: [
              { index: true, element: <SecurityPage /> },
              { path: 'orders', element: <OrdersPage /> },
            ],
          },
          { path: 'checkout', element: <ComingSoon feature="Checkout" part={5} /> },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]

export const router = createBrowserRouter(routes)
