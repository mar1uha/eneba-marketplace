import { useEffect, useState } from 'react'
import { getHealth, type Health } from './api/health'

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; health: Health }
  | { kind: 'error'; message: string }

export default function App() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    const ctrl = new AbortController()
    getHealth(ctrl.signal)
      .then((health) => setState({ kind: 'ok', health }))
      .catch((err: Error) => {
        if (err.name !== 'AbortError') setState({ kind: 'error', message: err.message })
      })
    return () => ctrl.abort()
  }, [])

  return (
    <main className="hello">
      <h1>Eneba Marketplace</h1>
      <p>React + TypeScript frontend</p>
      {state.kind === 'loading' && <p>Checking API…</p>}
      {state.kind === 'ok' && (
        <p data-testid="health" className={state.health.status === 'ok' ? undefined : 'error'}>
          API: {state.health.status} · Database: {state.health.db}
        </p>
      )}
      {state.kind === 'error' && <p className="error">API unreachable: {state.message}</p>}
    </main>
  )
}
