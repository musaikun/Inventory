import { ref, computed } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'
import { HTTP_BASE as BASE, apiFetch as _api } from '../utils/api.js'
import { onReconnect } from './useConnectivity.js'

// ── モジュールスコープ シングルトン ───────────────────────────────────────────
export const shopCode  = ref(localStorage.getItem(STORAGE_KEYS.shopCode) ?? '')
export const activeRoom = ref(null)  // D1 に記録されている進行中ルームコード

// ── D1保存の状態と未送信の再送 ────────────────────────────────────────────────
// 'idle' = 全て保存済み / 'saving' = 送信中 / 'pending' = 送信失敗（再送待ち）
export const saveState = ref('idle')

/**
 * 未送信キュー（DATA-002 Phase 2 / CCレビュー修正）
 *
 * 保存対象を `kind + shopCode + resourceId` で識別し、同じ対象は**最新版へ集約**する
 * （latest-wins）。以前は種類ごとの配列にpayloadを積むだけだったため、
 *
 *   1. Aの保存が失敗してキューに入る
 *   2. 同じ対象の新しいBが直接保存に成功する
 *   3. 再送がAを送り、サーバー上のBがAへ巻き戻る
 *
 * という取り違えが起きていた。すべての保存に単調増加の `rev` を振り、
 *   - 成功 → その rev 以下のキュー項目を破棄（3を防ぐ）
 *   - 失敗 → 既存項目より rev が新しいときだけ入れ替え
 * とすることで、古い版が新しい版を上書きしない。
 */
const _queue = new Map()     // key -> { key, kind, resourceId, rev, payload }
let _rev = 0                 // 保存要求ごとの単調増加リビジョン
let _retryTimer = null
let _saveGeneration = 0
let _draining = null         // 実行中のdrain（同時実行を1本に束ねる）
let _authBlocked = false     // 認証失効。再ログインまで送らない

// 再送の連続失敗回数。ユーザーへ「保存できていない」と伝える判断に使う（1回目の失敗では出さない）。
export const saveFailures = ref(0)
// 未送信データを端末に保存できているか。false = この端末では再起動をまたげない（容量不足等）。
export const pendingPersisted = ref(true)
// 端末に保持できなかった未送信件数（0 なら全件保持できている）。
export const unpersistedCount = ref(0)
// サーバーに拒否されて捨てた保存（400/409/413 など再送しても直らないもの）。
// 黙って消すと「保存したつもり」が残るため、UIで提示するために持つ。
export const rejectedSaves = ref([])
// キューは非リアクティブな Map なので、件数をミラーして computed から読めるようにする。
const _pendingSize = ref(0)
export const pendingCount = computed(() => _pendingSize.value)

const _ENDPOINT = {
  config:    { path: (code) => `/store/${code}/config`,     method: 'PUT'  },
  inventory: { path: (code) => `/store/${code}/inventory`,  method: 'PUT'  },
  snapshot:  { path: (code) => `/store/${code}/history`,    method: 'POST' },
  order:     { path: (code) => `/store/${code}/orders`,     method: 'POST' },
  movement:  { path: (code) => `/store/${code}/movements`,  method: 'POST' },
}
const _LABEL = {
  config: '品目リスト', inventory: '棚卸データ', snapshot: '棚卸の明細',
  order: '発注', movement: '入出庫',
}

function _key(kind, resourceId) { return `${kind}:${shopCode.value}:${resourceId ?? ''}` }

/**
 * 失敗の種類を分ける。
 *  'auth'      … 認証失効。再ログインするまで送っても無駄なので drain を止める
 *  'permanent' … サーバーが内容を拒否した。何度送っても直らないので捨てて提示する
 *  'retry'     … 通信断・5xx・429。時間を置いて再送する
 */
function _classify(err) {
  const s = err?.status
  if (s === 401 || s === 403) return 'auth'
  if (s === 429) return 'retry'
  if (typeof s === 'number' && s >= 500) return 'retry'
  if (typeof s === 'number' && s >= 400) return 'permanent'
  return 'retry'   // status を持たない = ネットワーク断
}

function _syncSize() { _pendingSize.value = _queue.size }

// 失敗した保存をキューへ入れる（同じ対象は新しい rev だけを残す）
function _enqueue(kind, resourceId, rev, payload) {
  const key = _key(kind, resourceId)
  const cur = _queue.get(key)
  if (cur && cur.rev > rev) return   // 既により新しい版が待っている
  _queue.set(key, { key, kind, resourceId, rev, payload })
  _syncSize()
}

// 保存が成功した対象について、その版以前の待ち項目を捨てる。
// これをしないと「新しいBが成功した後に古いAを再送して巻き戻す」が起きる。
function _ack(kind, resourceId, rev) {
  const key = _key(kind, resourceId)
  const cur = _queue.get(key)
  if (cur && cur.rev <= rev) { _queue.delete(key); _syncSize() }
}

