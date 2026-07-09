import { describe, it, expect, beforeEach } from 'vitest'
import { useOrders } from './useOrders.js'

const o = useOrders()

describe('useOrders（発注データ層）', () => {
  beforeEach(() => {
    localStorage.clear()
    for (const rec of o.getOrders()) o.deleteOrder(rec.id)
  })

  it('qty>0 の行だけ保存される', () => {
    const rec = o.saveOrder({
      supplier: '八百屋', axis: '仕入先',
      lines: [
        { item: 'トマト', qty: 3, unit: 'ケース' },
        { item: 'レタス', qty: 0, unit: '玉' },   // 0 は除外
        { item: 'なす',  qty: null },              // 無効は除外
      ],
    })
    expect(rec).not.toBeNull()
    expect(rec.lines.length).toBe(1)
    expect(rec.lines[0]).toEqual({ item: 'トマト', qty: 3, unit: 'ケース', stock: null, lot: 1, postStock: null, excluded: false })
    expect(rec.supplier).toBe('八百屋')
    expect(rec.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('在庫と入数から発注後在庫を計算して保存する', () => {
    const rec = o.saveOrder({ date: '2026-07-06', lines: [{ item: 'トマト', qty: 1, unit: 'ケース', stock: 8, lot: '12本' }] })
    expect(rec.lines[0].stock).toBe(8)
    expect(rec.lines[0].lot).toBe(12)
    expect(rec.lines[0].postStock).toBe(20)  // 8 + 1×12
  })

  it('在庫未入力なら postStock は null（学習対象外）', () => {
    const rec = o.saveOrder({ date: '2026-07-06', lines: [{ item: 'ネギ', qty: 2 }] })
    expect(rec.lines[0].postStock).toBeNull()
    expect(rec.lines[0].lot).toBe(1)
  })

  it('getLearningEvents は postStock のある行だけ返す', () => {
    o.saveOrder({ date: '2026-07-06', lines: [
      { item: 'トマト', qty: 1, stock: 8, lot: 12 },  // postStock 20
      { item: 'ネギ',   qty: 2 },                      // postStock null → 除外
    ] })
    const ev = o.getLearningEvents()
    expect(ev).toHaveLength(1)
    expect(ev[0]).toEqual({ item: 'トマト', date: '2026-07-06', postStock: 20, excluded: false })
  })

  it('有効行が無ければ null', () => {
    expect(o.saveOrder({ lines: [{ item: 'x', qty: 0 }] })).toBeNull()
  })

  it('新しい順に取得できる', () => {
    o.saveOrder({ supplier: 'A', date: '2026-07-01', lines: [{ item: 'x', qty: 1 }] })
    o.saveOrder({ supplier: 'B', date: '2026-07-05', lines: [{ item: 'y', qty: 1 }] })
    const list = o.getOrders()
    expect(list[0].supplier).toBe('B')
    expect(list[1].supplier).toBe('A')
  })

  it('月で絞り込める', () => {
    o.saveOrder({ date: '2026-06-30', lines: [{ item: 'x', qty: 1 }] })
    o.saveOrder({ date: '2026-07-02', lines: [{ item: 'y', qty: 1 }] })
    expect(o.getOrdersByMonth('2026-07').length).toBe(1)
  })

  it('supplier ごとの直近発注量を返す', () => {
    o.saveOrder({ supplier: '八百屋', date: '2026-07-01', lines: [{ item: 'トマト', qty: 2 }] })
    o.saveOrder({ supplier: '八百屋', date: '2026-07-08', lines: [{ item: 'トマト', qty: 5 }] })
    const m = o.getLastOrderQty('八百屋')
    expect(m['トマト']).toBe(5)  // 直近
  })

  it('削除できる', () => {
    const rec = o.saveOrder({ lines: [{ item: 'x', qty: 1 }] })
    o.deleteOrder(rec.id)
    expect(o.getOrders().length).toBe(0)
  })

  it('localStorage に永続化される', () => {
    o.saveOrder({ supplier: 'A', lines: [{ item: 'x', qty: 1 }] })
    const raw = JSON.parse(localStorage.getItem('inventory_orders_v1'))
    expect(Array.isArray(raw)).toBe(true)
    expect(raw[0].supplier).toBe('A')
  })
})
