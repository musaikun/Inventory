// 認証失効とキューの同一性・順序（DATA-001 §2 / §3）
//
// 守りたいのは4つ。
//  1. 401 で作業を消さない — 失効の原因になった最新版がキューに残る
//  2. 同じ店舗へ再ログインしたときだけ再送する（別店舗へは送らない＝アカウント境界）
//  3. 同じ日の別セッションのスナップショットが2件とも残る
//  4. 同じ対象への直接保存は順序が保たれる（応答が逆順でも最後に投げた版が最終値）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

async function freshStore(url = 'https://sync.example.dev') {
  vi.stubEnv('VITE_SYNC_WORKER_URL', url)
  vi.resetModules()
  return import('./useStore.js')
}

const ok = () => ({ ok: true, json: async () => ({ ok: true }) })
function httpError(status) {
  return async () => ({ ok: false, status, json: async () => ({ error: `HTTP ${status}` }) })
}

/** 実運用の 401 経路: api.js の失効ハンドラが shopCode を消してから catch が走る */
function authInvalidatedOn(store, code) {
  return async () => {
    store.noteAuthInvalidated(code)
    store.shopCode.value = ''          // clearAuthLocal 相当
    localStorage.removeItem(STORAGE_KEYS.shopCode)
    return { ok: false, status: 401, json: async () => ({ error: 'HTTP 401' }) }
  }
}

describe('401 — 作業中の保存を消さない', () => {
  beforeEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.useFakeTimers() })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

  it('失効ハンドラが shopCode を消した後でも、原因になった最新版がキューに残る', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'AAAAAA')
    localStorage.setItem(STORAGE_KEYS.authToken, 'tok')
    const store = await freshStore()

    vi.stubGlobal('fetch', authInvalidatedOn(store, 'AAAAAA'))
    await store.saveInventoryToD1({ トマト: { qty: 42 } })

    // shopCode は空。旧実装はこの stale 判定で最新版を握りつぶしていた
    expect(store.shopCode.value).toBe('')
    // 端末には元の店舗コードに紐付いて残っている
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.pendingSaves))
    expect(saved.items).toHaveLength(1)
    expect(saved.items[0].shopCode).toBe('AAAAAA')
    expect(saved.items[0].payload).toEqual({ トマト: { qty: 42 } })
  })

  it('同じ店舗へ再ログインすると再送される', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'AAAAAA')
    localStorage.setItem(STORAGE_KEYS.authToken, 'tok')
    const store = await freshStore()

    vi.stubGlobal('fetch', authInvalidatedOn(store, 'AAAAAA'))
    await store.saveInventoryToD1({ トマト: { qty: 42 } })

    // 再起動をまたいでも残る
    localStorage.setItem(STORAGE_KEYS.shopCode, 'AAAAAA')
    const reopened = await freshStore()
    expect(reopened.pendingCount.value).toBe(1)

    const sent = []
    vi.stubGlobal('fetch', async (url, opt) => { sent.push({ url, body: JSON.parse(opt.body) }); return ok() })
    reopened.clearAuthBlock()          // ログイン成功時の wiring（App.vue の onAuthDone）
    await reopened.retryPendingSaves()

    expect(sent).toHaveLength(1)
    expect(sent[0].url).toContain('/store/AAAAAA/inventory')
    expect(sent[0].body).toEqual({ トマト: { qty: 42 } })
    expect(reopened.saveState.value).toBe('idle')
  })

  it('別店舗へログインしても旧店舗の未送信データは送らない', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'AAAAAA')
    localStorage.setItem(STORAGE_KEYS.authToken, 'tok')
    const store = await freshStore()

    vi.stubGlobal('fetch', authInvalidatedOn(store, 'AAAAAA'))
    await store.saveInventoryToD1({ トマト: { qty: 42 } })
    expect(store.pendingCount.value).toBe(0)   // ログアウト中は現在店舗ぶん 0 件

    // 別店舗でログインした（accountReset が走らない最悪ケースでも送らないこと）
    store.shopCode.value = 'BBBBBB'
    const fetchSpy = vi.fn(async () => ok())
    vi.stubGlobal('fetch', fetchSpy)
    store.clearAuthBlock()
    await store.retryPendingSaves()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(store.pendingCount.value).toBe(0)
  })

  it('401中は再送しない（無駄な401を積み重ねない）', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'AAAAAA')
    localStorage.setItem(STORAGE_KEYS.authToken, 'tok')
    const store = await freshStore()

    vi.stubGlobal('fetch', httpError(401))
    await store.saveConfigToD1({ order: ['A'] })
    expect(store.pendingCount.value).toBe(1)

    const spy = vi.fn(async () => ok())
    vi.stubGlobal('fetch', spy)
    await store.retryPendingSaves()
    expect(spy).not.toHaveBeenCalled()
  })

  it('再送中の401でも認証失効として止める（stale判定より先に見る）', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'AAAAAA')
    localStorage.setItem(STORAGE_KEYS.authToken, 'tok')
    const store = await freshStore()

    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    await store.saveConfigToD1({ order: ['A'] })
    await store.saveInventoryToD1({ b: 1 })
    expect(store.pendingCount.value).toBe(2)

    // drain 中に失効。1件目で止まり、2件目は送らない
    let calls = 0
    vi.stubGlobal('fetch', async () => { calls++; return authInvalidatedOn(store, 'AAAAAA')() })
    await store.retryPendingSaves()

    expect(calls).toBe(1)
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.pendingSaves))
    expect(saved.items).toHaveLength(2)          // 2件とも端末に残る
  })
})

