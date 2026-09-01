import { reactive, computed, ref, watch } from 'vue'
import { deviceId, deviceName } from './useDeviceId.js'
import { STORAGE_KEYS } from '../utils/storageKeys.js'
import { HTTP_BASE, WS_BASE as WORKER_URL } from '../utils/api.js'
import { shopCode } from './useStore.js'

function _saveSession() {
  if (!state.roomCode || state.mode === 'idle') return
  try { localStorage.setItem(STORAGE_KEYS.syncSession, JSON.stringify({ roomCode: state.roomCode, roomType: state.roomType, mode: state.mode, sessionId: state.sessionId })) } catch (_) {}
}

function _clearSession() {
  try { localStorage.removeItem(STORAGE_KEYS.syncSession) } catch (_) {}
}

// ── ホストトークン管理（店舗コード×種類ごとに保持）────────────────────────────
function _hostTokenKey(type = state.roomType) {
  if (!shopCode.value) return null
  const suffix = type === 'order' ? ':order' : ''
  return `${STORAGE_KEYS.hostTokenPrefix}${shopCode.value}${suffix}`
}
function _loadHostToken(type) {
  const key = _hostTokenKey(type)
  return key ? (localStorage.getItem(key) ?? '') : ''
}
function _saveHostToken(token, type) {
  const key = _hostTokenKey(type)
  if (key && token) try { localStorage.setItem(key, token) } catch (_) {}
}
export function clearHostToken(type) {
  const key = _hostTokenKey(type)
  if (key) try { localStorage.removeItem(key) } catch (_) {}
}

/**
 * 指定 key が指定 token のままなら消す（await をまたぐ解散用）。
 * key も token も**待機前に捕まえた値**を渡すこと。
 */
function _clearHostTokenIf(key, token) {
  if (!key || !token) return false
  try {
    if (localStorage.getItem(key) !== token) return false
    localStorage.removeItem(key)
    return true
  } catch (_) { return false }
}

/**
 * 接続世代。**新しい接続を張るたび**に進む（解散・退出では進まない）。
 *
 * 呼び出し側（App）が「解散通知の遅延処理を実行してよいか」を判断するために使う。
 * App の session lifecycle 世代だけでは、**同じ pendingSession のまま新しいルームを
 * 作る**場合を検出できない（`SyncModal` は `begin()` を呼ばないので世代が変わらない）。
 * 旧ルームのタイマーが、新ルームで使用中のセッション・在庫を消せてしまう。
 */
let _connectGeneration = 0
export function captureSyncConnection() { return { gen: _connectGeneration } }
export function isSyncConnectionStale(token) {
  return !token || token.gen !== _connectGeneration
}
export function hasHostToken(type) {
  return !!_loadHostToken(type)
}

