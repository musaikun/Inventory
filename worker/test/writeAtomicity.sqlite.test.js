import { describe, it, expect } from 'vitest'
import { createD1, makeInventory, makeLines } from './d1Harness.js'
import {
  handleSessionComplete, handleOrderCreate, handleOrderDelete,
  handleMovementCreate, handleMovementDelete,
} from '../src/storeHandler.js'
import {
  MAX_LINES_PER_REQUEST, D1_MAX_BOUND_PARAMS,
  INVENTORY_ROWS_PER_STATEMENT, ORDER_ROWS_PER_STATEMENT, MOVEMENT_ROWS_PER_STATEMENT,
} from '../src/constants.js'

// 全migrationを当てた実SQLite上で、書いたSQLがそのまま動くことを確かめる。
// 手製のSQL文字列モックでは、複数行まとめINSERTやJOINによる持ち主確認は検証できない。

const SHOP  = 'ABCDEF'
const OTHER = 'ZZZZZZ'
const SESS  = '11111111-1111-4111-8111-111111111111'

function setup() {
  const h = createD1()
  h.seedStore(SHOP, { sessionId: SESS })
  return h
}

describe('棚卸完了 — 実SQLiteでの原子性と冪等性', () => {
  it('明細と完了状態の両方が反映される', async () => {
    const h = setup()
    const res = await handleSessionComplete(h.db, SHOP, SESS, {
      inventory: { 牛乳: { qty: 3, unit: '本' }, 砂糖: { qty: 2, unit: 'kg' } },
      prices: { 牛乳: 200 },
    })
    expect(res.ok).toBe(true)
    expect(h.rows('SELECT * FROM inventory_lines WHERE session_id = ?', SESS)).toHaveLength(2)
    expect(h.rows('SELECT status, item_count, total_value FROM sessions WHERE id = ?', SESS)[0])
      .toMatchObject({ status: 'completed', item_count: 2, total_value: 600 })
  })

  it('明細INSERTの途中で落ちると、完了状態も明細も残らない', async () => {
    const h = setup()
    h.failBatchAt(2)   // UPDATE sessions → DELETE lines の次
    const res = await handleSessionComplete(h.db, SHOP, SESS, {
      inventory: makeInventory(40), prices: {},
    })
    expect(res._status).toBe(503)
    expect(res.retryable).toBe(true)
    expect(h.rows('SELECT * FROM inventory_lines')).toHaveLength(0)
    expect(h.rows('SELECT status FROM sessions WHERE id = ?', SESS)[0].status).toBe('active')
  })

  it('失敗後に同じ要求を送り直せば完了する（再試行可能）', async () => {
    const h = setup()
    h.failBatchAt(2)
    const body = { inventory: makeInventory(40), prices: {} }
    expect((await handleSessionComplete(h.db, SHOP, SESS, body))._status).toBe(503)
    expect((await handleSessionComplete(h.db, SHOP, SESS, body)).ok).toBe(true)
    expect(h.rows('SELECT * FROM inventory_lines')).toHaveLength(40)
  })

  it('同じ完了要求の再送で明細が重複しない（冪等）', async () => {
    const h = setup()
    const body = { inventory: makeInventory(30), prices: {} }
    await handleSessionComplete(h.db, SHOP, SESS, body)
    await handleSessionComplete(h.db, SHOP, SESS, body)
    expect(h.rows('SELECT * FROM inventory_lines')).toHaveLength(30)
  })

  it('品目が減った再送では前回ぶんが残らない', async () => {
    const h = setup()
    await handleSessionComplete(h.db, SHOP, SESS, { inventory: makeInventory(10), prices: {} })
    await handleSessionComplete(h.db, SHOP, SESS, { inventory: { 牛乳: { qty: 1 } }, prices: {} })
    expect(h.rows('SELECT item_name FROM inventory_lines').map(r => r.item_name)).toEqual(['牛乳'])
  })

  it('他店舗のsessionIdでは存在有無を漏らさず404、明細も作らない', async () => {
    const h = setup()
    h.seedStore(OTHER)
    const res = await handleSessionComplete(h.db, OTHER, SESS, { inventory: { 牛乳: { qty: 1 } }, prices: {} })
    expect(res._status).toBe(404)
    expect(res.error).toBe('セッションが見つかりません')
    expect(h.rows('SELECT * FROM inventory_lines')).toHaveLength(0)
  })

  it('存在しないsessionIdも同じ404（IDの実在を区別させない）', async () => {
    const h = setup()
    const missing = '22222222-2222-4222-8222-222222222222'
    const res = await handleSessionComplete(h.db, SHOP, missing, { inventory: { 牛乳: { qty: 1 } }, prices: {} })
    expect(res._status).toBe(404)
    expect(res.error).toBe('セッションが見つかりません')
  })
})

