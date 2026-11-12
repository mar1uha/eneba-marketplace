import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { confirmPasswordReset } from '../../api/auth'
import button from '../../components/Button.module.css'
import { Field, FormAlert } from '../../components/forms/Field'
import { AuthCard } from './AuthCard'
import styles from './AuthPage.module.css'
import { toFormErrors, useSetUser, type FormErrors } from './useAuth'

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const setUser = useSetUser()
  const [errors, setErrors] = useState<FormErrors>({})
  const mutation = useMutation({
    mutationFn: (password: string) => confirmPasswordReset(token, password),
    onSuccess: (user) => {
      setUser(user)
      navigate('/account', { replace: true, state: { notice: 'Your password has been reset. All other devices were signed out.' } })
    },
    onError: (e) => setErrors(toFormErrors(e)),
  })

  const requestNew = (
    <Link to="/forgot-password" className={styles.link}>
      Request a new link
    </Link>
  )

  if (!token) {
    return (
      <AuthCard title="Reset link missing" footer={requestNew}>
        <div className={styles.form}>
          <FormAlert>This page needs the link from the reset email.</FormAlert>
        </div>
      </AuthCard>
    )
  }

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const password = String(form.get('password'))
    if (password !== String(form.get('confirm'))) {
      setErrors({ confirm: 'Passwords do not match.' })
      return
    }
    setErrors({})
    mutation.mutate(password)
  }

  return (
    <AuthCard title="Choose a new password" subtitle="You will be signed out everywhere else." footer={requestNew}>
      <form className={styles.form} onSubmit={onSubmit}>
        {errors.form && <FormAlert>{errors.form}</FormAlert>}
        <Field
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
          hint="At least 8 characters."
          error={errors.password}
        />
        <Field label="Repeat new password" name="confirm" type="password" autoComplete="new-password" required error={errors.confirm} />
        <button type="submit" className={`${button.button} ${button.primary} ${styles.submit}`} disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Set new password'}
        </button>
      </form>
    </AuthCard>
  )
}