function _persistPending() {
  _syncSize()
  if (_queue.size === 0) {
    try { localStorage.removeItem(STORAGE_KEYS.pendingSaves) } catch (_) {}
    pendingPersisted.value = true
    unpersistedCount.value = 0
    return
  }
  // 新しいものから順に、入るところまで書く。切り捨てた分は件数として必ず表に出す
  // （以前は snapshot 20件・order/movement 200件で黙って slice しており、
  //   端末に残っていない変更まで「端末に保存済み」と表示していた）。
  const items = [..._queue.values()].sort((a, b) => b.rev - a.rev)
  for (let take = items.length; take >= 0; take--) {
    try {
      localStorage.setItem(STORAGE_KEYS.pendingSaves, JSON.stringify({
        shopCode: shopCode.value,
        rev:      _rev,
        items:    items.slice(0, take),
      }))
      unpersistedCount.value = items.length - take
      pendingPersisted.value = unpersistedCount.value === 0
      return
    } catch (_) { /* 容量不足。1件減らして再挑戦 */ }
  }
  // 空配列すら書けない（localStorage自体が使えない）
  try { localStorage.removeItem(STORAGE_KEYS.pendingSaves) } catch (_) {}
  unpersistedCount.value = items.length
  pendingPersisted.value = false
}

// 起動時に前回の未送信分を復元する。店舗が違えば捨てる（アカウント境界・事故S-10と同じ理由）。
function _restorePending() {
  let raw = null
  try { raw = localStorage.getItem(STORAGE_KEYS.pendingSaves) } catch (_) { return }
  if (!raw) return
  let saved = null
  try { saved = JSON.parse(raw) } catch (_) { saved = null }
  const drop = () => { try { localStorage.removeItem(STORAGE_KEYS.pendingSaves) } catch (_) {} }
  if (!saved || typeof saved !== 'object' || !Array.isArray(saved.items)) { drop(); return }
  if (!shopCode.value || saved.shopCode !== shopCode.value) { drop(); return }

  for (const it of saved.items) {
    if (!it || !_ENDPOINT[it.kind]) continue
    _queue.set(_key(it.kind, it.resourceId), {
      key: _key(it.kind, it.resourceId),
      kind: it.kind, resourceId: it.resourceId ?? '',
      rev: Number.isFinite(it.rev) ? it.rev : 0,
      payload: it.payload,
    })
  }
  // 復元後の採番が既存 rev と衝突しないよう、保存時点の最大値から続ける
  _rev = Math.max(Number.isFinite(saved.rev) ? saved.rev : 0, ...[..._queue.values()].map(e => e.rev), 0)
  _syncSize()
  saveState.value = _queue.size > 0 ? 'pending' : 'idle'
}

_restorePending()

function _settle() {
  saveState.value = _queue.size === 0 ? 'idle' : 'pending'
  if (saveState.value === 'idle') saveFailures.value = 0
  _persistPending()
}

// 失敗が続くほど間隔を空ける（8秒 → 最大2分）。復旧しない障害で毎8秒叩き続けない。
function _scheduleRetry() {
  if (_retryTimer || _authBlocked) return
  const delay = Math.min(8000 * 2 ** Math.max(0, saveFailures.value - 1), 120_000)
  _retryTimer = setTimeout(() => { _retryTimer = null; retryPendingSaves() }, delay)
}

/**
 * 未送信データをまとめて再送する（起動・接続復帰・タイマー・手動から呼ばれる）。
 * 同時に呼ばれても drain は1本に束ねる。並行に走ると同じ項目を二重送信し、
 * 片方の shift でもう片方の成功を取りこぼす。
 */
export function retryPendingSaves() {
  if (_draining) return _draining
  _draining = _drain().finally(() => { _draining = null })
  return _draining
}

async function _drain() {
  const generation = _saveGeneration
  const code = shopCode.value
  if (!code || !BASE || _authBlocked) return
  const stale = () => generation !== _saveGeneration || code !== shopCode.value
  const before = _queue.size

  // rev 昇順＝発生順に送る。送信中に新しい版が入っても、その項目は次のdrainで送る
  for (const entry of [..._queue.values()].sort((a, b) => a.rev - b.rev)) {
    if (stale()) return
    const ep = _ENDPOINT[entry.kind]
    if (!ep) { _queue.delete(entry.key); continue }
    try {
      await _api(ep.path(code), { method: ep.method, body: JSON.stringify(entry.payload) })
      if (stale()) return
      _ack(entry.kind, entry.resourceId, entry.rev)
    } catch (err) {
      if (stale()) return
      const cls = _classify(err)
      if (cls === 'auth') { _authBlocked = true; break }
      if (cls === 'permanent') {
        _queue.delete(entry.key)
        _syncSize()
        rejectedSaves.value = [...rejectedSaves.value, {
          kind: entry.kind, label: _LABEL[entry.kind] ?? entry.kind,
          resourceId: entry.resourceId, status: err?.status ?? null,
          message: err?.message ?? '保存できませんでした', at: Date.now(),
        }]
        continue
      }
      break   // retry可能な失敗。以降はまとめて次回へ
    }
  }

  _syncSize()
  // 1件も減らせなければ失敗回数を進める（＝間隔を空け、UIの警告を強める）
  if (_queue.size > 0 && _queue.size >= before) saveFailures.value++
  else if (_queue.size > 0) saveFailures.value = 0
  _settle()
  if (saveState.value === 'pending') _scheduleRetry()
}