describe('数量の業務契約（DATA-001）', () => {
  it.each([
    ['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity], ['文字列', 'あ'], ['負数', -1],
  ])('棚卸: %s の数量は400で拒否し、0へ丸めない', async (_label, qty) => {
    const h = setup()
    const res = await handleSessionComplete(h.db, SHOP, SESS, { inventory: { 牛乳: { qty } }, prices: {} })
    expect(res._status).toBe(400)
    expect(res.code).toBe('invalid_qty')
    expect(h.rows('SELECT * FROM inventory_lines')).toHaveLength(0)
    expect(h.rows('SELECT status FROM sessions WHERE id = ?', SESS)[0].status).toBe('active')
  })

  it('棚卸: 在庫0は正当な記録として保存する', async () => {
    const h = setup()
    await handleSessionComplete(h.db, SHOP, SESS, { inventory: { 牛乳: { qty: 0 } }, prices: {} })
    expect(h.rows('SELECT qty FROM inventory_lines')[0].qty).toBe(0)
  })

  it.each([['NaN', NaN], ['Infinity', Infinity], ['負数', -5]])(
    '発注: %s の数量は400で拒否する', async (_label, qty) => {
      const h = setup()
      const res = await handleOrderCreate(h.db, SHOP, { id: 'o1', lines: [{ item: '牛乳', qty }] })
      expect(res._status).toBe(400)
      expect(res.code).toBe('invalid_qty')
      expect(h.rows('SELECT * FROM orders')).toHaveLength(0)
    })

  it('発注: 数量0は「確認したが発注しない」行として受け付ける', async () => {
    const h = setup()
    const res = await handleOrderCreate(h.db, SHOP, { id: 'o1', lines: [{ item: '牛乳', qty: 0, excluded: true }] })
    expect(res.ok).toBe(true)
    expect(h.rows('SELECT qty, excluded FROM order_lines')[0]).toMatchObject({ qty: 0, excluded: 1 })
  })

  it.each([['NaN', NaN], ['Infinity', Infinity], ['0', 0], ['負数', -5]])(
    '入出庫: %s の数量は400で拒否する', async (_label, qty) => {
      const h = setup()
      const res = await handleMovementCreate(h.db, SHOP, { id: 'm1', lines: [{ item: '牛乳', qty }] })
      expect(res._status).toBe(400)
      expect(res.code).toBe('invalid_qty')
      expect(h.rows('SELECT * FROM movements')).toHaveLength(0)
    })

  it('上限を超える数量は拒否する', async () => {
    const h = setup()
    const res = await handleSessionComplete(h.db, SHOP, SESS,
      { inventory: { 牛乳: { qty: 1_000_001 } }, prices: {} })
    expect(res._status).toBe(400)
  })
})

describe('ID・日付・件数の検証', () => {
  it.each(['2026-13-01', '2026-02-30', '20260809', 'yesterday', '2026-8-9'])(
    '不正な日付 %s は400で拒否する', async (date) => {
      const h = setup()
      const res = await handleOrderCreate(h.db, SHOP, { id: 'o1', date, lines: [{ item: '牛乳', qty: 1 }] })
      expect(res._status).toBe(400)
      expect(res.code).toBe('invalid_date')
    })

  it('実在する日付は受け付ける（うるう日）', async () => {
    const h = setup()
    const res = await handleOrderCreate(h.db, SHOP, { id: 'o1', date: '2028-02-29', lines: [{ item: '牛乳', qty: 1 }] })
    expect(res.ok).toBe(true)
  })

  it.each(['../../etc', 'a'.repeat(65), 'id with space', 'id;DROP'])(
    '不正なID %s は400で拒否する', async (id) => {
      const h = setup()
      const res = await handleMovementCreate(h.db, SHOP, { id, lines: [{ item: '牛乳', qty: 1 }] })
      expect(res._status).toBe(400)
      expect(res.code).toBe('invalid_id')
    })

  it('上限ちょうどの明細は通り、上限+1は413で拒否する', async () => {
    const h = setup()
    expect((await handleOrderCreate(h.db, SHOP, { id: 'ok', lines: makeLines(MAX_LINES_PER_REQUEST) })).ok).toBe(true)
    const over = await handleOrderCreate(h.db, SHOP, { id: 'ng', lines: makeLines(MAX_LINES_PER_REQUEST + 1) })
    expect(over._status).toBe(413)
    expect(h.rows('SELECT * FROM orders WHERE id = ?', 'ng')).toHaveLength(0)
  })

  it('棚卸も上限+1品目を413で拒否する', async () => {
    const h = setup()
    const res = await handleSessionComplete(h.db, SHOP, SESS,
      { inventory: makeInventory(MAX_LINES_PER_REQUEST + 1), prices: {} })
    expect(res._status).toBe(413)
  })
})

describe('D1実行上限への適合（公式制限 2026-08-09）', () => {
  // batch 内の statement が invocation あたりの query 数へ1件ずつ数えられる前提（厳しい側）で、
  // Free の 50 を超えないことを固定する。実D1での計測は未実施。
  function countBatchStatements(h) {
    let max = 0
    const orig = h.db.batch
    h.db.batch = async (stmts) => { max = Math.max(max, stmts.length); return orig(stmts) }
    return () => max
  }

  it.each([0, 1, 150, 351, MAX_LINES_PER_REQUEST])('棚卸 %i 品目の batch は41文以内', async (n) => {
    const h = setup()
    const peek = countBatchStatements(h)
    await handleSessionComplete(h.db, SHOP, SESS, { inventory: makeInventory(n), prices: {} })
    expect(peek()).toBeLessThanOrEqual(41)
  })

  it.each([1, 150, 351, MAX_LINES_PER_REQUEST])('発注 %i 行の batch は41文以内', async (n) => {
    const h = setup()
    const peek = countBatchStatements(h)
    await handleOrderCreate(h.db, SHOP, { id: 'o1', lines: makeLines(n) })
    expect(peek()).toBeLessThanOrEqual(41)
  })

  it.each([1, 150, 351, MAX_LINES_PER_REQUEST])('入出庫 %i 行の batch は41文以内', async (n) => {
    const h = setup()
    const peek = countBatchStatements(h)
    await handleMovementCreate(h.db, SHOP, { id: 'm1', lines: makeLines(n) })
    expect(peek()).toBeLessThanOrEqual(41)
  })

  it('まとめ行数は bound parameter 100 を超えない', () => {
    expect(INVENTORY_ROWS_PER_STATEMENT * 5 + 3).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS)
    expect(ORDER_ROWS_PER_STATEMENT     * 7 + 4).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS)
    expect(MOVEMENT_ROWS_PER_STATEMENT  * 3 + 4).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS)
  })

  it('351品目（R-001の実データ規模）が欠けずに保存される', async () => {
    const h = setup()
    const res = await handleSessionComplete(h.db, SHOP, SESS, { inventory: makeInventory(351), prices: {} })
    expect(res.ok).toBe(true)
    expect(h.rows('SELECT * FROM inventory_lines')).toHaveLength(351)
  })
})

