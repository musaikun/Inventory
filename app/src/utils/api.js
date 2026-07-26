import { STORAGE_KEYS } from './storageKeys.js'

// VITE_SYNC_WORKER_URL の正規化（HTTP用・WebSocket用）を一元管理
const RAW = (import.meta.env.VITE_SYNC_WORKER_URL ?? '').replace(/\/$/, '')

export const HTTP_BASE = RAW.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')
export const WS_BASE   = RAW.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://')

// 別端末ログインなどでトークンが失効したときに呼ばれるハンドラ（App.vue が登録）
let _onAuthInvalidated = null
let _invalidatedNotified = false
export function setAuthInvalidatedHandler(fn) { _onAuthInvalidated = fn }

export function apiFetch(path, options = {}) {
  if (!HTTP_BASE) return Promise.reject(new Error('WORKER_URL未設定'))
  const headers = { 'Content-Type': 'application/json', ...(options.headers ?? {}) }
  const token = localStorage.getItem(STORAGE_KEYS.authToken)
  if (token) headers['Authorization'] = `Bearer ${token}`
  return fetch(`${HTTP_BASE}${path}`, { ...options, headers }).then(async r => {
    const body = await r.json().catch(() => ({}))
    if (r.ok) { _invalidatedNotified = false; return body }
    // 認証付きリクエストが 401 → 別端末ログイン等でトークン失効（/auth/* は対象外）
    if (r.status === 401 && token && !path.startsWith('/auth/') && !_invalidatedNotified) {
      _invalidatedNotified = true
      _onAuthInvalidated?.()
    }
    const err = new Error(body.error || `HTTP ${r.status}`)
    err.status = r.status
    err.code   = body.code   // サーバーの機械可読コード（例: confirmation_mismatch / deletion_in_progress）
    err.body   = body        // retryable など追加フィールドを参照する呼び出し向け
    throw err
  })
}
