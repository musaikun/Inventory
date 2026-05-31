import { reactive, computed, ref, watch } from 'vue'
import { deviceId, deviceName } from './useDeviceId.js'
import { STORAGE_KEYS } from '../utils/storageKeys.js'
import { shopCode } from './useStore.js'

function _saveSession() {
  if (!state.roomCode || state.mode === 'idle') return
  try { localStorage.setItem(STORAGE_KEYS.syncSession, JSON.stringify({ roomCode: state.roomCode, mode: state.mode })) } catch (_) {}
}

function _clearSession() {
  try { localStorage.removeItem(STORAGE_KEYS.syncSession) } catch (_) {}
}

// ── ホストトークン管理（店舗コードごとに保持）────────────────────────────────
function _hostTokenKey() {
  return shopCode.value ? `${STORAGE_KEYS.hostTokenPrefix}${shopCode.value}` : null
}
function _loadHostToken() {
  const key = _hostTokenKey()
  return key ? (localStorage.getItem(key) ?? '') : ''
}
function _saveHostToken(token) {
  const key = _hostTokenKey()
  if (key && token) try { localStorage.setItem(key, token) } catch (_) {}
}
export function clearHostToken() {
  const key = _hostTokenKey()
  if (key) try { localStorage.removeItem(key) } catch (_) {}
}

const WORKER_URL = (() => {
  const raw = import.meta.env.VITE_SYNC_WORKER_URL ?? ''
  if (!raw) return ''
  return raw.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://')
})()

// ── モジュールスコープ シングルトン ───────────────────────────────────────────
const state = reactive({
  mode:            'idle',
  roomCode:        null,
  isConnected:     false,
  error:           null,
  sessionId:       null,   // 現在のセッションID（D1）
  isSessionActive: false,  // DO側のセッションアクティブフラグ
})

const participants  = reactive({})
const messages      = reactive([])
const auditLog      = reactive([])
const unreadCount   = ref(0)

let _ws              = null
let _reconnectTimer  = null
let _heartbeatTimer  = null
let _reconnectCount  = 0
let _disconnectedAt  = 0   // 切断時刻（再接続時マージ判定に使用）
const RECONNECT_DELAYS = [1500, 3000, 6000, 12000, 30000]

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
let _onNameTaken      = null
let _onParticipantJoin  = null
let _onParticipantLeave = null
let _onGuestLeave       = null
let _onRemoteUpdate     = null
let _onClearInventory   = null
let _onScopeReceived    = null
let _onSessionStarted   = null
let _onSessionEnded     = null

export function setInventoryCallbacks(onUpdate, onRemove) { _onItemUpdate = onUpdate; _onItemRemove = onRemove }
export function setRecountFlagCallback(fn)   { _onRecountFlag = fn }
export function registerInventoryGetter(fn)  { _getInventory = fn }
export function registerRecountFlagsGetter(fn) { _getRecountFlags = fn }
export function registerConfigGetter(fn)     { _getConfig = fn }
export function setConfigCallback(fn)        { _onConfigReceived = fn }
export function setResetConfigCallback(fn)   { _onResetConfig = fn }
export function setDoneCallback(fn)          { _onDone = fn }
export function setMessageCallback(fn)       { _onMessage = fn }
export function setDissolvedCallback(fn)     { _onDissolved = fn }
export function setConflictCallback(fn)      { _onConflict = fn }
export function setNameTakenCallback(fn)     { _onNameTaken = fn }
export function setParticipantJoinCallback(fn)  { _onParticipantJoin  = fn }
export function setParticipantLeaveCallback(fn) { _onParticipantLeave = fn }
export function setGuestLeaveCallback(fn)       { _onGuestLeave       = fn }
export function setRemoteUpdateCallback(fn)     { _onRemoteUpdate     = fn }
export function setClearInventoryCallback(fn)   { _onClearInventory   = fn }
export function setScopeCallback(fn)            { _onScopeReceived    = fn }
export function setSessionStartedCallback(fn)   { _onSessionStarted   = fn }
export function setSessionEndedCallback(fn)     { _onSessionEnded     = fn }
export function markMessagesRead()           { unreadCount.value = 0 }

export function addLocalAuditEntry(entry) {
  if (!entry?.id || auditLog.some(e => e.id === entry.id)) return
  auditLog.push(entry)
  if (auditLog.length > 200) auditLog.splice(0, auditLog.length - 200)
}

export function clearAuditLog() {
  auditLog.splice(0, auditLog.length)
}

// ── 送信 API ──────────────────────────────────────────────────────────────────
export function broadcastConfig(cfg) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'config', ...cfg }))
}

