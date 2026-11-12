import { createBrowserRouter, type RouteObject } from 'react-router'
import { AppLayout } from './components/layout/AppLayout'
import { AccountLayout } from './features/account/AccountLayout'
import { OrderPage } from './features/account/OrderPage'
import { OrdersPage } from './features/account/OrdersPage'
import { SecurityPage } from './features/account/SecurityPage'
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage'
import { GuestOnly, RequireAuth } from './features/auth/guards'
import { LoginPage } from './features/auth/LoginPage'
import { RegisterPage } from './features/auth/RegisterPage'
import { ResetPasswordPage } from './features/auth/ResetPasswordPage'
import { CartPage } from './features/cart/CartPage'
import { CheckoutPage } from './features/checkout/CheckoutPage'
import { HomePage } from './features/home/HomePage'
import { ProductPage } from './features/product/ProductPage'
import { StorePage } from './features/store/StorePage'
import { NotFound, RouteError } from './pages/StatusPage'

export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'product/:slug', element: <ProductPage /> },
      { path: 'store', element: <StorePage /> },
      { path: 'cart', element: <CartPage /> },
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
              { path: 'orders/:orderId', element: <OrderPage /> },
            ],
          },
          { path: 'checkout/:orderId', element: <CheckoutPage /> },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]

export const router = createBrowserRouter(routes)
