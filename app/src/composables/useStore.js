import { ref } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'
import { HTTP_BASE as BASE, apiFetch as _api } from '../utils/api.js'
import { onReconnect } from './useConnectivity.js'

// ── モジュールスコープ シングルトン ───────────────────────────────────────────
export const shopCode  = ref(localStorage.getItem(STORAGE_KEYS.shopCode) ?? '')
export const activeRoom = ref(null)  // D1 に記録されている進行中ルームコード

// ── D1保存の状態と未送信の再送 ────────────────────────────────────────────────
// 'idle' = 全て保存済み / 'saving' = 送信中 / 'pending' = 送信失敗（端末には保存済み・再送待ち）
export const saveState = ref('idle')
// config/inventory は全量PUT（最新が正）なので最後の失敗分だけ保持。snapshot は追記なのでキュー。
const _pending  = { config: null, inventory: null }
const _snapQueue = []
const _orderQueue = []
const _moveQueue = []
let _retryTimer = null

function _settle() {
  saveState.value = (!_pending.config && !_pending.inventory && _snapQueue.length === 0 && _orderQueue.length === 0 && _moveQueue.length === 0) ? 'idle' : 'pending'
}
function _scheduleRetry() {
  if (_retryTimer) return
  _retryTimer = setTimeout(() => { _retryTimer = null; retryPendingSaves() }, 8000)
}

// 未送信データをまとめて再送する（接続復帰時・タイマー時に呼ばれる）
export async function retryPendingSaves() {
  if (!shopCode.value || !BASE) return
  if (_pending.config) {
    try { await _api(`/store/${shopCode.value}/config`, { method: 'PUT', body: JSON.stringify(_pending.config) }); _pending.config = null } catch (_) {}
  }
  if (_pending.inventory) {
    try { await _api(`/store/${shopCode.value}/inventory`, { method: 'PUT', body: JSON.stringify(_pending.inventory) }); _pending.inventory = null } catch (_) {}
  }
  while (_snapQueue.length) {
    try { await _api(`/store/${shopCode.value}/history`, { method: 'POST', body: JSON.stringify(_snapQueue[0]) }); _snapQueue.shift() }
    catch (_) { break }
  }
  while (_orderQueue.length) {
    try { await _api(`/store/${shopCode.value}/orders`, { method: 'POST', body: JSON.stringify(_orderQueue[0]) }); _orderQueue.shift() }
    catch (_) { break }
  }
  while (_moveQueue.length) {
    try { await _api(`/store/${shopCode.value}/movements`, { method: 'POST', body: JSON.stringify(_moveQueue[0]) }); _moveQueue.shift() }
    catch (_) { break }
  }
  _settle()
  if (saveState.value === 'pending') _scheduleRetry()
}

onReconnect(retryPendingSaves)

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
  saveState.value = 'saving'
  try {
    await _api(`/store/${shopCode.value}/config`, { method: 'PUT', body: JSON.stringify(configData) })
    _pending.config = null
    _settle()
  } catch (e) {
    _pending.config = configData
    saveState.value = 'pending'
    _scheduleRetry()
  }
}

// ── 棚卸データ ────────────────────────────────────────────────────────────────
export async function loadInventoryFromD1() {
  if (!shopCode.value) return null
  return _api(`/store/${shopCode.value}/inventory`).catch(() => null)
}

export async function saveInventoryToD1(inventoryData) {
  if (!shopCode.value || !BASE) return
  saveState.value = 'saving'
  try {
    await _api(`/store/${shopCode.value}/inventory`, { method: 'PUT', body: JSON.stringify(inventoryData) })
    _pending.inventory = null
    _settle()
  } catch (e) {
    _pending.inventory = inventoryData
    saveState.value = 'pending'
    _scheduleRetry()
  }
}

// ── 棚卸履歴 ──────────────────────────────────────────────────────────────────
export async function loadHistoryFromD1() {
  if (!shopCode.value) return null
  return _api(`/store/${shopCode.value}/history`).catch(() => null)
}

export async function saveSnapshotToD1(snapshot) {
  if (!shopCode.value || !BASE) return
  saveState.value = 'saving'
  try {
    await _api(`/store/${shopCode.value}/history`, { method: 'POST', body: JSON.stringify(snapshot) })
    _settle()
  } catch (e) {
    _snapQueue.push(snapshot)
    saveState.value = 'pending'
    _scheduleRetry()
  }
}

export async function deleteSnapshotFromD1(date) {
  if (!shopCode.value || !BASE) return
  return _api(`/store/${shopCode.value}/history/${date}`, { method: 'DELETE' })
    .catch(e => console.warn('[store] snapshot削除失敗:', e.message))
}

// ── 発注 ──────────────────────────────────────────────────────────────────────
export async function loadOrdersFromD1(sinceDays = null) {
  if (!shopCode.value) return null
  const q = sinceDays ? `?sinceDays=${sinceDays}` : ''
  return _api(`/store/${shopCode.value}/orders${q}`).catch(() => null)
}

export async function saveOrderToD1(order) {
  if (!shopCode.value || !BASE) return
  saveState.value = 'saving'
  try {
    await _api(`/store/${shopCode.value}/orders`, { method: 'POST', body: JSON.stringify(order) })
    _settle()
  } catch (e) {
    _orderQueue.push(order)
    saveState.value = 'pending'
    _scheduleRetry()
  }
}

export async function deleteOrderFromD1(id) {
  if (!shopCode.value || !BASE) return
  return _api(`/store/${shopCode.value}/orders/${id}`, { method: 'DELETE' })
    .catch(e => console.warn('[store] 発注削除失敗:', e.message))
}

// ── 入出庫 ────────────────────────────────────────────────────────────────────
export async function loadMovementsFromD1(sinceDays = null) {
  if (!shopCode.value) return null
  const q = sinceDays ? `?sinceDays=${sinceDays}` : ''
  return _api(`/store/${shopCode.value}/movements${q}`).catch(() => null)
}

export async function saveMovementToD1(movement) {
  if (!shopCode.value || !BASE) return
  saveState.value = 'saving'
  try {
    await _api(`/store/${shopCode.value}/movements`, { method: 'POST', body: JSON.stringify(movement) })
    _settle()
  } catch (e) {
    _moveQueue.push(movement)
    saveState.value = 'pending'
    _scheduleRetry()
  }
}

export async function deleteMovementFromD1(id) {
  if (!shopCode.value || !BASE) return
  return _api(`/store/${shopCode.value}/movements/${id}`, { method: 'DELETE' })
    .catch(e => console.warn('[store] 入出庫削除失敗:', e.message))
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
