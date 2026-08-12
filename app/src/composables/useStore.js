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
 *
 * 各項目は**自分が属する shopCode を持つ**。401 で失効したとき、認証ハンドラが
 * `shopCode` を空にした後で catch が走るため、「現在の shopCode」で鍵を作ると
 * 送信対象が別名で入り、再起動時に読み捨てられて消えていた。
 * 送信は現在の店舗の項目だけを対象にするので、別店舗へログインしても旧店舗の
 * 未送信データは送られない（アカウント境界）。
 */
const _queue = new Map()     // key -> { key, kind, shopCode, resourceId, rev, payload }
let _rev = 0                 // 保存要求ごとの単調増加リビジョン
let _retryTimer = null
let _saveGeneration = 0
let _draining = null         // 実行中のdrain（同時実行を1本に束ねる）
let _authBlocked = false     // 認証失効。再ログインまで送らない
// 同一対象への直接保存を直列化する（key -> 実行中のPromise）。
// 並行に投げると、A→Bの順で送ってもサーバーへ届く順が入れ替わり、
// 古いAが新しいBを上書きしうる。
const _inflight = new Map()

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
// 数えるのは**現在の店舗ぶんだけ**。別店舗の残りをバナーの件数に混ぜない。
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

function _key(kind, code, resourceId) { return `${kind}:${code ?? ''}:${resourceId ?? ''}` }

/**
 * 保存対象の識別子。
 *  - snapshot は sessionId が正本。日付にすると同じ日の2回目の棚卸が1回目を潰す
 *    （どちらもサーバーへ届かない）。sessionId を持たない legacy 行だけ日付へ落とす。
 *  - order / movement は id。
 *  - config / inventory は店舗に1つなので空。
 */
function _resourceId(kind, payload) {
  if (kind === 'snapshot') {
    return payload?.sessionId ? String(payload.sessionId) : (payload?.date ?? '')
  }
  if (kind === 'order' || kind === 'movement') return payload?.id ?? ''
  return ''
}

/** 現在の店舗に属する未送信項目 */
function _activeEntries() {
  const code = shopCode.value
  return [..._queue.values()].filter(e => e.shopCode === code)
}

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

function _syncSize() { _pendingSize.value = _activeEntries().length }

// 失敗した保存をキューへ入れる（同じ対象は新しい rev だけを残す）
function _enqueue(kind, code, resourceId, rev, payload) {
  const key = _key(kind, code, resourceId)
  const cur = _queue.get(key)
  if (cur && cur.rev > rev) return   // 既により新しい版が待っている
  _queue.set(key, { key, kind, shopCode: code, resourceId, rev, payload })
  _syncSize()
}

// 保存が成功した対象について、その版以前の待ち項目を捨てる。
// これをしないと「新しいBが成功した後に古いAを再送して巻き戻す」が起きる。
function _ack(kind, code, resourceId, rev) {
  const key = _key(kind, code, resourceId)
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
  const mine  = (list) => list.filter(e => e.shopCode === shopCode.value).length
  for (let take = items.length; take >= 0; take--) {
    try {
      localStorage.setItem(STORAGE_KEYS.pendingSaves, JSON.stringify({
        rev:   _rev,
        items: items.slice(0, take),
      }))
      // 表に出すのは現在の店舗ぶんの未保持件数。pendingCount と母数を揃えないと
      // バナーが「3件のうち5件が保持できていません」のような数え方になる。
      unpersistedCount.value = Math.max(0, mine(items) - mine(items.slice(0, take)))
      pendingPersisted.value = unpersistedCount.value === 0
      return
    } catch (_) { /* 容量不足。1件減らして再挑戦 */ }
  }
  // 空配列すら書けない（localStorage自体が使えない）
  try { localStorage.removeItem(STORAGE_KEYS.pendingSaves) } catch (_) {}
  unpersistedCount.value = mine(items)
  pendingPersisted.value = false
}

// 拒否された保存はリロードしても消えないようにする。
// メモリだけに持つと、再読み込みで「保存できなかった」事実だけが消え、
// ユーザーは入力し直す必要があることに気づけない。
function _persistRejected() {
  try {
    if (rejectedSaves.value.length === 0) localStorage.removeItem(STORAGE_KEYS.rejectedSaves)
    else localStorage.setItem(STORAGE_KEYS.rejectedSaves, JSON.stringify(rejectedSaves.value))
  } catch (_) {}
}

