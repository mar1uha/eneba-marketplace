// Browser checks for Part 4 (store + search) against the running dev stack (Vite :5173 -> API :8080).
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { BASE, CHROME, RESULTS, SHOTS } from './config.mjs'

fs.mkdirSync(SHOTS, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-first-run', '--disable-extensions'],
})

const consoleErrors = []
const failedRequests = []

async function newPage(viewport) {
  const page = await browser.newPage()
  await page.setViewport(viewport)
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  page.on('pageerror', (e) => consoleErrors.push(String(e)))
  page.on('requestfailed', (r) => {
    // Aborted fetches are expected: React Query cancels superseded requests.
    if (r.failure()?.errorText !== 'net::ERR_ABORTED') failedRequests.push(`${r.failure()?.errorText} ${r.url()}`)
  })
  page.on('response', (r) => r.status() >= 400 && failedRequests.push(`${r.status()} ${r.url()}`))
  page.apiInflight = new Set()
  page.on('request', (r) => new URL(r.url()).pathname.startsWith('/api/') && page.apiInflight.add(r))
  const done = (r) => page.apiInflight.delete(r)
  page.on('requestfinished', done)
  page.on('requestfailed', done)
  return page
}

const text = (page, sel) => page.$eval(sel, (el) => el.textContent.trim())
const waitText = (page, sel, pattern, timeout = 5000) =>
  page.waitForFunction(
    (s, p) => [...document.querySelectorAll(s)].some((el) => new RegExp(p).test(el.textContent)),
    { timeout },
    sel,
    pattern.source ?? pattern,
  )
const url = (page) => new URL(page.url())
const cardPrices = (page) =>
  page.$$eval(`${RESULTS} ul[aria-busy] > li > a`, (cards) =>
    cards.map((c) => Number(c.querySelector('p:nth-of-type(2)').textContent.replace(/[^\d.,]/g, '').replace(',', '.'))),
  )
const cardTitles = (page) => page.$$eval(`${RESULTS} ul[aria-busy] > li > a h3`, (hs) => hs.map((h) => h.textContent))
const cardHrefs = (page) => page.$$eval(`${RESULTS} ul[aria-busy] > li > a`, (as) => as.map((a) => a.getAttribute('href')))
// Waits until no API request has been in flight for 250 ms, then for React to render the result.
async function settle(page, timeout = 10000) {
  const start = Date.now()
  let quietSince = Date.now()
  while (Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, 50))
    if (page.apiInflight.size > 0) quietSince = Date.now()
    else if (Date.now() - quietSince >= 250) {
      await page.waitForFunction(() => document.querySelector('ul[aria-busy]')?.getAttribute('aria-busy') !== 'true', { timeout: 2000 }).catch(() => {})
      return
    }
  }
  throw new Error('API still busy: ' + [...page.apiInflight].map((r) => r.url()).join(', '))
}
const brokenImages = (page) =>
  page.$$eval('img', (imgs) => imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src))

