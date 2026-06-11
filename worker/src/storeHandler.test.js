import { describe, it, expect } from 'vitest'
import { handleConfigPut, handleInventoryPut, handleHistoryPost, handleSessionComplete } from './storeHandler.js'

// 書き込み系の最小モック（INSERT/UPDATE を success で返すだけ）
function createMockD1() {
  const lines = []
  const sessions = [{ id: 'sess-001', shop_code: 'ABCDEF', status: 'active' }]

  function prepare(sql) {
    const s = sql.replace(/\s+/g, ' ').trim()
    let bound = []
    const stmt = {
      bind(...a) { bound = a; return stmt },
      async run() {
        if (s.startsWith('INSERT INTO inventory_lines')) {
          const [session_id, shop_code, taken_at, item_name, , qty, unit, unit_price, line_value] = bound
          lines.push({ session_id, shop_code, taken_at, item_name, qty, unit, unit_price, line_value })
        }
        return { success: true }
      },
      async first() {
        if (s.includes('FROM sessions WHERE id')) return sessions.find(s => s.id === bound[0]) ?? null
        return null
      },
      async all() { return { results: [] } },
    }
    return stmt
  }

  async function batch(stmts) {
    const results = []
    for (const s of stmts) results.push(await s.run())
    return results
  }

  return { prepare, batch, _lines: lines, _sessions: sessions }
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

describe('handleSessionComplete — inventory_lines 展開', () => {
  const code    = 'ABCDEF'
  const sessId  = 'sess-001'
  const takenAt = '2026-06-11'
  const inventory = {
    'コーヒー豆': { qty: 5,  unit: 'kg' },
    '牛乳':       { qty: 12, unit: '本' },
  }
  const prices = { 'コーヒー豆': 2000 }

  it('品目数分の inventory_lines が挿入される', async () => {
    const db  = createMockD1()
    const res = await handleSessionComplete(db, code, sessId, { inventory, prices, takenAt })
    expect(res.ok).toBe(true)
    expect(db._lines).toHaveLength(2)
  })

  it('単価あり品目の line_value が正しく計算される', async () => {
    const db  = createMockD1()
    await handleSessionComplete(db, code, sessId, { inventory, prices, takenAt })
    const coffee = db._lines.find(l => l.item_name === 'コーヒー豆')
    expect(coffee.unit_price).toBe(2000)
    expect(coffee.line_value).toBe(10000)
  })

  it('単価なし品目の unit_price・line_value が null になる', async () => {
    const db  = createMockD1()
    await handleSessionComplete(db, code, sessId, { inventory, prices, takenAt })
    const milk = db._lines.find(l => l.item_name === '牛乳')
    expect(milk.unit_price).toBeNull()
    expect(milk.line_value).toBeNull()
  })

  it('存在しないセッションIDは 404 を返す', async () => {
    const db  = createMockD1()
    const res = await handleSessionComplete(db, code, 'no-such-id', { inventory, prices, takenAt })
    expect(res._status).toBe(404)
  })
})
