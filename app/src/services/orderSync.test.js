import { describe, it, expect } from 'vitest'
import { mergeOrderSnapshot, applyOrderLine, orderDraftToPayload } from './orderSync.js'

describe('mergeOrderSnapshot（DO発注数スナップショット → 下書き）', () => {
  it('発注数>0 の品目だけ残し、ローカルの stock は品目ごとに引き継ぐ', () => {
    const prev = { トマト: { orderQty: 1, stock: 5, unit: '個', lot: 6 } }
    const server = { トマト: { orderQty: 2, unit: '個', lot: 6 }, レタス: { orderQty: 3, unit: '玉', lot: 1 } }
    const out = mergeOrderSnapshot(prev, server)
    expect(out.トマト).toEqual({ orderQty: 2, stock: 5, unit: '個', lot: 6 })   // stock 保全・orderQty 更新
    expect(out.レタス).toEqual({ orderQty: 3, stock: null, unit: '玉', lot: 1 }) // 新規は stock なし
  })

  it('スナップショットに無い品目は落とす（＝サーバーを正として揃える）', () => {
    const prev = { A: { orderQty: 1, stock: 2, unit: '', lot: 1 }, B: { orderQty: 4, stock: null, unit: '', lot: 1 } }
    const out = mergeOrderSnapshot(prev, { A: { orderQty: 1, unit: '', lot: 1 } })
    expect(Object.keys(out)).toEqual(['A'])
  })

  it('発注数0以下は無視する', () => {
    const out = mergeOrderSnapshot({}, { A: { orderQty: 0 }, B: { orderQty: -1 }, C: { orderQty: 2 } })
    expect(Object.keys(out)).toEqual(['C'])
  })

  it('空・不正入力でも例外なく空を返す', () => {
    expect(mergeOrderSnapshot(undefined, undefined)).toEqual({})
    expect(mergeOrderSnapshot({}, null)).toEqual({})
  })
})

describe('applyOrderLine（リモート1品目更新）', () => {
  it('新規品目を追加（stock は null）', () => {
    const out = applyOrderLine({}, 'トマト', { orderQty: 2, unit: '個', lot: 6 })
    expect(out.トマト).toEqual({ orderQty: 2, stock: null, unit: '個', lot: 6 })
  })

  it('既存品目の stock を保全して発注数だけ更新', () => {
    const prev = { トマト: { orderQty: 1, stock: 5, unit: '個', lot: 6 } }
    const out = applyOrderLine(prev, 'トマト', { orderQty: 3, unit: '個', lot: 6 })
    expect(out.トマト).toEqual({ orderQty: 3, stock: 5, unit: '個', lot: 6 })
  })

  it('unit/lot 未指定なら既存値を引き継ぐ', () => {
    const prev = { A: { orderQty: 1, stock: null, unit: '本', lot: 12 } }
    const out = applyOrderLine(prev, 'A', { orderQty: 2 })
    expect(out.A.unit).toBe('本')
    expect(out.A.lot).toBe(12)
  })

  it('発注数0以下は該当品目を落とす', () => {
    const prev = { A: { orderQty: 1, stock: null, unit: '', lot: 1 }, B: { orderQty: 2, stock: null, unit: '', lot: 1 } }
    expect(Object.keys(applyOrderLine(prev, 'A', { orderQty: 0 }))).toEqual(['B'])
  })

  it('元の下書きを破壊しない（イミュータブル）', () => {
    const prev = { A: { orderQty: 1, stock: null, unit: '', lot: 1 } }
    applyOrderLine(prev, 'B', { orderQty: 2 })
    expect(Object.keys(prev)).toEqual(['A'])
  })
})

describe('orderDraftToPayload（下書き → session_start ペイロード）', () => {
  it('発注数>0 のみ・stock は除外し enteredBy を付与', () => {
    const draft = { A: { orderQty: 2, stock: 9, unit: '個', lot: 6 }, B: { orderQty: 0, stock: 1, unit: '', lot: 1 } }
    const out = orderDraftToPayload(draft, 'たろう')
    expect(out).toEqual({ A: { orderQty: 2, unit: '個', lot: 6, enteredBy: 'たろう' } })
    expect(out.A.stock).toBeUndefined()
  })

  it('空下書きは空を返す', () => {
    expect(orderDraftToPayload({}, 'x')).toEqual({})
    expect(orderDraftToPayload(undefined, '')).toEqual({})
  })
})
