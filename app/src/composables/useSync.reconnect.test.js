import { describe, it, expect, beforeEach, vi } from 'vitest'

// WebSocket をモックして接続ライフサイクルを手動で駆動する。
// 目的: 接続の張り替え（再接続）が古いソケット経由で接続を無限増殖させないことを保証する。
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
    this.onopen = this.onmessage = this.onerror = this.onclose = null
    MockWebSocket.instances.push(this)
  }
  send(d) { this.sent.push(d) }
  close() {
    if (this.readyState === MockWebSocket.CLOSED) return
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }
  // テスト駆動用ヘルパー
  _open() { this.readyState = MockWebSocket.OPEN; this.onopen?.() }
  _recv(obj) { this.onmessage?.({ data: JSON.stringify(obj) }) }
}

let sync
beforeEach(async () => {
  vi.useFakeTimers()
  MockWebSocket.instances = []
  global.WebSocket = MockWebSocket
  vi.stubGlobal('WebSocket', MockWebSocket)
  vi.stubEnv('VITE_SYNC_WORKER_URL', 'https://sync.example.dev')
  localStorage.clear()
  localStorage.setItem('inv_store_code', 'ROOMAA')
  vi.resetModules()
  sync = await import('./useSync.js')
})

function joinedPayload() {
  return { type: 'joined', inventory: {}, participants: [], messages: [], auditLog: [], isSessionActive: true, sessionId: 's1' }
}

describe('再接続の増殖防止', () => {
  it('接続を張り替えても古いソケットの onclose が再接続を増殖させない', async () => {
    const { joinRoom } = sync.useSync()
    const p = joinRoom('ROOMBB')
    // 1本目の接続を確立
    const ws1 = MockWebSocket.instances[0]
    ws1._open()
    ws1._recv(joinedPayload())
    await p
    expect(MockWebSocket.instances).toHaveLength(1)

    // 接続が生きている状態で再接続を発火（visibilitychange 相当の経路）
    // → _connect が ws1 を意図的に閉じる。ws1.onclose は無効化済みで再接続を撒かないはず。
    const p2 = joinRoom('ROOMBB')
    const ws2 = MockWebSocket.instances[1]
    ws2._open()
    ws2._recv(joinedPayload())
    await p2

    // ここでタイマーを全消化。バグがあれば 1.5秒ごとに新ソケットが無限生成される。
    vi.advanceTimersByTime(60000)
    // 張り替え2回ぶんの 2 本のみ。増殖（3本以上）していないこと。
    expect(MockWebSocket.instances.length).toBeLessThanOrEqual(2)
  })

  it('実際の切断時は1本だけ再接続する（正常な再接続は維持）', async () => {
    const { joinRoom } = sync.useSync()
    const p = joinRoom('ROOMCC')
    const ws1 = MockWebSocket.instances[0]
    ws1._open()
    ws1._recv(joinedPayload())
    await p

    // 現役ソケットが自然切断 → 1.5秒後に1本だけ再接続
    ws1.close()
    expect(MockWebSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1600)
    expect(MockWebSocket.instances).toHaveLength(2)

    // 再接続を確立（接続タイムアウトを避ける）
    const ws2 = MockWebSocket.instances[1]
    ws2._open()
    ws2._recv(joinedPayload())

    // さらに時間を進めても増殖しない
    vi.advanceTimersByTime(60000)
    expect(MockWebSocket.instances.length).toBeLessThanOrEqual(2)
  })
})