describe('order / movement の削除を原子的にする', () => {
  it('発注削除は明細とヘッダを両方消す', async () => {
    const h = setup()
    await handleOrderCreate(h.db, SHOP, { id: 'o1', lines: makeLines(5) })
    expect((await handleOrderDelete(h.db, SHOP, 'o1')).ok).toBe(true)
    expect(h.rows('SELECT * FROM orders')).toHaveLength(0)
    expect(h.rows('SELECT * FROM order_lines')).toHaveLength(0)
  })

  it('発注削除の途中で落ちても、明細だけ消えた状態を残さない', async () => {
    const h = setup()
    await handleOrderCreate(h.db, SHOP, { id: 'o1', lines: makeLines(5) })
    h.failBatchAt(1)   // 明細DELETE の後、ヘッダDELETE の前
    const res = await handleOrderDelete(h.db, SHOP, 'o1')
    expect(res._status).toBe(503)
    expect(h.rows('SELECT * FROM orders')).toHaveLength(1)
    expect(h.rows('SELECT * FROM order_lines')).toHaveLength(5)
  })

  it('入出庫削除も明細とヘッダを1トランザクションで消す', async () => {
    const h = setup()
    await handleMovementCreate(h.db, SHOP, { id: 'm1', lines: makeLines(4) })
    h.failBatchAt(1)
    expect((await handleMovementDelete(h.db, SHOP, 'm1'))._status).toBe(503)
    expect(h.rows('SELECT * FROM movement_lines')).toHaveLength(4)
    expect((await handleMovementDelete(h.db, SHOP, 'm1')).ok).toBe(true)
    expect(h.rows('SELECT * FROM movements')).toHaveLength(0)
    expect(h.rows('SELECT * FROM movement_lines')).toHaveLength(0)
  })

  it('他店舗の入出庫は404で、所有店舗のデータを消さない', async () => {
    const h = setup()
    h.seedStore(OTHER)
    await handleMovementCreate(h.db, SHOP, { id: 'm1', lines: makeLines(2) })
    const res = await handleMovementDelete(h.db, OTHER, 'm1')
    expect(res._status).toBe(404)
    expect(h.rows('SELECT * FROM movements')).toHaveLength(1)
    expect(h.rows('SELECT * FROM movement_lines')).toHaveLength(2)
  })

  it('他店舗IDの作成は409で、所有店舗の明細を書き換えない', async () => {
    const h = setup()
    h.seedStore(OTHER)
    await handleOrderCreate(h.db, SHOP, { id: 'o1', supplier: '八百屋', lines: makeLines(3) })
    const res = await handleOrderCreate(h.db, OTHER, { id: 'o1', supplier: '乗っ取り', lines: makeLines(1) })
    expect(res._status).toBe(409)
    expect(h.rows('SELECT supplier FROM orders WHERE id = ?', 'o1')[0].supplier).toBe('八百屋')
    expect(h.rows('SELECT * FROM order_lines WHERE order_id = ?', 'o1')).toHaveLength(3)
  })
})

