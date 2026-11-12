import '@fontsource/metropolis/400.css'
import '@fontsource/metropolis/600.css'
import '@fontsource/metropolis/700.css'
import '@fontsource/metropolis/800.css'
import './styles/tokens.css'
import './styles/global.css'

import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The react-router/dom provider supports `flushSync` navigations (sign-out relies on it).
import { RouterProvider } from 'react-router/dom'
import { createQueryClient } from './queryClient'
import { router } from './router'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