// 接続有無に関わらず、保存済みホストトークンで残存ルームを解散する（退室済みルームの掃除）
export async function dissolveRoomRemote(type = 'stock') {
  const code  = shopCode.value
  const token = _loadHostToken(type)
  // 削除対象の key も**待機前に**確定させる。`clearHostToken()` は現在の shopCode から
  // key を作り直すため、fetch を待つ間に店舗が変わると別店舗の token を消してしまう。
  const key   = _hostTokenKey(type)
  if (code && token && HTTP_BASE) {
    try {
      await fetch(`${HTTP_BASE}/room/${code}/dissolve${_typeQuery(type)}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ hostToken: token }),
      })
    } catch (_) {}
  }
  // 捕まえた key が、捕まえた token のままの場合だけ消す。
  // 同じ店舗でも新しいルームを作っていれば token は差し替わっているので消さない。
  _clearHostTokenIf(key, token)
}

// ルームの現在状態を取得（退室中ホストがゲストのライブ品目数を一覧表示するため）
export async function fetchRoomStatus(code, type = 'stock') {
  if (!code || !HTTP_BASE) return null
  try {
    const r = await fetch(`${HTTP_BASE}/room/${code}/status${_typeQuery(type)}`)
    if (!r.ok) return null
    return await r.json()
  } catch (_) { return null }
}

// 完了後ゲスト閲覧: 金額抜きの結果スナップショットを取得（閲覧期間外・未完了なら null）
export async function fetchRoomResult(code, sessionId) {
  if (!code || !sessionId || !HTTP_BASE) return null
  try {
    const r = await fetch(`${HTTP_BASE}/room/${code}/result?s=${encodeURIComponent(sessionId)}`)
    if (!r.ok) return null
    const body = await r.json().catch(() => null)
    return body?.result ?? null
  } catch (_) { return null }
}

// ── モジュールスコープ シングルトン ───────────────────────────────────────────
const state = reactive({
  mode:            'idle',
  roomCode:        null,
  roomType:        'stock', // 'stock'=棚卸 / 'order'=発注（同一shopCodeでも別DO）
  isConnected:     false,
  error:           null,
  sessionId:       null,   // 現在のセッションID（D1）
  isSessionActive: false,  // DO側のセッションアクティブフラグ
})

// 種類ごとにDOを分けるためのURLクエリ（棚卸は無し・発注は ?type=order）
function _typeQuery(type = state.roomType) {
  return type === 'order' ? '?type=order' : ''
}

const participants  = reactive({})
const messages      = reactive([])
const auditLog      = reactive([])
const unreadCount   = ref(0)
// { [ingredient]: { name: string, deviceId: string, _timer: number } }
export const typingMap            = reactive({})
export const lockedIngredients    = reactive(new Set())
export const pendingItemRequests  = reactive([])  // ホスト側: ゲストからの品目追加申請キュー
// ホスト側: ゲストからの**非表示**申請キュー。追加申請と別に持つ（承認したときの動作が逆で、
// 1つのキューに混ぜると承認ボタンがどちらの意味か画面から読めなくなる）。
export const pendingHideRequests  = reactive([])

let _ws              = null
// WebSocket は onopen まで `_ws` に入らない。CONNECTING中のsocketも追跡しないと、
// 解散・退出・account resetがそれを閉じられず、後から旧ルームへjoinできてしまう。
let _connectingWs    = null
let _reconnectTimer  = null
let _heartbeatTimer  = null
let _reconnectCount  = 0
let _disconnectedAt  = 0   // 切断時刻（再接続時マージ判定に使用）
let _joinSessionId   = null  // ゲスト参加時に提示する招待リンクのセッションID（鍵）
const RECONNECT_DELAYS = [1500, 3000, 6000, 12000, 30000]

// DO から届くエラーコード → ユーザー向けメッセージ（接続時・接続中で共用）
const WS_ERROR_MESSAGES = {
  room_not_found:     'ルームが存在しません',
  session_not_active: 'ホストがまだセッションを開始していません。ホストが「棚卸ルームを開始」するまでお待ちください。',
  room_full:          'ルームが満員です（上限20名）',
  name_taken:         'この端末名は既にルーム内で使用されています。設定から別の名前に変更してください。',
  auth_failed:        'ホスト認証に失敗しました。この端末はホスト権限がありません。',
  invalid_link:       'この招待リンクは無効です。最新の招待リンク／QRをホストから受け取ってください。',
}

// ── deviceName 変更を即時反映 ─────────────────────────────────────────────────
let _prevDeviceName = deviceName.value
let _skipRename = false

watch(deviceName, (newName, oldName) => {
  if (_skipRename) { _skipRename = false; return }
  _prevDeviceName = oldName ?? ''
  const name = newName || '名前未設定'
  if (participants[deviceId]) {
    participants[deviceId].name = name
  }
  if (_ws?.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify({ type: 'rename', deviceName: name }))
  }
})

// ── コールバック ──────────────────────────────────────────────────────────────
let _onItemUpdate     = null
let _onItemRemove     = null
let _onItemAddRequest  = null
let _onItemAddResponse = null
let _onItemHideRequest  = null
let _onItemHideResponse = null
let _onRecountFlag    = null
let _getInventory     = null
let _getRecountFlags  = null
let _getConfig        = null
let _onConfigReceived = null
let _onResetConfig    = null
let _onDone           = null
let _onMessage        = null
let _onDissolved      = null
let _onConflict       = null
let _onConflictQueue  = null   // 同時入力（3s以内）キュー: ユーザーが解決を選択
let _onConflictNotify = null   // ホスト向け競合発生通知
let _onNameTaken      = null
let _onParticipantJoin  = null
let _onParticipantLeave = null
let _onGuestLeave       = null
let _onRemoteUpdate     = null
let _onClearInventory   = null
let _onSessionStarted   = null
let _onSessionEnded     = null
let _onNewSessionStarted = null  // ゲスト参加中に新規セッションが開始された
let _expectedSessionId   = null  // _reconnectToRoom が設定する期待セッションID
let _onOrderUpdate       = null  // 発注数のリモート更新
let _onOrderRemove       = null  // 発注数のリモート取り消し
let _onOrdersSnapshot    = null  // 参加/新セッション時の発注数一括同期
let _getOrders           = null  // session_start 時に現在の発注下書きを送るための getter

export function setInventoryCallbacks(onUpdate, onRemove) { _onItemUpdate = onUpdate; _onItemRemove = onRemove }
export function setItemAddRequestCallback(fn)  { _onItemAddRequest  = fn }
export function setItemAddResponseCallback(fn) { _onItemAddResponse = fn }
export function setItemHideRequestCallback(fn)  { _onItemHideRequest  = fn }
export function setItemHideResponseCallback(fn) { _onItemHideResponse = fn }
export function setRecountFlagCallback(fn)   { _onRecountFlag = fn }
export function registerInventoryGetter(fn)  { _getInventory = fn }
export function registerRecountFlagsGetter(fn) { _getRecountFlags = fn }
export function registerConfigGetter(fn)     { _getConfig = fn }
export function setConfigCallback(fn)        { _onConfigReceived = fn }
export function setResetConfigCallback(fn)   { _onResetConfig = fn }
export function setDoneCallback(fn)          { _onDone = fn }
export function setMessageCallback(fn)       { _onMessage = fn }
export function setDissolvedCallback(fn)     { _onDissolved = fn }
export function setConflictCallback(fn)        { _onConflict       = fn }
export function setConflictQueueCallback(fn)   { _onConflictQueue  = fn }
export function setConflictNotifyCallback(fn)  { _onConflictNotify = fn }
export function setNameTakenCallback(fn)     { _onNameTaken = fn }
export function setParticipantJoinCallback(fn)  { _onParticipantJoin  = fn }
export function setParticipantLeaveCallback(fn) { _onParticipantLeave = fn }
export function setGuestLeaveCallback(fn)       { _onGuestLeave       = fn }
export function setRemoteUpdateCallback(fn)     { _onRemoteUpdate     = fn }
export function setClearInventoryCallback(fn)   { _onClearInventory   = fn }
export function setSessionStartedCallback(fn)   { _onSessionStarted   = fn }
export function setSessionEndedCallback(fn)     { _onSessionEnded     = fn }
export function setNewSessionStartedCallback(fn) { _onNewSessionStarted = fn }
export function setExpectedSessionId(id)         { _expectedSessionId   = id }
export function setOrderCallbacks(onUpdate, onRemove) { _onOrderUpdate = onUpdate; _onOrderRemove = onRemove }
export function setOrdersSnapshotCallback(fn)    { _onOrdersSnapshot = fn }
export function registerOrdersGetter(fn)         { _getOrders = fn }
export function markMessagesRead()           { unreadCount.value = 0 }

// ルーム経由で新しい監査エントリが確定したときの通知（D1 への保存に使う）
let _onAuditEntry = null
export function setAuditEntryCallback(fn) { _onAuditEntry = fn }

// 変更履歴の保持上限。参加者別の重複カウントと品目ごとの履歴の正本なので、
// 品目数を大きく上回る件数（1品目を複数人が直す）を持てる必要がある。
// メモリ上の配列なので実用上は上限に当たらないが、暴走時の歯止めとして残す。
// worker 側の MAX_AUDIT_LOG と揃えること。
export const MAX_AUDIT_ENTRIES = 5000

function _capAuditLog() {
  if (auditLog.length > MAX_AUDIT_ENTRIES) auditLog.splice(0, auditLog.length - MAX_AUDIT_ENTRIES)
}

export function addLocalAuditEntry(entry) {
  if (!entry?.id || auditLog.some(e => e.id === entry.id)) return
  auditLog.push(entry)
  _capAuditLog()
}

export function clearAuditLog() {
  auditLog.splice(0, auditLog.length)
}

/**
 * 監査ログ（変更履歴）を取り込む。**置き換えではなく統合する。**
 *
 * ルームに入る前にソロで記録した分は `local-` id で端末にしかなく、DO 側の
 * auditLog には入っていない。init を splice で丸ごと置き換えると、
 * 途中でルームを作る／入り直すたびに、そこまでの変更履歴が消える。
 * 下書きから復元した分も同じ理由でここを通す。
 *
 * id で重複を除き、時刻順に並べ直してから上限で切る。
 */
export function mergeAuditLog(incoming = []) {
  if (!Array.isArray(incoming) || incoming.length === 0) return
  const seen = new Set(auditLog.map(e => e.id))
  for (const entry of incoming) {
    if (!entry?.id || seen.has(entry.id)) continue
    seen.add(entry.id)
    auditLog.push(entry)
  }
  auditLog.sort((a, b) => (a?.timestamp ?? 0) - (b?.timestamp ?? 0))
  _capAuditLog()
}

// ── 送信 API ──────────────────────────────────────────────────────────────────
export function broadcastConfig(cfg) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'config', ...cfg }))
}

// 同時入力とみなす時間窓（WS往復遅延を考慮）
export const CONFLICT_WINDOW_MS = 3000

// 受信した update をどう扱うかの純粋判定（テスト容易化のため抽出）
//   'remote-new' = 自分は未入力          → 通常適用
//   'conflict'   = 自分の入力(localEntry)から3秒以内 → 競合キューへ
//   'overwrite'  = 時間差更新            → トースト＋リモート値適用
export function classifyIncomingUpdate(local, now = Date.now()) {
  if (!local) return 'remote-new'
  const msSinceLocalEdit = now - (local.updatedAt ?? 0)
  if (local.localEntry && msSinceLocalEdit < CONFLICT_WINDOW_MS) return 'conflict'
  return 'overwrite'
}

function _entryDiffers(a, b) {
  return (a.qty !== b.qty) || ((a.unit ?? '') !== (b.unit ?? ''))
}

// 再接続時、オフライン中に分岐した1品目をどう解決するか（純粋・テスト容易化）。
// disc = 切断時刻。updatedAt がそれより後なら「オフライン中に変更した」と判定する。
//   'conflict' = 自分・相手の両方が変更し値が異なる → 人が選ぶ（競合キュー）
//   'local'    = 自分の変更が正（相手は未変更/同値、または自分がオフラインで追加）→ 再送信
//   'server'   = 自分は未変更 → サーバー値を採用
//   null       = 双方に無し等、何もしない
export function resolveOfflineItem(local, server, disc) {
  const localChanged  = !!local  && (local.updatedAt  ?? 0) > disc
  const serverChanged = !!server && (server.updatedAt ?? 0) > disc
  if (localChanged && serverChanged && _entryDiffers(local, server)) return 'conflict'
  if (localChanged) return 'local'
  if (server) return 'server'
  return null
}

export function broadcastUpdate(ingredient, qty, unit, enteredBy = '', isAdd = false) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'update', ingredient, qty, unit: unit ?? '', enteredBy, isAdd }))
}

export function broadcastRemove(ingredient) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'remove', ingredient }))
}

// 発注数の同期（発注ルーム専用・在庫とは別チャネル）。
export function broadcastOrderUpdate(ingredient, orderQty, unit = '', lot = 1, enteredBy = '') {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'order_update', ingredient, orderQty, unit: unit ?? '', lot: lot ?? 1, enteredBy }))
}

export function broadcastOrderRemove(ingredient) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'order_remove', ingredient }))
}


export function broadcastRecountFlag(ingredient, on) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'recount_flag', ingredient, on: !!on }))
}

export function broadcastDone(isFinal = false) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'done', isFinal }))
}

export function broadcastUndone() {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'undone' }))
}

export function broadcastSessionStart(sessionId) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  state.sessionId       = sessionId
  state.isSessionActive = true
  // 現在のローカル在庫＋品目リストをまとめて送り、DO側で原子的に保存させる
  // → ゲストはどのタイミングで参加しても完全なスナップショット（在庫＋品目）を受け取れる
  const inv    = _getInventory?.() ?? {}
  const cfg    = _getConfig?.() ?? null
  const flags  = _getRecountFlags?.() ?? {}
  const orders = _getOrders?.() ?? {}
  _ws.send(JSON.stringify({ type: 'session_start', sessionId, inventory: inv, config: cfg, recountFlags: flags, orders }))
}

export function broadcastSessionEnd(status = 'completed') {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'session_end', status }))
}

export function broadcastMessage(text, replyTo = null) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'message', text, replyTo }))
}

// メッセージの送信取り消し（自分のメッセージのみ・サーバー側で所有者検証）
export function broadcastMessageDelete(id) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'message_delete', id }))
}

export function broadcastTyping(ingredient, active) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'typing', ingredient, active }))
}

function _setTyping(ingredient, did, name) {
  if (typingMap[ingredient]?._timer) clearTimeout(typingMap[ingredient]._timer)
  // 10秒無通知で自動クリア（WS切断でtyping_stopが来なかった場合の保険）
  const _timer = setTimeout(() => { if (typingMap[ingredient]?.deviceId === did) delete typingMap[ingredient] }, 10000)
  typingMap[ingredient] = { name, deviceId: did, _timer }
}

function _clearTyping(ingredient, did) {
  if (typingMap[ingredient]?.deviceId === did) {
    clearTimeout(typingMap[ingredient]._timer)
    delete typingMap[ingredient]
  }
}

function _clearAllTypingByDevice(did) {
  for (const ing of Object.keys(typingMap)) _clearTyping(ing, did)
}

export function broadcastConflictNotify(ingredient, fromName, guestQty, guestUnit, hostQty, hostUnit) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'conflict_notify', ingredient, fromName, guestQty, guestUnit, hostQty, hostUnit }))
}

export function broadcastItemAddRequest(name, unit, code, requestId) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'item_add_request', name, unit: unit ?? '', code: code ?? '', requestId }))
}

export function broadcastItemAddResponse(requestId, approved, name) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'item_add_response', requestId, approved, name }))
}

export function dismissItemAddRequest(requestId) {
  const idx = pendingItemRequests.findIndex(r => r.requestId === requestId)
  if (idx !== -1) pendingItemRequests.splice(idx, 1)
}

// 非表示の申請（ゲスト → ホスト）。ゲストは自分の端末では隠さない。
// 品目リストの正はホストで、ゲストが勝手に隠すと次の broadcastConfig で戻るだけになり、
// 「消えたのに戻った」ように見える。承認された結果が config で降りてくるのを待つ。
export function broadcastItemHideRequest(name, requestId) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'item_hide_request', name, requestId }))
}

export function broadcastItemHideResponse(requestId, approved, name) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'item_hide_response', requestId, approved, name }))
}

export function dismissItemHideRequest(requestId) {
  const idx = pendingHideRequests.findIndex(r => r.requestId === requestId)
  if (idx !== -1) pendingHideRequests.splice(idx, 1)
}

// 解決済み競合をキューから除去
let _conflictQueue = []

function _syncConflictLock() {
  lockedIngredients.clear()
  for (const c of _conflictQueue) lockedIngredients.add(c.ingredient)
  if (_ws?.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify({ type: 'conflict_lock', ingredients: [...lockedIngredients] }))
  }
}

export function dismissConflict(ingredient) {
  _conflictQueue = _conflictQueue.filter(c => c.ingredient !== ingredient)
  _onConflictQueue?.([..._conflictQueue])
  _syncConflictLock()
}

// 再接続時のオフライン分岐マージ（ホスト・ゲスト共通）。品目ごとに updatedAt で解決し、
// 「自分だけ変更」は再送信、「相手だけ変更」はサーバー値を適用、
// 「両方が変更して値が違う」は競合として扱う。
//   ホスト: 自分の競合キューへ積み、UI（sum/mine/theirs）で確定する。
//   ゲスト: 解決権はホスト側にあるため、自分の値をロックしてホストへ競合を通知する
//           （ライブ競合と同じ経路。ホストが確定 → update をブロードキャスト → 反映）。
function _mergeOnReconnect(serverInv, disc) {
  const localInv = { ...(_getInventory?.() ?? {}) }
  const names = new Set([...Object.keys(localInv), ...Object.keys(serverInv)])
  const isHost = state.mode === 'hosting'
  let hostConflicts = 0
  for (const name of names) {
    const local  = localInv[name]
    const server = serverInv[name]
    switch (resolveOfflineItem(local, server, disc)) {
      case 'conflict':
        if (isHost) {
          const entry = { ingredient: name, remoteQty: server.qty, remoteUnit: server.unit ?? '', remoteBy: server.enteredBy ?? '', local }
          const idx = _conflictQueue.findIndex(c => c.ingredient === name)
          if (idx === -1) _conflictQueue.push(entry)
          else            _conflictQueue[idx] = entry
          hostConflicts++
          _onConflictNotify?.(name, server.enteredBy ?? '')
        } else {
          lockedIngredients.add(name)
          broadcastConflictNotify(name, server.enteredBy ?? '', local.qty, local.unit ?? '', server.qty, server.unit ?? '')
        }
        break
      case 'local':
        broadcastUpdate(name, local.qty, local.unit ?? '', local.enteredBy ?? '')
        break
      case 'server':
        _onItemUpdate?.(name, server.qty, server.unit ?? '', server.enteredBy ?? '', server.updatedAt)
        break
    }
  }
  if (hostConflicts > 0) {
    _onConflictQueue?.([..._conflictQueue])
    _syncConflictLock()
  }
}

// ── 内部ヘルパー ──────────────────────────────────────────────────────────────
function _startHeartbeat() {
  _stopHeartbeat()
  _heartbeatTimer = setInterval(() => {
    if (_ws?.readyState === WebSocket.OPEN) _ws.send(JSON.stringify({ type: 'ping' }))
  }, 25000)
}

function _stopHeartbeat() {
  if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null }
}

function _clearReconnectTimer() {
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null }
}

function _updateParticipants(list, notify = false) {
  const incoming = new Set(list.map(p => p.deviceId))
  // 退出検出
  for (const id of Object.keys(participants)) {
    if (!incoming.has(id)) {
      const info = participants[id]
      if (notify && info && !info.isMe) {
        _addSysMsg(`${info.name} が退出しました`)
        _onParticipantLeave?.(info.name)
      }
      delete participants[id]
      _clearAllTypingByDevice(id)  // 退出時に入力中インジケータを消す
    }
  }
  // 入室検出 & 名前更新
  for (const p of list) {
    if (notify && !participants[p.deviceId] && p.deviceId !== deviceId) {
      _addSysMsg(`${p.deviceName} が参加しました`)
      _onParticipantJoin?.(p.deviceName)
      if (state.mode === 'hosting' && _conflictQueue.length > 0) _syncConflictLock()
    }
    const oldName = participants[p.deviceId]?.name
    const newName = p.deviceName
    if (oldName && oldName !== newName) {
      for (const entry of auditLog) {
        if (entry.enteredById === p.deviceId) entry.enteredBy = newName
      }
    }
    participants[p.deviceId] = { name: p.deviceName, isMe: p.deviceId === deviceId, isDone: !!p.isDone }
  }
}

function _addSysMsg(text) {
  messages.push({
    id:        `sys-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    text,
    isSystem:  true,
    timestamp: Date.now(),
    senderId:  'system',
    senderName: 'system',
  })
}

function _resetClientState() {
  _clearReconnectTimer()
  _stopHeartbeat()
  _clearSession()
  _disconnectedAt       = 0
  state.mode            = 'idle'
  state.roomCode        = null
  state.roomType        = 'stock'
  state.isConnected     = false
  state.error           = null
  state.sessionId       = null
  state.isSessionActive = false
  Object.keys(participants).forEach(k => delete participants[k])
  Object.keys(typingMap).forEach(k => { clearTimeout(typingMap[k]?._timer); delete typingMap[k] })
  messages.splice(0, messages.length)
  auditLog.splice(0, auditLog.length)
  pendingItemRequests.splice(0, pendingItemRequests.length)
  pendingHideRequests.splice(0, pendingHideRequests.length)
  lockedIngredients.clear()
  _conflictQueue = []
  _joinSessionId = null
  _expectedSessionId = null
  unreadCount.value = 0
}

// アカウント削除・切替時の強制切断。再接続timerと旧店舗の同期データを残さない。
// 通常の退室通知やguest callbackは不要なため、leaveRoomとは分ける。
export function resetAccountData() {
  state.mode = 'idle'
  state.roomCode = null
  if (_connectingWs) {
    const pending = _connectingWs
    try { pending.close(1000, 'Account reset') } catch (_) {}
    if (_connectingWs === pending) _connectingWs = null
  }
  if (_ws) {
    try { _ws.close(1000, 'Account reset') } catch (_) {}
    _ws = null
  }
  _resetClientState()
}

function _handleMessage(msg) {
  if (state.mode === 'idle') return
  switch (msg.type) {
    case 'joined': {
      const serverInv = msg.inventory ?? {}

      // 切断からの復帰（ホスト・ゲスト共通）。初回接続は _disconnectedAt === 0。
      const reconnecting = _disconnectedAt > 0

      // 初回参加のゲストのみローカルを破棄してホスト状態を採用する。
      // 再接続ではオフライン中の入力を _mergeOnReconnect で保全するため破棄しない。
      if (state.mode === 'joining' && !reconnecting) {
        _onClearInventory?.()
      }

      // ホスト新規接続（_disconnectedAt=0）の場合、DO在庫を適用するのは
      // _reconnectToRoom が「同一セッション」と判断して設定した期待IDと一致する時のみ。
      // 新規セッション作成・別セッション復帰では DO の旧在庫をスキップし、
      // ローカル在庫（ホストが入力済みのデータ）を正とする。
      const skipInventory = state.mode === 'hosting'
        && _disconnectedAt === 0
        && (!_expectedSessionId || msg.sessionId !== _expectedSessionId)
      _expectedSessionId = null

      if (reconnecting) {
        // オフライン中の分岐を品目ごとに updatedAt で解決（消失・分岐・再送レースを防ぐ）
        _mergeOnReconnect(serverInv, _disconnectedAt)
      } else if (!skipInventory) {
        for (const [ingredient, entry] of Object.entries(serverInv)) {
          _onItemUpdate?.(ingredient, entry.qty, entry.unit ?? '', entry.enteredBy ?? '', entry.updatedAt)
        }
      }

      // 発注数のスナップショット同期。在庫と同じく、ホストが自分の下書きを正とする
      // 新規接続（skipInventory）のときは適用しない。それ以外（ゲスト参加・再接続）は
      // DO の共有状態へ揃える。
      if (!skipInventory && msg.orders && typeof msg.orders === 'object') {
        _onOrdersSnapshot?.(msg.orders)
      }

      _disconnectedAt = 0

      _updateParticipants(msg.participants ?? [])
      participants[deviceId] = { name: deviceName.value || '名前未設定', isMe: true }

      if (state.mode === 'joining') {
        if (msg.config?.order?.length) {
          _onConfigReceived?.(msg.config)
        } else {
          _onResetConfig?.()
        }
        const serverFlags = msg.recountFlags ?? {}
        const localFlags  = _getRecountFlags?.() ?? {}
        for (const item of Object.keys(localFlags)) {
          if (!serverFlags[item]) _onRecountFlag?.(item, false)
        }
        for (const [item, info] of Object.entries(serverFlags)) {
          _onRecountFlag?.(item, true, info?.by ?? '', info?.at)
        }
      }
      if (Array.isArray(msg.messages)) {
        messages.splice(0, messages.length, ...msg.messages)
      }
      // 在庫をスキップした場合は監査ログもスキップ（ホスト自身のログを保持）
      if (!skipInventory) mergeAuditLog(msg.auditLog)
      state.isSessionActive = msg.isSessionActive ?? false
      state.sessionId       = msg.sessionId ?? null
      if (msg.hostToken) _saveHostToken(msg.hostToken)
      break
    }

    case 'update':
      if (msg.fromDeviceId !== deviceId) {
        const currentInv = _getInventory?.()
        const local = currentInv?.[msg.ingredient]
        if (local) {
          // localEntry フラグが無い値（リモート同期で入った値）は競合対象にしない
          if (classifyIncomingUpdate(local) === 'conflict') {
            if (state.mode === 'hosting') {
              // ホスト: 自分が競合を検知 → キューに積む（既存エントリは上書き）
              const idx = _conflictQueue.findIndex(c => c.ingredient === msg.ingredient)
              const entry = { ingredient: msg.ingredient, remoteQty: msg.qty, remoteUnit: msg.unit ?? '', remoteBy: msg.enteredBy ?? '', local }
              if (idx === -1) _conflictQueue.push(entry)
              else            _conflictQueue[idx] = entry
              _onConflictQueue?.([..._conflictQueue])
              _syncConflictLock()
              _onConflictNotify?.(msg.ingredient, msg.enteredBy ?? '')
            } else {
              // ゲスト: ローカルキューには積まずホストへ通知（qty付き）
              // ホストからの conflict_lock を待たず即座にロックして変更を阻止
              lockedIngredients.add(msg.ingredient)
              broadcastConflictNotify(msg.ingredient, msg.enteredBy ?? '', local.qty, local.unit ?? '', msg.qty, msg.unit ?? '')
            }
          } else {
            // 時間差あり: 相手が後から上書き → トーストのみ、リモート値を適用
            _onConflict?.(msg.ingredient, msg.qty, msg.unit ?? '', msg.enteredBy ?? '', local)
            _onItemUpdate?.(msg.ingredient, msg.qty, msg.unit ?? '', msg.enteredBy ?? '')
          }
        } else {
          // 自分が未入力の品目: 通常更新
          _onRemoteUpdate?.(msg.ingredient, msg.qty, msg.unit ?? '', msg.enteredBy ?? '')
          _onItemUpdate?.(msg.ingredient, msg.qty, msg.unit ?? '', msg.enteredBy ?? '')
        }
      }
      break

    case 'remove':
      if (msg.fromDeviceId !== deviceId) {
        _onRemoteUpdate?.(msg.ingredient, null, '', msg.enteredBy ?? '')
        _onItemRemove?.(msg.ingredient)
      }
      break

    case 'order_update':
      if (msg.fromDeviceId !== deviceId) {
        _onOrderUpdate?.(msg.ingredient, msg.orderQty, msg.unit ?? '', msg.lot ?? 1, msg.enteredBy ?? '')
      }
      break

    case 'order_remove':
      if (msg.fromDeviceId !== deviceId) {
        _onOrderRemove?.(msg.ingredient)
      }
      break

    case 'participants':
      _updateParticipants(msg.list ?? [], true)  // 通知あり
      participants[deviceId] = { name: deviceName.value || '名前未設定', isMe: true }
      break

    case 'done': {
      const sysLabel = msg.isFinal
        ? `${msg.deviceName} が棚卸を締めました ✓`
        : `${msg.deviceName} が棚卸完了を報告しました ✓`
      _addSysMsg(sysLabel)
      if (!msg.isFinal && msg.fromDeviceId && participants[msg.fromDeviceId]) {
        participants[msg.fromDeviceId].isDone = true
      }
      if (msg.fromDeviceId !== deviceId) {
        _onDone?.(msg.deviceName, msg.isFinal ?? false)
      }
      break
    }

    case 'message': {
      if (!messages.some(m => m.id === msg.id)) {
        messages.push(msg)
        if (msg.senderId !== deviceId) unreadCount.value++
      }
      _onMessage?.(msg)
      break
    }

    case 'message_deleted': {
      const i = messages.findIndex(m => m.id === msg.id)
      if (i >= 0) messages.splice(i, 1)
      break
    }

    case 'audit_entry': {
      const entry = msg.entry
      if (entry?.id && !auditLog.some(e => e.id === entry.id)) {
        auditLog.push(entry)
        _capAuditLog()
        // ルームで発生した記録も D1 へ残す（DO はルームの生存期間しか持たない）。
        _onAuditEntry?.(entry)
      }
      break
    }

    case 'config_update':
      _onConfigReceived?.(msg)
      break

    case 'recount_flag':
      if (msg.fromDeviceId !== deviceId) {
        _onRecountFlag?.(msg.ingredient, msg.on, msg.enteredBy ?? '', msg.at)
      }
      break

    case 'session_started': {
      const prevSessionId   = state.sessionId
      const isNewSession    = !!(msg.sessionId && msg.sessionId !== prevSessionId)
      state.sessionId       = msg.sessionId ?? null
      state.isSessionActive = true
      if (isNewSession) {
        for (const id of Object.keys(participants)) {
          if (participants[id]) participants[id].isDone = false
        }
      }
      // 発注数のスナップショットを反映（新規・再開いずれも）。
      if (msg.orders && typeof msg.orders === 'object') {
        _onOrdersSnapshot?.(msg.orders)
      }
      // セッションIDが変わった（新規セッション）かつゲスト接続中: 完全な状態同期を行う
      // 在庫・フラグ・品目リストをすべて session_started スナップショットで上書き
      if (isNewSession && state.mode === 'joining') {
        _onNewSessionStarted?.()
        break
      }
      _addSysMsg(isNewSession
        ? 'セッションが開始されました。参加者を招待してください。'
        : 'ホストが再接続しました。')
      _onSessionStarted?.(msg.sessionId)
      break
    }

    case 'session_ended':
      state.isSessionActive = false
      _addSysMsg(msg.status === 'completed' ? '棚卸セッションが完了しました ✓' : 'セッションが中断されました')
      _onSessionEnded?.(msg.status, msg.sessionId, msg.itemCount)
      break

    case 'dissolved':
      _addSysMsg('ルームが解散されました')
      _ws = null
      _resetClientState()
      _onDissolved?.()
      break

    case 'error':
      if (msg.code === 'name_taken' && msg.context === 'rename') {
        _skipRename = true
        _onNameTaken?.(_prevDeviceName)
      } else if (msg.code === 'session_not_active') {
        state.error    = WS_ERROR_MESSAGES.session_not_active
        state.mode     = 'idle'
        state.roomCode = null
      }
      break

    case 'typing':
      if (msg.deviceId && msg.deviceId !== deviceId) {
        if (msg.active) _setTyping(msg.ingredient, msg.deviceId, msg.deviceName ?? '')
        else            _clearTyping(msg.ingredient, msg.deviceId)
      }
      break

    case 'conflict_notify':
      if (state.mode === 'hosting') {
        // ゲストから届いた競合通知 — ホストのキューにまだ無ければ追加
        const existingIdx = _conflictQueue.findIndex(c => c.ingredient === msg.ingredient)
        if (existingIdx === -1) {
          _conflictQueue.push({
            ingredient: msg.ingredient,
            remoteQty:  msg.guestQty ?? 0,
            remoteUnit: msg.guestUnit ?? '',
            remoteBy:   msg.fromName ?? '',
            local: { qty: msg.hostQty ?? 0, unit: msg.hostUnit ?? '' },
          })
          _onConflictQueue?.([..._conflictQueue])
          _syncConflictLock()
        }
      }
      _onConflictNotify?.(msg.ingredient, msg.fromName ?? '')
      break

    case 'conflict_lock':
      lockedIngredients.clear()
      for (const ing of (msg.ingredients ?? [])) lockedIngredients.add(ing)
      break

    case 'item_add_request': {
      // Host receives approval request from a guest (routed by DO)
      const req = {
        requestId:      msg.requestId ?? '',
        name:           msg.name ?? '',
        unit:           msg.unit ?? '',
        code:           msg.code ?? '',
        fromDeviceName: msg.fromDeviceName ?? '',
        fromDeviceId:   msg.fromDeviceId ?? '',
      }
      pendingItemRequests.push(req)
      _onItemAddRequest?.(req)
      break
    }

    case 'item_add_response':
      // Guest receives approval/rejection from host
      _onItemAddResponse?.(msg.requestId ?? '', !!msg.approved, msg.name ?? '', msg.reason ?? '')
      break

    case 'item_hide_request': {
      // Host receives a hide request from a guest (routed by DO)
      const req = {
        requestId:      msg.requestId ?? '',
        name:           msg.name ?? '',
        fromDeviceName: msg.fromDeviceName ?? '',
        fromDeviceId:   msg.fromDeviceId ?? '',
      }
      // 同じ品目を2人が申請しても**両方積む**。DO は requestId ごとに申請元へ返すので、
      // 間引くと2人目は返事を受け取れないまま待ち続ける。
      // まとめて解決するのは呼び出し側（品目名でまとめて返す）。
      pendingHideRequests.push(req)
      _onItemHideRequest?.(req)
      break
    }

    case 'item_hide_response':
      // Guest receives approval/rejection from host
      _onItemHideResponse?.(msg.requestId ?? '', !!msg.approved, msg.name ?? '', msg.reason ?? '')
      break

    case 'pong':
      break
  }
}

function _connect(code) {
  const connection = ++_connectGeneration   // 新しい接続。解散通知の遅延処理を失効させる
  if (!WORKER_URL) {
    state.error = 'サーバーURLが未設定です（.env の VITE_SYNC_WORKER_URL を確認）'
    state.mode  = 'idle'
    return Promise.reject(new Error('no worker url'))
  }

  // 既存WSが残っていたら先に閉じる（古いoncloseが_ws=nullにしてループを起こすのを防ぐ）
  // ハンドラを外してから閉じる: 意図的なクローズが onclose を発火させ、
  // _ws===null を素通りして再接続タイマーを無限にスケジュールする増殖ループを防ぐ。
  _clearReconnectTimer()
  // 前の接続試行がまだopenしていなくても失効させる。各handlerは接続世代を
  // 確認するため、close後に旧Promiseがrejectしても現在のstateを変更しない。
  if (_connectingWs) {
    const stale = _connectingWs
    _connectingWs = null
    try { stale.close(1000, 'reconnect') } catch (_) {}
  }
  if (_ws) {
    const stale = _ws
    _ws = null
    stale.onopen = stale.onmessage = stale.onerror = stale.onclose = null
    try { stale.close(1000, 'reconnect') } catch (_) {}
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const isHostMode = state.mode === 'hosting'
    let hostFallbackTimer = null

    const ws    = new WebSocket(`${WORKER_URL}/room/${code}/ws${_typeQuery()}`)
    _connectingWs = ws
    const forgetConnecting = () => {
      if (_connectingWs === ws) _connectingWs = null
    }
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        if (hostFallbackTimer) { clearTimeout(hostFallbackTimer); hostFallbackTimer = null }
        ws.close()
        reject(new Error('接続タイムアウト（10秒）'))
      }
    }, 10000)

    ws.onopen = () => {
      clearTimeout(timer)
      // closeとopenが同じevent loopで競合しても、退出済み・置換済みのsocketを
      // 現役へ昇格させない。CONNECTING socketを閉じた後の遅延onopen対策。
      if (connection !== _connectGeneration || _connectingWs !== ws || state.mode === 'idle') {
        if (!settled) { settled = true; reject(new Error('接続が切り替わりました')) }
        try { ws.close(1000, 'stale connection') } catch (_) {}
        return
      }
      forgetConnecting()
      _ws             = ws
      _reconnectCount = 0
      state.isConnected = true
      state.error       = null
      _saveSession()

      ws.send(JSON.stringify({
        type:       'join',
        deviceId,
        deviceName: deviceName.value || '名前未設定',
        role:       isHostMode ? 'host' : 'guest',
        // authToken = D1認証トークン。PIN設定店舗のホスト権限（再）発行時に
        // DO 側で照合し、店舗コードを知るだけの第三者による乗っ取りを防ぐ。
        ...(isHostMode
          ? { hostToken: _loadHostToken(), authToken: localStorage.getItem(STORAGE_KEYS.authToken) || '' }
          : { joinSessionId: _joinSessionId || '' }),
      }))

      if (isHostMode) {
        // 新規接続は session_start が一括同期。オフライン切断からの再接続時は
        // 'joined' 受信時に _mergeOnReconnect が品目ごとに解決・再送する（レース排除）。
        _startHeartbeat()
        hostFallbackTimer = setTimeout(() => {
          if (!settled) { settled = true; resolve() }
        }, 3000)
      }
      // ゲスト: 'joined' または 'error' メッセージを待つ
    }

    ws.onmessage = (e) => {
      if (connection !== _connectGeneration || _ws !== ws || state.mode === 'idle') return
      try {
        const data = JSON.parse(e.data)
        if (!settled) {
          if (data.type === 'joined') {
            settled = true
            if (hostFallbackTimer) { clearTimeout(hostFallbackTimer); hostFallbackTimer = null }
            if (!isHostMode) _startHeartbeat()
            _handleMessage(data)
            resolve()
            return
          } else if (data.type === 'error') {
            settled = true
            if (hostFallbackTimer) { clearTimeout(hostFallbackTimer); hostFallbackTimer = null }
            const errMsg = WS_ERROR_MESSAGES[data.code] ?? 'エラーが発生しました'
            state.error    = errMsg
            state.mode     = 'idle'
            state.roomCode = null
            reject(new Error(errMsg))
            return
          }
        }
        _handleMessage(data)
      } catch (_) {}
    }

    ws.onerror = () => {
      const isCurrent = connection === _connectGeneration
        && (_connectingWs === ws || _ws === ws)
      if (!isCurrent) return  // 旧WSのエラーは無視
      clearTimeout(timer)
      if (hostFallbackTimer) { clearTimeout(hostFallbackTimer); hostFallbackTimer = null }
      if (!settled && !state.isConnected) {
        settled = true
        // 自動再接続サイクル中（_disconnectedAt > 0）は mode を idle にしない。
        // onclose が続けて発火して次の再接続タイマーをスケジュールできるよう mode を維持する。
        if (_disconnectedAt === 0) {
          state.error = 'サーバーへの接続に失敗しました'
          state.mode  = 'idle'
          state.roomCode = null
        }
        reject(new Error('WebSocket error'))
      }
    }

    ws.onclose = () => {
      const isCurrent = connection === _connectGeneration
        && (_connectingWs === ws || _ws === ws)
      // 自分が現役の接続試行でない場合は、旧Promiseだけを決着させて
      // 現在のroom/state/reconnect timerへは触れない。
      if (!isCurrent) {
        clearTimeout(timer)
        if (hostFallbackTimer) { clearTimeout(hostFallbackTimer); hostFallbackTimer = null }
        if (!settled) { settled = true; reject(new Error('接続が切り替わりました')) }
        return
      }
      forgetConnecting()
      if (_ws === ws) _ws = null
      _stopHeartbeat()
      state.isConnected = false

      if (!settled) {
        settled = true
        if (hostFallbackTimer) { clearTimeout(hostFallbackTimer); hostFallbackTimer = null }
        reject(new Error('接続が切れました'))
      }

      if (state.mode === 'idle') return

      // 再接続予定: 切断時刻を記録してマージ判定に使う
      _disconnectedAt = Date.now()

      if (_reconnectCount < RECONNECT_DELAYS.length) {
        const delay = RECONNECT_DELAYS[_reconnectCount++]
        _reconnectTimer = setTimeout(() => {
          if (state.mode !== 'idle') _connect(code).catch(() => {})
        }, delay)
      } else {
        state.error = '再接続に失敗しました。ネットワーク環境を確認してください。'
      }
    }
  })
}

