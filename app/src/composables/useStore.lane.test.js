// 保存の直列レーンとアカウント境界（DATA-001 / App第2セッション §3・§4）
//
// ここで守るのは2つ。
//
//  1. 同じ対象への送信は、queue の再送・直接保存のどちらから来ても**1本のレーン**を通る。
//     旧実装は `_drain` が `_inflight` を通さずに直接送っていたため、
//     「A の再送が飛んでいる最中に新しい B を直接保存」すると2本が同時にサーバーへ向かい、
//     遅れて決着した A が新しい B を最終状態として上書きできた。
//
//  2. 論理要求を作った時点の generation / shopCode / 認証主体を捨てない。
//     旧実装は generation を**実際の送信開始時**に読んでいたため、レーン待ちの間に
//     アカウントを切り替えると「旧店舗のデータを新しいトークンで送る」ことができた。
//
// sleep に依存させず、明示的な deferred で順序を作る。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

async function freshStore(url = 'https://sync.example.dev') {
  vi.stubEnv('VITE_SYNC_WORKER_URL', url)
  vi.resetModules()
  return import('./useStore.js')
}

const ok = () => ({ ok: true, json: async () => ({ ok: true }) })

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('保存レーン — queue再送と直接保存が競合しない', () => {
  beforeEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.useFakeTimers() })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

  it('Aの再送を保留 → Bを直接保存 → Aが遅れて決着してもサーバーの最終状態はB', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()

    // 1) A が失敗してキューへ入る
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    await store.saveConfigToD1({ order: ['A'] })
    expect(store.pendingCount.value).toBe(1)

    // 2) サーバー側の「適用」は応答が確定した時点とみなす。
    //    送信順が入れ替われば、古い A が新しい B を踏み潰せる。
    const applied = []
    const sent = []
    const gate = deferred()
    vi.stubGlobal('fetch', async (url, opt) => {
      const body = JSON.parse(opt.body)
      sent.push(body.order)
      if (body.order[0] === 'A') await gate.promise
      applied.push(body.order)
      return ok()
    })

    // 3) A の再送を開始（応答は保留）
    const draining = store.retryPendingSaves()
    await Promise.resolve()
    await Promise.resolve()
    expect(sent).toEqual([['A']])

    // 4) 保留中に新しい B を直接保存する
    const saving = store.saveConfigToD1({ order: ['B'] })

    // 5) A を遅れて解決させる
    gate.resolve()
    await draining
    await saving

    // 最終状態は B。A が後から上書きしていない
    expect(applied[applied.length - 1]).toEqual(['B'])
    // 同じ要求を二重送信していない（A 1回 + B 1回）
    expect(sent).toHaveLength(2)
    expect(store.pendingCount.value).toBe(0)
    expect(store.saveState.value).toBe('idle')
  })

  it('直接保存Bの成功後にAの再送が走っても、Aを送り直さない', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()

    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    await store.saveInventoryToD1({ v: 'A' })
    expect(store.pendingCount.value).toBe(1)

    const sent = []
    const gate = deferred()
    vi.stubGlobal('fetch', async (url, opt) => {
      const body = JSON.parse(opt.body)
      sent.push(body.v)
      if (body.v === 'B') await gate.promise
      return ok()
    })

    // B を先にレーンへ入れる（応答保留）。その最中に drain が走る。
    const saving = store.saveInventoryToD1({ v: 'B' })
    await Promise.resolve()
    const draining = store.retryPendingSaves()
    gate.resolve()
    await saving
    await draining

    // B の成功で A は用済み。レーン解放後に A を送らない
    expect(sent).toEqual(['B'])
    expect(store.pendingCount.value).toBe(0)
  })

  it('別keyは互いに待たない', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()

    const gate = deferred()
    const started = []
    vi.stubGlobal('fetch', async (url) => {
      started.push(url)
      if (url.endsWith('/config')) await gate.promise
      return ok()
    })

    const cfg = store.saveConfigToD1({ order: ['A'] })
    const inv = store.saveInventoryToD1({ v: 1 })
    await Promise.resolve()
    await Promise.resolve()

    // inventory は config の決着を待たずに送信されている
    expect(started.some(u => u.endsWith('/inventory'))).toBe(true)
    gate.resolve()
    await Promise.all([cfg, inv])
  })
})

