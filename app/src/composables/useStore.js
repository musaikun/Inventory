import { ref, computed } from 'vue'
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
let _saveGeneration = 0

// ── 未送信データの端末保存（DATA-002 Phase 2）──────────────────────────────
// 以前はメモリだけに置いていたため、再送前にアプリを閉じると未送信分が消えていた。
// 完了した棚卸の snapshot が消えると、一覧（D1 sessions）には出るのに詳細が無い状態になる。
// 保存は shopCode ごと。別アカウントのキューを引き継がないよう、読み込み時に照合する。
const _PENDING_CAP = { snapshots: 20, orders: 200, movements: 200 }
// 再送の連続失敗回数。ユーザーへ「保存できていない」と伝える判断に使う（1回目の失敗では出さない）。
export const saveFailures = ref(0)
// 未送信データを端末に保存できているか。false = この端末では再起動をまたげない（容量不足等）。
export const pendingPersisted = ref(true)
export const pendingCount = computed(() =>
  (_pendingCounts.value.config ? 1 : 0) + (_pendingCounts.value.inventory ? 1 : 0) +
  _pendingCounts.value.snapshots + _pendingCounts.value.orders + _pendingCounts.value.movements
)
// キューは非リアクティブな素の配列なので、件数だけをミラーして computed から読めるようにする。
const _pendingCounts = ref({ config: false, inventory: false, snapshots: 0, orders: 0, movements: 0 })

function _syncPendingCounts() {
  _pendingCounts.value = {
    config:    !!_pending.config,
    inventory: !!_pending.inventory,
    snapshots: _snapQueue.length,
    orders:    _orderQueue.length,
    movements: _moveQueue.length,
  }
}

function _persistPending() {
  _syncPendingCounts()
  const empty = pendingCount.value === 0
  try {
    if (empty) { localStorage.removeItem(STORAGE_KEYS.pendingSaves); pendingPersisted.value = true; return }
    const payload = {
      shopCode:  shopCode.value,
      config:    _pending.config,
      inventory: _pending.inventory,
      snapshots: _snapQueue.slice(-_PENDING_CAP.snapshots),
      orders:    _orderQueue.slice(-_PENDING_CAP.orders),
      movements: _moveQueue.slice(-_PENDING_CAP.movements),
    }
    localStorage.setItem(STORAGE_KEYS.pendingSaves, JSON.stringify(payload))
    pendingPersisted.value = true
  } catch (_) {
    // 容量不足。snapshot は1件で百KB規模になるため、小さいものだけでも残す。
    // それも入らなければ端末保存は諦め、pendingPersisted=false としてUIで警告する。
    try {
      localStorage.setItem(STORAGE_KEYS.pendingSaves, JSON.stringify({
        shopCode:  shopCode.value,
        config:    _pending.config,
        inventory: _pending.inventory,
        snapshots: [],
        orders:    _orderQueue.slice(-_PENDING_CAP.orders),
        movements: _moveQueue.slice(-_PENDING_CAP.movements),
      }))
    } catch (_) {
      try { localStorage.removeItem(STORAGE_KEYS.pendingSaves) } catch (_) {}
    }
    pendingPersisted.value = false
  }
}

// 起動時に前回の未送信分を復元する。店舗が違えば捨てる（アカウント境界・事故S-10と同じ理由）。
function _restorePending() {
  let raw = null
  try { raw = localStorage.getItem(STORAGE_KEYS.pendingSaves) } catch (_) { return }
  if (!raw) return
  let saved = null
  try { saved = JSON.parse(raw) } catch (_) { saved = null }
  if (!saved || typeof saved !== 'object') {
    try { localStorage.removeItem(STORAGE_KEYS.pendingSaves) } catch (_) {}
    return
  }
  if (!shopCode.value || saved.shopCode !== shopCode.value) {
    try { localStorage.removeItem(STORAGE_KEYS.pendingSaves) } catch (_) {}
    return
  }
  _pending.config    = saved.config    ?? null
  _pending.inventory = saved.inventory ?? null
  if (Array.isArray(saved.snapshots)) _snapQueue.push(...saved.snapshots)
  if (Array.isArray(saved.orders))    _orderQueue.push(...saved.orders)
  if (Array.isArray(saved.movements)) _moveQueue.push(...saved.movements)
  _syncPendingCounts()
  saveState.value = pendingCount.value > 0 ? 'pending' : 'idle'
}

_restorePending()

function _settle() {
  saveState.value = (!_pending.config && !_pending.inventory && _snapQueue.length === 0 && _orderQueue.length === 0 && _moveQueue.length === 0) ? 'idle' : 'pending'
  if (saveState.value === 'idle') saveFailures.value = 0
  _persistPending()
}
// 失敗が続くほど間隔を空ける（8秒 → 最大2分）。復旧しない障害で毎8秒叩き続けない。
function _scheduleRetry() {
  if (_retryTimer) return
  const delay = Math.min(8000 * 2 ** Math.max(0, saveFailures.value - 1), 120_000)
  _retryTimer = setTimeout(() => { _retryTimer = null; retryPendingSaves() }, delay)
}

