// DATA-001: 複数 D1 書き込みの原子性
//
// 棚卸完了・発注・入出庫は「ヘッダ（または完了状態）」と「明細」の2種類を書く。
// これらが独立した write だと、片方だけ成功した状態が残る。
// 棚卸完了では実際に「セッションは残るが明細が消える」が本番で起きている（R-001）。
//
// ここで固定するのは3つ:
//   1. 1つの batch（=1トランザクション）で書くこと
//   2. 途中で失敗したら何も書かれないこと（部分適用を作らない）
//   3. 同じ要求を再送しても最終状態が同じこと（冪等）

import { describe, it, expect } from 'vitest'
import { handleSessionComplete, handleOrderCreate, handleMovementCreate } from './storeHandler.js'
import { MAX_LINES_PER_REQUEST } from './constants.js'

const CODE  = 'ABCDEF'
const OTHER = 'ZZZZZZ'
const SID   = 'sess-001'

// ── 棚卸完了 ──────────────────────────────────────────────────────────────────

function createSessionDb({ sessions = [{ id: SID, shop_code: CODE, status: 'active' }] } = {}) {
  const lines = []
  const batches = []
  let failAt = null

  function prepare(sql) {
    const s = sql.replace(/\s+/g, ' ').trim()
    let bound = []
    const stmt = {
      get sql() { return s },
      bind(...a) { bound = a; return stmt },
      async run() {
        let changes = 0
        if (s.startsWith('DELETE FROM inventory_lines')) {
          const [sid, shop] = bound
          for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].session_id === sid && lines[i].shop_code === shop) { lines.splice(i, 1); changes++ }
          }
        } else if (s.startsWith('INSERT INTO inventory_lines')) {
          const [session_id, shop_code, taken_at, item_name, , qty, unit, unit_price, line_value] = bound
          const [exId, exShop] = bound.slice(-2)
          if (!s.includes('WHERE EXISTS') || sessions.some(x => x.id === exId && x.shop_code === exShop)) {
            lines.push({ session_id, shop_code, taken_at, item_name, qty, unit, unit_price, line_value })
            changes = 1
          }
        } else if (s.startsWith('UPDATE sessions')) {
          const [, itemCount, totalValue, id, shop] = bound
          const t = sessions.find(x => x.id === id && x.shop_code === shop)
          if (t) { Object.assign(t, { status: 'completed', item_count: itemCount, total_value: totalValue }); changes = 1 }
        }
        return { success: true, meta: { changes } }
      },
      async first() {
        if (s.includes('FROM sessions WHERE id')) {
          const [id, shop] = bound
          return sessions.find(x => x.id === id && x.shop_code === shop) ?? null
        }
        return null
      },
      async all() { return { results: [] } },
    }
    return stmt
  }

  async function batch(stmts) {
    batches.push(stmts.map(s => s.sql))
    const before = { lines: lines.map(l => ({ ...l })), sessions: sessions.map(x => ({ ...x })) }
    const out = []
    for (let i = 0; i < stmts.length; i++) {
      if (failAt === i) {
        failAt = null
        lines.splice(0, lines.length, ...before.lines)
        sessions.splice(0, sessions.length, ...before.sessions)
        throw new Error('D1_ERROR: injected failure')
      }
      out.push(await stmts[i].run())
    }
    return out
  }

  return {
    prepare, batch,
    _lines: lines, _sessions: sessions, _batches: batches,
    _failBatchAt(i) { failAt = i },
  }
}

const INVENTORY = {
  'コーヒー豆': { qty: 5, unit: 'kg' },
  '牛乳':       { qty: 12, unit: '本' },
}
const PRICES = { 'コーヒー豆': 2000, '牛乳': 200 }

