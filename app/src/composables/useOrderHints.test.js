// 発注の数量入力に添える参考値（useOrderHints）。App.vue から切り出したときの挙動を固定する。
// 「今日」は 2026-10-12（月）に固定し、同じ曜日の発注だけが参考になることを見る。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useOrders } from './useOrders.js'
import { useDayNotes, resetLocalData as resetDayNotes } from './useDayNotes.js'
import { useOrderHints } from './useOrderHints.js'

const orders = useOrders()
const { setNote } = useDayNotes()
const { orderHintsFor } = useOrderHints()

// stock + qty × lot = 発注後在庫（学習の材料）
const order = (date, qty, stock = null, item = 'トマト') =>
  orders.saveOrder({ date, lines: [{ item, qty, stock, lot: 1 }] })

describe('useOrderHints', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 12, 10, 0, 0))   // 2026-10-12（月）ローカル
    localStorage.clear()
    for (const rec of orders.getOrders()) orders.deleteOrder(rec.id)
    resetDayNotes()
  })
  afterEach(() => { vi.useRealTimers() })

  it('記録が無ければどれも空（null）', () => {
    const h = orderHintsFor('トマト')
    expect(h.parLevel).toBeNull()
    expect(h.lastWeekQty).toBeNull()
    expect(h.weekdayHistory.count).toBe(0)
    expect(h.replenish).toBeNull()
  })

  it('前週同曜の発注数は、同じ曜日のうち最も新しい発注の数', () => {
    order('2026-09-28', 5)   // 月
    order('2026-10-05', 3)   // 月（最も新しい月曜）
    order('2026-10-06', 9)   // 火（曜日違いは見ない）
    expect(orderHintsFor('トマト').lastWeekQty).toBe(3)
    expect(orderHintsFor('レタス').lastWeekQty).toBeNull()
  })

  it('同曜の発注履歴は当日分を含めない', () => {
    order('2026-10-05', 3)
    order('2026-10-12', 7)   // 今日
    const h = orderHintsFor('トマト').weekdayHistory
    expect(h.count).toBe(1)
    expect(h.lastWeek).toEqual({ date: '2026-10-05', qty: 3 })
  })

  it('適正在庫は同曜の発注後在庫の中央値で、日別メモで除外した日は使わない', () => {
    order('2026-09-21', 2, 8)    // 発注後在庫 10
    order('2026-09-28', 2, 10)   // 12
    order('2026-10-05', 2, 30)   // 32（貸切などの異常日）
    expect(orderHintsFor('トマト').parLevel).toBe(12)
    setNote('2026-10-05', { excluded: true })
    expect(orderHintsFor('トマト').parLevel).toBe(11)
  })

  it('補充目標は学習した適正在庫も根拠に使う', () => {
    order('2026-09-28', 2, 10)   // 発注後在庫 12
    const h = orderHintsFor('トマト')
    expect(h.parLevel).toBe(12)
    expect(h.replenish?.value).toBe(12)
  })
})
