/** @fileoverview SQLite-backed HTTP Basic Auth credential store. */
import { defineStore } from 'pinia'
import Database from '@tauri-apps/plugin-sql'
import { normalizeHttpAuthOrigin } from '@shared/utils/httpAuth'
import { sanitizeHeaderValue } from '@shared/utils/headerSanitize'
import type { HttpAuthCredential, HttpAuthInput } from '@shared/types'

const DB_NAME = 'sqlite:history.db'

export const useHttpAuthStore = defineStore('httpAuth', () => {
  let db: Awaited<ReturnType<typeof Database.load>> | null = null

  async function getDb() {
    if (!db) db = await Database.load(DB_NAME)
    return db
  }

  async function saveCredential(input: HttpAuthInput): Promise<void> {
    const origin = normalizeHttpAuthOrigin(input.url)
    const username = sanitizeHeaderValue(input.username)
    const password = sanitizeHeaderValue(input.password)
    if (!origin || !username) return

    await (
      await getDb()
    ).execute(
      `INSERT INTO http_auth_credentials
        (origin, username, password, last_used_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT(origin, username) DO UPDATE SET
         password = excluded.password,
         updated_at = CURRENT_TIMESTAMP,
         last_used_at = CURRENT_TIMESTAMP`,
      [origin, username, password],
    )
  }

  async function findByUrl(url: string): Promise<HttpAuthCredential | null> {
    const origin = normalizeHttpAuthOrigin(url)
    if (!origin) return null

    const rows = await (
      await getDb()
    ).select<HttpAuthCredential[]>(
      `SELECT id, origin, username, password, created_at, updated_at, last_used_at
       FROM http_auth_credentials
       WHERE origin = $1
       ORDER BY COALESCE(last_used_at, updated_at, created_at) DESC, id DESC
       LIMIT 1`,
      [origin],
    )
    return rows[0] ?? null
  }

  async function markUsed(id: number): Promise<void> {
    await (
      await getDb()
    ).execute('UPDATE http_auth_credentials SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1', [id])
  }

  return {
    saveCredential,
    findByUrl,
    markUsed,
  }
})
