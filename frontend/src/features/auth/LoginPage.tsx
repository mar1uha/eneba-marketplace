import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { login } from '../../api/auth'
import button from '../../components/Button.module.css'
import { Field, FormAlert } from '../../components/forms/Field'
import { AuthCard, GoogleSignIn } from './AuthCard'
import styles from './AuthPage.module.css'
import { safeNext, toFormErrors, useSetUser, type FormErrors } from './useAuth'

const googleErrors: Record<string, string> = {
  google: 'Google sign-in failed. Please try again.',
  google_cancelled: 'Google sign-in was cancelled.',
  google_unverified: 'Your Google email address is not verified, so it cannot be used to sign in.',
  google_conflict: 'This email is already linked to a different Google account.',
}

export function LoginPage() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const setUser = useSetUser()
  const [errors, setErrors] = useState<FormErrors>({})
  // GuestOnly redirects to `next` once the user is stored.
  const mutation = useMutation({ mutationFn: login, onSuccess: setUser, onError: (e) => setErrors(toFormErrors(e)) })

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setErrors({})
    const form = new FormData(e.currentTarget)
    mutation.mutate({ email: String(form.get('email')), password: String(form.get('password')) })
  }

  const formError = errors.form ?? googleErrors[params.get('error') ?? '']
  const carry = params.get('next') ? `?next=${encodeURIComponent(next)}` : ''

  return (
    <AuthCard
      title="Log in"
      subtitle="Welcome back. Sign in to check out and see your orders."
      footer={
        <>
          New to Eneba?{' '}
          <Link to={`/register${carry}`} className={styles.link}>
            Create an account
          </Link>
        </>
      }
    >
      <form className={styles.form} onSubmit={onSubmit}>
        {formError && <FormAlert>{formError}</FormAlert>}
        <Field label="Email" name="email" type="email" autoComplete="email" required error={errors.email} />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required error={errors.password} />
        <Link to="/forgot-password" className={`${styles.link} ${styles.forgot}`}>
          Forgot password?
        </Link>
        <button type="submit" className={`${button.button} ${button.primary} ${styles.submit}`} disabled={mutation.isPending}>
          {mutation.isPending ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <GoogleSignIn next={next} />
    </AuthCard>
  )
}
