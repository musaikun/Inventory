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

// ── 正常な解散を「つなぎ替え」と誤認しない（再レビュー3 §1）──────────────────
//
// 実 Worker（RoomDO の `dissolve`）は **ホスト自身へ dissolved を送らず**、直後に
// すべての socket を close する。つまり正常な解散でも
//   1. ホストの onclose が `_ws = null` にする
//   2. mode が hosting のままなので再接続タイマーが登録される
//   3. 150ms 後の照合で「socket が違う」と判定される
// となり、`clearHostToken()` / `leaveRoom()` が実行されないまま hosting 状態と
// token と再接続タイマーが残る＝解散直後にルームを作り直してしまう。
describe('dissolveRoom — Worker側のcloseを「つなぎ替え」と誤認しない', () => {
  it('解散送信直後にserverがsocketを閉じても、token削除・idle化まで行う', async () => {
    const api = sync.useSync()
    const ws1 = await hostRoom(api, 'SHOPAA')
    localStorage.setItem(`${STORAGE_KEYS.hostTokenPrefix}SHOPAA`, 'tok-A')

    const dissolving = api.dissolveRoom()
    await Promise.resolve()
    expect(JSON.parse(ws1.sent.at(-1)).type).toBe('dissolve')

    // 実 Worker と同じ: dissolved はホストへ送らず、socket を閉じる
    ws1.close()
    const wsCountAfterClose = MockWebSocket.instances.length

    vi.advanceTimersByTime(200)
    await dissolving

    expect(localStorage.getItem(`${STORAGE_KEYS.hostTokenPrefix}SHOPAA`)).toBeNull()
    expect(api.state.mode).toBe('idle')
    expect(api.state.roomCode).toBeNull()

    // 再接続タイマーが残っていないこと（解散したルームを作り直さない）
    vi.advanceTimersByTime(60000)
    expect(MockWebSocket.instances.length).toBe(wsCountAfterClose)
  })
})

// ── dissolveRoomRemote のアカウント切替競合（再レビュー3 §3）─────────────────
//
// `clearHostToken(type)` は **現在の shopCode** から key を作る。待機中に店舗が
// 変わると、A の解散応答で B の host token を消せる。
describe('dissolveRoomRemote — 待機中の店舗切替で別店舗のtokenを消さない', () => {
  it('店舗AのdissolveがBのhost tokenを削除しない', async () => {
    localStorage.setItem(`${STORAGE_KEYS.hostTokenPrefix}SHOPAA`, 'tok-A')
    let release
    const fetchMock = vi.fn(() => new Promise(r => { release = () => r({ ok: true, json: async () => ({}) }) }))
    vi.stubGlobal('fetch', fetchMock)

    const p = sync.dissolveRoomRemote('stock')
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // 待機中に別店舗へ切り替わり、その店舗の host token が保存される
    const { shopCode } = await import('./useStore.js')
    shopCode.value = 'SHOPBB'
    localStorage.setItem(`${STORAGE_KEYS.hostTokenPrefix}SHOPBB`, 'tok-B')

    release()
    await p

    expect(localStorage.getItem(`${STORAGE_KEYS.hostTokenPrefix}SHOPBB`)).toBe('tok-B')
    expect(localStorage.getItem(`${STORAGE_KEYS.hostTokenPrefix}SHOPAA`)).toBeNull()
  })

  it('同じ店舗のままなら従来どおり削除する', async () => {
    localStorage.setItem(`${STORAGE_KEYS.hostTokenPrefix}SHOPAA`, 'tok-A')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))

    await sync.dissolveRoomRemote('stock')
    expect(localStorage.getItem(`${STORAGE_KEYS.hostTokenPrefix}SHOPAA`)).toBeNull()
  })

  it('待機中に同じ店舗で新しいtokenへ差し替わったら消さない', async () => {
    localStorage.setItem(`${STORAGE_KEYS.hostTokenPrefix}SHOPAA`, 'tok-old')
    let release
    vi.stubGlobal('fetch', vi.fn(() => new Promise(r => { release = () => r({ ok: true, json: async () => ({}) }) })))

    const p = sync.dissolveRoomRemote('stock')
    await Promise.resolve()
    localStorage.setItem(`${STORAGE_KEYS.hostTokenPrefix}SHOPAA`, 'tok-new')   // 新しいルームを作った

    release()
    await p
    expect(localStorage.getItem(`${STORAGE_KEYS.hostTokenPrefix}SHOPAA`)).toBe('tok-new')
  })
})

