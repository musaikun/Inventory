// DATA-002 Phase 2 — 未送信データの端末保存と復元
//
// 以前は未送信キューをメモリだけに持っていたため、再送前にアプリを閉じると消えた。
// 完了した棚卸の snapshot が消えると、一覧（D1 sessions）には出るのに詳細が開けない。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

async function freshStore(url = 'https://sync.example.dev') {
  vi.stubEnv('VITE_SYNC_WORKER_URL', url)
  vi.resetModules()
  return import('./useStore.js')
}

const okFetch = () => ({ ok: true, json: async () => ({ ok: true }) })

describe('useStore 未送信データの永続化', () => {
  beforeEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.useFakeTimers() })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

  it('保存失敗した snapshot は端末に残り、再起動後に復元されて再送できる', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    await store.saveSnapshotToD1({ date: '2026-07-07', items: [{ item: 'トマト', qty: 3 }] })
    expect(store.saveState.value).toBe('pending')
    expect(localStorage.getItem(STORAGE_KEYS.pendingSaves)).toBeTruthy()

    // 「アプリを閉じて開き直す」= モジュールを読み込み直す
    const reopened = await freshStore()
    expect(reopened.saveState.value).toBe('pending')
    expect(reopened.pendingCount.value).toBe(1)

    const posted = []
    vi.stubGlobal('fetch', async (url) => { posted.push(url); return okFetch() })
    await reopened.retryPendingSaves()
    expect(posted).toHaveLength(1)
    expect(posted[0]).toContain('/store/ABCDEF/history')
    expect(reopened.saveState.value).toBe('idle')
    expect(localStorage.getItem(STORAGE_KEYS.pendingSaves)).toBeNull()
  })

  it('config / inventory の未送信も再起動をまたいで復元される', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    await store.saveConfigToD1({ order: ['トマト'] })
    await store.saveInventoryToD1({ トマト: { qty: 1 } })
    expect(store.pendingCount.value).toBe(2)

    const reopened = await freshStore()
    expect(reopened.pendingCount.value).toBe(2)
    const paths = []
    vi.stubGlobal('fetch', async (url) => { paths.push(url); return okFetch() })
    await reopened.retryPendingSaves()
    expect(paths.some(p => p.endsWith('/store/ABCDEF/config'))).toBe(true)
    expect(paths.some(p => p.endsWith('/store/ABCDEF/inventory'))).toBe(true)
    expect(reopened.saveState.value).toBe('idle')
  })

  it('別の店舗コードで開き直したら前の店舗の未送信分は捨てる', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'AAAAAA')
    const store = await freshStore()
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    await store.saveConfigToD1({ oldAccount: true })
    expect(localStorage.getItem(STORAGE_KEYS.pendingSaves)).toBeTruthy()

    // 別アカウントでログインした端末として開き直す
    localStorage.setItem(STORAGE_KEYS.shopCode, 'BBBBBB')
    const reopened = await freshStore()
    expect(reopened.pendingCount.value).toBe(0)
    expect(reopened.saveState.value).toBe('idle')
    expect(localStorage.getItem(STORAGE_KEYS.pendingSaves)).toBeNull()

    const fetchSpy = vi.fn(async () => okFetch())
    vi.stubGlobal('fetch', fetchSpy)
    await reopened.retryPendingSaves()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('resetAccountData は端末に残した未送信分も消す', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    await store.saveSnapshotToD1({ date: '2026-07-07', items: [] })
    expect(localStorage.getItem(STORAGE_KEYS.pendingSaves)).toBeTruthy()

    store.resetAccountData()
    expect(localStorage.getItem(STORAGE_KEYS.pendingSaves)).toBeNull()
    expect(store.pendingCount.value).toBe(0)
  })

  it('resumePendingSaves は復元した未送信分を起動時に送る', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    await store.saveSnapshotToD1({ date: '2026-07-07', items: [] })

    const reopened = await freshStore()
    const posted = []
    vi.stubGlobal('fetch', async (url) => { posted.push(url); return okFetch() })
    expect(reopened.resumePendingSaves()).toBe(true)
    await vi.waitFor(() => expect(reopened.saveState.value).toBe('idle'))
    expect(posted).toHaveLength(1)
  })

  it('未送信が無ければ resumePendingSaves は何も送らない', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()
    const fetchSpy = vi.fn(async () => okFetch())
    vi.stubGlobal('fetch', fetchSpy)
    expect(store.resumePendingSaves()).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('再送が続けて失敗すると saveFailures が進む（保存できていないと表示する根拠）', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    await store.saveSnapshotToD1({ date: '2026-07-07', items: [] })
    expect(store.saveFailures.value).toBe(0)

    await store.retryPendingSaves()
    expect(store.saveFailures.value).toBe(1)
    await store.retryPendingSaves()
    expect(store.saveFailures.value).toBe(2)

    vi.stubGlobal('fetch', async () => okFetch())
    await store.retryPendingSaves()
    expect(store.saveFailures.value).toBe(0)
    expect(store.saveState.value).toBe('idle')
  })

  it('端末に保存できない環境でも未送信分は失わず、その旨を示す', async () => {
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    const store = await freshStore()
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key) => {
      if (key === STORAGE_KEYS.pendingSaves) throw new Error('QuotaExceededError')
    })
    try {
      vi.stubGlobal('fetch', async () => { throw new Error('offline') })
      await store.saveSnapshotToD1({ date: '2026-07-07', items: [] })
      expect(store.pendingPersisted.value).toBe(false)
      expect(store.pendingCount.value).toBe(1)   // メモリ上では保持している
    } finally {
      setItem.mockRestore()
    }

    vi.stubGlobal('fetch', async () => okFetch())
    await store.retryPendingSaves()
    expect(store.saveState.value).toBe('idle')
  })
})
