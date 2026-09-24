// 仮の発注基準（フェルミ推定）。推定の中身は仮定なので、出す条件と式を固定する。
import { describe, it, expect } from 'vitest'
import { assumedBase, defaultStockDays, normalizeAssumptions, stockDaysFor } from './assumedOrderBase.js'
import { suggestReorderPoint } from './reorderSuggestion.js'
import { orderBaseFor } from './orderBase.js'

const snap = (date, qty, item = 'A') => ({ date, items: [{ item, qty }] })
const A = normalizeAssumptions({ leadDays: 1, safetyDays: 1, stockDays: 4 })

describe('defaultStockDays', () => {
  it('発注間隔の半分＋余裕（週1・余裕1 → 5日）', () => {
    expect(defaultStockDays(7, 1)).toBe(5)
    expect(defaultStockDays(2, 0)).toBe(1)
    expect(defaultStockDays(null, 1)).toBe(5)   // 間隔不明は週1扱い
  })
})

describe('normalizeAssumptions', () => {
  it('未設定は null（仮の基準を使わない）', () => {
    expect(normalizeAssumptions(null)).toBeNull()
    expect(normalizeAssumptions(undefined)).toBeNull()
  })
  it('不正値は既定に、ジャンル別は1日以上だけ残す', () => {
    const a = normalizeAssumptions({ leadDays: -1, safetyDays: 'x', stockDays: 0, stockDaysByCategory: { 野菜: 3, 肉: 0, '': 5 } })
    expect(a).toEqual({ leadDays: 1, safetyDays: 1, stockDays: null, stockDaysByCategory: { 野菜: 3 } })
  })
  it('当日納品（届くまで0日）を許す', () => {
    expect(normalizeAssumptions({ leadDays: 0 }).leadDays).toBe(0)
  })
})

describe('stockDaysFor', () => {
  it('ジャンル別 → 店舗の値 → 既定の順', () => {
    const a = normalizeAssumptions({ stockDays: 4, stockDaysByCategory: { 野菜: 2 } })
    expect(stockDaysFor(a, '野菜', 7)).toBe(2)
    expect(stockDaysFor(a, '肉', 7)).toBe(4)
    expect(stockDaysFor(normalizeAssumptions({}), '肉', 7)).toBe(5)
  })
})

describe('assumedBase', () => {
  it('在庫40・4日分・届くまで1＋余裕1・週1 → 日10 / 発注点20 / 目標90', () => {
    const r = assumedBase('A', { snapshots: [snap('2026-09-01', 40)], assumptions: A, intervalDays: 7 })
    expect(r).toMatchObject({ daily: 10, qty: 40, stockDays: 4, reorderPoint: 20, target: 90 })
    expect(r.basis).toContain('仮')
  })
  it('直近の観測（発注時の在庫を含む）を使う', () => {
    const r = assumedBase('A', {
      snapshots: [snap('2026-09-01', 40)],
      orders: [{ date: '2026-09-05', lines: [{ item: 'A', stock: 8 }] }],
      assumptions: A, intervalDays: 7,
    })
    expect(r.qty).toBe(8)
  })
  it('小さい値も最低1へ切り上げ', () => {
    const r = assumedBase('A', { snapshots: [snap('2026-09-01', 1)], assumptions: A, intervalDays: 7 })
    expect(r.reorderPoint).toBe(1)
    expect(r.target).toBe(3)   // 0.25 × 9 = 2.25 → 3
  })
  it('仮定が未設定・在庫が無い/0 なら推定しない', () => {
    expect(assumedBase('A', { snapshots: [snap('2026-09-01', 40)], assumptions: null })).toBeNull()
    expect(assumedBase('A', { snapshots: [], assumptions: A })).toBeNull()
    expect(assumedBase('A', { snapshots: [snap('2026-09-01', 0)], assumptions: A })).toBeNull()
  })
})

describe('suggestReorderPoint の仮（3段目）', () => {
  it('観測1つでも、仮定があれば仮を出す', () => {
    const r = suggestReorderPoint('A', { snapshots: [snap('2026-09-01', 40)], assumptions: A })
    expect(r).toMatchObject({ value: 20, source: 'assumed' })
  })
  it('実績（在庫の最小値）が出せればそちらが先', () => {
    const snapshots = [snap('2026-08-01', 4), snap('2026-08-08', 9)]
    expect(suggestReorderPoint('A', { snapshots, assumptions: A })).toMatchObject({ source: 'stocktakeMin' })
  })
  it('仮定が無ければ従来どおり null', () => {
    expect(suggestReorderPoint('A', { snapshots: [snap('2026-09-01', 40)] })).toBeNull()
  })
})

describe('orderBaseFor', () => {
  const ctx = { snapshots: [snap('2026-09-01', 40)], horizonDays: 7 }

  it('仮定が無い店は従来どおり（手動が無ければ何も出さない）', () => {
    expect(orderBaseFor('A', ctx)).toEqual({ reorder: null, target: null })
  })
  it('仮定がある店は、発注点・補充目標とも仮', () => {
    const r = orderBaseFor('A', { ...ctx, assumptions: A })
    expect(r.reorder).toMatchObject({ value: 20, source: 'assumed' })
    expect(r.target).toMatchObject({ value: 90, source: 'assumed' })
    expect(r.target.basis).toContain('発注間隔7')
  })
  it('手動の発注点は仮で上書きしない（目標は発注点×2）', () => {
    const r = orderBaseFor('A', { ...ctx, assumptions: A, reorderPoints: { A: 5 } })
    expect(r.reorder).toMatchObject({ value: 5, source: 'manual' })
    expect(r.target).toMatchObject({ value: 10, source: 'reorder' })
  })
  it('手動の補充目標が最優先', () => {
    const r = orderBaseFor('A', { ...ctx, assumptions: A, replenishTargets: { A: 33 } })
    expect(r.target).toMatchObject({ value: 33, source: 'manual' })
  })
  it('ジャンル別の在庫日数を使う', () => {
    const a = normalizeAssumptions({ stockDays: 4, stockDaysByCategory: { 野菜: 2 } })
    const r = orderBaseFor('A', { ...ctx, assumptions: a, category: '野菜' })
    expect(r.reorder.value).toBe(40)   // 40 ÷ 2 × 2
  })
})
