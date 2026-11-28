// 古い明細へ品目の ID を埋める（ITEM-001 I-3）— 実SQLite
import { describe, it, expect } from 'vitest'
import { createD1 } from './d1Harness.js'
import { backfillItemIds, backfillStoreItemIds, storesNeedingBackfill } from '../src/itemIdBackfill.js'
import { itemIdFor } from '../src/itemId.js'

const SHOP = 'ABCDEF', OTHER = 'ZZZZZZ', SESS = '11111111-1111-4111-8111-111111111111'
const KEPT = 'it_00000000000000aa', CFG = 'it_00000000000000bb'

function setup() {
  const h = createD1()
  h.seedStore(SHOP, { sessionId: SESS, status: 'completed' })
  h.seedStore(OTHER)
  const q = (sql, ...a) => h.sqlite.prepare(sql).run(...a)
  // 0038 より前の行（item_id なし）と、I-2 以降の行（item_id あり）
  q(`INSERT INTO inventory_lines (session_id, shop_code, taken_at, item_name, qty, unit) VALUES (?, ?, '2026-11-01', 'トマト', 1, '個')`, SESS, SHOP)
  q(`INSERT INTO inventory_lines (session_id, shop_code, taken_at, item_name, qty, unit, item_id) VALUES (?, ?, '2026-11-01', '塩', 1, '袋', ?)`, SESS, SHOP, KEPT)
  q(`INSERT INTO movements (id, shop_code, move_date, type, saved_at) VALUES ('m1', ?, '2026-11-02', 'in', '2026-11-02')`, SHOP)
  q(`INSERT INTO movement_lines (movement_id, shop_code, move_date, item, qty, unit, created_at) VALUES ('m1', ?, '2026-11-02', 'トマト', 3, '個', '2026-11-02')`, SHOP)
  q(`INSERT INTO movement_lines (movement_id, shop_code, move_date, item, qty, unit, created_at) VALUES ('m1', ?, '2026-11-02', '消した品目', 1, '個', '2026-11-02')`, SHOP)
  q(`INSERT INTO store_configs (shop_code, config_json, updated_at) VALUES (?, ?, '2026-11-28')`, SHOP, JSON.stringify({ order: ['トマト', '塩'], itemIds: { トマト: CFG } }))
  return h
}

describe('古い明細の品目の ID を埋める', () => {
  it('NULL の行だけを、設定の表（無ければ計算）で埋める。I-2 以降の行は触らない', async () => {
    const h = setup()
    expect(await storesNeedingBackfill(h.db)).toEqual([SHOP])
    const r = await backfillItemIds(h.db)
    expect(r.updated).toBe(3)
    const inv = Object.fromEntries(h.rows('SELECT item_name, item_id FROM inventory_lines').map(x => [x.item_name, x.item_id]))
    expect(inv).toEqual({ トマト: CFG, 塩: KEPT })
    const mv = Object.fromEntries(h.rows('SELECT item, item_id FROM movement_lines').map(x => [x.item, x.item_id]))
    expect(mv).toEqual({ トマト: CFG, 消した品目: itemIdFor(SHOP, '消した品目') })
    expect(await storesNeedingBackfill(h.db)).toEqual([])
  })

  it('呼び出しの数が尽きたら途中で止め、次の回で続きを埋める', async () => {
    const h = setup()
    const first = await backfillStoreItemIds(h.db, SHOP, { budget: 3 })
    expect(first.done).toBe(false)
    expect(first.queries).toBeLessThanOrEqual(3)
    const rest = await backfillStoreItemIds(h.db, SHOP)
    expect(rest.done).toBe(true)
    expect(h.rows('SELECT COUNT(*) AS n FROM movement_lines WHERE item_id IS NULL')[0].n).toBe(0)
    expect(h.rows('SELECT COUNT(*) AS n FROM inventory_lines WHERE item_id IS NULL')[0].n).toBe(0)
  })

  it('他の店の行には触らない', async () => {
    const h = setup()
    h.sqlite.prepare(`INSERT INTO movements (id, shop_code, move_date, type, saved_at) VALUES ('m9', ?, '2026-11-02', 'in', '2026-11-02')`).run(OTHER)
    h.sqlite.prepare(`INSERT INTO movement_lines (movement_id, shop_code, move_date, item, qty, unit, created_at) VALUES ('m9', ?, '2026-11-02', 'トマト', 1, '個', '2026-11-02')`).run(OTHER)
    await backfillStoreItemIds(h.db, SHOP)
    expect(h.rows(`SELECT item_id FROM movement_lines WHERE shop_code = ?`, OTHER)[0].item_id).toBeNull()
    await backfillStoreItemIds(h.db, OTHER)
    expect(h.rows(`SELECT item_id FROM movement_lines WHERE shop_code = ?`, OTHER)[0].item_id).toBe(itemIdFor(OTHER, 'トマト'))
  })
})
