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
    expect(rec.lines[0]).toEqual({ item: 'トマト', qty: 3, unit: 'ケース' })
    expect(rec.supplier).toBe('八百屋')
    expect(rec.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
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