export function broadcastUpdate(ingredient, qty, unit, enteredBy = '', isAdd = false) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'update', ingredient, qty, unit: unit ?? '', enteredBy, isAdd }))
}

export function broadcastRemove(ingredient) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'remove', ingredient }))
}

export function broadcastScope(scope) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'scope', scope }))
}

export function broadcastRecountFlag(ingredient, on) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'recount_flag', ingredient, on: !!on }))
}

export function broadcastDone(isFinal = false) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'done', isFinal }))
}

export function broadcastSessionStart(sessionId) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  state.sessionId       = sessionId
  state.isSessionActive = true
  // 現在のローカル在庫＋品目リストをまとめて送り、DO側で原子的に保存させる
  // → ゲストはどのタイミングで参加しても完全なスナップショット（在庫＋品目）を受け取れる
  const inv   = _getInventory?.() ?? {}
  const cfg   = _getConfig?.() ?? null
  const flags = _getRecountFlags?.() ?? {}
  _ws.send(JSON.stringify({ type: 'session_start', sessionId, inventory: inv, config: cfg, recountFlags: flags }))
}

export function broadcastSessionEnd(status = 'completed') {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'session_end', status }))
}

export function broadcastMessage(text, replyTo = null) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'message', text, replyTo }))
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
    }
  }
  // 入室検出 & 名前更新
  for (const p of list) {
    if (notify && !participants[p.deviceId] && p.deviceId !== deviceId) {
      _addSysMsg(`${p.deviceName} が参加しました`)
      _onParticipantJoin?.(p.deviceName)
    }
    const oldName = participants[p.deviceId]?.name
    const newName = p.deviceName
    if (oldName && oldName !== newName) {
      for (const entry of auditLog) {
        if (entry.enteredById === p.deviceId) entry.enteredBy = newName
      }
    }
    participants[p.deviceId] = { name: p.deviceName, isMe: p.deviceId === deviceId }
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
  state.isConnected     = false
  state.error           = null
  state.sessionId       = null
  state.isSessionActive = false
  Object.keys(participants).forEach(k => delete participants[k])
  messages.splice(0, messages.length)
  auditLog.splice(0, auditLog.length)
  unreadCount.value = 0
}

