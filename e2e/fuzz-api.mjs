// Sends malformed and extreme inputs to every endpoint and reports server errors (5xx).
import { API, restockOrphanedKeys, sql } from './config.mjs'


let cookie = ''
async function call(method, path, body, raw) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  })
  const set = res.headers.get('set-cookie')
  if (set) cookie = set.split(';')[0]
  return { status: res.status, text: await res.text() }
}

const offer = Number(sql(`SELECT o.id FROM offers o JOIN products p ON p.id = o.product_id WHERE p.slug = 'hades' ORDER BY o.price_cents LIMIT 1`))
const big = 9_999_999_999
const cases = [
  ['GET', '/api/products?q=' + encodeURIComponent('a'.repeat(99) + '😀')],
  ['GET', '/api/products?q=' + encodeURIComponent('%_\\\'"; DROP TABLE products; --')],
  ['GET', '/api/products?q=' + encodeURIComponent('\u0000')],
  ['GET', '/api/products?q=' + encodeURIComponent('ÄÖÜ ß ąčęėįšųūž 漢字')],
  ['GET', '/api/products?min_price_cents=99999999999999999999'],
  ['GET', '/api/products?page=1000&page_size=48'],
  ['GET', '/api/products?genre=' + Array.from({ length: 20 }, (_, i) => `g-${i}`).join(',')],
  ['GET', '/api/products/' + encodeURIComponent('x'.repeat(5000))],
  ['GET', '/api/products/%00'],
  ['GET', '/api/search/suggestions?q=' + encodeURIComponent('😀'.repeat(50))],
  ['POST', '/api/cart/quote', { items: [{ offer_id: offer, quantity: 1, added_price_cents: big }] }],
  ['POST', '/api/cart/quote', { items: [{ offer_id: offer, quantity: big }] }],
  ['POST', '/api/cart/quote', { items: [{ offer_id: big * 1000, quantity: 1 }] }],
  ['POST', '/api/cart/quote', { items: [{ offer_id: -1, quantity: -5, added_price_cents: -100 }] }],
  ['POST', '/api/cart/quote', { items: Array.from({ length: 500 }, (_, i) => ({ offer_id: i + 1, quantity: 3 })) }],
  ['POST', '/api/cart/quote', { items: null }],
  ['POST', '/api/cart/quote', undefined, 'not json'],
  ['POST', '/api/cart/quote', { items: [{ offer_id: '1', quantity: 1 }] }],
]
const signedInCases = [
  ['POST', '/api/cart/merge', { items: [{ offer_id: offer, quantity: 1, added_price_cents: big }] }],
  ['POST', '/api/cart/merge', { items: [{ offer_id: offer, quantity: big, added_price_cents: -1 }] }],
  ['POST', '/api/cart/items', { offer_id: offer, quantity: big }],
  ['POST', '/api/cart/items', { offer_id: big * 1000, quantity: 1 }],
  ['PUT', `/api/cart/items/${offer}`, { quantity: 0 }],
  ['PUT', '/api/cart/items/99999999999999999999', { quantity: 1 }],
  ['DELETE', '/api/cart/items/-1'],
  ['POST', '/api/orders/1/pay', { name: 'x'.repeat(10000), number: '4242424242424242', expiry: '12/34', cvc: '123' }],
  ['POST', '/api/orders/1/pay', { name: 'A', number: '٤٢٤٢٤٢٤٢٤٢٤٢٤٢٤٢', expiry: '12/34', cvc: '123' }],
  ['POST', '/api/orders/1/pay', { name: 'A', number: '4242424242424242', expiry: '99/99', cvc: '123' }],
  ['POST', '/api/orders/99999999999999999/keys/1/reveal'],
  ['GET', '/api/orders/9223372036854775807'],
  ['POST', '/api/checkout'],
]

const failures = []
const run = async (list, who) => {
  for (const [method, path, body, raw] of list) {
    const r = await call(method, path, body, raw)
    const line = `${who} ${method} ${path.slice(0, 70)} -> ${r.status}`
    if (r.status >= 500) failures.push(`${line} ${r.text.slice(0, 120)}`)
    console.log(line)
  }
}

await run(cases, 'guest')
const email = `fuzz-${Date.now()}@example.test`
const reg = await call('POST', '/api/auth/register', { email, password: 'correct-horse-battery' })
console.log('register', reg.status)
await run(signedInCases, 'user')
// A cart with an over-limit line, then checkout.
await call('POST', '/api/cart/items', { offer_id: offer, quantity: 1 })
await run([['POST', '/api/checkout']], 'user')
sql(`DELETE FROM users WHERE email = '${email}'`)
restockOrphanedKeys()

console.log(`\n${failures.length} server errors`)
failures.forEach((f) => console.log('  ' + f))