describe('snapshot を完了と同じトランザクションで書く（DATA-001 / F-001）', () => {
  const snap = (sessionId, date) => ({ date, sessionId, items: [{ item: '牛乳', qty: 1 }], totalValue: 200 })

  it('完了APIひとつで sessions・inventory_lines・store_history が揃う', async () => {
    const h = setup()
    const res = await handleSessionComplete(h.db, SHOP, SESS, {
      inventory: { 牛乳: { qty: 1 } }, prices: {}, takenAt: '2026-08-09',
      snapshot: snap(SESS, '2026-08-09'),
    })
    expect(res.ok).toBe(true)
    expect(res.snapshotSaved).toBe(true)
    expect(h.rows('SELECT status FROM sessions WHERE id = ?', SESS)[0].status).toBe('completed')
    expect(h.rows('SELECT * FROM inventory_lines')).toHaveLength(1)
    expect(h.rows('SELECT session_id FROM store_history')[0].session_id).toBe(SESS)
  })

  it('途中で落ちたら snapshot も残らない（部分成功を作らない）', async () => {
    const h = setup()
    h.failBatchAt(2)
    const res = await handleSessionComplete(h.db, SHOP, SESS, {
      inventory: makeInventory(30), prices: {}, snapshot: snap(SESS, '2026-08-09'),
    })
    expect(res._status).toBe(503)
    expect(h.rows('SELECT * FROM store_history')).toHaveLength(0)
    expect(h.rows('SELECT * FROM inventory_lines')).toHaveLength(0)
    expect(h.rows('SELECT status FROM sessions WHERE id = ?', SESS)[0].status).toBe('active')
  })

  it('同じ完了要求の再送で snapshot が重複しない', async () => {
    const h = setup()
    const body = { inventory: { 牛乳: { qty: 1 } }, prices: {}, snapshot: snap(SESS, '2026-08-09') }
    await handleSessionComplete(h.db, SHOP, SESS, body)
    await handleSessionComplete(h.db, SHOP, SESS, body)
    expect(h.rows('SELECT * FROM store_history')).toHaveLength(1)
  })

  it('同じ日の2回目の棚卸が1回目のスナップショットを上書きしない（F-001）', async () => {
    const h = setup()
    const SESS2 = '33333333-3333-4333-8333-333333333333'
    h.sqlite.prepare(
      'INSERT INTO sessions (id, shop_code, started_at, status, item_count, type) VALUES (?, ?, ?, ?, 0, ?)'
    ).run(SESS2, SHOP, '2026-08-09T09:00:00.000Z', 'active', 'stock')

    await handleSessionComplete(h.db, SHOP, SESS, {
      inventory: { 牛乳: { qty: 1 } }, prices: {}, snapshot: snap(SESS, '2026-08-09'),
    })
    await handleSessionComplete(h.db, SHOP, SESS2, {
      inventory: { 砂糖: { qty: 5 } }, prices: {}, snapshot: snap(SESS2, '2026-08-09'),
    })

    const rows = h.rows('SELECT session_id, snapshot_date FROM store_history ORDER BY id')
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.session_id)).toEqual([SESS, SESS2])
    expect(rows.every(r => r.snapshot_date === '2026-08-09')).toBe(true)
    // 明細もセッションごとに分かれている
    expect(h.rows('SELECT item_name FROM inventory_lines WHERE session_id = ?', SESS).map(r => r.item_name)).toEqual(['牛乳'])
    expect(h.rows('SELECT item_name FROM inventory_lines WHERE session_id = ?', SESS2).map(r => r.item_name)).toEqual(['砂糖'])
  })

  it('client が別セッションのsessionIdを詐称しても、完了したセッションの行になる', async () => {
    const h = setup()
    await handleSessionComplete(h.db, SHOP, SESS, {
      inventory: { 牛乳: { qty: 1 } }, prices: {},
      snapshot: snap('99999999-9999-4999-8999-999999999999', '2026-08-09'),
    })
    expect(h.rows('SELECT session_id FROM store_history')[0].session_id).toBe(SESS)
  })

  it('snapshot 未指定でも完了は成立する（後方互換）', async () => {
    const h = setup()
    const res = await handleSessionComplete(h.db, SHOP, SESS, { inventory: { 牛乳: { qty: 1 } }, prices: {} })
    expect(res.ok).toBe(true)
    expect(res.snapshotSaved).toBe(false)
    expect(h.rows('SELECT * FROM store_history')).toHaveLength(0)
  })
})

