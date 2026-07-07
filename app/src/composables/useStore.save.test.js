import { describe, it, expect, beforeEach, vi } from 'vitest'

async function freshStore(url = 'https://sync.example.dev') {
  vi.stubEnv('VITE_SYNC_WORKER_URL', url)
  vi.resetModules()
  return import('./useStore.js')
}

describe('useStore D1保存の状態と再送', () => {
  beforeEach(() => { localStorage.clear(); vi.unstubAllGlobals() })

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
})
