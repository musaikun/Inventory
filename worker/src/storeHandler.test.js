import { describe, it, expect } from 'vitest'
import { handleConfigPut, handleInventoryPut, handleHistoryPost, handleSessionComplete, handleRoomResult, handleOrderCreate, handleOrdersGet, handleOrderDelete, handleMovementCreate, handleMovementsGet, handleMovementDelete } from './storeHandler.js'


// 複数行まとめINSERT（`FROM parent p, (SELECT ? AS a ... UNION ALL ...) v WHERE p.id = ? AND p.shop_code = ?`）の
// bind を行単位へ展開する。bind の並びは [SELECTリストの固定値…, 行ごとの値×N, 親id, 親shop]。
function _expandRows(s, bound, fieldNames) {
  // rowSize は最初の SELECT ... AS だけを数える（UNION ALL で繰り返されるため）
  const fromIdx = s.indexOf(' FROM ')
  const rowSize = ((s.slice(fromIdx).split(' UNION ALL ')[0].match(/\? AS /g)) ?? []).length
  const prefix  = ((s.slice(0, fromIdx).match(/\?/g)) ?? []).length
  const ownerId = bound[bound.length - 2]
  const ownerShop = bound[bound.length - 1]
  const fixed   = bound.slice(0, prefix)
  const values  = bound.slice(prefix, bound.length - 2)
  const rows    = []
  for (let i = 0; i < values.length; i += rowSize) {
    const row = {}
    fieldNames.forEach((name, j) => { row[name] = values[i + j] })
    rows.push(row)
  }
  return { rows, fixed, ownerId, ownerShop }
}