try {
  // ---------- Desktop ----------
  const page = await newPage({ width: 1366, height: 900 })
  await page.goto(BASE, { waitUntil: 'networkidle0' })

  // 1. Live suggestions with a typo, keyboard navigation into a product.
  await page.click('#site-search')
  await page.type('#site-search', 'cyberpnk', { delay: 30 })
  await page.waitForSelector('[role="listbox"] [role="option"]', { visible: true })
  const options = await page.$$eval('[role="listbox"] [role="option"]', (os) => os.map((o) => o.textContent))
  check('suggestions appear for a typo (cyberpnk)', options[0]?.includes('Cyberpunk 2077') && options.at(-1).startsWith('See all 2 results'), options.join(' | '))
  await page.screenshot({ path: path.join(SHOTS, '01-suggestions.png') })
  await page.keyboard.press('ArrowDown')
  const activeId = await page.$eval('#site-search', (i) => i.getAttribute('aria-activedescendant'))
  const selected = await page.$eval('[role="option"][aria-selected="true"]', (o) => o.id)
  check('ArrowDown highlights the first suggestion', activeId && activeId === selected)
  await Promise.all([page.waitForFunction(() => location.pathname.startsWith('/product/')), page.keyboard.press('Enter')])
  check('Enter opens the highlighted product', url(page).pathname === '/product/cyberpunk-2077', url(page).pathname)
  check('search box clears after opening a product', (await page.$eval('#site-search', (i) => i.value)) === '')

  // 2. Enter without a highlight opens the Store, from any page.
  await page.type('#site-search', 'witcher')
  await page.waitForSelector('[role="listbox"] [role="option"]', { visible: true })
  await Promise.all([page.waitForFunction(() => location.pathname === '/store'), page.keyboard.press('Enter')])
  await waitText(page, 'h1', /Results for “witcher”/)
  await waitText(page, 'h1 + p', /^2 results$/)
  check('Enter searches the Store from another page', url(page).search === '?q=witcher')
  check('Store search box shows the query', (await page.$eval('#site-search', (i) => i.value)) === 'witcher')
  check('suggestions closed after search', (await page.$eval('#site-search', (i) => i.getAttribute('aria-expanded'))) === 'false')

  // 3. Did you mean.
  await page.click('#site-search', { count: 3 })
  await page.type('#site-search', 'witcher game')
  await Promise.all([page.waitForFunction(() => location.search.includes('game')), page.keyboard.press('Enter')])
  await waitText(page, 'h2', /No results for “witcher game”/)
  const dym = await text(page, `${RESULTS} [role="status"] a`)
  check('did you mean shows the closest title', dym === 'The Witcher 3: Wild Hunt', dym)
  await page.screenshot({ path: path.join(SHOTS, '02-did-you-mean.png') })
  await page.click(`${RESULTS} [role="status"] a`)
  await waitText(page, 'h1 + p', /^2 results$/)
  check('did you mean link runs that search', (await cardTitles(page)).every((t) => t === 'The Witcher 3: Wild Hunt'))

  // 4. Browse nav to a platform.
  await Promise.all([page.waitForFunction(() => location.search === '?platform=nintendo'), page.click('nav[aria-label="Browse"] a[href="/store?platform=nintendo"]')])
  await waitText(page, 'h1 + p', /^7 products$/)
  const nintendoChecked = await page.$$eval('aside input[type="checkbox"]', (cs) => cs.filter((c) => c.checked).map((c) => c.closest('label').textContent))
  check('browse link filters by platform', nintendoChecked.length === 1 && nintendoChecked[0].startsWith('Nintendo'), nintendoChecked.join(','))
  check('browse link marked current', (await page.$eval('nav[aria-label="Browse"] a[aria-current="page"]', (a) => a.textContent)) === 'Nintendo')
  await page.screenshot({ path: path.join(SHOTS, '03-nintendo.png'), fullPage: true })

  // 5. Filters: genre (collapsed list) + price; counts and results agree.
  await page.goto(`${BASE}/store`, { waitUntil: 'networkidle0' })
  await waitText(page, 'h1 + p', /^155 products$/)
  const [showAll] = await page.$$('xpath/.//button[starts-with(normalize-space(), "Show all")]')
  await showAll.click()
  const roguelike = await page.$('xpath/.//label[.//span[text()="Roguelike"]]')
  const roguelikeCount = Number(await roguelike.$eval('span:last-child', (s) => s.textContent))
  await roguelike.scrollIntoView()
  const scrollBefore = await page.evaluate(() => window.scrollY)
  await roguelike.click()
  await page.waitForFunction(() => location.search === '?genre=roguelike')
  await settle(page)
  await waitText(page, 'h1 + p', new RegExp(`^${roguelikeCount} products$`))
  check('genre filter count matches its facet count', true, `${roguelikeCount} roguelikes`)
  check('filter change keeps the scroll position', (await page.evaluate(() => window.scrollY)) === scrollBefore, `scrollY ${await page.evaluate(() => window.scrollY)}`)
  const [maxInput] = await page.$$('xpath/.//label[span[text()="Max €"]]/input')
  await maxInput.type('15')
  await page.click('aside form button[type="submit"]')
  await page.waitForFunction(() => location.search === '?genre=roguelike&max_price=15')
  await settle(page)
  const cheapPrices = await cardPrices(page)
  check('max price filter applies to every card', cheapPrices.length > 0 && cheapPrices.every((p) => p <= 15), cheapPrices.join(','))
  const chips = await page.$$eval('ul[aria-label="Active filters"] button', (bs) => bs.map((b) => b.textContent))
  check('active filter chips', chips.includes('Roguelike×') && chips.includes('Up to €15.00×') && chips.includes('Clear all'), chips.join(' | '))
  await page.screenshot({ path: path.join(SHOTS, '04-filters.png'), fullPage: true })

  // 6. Back undoes the price filter.
  await page.goBack()
  await page.waitForFunction(() => location.search === '?genre=roguelike')
  await settle(page)
  check('Back undoes the last filter', (await page.$$eval('ul[aria-label="Active filters"] button', (bs) => bs.length)) === 2)

  // 7. Sort by price.
  await page.select('select', 'price_asc')
  await page.waitForFunction(() => location.search.includes('sort=price_asc'))
  await settle(page)
  const asc = await cardPrices(page)
  check('price low to high is sorted', asc.every((p, i) => i === 0 || p >= asc[i - 1]), asc.slice(0, 6).join(','))

  // 8. Pagination with Back.
  await page.goto(`${BASE}/store?sort=price_desc`, { waitUntil: 'networkidle0' })
  const page1 = await cardHrefs(page)
  const page1LastPrice = (await cardPrices(page)).at(-1)
  const lastPageLabel = await page.$$eval('nav[aria-label="Pagination"] a[aria-label^="Page "]', (as) => as.at(-1).textContent)
  check('155 products make 7 pages', lastPageLabel === '7', lastPageLabel)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await Promise.all([page.waitForFunction(() => location.search.includes('page=2')), page.click('nav[aria-label="Pagination"] a[aria-label="Page 2"]')])
  await settle(page)
  const page2 = await cardHrefs(page)
  check('page 2 shows 24 different products', page2.length === 24 && !page2.some((h) => page1.includes(h)))
  check('page change scrolls to the top', (await page.evaluate(() => window.scrollY)) === 0)
  const page2First = (await cardPrices(page))[0]
  check('pages continue the sort order', page2First <= page1LastPrice, `page 1 ends ${page1LastPrice}, page 2 starts ${page2First}`)
  await page.goBack()
  await page.waitForFunction(() => !location.search.includes('page=2'))
  await settle(page)
  check('Back returns to page 1', JSON.stringify(await cardHrefs(page)) === JSON.stringify(page1))

  // 9. Typo + spacing search straight from a URL.
  await page.goto(`${BASE}/store?q=assasins%20creed`, { waitUntil: 'networkidle0' })
  check('typo search from URL', (await text(page, 'h1 + p')) === '4 results')
  await page.goto(`${BASE}/store?q=cyber%20punk`, { waitUntil: 'networkidle0' })
  check('split-word search from URL', (await cardTitles(page))[0] === 'Cyberpunk 2077')

  // 10. Images.
  await page.goto(`${BASE}/store?page=3`, { waitUntil: 'networkidle0' })
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 60))
    }
  })
  await settle(page)
  const broken = await brokenImages(page)
  check('no broken cover images', broken.length === 0, broken.join(', '))
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: path.join(SHOTS, '05-store-page3.png'), fullPage: true })

  // ---------- Mobile ----------
  const mobile = await newPage({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  await mobile.goto(`${BASE}/store`, { waitUntil: 'networkidle0' })
  const sidebarVisible = () => mobile.$eval('aside[aria-label="Filters"]', (a) => getComputedStyle(a).display !== 'none')
  check('mobile: filters hidden behind a button', !(await sidebarVisible()))
  check('mobile: no horizontal scroll', await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await mobile.screenshot({ path: path.join(SHOTS, '06-mobile-store.png') })
  await mobile.click('button[aria-controls]')
  check('mobile: Filters opens the panel', await sidebarVisible())
  const steam = await mobile.$('xpath/.//label[.//span[text()="Steam"]]')
  await steam.click()
  await mobile.waitForFunction(() => location.search === '?platform=steam')
  await settle(mobile)
  await mobile.screenshot({ path: path.join(SHOTS, '07-mobile-filters.png') })
  const showLabel = await mobile.$eval('aside > div:last-child button', (b) => b.textContent)
  check('mobile: panel button shows the new count', /^Show \d+ results$/.test(showLabel), showLabel)
  await mobile.click('aside > div:last-child button')
  check('mobile: panel closes', !(await sidebarVisible()))
  check('mobile: Filters button shows active count', (await mobile.$eval('button[aria-controls]', (b) => b.textContent)) === 'Filters (1)')
  check('mobile: focus returns to the Filters button', await mobile.evaluate(() => document.activeElement?.hasAttribute('aria-controls')))

  await mobile.click('#site-search')
  await mobile.type('#site-search', 'hades')
  await mobile.waitForSelector('[role="listbox"] [role="option"]', { visible: true })
  const popup = await mobile.$eval('[role="listbox"]', (l) => l.parentElement.getBoundingClientRect().toJSON())
  check('mobile: suggestions fit the screen', popup.left >= 0 && popup.right <= 390, JSON.stringify({ l: popup.left, r: popup.right }))
  await mobile.screenshot({ path: path.join(SHOTS, '08-mobile-suggestions.png') })
  await mobile.keyboard.press('Escape')
  check('mobile: Escape closes suggestions', !(await mobile.$eval('[role="listbox"]', (l) => l.offsetParent !== null)))

  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' || '))
  check('no failed requests', failedRequests.length === 0, failedRequests.slice(0, 3).join(' || '))
} catch (err) {
  check('script ran to the end', false, err.stack)
} finally {
  await browser.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exitCode = failed.length ? 1 : 0
}
