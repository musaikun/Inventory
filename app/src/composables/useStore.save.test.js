import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

async function freshStore(url = 'https://sync.example.dev') {
  vi.stubEnv('VITE_SYNC_WORKER_URL', url)
  vi.resetModules()
  return import('./useStore.js')
}

describe('useStore D1保存の状態と再送', () => {
  beforeEach(() => { localStorage.clear(); vi.unstubAllGlobals() })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

  it('保存成功なら saveState は idle のまま', async () => {
    const store = await freshStore()
    store.shopCode.value = 'ABCDEF'
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ ok: true }) }))
    await store.saveInventoryToD1({ a: { qty: 1 } })
    expect(store.saveState.value).toBe('idle')
  })

  it('保存失敗で pending になり、再送成功で idle に戻る', async () => {
    vi.useFakeTimers()
    const store = await freshStore()
    store.shopCode.value = 'ABCDEF'

    vi.stubGlobal('fetch', async () => { throw new Error('network down') })
    await store.saveConfigToD1({ order: ['x'] })
    expect(store.saveState.value).toBe('pending')

    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ ok: true }) }))
    await store.retryPendingSaves()
    expect(store.saveState.value).toBe('idle')

    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('snapshot 保存失敗はキューされ、再送で送信される', async () => {
    vi.useFakeTimers()
    const store = await freshStore()
    store.shopCode.value = 'ABCDEF'

    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    await store.saveSnapshotToD1({ date: '2026-07-07', items: [] })
    expect(store.saveState.value).toBe('pending')

    let posted = 0
    vi.stubGlobal('fetch', async () => { posted++; return { ok: true, json: async () => ({ ok: true }) } })
    await store.retryPendingSaves()
    expect(posted).toBe(1)
    expect(store.saveState.value).toBe('idle')

    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('アカウント境界では旧店舗の未送信queueを破棄する', async () => {
    vi.useFakeTimers()
    const store = await freshStore()
    store.shopCode.value = 'AAAAAA'
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await store.saveConfigToD1({ oldAccount: true })
    expect(store.saveState.value).toBe('pending')

    store.resetAccountData()
    store.shopCode.value = 'BBBBBB'
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    vi.stubGlobal('fetch', fetchSpy)
    await store.retryPendingSaves()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(store.saveState.value).toBe('idle')
  })

  it('境界前に開始した保存の遅延失敗でqueueを復活させない', async () => {
    vi.useFakeTimers()
    const store = await freshStore()
    store.shopCode.value = 'AAAAAA'
    let rejectFetch
    vi.stubGlobal('fetch', vi.fn(() => new Promise((_, reject) => { rejectFetch = reject })))

    const pending = store.saveInventoryToD1({ oldAccount: true })
    store.resetAccountData()
    store.shopCode.value = 'BBBBBB'
    rejectFetch(new Error('late failure'))
    await pending

    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    vi.stubGlobal('fetch', fetchSpy)
    await store.retryPendingSaves()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(store.saveState.value).toBe('idle')
  })
})