function _reject(kind, code, resourceId, err) {
  rejectedSaves.value = [...rejectedSaves.value, {
    kind, label: _LABEL[kind] ?? kind, shopCode: code, resourceId,
    status: err?.status ?? null, message: err?.message ?? '保存できませんでした', at: Date.now(),
  }]
  _persistRejected()
}

/**
 * 起動時に前回の未送信分を復元する。
 *
 * 別の店舗でログイン中なら、その店舗のものだけを残す（アカウント境界・事故S-10）。
 * **ログアウト状態（shopCode が空）では捨てない。** 401 で失効した直後は shopCode が
 * 空になっており、ここで捨てると「認証が切れた瞬間の最新版」が失われる。
 * 同じ店舗へ再ログインすれば clearAuthBlock() から送り直し、別店舗へログインすれば
 * useAuth の accountReset → resetAccountData() がまとめて破棄する。
 */
function _restorePending() {
  let raw = null
  try { raw = localStorage.getItem(STORAGE_KEYS.pendingSaves) } catch (_) { return }
  if (!raw) return
  let saved = null
  try { saved = JSON.parse(raw) } catch (_) { saved = null }
  const drop = () => { try { localStorage.removeItem(STORAGE_KEYS.pendingSaves) } catch (_) {} }
  if (!saved || typeof saved !== 'object' || !Array.isArray(saved.items)) { drop(); return }

  const current = shopCode.value
  for (const it of saved.items) {
    if (!it || !_ENDPOINT[it.kind]) continue
    // 旧形式（項目に shopCode が無く、保存側が1つ持っていた）からの移行
    const code = it.shopCode ?? saved.shopCode
    if (!code) continue
    // 別店舗でログイン中なら前の店舗ぶんは持ち込まない
    if (current && code !== current) continue
    const key = _key(it.kind, code, it.resourceId)
    _queue.set(key, {
      key, kind: it.kind, shopCode: code, resourceId: it.resourceId ?? '',
      rev: Number.isFinite(it.rev) ? it.rev : 0,
      payload: it.payload,
    })
  }
  if (_queue.size === 0) { drop(); return }
  // 復元後の採番が既存 rev と衝突しないよう、保存時点の最大値から続ける
  _rev = Math.max(Number.isFinite(saved.rev) ? saved.rev : 0, ...[..._queue.values()].map(e => e.rev), 0)
  _syncSize()
  saveState.value = _pendingSize.value > 0 ? 'pending' : 'idle'
  // 落とした項目があれば、端末側の記録も現在の内容へ合わせる
  _persistPending()
}

function _restoreRejected() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.rejectedSaves)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (Array.isArray(saved)) rejectedSaves.value = saved.filter(r => r && typeof r === 'object')
  } catch (_) {}
}

_restorePending()
_restoreRejected()

function _settle() {
  _syncSize()
  saveState.value = _pendingSize.value === 0 ? 'idle' : 'pending'
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
  // 送信中にアカウントが切り替わったか。401 で shopCode が空になった場合も含む。
  const stale = () => generation !== _saveGeneration || code !== shopCode.value
  const before = _pendingSize.value

  // rev 昇順＝発生順に送る。送信中に新しい版が入っても、その項目は次のdrainで送る。
  // 対象は現在の店舗ぶんだけ（別店舗の未送信データを送らない＝アカウント境界）。
  for (const entry of _activeEntries().sort((a, b) => a.rev - b.rev)) {
    if (stale()) return
    const ep = _ENDPOINT[entry.kind]
    if (!ep) { _queue.delete(entry.key); continue }
    try {
      await _api(ep.path(code), { method: ep.method, body: JSON.stringify(entry.payload) })
      if (stale()) return
      _ack(entry.kind, code, entry.resourceId, entry.rev)
    } catch (err) {
      const cls = _classify(err)
      // 401 の判定は stale より先に行う。api.js の失効ハンドラが同期的に shopCode を
      // 空にするため、stale で先に抜けると認証失効を検知できず再送を続けてしまう。
      // saveState は現在の店舗ぶんの件数から決め直す。401 で shopCode が空になった
      // 直後に 'saving' のまま残すと、ログアウト後の画面に空のバナーが出続ける。
      if (cls === 'auth') { _authBlocked = true; _settle(); return }
      if (stale()) return
      if (cls === 'permanent') {
        _queue.delete(entry.key)
        _syncSize()
        _reject(entry.kind, code, entry.resourceId, err)
        continue
      }
      break   // retry可能な失敗。以降はまとめて次回へ
    }
  }

  _syncSize()
  // 1件も減らせなければ失敗回数を進める（＝間隔を空け、UIの警告を強める）
  if (_pendingSize.value > 0 && _pendingSize.value >= before) saveFailures.value++
  else if (_pendingSize.value > 0) saveFailures.value = 0
  _settle()
  if (saveState.value === 'pending') _scheduleRetry()
}