// 未送信データをまとめて再送する（接続復帰時・タイマー時に呼ばれる）
export async function retryPendingSaves() {
  const generation = _saveGeneration
  const code = shopCode.value
  if (!code || !BASE) return
  const stale = () => generation !== _saveGeneration || code !== shopCode.value
  const before = pendingCount.value
  if (_pending.config) {
    const data = _pending.config
    try {
      await _api(`/store/${code}/config`, { method: 'PUT', body: JSON.stringify(data) })
      if (stale()) return
      if (_pending.config === data) _pending.config = null
    } catch (_) { if (stale()) return }
  }
  if (_pending.inventory) {
    const data = _pending.inventory
    try {
      await _api(`/store/${code}/inventory`, { method: 'PUT', body: JSON.stringify(data) })
      if (stale()) return
      if (_pending.inventory === data) _pending.inventory = null
    } catch (_) { if (stale()) return }
  }
  while (_snapQueue.length) {
    const data = _snapQueue[0]
    try {
      await _api(`/store/${code}/history`, { method: 'POST', body: JSON.stringify(data) })
      if (stale()) return
      if (_snapQueue[0] === data) _snapQueue.shift()
    } catch (_) { if (stale()) return; break }
  }
  while (_orderQueue.length) {
    const data = _orderQueue[0]
    try {
      await _api(`/store/${code}/orders`, { method: 'POST', body: JSON.stringify(data) })
      if (stale()) return
      if (_orderQueue[0] === data) _orderQueue.shift()
    } catch (_) { if (stale()) return; break }
  }
  while (_moveQueue.length) {
    const data = _moveQueue[0]
    try {
      await _api(`/store/${code}/movements`, { method: 'POST', body: JSON.stringify(data) })
      if (stale()) return
      if (_moveQueue[0] === data) _moveQueue.shift()
    } catch (_) { if (stale()) return; break }
  }
  _syncPendingCounts()
  // 1件も減らせなければ失敗回数を進める（＝間隔を空け、UIの警告を強める）。
  if (pendingCount.value > 0 && pendingCount.value >= before) saveFailures.value++
  else if (pendingCount.value > 0) saveFailures.value = 0
  _settle()
  if (saveState.value === 'pending') _scheduleRetry()
}

onReconnect(retryPendingSaves)

// 起動直後に呼ぶ。前回のアプリ終了時に残っていた未送信分をここから再送し始める
// （接続復帰イベントは待たない＝起動時点で既にオンラインなら即座に送る）。
export function resumePendingSaves() {
  if (pendingCount.value === 0) return false
  retryPendingSaves()
  return true
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
  const generation = _saveGeneration
  const code = shopCode.value
  saveState.value = 'saving'
  try {
    await _api(`/store/${code}/config`, { method: 'PUT', body: JSON.stringify(configData) })
    if (generation !== _saveGeneration || code !== shopCode.value) return
    _pending.config = null
    _settle()
  } catch (e) {
    if (generation !== _saveGeneration || code !== shopCode.value) return
    _pending.config = configData
    saveState.value = 'pending'
    _persistPending()
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
  const generation = _saveGeneration
  const code = shopCode.value
  saveState.value = 'saving'
  try {
    await _api(`/store/${code}/inventory`, { method: 'PUT', body: JSON.stringify(inventoryData) })
    if (generation !== _saveGeneration || code !== shopCode.value) return
    _pending.inventory = null
    _settle()
  } catch (e) {
    if (generation !== _saveGeneration || code !== shopCode.value) return
    _pending.inventory = inventoryData
    saveState.value = 'pending'
    _persistPending()
    _scheduleRetry()
  }
}

// ── 棚卸履歴 ──────────────────────────────────────────────────────────────────
export async function loadHistoryFromD1() {
  if (!shopCode.value) return null
  return _api(`/store/${shopCode.value}/history`).catch(() => null)
}

// 戻り値: true = D1へ保存済み / false = 未送信キューへ入れた（端末には残る）。
// 棚卸の完了処理は、この結果を見てユーザーに保存状況を伝える。
export async function saveSnapshotToD1(snapshot) {
  if (!shopCode.value || !BASE) return false
  const generation = _saveGeneration
  const code = shopCode.value
  saveState.value = 'saving'
  try {
    await _api(`/store/${code}/history`, { method: 'POST', body: JSON.stringify(snapshot) })
    if (generation !== _saveGeneration || code !== shopCode.value) return false
    _settle()
    return true
  } catch (e) {
    if (generation !== _saveGeneration || code !== shopCode.value) return false
    _snapQueue.push(snapshot)
    saveState.value = 'pending'
    _persistPending()
    _scheduleRetry()
    return false
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
  const generation = _saveGeneration
  const code = shopCode.value
  saveState.value = 'saving'
  try {
    await _api(`/store/${code}/orders`, { method: 'POST', body: JSON.stringify(order) })
    if (generation !== _saveGeneration || code !== shopCode.value) return
    _settle()
  } catch (e) {
    if (generation !== _saveGeneration || code !== shopCode.value) return
    _orderQueue.push(order)
    saveState.value = 'pending'
    _persistPending()
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
  const generation = _saveGeneration
  const code = shopCode.value
  saveState.value = 'saving'
  try {
    await _api(`/store/${code}/movements`, { method: 'POST', body: JSON.stringify(movement) })
    if (generation !== _saveGeneration || code !== shopCode.value) return
    _settle()
  } catch (e) {
    if (generation !== _saveGeneration || code !== shopCode.value) return
    _moveQueue.push(movement)
    saveState.value = 'pending'
    _persistPending()
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

// アカウント削除・切替時に、旧店舗の未送信データと再送タイマーを破棄する。
// generation更新により、既に待機中の通信が後から失敗してもqueueを復活させない。
export function resetAccountData() {
  _saveGeneration++
  _pending.config = null
  _pending.inventory = null
  _snapQueue.splice(0)
  _orderQueue.splice(0)
  _moveQueue.splice(0)
  if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null }
  activeRoom.value = null
  saveState.value = 'idle'
  saveFailures.value = 0
  pendingPersisted.value = true
  _syncPendingCounts()
  try { localStorage.removeItem(STORAGE_KEYS.pendingSaves) } catch (_) {}
}
