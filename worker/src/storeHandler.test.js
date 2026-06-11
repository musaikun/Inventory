import { describe, it, expect } from 'vitest'
import { handleConfigPut, handleInventoryPut, handleHistoryPost } from './storeHandler.js'

// 書き込み系の最小モック（INSERT/UPDATE を success で返すだけ）
function createMockD1() {
  return {
    prepare() {
      const stmt = {
        bind() { return stmt },
        async run()   { return { success: true } },
        async first() { return null },
        async all()   { return { results: [] } },
      }
      return stmt
    },
  }
}

describe('storeHandler ペイロードサイズ上限', () => {
  const code = 'ABCDEF'

  it('通常サイズの config は保存できる', async () => {
    const db  = createMockD1()
    const res = await handleConfigPut(db, code, { items: ['鶏もも', '玉ねぎ'], prices: { 鶏もも: 500 } })
    expect(res.ok).toBe(true)
  })

  it('巨大な config は 413 を返し保存しない', async () => {
    const db  = createMockD1()
    const res = await handleConfigPut(db, code, { blob: 'x'.repeat(1_100_000) })
    expect(res._status).toBe(413)
  })

  it('通常サイズの inventory は保存できる', async () => {
    const db  = createMockD1()
    const res = await handleInventoryPut(db, code, { inventory: { 鶏もも: { qty: 5, unit: 'kg' } } })
    expect(res.ok).toBe(true)
  })

  it('巨大な inventory は 413 を返し保存しない', async () => {
    const db  = createMockD1()
    const res = await handleInventoryPut(db, code, { blob: 'x'.repeat(1_100_000) })
    expect(res._status).toBe(413)
  })

  it('巨大な history スナップショットは 413 を返し保存しない', async () => {
    const db  = createMockD1()
    const res = await handleHistoryPost(db, code, { date: '2026-06-11', blob: 'x'.repeat(1_100_000) })
    expect(res._status).toBe(413)
  })
})