onReconnect(() => retryPendingSaves())

// 起動直後に呼ぶ。前回のアプリ終了時に残っていた未送信分をここから再送し始める
// （接続復帰イベントは待たない＝起動時点で既にオンラインなら即座に送る）。
export function resumePendingSaves() {
  if (_pendingSize.value === 0) return false
  retryPendingSaves()
  return true
}

// 拒否された保存の通知をユーザーが読んだあと消す（内容は復元できないので確認のみ）。
export function dismissRejectedSaves() {
  rejectedSaves.value = []
  _persistRejected()
}

/**
 * 401 で認証が失効したときに、**ローカルを消す前に**呼ぶ（App.vue の失効ハンドラ）。
 *
 * 失効ハンドラは shopCode を空にしてから業務データを消す。その前にここで
 *  - 再送を止める（無駄な401を積み重ねない）
 *  - 未送信分を元の shopCode に紐付けて端末へ書く
 * を済ませておかないと、失効の原因になった最新版がそのまま失われる。
 *
 * @param {string} code 失効した時点の店舗コード
 */
export function noteAuthInvalidated(code) {
  _authBlocked = true
  if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null }
  // 直接保存の catch がまだ走っていない場合に備え、現在分を確実に書き出す
  _persistPending()
  _persistRejected()
  return code ?? shopCode.value
}

/**
 * 再ログイン後に呼ぶ。認証失効で止めていた再送を再開する。
 * 送るのは現在の店舗ぶんだけなので、別店舗へログインした場合は旧店舗の
 * 未送信データを送らない（_drain の _activeEntries）。
 */
export function clearAuthBlock() {
  const wasBlocked = _authBlocked
  _authBlocked = false
  _syncSize()
  if (_pendingSize.value > 0) { saveState.value = 'pending'; retryPendingSaves() }
  return wasBlocked
}

/**
 * 保存の共通処理。直接送ってみて、失敗したらキューへ入れる。
 *
 * 同じ対象への保存は**直列化する**。A→Bの順に投げても応答がB→Aの順で返ると、
 * サーバーへ届く順まで入れ替わって古いAが最終値になりうる。Aが決着してからBを送る。
 *
 * @returns {Promise<{ ok: boolean, result: any }>} ok = サーバーへ保存済み
 */
function _save(kind, resourceId, payload) {
  if (!shopCode.value || !BASE) return Promise.resolve({ ok: false, result: null })
  const code = shopCode.value
  const key  = _key(kind, code, resourceId)
  const prev = _inflight.get(key)
  // 先行が無ければ待たずに送る（要求を1tick遅らせない）。
  // 先行があれば決着を待ってから送る。成否は問わない — 失敗はキューが引き継ぐので、
  // ここで守るのは順序だけ。
  const run = prev
    ? prev.catch(() => {}).then(() => _sendOnce(kind, code, resourceId, payload))
    : _sendOnce(kind, code, resourceId, payload)
  _inflight.set(key, run)
  run.finally(() => { if (_inflight.get(key) === run) _inflight.delete(key) })
  return run
}

