import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Run west of UTC: a date-only value like "2020-09-17" read as UTC midnight shows a day early there.
    env: { TZ: 'America/Los_Angeles' },
  },
})
