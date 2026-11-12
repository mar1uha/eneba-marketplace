// Fires N sign-in attempts at once (unknown emails still run a full argon2id verification).
import { API } from './config.mjs'
const n = Number(process.argv[2] ?? 60)
const start = Date.now()
const statuses = await Promise.all(
  Array.from({ length: n }, (_, i) =>
    fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `burst-${i}-${start}@example.test`, password: 'wrong-password-123' }),
    }).then((r) => r.status, (e) => `error ${e.cause?.code ?? e.message}`),
  ),
)
const counts = {}
for (const s of statuses) counts[s] = (counts[s] ?? 0) + 1
console.log(`${n} sign-ins in ${Date.now() - start} ms: ${JSON.stringify(counts)}`)
