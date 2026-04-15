import { reactive, computed, ref } from 'vue'
import { deviceId, deviceName } from './useDeviceId.js'

/**
 * 複数デバイス同期の状態管理
 *
 * 状態遷移:
 *   idle    → 通常（ソロ or 未接続）
 *   hosting → ルーム作成済み・ホストとして稼働中
 *   joining → ルーム参加中（接続試行 or 接続済み・ゲスト）
 *
 * 現状はUIのみ、バックエンドはモック（sessionStorageで簡易同期）
 * 本実装時は connect/disconnect/send を WebSocket に差し替える
 */

// ── モジュールスコープ state ─────────────────────────────────────────────────
const state = reactive({
  mode:        'idle',   // 'idle' | 'hosting' | 'joining'
  roomCode:    null,     // 発行済みルームコード
  isConnected: false,    // サーバーと接続確立済みか
  error:       null,     // エラーメッセージ
})

// このルームの参加者一覧 { deviceId: { name, lastSeen } }
const participants = reactive({})

// ── ルームコード生成 ──────────────────────────────────────────────────────────
function _generateRoomCode() {
  // 紛らわしい文字を除外した英数字4桁（大文字のみ）
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // I,O,0,1除外
  let code = ''
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

// ── Public API ────────────────────────────────────────────────────────────────
export function useSync() {

  const isActive = computed(() => state.mode !== 'idle')
  const isHost   = computed(() => state.mode === 'hosting')
  const isGuest  = computed(() => state.mode === 'joining')

  const participantList = computed(() =>
    Object.entries(participants).map(([id, info]) => ({
      id,
      name:  info.name || '（名前未設定）',
      isMe:  id === deviceId,
    }))
  )

  /** ルームを新規作成（ホストとして稼働開始） */
  async function createRoom() {
    state.error = null
    const code = _generateRoomCode()
    state.roomCode    = code
    state.mode        = 'hosting'
    state.isConnected = true  // TODO: 実装時は WebSocket 接続を待つ

    // 自分を参加者リストに追加
    participants[deviceId] = {
      name:     deviceName.value,
      lastSeen: Date.now(),
    }

    return code
  }

  /** 既存ルームに参加（ゲスト） */
  async function joinRoom(code) {
    state.error = null
    const normalized = code.trim().toUpperCase()
    if (!/^[A-Z0-9]{4,6}$/.test(normalized)) {
      state.error = '正しいコード形式ではありません'
      throw new Error('invalid code')
    }
    state.roomCode    = normalized
    state.mode        = 'joining'
    state.isConnected = true  // TODO: 実装時は WebSocket 接続・認証を待つ

    participants[deviceId] = {
      name:     deviceName.value,
      lastSeen: Date.now(),
    }

    return true
  }

  /** ルームから退出 / ホストなら解散 */
  function leaveRoom() {
    state.mode        = 'idle'
    state.roomCode    = null
    state.isConnected = false
    state.error       = null
    Object.keys(participants).forEach(k => delete participants[k])
  }

  /** 共有用URL（QRコード化するURL） */
  function getShareUrl() {
    if (!state.roomCode) return ''
    const origin = window.location.origin + window.location.pathname
    return `${origin}?room=${state.roomCode}`
  }

  return {
    state,
    participants,
    participantList,
    isActive,
    isHost,
    isGuest,
    createRoom,
    joinRoom,
    leaveRoom,
    getShareUrl,
  }
}
