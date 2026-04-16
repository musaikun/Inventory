import { reactive, computed } from 'vue'
import { deviceId, deviceName } from './useDeviceId.js'

// ── Worker URL（環境変数） ────────────────────────────────────────────────────
const WORKER_URL = (() => {
  const raw = import.meta.env.VITE_SYNC_WORKER_URL ?? ''
  if (!raw) return ''
  // https:// → wss://, http:// → ws:// へ正規化
  return raw.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://')
})()

// ── モジュールスコープ state（シングルトン）──────────────────────────────────
const state = reactive({
  mode:        'idle',   // 'idle' | 'hosting' | 'joining'
  roomCode:    null,
  isConnected: false,
  error:       null,
})

const participants = reactive({})

// ── 内部変数 ─────────────────────────────────────────────────────────────────
let _ws               = null
let _reconnectTimer   = null
let _heartbeatTimer   = null
let _reconnectCount   = 0
const RECONNECT_DELAYS = [1500, 3000, 6000, 12000, 30000]

// ── コールバック登録（App.vue がつなぎ役）────────────────────────────────────
let _onItemUpdate     = null   // (ingredient, qty, unit) => void
let _onItemRemove     = null   // (ingredient) => void
let _getInventory     = null   // () => { [ingredient]: {qty, unit} }
let _getConfig        = null   // () => { order, units, ... }
let _onConfigReceived = null   // (config) => void
let _onDone           = null   // (deviceName) => void
let _onMessage        = null   // ({ text, senderName }) => void

/** サーバーからの受信イベントを処理するハンドラを登録（App.vue が呼ぶ） */
export function setInventoryCallbacks(onUpdate, onRemove) {
  _onItemUpdate = onUpdate
  _onItemRemove = onRemove
}

/** 現在のインベントリ取得関数を登録（再接続時の全量送信に使用） */
export function registerInventoryGetter(fn) {
  _getInventory = fn
}

/** 現在の品目設定取得関数を登録（ゲスト参加時の共有に使用） */
export function registerConfigGetter(fn) {
  _getConfig = fn
}

/** ゲストがホストの品目設定を受け取ったときのコールバックを登録 */
export function setConfigCallback(fn) {
  _onConfigReceived = fn
}

/** 棚卸完了通知を受け取ったときのコールバックを登録 */
export function setDoneCallback(fn) {
  _onDone = fn
}

/** チャットメッセージを受け取ったときのコールバックを登録 */
export function setMessageCallback(fn) {
  _onMessage = fn
}

// ── 送信 API（App.vue が各 mutation の後に呼ぶ）────────────────────────────
/** 品目追加/更新を他デバイスへブロードキャスト */
export function broadcastUpdate(ingredient, qty, unit) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'update', ingredient, qty, unit: unit ?? '' }))
}

/** 品目削除を他デバイスへブロードキャスト */
export function broadcastRemove(ingredient) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'remove', ingredient }))
}

/** 棚卸完了を他デバイスへ通知 */
export function broadcastDone() {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'done' }))
}

/** チャットメッセージを全参加者へ送信（自分含む） */
export function broadcastMessage(text) {
  if (_ws?.readyState !== WebSocket.OPEN) return
  _ws.send(JSON.stringify({ type: 'message', text }))
}

// ── 内部ヘルパー ──────────────────────────────────────────────────────────────
function _generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'  // I/O/0/1 除外
  let code = ''
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

function _startHeartbeat() {
  _stopHeartbeat()
  _heartbeatTimer = setInterval(() => {
    if (_ws?.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type: 'ping' }))
    }
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

function _handleMessage(msg) {
  switch (msg.type) {
    case 'joined': {
      // 参加時: サーバーの全量をローカルに反映
      for (const [ingredient, entry] of Object.entries(msg.inventory ?? {})) {
        _onItemUpdate?.(ingredient, entry.qty, entry.unit ?? '')
      }
      _updateParticipants(msg.participants ?? [])
      // 自分を参加者リストに追加
      participants[deviceId] = { name: deviceName.value || '名前未設定', isMe: true }

      // ゲストの場合: ホストの品目設定を適用（カスタム設定がある場合のみ）
      if (state.mode === 'joining' && msg.config?.isCustom) {
        _onConfigReceived?.(msg.config)
      }
      break
    }

    case 'update':
      if (msg.fromDeviceId !== deviceId) {
        _onItemUpdate?.(msg.ingredient, msg.qty, msg.unit ?? '')
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

    case 'done':
      _onDone?.(msg.deviceName)
      break

    case 'message':
      _onMessage?.({ text: msg.text, senderName: msg.senderName })
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
    const ws  = new WebSocket(`${WORKER_URL}/room/${code}/ws`)
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error('接続タイムアウト（10秒）'))
    }, 10000)

    ws.onopen = () => {
      clearTimeout(timer)
      _ws             = ws
      _reconnectCount = 0
      state.isConnected = true
      state.error       = null

      // join メッセージを送信
      ws.send(JSON.stringify({
        type:       'join',
        deviceId,
        deviceName: deviceName.value || '名前未設定',
      }))

      // ホストの場合: 品目設定とインベントリをサーバーへ送信
      if (state.mode === 'hosting') {
        setTimeout(() => {
          // 品目設定を送信（ゲストが参加したときに共有される）
          if (_getConfig) {
            const cfg = _getConfig()
            if (cfg) {
              ws.send(JSON.stringify({ type: 'config', ...cfg }))
            }
          }
          // 既存インベントリを全送信
          if (_getInventory) {
            const inv = _getInventory() ?? {}
            for (const [ingredient, entry] of Object.entries(inv)) {
              broadcastUpdate(ingredient, entry.qty, entry.unit ?? '')
            }
          }
        }, 200)
      }

      _startHeartbeat()
      resolve()
    }

    ws.onmessage = (e) => {
      try { _handleMessage(JSON.parse(e.data)) } catch (_) {}
    }

    ws.onerror = () => {
      clearTimeout(timer)
      if (!state.isConnected) {
        state.error = 'サーバーへの接続に失敗しました'
        state.mode  = 'idle'
        reject(new Error('WebSocket error'))
      }
    }

    ws.onclose = () => {
      _ws = null
      _stopHeartbeat()
      state.isConnected = false

      if (state.mode === 'idle') return  // ユーザーが意図的に切断

      // 自動再接続（指数バックオフ）
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
    const code     = _generateRoomCode()
    state.roomCode = code
    state.mode     = 'hosting'

    try {
      await _connect(code)
    } catch (e) {
      state.mode    = 'idle'
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
      state.mode    = 'idle'
      state.roomCode = null
      throw e
    }
    return normalized
  }

  function leaveRoom() {
    _clearReconnectTimer()
    _stopHeartbeat()
    if (_ws) { try { _ws.close(1000, 'User left') } catch (_) {} ; _ws = null }
    state.mode        = 'idle'
    state.roomCode    = null
    state.isConnected = false
    state.error       = null
    Object.keys(participants).forEach(k => delete participants[k])
  }

  function getShareUrl() {
    if (!state.roomCode) return ''
    const base = window.location.origin + window.location.pathname.replace(/\/$/, '')
    return `${base}?room=${state.roomCode}`
  }

  return {
    state, participants, participantList,
    isActive, isHost, isGuest,
    createRoom, joinRoom, leaveRoom, getShareUrl,
  }
}
