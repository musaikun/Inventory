/**
 * 明細のまとめ書きに `UNION ALL` を使わない（2026-08-28 / 実D1の計測結果）。
 *
 * 実D1は `SELECT ? AS a UNION ALL …` を **19項でも**
 * `too many terms in compound SELECT: SQLITE_ERROR` で落とす。
 * Pro Review 上でテーブルに触らないプローブを流した実測は次のとおり:
 *
 *   s19=NG  b10=NG  v500=ok  v1000=ok
 *
 * つまり compound SELECT の上限は SQLite 既定の 500 ではなく 19 未満まで絞られており、
 * 一方で複数行 VALUES は 1000 行でも通る（SQLite は VALUES を項数制限から外す）。
 * 6品目の棚卸すら完了できなかったのはこれが原因。
 *
 * まとめ行数（constants.js）は **bound parameter 上限 100/query** から決まる値で、
 * compound の項数とは別物。ここで固定するのは「どの経路も UNION ALL を組み立てない」
 * ことだけ。1経路でも取りこぼすと、その機能だけが実D1で落ちる。
 */
import { describe, it, expect } from 'vitest'
import { createD1, makeInventory, makeLines } from './d1Harness.js'
import { handleSessionComplete, handleOrderCreate, handleMovementCreate } from '../src/storeHandler.js'
import { handlePastImportCreate } from '../src/pastImport.js'

const CODE = 'SHOPVA'
const SID  = '33333333-3333-4333-8333-333333333333'

/** 実行された SQL を全部集める（batch の中身も含む） */
function recording() {
  const h = createD1()
  const sqls = []
  const prepare = h.db.prepare
  h.db.prepare = (sql) => { sqls.push(sql); return prepare(sql) }
  return { h, sqls }
}

const N = 60   // 19行/文 → 4文に割れる件数

describe('明細のまとめ書きは VALUES 形式', () => {
  it('棚卸完了', async () => {
    const { h, sqls } = recording()
    h.seedStore(CODE, { sessionId: SID })
    const inv = makeInventory(N)
    const res = await handleSessionComplete(h.db, CODE, SID, {
      inventory: inv,
      takenAt: '2026-08-28',
      snapshot: { sessionId: SID, items: Object.entries(inv).map(([item, v]) => ({ item, qty: v.qty, unit: v.unit })) },
    })

    expect(res.ok).toBe(true)
    expect(h.rows('SELECT COUNT(*) c FROM inventory_lines')[0].c).toBe(N)
    expect(sqls.join('\n')).not.toContain('UNION ALL')
  })

  it('発注', async () => {
    const { h, sqls } = recording()
    h.seedStore(CODE)
    const res = await handleOrderCreate(h.db, CODE, {
      id: '44444444-4444-4444-8444-444444444444',
      date: '2026-08-28', lines: makeLines(N),
    })

    expect(res._status).toBeUndefined()
    expect(h.rows('SELECT COUNT(*) c FROM order_lines')[0].c).toBe(N)
    expect(sqls.join('\n')).not.toContain('UNION ALL')
  })

  it('入出庫', async () => {
    const { h, sqls } = recording()
    h.seedStore(CODE)
    const res = await handleMovementCreate(h.db, CODE, {
      id: '55555555-5555-4555-8555-555555555555',
      date: '2026-08-28', type: 'in', lines: makeLines(N),
    })

    expect(res._status).toBeUndefined()
    expect(h.rows('SELECT COUNT(*) c FROM movement_lines')[0].c).toBe(N)
    expect(sqls.join('\n')).not.toContain('UNION ALL')
  })

  it('過去取込', async () => {
    const { h, sqls } = recording()
    h.seedStore(CODE)
    const res = await handlePastImportCreate(h.db, CODE, '66666666-6666-4666-8666-666666666666', {
      date: '2026-08-20',
      items: makeLines(N).map(l => ({ item: l.item, qty: l.qty, unit: l.unit, unitPrice: 100 })),
    })

    expect(res._status).toBeUndefined()
    expect(h.rows('SELECT COUNT(*) c FROM inventory_lines')[0].c).toBe(N)
    expect(sqls.join('\n')).not.toContain('UNION ALL')
  })
})
