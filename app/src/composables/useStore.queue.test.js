// 未送信キューの整合（CCレビュー修正 第1セッション）
//
// 守りたいのは3つ。
//  1. 古い版が新しい版を巻き戻さない（latest-wins）
//  2. drain が同時に走っても二重送信・取りこぼしをしない（直列化）
//  3. 再送しても直らない失敗と、時間を置けば直る失敗を区別する
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

async function freshStore(url = 'https://sync.example.dev') {
  vi.stubEnv('VITE_SYNC_WORKER_URL', url)
  vi.resetModules()
  return import('./useStore.js')
}

const ok = () => ({ ok: true, json: async () => ({ ok: true }) })

// apiFetch は fetch を包むだけなので、fetch のレスポンスで status を作る
function httpError(status) {
  return async () => ({ ok: false, status, json: async () => ({ error: `HTTP ${status}` }) })
}

describe('未送信キュー — latest-wins', () => {
  beforeEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.useFakeTimers() })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

  it('古いAが失敗 → 新しいBが成功 → 再送でBを巻き戻さない', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()

    // A: 失敗してキューに入る
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    await store.saveConfigToD1({ order: ['A'] })
    expect(store.pendingCount.value).toBe(1)

    // B: 同じ対象の新しい版が成功する
    const sent = []
    vi.stubGlobal('fetch', async (url, opt) => { sent.push(JSON.parse(opt.body)); return ok() })
    await store.saveConfigToD1({ order: ['B'] })

    // Bの成功でAは用済み。再送は何も送らない
    expect(store.pendingCount.value).toBe(0)
    await store.retryPendingSaves()
    expect(sent).toHaveLength(1)
    expect(sent[0].order).toEqual(['B'])
    expect(store.saveState.value).toBe('idle')
  })

  it('同じ対象を複数回失敗しても、最後の版だけが残る', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    await store.saveInventoryToD1({ v: 1 })
    await store.saveInventoryToD1({ v: 2 })
    await store.saveInventoryToD1({ v: 3 })
    expect(store.pendingCount.value).toBe(1)

    const sent = []
    vi.stubGlobal('fetch', async (url, opt) => { sent.push(JSON.parse(opt.body)); return ok() })
    await store.retryPendingSaves()
    expect(sent).toEqual([{ v: 3 }])
  })

  it('同じ日付のsnapshotは1件に集約し、別日付は別々に送る', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    await store.saveSnapshotToD1({ date: '2026-07-07', items: [1] })
    await store.saveSnapshotToD1({ date: '2026-07-07', items: [1, 2] })
    await store.saveSnapshotToD1({ date: '2026-07-08', items: [3] })
    expect(store.pendingCount.value).toBe(2)

    const sent = []
    vi.stubGlobal('fetch', async (url, opt) => { sent.push(JSON.parse(opt.body)); return ok() })
    await store.retryPendingSaves()
    expect(sent).toHaveLength(2)
    expect(sent.find(s => s.date === '2026-07-07').items).toEqual([1, 2])
  })

  it('発注・入出庫は id ごとに別項目として残る', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    await store.saveOrderToD1({ id: 'o1', qty: 1 })
    await store.saveOrderToD1({ id: 'o2', qty: 2 })
    await store.saveOrderToD1({ id: 'o1', qty: 9 })   // o1 の更新
    expect(store.pendingCount.value).toBe(2)

    const sent = []
    vi.stubGlobal('fetch', async (url, opt) => { sent.push(JSON.parse(opt.body)); return ok() })
    await store.retryPendingSaves()
    expect(sent.find(o => o.id === 'o1').qty).toBe(9)
    expect(sent.find(o => o.id === 'o2').qty).toBe(2)
  })
})

describe('未送信キュー — drainの直列化', () => {
  beforeEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.useFakeTimers() })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

  it('同時に呼んでも送信は1回だけ', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    await store.saveSnapshotToD1({ date: '2026-07-07', items: [] })

    let posts = 0
    let release
    const gate = new Promise(r => { release = r })
    vi.stubGlobal('fetch', async () => { posts++; await gate; return ok() })

    // 起動・接続復帰・手動が同時に来た状況
    const a = store.retryPendingSaves()
    const b = store.retryPendingSaves()
    const c = store.retryPendingSaves()
    release()
    await Promise.all([a, b, c])

    expect(posts).toBe(1)
    expect(store.saveState.value).toBe('idle')
  })
})