describe('棚卸完了 — 明細と完了状態を1つのトランザクションで書く', () => {
  it('write が1回の batch にまとまっている', async () => {
    const db = createSessionDb()
    await handleSessionComplete(db, CODE, SID, { inventory: INVENTORY, prices: PRICES })
    expect(db._batches).toHaveLength(1)
  })

  it('同じ batch に完了状態の UPDATE と明細の INSERT が両方入っている', async () => {
    const db = createSessionDb()
    await handleSessionComplete(db, CODE, SID, { inventory: INVENTORY, prices: PRICES })
    const [sqls] = db._batches
    expect(sqls.some(s => s.startsWith('UPDATE sessions'))).toBe(true)
    expect(sqls.some(s => s.startsWith('INSERT INTO inventory_lines'))).toBe(true)
  })

  it('成功時は明細と完了状態の両方が反映される', async () => {
    const db  = createSessionDb()
    const res = await handleSessionComplete(db, CODE, SID, { inventory: INVENTORY, prices: PRICES })
    expect(res.ok).toBe(true)
    expect(db._lines).toHaveLength(2)
    expect(db._sessions[0].status).toBe('completed')
    expect(db._sessions[0].total_value).toBe(10000 + 2400)
  })
})

describe('棚卸完了 — 部分失敗を作らない', () => {
  it('明細の途中で落ちたら、完了状態も明細も残らない', async () => {
    const db = createSessionDb()
    db._failBatchAt(2)   // UPDATE → DELETE の後、最初の INSERT で落とす
    const res = await handleSessionComplete(db, CODE, SID, { inventory: INVENTORY, prices: PRICES })

    expect(res.ok).toBeUndefined()
    expect(res._status).toBe(503)
    // ここが DATA-001 の本体。「セッションは completed なのに明細が無い」を作らない
    expect(db._sessions[0].status).toBe('active')
    expect(db._lines).toHaveLength(0)
  })

  it('失敗は再試行できる形で返す（完了扱いにしない）', async () => {
    const db = createSessionDb()
    db._failBatchAt(0)
    const res = await handleSessionComplete(db, CODE, SID, { inventory: INVENTORY, prices: PRICES })
    expect(res.retryable).toBe(true)
    expect(res.code).toBe('complete_failed')
  })

  it('失敗後に同じ要求を送り直せば完了する', async () => {
    const db = createSessionDb()
    db._failBatchAt(1)
    await handleSessionComplete(db, CODE, SID, { inventory: INVENTORY, prices: PRICES })
    expect(db._sessions[0].status).toBe('active')

    const retry = await handleSessionComplete(db, CODE, SID, { inventory: INVENTORY, prices: PRICES })
    expect(retry.ok).toBe(true)
    expect(db._sessions[0].status).toBe('completed')
    expect(db._lines).toHaveLength(2)
  })

  it('直前にセッションが消えていれば 404 で、明細だけが残らない', async () => {
    const db = createSessionDb()
    // 事前チェックは通し、batch 実行の直前に消えた状況を作る
    const origBatch = db.batch
    db.batch = async (stmts) => { db._sessions.length = 0; return origBatch(stmts) }

    const res = await handleSessionComplete(db, CODE, SID, { inventory: INVENTORY, prices: PRICES })
    expect(res._status).toBe(404)
    expect(db._lines).toHaveLength(0)
  })
})

describe('棚卸完了 — 冪等', () => {
  it('同じ完了要求を2回送っても明細が重複しない', async () => {
    const db = createSessionDb()
    await handleSessionComplete(db, CODE, SID, { inventory: INVENTORY, prices: PRICES })
    await handleSessionComplete(db, CODE, SID, { inventory: INVENTORY, prices: PRICES })
    expect(db._lines).toHaveLength(2)
  })

  it('品目が減った再送では、前回ぶんが残らない', async () => {
    const db = createSessionDb()
    await handleSessionComplete(db, CODE, SID, { inventory: INVENTORY, prices: PRICES })
    await handleSessionComplete(db, CODE, SID, { inventory: { '牛乳': { qty: 1, unit: '本' } }, prices: {} })

    expect(db._lines.map(l => l.item_name)).toEqual(['牛乳'])
    expect(db._sessions[0].item_count).toBe(1)
  })

  it('他店舗のセッションIDでは 404。明細を書かない', async () => {
    const db  = createSessionDb({ sessions: [{ id: SID, shop_code: OTHER, status: 'active' }] })
    const res = await handleSessionComplete(db, CODE, SID, { inventory: INVENTORY, prices: PRICES })
    expect(res._status).toBe(404)
    expect(db._lines).toHaveLength(0)
    expect(db._batches).toHaveLength(0)
  })
})

