// D1 から読んだ発注の取り込み。発注は1セッション=1レコードを入力のたびに書き直すので、
// 途中の版を先に持っている端末でも、新しい版で差し替わること（履歴カレンダーの★の元）。
import { describe, it, expect, beforeEach, vi } from 'vitest'

let useOrders
beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  ;({ useOrders } = await import('./useOrders.js'))
})

const rec = (savedAt, qty) => ({
  id: 'ord_s1', date: '2026-09-27', supplier: '', axis: '', sessionId: 's1', savedAt,
  lines: [{ item: '豚バラ', qty, unit: 'kg', stock: 2, lot: 1, postStock: 2 + qty, excluded: false }],
})

describe('applyRemoteOrders', () => {
  it('持っていない発注は足す', () => {
    const o = useOrders()
    o.applyRemoteOrders([rec('2026-09-27T01:00:00.000Z', 3)])
    expect(o.getOrders()).toHaveLength(1)
  })
  it('同じ id で向こうが新しければ差し替える', () => {
    const o = useOrders()
    o.applyRemoteOrders([rec('2026-09-27T01:00:00.000Z', 3)])
    o.applyRemoteOrders([rec('2026-09-27T02:00:00.000Z', 5)])
    expect(o.getOrders()).toHaveLength(1)
    expect(o.getOrders()[0].lines[0].qty).toBe(5)
  })
  it('同じ id で向こうが古ければ手元を残す', () => {
    const o = useOrders()
    o.upsertOrder({ id: 'ord_s1', date: '2026-09-27', sessionId: 's1', lines: [{ item: '豚バラ', qty: 7, unit: 'kg' }] })
    o.applyRemoteOrders([rec('2000-01-01T00:00:00.000Z', 3)])
    expect(o.getOrders()[0].lines[0].qty).toBe(7)
  })
})
