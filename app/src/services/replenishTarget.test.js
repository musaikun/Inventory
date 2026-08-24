// 補充目標の優先順位と、部分利用（学習が貯まらない）でも推奨が出ることの回帰。
import { describe, it, expect } from 'vitest'
import { replenishTarget, targetBasisLabel, REORDER_MULTIPLIER } from './replenishTarget.js'
import { suggestOrder } from './orderSuggestion.js'

describe('replenishTarget', () => {
  it('手動設定を常に優先する', () => {
    const t = replenishTarget({ manual: 30, parLevel: 20, reorderPoint: 5, dailyConsumption: 2 })
    expect(t).toEqual({ value: 30, source: 'manual' })
  })

  it('手動が無ければ学習値（適正在庫）', () => {
    const t = replenishTarget({ parLevel: 20, reorderPoint: 5, dailyConsumption: 2 })
    expect(t).toEqual({ value: 20, source: 'par' })
  })

  it('学習が無ければ 発注点 ＋ 発注間隔ぶんの推定消費', () => {
    const t = replenishTarget({ reorderPoint: 5, dailyConsumption: 2, horizonDays: 3 })
    expect(t).toEqual({ value: 11, source: 'consumption' })   // 5 + ceil(2*3)
  })

  it('学習も消費も無ければ 発注点 × 2（部分利用の初期状態）', () => {
    const t = replenishTarget({ reorderPoint: 6 })
    expect(t).toEqual({ value: 6 * REORDER_MULTIPLIER, source: 'reorder' })
  })

  it('発注点も無ければ目標を出さない（推奨も出さない）', () => {
    expect(replenishTarget({})).toBeNull()
    expect(replenishTarget({ dailyConsumption: 2 })).toBeNull()
  })

  it('0や不正値は「無い」として扱う', () => {
    expect(replenishTarget({ parLevel: 0, reorderPoint: 4 })).toEqual({ value: 8, source: 'reorder' })
    expect(replenishTarget({ manual: 'abc', reorderPoint: 4 })).toEqual({ value: 8, source: 'reorder' })
    expect(replenishTarget({ manual: 0 })).toEqual({ value: 0, source: 'manual' })   // 0は明示的な指定
  })
})

describe('targetBasisLabel', () => {
  it('根拠を必ず言葉で出す', () => {
    expect(targetBasisLabel({ value: 12, source: 'reorder' }, { reorderPoint: 6 })).toContain('発注点 6 × 2')
    expect(targetBasisLabel({ value: 11, source: 'consumption' }, { reorderPoint: 5, dailyConsumption: 2, horizonDays: 3 }))
      .toContain('推定消費 2.0/日 × 3日')
    expect(targetBasisLabel({ value: 20, source: 'par' })).toContain('学習した適正在庫')
    expect(targetBasisLabel(null)).toBe('')
  })
})

// 発注数は既存の suggestOrder（LOT 単位・切り捨て）をそのまま使う。
describe('補充目標から発注数を出す', () => {
  it('不足を入数で割った整数部（過剰発注しない）', () => {
    const t = replenishTarget({ reorderPoint: 12 })     // 24
    expect(t.value).toBe(24)
    expect(suggestOrder(t.value, 8, 12)).toBe(1)        // 不足16 → 1ケース(12)
    expect(suggestOrder(t.value, 0, 12)).toBe(2)
    expect(suggestOrder(t.value, 24, 12)).toBe(0)       // 足りていれば発注しない
  })
})
