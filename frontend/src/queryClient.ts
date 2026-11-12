import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { ApiError } from './api/client'
import { accountQueryKey, meQueryKey } from './features/auth/useAuth'

export function createQueryClient() {
  // A 401 means the session ended elsewhere (signed out on another device, password reset).
  // Clearing the stored user makes protected pages redirect to sign-in.
  const onApiError = (error: Error) => {
    if (error instanceof ApiError && error.status === 401) {
      client.removeQueries({ queryKey: accountQueryKey })
      client.setQueryData(meQueryKey, null)
    }
  }

  const client = new QueryClient({
    queryCache: new QueryCache({ onError: onApiError }),
    mutationCache: new MutationCache({ onError: onApiError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Client errors will not fix themselves; only retry network and server failures.
        retry: (failures, error) => failures < 1 && !(error instanceof ApiError && error.status < 500),
      },
    },
  })
  return client
}
