// Part 5 browser journey against the running dev stack: search -> product -> guest cart -> register ->
// merged cart -> checkout -> declined card -> paid -> reveal key -> orders; plus expiry, cancel, and mobile.
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { BASE, CHROME, SHOTS, restockOrphanedKeys, sql } from './config.mjs'

fs.mkdirSync(SHOTS, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-first-run', '--disable-extensions'],
})
const consoleErrors = []
const failed = []
const email = `e2e-shop-${Date.now()}@example.test`

async function newPage(viewport) {
  const page = await browser.newPage()
  await page.setViewport(viewport)
  page.on('console', (m) => {
    // The browser logs every non-2xx fetch; the declined card (402) is expected.
    if (m.type() === 'error' && !/status of 402/.test(m.text())) consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(String(e)))
  page.on('response', (r) => r.status() >= 400 && r.status() !== 402 && failed.push(`${r.status()} ${r.url()}`))
  return page
}

const text = (page, sel) => page.$eval(sel, (el) => el.textContent.trim())
const waitText = (page, sel, pattern, timeout = 8000) =>
  page.waitForFunction((s, p) => [...document.querySelectorAll(s)].some((el) => new RegExp(p).test(el.textContent)), { timeout }, sel, pattern.source)
const clickText = async (page, sel, label) => {
  const handle = await page.waitForFunction(
    (s, l) => [...document.querySelectorAll(s)].find((el) => el.textContent.trim() === l && !el.disabled),
    { timeout: 8000 }, sel, label,
  )
  await handle.asElement().click()
}
const cartBadge = (page) => page.$eval('a[href="/cart"]', (a) => a.getAttribute('aria-label'))
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

try {
  const page = await newPage({ width: 1366, height: 900 })
  await page.goto(BASE, { waitUntil: 'networkidle0' })

  // 1. Search from the header, open the product.
  await page.type('#site-search', 'hades')
  await Promise.all([page.waitForFunction(() => location.pathname === '/store'), page.keyboard.press('Enter')])
  await page.waitForSelector('section[aria-label="Products"] a[href="/product/hades"]')
  await Promise.all([page.waitForFunction(() => location.pathname === '/product/hades'), page.click('section[aria-label="Products"] a[href="/product/hades"]')])
  await page.waitForSelector('h1')
  check('product page opens from search', (await text(page, 'h1')) === 'Hades')

  const offersBefore = await page.$$eval('[aria-labelledby="offers-title"] li', (lis) => lis.map((li) => li.textContent))
  const novaStock = Number(sql(`SELECT count(*) FROM digital_keys k JOIN offers o ON o.id = k.offer_id JOIN sellers s ON s.id = o.seller_id JOIN products p ON p.id = o.product_id WHERE p.slug = 'hades' AND s.name = 'NovaKeys' AND k.status = 'available'`))
  check('offers list shows every active offer', offersBefore.length >= 2, `${offersBefore.length} offers, NovaKeys stock ${novaStock}`)
  await page.screenshot({ path: path.join(SHOTS, '10-product.png'), fullPage: true })

  // 2. Edition switcher.
  await Promise.all([page.waitForFunction(() => location.pathname === '/product/hades-nintendo'), page.click('nav[aria-label="Editions"] a[href="/product/hades-nintendo"]')])
  await waitText(page, 'nav[aria-label="Editions"] a[aria-current="page"]', /Nintendo/)
  check('edition switcher opens the Nintendo edition', true)
  await Promise.all([page.waitForFunction(() => location.pathname === '/product/hades'), page.click('nav[aria-label="Editions"] a[href="/product/hades"]')])
  await waitText(page, 'nav[aria-label="Editions"] a[aria-current="page"]', /Steam/)

  // 3. Guest cart: add, then Buy now.
  const bestSeller = await page.$eval('aside[aria-label="Best offer"] strong', (s) => s.textContent)
  await clickText(page, 'aside[aria-label="Best offer"] button', 'Add to cart')
  await waitText(page, 'aside[aria-label="Best offer"] [role="status"]', /Added to cart/)
  check('guest add to cart updates the header', (await cartBadge(page)) === 'Cart, 1 item', await cartBadge(page))
  await Promise.all([page.waitForFunction(() => location.pathname === '/cart'), clickText(page, 'aside[aria-label="Best offer"] button', 'Buy now')])
  await waitText(page, 'aside[aria-label="Order summary"]', /Total/)
  const guestQty = await page.$eval('ul[aria-label="Cart items"] output', (o) => o.textContent)
  check('Buy now adds another key and opens the cart', guestQty === '2', `quantity ${guestQty}, seller ${bestSeller}`)
  check('guest cart lives in the browser', (await page.evaluate(() => localStorage.getItem('eneba.cart'))) !== null)
  await page.screenshot({ path: path.join(SHOTS, '11-guest-cart.png') })

  // 4. Register; the cart follows into the account.
  await Promise.all([page.waitForFunction(() => location.pathname === '/login'), clickText(page, 'a', 'Log in to check out')])
  await page.goto(`${BASE}/register?next=%2Fcart`, { waitUntil: 'networkidle0' })
  await page.type('input[name="email"]', email)
  await page.type('input[name="password"]', 'correct-horse-battery')
  await Promise.all([page.waitForFunction(() => location.pathname === '/cart', { timeout: 10000 }), page.click('form button[type="submit"]')])
  await page.waitForFunction(() => localStorage.getItem('eneba.cart') === null, { timeout: 8000 })
  await waitText(page, 'button', /Continue to payment/)
  const serverQty = sql(`SELECT ci.quantity FROM cart_items ci JOIN users u ON u.id = ci.user_id WHERE u.email = '${email}'`)
  check('guest cart merged into the new account', serverQty === '2', `server quantity ${serverQty}`)

  // 5. Checkout reserves keys.
  await Promise.all([page.waitForFunction(() => location.pathname.startsWith('/checkout/'), { timeout: 10000 }), clickText(page, 'button', 'Continue to payment')])
  const orderId = Number(new URL(page.url()).pathname.split('/').pop())
  await page.waitForSelector('[role="timer"]')
  const timer = await text(page, '[role="timer"]')
  check('checkout shows a 10-minute reservation', /^(10:00|09:[0-5]\d)$/.test(timer), timer)
  const reserved = sql(`SELECT count(*) FROM digital_keys k JOIN order_items oi ON oi.id = k.order_item_id WHERE oi.order_id = ${orderId} AND k.status = 'reserved'`)
  check('two keys reserved in the database', reserved === '2', reserved)
  await page.screenshot({ path: path.join(SHOTS, '12-checkout.png'), fullPage: true })

  // 6. Validation, decline, then success.
  const payLabel = await page.$eval('form button[type="submit"]', (b) => b.textContent)
  await page.click('form button[type="submit"]')
  await waitText(page, 'form', /Enter the name on the card\./)
  check('empty card form shows field errors without paying', sql(`SELECT count(*) FROM payments WHERE order_id = ${orderId}`) === '0')
  await page.type('input[name="cc-name"]', 'Ada Lovelace')
  await clickText(page, 'ul[aria-label="Test cards"] button', '4000 0000 0000 0002')
  await page.type('input[name="cc-exp"]', '1234')
  await page.type('input[name="cc-csc"]', '123')
  check('expiry gets its slash while typing', (await page.$eval('input[name="cc-exp"]', (i) => i.value)) === '12/34')
  await page.click('form button[type="submit"]')
  await waitText(page, '[role="alert"]', /Your card was declined/)
  check('declined card keeps the reservation', sql(`SELECT status FROM orders WHERE id = ${orderId}`) === 'pending' &&
    sql(`SELECT count(*) FROM digital_keys k JOIN order_items oi ON oi.id = k.order_item_id WHERE oi.order_id = ${orderId} AND k.status = 'reserved'`) === '2')
  await page.screenshot({ path: path.join(SHOTS, '13-declined.png'), fullPage: true })

  await page.click('input[name="cc-number"]', { clickCount: 3 })
  await page.type('input[name="cc-number"]', '4242424242424242')
  await Promise.all([page.waitForFunction(() => location.pathname.startsWith('/account/orders/'), { timeout: 10000 }), page.click('form button[type="submit"]')])
  await waitText(page, '[role="status"]', /Payment successful/)
  check('payment succeeds and opens the order', new URL(page.url()).search === '?paid=1', payLabel)
  const masked = await page.$$eval('code', (cs) => cs.map((c) => c.textContent))
  check('two keys delivered, hidden', masked.length === 2 && masked.every((c) => c.includes('•')), masked.join(' | '))
  check('cart emptied after payment', (await cartBadge(page)) === 'Cart', await cartBadge(page))

  await clickText(page, 'button', 'Reveal key')
  await page.waitForFunction(() => [...document.querySelectorAll('code')].some((c) => /^[0-9A-F]{5}-[0-9A-F]{5}-[0-9A-F]{5}$/.test(c.textContent)))
  const revealed = await page.$$eval('code', (cs) => cs.map((c) => c.textContent))
  const dbCode = sql(`SELECT k.code FROM digital_keys k JOIN order_items oi ON oi.id = k.order_item_id WHERE oi.order_id = ${orderId} AND k.revealed_at IS NOT NULL`)
  check('reveal shows the real key and records it', revealed[0] === dbCode && revealed[1].includes('•'), `${revealed[0]} (db ${dbCode})`)
  await page.screenshot({ path: path.join(SHOTS, '14-order.png'), fullPage: true })
  await page.reload({ waitUntil: 'networkidle0' })
  check('revealed key stays visible after reload', (await page.$$eval('code', (cs) => cs[0].textContent)) === dbCode)

  // 7. A repeated payment request charges nothing.
  const repeat = await page.evaluate(async (id) => {
    const r = await fetch(`/api/orders/${id}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ada', number: '4242424242424242', expiry: '12/34', cvc: '123' }) })
    return { status: r.status, body: await r.json() }
  }, orderId)
  check('paying twice is harmless', repeat.status === 200 && repeat.body.status === 'paid' &&
    sql(`SELECT count(*) FROM payments WHERE order_id = ${orderId} AND status = 'succeeded'`) === '1')

  // 8. Order history and the updated stock.
  await page.goto(`${BASE}/account/orders`, { waitUntil: 'networkidle0' })
  const rows = await page.$$eval('a[href^="/account/orders/"]', (as) => as.map((a) => a.textContent))
  check('order history lists the order', rows.length === 1 && /Completed/.test(rows[0]), rows[0])
  await page.goto(`${BASE}/product/hades`, { waitUntil: 'networkidle0' })
  const novaRow = await page.$$eval('[aria-labelledby="offers-title"] li', (lis) => lis.find((li) => li.textContent.includes('NovaKeys'))?.textContent ?? '')
  const expectedAfter = novaStock - 2
  check('stock went down by the keys sold', expectedAfter === 0 ? /Sold out/.test(novaRow) : true, novaRow.slice(0, 60))

  // 9. Reservation expiry and cancel.
  await page.goto(`${BASE}/product/celeste`, { waitUntil: 'networkidle0' })
  await clickText(page, 'aside[aria-label="Best offer"] button', 'Add to cart')
  await waitText(page, 'aside[aria-label="Best offer"] [role="status"]', /Added to cart/)
  await page.goto(`${BASE}/cart`, { waitUntil: 'networkidle0' })
  await Promise.all([page.waitForFunction(() => location.pathname.startsWith('/checkout/'), { timeout: 10000 }), clickText(page, 'button', 'Continue to payment')])
  const order2 = Number(new URL(page.url()).pathname.split('/').pop())
  await page.waitForSelector('[role="timer"]')
  sql(`UPDATE orders SET reserved_until = now() - interval '1 second' WHERE id = ${order2}; UPDATE digital_keys SET reserved_until = now() - interval '1 second' WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = ${order2})`)
  await page.reload({ waitUntil: 'networkidle0' })
  await waitText(page, 'h1', /Your reservation ran out/)
  check('expired reservation is explained', true)
  await Promise.all([page.waitForFunction(() => location.pathname === '/cart'), clickText(page, 'a', 'Back to cart')])
  await Promise.all([page.waitForFunction(() => location.pathname.startsWith('/checkout/'), { timeout: 10000 }), clickText(page, 'button', 'Continue to payment')])
  const order3 = Number(new URL(page.url()).pathname.split('/').pop())
  await page.waitForSelector('[role="timer"]')
  await Promise.all([page.waitForFunction(() => location.pathname === '/cart'), clickText(page, 'button', 'Cancel and return to cart')])
  check('cancel returns the keys', sql(`SELECT status FROM orders WHERE id = ${order3}`) === 'cancelled' &&
    sql(`SELECT count(*) FROM digital_keys k JOIN order_items oi ON oi.id = k.order_item_id WHERE oi.order_id = ${order3} AND k.status = 'reserved'`) === '0')
  check('order history hides cancelled and expired checkouts', (await (async () => {
    await page.goto(`${BASE}/account/orders`, { waitUntil: 'networkidle0' })
    return page.$$eval('a[href^="/account/orders/"]', (as) => as.length)
  })()) === 1)

  // 10. Mobile layouts.
  const mobile = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  await mobile.goto(`${BASE}/product/stardew-valley`, { waitUntil: 'networkidle0' })
  check('mobile product page: no horizontal scroll', await noHorizontalScroll(mobile))
  await mobile.screenshot({ path: path.join(SHOTS, '15-mobile-product.png'), fullPage: true })
  await clickText(mobile, 'aside[aria-label="Best offer"] button', 'Add to cart')
  await mobile.goto(`${BASE}/cart`, { waitUntil: 'networkidle0' })
  await mobile.waitForSelector('ul[aria-label="Cart items"]')
  check('mobile cart: no horizontal scroll', await noHorizontalScroll(mobile))
  await mobile.screenshot({ path: path.join(SHOTS, '16-mobile-cart.png'), fullPage: true })

  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' || '))
  check('no unexpected failed requests', failed.length === 0, failed.slice(0, 3).join(' || '))
} catch (err) {
  check('script ran to the end', false, err.stack)
} finally {
  await browser.close()
  sql(`DELETE FROM users WHERE email = '${email}'`)
  restockOrphanedKeys()
  const bad = results.filter((r) => !r.ok)
  console.log(`\n${results.length - bad.length}/${results.length} passed`)
  process.exitCode = bad.length ? 1 : 0
}
