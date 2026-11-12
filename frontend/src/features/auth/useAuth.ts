import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { fetchMe, logout, type User } from '../../api/auth'
import { ApiError } from '../../api/client'

export const meQueryKey = ['me'] as const
/** Every query that holds one user's private data lives under this key, so sign-in changes can wipe it. */
export const accountQueryKey = ['account'] as const

export function useMe() {
  return useQuery({ queryKey: meQueryKey, queryFn: ({ signal }) => fetchMe(signal), staleTime: 5 * 60_000 })
}

/** Stores the newly signed-in (or signed-out) user and drops the previous user's cached data. */
export function useSetUser() {
  const queryClient = useQueryClient()
  return (user: User | null) => {
    queryClient.removeQueries({ queryKey: accountQueryKey })
    queryClient.setQueryData(meQueryKey, user)
  }
}

export function useSignOut() {
  const setUser = useSetUser()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: logout,
    // Leave first: clearing the user while still on a protected page would make RequireAuth redirect
    // to /login?next=... instead of the homepage. flushSync commits the navigation right away;
    // otherwise the router renders it in a transition and the protected page can still be mounted.
    onSettled: async () => {
      await navigate('/', { flushSync: true })
      setUser(null)
    },
  })
}

/** Only same-site paths are allowed after sign-in, so ?next= cannot send users to another website. */
export function safeNext(next: string | null, fallback = '/'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback
  return next
}

export type FormErrors = Partial<Record<string, string>> & { form?: string }

export function toFormErrors(error: unknown): FormErrors {
  if (error instanceof ApiError) {
    if (error.field) return { [error.field]: error.message }
    if (error.status < 500) return { form: error.message }
  }
  return { form: 'Something went wrong. Please try again.' }
}
