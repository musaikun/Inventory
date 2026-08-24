// 発注点の初期値提案（D4）の回帰。
// 部分利用のユーザーは学習が貯まらないため、ここが推奨発注数を支える。
// ただし推測で埋めない — 出せないときは null を返す。
import { describe, it, expect } from 'vitest'
import { suggestReorderPoint, suggestReorderPoints } from './reorderSuggestion.js'

const snap = (date, qty) => ({ date, items: [{ item: 'A', qty }] })
const _daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)

describe('suggestReorderPoint', () => {
  it('消費が出せれば 推定消費 × 発注間隔', () => {
    const snapshots = [snap(_daysAgo(8), 20), snap(_daysAgo(4), 12)]   // 4日で8消費 → 2/日
    const r = suggestReorderPoint('A', { snapshots, horizonDays: 3 })
    expect(r).toMatchObject({ value: 6, source: 'consumption' })
    expect(r.basis).toContain('推定消費 2.0/日 × 3日')
  })

  it('消費が出せなければ、記録の最小値を目安にする', () => {
    // 在庫が増えている区間しか無い＝消費を出せない
    const snapshots = [snap('2026-08-01', 4), snap('2026-08-08', 9)]
    const r = suggestReorderPoint('A', { snapshots })
    expect(r).toMatchObject({ value: 4, source: 'stocktakeMin' })
    expect(r.basis).toContain('最も少なかったとき')
  })

  it('発注時の在庫も観測点として使う', () => {
    const snapshots = [snap('2026-08-01', 10)]
    const orders = [{ date: '2026-08-08', lines: [{ item: 'A', stock: 12 }] }]
    expect(suggestReorderPoint('A', { snapshots, orders })).toMatchObject({ value: 10, source: 'stocktakeMin' })
  })

  it('観測点が1つ以下なら出さない（推測で埋めない）', () => {
    expect(suggestReorderPoint('A', { snapshots: [snap('2026-08-01', 10)] })).toBeNull()
    expect(suggestReorderPoint('A', {})).toBeNull()
  })

  it('最小値が0なら出さない（0を発注点にしても意味が無い）', () => {
    const snapshots = [snap('2026-08-01', 0), snap('2026-08-08', 5)]
    expect(suggestReorderPoint('A', { snapshots })).toBeNull()
  })

  it('消費がごく小さくても最低1は提案する', () => {
    const snapshots = [snap(_daysAgo(30), 10), snap(_daysAgo(1), 9.9)]
    const r = suggestReorderPoint('A', { snapshots, horizonDays: 1 })
    expect(r.value).toBeGreaterThanOrEqual(1)
  })
})

describe('suggestReorderPoints（一括）', () => {
  it('現在値と提案を品目ごとに並べる。提案が無い品目も落とさない', () => {
    const snapshots = [
      { date: '2026-08-01', items: [{ item: 'A', qty: 4 }] },
      { date: '2026-08-08', items: [{ item: 'A', qty: 9 }] },
    ]
    const rows = suggestReorderPoints(['A', 'B'], { snapshots, reorderPoints: { B: 3 } })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ item: 'A', current: null, suggested: 4 })
    expect(rows[1]).toMatchObject({ item: 'B', current: 3, suggested: null })
  })
})
