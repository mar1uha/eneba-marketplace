// Sends NUL bytes and invalid UTF-8 in text inputs; every answer must be a clear 4xx, never a 500.
import { API } from './config.mjs'

const nul = '\u0000'
const cases = [
  ['GET', '/api/products?q=' + encodeURIComponent('hades' + nul)],
  ['GET', '/api/search/suggestions?q=' + encodeURIComponent('ha' + nul + 'des')],
  ['GET', '/api/products?genre=' + encodeURIComponent('rpg' + nul)],
  ['GET', '/api/products?q=a%ff%fe'],
  ['GET', '/api/search/suggestions?q=ab%c3%28'],
  ['GET', '/api/products/%00'],
  ['POST', '/api/auth/register', { email: `a${nul}b@example.test`, password: 'correct-horse-battery' }],
  ['POST', '/api/auth/login', { email: `a${nul}b@example.test`, password: 'x' }],
  ['POST', '/api/auth/login', { email: 'ada@example.test', password: `pass${nul}word` }],
  ['POST', '/api/auth/password-reset/request', { email: `a${nul}@example.test` }],
  ['POST', '/api/auth/password-reset/confirm', { token: `t${nul}`, password: 'correct-horse-battery' }],
  ['GET', '/api/auth/google/start?next=' + encodeURIComponent('/' + nul)],
]
let serverErrors = 0
for (const [method, path, body] of cases) {
  const res = await fetch(API + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  })
  if (res.status >= 500) serverErrors++
  console.log(`${res.status >= 500 ? 'SERVER ERROR' : 'ok          '} ${res.status} ${method} ${path.slice(0, 60)}`)
}
console.log(`\n${serverErrors} server errors`)
process.exitCode = serverErrors ? 1 : 0