describe('キューの同一性 — 同日別セッション', () => {
  beforeEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.useFakeTimers() })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

  it('同じ日の別セッションのsnapshotは2件とも残り、2件とも送られる', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })

    await store.saveSnapshotToD1({ sessionId: 's1', date: '2026-08-10', items: [{ item: '朝の棚卸' }] })
    await store.saveSnapshotToD1({ sessionId: 's2', date: '2026-08-10', items: [{ item: '夜の棚卸' }] })
    // 日付を識別子にしていた旧実装は、ここで 1件へ潰れて片方が消えていた
    expect(store.pendingCount.value).toBe(2)

    const sent = []
    vi.stubGlobal('fetch', async (url, opt) => { sent.push(JSON.parse(opt.body)); return ok() })
    await store.retryPendingSaves()

    expect(sent.map(s => s.sessionId).sort()).toEqual(['s1', 's2'])
  })

  it('同じセッションの新しい版は集約する（latest-wins）', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    await store.saveSnapshotToD1({ sessionId: 's1', date: '2026-08-10', items: [1] })
    await store.saveSnapshotToD1({ sessionId: 's1', date: '2026-08-10', items: [1, 2] })
    expect(store.pendingCount.value).toBe(1)

    const sent = []
    vi.stubGlobal('fetch', async (url, opt) => { sent.push(JSON.parse(opt.body)); return ok() })
    await store.retryPendingSaves()
    expect(sent).toHaveLength(1)
    expect(sent[0].items).toEqual([1, 2])
  })

  it('sessionId を持たない legacy 行は従来どおり日付で集約する', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    await store.saveSnapshotToD1({ date: '2026-08-10', items: [1] })
    await store.saveSnapshotToD1({ date: '2026-08-10', items: [1, 2] })
    await store.saveSnapshotToD1({ date: '2026-08-11', items: [3] })
    expect(store.pendingCount.value).toBe(2)
  })
})

describe('直接保存の順序 — 応答が逆順で返っても最後の版が残る', () => {
  beforeEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.useFakeTimers() })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

  it('A→Bの順に保存したら、サーバーが受け取る順もA→B', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()

    // A の応答を遅らせる。並行に投げる旧実装ではBが先に届き、
    // 遅れて届いたAがサーバー上の最終値になりえた。
    const received = []
    const gates = []
    vi.stubGlobal('fetch', async (url, opt) => {
      const body = JSON.parse(opt.body)
      received.push(body.v)
      if (body.v === 'A') await new Promise(r => gates.push(r))
      return ok()
    })

    const a = store.saveInventoryToD1({ v: 'A' })
    const b = store.saveInventoryToD1({ v: 'B' })

    // A が決着するまで B は送られない
    expect(received).toEqual(['A'])
    gates.forEach(r => r())
    await Promise.all([a, b])

    expect(received).toEqual(['A', 'B'])          // サーバー到達順 = 発生順
    expect(received[received.length - 1]).toBe('B')
  })

  it('先行の直接保存が失敗しても、後続はキューの古い版に巻き戻されない', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()

    let fail = true
    const received = []
    vi.stubGlobal('fetch', async (url, opt) => {
      const body = JSON.parse(opt.body)
      if (body.v === 'A' && fail) { fail = false; throw new Error('offline') }
      received.push(body.v)
      return ok()
    })

    const a = store.saveInventoryToD1({ v: 'A' })
    const b = store.saveInventoryToD1({ v: 'B' })
    await Promise.all([a, b])

    expect(received).toEqual(['B'])
    // B の成功で A のキュー項目は用済み。再送しても A は送られない
    await store.retryPendingSaves()
    expect(received).toEqual(['B'])
    expect(store.pendingCount.value).toBe(0)
  })
})

describe('拒否された保存はリロードしても残る', () => {
  beforeEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.useFakeTimers() })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

  it('400で拒否された事実が再起動後も確認できる', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()
    vi.stubGlobal('fetch', httpError(400))
    await store.saveOrderToD1({ id: 'o1' })
    expect(store.rejectedSaves.value).toHaveLength(1)

    const reopened = await freshStore()
    expect(reopened.rejectedSaves.value).toHaveLength(1)
    expect(reopened.rejectedSaves.value[0].status).toBe(400)
    expect(reopened.rejectedSaves.value[0].label).toBe('発注')
  })

  it('ユーザーが閉じたら再起動後も出ない', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()
    vi.stubGlobal('fetch', httpError(413))
    await store.saveSnapshotToD1({ sessionId: 's1', date: '2026-08-10', items: [] })
    expect(store.rejectedSaves.value).toHaveLength(1)

    store.dismissRejectedSaves()
    const reopened = await freshStore()
    expect(reopened.rejectedSaves.value).toHaveLength(0)
  })
})
