import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useLocation } from 'react-router'
import { changePassword, fetchSessions, revokeOtherSessions, revokeSession, type SessionInfo, type User } from '../../api/auth'
import button from '../../components/Button.module.css'
import { Field, FormAlert } from '../../components/forms/Field'
import { describeUserAgent, formatDate, formatRelative } from '../../lib/dates'
import { accountQueryKey, meQueryKey, toFormErrors, useMe, type FormErrors } from '../auth/useAuth'
import styles from './Account.module.css'

const sessionsKey = [...accountQueryKey, 'sessions']

export function SecurityPage() {
  const { data: user } = useMe()
  const location = useLocation()
  const notice = (location.state as { notice?: string } | null)?.notice
  if (!user) return null

  return (
    <>
      <title>Account &amp; security · Eneba Marketplace</title>
      <h1 className={styles.heading}>Account &amp; security</h1>
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      <ProfilePanel user={user} />
      <PasswordPanel user={user} />
      <SessionsPanel />
    </>
  )
}

function ProfilePanel({ user }: { user: User }) {
  return (
    <section className={styles.panel} aria-labelledby="profile-title">
      <h2 id="profile-title" className={styles.panelTitle}>
        Profile
      </h2>
      <dl className={styles.details}>
        <dt>Name</dt>
        <dd>{user.display_name}</dd>
        <dt>Email</dt>
        <dd>{user.email}</dd>
        <dt>Member since</dt>
        <dd>{formatDate(user.created_at)}</dd>
        <dt>Sign-in methods</dt>
        <dd>
          <span className={user.has_password ? styles.on : styles.off}>Password {user.has_password ? 'set' : 'not set'}</span>
          <span className={user.google_linked ? styles.on : styles.off}>Google {user.google_linked ? 'linked' : 'not linked'}</span>
        </dd>
      </dl>
    </section>
  )
}

function PasswordPanel({ user }: { user: User }) {
  const queryClient = useQueryClient()
  const [errors, setErrors] = useState<FormErrors>({})
  const [saved, setSaved] = useState(false)
  const mutation = useMutation({
    mutationFn: ({ current, next }: { current: string; next: string }) => changePassword(current, next),
    onSuccess: () => {
      setSaved(true)
      void queryClient.invalidateQueries({ queryKey: meQueryKey })
      void queryClient.invalidateQueries({ queryKey: sessionsKey })
    },
    onError: (e) => setErrors(toFormErrors(e)),
  })

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formEl = e.currentTarget
    const form = new FormData(formEl)
    setErrors({})
    setSaved(false)
    mutation.mutate(
      { current: String(form.get('current_password') ?? ''), next: String(form.get('new_password')) },
      { onSuccess: () => formEl.reset() },
    )
  }

  return (
    <section className={styles.panel} aria-labelledby="password-title">
      <h2 id="password-title" className={styles.panelTitle}>
        {user.has_password ? 'Change password' : 'Set a password'}
      </h2>
      {!user.has_password && (
        <p className={styles.muted}>You sign in with Google. Add a password to also sign in with your email.</p>
      )}
      <form className={styles.form} onSubmit={onSubmit}>
        {saved && <FormAlert tone="success">Password saved. Your other devices were signed out.</FormAlert>}
        {errors.form && <FormAlert>{errors.form}</FormAlert>}
        {user.has_password && (
          <Field
            label="Current password"
            name="current_password"
            type="password"
            autoComplete="current-password"
            required
            error={errors.current_password}
          />
        )}
        <Field
          label="New password"
          name="new_password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
          hint="At least 8 characters. Other devices will be signed out."
          error={errors.new_password}
        />
        <button type="submit" className={`${button.button} ${button.primary} ${styles.formButton}`} disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </section>
  )
}

function SessionsPanel() {
  const queryClient = useQueryClient()
  const { data: sessions, isPending, isError } = useQuery({ queryKey: sessionsKey, queryFn: ({ signal }) => fetchSessions(signal) })
  const refresh = () => void queryClient.invalidateQueries({ queryKey: sessionsKey })
  const revokeOne = useMutation({ mutationFn: revokeSession, onSuccess: refresh })
  const revokeOthers = useMutation({ mutationFn: revokeOtherSessions, onSuccess: refresh })
  const others = sessions?.filter((s) => !s.current).length ?? 0

  return (
    <section className={styles.panel} aria-labelledby="sessions-title">
      <div className={styles.panelHead}>
        <h2 id="sessions-title" className={styles.panelTitle}>
          Where you&apos;re signed in
        </h2>
        {others > 0 && (
          <button
            type="button"
            className={`${button.button} ${button.outline}`}
            onClick={() => revokeOthers.mutate()}
            disabled={revokeOthers.isPending}
          >
            Sign out all other devices
          </button>
        )}
      </div>
      {isPending && <p className={styles.muted}>Loading sessions…</p>}
      {isError && <FormAlert>Could not load your sessions.</FormAlert>}
      {sessions && (
        <ul className={styles.sessions}>
          {sessions.map((s) => (
            <SessionRow key={s.id} session={s} onRevoke={() => revokeOne.mutate(s.id)} revoking={revokeOne.isPending && revokeOne.variables === s.id} />
          ))}
        </ul>
      )}
    </section>
  )
}

function SessionRow({ session, onRevoke, revoking }: { session: SessionInfo; onRevoke: () => void; revoking: boolean }) {
  return (
    <li className={styles.session}>
      <div>
        <p className={styles.device}>
          {describeUserAgent(session.user_agent)}
          {session.current && <span className={styles.badge}>This device</span>}
        </p>
        <p className={styles.muted}>
          {session.ip || 'Unknown IP'} · Signed in {formatDate(session.created_at)} · Active {formatRelative(session.last_seen_at)}
        </p>
      </div>
      {!session.current && (
        <button type="button" className={styles.textButton} onClick={onRevoke} disabled={revoking}>
          Sign out
        </button>
      )}
    </li>
  )
}
