// 未送信の中身（ヘッダーの帯をタップしたときの一覧）。
// 棚卸データは店舗に1つの丸ごと保存なので、最後に送れた版より後に入れた品目だけを出す。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

async function freshStore() {
  vi.stubEnv('VITE_SYNC_WORKER_URL', 'https://sync.example.dev')
  vi.resetModules()
  return import('./useStore.js')
}
const ok = () => ({ ok: true, json: async () => ({ ok: true }) })
const item = (qty, updatedAt) => ({ qty, unit: '個', updatedAt })

describe('pendingDetails', () => {
  beforeEach(() => { localStorage.clear(); vi.unstubAllGlobals(); localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF') })
  afterEach(() => { vi.unstubAllGlobals() })

  it('送れた版より後の品目だけを未送信として出す', async () => {
    const store = await freshStore()
    vi.stubGlobal('fetch', async () => ok())
    await store.saveInventoryToD1({ inventory: { トマト: item(1, 100) }, savedAt: 150 })
    expect(store.pendingDetails.value).toEqual([])

    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    await store.saveInventoryToD1({ inventory: { トマト: item(1, 100), にら: item(2, 200) }, removedAt: { なす: 210 }, savedAt: 250 })
    const [d] = store.pendingDetails.value
    expect(d.label).toBe('棚卸データ')
    expect(d.items.map(i => i.name)).toEqual(['にら'])
    expect(d.note).toContain('1品目')

    vi.stubGlobal('fetch', async () => ok())
    await store.retryPendingSaves()
    expect(store.pendingDetails.value).toEqual([])
  })

  it('発注・入出庫は明細の品目を出す', async () => {
    const store = await freshStore()
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    await store.saveMovementToD1({ id: 'm1', date: '2026-10-31', type: 'in', lines: [{ item: '鶏もも', qty: 3, unit: 'kg' }] })
    const d = store.pendingDetails.value.find(x => x.kind === 'movement')
    expect(d.items[0]).toMatchObject({ name: '鶏もも', qty: 3, unit: 'kg' })
  })
})