describe('アカウント境界 — generationは論理要求の作成時に確定する', () => {
  beforeEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.useFakeTimers() })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

  it('A送信中に作った旧accountのBは、accountを切り替えた後で送られない', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'AAAAAA')
    localStorage.setItem(STORAGE_KEYS.authToken, 'token-old')
    const store = await freshStore()

    const requests = []
    const gate = deferred()
    vi.stubGlobal('fetch', async (url, opt) => {
      requests.push({ url, token: opt.headers?.Authorization ?? null })
      if (url.includes('/store/AAAAAA/config')) await gate.promise
      return ok()
    })

    // A: 送信中（応答保留）
    const a = store.saveConfigToD1({ order: ['A'] })
    await Promise.resolve()
    expect(requests).toHaveLength(1)

    // B: A のレーン待ちに入る旧アカウントの論理要求
    const b = store.saveConfigToD1({ order: ['B'] })

    // アカウント切替（別店舗ログイン相当）
    store.resetAccountData()
    localStorage.setItem(STORAGE_KEYS.authToken, 'token-new')
    store.shopCode.value = 'BBBBBB'

    gate.resolve()
    await a
    await b

    // 旧店舗への送信は保留中だった A の1本だけ。B は新トークンで送られていない
    const afterSwitch = requests.slice(1)
    expect(afterSwitch).toHaveLength(0)
    expect(requests.every(r => r.token === 'Bearer token-old')).toBe(true)

    // 新しいアカウントの保存は正常に動く
    const c = await store.saveConfigToD1({ order: ['C'] })
    expect(c).toBe(true)
    expect(requests.at(-1).url).toContain('/store/BBBBBB/config')
    expect(requests.at(-1).token).toBe('Bearer token-new')
  })

  it('店舗が変わっただけ（同一generation）の旧要求は、旧店舗のキューへ確定して送らない', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'AAAAAA')
    localStorage.setItem(STORAGE_KEYS.authToken, 'token-old')
    const store = await freshStore()

    const urls = []
    const gate = deferred()
    vi.stubGlobal('fetch', async (url) => {
      urls.push(url)
      if (url.includes('/store/AAAAAA/inventory')) await gate.promise
      return ok()
    })

    const a = store.saveInventoryToD1({ v: 'A' })
    await Promise.resolve()
    const b = store.saveInventoryToD1({ v: 'B' })

    // accountReset を伴わない切替（最悪ケース）
    store.shopCode.value = 'BBBBBB'
    gate.resolve()
    await a
    await b

    // B は BBBBBB へ送られていない
    expect(urls.filter(u => u.includes('BBBBBB'))).toHaveLength(0)
    // 旧店舗ぶんとして端末に残り、同じ店舗へ戻れば再送できる
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.pendingSaves))
    expect(saved.items.some(i => i.shopCode === 'AAAAAA' && i.payload.v === 'B')).toBe(true)
  })
})

describe('再ログインのdrain完了を待てる（clearAuthBlock）', () => {
  beforeEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.useFakeTimers() })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

  it('clearAuthBlock は drain の完了まで await できる', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'AAAAAA')
    localStorage.setItem(STORAGE_KEYS.authToken, 'tok')
    const store = await freshStore()

    vi.stubGlobal('fetch', async () => { const e = new Error('401'); e.status = 401; throw e })
    // 401 相当（fetch の応答で status を作る）
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) }))
    await store.saveConfigToD1({ order: ['A'] })
    expect(store.pendingCount.value).toBe(1)

    let done = false
    const gate = deferred()
    vi.stubGlobal('fetch', async () => { await gate.promise; done = true; return ok() })

    const p = store.clearAuthBlock()
    expect(done).toBe(false)
    gate.resolve()
    const res = await p

    expect(done).toBe(true)
    expect(res.drained).toBe(true)
    expect(store.pendingCount.value).toBe(0)
  })

  it('drainが失敗したら drained:false を返し、未送信は残る', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'AAAAAA')
    localStorage.setItem(STORAGE_KEYS.authToken, 'tok')
    const store = await freshStore()

    vi.stubGlobal('fetch', async () => ({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) }))
    await store.saveConfigToD1({ order: ['A'] })

    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    const res = await store.clearAuthBlock()

    expect(res.drained).toBe(false)
    expect(store.pendingCount.value).toBe(1)
  })
})

describe('失効直前のデバウンス保存をキューへ確定する（queuePendingSave）', () => {
  beforeEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.useFakeTimers() })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

  it('送信せずに旧店舗のキューへ入り、再ログイン後に送られる', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'AAAAAA')
    localStorage.setItem(STORAGE_KEYS.authToken, 'tok')
    const store = await freshStore()

    const spy = vi.fn(async () => ok())
    vi.stubGlobal('fetch', spy)

    store.noteAuthInvalidated('AAAAAA')
    store.queuePendingSave('config', { order: ['debounced'] }, { shopCode: 'AAAAAA' })
    store.shopCode.value = ''

    // 無効トークンで送っていない
    expect(spy).not.toHaveBeenCalled()
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.pendingSaves))
    expect(saved.items.some(i => i.kind === 'config' && i.shopCode === 'AAAAAA')).toBe(true)

    // 同じ店舗へ再ログイン → drain で送られる
    store.shopCode.value = 'AAAAAA'
    const res = await store.clearAuthBlock()
    expect(res.drained).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ order: ['debounced'] })
  })
})
