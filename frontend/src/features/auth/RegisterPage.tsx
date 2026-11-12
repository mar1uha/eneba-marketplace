import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { register } from '../../api/auth'
import button from '../../components/Button.module.css'
import { Field, FormAlert } from '../../components/forms/Field'
import { AuthCard, GoogleSignIn } from './AuthCard'
import styles from './AuthPage.module.css'
import { safeNext, toFormErrors, useSetUser, type FormErrors } from './useAuth'

export function RegisterPage() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const setUser = useSetUser()
  const [errors, setErrors] = useState<FormErrors>({})
  const mutation = useMutation({ mutationFn: register, onSuccess: setUser, onError: (e) => setErrors(toFormErrors(e)) })

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setErrors({})
    const form = new FormData(e.currentTarget)
    mutation.mutate({ email: String(form.get('email')), password: String(form.get('password')) })
  }

  const carry = params.get('next') ? `?next=${encodeURIComponent(next)}` : ''

  return (
    <AuthCard
      title="Create an account"
      subtitle="Buy games for less and keep every key in one place."
      footer={
        <>
          Already have an account?{' '}
          <Link to={`/login${carry}`} className={styles.link}>
            Log in
          </Link>
        </>
      }
    >
      <form className={styles.form} onSubmit={onSubmit}>
        {errors.form && <FormAlert>{errors.form}</FormAlert>}
        <Field label="Email" name="email" type="email" autoComplete="email" required error={errors.email} />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
          hint="At least 8 characters."
          error={errors.password}
        />
        <button type="submit" className={`${button.button} ${button.primary} ${styles.submit}`} disabled={mutation.isPending}>
          {mutation.isPending ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <GoogleSignIn next={next} />
    </AuthCard>
  )
}