// ── 画面ON時の自動再接続 ──────────────────────────────────────────────────────
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    if (state.mode === 'idle' || !state.roomCode) return
    if (_ws?.readyState === WebSocket.OPEN) return
    _clearReconnectTimer()
    _reconnectCount = 0
    if (_disconnectedAt === 0) _disconnectedAt = Date.now()  // 再接続扱いにして onerror で idle 落ちしないよう
    _connect(state.roomCode).catch(() => {})
  })
}

// ── ページ再読み込み後のセッション復元 ───────────────────────────────────────

/** 保存されているゲストセッション情報を返す（自動復元はしない） */
export function getSavedGuestSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.syncSession) ?? 'null')
    return (saved?.mode === 'joining' && saved?.roomCode) ? saved : null
  } catch (_) { return null }
}

/** 保存済みセッション情報を破棄する（再参加スキップ時など） */
export function discardSavedSession() {
  _clearSession()
}

export function restoreSession() {
  if (state.mode !== 'idle') return
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.syncSession) ?? 'null')
    if (!saved?.roomCode || !saved?.mode) return
    // ゲストセッションは自動復元しない（getSavedGuestSession で確認・再参加を促す）
    if (saved.mode === 'joining') return
    state.roomCode  = saved.roomCode
    state.roomType  = saved.roomType === 'order' ? 'order' : 'stock'
    state.mode      = saved.mode
    _disconnectedAt = Date.now()  // 再接続扱い: onerror で即 idle にせず onclose の再接続チェーンに委ねる
    _connect(saved.roomCode).catch(() => {})
  } catch (_) {}
}