// 書き込み系の最小モック（INSERT/UPDATE を success で返すだけ）
function createMockD1() {
  const lines = []
  const history = []
  const sessions = [{ id: 'sess-001', shop_code: 'ABCDEF', status: 'active' }]

  function prepare(sql) {
    const s = sql.replace(/\s+/g, ' ').trim()
    let bound = []
    const stmt = {
      bind(...a) { bound = a; return stmt },
      async run() {
        let changes = 0
        if (s.startsWith('DELETE FROM inventory_lines')) {
          const [sessionId, shop] = bound
          for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].session_id === sessionId && lines[i].shop_code === shop) {
              lines.splice(i, 1)
              changes++
            }
          }
        } else if (s.startsWith('INSERT INTO store_history')) {
          // 存在条件つき INSERT ... SELECT。bind の末尾2つが session_id と shop_code。
          const sid  = bound[bound.length - 2]
          const shop = bound[bound.length - 1]
          if (sessions.some(x => x.id === sid && x.shop_code === shop)) {
            const rev = Math.max(0, ...history.filter(x => x.shop_code === shop).map(x => x.revision)) + 1
            const row = {
              shop_code: shop, session_id: sid, snapshot_date: bound[0], snapshot_json: bound[1],
              created_at: bound[2], updated_at: bound[3], revision: rev,
            }
            const at = history.findIndex(x => x.session_id === sid && x.shop_code === shop)
            if (at >= 0) history[at] = { ...history[at], ...row }
            else history.push(row)
            changes = 1
          }
        } else if (s.startsWith('INSERT INTO inventory_lines')) {
          const { rows, fixed, ownerId, ownerShop } =
            _expandRows(s, bound, ['item_name', 'qty', 'unit', 'unit_price', 'line_value'])
          if (sessions.some(x => x.id === ownerId && x.shop_code === ownerShop)) {
            for (const r of rows) {
              lines.push({ session_id: ownerId, shop_code: ownerShop, taken_at: fixed[0], ...r })
              changes++
            }
          }
        } else if (s.startsWith('UPDATE sessions')) {
          const [, itemCount, totalValue, id, shop] = bound
          const target = sessions.find(x => x.id === id && x.shop_code === shop)
          if (target) {
            Object.assign(target, { status: 'completed', item_count: itemCount, total_value: totalValue })
            changes = 1
          }
        }
        return { success: true, meta: { changes } }
      },
      async first() {
        if (s.includes('FROM sessions WHERE id')) {
          const [id, shop] = bound
          return sessions.find(x =>
            x.id === id && (s.includes('shop_code = ?') ? x.shop_code === shop : true)
          ) ?? null
        }
        if (s.includes('FROM store_history')) {
          const [shop, sid] = bound
          return history.find(x => x.shop_code === shop && x.session_id === sid) ?? null
        }
        return null
      },
      async all() { return { results: [] } },
    }
    return stmt
  }

  // D1 の batch は1トランザクション。failAt で部分失敗を注入し、巻き戻りを再現する。
  let failAt = null
  async function batch(stmts) {
    const before = {
      lines: lines.map(l => ({ ...l })),
      sessions: sessions.map(x => ({ ...x })),
      history: history.map(x => ({ ...x })),
    }
    const results = []
    for (let i = 0; i < stmts.length; i++) {
      if (failAt === i) {
        failAt = null
        lines.splice(0, lines.length, ...before.lines)
        sessions.splice(0, sessions.length, ...before.sessions)
        history.splice(0, history.length, ...before.history)
        throw new Error('D1_ERROR: injected failure')
      }
      results.push(await stmts[i].run())
    }
    return results
  }

  return { prepare, batch, _lines: lines, _sessions: sessions, _history: history, _failBatchAt(i) { failAt = i } }
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
  // 棚卸完了はスナップショット必須（第2セッション §1）
  const SNAP = { date: takenAt, items: [{ item: '牛乳', qty: 12 }] }

  it('品目数分の inventory_lines が挿入される', async () => {
    const db  = createMockD1()
    const res = await handleSessionComplete(db, code, sessId, { inventory, prices, takenAt, snapshot: SNAP })
    expect(res.ok).toBe(true)
    expect(db._lines).toHaveLength(2)
  })

  it('単価あり品目の line_value が正しく計算される', async () => {
    const db  = createMockD1()
    await handleSessionComplete(db, code, sessId, { inventory, prices, takenAt, snapshot: SNAP })
    const coffee = db._lines.find(l => l.item_name === 'コーヒー豆')
    expect(coffee.unit_price).toBe(2000)
    expect(coffee.line_value).toBe(10000)
  })

  it('単価なし品目の unit_price・line_value が null になる', async () => {
    const db  = createMockD1()
    await handleSessionComplete(db, code, sessId, { inventory, prices, takenAt, snapshot: SNAP })
    const milk = db._lines.find(l => l.item_name === '牛乳')
    expect(milk.unit_price).toBeNull()
    expect(milk.line_value).toBeNull()
  })

  it('存在しないセッションIDは 404 を返す', async () => {
    const db  = createMockD1()
    const res = await handleSessionComplete(db, code, 'no-such-id', { inventory, prices, takenAt, snapshot: SNAP })
    expect(res._status).toBe(404)
  })
})

// ── 完了後ゲスト閲覧（handleRoomResult）────────────────────────────────────────
// データ源は store_history スナップショットのみ（sessions テーブルには依存しない）
function createResultMockD1(snapshots = []) {
  function prepare(sql) {
    const s = sql.replace(/\s+/g, ' ').trim()
    const stmt = {
      bind() { return stmt },
      async first() { return null },
      async all() {
        if (s.includes('FROM store_history')) {
          return { results: snapshots.map(snap => ({ snapshot_json: JSON.stringify(snap) })) }
        }
        return { results: [] }
      },
    }
    return stmt
  }
  return { prepare }
}