describe('棚卸完了 — 入力の上限（server側で強制）', () => {
  it('品目数が上限を超えたら 413 で、書き込みに進まない', async () => {
    const db = createSessionDb()
    const inventory = {}
    for (let i = 0; i <= MAX_LINES_PER_REQUEST; i++) inventory[`品目${i}`] = { qty: 1, unit: '個' }

    const res = await handleSessionComplete(db, CODE, SID, { inventory, prices: {} })
    expect(res._status).toBe(413)
    expect(db._batches).toHaveLength(0)
  })

  it('巨大な payload は 413', async () => {
    const db  = createSessionDb()
    const res = await handleSessionComplete(db, CODE, SID, { inventory: { x: { qty: 1 } }, blob: 'x'.repeat(1_100_000) })
    expect(res._status).toBe(413)
    expect(db._batches).toHaveLength(0)
  })

  it('inventory が配列や null なら 400', async () => {
    const db = createSessionDb()
    expect((await handleSessionComplete(db, CODE, SID, { inventory: [] }))._status).toBe(400)
    expect((await handleSessionComplete(db, CODE, SID, { inventory: null }))._status).toBe(400)
    expect(db._batches).toHaveLength(0)
  })
})

// ── 発注・入出庫 ──────────────────────────────────────────────────────────────

function createHeaderLinesDb(kind) {
  const headerTable = kind === 'order' ? 'orders' : 'movements'
  const lineTable   = kind === 'order' ? 'order_lines' : 'movement_lines'
  const headers = []
  const lines   = []
  const batches = []
  let failAt = null

  function prepare(sql) {
    const s = sql.replace(/\s+/g, ' ').trim()
    let bound = []
    const stmt = {
      get sql() { return s },
      bind(...a) { bound = a; return stmt },
      async run() {
        let changes = 0
        if (s.startsWith(`DELETE FROM ${lineTable}`)) {
          const [id, shop] = bound
          for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].parent === id && lines[i].shop_code === shop) { lines.splice(i, 1); changes++ }
          }
        } else if (s.startsWith(`INSERT INTO ${headerTable}`)) {
          const [id, shop_code] = bound
          const existing = headers.find(h => h.id === id)
          if (existing) {
            if (!s.includes('WHERE') || existing.shop_code === shop_code) changes = 1
          } else {
            headers.push({ id, shop_code })
            changes = 1
          }
        } else if (s.startsWith(`INSERT INTO ${lineTable}`)) {
          const [parent, shop_code, , item] = bound
          const [exId, exShop] = bound.slice(-2)
          if (!s.includes('WHERE EXISTS') || headers.some(h => h.id === exId && h.shop_code === exShop)) {
            lines.push({ parent, shop_code, item })
            changes = 1
          }
        }
        return { success: true, meta: { changes } }
      },
      async first() {
        if (s.startsWith(`SELECT shop_code FROM ${headerTable} WHERE id`)) {
          const h = headers.find(x => x.id === bound[0])
          return h ? { shop_code: h.shop_code } : null
        }
        return null
      },
      async all() { return { results: [] } },
    }
    return stmt
  }

  async function batch(stmts) {
    batches.push(stmts.map(s => s.sql))
    const before = { headers: headers.map(h => ({ ...h })), lines: lines.map(l => ({ ...l })) }
    const out = []
    for (let i = 0; i < stmts.length; i++) {
      if (failAt === i) {
        failAt = null
        headers.splice(0, headers.length, ...before.headers)
        lines.splice(0, lines.length, ...before.lines)
        throw new Error('D1_ERROR: injected failure')
      }
      out.push(await stmts[i].run())
    }
    return out
  }

  return { prepare, batch, _headers: headers, _lines: lines, _batches: batches, _failBatchAt(i) { failAt = i } }
}

