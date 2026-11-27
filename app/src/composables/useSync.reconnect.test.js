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

describe('再接続の失敗が続いても、オフライン中の入力を消さない（2026-11-25）', () => {
  it('切断 → 入力 → 再接続に1回失敗 → 再接続 で、入力を再送しサーバーの古い値で上書きしない', async () => {
    const local = {}
    sync.registerInventoryGetter(() => local)
    const applied = []
    sync.setRemoteUpdateCallback((name, qty) => { applied.push([name, qty]) })
    const { joinRoom } = sync.useSync()
    const p = joinRoom('ROOMDD')
    const ws1 = MockWebSocket.instances[0]
    ws1._open()
    const before = Date.now() - 60_000
    ws1._recv({ ...joinedPayload(), inventory: { なす: { qty: 2, unit: '', enteredBy: 'オーナー', updatedAt: before } } })
    await p

    // 切れる（電波なし）
    ws1.close()
    // オフラインの間に入れる（切れた後の時刻）
    vi.advanceTimersByTime(500)
    local['なす'] = { qty: 4, unit: '', enteredBy: '鈴木', updatedAt: Date.now(), localEntry: true }
    // 1回目の再接続（1.5秒後）はつながらずに切れる
    vi.advanceTimersByTime(1100)
    const ws2 = MockWebSocket.instances[1]
    ws2.close()
    // 2回目の再接続（3秒後）でつながる。サーバーはオフライン前の 2 のまま
    vi.advanceTimersByTime(3100)
    const ws3 = MockWebSocket.instances[2]
    ws3._open()
    ws3._recv({ ...joinedPayload(), inventory: { なす: { qty: 2, unit: '', enteredBy: 'オーナー', updatedAt: before } } })

    const updates = ws3.sent.map(s => JSON.parse(s)).filter(m => m.type === 'update')
    expect(updates).toEqual([expect.objectContaining({ ingredient: 'なす', qty: 4 })])
    // サーバーの古い値（2）を手元へ当てていない
    expect(applied.filter(([n, q]) => n === 'なす' && q === 2)).toEqual([])
  })
})

describe('再接続時の競合をホストへ知らせるとき、名乗るのはゲスト自身（2026-11-27）', () => {
  it('conflict_notify の fromName はゲストの名前で、相手（サーバー側の値を入れた人）の名前ではない', async () => {
    const local = {}
    sync.registerInventoryGetter(() => local)
    const { joinRoom } = sync.useSync()
    const p = joinRoom('ROOMEE')
    const ws1 = MockWebSocket.instances[0]
    ws1._open()
    const before = Date.now() - 60_000
    ws1._recv({ ...joinedPayload(), inventory: { なす: { qty: 2, unit: '', enteredBy: 'オーナー', updatedAt: before } } })
    await p

    ws1.close()
    vi.advanceTimersByTime(500)
    local['なす'] = { qty: 4, unit: '', enteredBy: '鈴木', updatedAt: Date.now(), localEntry: true }
    vi.advanceTimersByTime(1100)
    const ws2 = MockWebSocket.instances[1]
    ws2._open()
    // その間にホスト（オーナー）が 6 にしていた
    ws2._recv({ ...joinedPayload(), inventory: { なす: { qty: 6, unit: '', enteredBy: 'オーナー', updatedAt: Date.now() } } })

    const notes = ws2.sent.map(s => JSON.parse(s)).filter(m => m.type === 'conflict_notify')
    expect(notes).toEqual([expect.objectContaining({ ingredient: 'なす', fromName: '鈴木', guestQty: 4, hostQty: 6 })])
  })
})

describe('ゲスト: ホストが解決した値は、自分の入力の直後でも新しい競合にしない（2026-11-27）', () => {
  it('競合中の品目に届いた update はそのまま当て、conflict_notify を送り直さない', async () => {
    const local = {}
    sync.registerInventoryGetter(() => local)
    const applied = []
    sync.setInventoryCallbacks((name, qty) => { applied.push([name, qty]) }, () => {})
    const { joinRoom } = sync.useSync()
    const p = joinRoom('ROOMFF')
    const ws = MockWebSocket.instances[0]
    ws._open()
    ws._recv({ ...joinedPayload(), inventory: { なす: { qty: 2, unit: '', enteredBy: 'オーナー', updatedAt: Date.now() - 60_000 } } })
    await p

    // ゲストが入れた直後に、ホストの 6 が届いて競合 → ホストへ通知・ロック
    local['なす'] = { qty: 4, unit: '', enteredBy: '鈴木', updatedAt: Date.now(), localEntry: true }
    ws._recv({ type: 'update', ingredient: 'なす', qty: 6, unit: '', enteredBy: 'オーナー', fromDeviceId: 'host-dev' })
    expect(ws.sent.map(s => JSON.parse(s)).filter(m => m.type === 'conflict_notify')).toHaveLength(1)
    expect(sync.lockedIngredients.has('なす')).toBe(true)

    // 1秒後（3秒の窓の中）にホストが合計 10 で解決 → そのまま当てる。もう一度通知しない
    vi.advanceTimersByTime(1000)
    ws._recv({ type: 'update', ingredient: 'なす', qty: 10, unit: '', enteredBy: 'オーナー', fromDeviceId: 'host-dev' })
    expect(applied).toContainEqual(['なす', 10])
    expect(ws.sent.map(s => JSON.parse(s)).filter(m => m.type === 'conflict_notify')).toHaveLength(1)
  })
})
