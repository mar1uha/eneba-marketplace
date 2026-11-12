// Accessibility scan: runs axe-core (WCAG 2.1 A/AA plus best practices) on the public pages, desktop
// and mobile. Fails on serious or critical violations.
import { createRequire } from 'node:module'
import puppeteer from 'puppeteer-core'
import { BASE, CHROME } from './config.mjs'

const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js')
const pages = ['/', '/store', '/store?q=witcer%20game', '/product/hades', '/cart', '/cart#with-item', '/login', '/register', '/forgot-password', '/no-such-page']
const viewports = {
  desktop: { width: 1366, height: 900 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
const found = new Map()
try {
  for (const [device, viewport] of Object.entries(viewports)) {
    const page = await browser.newPage()
    await page.setViewport(viewport)
    // axe is injected as an inline script, which the site's Content-Security-Policy rightly blocks.
    await page.setBypassCSP(true)
    for (const path of pages) {
      if (path === '/cart#with-item') {
        // A guest cart with one line, so the cart's line controls are scanned too.
        const offer = await page.evaluate(async () => (await (await fetch('/api/products/hades')).json()).offers[0].id)
        await page.evaluate((id) => localStorage.setItem('eneba.cart', JSON.stringify([{ offer_id: id, quantity: 1, added_price_cents: 1 }])), offer)
      }
      await page.goto(BASE + path, { waitUntil: 'networkidle0' })
      await page.addScriptTag({ path: axePath })
      const violations = await page.evaluate(async () => {
        const result = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] })
        return result.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.map((n) => n.target.join(' ')) }))
      })
      for (const v of violations) {
        const key = `${v.impact} ${v.id}: ${v.help}`
        const entry = found.get(key) ?? []
        entry.push(`${device} ${path} (${v.targets.length}x, e.g. ${v.targets[0]})`)
        found.set(key, entry)
      }
      if (path === '/cart#with-item') await page.evaluate(() => localStorage.removeItem('eneba.cart'))
    }
    await page.close()
  }
} finally {
  await browser.close()
}

const order = { critical: 0, serious: 1, moderate: 2, minor: 3 }
const keys = [...found.keys()].sort((a, b) => order[a.split(' ')[0]] - order[b.split(' ')[0]])
for (const key of keys) {
  console.log(key)
  for (const where of found.get(key)) console.log(`    ${where}`)
}
const blocking = keys.filter((k) => k.startsWith('critical') || k.startsWith('serious')).length
console.log(`\n${keys.length} kinds of violations, ${blocking} serious or critical`)
process.exitCode = blocking ? 1 : 0
