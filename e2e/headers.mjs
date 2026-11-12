// Checks the security headers the deployed site sends (run with BASE set to the live URL; the Vite
// dev server does not apply vercel.json).
import { BASE } from './config.mjs'

const problems = []
const expect = (where, headers, name, test, want) => {
  const value = headers.get(name)
  if (!value || !test(value)) problems.push(`${where}: ${name} is ${value === null ? 'missing' : `"${value}"`}; want ${want}`)
}

for (const path of ['/', '/checkout/1', '/account']) {
  const res = await fetch(BASE + path)
  const h = res.headers
  expect(path, h, 'content-security-policy', (v) => v.includes("frame-ancestors 'none'") && v.includes("default-src 'self'"), "a CSP with default-src 'self' and frame-ancestors 'none'")
  expect(path, h, 'x-frame-options', (v) => v === 'DENY', 'DENY')
  expect(path, h, 'x-content-type-options', (v) => v === 'nosniff', 'nosniff')
  expect(path, h, 'referrer-policy', (v) => v === 'strict-origin-when-cross-origin' || v === 'no-referrer', 'a strict referrer policy')
}
for (const path of ['/api/auth/me', '/api/products/hades']) {
  const res = await fetch(BASE + path)
  expect(path, res.headers, 'cache-control', (v) => v.includes('no-store') && !v.includes('public'), 'no-store (personal data)')
  expect(path, res.headers, 'x-content-type-options', (v) => v === 'nosniff', 'nosniff')
}

problems.forEach((p) => console.log('FAIL  ' + p))
console.log(problems.length ? `\n${problems.length} header problems` : 'all security headers present')
process.exitCode = problems.length ? 1 : 0
