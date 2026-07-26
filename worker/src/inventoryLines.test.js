import { describe, it, expect } from 'vitest'
import { insertInventoryLines } from './inventoryLines.js'

// ── D1 モック ──────────────────────────────────────────────────────────────────
function createMockD1() {
  const lines = []
  let batchCalls = 0

  function exec(sql, args) {
    const s = sql.replace(/\s+/g, ' ').trim()
    if (s.startsWith('INSERT INTO inventory_lines')) {
      const [session_id, shop_code, taken_at, item_name, category, qty, unit, unit_price, line_value] = args
      lines.push({ session_id, shop_code, taken_at, item_name, category, qty, unit, unit_price, line_value })
      return { success: true }
    }
    if (s.startsWith('SELECT')) {
      const [shop_code, item_name] = args
      return lines.filter(l => l.shop_code === shop_code && l.item_name === item_name)
    }
    throw new Error('Unhandled SQL: ' + s)
  }

  function prepare(sql) {
    let bound = []
    const stmt = {
      bind(...a) { bound = a; return stmt },
      async run()   { return exec(sql, bound) },
      async all()   { return { results: exec(sql, bound) } },
    }
    return stmt
  }

  async function batch(stmts) {
    batchCalls++
    const results = []
    for (const s of stmts) results.push(await s.run())
    return results
  }

  return { prepare, batch, _lines: lines, get _batchCalls() { return batchCalls } }
}

const SESSION_ID = 'sess-001'
const SHOP_CODE  = 'ABCDEF'
const TAKEN_AT   = '2026-06-11'

const INVENTORY = {
  'コーヒー豆': { qty: 5,  unit: 'kg'  },
  '牛乳':       { qty: 12, unit: '本'  },
  '砂糖':       { qty: 2,  unit: 'kg'  },
}
const PRICES = { 'コーヒー豆': 2000, '牛乳': 200 }

describe('insertInventoryLines', () => {
  it('品目数分の行が挿入される', async () => {
    const db = createMockD1()
    await insertInventoryLines(db, { sessionId: SESSION_ID, shopCode: SHOP_CODE, takenAt: TAKEN_AT, inventory: INVENTORY, prices: PRICES })
    expect(db._lines).toHaveLength(3)
  })

  it('品目名・数量・単位が正しく焼き込まれる', async () => {
    const db = createMockD1()
    await insertInventoryLines(db, { sessionId: SESSION_ID, shopCode: SHOP_CODE, takenAt: TAKEN_AT, inventory: INVENTORY, prices: PRICES })
    const coffee = db._lines.find(l => l.item_name === 'コーヒー豆')
    expect(coffee.qty).toBe(5)
    expect(coffee.unit).toBe('kg')
  })

  it('単価あり品目は unit_price と line_value を計算して保存する', async () => {
    const db = createMockD1()
    await insertInventoryLines(db, { sessionId: SESSION_ID, shopCode: SHOP_CODE, takenAt: TAKEN_AT, inventory: INVENTORY, prices: PRICES })
    const coffee = db._lines.find(l => l.item_name === 'コーヒー豆')
    expect(coffee.unit_price).toBe(2000)
    expect(coffee.line_value).toBe(10000)
  })

  it('単価なし品目は unit_price と line_value が null になる', async () => {
    const db = createMockD1()
    await insertInventoryLines(db, { sessionId: SESSION_ID, shopCode: SHOP_CODE, takenAt: TAKEN_AT, inventory: INVENTORY, prices: PRICES })
    const sugar = db._lines.find(l => l.item_name === '砂糖')
    expect(sugar.unit_price).toBeNull()
    expect(sugar.line_value).toBeNull()
  })

  it('空の在庫は何も挿入しない', async () => {
    const db = createMockD1()
    await insertInventoryLines(db, { sessionId: SESSION_ID, shopCode: SHOP_CODE, takenAt: TAKEN_AT, inventory: {}, prices: {} })
    expect(db._lines).toHaveLength(0)
  })

  it('db.batch で一括挿入する（品目ごとの逐次クエリにしない）', async () => {
    const db = createMockD1()
    await insertInventoryLines(db, { sessionId: SESSION_ID, shopCode: SHOP_CODE, takenAt: TAKEN_AT, inventory: INVENTORY, prices: PRICES })
    expect(db._batchCalls).toBe(1)
    expect(db._lines).toHaveLength(3)
  })

  it('session_id と shop_code と taken_at が全行に設定される', async () => {
    const db = createMockD1()
    await insertInventoryLines(db, { sessionId: SESSION_ID, shopCode: SHOP_CODE, takenAt: TAKEN_AT, inventory: INVENTORY, prices: PRICES })
    expect(db._lines.every(l => l.session_id === SESSION_ID)).toBe(true)
    expect(db._lines.every(l => l.shop_code  === SHOP_CODE)).toBe(true)
    expect(db._lines.every(l => l.taken_at   === TAKEN_AT)).toBe(true)
  })
})
