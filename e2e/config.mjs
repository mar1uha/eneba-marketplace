// Shared settings for the browser and API scripts. Override any of them with environment variables.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** Frontend to drive in the browser (the Vite dev server, or the deployed site). */
export const BASE = process.env.BASE ?? 'http://localhost:5173'
/** API to hit directly (fuzzing, load). */
export const API = process.env.API ?? 'http://localhost:8080'

const defaultChrome = {
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
}[process.platform] ?? '/usr/bin/google-chrome'
export const CHROME = process.env.CHROME_PATH ?? defaultChrome

/** Database the checks read and clean up; defaults to DATABASE_URL in backend/.env. */
export const DB =
  process.env.E2E_DB_URL ??
  fs.readFileSync(path.join(import.meta.dirname, '..', 'backend', '.env'), 'utf8').match(/^DATABASE_URL=(.*)$/m)?.[1].trim()

export const PSQL = process.env.PSQL ?? 'psql'
export const sql = (q) => execFileSync(PSQL, ['-d', DB, '-At', '-c', q], { encoding: 'utf8' }).trim()

/** Test accounts are deleted afterwards; this returns the keys they bought to stock. */
export const restockOrphanedKeys = () =>
  sql(`UPDATE digital_keys SET status = 'available', sold_at = NULL, revealed_at = NULL, reserved_until = NULL
       WHERE order_item_id IS NULL AND status <> 'available'`)

export const SHOTS = path.join(import.meta.dirname, 'shots')
