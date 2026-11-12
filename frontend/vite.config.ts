import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// The security headers Vercel sends in production (vercel.json). `npm run preview` sends them too, so
// the e2e suites run against a local build catch anything the Content-Security-Policy would block.
const vercel: { headers: { headers: { key: string; value: string }[] }[] } = JSON.parse(
  readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'),
)
const productionHeaders = Object.fromEntries(vercel.headers.flatMap((rule) => rule.headers.map((h) => [h.key, h.value])))

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
  // Serves the production build on port 5173 like the dev server, so the e2e defaults work unchanged.
  preview: { port: 5173, strictPort: true, headers: productionHeaders },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Run west of UTC: a date-only value like "2020-09-17" read as UTC midnight shows a day early there.
    env: { TZ: 'America/Los_Angeles' },
  },
})
