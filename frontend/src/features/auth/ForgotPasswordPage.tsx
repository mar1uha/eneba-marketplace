import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { requestPasswordReset } from '../../api/auth'
import button from '../../components/Button.module.css'
import { Field, FormAlert } from '../../components/forms/Field'
import { AuthCard } from './AuthCard'
import styles from './AuthPage.module.css'
import { toFormErrors, type FormErrors } from './useAuth'

export function ForgotPasswordPage() {
  const [errors, setErrors] = useState<FormErrors>({})
  const [sentTo, setSentTo] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: requestPasswordReset,
    onSuccess: (_, email) => setSentTo(email),
    onError: (e) => setErrors(toFormErrors(e)),
  })

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setErrors({})
    mutation.mutate(String(new FormData(e.currentTarget).get('email')))
  }

  const footer = (
    <Link to="/login" className={styles.link}>
      Back to log in
    </Link>
  )

  if (sentTo) {
    return (
      <AuthCard title="Check your email" footer={footer}>
        <div className={styles.form}>
          <FormAlert tone="success">
            If an account exists for {sentTo}, we sent a link to reset your password. It expires in 30 minutes.
          </FormAlert>
          <p className={styles.subtitle}>Demo note: emails are simulated. The reset link is printed in the API server log.</p>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Reset your password" subtitle="Enter your email and we will send you a reset link." footer={footer}>
      <form className={styles.form} onSubmit={onSubmit}>
        {errors.form && <FormAlert>{errors.form}</FormAlert>}
        <Field label="Email" name="email" type="email" autoComplete="email" required error={errors.email} />
        <button type="submit" className={`${button.button} ${button.primary} ${styles.submit}`} disabled={mutation.isPending}>
          {mutation.isPending ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
    </AuthCard>
  )
}