describe('handleRoomResult — 完了後ゲスト閲覧', () => {
  const code   = 'ABCDEF'
  const sid    = 'sess-xyz'
  const recent = new Date(Date.now() - 60_000).toISOString()        // 1分前完了
  const old    = new Date(Date.now() - 5 * 86400_000).toISOString() // 5日前完了
  const newer  = new Date(Date.now() - 30_000).toISOString()        // 30秒前完了（より新しい）

  const fullSnapshot = (savedAt) => ({
    sessionId: sid,
    date: '2026-06-30',
    savedAt,
    items: [
      { item: '鶏もも', qty: 5, unit: 'kg', unitPrice: 500, subtotal: 2500, code: 'A01', flagged: false, category: '肉' },
    ],
    totalValue: 2500,
    participants: [{ name: '田中', items: [{ item: '鶏もも', qty: 5, unit: 'kg', subtotal: 2500 }], totalValue: 2500 }],
    auditLog: [{ id: 'e1', ingredient: '鶏もも', action: 'new', delta: 5, totalQty: 5, unit: 'kg', enteredBy: '田中', enteredById: 'd1', timestamp: Date.now() }],
  })

  it('セッションIDが無ければ 400', async () => {
    const res = await handleRoomResult(createResultMockD1(), code, '')
    expect(res._status).toBe(400)
  })

  it('該当スナップショットが無ければ 404', async () => {
    const db  = createResultMockD1([{ sessionId: 'other', savedAt: recent, date: '2026-06-30' }])
    const res = await handleRoomResult(db, code, sid)
    expect(res._status).toBe(404)
  })

  it('完了から3日を超えると 410', async () => {
    const db  = createResultMockD1([{ sessionId: sid, savedAt: old, date: '2026-06-25' }])
    const res = await handleRoomResult(db, code, sid)
    expect(res._status).toBe(410)
  })

  it('より新しい完了スナップショットがあれば 410', async () => {
    const db  = createResultMockD1([
      { sessionId: sid,       savedAt: recent, date: '2026-06-29' },
      { sessionId: 'sess-new', savedAt: newer,  date: '2026-06-30' },
    ])
    const res = await handleRoomResult(db, code, sid)
    expect(res._status).toBe(410)
  })

  it('閲覧可能なら金額を除去した結果を返す', async () => {
    const db  = createResultMockD1([fullSnapshot(recent)])
    const res = await handleRoomResult(db, code, sid)
    expect(res._status).toBeUndefined()
    expect(res.result.sessionId).toBe(sid)
    // 品目: 数量・単位は残り、金額は消える
    const item = res.result.items[0]
    expect(item.qty).toBe(5)
    expect(item.unit).toBe('kg')
    expect(item.unitPrice).toBeUndefined()
    expect(item.subtotal).toBeUndefined()
    expect(res.result.totalValue).toBeUndefined()
    // 参加者: 金額は消える
    expect(res.result.participants[0].totalValue).toBeUndefined()
    expect(res.result.participants[0].items[0].subtotal).toBeUndefined()
    expect(res.result.participants[0].items[0].qty).toBe(5)
    // 変更履歴: 誰が・何を・いつ は残る
    expect(res.result.auditLog[0].enteredBy).toBe('田中')
    expect(res.result.auditLog[0].action).toBe('new')
  })
})