onReconnect(() => retryPendingSaves())

// 起動直後に呼ぶ。前回のアプリ終了時に残っていた未送信分をここから再送し始める
// （接続復帰イベントは待たない＝起動時点で既にオンラインなら即座に送る）。
export function resumePendingSaves() {
  if (_queue.size === 0) return false
  retryPendingSaves()
  return true
}

// 拒否された保存の通知をユーザーが読んだあと消す（内容は復元できないので確認のみ）。
export function dismissRejectedSaves() {
  rejectedSaves.value = []
}

// 再ログイン後に呼ぶ。認証失効で止めていた再送を再開する。
export function clearAuthBlock() {
  if (!_authBlocked) return false
  _authBlocked = false
  if (_queue.size > 0) retryPendingSaves()
  return true
}

/**
 * 保存の共通処理。直接送ってみて、失敗したらキューへ入れる。
 * @returns {Promise<boolean>} true = サーバーへ保存済み
 */
async function _save(kind, resourceId, payload) {
  if (!shopCode.value || !BASE) return false
  const generation = _saveGeneration
  const code = shopCode.value
  const rev  = ++_rev
  const ep   = _ENDPOINT[kind]
  saveState.value = 'saving'
  try {
    await _api(ep.path(code), { method: ep.method, body: JSON.stringify(payload) })
    if (generation !== _saveGeneration || code !== shopCode.value) return false
    // 自分より古い待ち項目を捨てる（古い版で上書きされるのを防ぐ）
    _ack(kind, resourceId, rev)
    _settle()
    return true
  } catch (err) {
    if (generation !== _saveGeneration || code !== shopCode.value) return false
    const cls = _classify(err)
    if (cls === 'permanent') {
      rejectedSaves.value = [...rejectedSaves.value, {
        kind, label: _LABEL[kind] ?? kind, resourceId,
        status: err?.status ?? null, message: err?.message ?? '保存できませんでした', at: Date.now(),
      }]
      _settle()
      return false
    }
    if (cls === 'auth') _authBlocked = true
    _enqueue(kind, resourceId, rev, payload)
    saveState.value = 'pending'
    _persistPending()
    _scheduleRetry()
    return false
  }
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
  return _save('config', '', configData)
}

// ── 棚卸データ ────────────────────────────────────────────────────────────────
export async function loadInventoryFromD1() {
  if (!shopCode.value) return null
  return _api(`/store/${shopCode.value}/inventory`).catch(() => null)
}

export async function saveInventoryToD1(inventoryData) {
  return _save('inventory', '', inventoryData)
}

// ── 棚卸履歴 ──────────────────────────────────────────────────────────────────
export async function loadHistoryFromD1() {
  if (!shopCode.value) return null
  return _api(`/store/${shopCode.value}/history`).catch(() => null)
}

// 戻り値: true = D1へ保存済み / false = 未送信キューへ入れた（端末には残る）。
// 棚卸の完了処理は、この結果を見てユーザーに保存状況を伝える。
export async function saveSnapshotToD1(snapshot) {
  // 同一日付のスナップショットは D1 側も日付キーで upsert される。
  // 同じ日付を識別子にすることで、古い版が新しい版を上書きしない。
  return _save('snapshot', snapshot?.date ?? '', snapshot)
}

export async function deleteSnapshotFromD1(key) {
  if (!shopCode.value || !BASE) return
  // key は sessionId（現行）または legacy の日付キー
  return _api(`/store/${shopCode.value}/history/${encodeURIComponent(key)}`, { method: 'DELETE' })
    .catch(e => console.warn('[store] snapshot削除失敗:', e.message))
}

// ── 発注 ──────────────────────────────────────────────────────────────────────
export async function loadOrdersFromD1(sinceDays = null) {
  if (!shopCode.value) return null
  const q = sinceDays ? `?sinceDays=${sinceDays}` : ''
  return _api(`/store/${shopCode.value}/orders${q}`).catch(() => null)
}

export async function saveOrderToD1(order) {
  return _save('order', order?.id ?? '', order)
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
  return _save('movement', movement?.id ?? '', movement)
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
  _queue.clear()
  _rev = 0
  _authBlocked = false
  if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null }
  activeRoom.value = null
  saveState.value = 'idle'
  saveFailures.value = 0
  pendingPersisted.value = true
  unpersistedCount.value = 0
  rejectedSaves.value = []
  _syncSize()
  try { localStorage.removeItem(STORAGE_KEYS.pendingSaves) } catch (_) {}
}
