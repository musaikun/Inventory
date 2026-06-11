import { ref } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

const BASE = (() => {
  const raw = import.meta.env.VITE_SYNC_WORKER_URL ?? ''
  return raw.replace(/^wss?:\/\//, 'https://').replace(/^http:\/\//, 'http://').replace(/\/$/, '')
})()

// ── モジュールスコープ シングルトン ───────────────────────────────────────────
export const shopCode  = ref(localStorage.getItem(STORAGE_KEYS.shopCode) ?? '')
export const activeRoom = ref(null)  // D1 に記録されている進行中ルームコード

function _api(path, options = {}) {
  if (!BASE) return Promise.reject(new Error('WORKER_URL未設定'))
  const headers = { 'Content-Type': 'application/json', ...(options.headers ?? {}) }
  const token = localStorage.getItem('_auth_token')
  if (token) headers['Authorization'] = `Bearer ${token}`
  return fetch(`${BASE}${path}`, { ...options, headers }).then(async r => {
    const body = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
    return body
  })
}

// ── 店舗コード 発行 ────────────────────────────────────────────────────────────
export async function createStore() {
  const { shopCode: code } = await _api('/store/create', { method: 'POST' })
  shopCode.value = code
  localStorage.setItem(STORAGE_KEYS.shopCode, code)
  return code
}

// ── 店舗コード 確認・読み込み ──────────────────────────────────────────────────
export async function loadStore(code) {
  const store = await _api(`/store/${code}`)
  shopCode.value  = store.shopCode
  activeRoom.value = store.activeRoom
  localStorage.setItem(STORAGE_KEYS.shopCode, store.shopCode)
  return store
}

// ── 店舗情報の読み取り専用取得（状態を変更しない） ─────────────────────────────
export async function fetchStoreInfo(code) {
  try { return await _api(`/store/${code}`) } catch { return null }
}

// ── 品目リスト ────────────────────────────────────────────────────────────────
export async function loadConfigFromD1() {
  if (!shopCode.value) return null
  return _api(`/store/${shopCode.value}/config`).catch(() => null)
}

export async function saveConfigToD1(configData) {
  if (!shopCode.value || !BASE) return
  return _api(`/store/${shopCode.value}/config`, { method: 'PUT', body: JSON.stringify(configData) })
    .catch(e => console.warn('[store] config保存失敗:', e.message))
}

// ── 棚卸データ ────────────────────────────────────────────────────────────────
export async function loadInventoryFromD1() {
  if (!shopCode.value) return null
  return _api(`/store/${shopCode.value}/inventory`).catch(() => null)
}

export async function saveInventoryToD1(inventoryData) {
  if (!shopCode.value || !BASE) return
  return _api(`/store/${shopCode.value}/inventory`, { method: 'PUT', body: JSON.stringify(inventoryData) })
    .catch(e => console.warn('[store] inventory保存失敗:', e.message))
}

// ── 棚卸履歴 ──────────────────────────────────────────────────────────────────
export async function loadHistoryFromD1() {
  if (!shopCode.value) return null
  return _api(`/store/${shopCode.value}/history`).catch(() => null)
}

export async function saveSnapshotToD1(snapshot) {
  if (!shopCode.value || !BASE) return
  return _api(`/store/${shopCode.value}/history`, { method: 'POST', body: JSON.stringify(snapshot) })
    .catch(e => console.warn('[store] snapshot保存失敗:', e.message))
}

export async function deleteSnapshotFromD1(date) {
  if (!shopCode.value || !BASE) return
  return _api(`/store/${shopCode.value}/history/${date}`, { method: 'DELETE' })
    .catch(e => console.warn('[store] snapshot削除失敗:', e.message))
}

// ── アクティブルーム ──────────────────────────────────────────────────────────
export async function updateActiveRoomInD1(roomCode) {
  if (!shopCode.value || !BASE) return
  activeRoom.value = roomCode ?? null
  return _api(`/store/${shopCode.value}/room`, { method: 'PUT', body: JSON.stringify({ roomCode: roomCode ?? null }) })
    .catch(e => console.warn('[store] activeRoom更新失敗:', e.message))
}

// ── 店舗コードをローカルからクリア（ログアウト相当）────────────────────────────
export function clearShopCode() {
  shopCode.value   = ''
  activeRoom.value = null
  localStorage.removeItem(STORAGE_KEYS.shopCode)
}