// ── 発注（handleOrderCreate / handleOrdersGet / handleOrderDelete）─────────────
function createOrdersMockD1() {
  const orders = []
  const orderLines = []
  let hideOwnerOnce = false

  function prepare(sql) {
    const s = sql.replace(/\s+/g, ' ').trim()
    let bound = []
    const stmt = {
      bind(...a) { bound = a; return stmt },
      async run() {
        let changes = 0
        if (s.startsWith('DELETE FROM order_lines WHERE order_id')) {
          const [orderId, shop] = bound
          for (let i = orderLines.length - 1; i >= 0; i--) {
            if (orderLines[i].order_id === orderId && orderLines[i].shop_code === shop) {
              orderLines.splice(i, 1)
              changes++
            }
          }
        } else if (s.startsWith('DELETE FROM orders WHERE id')) {
          const [id, shop] = bound
          const i = orders.findIndex(o => o.id === id && o.shop_code === shop)
          if (i >= 0) { orders.splice(i, 1); changes = 1 }
        } else if (s.startsWith('INSERT INTO orders')) {
          const [id, shop_code, order_date, supplier, axis, session_id, saved_at] = bound
          const existing = orders.find(o => o.id === id)
          if (existing) {
            const ownerCondition = s.includes('WHERE orders.shop_code = excluded.shop_code')
            if (!ownerCondition || existing.shop_code === shop_code) {
              Object.assign(existing, { order_date, supplier, axis })
              changes = 1
            }
          } else {
            orders.push({ id, shop_code, order_date, supplier, axis, session_id, saved_at })
            changes = 1
          }
        } else if (s.startsWith('INSERT INTO order_lines')) {
          const { rows, fixed, ownerId, ownerShop } =
            _expandRows(s, bound, ['item', 'qty', 'unit', 'stock', 'lot', 'post_stock', 'excluded'])
          if (orders.some(o => o.id === ownerId && o.shop_code === ownerShop)) {
            for (const r of rows) {
              orderLines.push({ order_id: ownerId, shop_code: ownerShop, order_date: fixed[0], ...r })
              changes++
            }
          }
        }
        return { success: true, meta: { changes } }
      },
      async first() {
        if (s.startsWith('SELECT shop_code FROM orders WHERE id')) {
          if (hideOwnerOnce) { hideOwnerOnce = false; return null }
          const order = orders.find(o => o.id === bound[0])
          return order ? { shop_code: order.shop_code } : null
        }
        return null
      },
      async all() {
        if (s.startsWith('SELECT id, order_date, supplier, axis, session_id, saved_at FROM orders')) {
          const [shop, since] = bound
          const rows = orders
            .filter(o => o.shop_code === shop && o.order_date >= since)
            .sort((a, b) => b.order_date.localeCompare(a.order_date))
            .map(o => ({ id: o.id, order_date: o.order_date, supplier: o.supplier, axis: o.axis, session_id: o.session_id, saved_at: o.saved_at }))
          return { results: rows }
        }
        if (s.startsWith('SELECT order_id, item, qty, unit, stock, lot, post_stock, excluded FROM order_lines')) {
          const [shop, since] = bound
          const rows = orderLines
            .filter(l => l.shop_code === shop && l.order_date >= since)
            .map(l => ({ order_id: l.order_id, item: l.item, qty: l.qty, unit: l.unit, stock: l.stock, lot: l.lot, post_stock: l.post_stock, excluded: l.excluded }))
          return { results: rows }
        }
        return { results: [] }
      },
    }
    return stmt
  }
  // D1 の batch は1トランザクション。failAt を指定すると、そのindexで例外を投げ、
  // それまでに適用した変更を巻き戻す（部分失敗の注入用）。
  let failAt = null
  async function batch(stmts) {
    const before = { orders: orders.map(o => ({ ...o })), lines: orderLines.map(l => ({ ...l })) }
    const results = []
    for (let i = 0; i < stmts.length; i++) {
      if (failAt === i) {
        failAt = null
        orders.splice(0, orders.length, ...before.orders)
        orderLines.splice(0, orderLines.length, ...before.lines)
        throw new Error('D1_ERROR: injected failure')
      }
      results.push(await stmts[i].run())
    }
    return results
  }

  return {
    prepare,
    batch,
    _orders: orders,
    _lines: orderLines,
    _hideOwnerOnce() { hideOwnerOnce = true },
    _failBatchAt(i) { failAt = i },
  }
}

