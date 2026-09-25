import { describe, it, expect } from 'vitest'
import { missingFields, itemCheckRows, staleItems } from './itemCheck.js'

const cfg = (over = {}) => ({
  order: ['A', 'B', 'C'], hiddenItems: [],
  units: { A: '個', B: '本' }, prices: { A: 100, B: 0 }, categories: { A: '野菜' }, lotSizes: { A: '24本', B: '本' },
  ...over,
})

describe('itemCheck', () => {
  it('入数は数字が読めなければ空扱い、単価は0も空扱い', () => {
    expect(missingFields('A', cfg())).toEqual([])
    expect(missingFields('B', cfg())).toEqual(['lot', 'price', 'genre'])
    expect(missingFields('C', cfg())).toEqual(['lot', 'unit', 'price', 'genre'])
  })
  it('空欄のある品目だけをリストの順で返し、非表示は数えない', () => {
    expect(itemCheckRows(cfg()).map(r => r.item)).toEqual(['B', 'C'])
    expect(itemCheckRows(cfg({ hiddenItems: ['C'] })).map(r => r.item)).toEqual(['B'])
  })
})

describe('staleItems（しばらく数えていない品目）', () => {
  const snap = (date, pairs) => ({ date, items: pairs.map(([item, qty]) => ({ item, qty })) })
  // 新しい順
  const snaps = [
    snap('2026-09-20', [['A', 3], ['B', null], ['C', null]]),
    snap('2026-09-13', [['A', 2], ['B', null], ['C', null]]),
    snap('2026-09-06', [['A', 1], ['B', null], ['C', null]]),
    snap('2026-08-30', [['A', 1], ['B', 5], ['C', null]]),
  ]
  it('直近3回で一度も数えていない品目と、最後に数えた日（無ければ null）', () => {
    const m = staleItems(['A', 'B', 'C', 'D'], snaps)
    expect([...m.keys()]).toEqual(['B', 'C'])   // D は前回の棚卸に居ない＝新規なので出さない
    expect(m.get('B')).toBe('2026-08-30')
    expect(m.get('C')).toBeNull()
  })
  it('直近の棚卸に数量が1件も無ければ何も出さない', () => {
    expect(staleItems(['A'], [snap('2026-09-20', [['A', null]])]).size).toBe(0)
    expect(staleItems(['A'], []).size).toBe(0)
  })
  it('itemCheckRows に「未計測」として混ざる', () => {
    const rows = itemCheckRows(cfg({ order: ['A', 'B'], units: { A: '個', B: '本' }, prices: { A: 1, B: 1 }, categories: { A: 'x', B: 'x' }, lotSizes: { A: '1', B: '1' } }), { snapshots: snaps })
    expect(rows).toEqual([{ item: 'B', missing: ['stale'], last: '2026-08-30' }])
  })
})