describe('未送信キュー — 失敗の種類を分ける', () => {
  beforeEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.useFakeTimers() })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

  it('400はサーバーに拒否された扱いで、再送せず内容を提示する', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()
    vi.stubGlobal('fetch', httpError(400))
    await store.saveOrderToD1({ id: 'o1' })

    expect(store.pendingCount.value).toBe(0)      // 何度送っても直らないので溜めない
    expect(store.saveState.value).toBe('idle')
    expect(store.rejectedSaves.value).toHaveLength(1)
    expect(store.rejectedSaves.value[0].status).toBe(400)
    expect(store.rejectedSaves.value[0].label).toBe('発注')
  })

  it('413（大きすぎる）も拒否として扱い、黙って消さない', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()
    vi.stubGlobal('fetch', httpError(413))
    await store.saveSnapshotToD1({ date: '2026-07-07', items: [] })
    expect(store.pendingCount.value).toBe(0)
    expect(store.rejectedSaves.value[0].status).toBe(413)
  })

  it('429と5xxは再送対象として残す', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()

    vi.stubGlobal('fetch', httpError(429))
    await store.saveMovementToD1({ id: 'm1' })
    expect(store.pendingCount.value).toBe(1)

    vi.stubGlobal('fetch', httpError(503))
    await store.saveMovementToD1({ id: 'm2' })
    expect(store.pendingCount.value).toBe(2)
    expect(store.rejectedSaves.value).toHaveLength(0)

    vi.stubGlobal('fetch', async () => ok())
    await store.retryPendingSaves()
    expect(store.saveState.value).toBe('idle')
  })

  it('401は認証失効として再送を止め、再ログインで再開する', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    localStorage.setItem(STORAGE_KEYS.authToken, 'tok')
    const store = await freshStore()

    vi.stubGlobal('fetch', httpError(401))
    await store.saveConfigToD1({ order: ['A'] })
    expect(store.pendingCount.value).toBe(1)

    // 失効中は送らない（無駄な401を積み重ねない）
    const spy = vi.fn(async () => ok())
    vi.stubGlobal('fetch', spy)
    await store.retryPendingSaves()
    expect(spy).not.toHaveBeenCalled()

    // 再ログイン後は再開する
    expect(store.clearAuthBlock()).toBe(true)
    await store.retryPendingSaves()
    expect(spy).toHaveBeenCalled()
    expect(store.saveState.value).toBe('idle')
  })
})

describe('未送信キュー — 端末保存の正直さ', () => {
  beforeEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.useFakeTimers() })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

  it('件数上限で黙って捨てない（21件目のsnapshotも復元できる）', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    for (let i = 0; i < 25; i++) {
      await store.saveSnapshotToD1({ date: `2026-07-${String(i + 1).padStart(2, '0')}`, items: [i] })
    }
    expect(store.pendingCount.value).toBe(25)
    expect(store.pendingPersisted.value).toBe(true)
    expect(store.unpersistedCount.value).toBe(0)

    const reopened = await freshStore()
    expect(reopened.pendingCount.value).toBe(25)   // 旧実装は20件で切り捨てていた
  })

  it('端末に入りきらない分は件数として表に出す', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    await store.saveSnapshotToD1({ date: '2026-07-07', items: [] })
    await store.saveSnapshotToD1({ date: '2026-07-08', items: [] })

    // 以降の書き込みは常に容量不足
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key) => {
      if (key === STORAGE_KEYS.pendingSaves) throw new Error('QuotaExceededError')
    })
    try {
      await store.saveSnapshotToD1({ date: '2026-07-09', items: [] })
      expect(store.pendingCount.value).toBe(3)              // メモリ上は失っていない
      expect(store.pendingPersisted.value).toBe(false)      // が、端末には残せていない
      expect(store.unpersistedCount.value).toBeGreaterThan(0)
    } finally {
      setItem.mockRestore()
    }
  })

  it('アカウント切替で拒否リストと未保存件数も消える', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()
    vi.stubGlobal('fetch', httpError(400))
    await store.saveOrderToD1({ id: 'o1' })
    expect(store.rejectedSaves.value).toHaveLength(1)

    store.resetAccountData()
    expect(store.rejectedSaves.value).toHaveLength(0)
    expect(store.unpersistedCount.value).toBe(0)
    expect(store.pendingCount.value).toBe(0)
  })
})