describe('発注 API（orders）', () => {
  const code = 'ABCDEF'
  const rec = {
    id: 'o_1', date: '2026-07-06', supplier: '八百屋', axis: '仕入先', sessionId: 's1', savedAt: '2026-07-06T10:00:00Z',
    lines: [
      { item: 'トマト', qty: 1, unit: 'ケース', stock: 8, lot: 12, postStock: 20 },
      { item: 'レタス', qty: 0, unit: '玉', stock: 5, lot: 1, postStock: 5 },
    ],
  }

  it('発注を保存し、GET で往復できる', async () => {
    const db = createOrdersMockD1()
    const res = await handleOrderCreate(db, code, rec)
    expect(res.ok).toBe(true)
    expect(res.id).toBe('o_1')

    const got = await handleOrdersGet(db, code, 400)
    expect(got).toHaveLength(1)
    expect(got[0].id).toBe('o_1')
    expect(got[0].lines).toHaveLength(2)
    const tomato = got[0].lines.find(l => l.item === 'トマト')
    expect(tomato.postStock).toBe(20)
    expect(tomato.lot).toBe(12)
    expect(tomato.excluded).toBe(false)
  })

  it('有効な発注行が無ければ 400', async () => {
    const db = createOrdersMockD1()
    const res = await handleOrderCreate(db, code, { id: 'o_x', lines: [{ item: '', qty: 1 }] })
    expect(res._status).toBe(400)
  })

  it('同一 id の再送は冪等（行が二重にならない）', async () => {
    const db = createOrdersMockD1()
    await handleOrderCreate(db, code, rec)
    await handleOrderCreate(db, code, rec)
    const got = await handleOrdersGet(db, code, 400)
    expect(got).toHaveLength(1)
    expect(got[0].lines).toHaveLength(2)
  })

  it('LOT 未指定は 1 に正規化される', async () => {
    const db = createOrdersMockD1()
    await handleOrderCreate(db, code, { id: 'o_2', date: '2026-07-06', lines: [{ item: 'ネギ', qty: 3 }] })
    const got = await handleOrdersGet(db, code, 400)
    expect(got[0].lines[0].lot).toBe(1)
  })

  it('巨大な発注は 413', async () => {
    const db = createOrdersMockD1()
    const res = await handleOrderCreate(db, code, { id: 'o_big', lines: [{ item: 'x', qty: 1, unit: 'y'.repeat(1_100_000) }] })
    expect(res._status).toBe(413)
  })

  it('削除でヘッダと明細が消える', async () => {
    const db = createOrdersMockD1()
    await handleOrderCreate(db, code, rec)
    await handleOrderDelete(db, code, 'o_1')
    const got = await handleOrdersGet(db, code, 400)
    expect(got).toHaveLength(0)
    expect(db._lines).toHaveLength(0)
  })

  it('SEC-002: 他店の order id へのPOSTは409で拒否し、ヘッダと明細を変更しない', async () => {
    const db = createOrdersMockD1()
    await handleOrderCreate(db, code, rec)

    const res = await handleOrderCreate(db, 'ZZZZZZ', {
      id: 'o_1',
      date: '2099-01-01',
      supplier: '改竄先',
      axis: '不正',
      lines: [{ item: '不正品', qty: 99 }],
    })

    expect(res._status).toBe(409)
    const original = await handleOrdersGet(db, code, 400)
    expect(original).toHaveLength(1)
    expect(original[0].supplier).toBe('八百屋')
    expect(original[0].lines).toHaveLength(2)
    expect(await handleOrdersGet(db, 'ZZZZZZ', 400)).toHaveLength(0)
  })

  it('SEC-002: owner事前確認後の競合でも条件付きupsertが越境更新を拒否する', async () => {
    const db = createOrdersMockD1()
    await handleOrderCreate(db, code, rec)
    db._hideOwnerOnce() // owner SELECT直後に他店行が現れた競合を模擬

    const res = await handleOrderCreate(db, 'ZZZZZZ', {
      id: 'o_1', date: '2099-01-01', supplier: '競合改竄', lines: [{ item: '不正品', qty: 1 }],
    })

    expect(res._status).toBe(409)
    expect(db._orders[0].shop_code).toBe(code)
    expect(db._orders[0].supplier).toBe('八百屋')
    expect(db._lines).toHaveLength(2)
  })

  it('SEC-002: 同じ店舗の既存id再送は更新できる', async () => {
    const db = createOrdersMockD1()
    await handleOrderCreate(db, code, rec)

    const res = await handleOrderCreate(db, code, {
      ...rec,
      supplier: '青果市場',
      lines: [{ item: 'トマト', qty: 3, unit: '箱' }],
    })

    expect(res.ok).toBe(true)
    const got = await handleOrdersGet(db, code, 400)
    expect(got[0].supplier).toBe('青果市場')
    expect(got[0].lines).toHaveLength(1)
  })

  it('SEC-002: 他店からのDELETEは404で拒否し、所有店舗のデータを残す', async () => {
    const db = createOrdersMockD1()
    await handleOrderCreate(db, code, rec)

    const res = await handleOrderDelete(db, 'ZZZZZZ', 'o_1')

    expect(res._status).toBe(404)
    expect(await handleOrdersGet(db, code, 400)).toHaveLength(1)
    expect(db._lines).toHaveLength(2)
  })
})