// ── useSync composable ────────────────────────────────────────────────────────
export function useSync() {
  const isActive = computed(() => state.mode !== 'idle')
  const isHost   = computed(() => state.mode === 'hosting')
  const isGuest  = computed(() => state.mode === 'joining')

  const participantList = computed(() =>
    Object.entries(participants).map(([id, info]) => ({
      id,
      name: info.name || '名前未設定',
      isMe: id === deviceId,
      isDone: !!info.isDone,
    }))
  )

  async function createRoom(type = 'stock') {
    state.error     = null
    _disconnectedAt = 0  // ユーザー操作による新規接続: 再接続サイクルをリセット
    const code  = shopCode.value
    if (!code) throw new Error('店舗コードが未登録です。先に店舗を登録してください。')
    // 既に同じ種類のルームにホストとして接続済みなら再接続しない
    if (state.mode === 'hosting' && state.roomCode === code && state.roomType === type && state.isConnected) return code
    state.roomType = type
    state.roomCode = code
    state.mode     = 'hosting'
    const connecting = _connect(code)
    const connection = _connectGeneration
    try {
      await connecting
    } catch (e) {
      // 別の接続試行に置換された旧Promiseは、現在のroom stateを巻き戻さない。
      if (connection === _connectGeneration) {
        state.mode     = 'idle'
        state.roomCode = null
      }
      throw e
    }
    return code
  }

  async function joinRoom(code, joinSessionId = null, type = 'stock') {
    state.error     = null
    _disconnectedAt = 0  // ユーザー操作による新規接続: 再接続サイクルをリセット
    const normalized = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (normalized.length < 4 || normalized.length > 8) {
      state.error = '正しいコード形式ではありません（4〜8文字）'
      throw new Error('invalid code')
    }
    // 自分の店舗コードが入力された場合はホストとして再接続する
    const isOwnCode = !!(shopCode.value && normalized === shopCode.value.toUpperCase())
    // ゲスト参加時は招待リンクのセッションIDを鍵として保持（再接続時も使う）
    if (!isOwnCode) _joinSessionId = joinSessionId || null
    state.roomType = type === 'order' ? 'order' : 'stock'
    state.roomCode = normalized
    state.mode     = isOwnCode ? 'hosting' : 'joining'
    const connecting = _connect(normalized)
    const connection = _connectGeneration
    try {
      await connecting
    } catch (e) {
      if (connection === _connectGeneration) {
        state.mode     = 'idle'
        state.roomCode = null
      }
      throw e
    }
    return normalized
  }

  function leaveRoom() {
    const wasGuest = state.mode === 'joining'
    // mode を先に idle にして _handleMessage が以後のメッセージを無視するようにする
    state.mode     = 'idle'
    state.roomCode = null
    // onopen前のsocketも閉じる。これを残すと、leaveRoom完了後に旧ルームへ
    // joinしてhost/guest接続だけが復活する。
    if (_connectingWs) {
      const pending = _connectingWs
      try { pending.close(1000, 'User left') } catch (_) {}
      if (_connectingWs === pending) _connectingWs = null
    }
    if (_ws?.readyState === WebSocket.OPEN) {
      try { _ws.send(JSON.stringify({ type: 'leave' })) } catch (_) {}
    }
    if (_ws) { try { _ws.close(1000, 'User left') } catch (_) {} ; _ws = null }
    _resetClientState()
    if (wasGuest) _onGuestLeave?.()
  }

  /**
   * ルームを解散する（ホスト）。
   *
   * **150ms 待つ間に接続先が変わりうる。** `clearHostToken()` / `leaveRoom()` は
   * グローバルな `_ws` / `state` / `shopCode` に対して働くため、待機中に別ルーム・
   * 別店舗へつなぎ替えられていると
   *   - 新しいアカウントの host token を消す
   *   - 新しい WebSocket を close する
   *   - 新しいルーム状態を idle へ戻し、ゲストの leave callback を実行する
   * が起きる。呼び出し側（App）の世代確認は await の後なので間に合わない。
   * 待機前の socket・店舗・ルーム・種別を捕まえ、待機後に一致を確かめる。
   */
  async function dissolveRoom() {
    const socket     = _ws
    const code       = shopCode.value
    const room       = state.roomCode
    const type       = state.roomType
    const connection = _connectGeneration

    if (socket?.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify({ type: 'dissolve' })) } catch (_) {}
      await new Promise(r => setTimeout(r, 150))
      // **「socket が変わった」だけでは中止しない。**
      // Worker（RoomDO の dissolve）はホスト自身へ dissolved を送らず、直後に socket を
      // 閉じる。正常な解散でも onclose が `_ws = null` にするため、`_ws !== socket` を
      // 中止条件にすると hosting 状態・host token・再接続タイマーが残り、
      // 解散したはずのルームを作り直してしまう。
      //
      // 中止するのは「**新しい接続が始まった**」場合。`_ws` への代入は onopen 後なので、
      // 同じ shop/room/type へ張り直した socket が CONNECTING の間は `_ws` が null のまま。
      // socket の比較だけでは検出できないため、接続世代も見る（見落とすと token を消して
      // leaveRoom した後に、接続中の socket が onopen して接続が復活する）。
      const switched = _connectGeneration !== connection
        || (_ws && _ws !== socket)
        || shopCode.value !== code || state.roomCode !== room || state.roomType !== type
      if (switched) {
        console.warn('[sync] dissolveRoom: connection changed while waiting; leaving the new one intact')
        return { ok: false, reason: 'connection_changed' }
      }
    }
    clearHostToken(type)
    leaveRoom()
    return { ok: true }
  }

  function getShareUrl() {
    if (!shopCode.value) return ''
    const base = window.location.origin + window.location.pathname.replace(/\/$/, '')
    const sid  = state.sessionId
    const t    = state.roomType === 'order' ? '&type=order' : ''
    // セッションIDを鍵として付与（そのルーム限りのURL）。未開始時は store のみ。
    return sid
      ? `${base}?store=${shopCode.value}&s=${encodeURIComponent(sid)}${t}`
      : `${base}?store=${shopCode.value}${t}`
  }

  return {
    state, participants, participantList, messages, auditLog, unreadCount,
    isActive, isHost, isGuest,
    createRoom, joinRoom, leaveRoom, dissolveRoom, getShareUrl,
  }
}
