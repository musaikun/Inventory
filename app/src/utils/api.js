import { STORAGE_KEYS } from './storageKeys.js'

// VITE_SYNC_WORKER_URL の正規化（HTTP用・WebSocket用）を一元管理
const RAW = (import.meta.env.VITE_SYNC_WORKER_URL ?? '').replace(/\/$/, '')

export const HTTP_BASE = RAW.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')
export const WS_BASE   = RAW.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://')

export function apiFetch(path, options = {}) {
  if (!HTTP_BASE) return Promise.reject(new Error('WORKER_URL未設定'))
  const headers = { 'Content-Type': 'application/json', ...(options.headers ?? {}) }
  const token = localStorage.getItem(STORAGE_KEYS.authToken)
  if (token) headers['Authorization'] = `Bearer ${token}`
  return fetch(`${HTTP_BASE}${path}`, { ...options, headers }).then(async r => {
    const body = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
    return body
  })
}