// ── 入出庫（handleMovementCreate / handleMovementsGet / handleMovementDelete）───
function createMovementsMockD1() {
  const movements = []
  const moveLines = []

  function prepare(sql) {
    const s = sql.replace(/\s+/g, ' ').trim()
    let bound = []
    const stmt = {
      bind(...a) { bound = a; return stmt },
      async run() {
        let changes = 0
        if (s.startsWith('DELETE FROM movement_lines WHERE movement_id')) {
          const [moveId, shop] = bound
          for (let i = moveLines.length - 1; i >= 0; i--) {
            if (moveLines[i].movement_id === moveId && moveLines[i].shop_code === shop) {
              moveLines.splice(i, 1)
              changes++
            }
          }
        } else if (s.startsWith('DELETE FROM movements WHERE id')) {
          const [id, shop] = bound
          const i = movements.findIndex(m => m.id === id && m.shop_code === shop)
          if (i >= 0) { movements.splice(i, 1); changes = 1 }
        } else if (s.startsWith('INSERT INTO movements')) {
          const [id, shop_code, move_date, type, note, order_id, saved_at] = bound
          const existing = movements.find(m => m.id === id)
          if (existing) {
            const ownerCondition = s.includes('WHERE movements.shop_code = excluded.shop_code')
            if (!ownerCondition || existing.shop_code === shop_code) {
              Object.assign(existing, { move_date, type, note, order_id })
              changes = 1
            }
          } else {
            movements.push({ id, shop_code, move_date, type, note, order_id, saved_at })
            changes = 1
          }
        } else if (s.startsWith('INSERT INTO movement_lines')) {
          const { rows, fixed, ownerId, ownerShop } =
            _expandRows(s, bound, ['item', 'qty', 'unit'])
          if (movements.some(m => m.id === ownerId && m.shop_code === ownerShop)) {
            for (const r of rows) {
              moveLines.push({ movement_id: ownerId, shop_code: ownerShop, move_date: fixed[0], ...r })
              changes++
            }
          }
        }
        return { success: true, meta: { changes } }
      },
      async first() {
        if (s.startsWith('SELECT shop_code FROM movements WHERE id')) {
          const [id] = bound
          const m = movements.find(mv => mv.id === id)
          return m ? { shop_code: m.shop_code } : null
        }
        return null
      },
      async all() {
        if (s.startsWith('SELECT id, move_date, type, note, order_id, saved_at FROM movements')) {
          const [shop, since] = bound
          const rows = movements
            .filter(m => m.shop_code === shop && m.move_date >= since)
            .sort((a, b) => b.move_date.localeCompare(a.move_date))
            .map(m => ({ id: m.id, move_date: m.move_date, type: m.type, note: m.note, order_id: m.order_id, saved_at: m.saved_at }))
          return { results: rows }
        }
        if (s.startsWith('SELECT movement_id, item, qty, unit FROM movement_lines')) {
          const [shop, since] = bound
          const rows = moveLines
            .filter(l => l.shop_code === shop && l.move_date >= since)
            .map(l => ({ movement_id: l.movement_id, item: l.item, qty: l.qty, unit: l.unit }))
          return { results: rows }
        }
        return { results: [] }
      },
    }
    return stmt
  }
  // D1 の batch は1トランザクション。failAt で部分失敗を注入し、巻き戻りを再現する。
  let failAt = null
  async function batch(stmts) {
    const before = { moves: movements.map(m => ({ ...m })), lines: moveLines.map(l => ({ ...l })) }
    const out = []
    for (let i = 0; i < stmts.length; i++) {
      if (failAt === i) {
        failAt = null
        movements.splice(0, movements.length, ...before.moves)
        moveLines.splice(0, moveLines.length, ...before.lines)
        throw new Error('D1_ERROR: injected failure')
      }
      out.push(await stmts[i].run())
    }
    return out
  }
  return { prepare, batch, _movements: movements, _lines: moveLines, _failBatchAt(i) { failAt = i } }
}