// ── 接続世代（再レビュー3 §2 で App が使う）───────────────────────────────────
describe('接続世代', () => {
  it('新しい接続を張るたびに進む', async () => {
    const api = sync.useSync()
    const before = sync.captureSyncConnection()
    expect(sync.isSyncConnectionStale(before)).toBe(false)

    await hostRoom(api, 'SHOPAA')
    expect(sync.isSyncConnectionStale(before)).toBe(true)
  })

  it('解散・退出だけでは進まない（解散後の後片付けを失効させない）', async () => {
    const api = sync.useSync()
    await hostRoom(api, 'SHOPAA')
    const token = sync.captureSyncConnection()

    const dissolving = api.dissolveRoom()
    vi.advanceTimersByTime(200)
    await dissolving

    expect(sync.isSyncConnectionStale(token)).toBe(false)
  })
})

// ── 接続世代を解散処理自身が使う（再レビュー4 §1）────────────────────────────
//
// `_ws` に代入されるのは **onopen 後**。同じ shop/room/type へ張り直した新 socket が
// まだ CONNECTING の間は `_ws` が null のままなので、socket / shop / room / type の
// 比較だけでは切替を検出できない。token を消して `leaveRoom()` しても接続中の socket は
// 閉じられず、後から onopen して接続が復活する。
describe('dissolveRoom — CONNECTING中の張り直しも切替として扱う', () => {
  it('同じルームへ張り直し中（未openの新socket）なら片付けない', async () => {
    const api = sync.useSync()
    const ws1 = await hostRoom(api, 'SHOPAA')
    localStorage.setItem(`${STORAGE_KEYS.hostTokenPrefix}SHOPAA`, 'tok-A')

    const dissolving = api.dissolveRoom()
    await Promise.resolve()
    ws1.close()                                   // Worker が閉じる

    // 同じ店舗・同じルームへ張り直す（onopen させないので _ws は null のまま）
    api.createRoom('stock').catch(() => {})
    const ws2 = MockWebSocket.instances.at(-1)
    expect(ws2).not.toBe(ws1)
    expect(ws2.readyState).toBe(MockWebSocket.CONNECTING)

    vi.advanceTimersByTime(200)
    const res = await dissolving

    expect(res.ok).toBe(false)
    expect(res.reason).toBe('connection_changed')
    // 張り直し中の接続は閉じない。token も残す（新しいルームのもの）
    expect(ws2.closed).toBe(false)
    expect(localStorage.getItem(`${STORAGE_KEYS.hostTokenPrefix}SHOPAA`)).toBe('tok-A')
  })

  it('片付けたときは ok:true を返す（呼び出し側が判断できる）', async () => {
    const api = sync.useSync()
    const ws1 = await hostRoom(api, 'SHOPAA')
    localStorage.setItem(`${STORAGE_KEYS.hostTokenPrefix}SHOPAA`, 'tok-A')

    const dissolving = api.dissolveRoom()
    await Promise.resolve()
    ws1.close()
    vi.advanceTimersByTime(200)
    const res = await dissolving

    expect(res.ok).toBe(true)
    expect(localStorage.getItem(`${STORAGE_KEYS.hostTokenPrefix}SHOPAA`)).toBeNull()
    expect(api.state.mode).toBe('idle')
  })

  it('接続していないときも ok:true（送るものが無い）', async () => {
    const api = sync.useSync()
    const res = await api.dissolveRoom()
    expect(res.ok).toBe(true)
  })
})
