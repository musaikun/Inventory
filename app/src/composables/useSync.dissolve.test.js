// dissolveRoom の待機中に接続先が変わったら、新しい接続へ触らない
// （DATA-001 再レビュー2 §1）
//
// `dissolveRoom()` は dissolve を送ってから **150ms 待つ**。その間に別ルーム・別店舗へ
// つなぎ替えられると、待機後の `clearHostToken()` / `leaveRoom()` が
// **グローバルな `_ws` / `state` / `shopCode`** に対して実行される。結果として
//   - 新しいアカウントの host token を消す
//   - 新しい WebSocket を close する
//   - 新しいルーム状態を idle へ戻す
//   - ゲストの leave callback を実行する
// が起きる。App 側の世代確認はこの後なので間に合わない。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

class MockWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  static CLOSING = 2
  static CLOSED = 3
  static instances = []
  constructor(url) {
    this.url = url
    this.readyState = MockWebSocket.CONNECTING
    this.sent = []
    this.closed = false
    this.onopen = this.onmessage = this.onerror = this.onclose = null
    MockWebSocket.instances.push(this)
  }
  send(d) { this.sent.push(d) }
  close() {
    if (this.readyState === MockWebSocket.CLOSED) return
    this.closed = true
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }
  _open() { this.readyState = MockWebSocket.OPEN; this.onopen?.() }
  _recv(obj) { this.onmessage?.({ data: JSON.stringify(obj) }) }
}

const joined = (over = {}) => ({
  type: 'joined', inventory: {}, participants: [], messages: [], auditLog: [],
  isSessionActive: true, sessionId: 's1', ...over,
})

let sync
beforeEach(async () => {
  vi.useFakeTimers()
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket)
  vi.stubEnv('VITE_SYNC_WORKER_URL', 'https://sync.example.dev')
  localStorage.clear()
  localStorage.setItem(STORAGE_KEYS.shopCode, 'SHOPAA')
  vi.resetModules()
  sync = await import('./useSync.js')
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** ホストとして接続し、host token を持った状態にする */
async function hostRoom(api, code) {
  const p = api.createRoom('stock')
  const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]
  ws._open()
  ws._recv(joined({ hostToken: 'tok-' + code }))
  await p
  return ws
}

describe('dissolveRoom — 待機中につなぎ替わった接続を壊さない', () => {
  it('別店舗へつなぎ替えたら、新しい host token を消さない', async () => {
    const api = sync.useSync()
    const ws1 = await hostRoom(api, 'SHOPAA')
    localStorage.setItem(`${STORAGE_KEYS.hostTokenPrefix}SHOPAA`, 'tok-A')

    const dissolving = api.dissolveRoom()      // dissolve 送信 → 150ms 待機に入る
    await Promise.resolve()
    expect(JSON.parse(ws1.sent.at(-1)).type).toBe('dissolve')

    // 待機中に別店舗のルームへつなぎ替える
    const { shopCode } = await import('./useStore.js')
    shopCode.value = 'SHOPBB'
    const ws2 = await hostRoom(api, 'SHOPBB')
    localStorage.setItem(`${STORAGE_KEYS.hostTokenPrefix}SHOPBB`, 'tok-B')

    vi.advanceTimersByTime(200)
    await dissolving

    // 新しいアカウントの token・接続・ルーム状態は無傷
    expect(localStorage.getItem(`${STORAGE_KEYS.hostTokenPrefix}SHOPBB`)).toBe('tok-B')
    expect(ws2.closed).toBe(false)
    expect(api.state.mode).toBe('hosting')
    expect(api.state.roomCode).toBe('SHOPBB')
  })

  it('別ルームへ入り直したら、新しい接続を閉じない', async () => {
    const api = sync.useSync()
    const ws1 = await hostRoom(api, 'SHOPAA')

    const dissolving = api.dissolveRoom()
    await Promise.resolve()

    // 待機中にゲストとして別ルームへ参加し直す
    const p = api.joinRoom('OTHERRM')
    const ws2 = MockWebSocket.instances.at(-1)
    ws2._open()
    ws2._recv(joined())
    await p

    vi.advanceTimersByTime(200)
    await dissolving

    expect(ws2.closed).toBe(false)
    expect(api.state.mode).toBe('joining')
    expect(api.state.roomCode).toBe('OTHERRM')
    expect(ws1.closed).toBe(true)     // 旧ソケットは閉じてよい
  })

  it('つなぎ替えが無ければ従来どおり解散する', async () => {
    const api = sync.useSync()
    const ws1 = await hostRoom(api, 'SHOPAA')
    localStorage.setItem(`${STORAGE_KEYS.hostTokenPrefix}SHOPAA`, 'tok-A')

    const dissolving = api.dissolveRoom()
    vi.advanceTimersByTime(200)
    await dissolving

    expect(localStorage.getItem(`${STORAGE_KEYS.hostTokenPrefix}SHOPAA`)).toBeNull()
    expect(ws1.closed).toBe(true)
    expect(api.state.mode).toBe('idle')
    expect(api.state.roomCode).toBeNull()
  })
})