describe('入出庫 API（movements）', () => {
  const code = 'ABCDEF'
  const rec = {
    id: 'm_1', date: '2026-07-06', type: 'in', note: '火曜納品分', orderId: 'o_1', savedAt: '2026-07-06T10:00:00Z',
    lines: [
      { item: 'トマト', qty: 12, unit: '個' },
      { item: 'レタス', qty: 3, unit: '玉' },
    ],
  }

  it('入庫を保存し、GET で往復できる（発注紐付けを保持）', async () => {
    const db = createMovementsMockD1()
    const res = await handleMovementCreate(db, code, rec)
    expect(res.ok).toBe(true)
    expect(res.id).toBe('m_1')

    const got = await handleMovementsGet(db, code, 400)
    expect(got).toHaveLength(1)
    expect(got[0].id).toBe('m_1')
    expect(got[0].type).toBe('in')
    expect(got[0].orderId).toBe('o_1')
    expect(got[0].lines).toHaveLength(2)
    expect(got[0].lines.find(l => l.item === 'トマト').qty).toBe(12)
  })

  it('出庫は発注紐付け（orderId）を持たない', async () => {
    const db = createMovementsMockD1()
    await handleMovementCreate(db, code, { id: 'm_out', date: '2026-07-06', type: 'out', orderId: 'o_9', lines: [{ item: '廃棄', qty: 2, unit: '個' }] })
    const got = await handleMovementsGet(db, code, 400)
    expect(got[0].type).toBe('out')
    expect(got[0].orderId).toBe(null)
  })

  it('有効な入出庫行が無ければ 400（qty<=0 は除外）', async () => {
    const db = createMovementsMockD1()
    const res = await handleMovementCreate(db, code, { id: 'm_x', lines: [{ item: 'トマト', qty: 0 }] })
    expect(res._status).toBe(400)
  })

  it('同一 id の再送は冪等（行が二重にならない）', async () => {
    const db = createMovementsMockD1()
    await handleMovementCreate(db, code, rec)
    await handleMovementCreate(db, code, rec)
    const got = await handleMovementsGet(db, code, 400)
    expect(got).toHaveLength(1)
    expect(got[0].lines).toHaveLength(2)
  })

  it('削除でヘッダと明細が消える', async () => {
    const db = createMovementsMockD1()
    await handleMovementCreate(db, code, rec)
    await handleMovementDelete(db, code, 'm_1')
    const got = await handleMovementsGet(db, code, 400)
    expect(got).toHaveLength(0)
    expect(db._lines).toHaveLength(0)
  })

  it('R5-01: 他店の movement id への POST は 409 で拒否し、他店データを書き換えない', async () => {
    const db = createMovementsMockD1()
    // A店が m_1 を保存
    await handleMovementCreate(db, code, rec)
    // B店が同じ id で上書きを試みる
    const res = await handleMovementCreate(db, 'ZZZZZZ', {
      id: 'm_1', date: '2099-01-01', type: 'out', note: '改竄', lines: [{ item: '不正', qty: 1 }],
    })
    expect(res._status).toBe(409)
    // A店のヘッダ・明細は無傷
    const got = await handleMovementsGet(db, code, 400)
    expect(got).toHaveLength(1)
    expect(got[0].type).toBe('in')
    expect(got[0].note).toBe('火曜納品分')
    expect(got[0].lines).toHaveLength(2)
    // B店から見ると存在しない（他店の明細も混入しない）
    expect(await handleMovementsGet(db, 'ZZZZZZ', 400)).toHaveLength(0)
  })
})