function _handleMessage(msg) {
  switch (msg.type) {
    case 'joined': {
      const serverInv = msg.inventory ?? {}
      const isGuestReconnect = state.mode === 'joining' && _disconnectedAt > 0
      const sessionChanged   = msg.sessionId && state.sessionId && msg.sessionId !== state.sessionId

      if (isGuestReconnect && !sessionChanged) {
        // オフライン中に変更した品目をマージ（タイムスタンプで新しい方を優先）
        const localInv = _getInventory?.() ?? {}

        // サーバー側の品目を適用（ローカルより新しい場合のみ）
        for (const [ingredient, serverEntry] of Object.entries(serverInv)) {
          const localEntry = localInv[ingredient]
          if (!localEntry || (serverEntry.updatedAt ?? 0) >= (localEntry.updatedAt ?? 0)) {
            _onItemUpdate?.(ingredient, serverEntry.qty, serverEntry.unit ?? '', serverEntry.enteredBy ?? '', serverEntry.updatedAt)
          }
        }

        // サーバーにない品目: 切断後に追加したなら保持→再送信、切断前から存在したなら削除
        for (const [ingredient, localEntry] of Object.entries(localInv)) {
          if (!serverInv[ingredient]) {
            if ((localEntry.updatedAt ?? 0) > _disconnectedAt) {
              // オフライン中に入力した品目 → サーバーに再送信
              broadcastUpdate(ingredient, localEntry.qty, localEntry.unit ?? '', localEntry.enteredBy ?? '')
            } else {
              // 切断中にサーバー側で削除された品目 → ローカルからも削除
              _onItemRemove?.(ingredient)
            }
          }
        }

        // ローカルの方が新しい品目 → サーバーに再送信して上書き
        for (const [ingredient, localEntry] of Object.entries(localInv)) {
          const serverEntry = serverInv[ingredient]
          if (serverEntry && (localEntry.updatedAt ?? 0) > (serverEntry.updatedAt ?? 0)) {
            broadcastUpdate(ingredient, localEntry.qty, localEntry.unit ?? '', localEntry.enteredBy ?? '')
          }
        }
      } else {
        // 初回参加 or セッション切り替え: サーバー状態をそのまま適用
        if (state.mode === 'joining') {
          _onClearInventory?.()
        }
        for (const [ingredient, entry] of Object.entries(serverInv)) {
          _onItemUpdate?.(ingredient, entry.qty, entry.unit ?? '', entry.enteredBy ?? '', entry.updatedAt)
        }
      }

      _disconnectedAt = 0  // マージ完了、リセット

      _updateParticipants(msg.participants ?? [])
      participants[deviceId] = { name: deviceName.value || '名前未設定', isMe: true }

      // ゲスト参加: ルーム（ホスト）の品目リストに必ず揃える。
      // 店舗を切り替えても前店舗の品目が残らないよう、isCustom に関わらず常に適用。
      // ホストに品目リストが無い場合はデフォルトへ復帰する。
      if (state.mode === 'joining') {
        if (msg.config?.order?.length) {
          _onConfigReceived?.(msg.config)
        } else {
          _onResetConfig?.()
        }
        // 「あとで数える」フラグをサーバー状態に揃える（ローカルにしか無いものは外す）
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
      if (Array.isArray(msg.auditLog)) {
        auditLog.splice(0, auditLog.length, ...msg.auditLog)
      }
      // DO からのセッション状態を同期（ホスト再接続時に既存セッションを維持するため）
      state.isSessionActive = msg.isSessionActive ?? false
      state.sessionId       = msg.sessionId ?? null
      // 新規ホストトークンをローカルに保存
      if (msg.hostToken) _saveHostToken(msg.hostToken)
      break
    }

    case 'update':
      if (msg.fromDeviceId !== deviceId) {
        const currentInv = _getInventory?.()
        if (currentInv?.[msg.ingredient]) {
          // 競合: 自分が入力済みの品目を他者が更新
          _onConflict?.(msg.ingredient, msg.qty, msg.unit ?? '', msg.enteredBy ?? '', currentInv[msg.ingredient])
        } else {
          // 通常更新トースト（競合なし）
          _onRemoteUpdate?.(msg.ingredient, msg.qty, msg.unit ?? '', msg.enteredBy ?? '')
        }
        _onItemUpdate?.(msg.ingredient, msg.qty, msg.unit ?? '', msg.enteredBy ?? '')
      }
      break

    case 'remove':
      if (msg.fromDeviceId !== deviceId) {
        _onRemoteUpdate?.(msg.ingredient, null, '', msg.enteredBy ?? '')
        _onItemRemove?.(msg.ingredient)
      }
      break

    case 'participants':
      _updateParticipants(msg.list ?? [], true)  // 通知あり
      participants[deviceId] = { name: deviceName.value || '名前未設定', isMe: true }
      break

    case 'done': {
      const sysLabel = msg.isFinal
        ? `${msg.deviceName} が棚卸を締めました ✓`
        : `${msg.deviceName} が担当を完了しました ✓`
      _addSysMsg(sysLabel)
      if (msg.fromDeviceId !== deviceId) {
        _onDone?.(msg.deviceName, msg.isFinal ?? false)
      }
      break
    }

    case 'message': {
      if (!messages.some(m => m.id === msg.id)) {
        messages.push(msg)
        unreadCount.value++
      }
      _onMessage?.(msg)
      break
    }

    case 'audit_entry': {
      const entry = msg.entry
      if (entry?.id && !auditLog.some(e => e.id === entry.id)) {
        auditLog.push(entry)
        if (auditLog.length > 200) auditLog.splice(0, auditLog.length - 200)
      }
      break
    }

    case 'config_update':
      _onConfigReceived?.(msg)
      break

    case 'scope':
      _onScopeReceived?.(msg.scope)
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
      // sessionId が変わった新規セッション開始: ゲストの在庫をクリアし、
      // ホストの品目リストに揃える（前セッションの古い品目を引き継がない）
      if (isNewSession && state.mode === 'joining') {
        _onClearInventory?.()
        if (msg.config?.order?.length) _onConfigReceived?.(msg.config)
        else _onResetConfig?.()
      }
      _addSysMsg('セッションが開始されました。参加者を招待してください。')
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
        state.error    = 'セッションがまだ開始されていません。ホストがセッションを開始するまでお待ちください。'
        state.mode     = 'idle'
        state.roomCode = null
      }
      break

    case 'pong':
      break
  }
}

