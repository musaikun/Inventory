import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

class MockWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  static CLOSED = 3
  static instances = []

  constructor() {
    this.readyState = MockWebSocket.CONNECTING
    this.sent = []
    this.onopen = this.onmessage = this.onerror = this.onclose = null
    MockWebSocket.instances.push(this)
  }

  send(data) { this.sent.push(data) }
  close() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }
  open() { this.readyState = MockWebSocket.OPEN; this.onopen?.() }
  receive(data) { this.onmessage?.({ data: JSON.stringify(data) }) }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('VITE_SYNC_WORKER_URL', 'https://sync.example.dev')
  vi.stubGlobal('WebSocket', MockWebSocket)
  MockWebSocket.instances = []
  localStorage.clear()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useSync: account境界の強制reset', () => {
  it('接続・同期data・保存sessionを消し、再接続しない', async () => {
    vi.resetModules()
    const sync = await import('./useSync.js')
    const pending = sync.useSync().joinRoom('ROOMBB')
    const ws = MockWebSocket.instances[0]
    ws.open()
    ws.receive({
      type: 'joined',
      inventory: {},
      participants: [{ deviceId: 'other', deviceName: '旧店舗端末' }],
      messages: [{ id: 'm1', text: '旧店舗メッセージ' }],
      auditLog: [{ id: 'a1', ingredient: '旧店舗品目' }],
      isSessionActive: true,
      sessionId: 's1',
    })
    await pending
    expect(localStorage.getItem('_sync_session_v1')).not.toBeNull()

    sync.resetAccountData()
    vi.advanceTimersByTime(60_000)

    const model = sync.useSync()
    expect(model.state.mode).toBe('idle')
    expect(model.state.roomCode).toBeNull()
    expect(model.participantList.value).toEqual([])
    expect(model.messages).toEqual([])
    expect(model.auditLog).toEqual([])
    expect(localStorage.getItem('_sync_session_v1')).toBeNull()
    expect(MockWebSocket.instances).toHaveLength(1)
  })
})