describe('履歴の削除は同日の別セッションを巻き込まない', () => {
  it('sessionId 指定で該当セッションだけ消える', async () => {
    const h = setup()
    const SESS2 = '33333333-3333-4333-8333-333333333333'
    h.sqlite.prepare(
      'INSERT INTO sessions (id, shop_code, started_at, status, item_count, type) VALUES (?, ?, ?, ?, 0, ?)'
    ).run(SESS2, SHOP, '2026-08-09T09:00:00.000Z', 'active', 'stock')
    for (const id of [SESS, SESS2]) {
      await handleSessionComplete(h.db, SHOP, id, {
        inventory: { 牛乳: { qty: 1 } }, prices: {},
        snapshot: { date: '2026-08-09', sessionId: id, items: [] },
      })
    }
    const { handleHistoryDelete } = await import('../src/storeHandler.js')
    expect((await handleHistoryDelete(h.db, SHOP, SESS)).ok).toBe(true)
    expect(h.rows('SELECT session_id FROM store_history').map(r => r.session_id)).toEqual([SESS2])
  })

  it('日付指定の削除は session_id を持つ行を消さない（legacy行だけ）', async () => {
    const h = setup()
    const { handleHistoryPost, handleHistoryDelete } = await import('../src/storeHandler.js')
    await handleHistoryPost(h.db, SHOP, { date: '2026-07-07', items: [] })          // legacy（過去取込）
    await handleSessionComplete(h.db, SHOP, SESS, {
      inventory: { 牛乳: { qty: 1 } }, prices: {},
      snapshot: { date: '2026-07-07', sessionId: SESS, items: [] },
    })
    expect(h.rows('SELECT * FROM store_history')).toHaveLength(2)

    await handleHistoryDelete(h.db, SHOP, '2026-07-07')
    expect(h.rows('SELECT session_id FROM store_history').map(r => r.session_id)).toEqual([SESS])
  })
})