const CASES = [
  {
    kind: 'order',
    name: '発注',
    call: (db, body) => handleOrderCreate(db, CODE, body),
    body: { id: 'ord_1', date: '2026-07-07', lines: [{ item: '牛乳', qty: 2 }, { item: '卵', qty: 3 }] },
    smaller: { id: 'ord_1', date: '2026-07-07', lines: [{ item: '牛乳', qty: 2 }] },
    limitError: '発注行が多すぎます',
  },
  {
    kind: 'movement',
    name: '入出庫',
    call: (db, body) => handleMovementCreate(db, CODE, body),
    body: { id: 'mv_1', date: '2026-07-07', type: 'in', lines: [{ item: '牛乳', qty: 2 }, { item: '卵', qty: 3 }] },
    smaller: { id: 'mv_1', date: '2026-07-07', type: 'in', lines: [{ item: '牛乳', qty: 2 }] },
    limitError: '入出庫行が多すぎます',
  },
]

for (const c of CASES) {
  describe(`${c.name} — ヘッダと明細を1つのトランザクションで書く`, () => {
    it('write が1回の batch にまとまっている', async () => {
      const db = createHeaderLinesDb(c.kind)
      await c.call(db, c.body)
      expect(db._batches).toHaveLength(1)
    })

    it('成功時はヘッダと明細の両方が入る', async () => {
      const db  = createHeaderLinesDb(c.kind)
      const res = await c.call(db, c.body)
      expect(res.ok).toBe(true)
      expect(db._headers).toHaveLength(1)
      expect(db._lines).toHaveLength(2)
    })

    it('途中で落ちたらヘッダも明細も残らない', async () => {
      const db = createHeaderLinesDb(c.kind)
      db._failBatchAt(2)
      const res = await c.call(db, c.body)
      expect(res._status).toBe(503)
      expect(res.retryable).toBe(true)
      expect(db._headers).toHaveLength(0)
      expect(db._lines).toHaveLength(0)
    })

    it('既存レコードの更新中に落ちても、明細が消えたままにならない', async () => {
      const db = createHeaderLinesDb(c.kind)
      await c.call(db, c.body)
      expect(db._lines).toHaveLength(2)

      db._failBatchAt(2)   // ヘッダ更新 → 明細削除 の後で落とす
      await c.call(db, c.smaller)
      expect(db._lines).toHaveLength(2)   // 巻き戻って元の明細が残る
    })

    it('同じ要求を2回送っても明細が重複しない', async () => {
      const db = createHeaderLinesDb(c.kind)
      await c.call(db, c.body)
      await c.call(db, c.body)
      expect(db._lines).toHaveLength(2)
    })

    it('行が減った再送では前回ぶんが残らない', async () => {
      const db = createHeaderLinesDb(c.kind)
      await c.call(db, c.body)
      await c.call(db, c.smaller)
      expect(db._lines.map(l => l.item)).toEqual(['牛乳'])
    })

    it('行数が上限を超えたら 413 で書き込みに進まない', async () => {
      const db = createHeaderLinesDb(c.kind)
      const many = Array.from({ length: MAX_LINES_PER_REQUEST + 1 }, (_, i) => ({ item: `品目${i}`, qty: 1 }))
      const res  = await c.call(db, { ...c.body, lines: many })
      expect(res._status).toBe(413)
      expect(res.error).toBe(c.limitError)
      expect(db._batches).toHaveLength(0)
    })

    it('他店舗の既存IDには書き込まない', async () => {
      const db = createHeaderLinesDb(c.kind)
      db._headers.push({ id: c.body.id, shop_code: OTHER })
      const res = await c.call(db, c.body)
      expect(res._status).toBe(409)
      expect(db._lines).toHaveLength(0)
    })
  })
}
