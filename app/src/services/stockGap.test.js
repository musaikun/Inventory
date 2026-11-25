// 棚卸で数えた数と帳簿（前の棚卸＋その時点までの入出庫）の差（PROD-001）
import { describe, it, expect } from 'vitest'
import { stockGap } from './stockGap.js'

const prev = { date: '2026-11-01', savedAt: '2026-11-01T10:00:00.000Z', items: [{ item: 'トマト', qty: 10, unit: '個' }, { item: '塩', qty: 3, unit: '袋' }] }
const now = { date: '2026-11-20', savedAt: '2026-11-20T10:00:00.000Z', items: [
  { item: 'トマト', qty: 8, unit: '個' }, { item: '塩', qty: 3, unit: '袋' }, { item: '新品', qty: 2, unit: '本' },
] }
const mv = (type, date, savedAt, item, qty) => ({ type, date, savedAt, lines: [{ item, qty }] })

describe('stockGap', () => {
  it('帳簿＝前の棚卸＋入庫−出庫。差のある品目だけ、差の大きい順', () => {
    const r = stockGap(now, [prev, now], [
      mv('in', '2026-11-05', '2026-11-05T09:00:00.000Z', 'トマト', 6),
      mv('out', '2026-11-10', '2026-11-10T09:00:00.000Z', 'トマト', 2),
    ])
    expect(r.compared).toBe(2)               // 新品は帳簿が無いので比べない
    expect(r.list).toEqual([{ item: 'トマト', unit: '個', book: 14, counted: 8, gap: -6 }])
  })

  it('数えた後の入出庫は帳簿に入れない', () => {
    const r = stockGap(now, [prev], [mv('in', '2026-11-20', '2026-11-20T11:00:00.000Z', 'トマト', 5)])
    expect(r.list[0]).toMatchObject({ book: 10, gap: -2 })
  })

  it('後の棚卸は前の棚卸の帳簿に使わない', () => {
    const r = stockGap(prev, [prev, now], [])
    expect(r.compared).toBe(0)
  })
})
