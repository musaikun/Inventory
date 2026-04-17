import { reactive, computed, ref, watch } from 'vue'
import { deviceId, deviceName } from './useDeviceId.js'

const WORKER_URL = (() => {
  const raw = import.meta.env.VITE_SYNC_WORKER_URL ?? ''
  if (!raw) return ''
  return raw.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://')
})()

// ── モジュールスコープ シングルトン ───────────────────────────────────────────
const state = reactive({
  mode:        'idle',
  roomCode:    null,
  isConnected: false,
  error:       null,
})

const participants  = reactive({})
const messages      = reactive([])
const auditLog      = reactive([])
const unreadCount   = ref(0)

let _ws             = null
let _reconnectTimer = null
let _heartbeatTimer = null
let _reconnectCount = 0
const RECONNECT_DELAYS = [1500, 3000, 6000, 12000, 30000]

// ── deviceName 変更を即時反映 ─────────────────────────────────────────────────
watch(deviceName, (newName) => {
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
let _getInventory     = null
let _getConfig        = null
let _onConfigReceived = null
let _onDone           = null
let _onMessage        = null
let _onDissolved      = null
let _onConflict       = null

export function setInventoryCallbacks(onUpdate, onRemove) { _onItemUpdate = onUpdate; _onItemRemove = onRemove }
export function registerInventoryGetter(fn)  { _getInventory = fn }
export function registerConfigGetter(fn)     { _getConfig = fn }
export function setConfigCallback(fn)        { _onConfigReceived = fn }
export function setDoneCallback(fn)          { _onDone = fn }
export function setMessageCallback(fn)       { _onMessage = fn }
export function setDissolvedCallback(fn)     { _onDissolved = fn }
export function setConflictCallback(fn)      { _onConflict = fn }
export function markMessagesRead()           { unreadCount.value = 0 }

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

export function broadcastDone() {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'done' }))
}

export function broadcastMessage(text, replyTo = null) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'message', text, replyTo }))
}

// ── 内部ヘルパー ──────────────────────────────────────────────────────────────
function _genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => c[Math.floor(Math.random() * c.length)]).join('')
}

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

function _updateParticipants(list) {
  const incoming = new Set(list.map(p => p.deviceId))
  for (const id of Object.keys(participants)) {
    if (!incoming.has(id)) delete participants[id]
  }
  for (const p of list) {
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
  state.mode        = 'idle'
  state.roomCode    = null
  state.isConnected = false
  state.error       = null
  Object.keys(participants).forEach(k => delete participants[k])
  messages.splice(0, messages.length)
  auditLog.splice(0, auditLog.length)
  unreadCount.value = 0
}

function _handleMessage(msg) {
  switch (msg.type) {
    case 'joined': {
      for (const [ingredient, entry] of Object.entries(msg.inventory ?? {})) {
        _onItemUpdate?.(ingredient, entry.qty, entry.unit ?? '', entry.enteredBy ?? '')
      }
      _updateParticipants(msg.participants ?? [])
      participants[deviceId] = { name: deviceName.value || '名前未設定', isMe: true }

      if (state.mode === 'joining' && msg.config?.isCustom) {
        _onConfigReceived?.(msg.config)
      }
      if (Array.isArray(msg.messages)) {
        messages.splice(0, messages.length, ...msg.messages)
      }
      if (Array.isArray(msg.auditLog)) {
        auditLog.splice(0, auditLog.length, ...msg.auditLog)
      }
      break
    }

    case 'update':
      if (msg.fromDeviceId !== deviceId) {
        // 競合検出: すでに自分が入力している品目を相手が更新した場合
        const currentInv = _getInventory?.()
        if (currentInv?.[msg.ingredient]) {
          _onConflict?.(msg.ingredient, msg.qty, msg.unit ?? '', msg.enteredBy ?? '', currentInv[msg.ingredient])
        }
        _onItemUpdate?.(msg.ingredient, msg.qty, msg.unit ?? '', msg.enteredBy ?? '')
      }
      break

    case 'remove':
      if (msg.fromDeviceId !== deviceId) {
        _onItemRemove?.(msg.ingredient)
      }
      break

    case 'participants':
      _updateParticipants(msg.list ?? [])
      participants[deviceId] = { name: deviceName.value || '名前未設定', isMe: true }
      break

    case 'done': {
      // システムメッセージとしてチャットに追加（全員）
      _addSysMsg(`${msg.deviceName} が棚卸を完了しました ✓`)
      // 他者の完了のみポップアップ通知（自分の完了はtoastで通知済み）
      if (msg.fromDeviceId !== deviceId) {
        _onDone?.(msg.deviceName)
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

    case 'dissolved':
      _addSysMsg('ルームが解散されました')
      _ws = null
      _resetClientState()
      _onDissolved?.()
      break

    case 'error':
      // room_not_found: _connect の onmessage で処理済み
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

    const ws    = new WebSocket(`${WORKER_URL}/room/${code}/ws`)
    const timer = setTimeout(() => {
      if (!settled) { settled = true; ws.close(); reject(new Error('接続タイムアウト（10秒）')) }
    }, 10000)

    ws.onopen = () => {
      clearTimeout(timer)
      _ws             = ws
      _reconnectCount = 0
      state.isConnected = true
      state.error       = null

      ws.send(JSON.stringify({
        type:       'join',
        deviceId,
        deviceName: deviceName.value || '名前未設定',
        role:       isHostMode ? 'host' : 'guest',
      }))

      if (isHostMode) {
        // ホスト: 接続確立時点で resolve、品目設定とインベントリを送信
        settled = true
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
        }, 200)
        _startHeartbeat()
        resolve()
      }
      // ゲスト: 'joined' または 'error' メッセージを待つ
    }

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (!settled) {
          if (data.type === 'joined') {
            settled = true
            _startHeartbeat()
            _handleMessage(data)
            resolve()
            return
          } else if (data.type === 'error') {
            settled = true
            const errMsg = data.code === 'room_not_found'
              ? 'ルームが存在しません'
              : data.code === 'room_full'
              ? 'ルームが満員です（上限20名）'
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
        reject(new Error('接続が切れました'))
      }

      if (state.mode === 'idle') return

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
    state.error    = null
    const code     = _genCode()
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
    const normalized = code.trim().toUpperCase()
    if (!/^[A-Z0-9]{4,6}$/.test(normalized)) {
      state.error = '正しいコード形式ではありません（4〜6文字の英数字）'
      throw new Error('invalid code')
    }
    state.roomCode = normalized
    state.mode     = 'joining'
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
    if (_ws) { try { _ws.close(1000, 'User left') } catch (_) {} ; _ws = null }
    _resetClientState()
  }

  async function dissolveRoom() {
    if (_ws?.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type: 'dissolve' }))
      await new Promise(r => setTimeout(r, 150))
    }
    leaveRoom()
  }

  function getShareUrl() {
    if (!state.roomCode) return ''
    const base = window.location.origin + window.location.pathname.replace(/\/$/, '')
    return `${base}?room=${state.roomCode}`
  }

  return {
    state, participants, participantList, messages, auditLog, unreadCount,
    isActive, isHost, isGuest,
    createRoom, joinRoom, leaveRoom, dissolveRoom, getShareUrl,
  }
}
