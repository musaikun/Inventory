import { describe, it, expect, beforeEach } from 'vitest'
import { useMovements, deliveryLinesFromOrder, unreflectedOrders } from './useMovements.js'

const _daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)

const m = useMovements()

describe('useMovements（入出庫データ層）', () => {
  beforeEach(() => {
    localStorage.clear()
    for (const rec of m.getMovements()) m.deleteMovement(rec.id)
  })

  it('qty>0 の行だけ保存される', () => {
    const rec = m.saveMovement({
      type: 'in',
      lines: [
        { item: 'トマト', qty: 3, unit: 'ケース' },
        { item: 'レタス', qty: 0, unit: '玉' },   // 0 は除外
        { item: 'なす',  qty: null },              // 無効は除外
      ],
    })
    expect(rec).not.toBeNull()
    expect(rec.lines).toEqual([{ item: 'トマト', qty: 3, unit: 'ケース' }])
    expect(rec.type).toBe('in')
    expect(rec.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('有効行が無ければ保存しない', () => {
    const rec = m.saveMovement({ type: 'out', lines: [{ item: 'ネギ', qty: 0 }] })
    expect(rec).toBeNull()
    expect(m.getMovements()).toHaveLength(0)
  })

  it('type は in/out に正規化される', () => {
    const rec = m.saveMovement({ type: 'invalid', lines: [{ item: 'A', qty: 1 }] })
    expect(rec.type).toBe('in')
    const out = m.saveMovement({ type: 'out', lines: [{ item: 'B', qty: 1 }] })
    expect(out.type).toBe('out')
  })

  it('getMovements は date 降順で返す', () => {
    m.saveMovement({ type: 'in', date: '2026-07-01', lines: [{ item: 'A', qty: 1 }] })
    m.saveMovement({ type: 'out', date: '2026-07-10', lines: [{ item: 'B', qty: 2 }] })
    const list = m.getMovements()
    expect(list.map(r => r.date)).toEqual(['2026-07-10', '2026-07-01'])
  })

  it('deleteMovement で削除される', () => {
    const rec = m.saveMovement({ type: 'in', lines: [{ item: 'A', qty: 1 }] })
    m.deleteMovement(rec.id)
    expect(m.getMovements()).toHaveLength(0)
  })

  it('入庫は orderId で発注と紐付けられる（出庫では無視）', () => {
    const rec = m.saveMovement({ type: 'in', orderId: 'o_123', lines: [{ item: 'A', qty: 1 }] })
    expect(rec.orderId).toBe('o_123')
    const out = m.saveMovement({ type: 'out', orderId: 'o_123', lines: [{ item: 'A', qty: 1 }] })
    expect(out.orderId).toBeNull()
  })

  it('applyRemoteMovements は id 重複を排除して取り込む（冪等）', () => {
    const local = m.saveMovement({ type: 'in', date: '2026-07-05', lines: [{ item: 'A', qty: 1 }] })
    m.applyRemoteMovements([
      { id: local.id, date: '2026-07-05', type: 'in', lines: [{ item: 'A', qty: 1 }] }, // 既存＝無視
      { id: 'm_remote', date: '2026-07-06', type: 'out', lines: [{ item: 'B', qty: 2 }] },
    ])
    const ids = m.getMovements().map(r => r.id)
    expect(ids).toContain('m_remote')
    expect(ids.filter(id => id === local.id)).toHaveLength(1)  // 二重取り込みしない
    // 二度目の適用でも増えない
    m.applyRemoteMovements([{ id: 'm_remote', date: '2026-07-06', type: 'out', lines: [] }])
    expect(m.getMovements().filter(r => r.id === 'm_remote')).toHaveLength(1)
  })

  it('applyRemoteMovements は配列以外を無視する', () => {
    m.saveMovement({ type: 'in', lines: [{ item: 'A', qty: 1 }] })
    m.applyRemoteMovements(null)
    m.applyRemoteMovements(undefined)
    expect(m.getMovements()).toHaveLength(1)
  })
})

describe('deliveryLinesFromOrder（発注→入庫行の換算）', () => {
  it('納品数量 = 発注数（LOT数）× 入数 に換算する', () => {
    const order = { lines: [
      { item: 'ビール', qty: 2, unit: '本', lot: 24 },   // 2ケース×24本
      { item: 'トマト', qty: 3, unit: '個', lot: 1 },
    ] }
    expect(deliveryLinesFromOrder(order)).toEqual([
      { item: 'ビール', qty: 48, unit: '本' },
      { item: 'トマト', qty: 3, unit: '個' },
    ])
  })

  it('不正な行は除外・空発注は空配列', () => {
    expect(deliveryLinesFromOrder({ lines: [{ item: '', qty: 1 }, { item: 'A', qty: 0 }] })).toEqual([])
    expect(deliveryLinesFromOrder(null)).toEqual([])
  })
})

describe('unreflectedOrders（入庫未反映の発注）', () => {
  it('入庫(orderId)が記録済みの発注は除外し、未記録のものだけ返す', () => {
    const orders = [
      { id: 'o1', date: _daysAgo(1), lines: [{ item: 'A', qty: 1 }] },
      { id: 'o2', date: _daysAgo(2), lines: [{ item: 'B', qty: 1 }] },
    ]
    const movements = [{ id: 'm1', type: 'in', orderId: 'o2', lines: [] }]
    const out = unreflectedOrders(orders, movements, 30)
    expect(out.map(o => o.id)).toEqual(['o1'])   // o2 は反映済みで除外
  })

  it('直近 sinceDays 日より古い発注は除外する', () => {
    const orders = [
      { id: 'recent', date: _daysAgo(5),  lines: [] },
      { id: 'old',    date: _daysAgo(40), lines: [] },
    ]
    expect(unreflectedOrders(orders, [], 30).map(o => o.id)).toEqual(['recent'])
  })

  it('日付の新しい順で返す', () => {
    const orders = [
      { id: 'a', date: _daysAgo(10), lines: [] },
      { id: 'b', date: _daysAgo(2),  lines: [] },
      { id: 'c', date: _daysAgo(6),  lines: [] },
    ]
    expect(unreflectedOrders(orders, [], 30).map(o => o.id)).toEqual(['b', 'c', 'a'])
  })

  it('空・不正入力でも例外なく空配列', () => {
    expect(unreflectedOrders(undefined, undefined, 30)).toEqual([])
    expect(unreflectedOrders([], null, 30)).toEqual([])
  })
})