function _connect(code) {
  if (!WORKER_URL) {
    state.error = 'サーバーURLが未設定です（.env の VITE_SYNC_WORKER_URL を確認）'
    state.mode  = 'idle'
    return Promise.reject(new Error('no worker url'))
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const isHostMode = state.mode === 'hosting'
    let hostFallbackTimer = null

    const ws    = new WebSocket(`${WORKER_URL}/room/${code}/ws`)
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
        ...(isHostMode ? { hostToken: _loadHostToken() } : {}),
      }))

      if (isHostMode) {
        // ホスト: config/inventory を送信し、'joined' を待ってセッション状態を取得する
        // DO が 'joined' を返すまでの最大 3 秒はフォールバックとして即 resolve する
        setTimeout(() => {
          if (_getConfig) {
            const cfg = _getConfig()
            if (cfg) ws.send(JSON.stringify({ type: 'config', ...cfg }))
          }
          if (_getInventory) {
            const inv = _getInventory() ?? {}
            for (const [ingredient, entry] of Object.entries(inv)) {
              broadcastUpdate(ingredient, entry.qty, entry.unit ?? '', entry.enteredBy ?? '')
            }
          }
          if (_getRecountFlags) {
            const flags = _getRecountFlags() ?? {}
            for (const item of Object.keys(flags)) broadcastRecountFlag(item, true)
          }
        }, 200)
        _startHeartbeat()
        hostFallbackTimer = setTimeout(() => {
          if (!settled) { settled = true; resolve() }
        }, 3000)
      }
      // ゲスト: 'joined' または 'error' メッセージを待つ
    }

    ws.onmessage = (e) => {
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
            const errMsg = data.code === 'room_not_found'
              ? 'ルームが存在しません'
              : data.code === 'session_not_active'
              ? 'ホストがまだセッションを開始していません。ホストが「棚卸ルームを開始」するまでお待ちください。'
              : data.code === 'room_full'
              ? 'ルームが満員です（上限20名）'
              : data.code === 'name_taken'
              ? 'この端末名は既にルーム内で使用されています。設定から別の名前に変更してください。'
              : data.code === 'auth_failed'
              ? 'ホスト認証に失敗しました。この端末はホスト権限がありません。'
              : 'エラーが発生しました'
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
      clearTimeout(timer)
      if (hostFallbackTimer) { clearTimeout(hostFallbackTimer); hostFallbackTimer = null }
      if (!settled && !state.isConnected) {
        settled     = true
        state.error = 'サーバーへの接続に失敗しました'
        state.mode  = 'idle'
        reject(new Error('WebSocket error'))
      }
    }

    ws.onclose = () => {
      _ws = null
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
          if (state.mode !== 'idle') _connect(code)
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
    _connect(state.roomCode)
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
    state.roomCode = saved.roomCode
    state.mode     = saved.mode
    _connect(saved.roomCode).catch(() => {
      _clearSession()
      state.mode     = 'idle'
      state.roomCode = null
    })
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
    }))
  )

  async function createRoom() {
    state.error = null
    const code  = shopCode.value
    if (!code) throw new Error('店舗コードが未登録です。先に店舗を登録してください。')
    state.roomCode = code
    state.mode     = 'hosting'
    try {
      await _connect(code)
    } catch (e) {
      state.mode     = 'idle'
      state.roomCode = null
      throw e
    }
    return code
  }

  async function joinRoom(code) {
    state.error = null
    const normalized = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (normalized.length < 4 || normalized.length > 8) {
      state.error = '正しいコード形式ではありません（4〜8文字）'
      throw new Error('invalid code')
    }
    // 自分の店舗コードが入力された場合はホストとして再接続する
    const isOwnCode = !!(shopCode.value && normalized === shopCode.value.toUpperCase())
    state.roomCode = normalized
    state.mode     = isOwnCode ? 'hosting' : 'joining'
    try {
      await _connect(normalized)
    } catch (e) {
      state.mode     = 'idle'
      state.roomCode = null
      throw e
    }
    return normalized
  }

  function leaveRoom() {
    const wasGuest = state.mode === 'joining'
    if (_ws?.readyState === WebSocket.OPEN) {
      try { _ws.send(JSON.stringify({ type: 'leave' })) } catch (_) {}
    }
    if (_ws) { try { _ws.close(1000, 'User left') } catch (_) {} ; _ws = null }
    _resetClientState()
    if (wasGuest) _onGuestLeave?.()
  }

  async function dissolveRoom() {
    if (_ws?.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type: 'dissolve' }))
      await new Promise(r => setTimeout(r, 150))
    }
    clearHostToken()
    leaveRoom()
  }

  function getShareUrl() {
    if (!shopCode.value) return ''
    const base = window.location.origin + window.location.pathname.replace(/\/$/, '')
    return `${base}?store=${shopCode.value}`
  }

  return {
    state, participants, participantList, messages, auditLog, unreadCount,
    isActive, isHost, isGuest,
    createRoom, joinRoom, leaveRoom, dissolveRoom, getShareUrl,
  }
}