async function _sendOnce(kind, code, resourceId, payload) {
  const generation = _saveGeneration
  const rev = ++_rev
  const ep  = _ENDPOINT[kind]
  // アカウント切替で捨てられた要求は送らない（別アカウントへ書き込まない）
  if (generation !== _saveGeneration) return { ok: false, result: null }
  saveState.value = 'saving'
  try {
    const result = await _api(ep.path(code), { method: ep.method, body: JSON.stringify(payload) })
    if (generation !== _saveGeneration) return { ok: false, result: null }
    // 自分より古い待ち項目を捨てる（古い版で上書きされるのを防ぐ）
    _ack(kind, code, resourceId, rev)
    _settle()
    return { ok: true, result }
  } catch (err) {
    // アカウント切替（別店舗ログイン・削除）だけが「捨ててよい」。
    // shopCode が空になっただけの状態（401の失効ハンドラ）では捨てない。
    // ここで捨てると 401 を起こした最新版そのものが失われる。
    if (generation !== _saveGeneration) return { ok: false, result: null }
    const cls = _classify(err)
    if (cls === 'permanent') {
      _reject(kind, code, resourceId, err)
      _settle()
      return { ok: false, result: null }
    }
    if (cls === 'auth') _authBlocked = true
    _enqueue(kind, code, resourceId, rev, payload)
    // 現在の店舗ぶんの件数から状態を決める（401 直後は shopCode が空なので idle に戻る）
    _settle()
    _scheduleRetry()
    return { ok: false, result: null }
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
  return (await _save('config', '', configData)).ok
}

// ── 棚卸データ ────────────────────────────────────────────────────────────────
export async function loadInventoryFromD1() {
  if (!shopCode.value) return null
  return _api(`/store/${shopCode.value}/inventory`).catch(() => null)
}

export async function saveInventoryToD1(inventoryData) {
  return (await _save('inventory', '', inventoryData)).ok
}

// ── 棚卸履歴 ──────────────────────────────────────────────────────────────────
export async function loadHistoryFromD1() {
  if (!shopCode.value) return null
  return _api(`/store/${shopCode.value}/history`).catch(() => null)
}

/**
 * スナップショットを D1 へ保存する。
 *
 * 識別子は **sessionId**。日付にすると同じ日の2回目の棚卸が1回目のキュー項目を
 * 潰し、片方がサーバーへ届かないまま消えていた。sessionId を持たない legacy 行
 * （過去取込・旧データ）だけ日付へ落とす。D1 側の一意制約も同じ形（migration 0012）。
 *
 * @returns {Promise<{ ok: boolean, result: any }>}
 *   ok = D1へ保存済み。result はサーバー応答（serverRevision / serverSavedAt）。
 *   ok:false は未送信キューへ入れた（端末には残る）ことを意味する。
 */
export async function saveSnapshotToD1(snapshot) {
  return _save('snapshot', _resourceId('snapshot', snapshot), snapshot)
}

// ── 過去棚卸の取込（IMPORT-001）────────────────────────────────────────────────
//
// 未送信キュー（_save）へは載せない。取込は「サーバーに入ったことを確認してから
// 完了と表示する」契約なので、成功／失敗をそのまま呼び出し側へ返す。
// 端末にだけ入った状態を「取り込めた」と見せないため。

/** 1日ぶんを取り込む。原子的・冪等（同じ batchId + date の再送で増えない）。 */
export async function importPastSessionToD1(importBatchId, payload) {
  if (!shopCode.value || !BASE) throw new Error('店舗が未設定です')
  return _api(`/store/${shopCode.value}/imports/${encodeURIComponent(importBatchId)}/sessions`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** 取込バッチをまとめて取り消す。戻り値の removed が実際にサーバーで消えた件数。 */
export async function cancelPastImportOnD1(importBatchId) {
  if (!shopCode.value || !BASE) throw new Error('店舗が未設定です')
  return _api(`/store/${shopCode.value}/imports/${encodeURIComponent(importBatchId)}`, { method: 'DELETE' })
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
  return (await _save('order', _resourceId('order', order), order)).ok
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
  return (await _save('movement', _resourceId('movement', movement), movement)).ok
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
  _inflight.clear()
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
  try { localStorage.removeItem(STORAGE_KEYS.rejectedSaves) } catch (_) {}
}
