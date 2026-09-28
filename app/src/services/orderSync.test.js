import { describe, it, expect } from 'vitest'
import { mergeOrderSnapshot, applyOrderLine, orderDraftToPayload, dropHeldLines } from './orderSync.js'

describe('mergeOrderSnapshot（DO発注数スナップショット → 下書き）', () => {
  it('発注数>0 の品目だけ残し、ローカルの stock は品目ごとに引き継ぐ・enteredBy を by へ', () => {
    const prev = { トマト: { orderQty: 1, stock: 5, unit: '個', lot: 6 } }
    const server = { トマト: { orderQty: 2, unit: '個', lot: 6, enteredBy: 'たろう' }, レタス: { orderQty: 3, unit: '玉', lot: 1 } }
    const out = mergeOrderSnapshot(prev, server)
    expect(out.トマト).toEqual({ orderQty: 2, stock: 5, unit: '個', lot: 6, by: 'たろう' })  // stock 保全・orderQty 更新
    expect(out.レタス).toEqual({ orderQty: 3, stock: null, unit: '玉', lot: 1, by: '' })    // 新規は stock なし
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
  it('新規品目を追加（stock は null・by を保持）', () => {
    const out = applyOrderLine({}, 'トマト', { orderQty: 2, unit: '個', lot: 6, by: 'はなこ' })
    expect(out.トマト).toEqual({ orderQty: 2, stock: null, unit: '個', lot: 6, by: 'はなこ' })
  })

  it('既存品目の stock を保全して発注数だけ更新', () => {
    const prev = { トマト: { orderQty: 1, stock: 5, unit: '個', lot: 6, by: 'A' } }
    const out = applyOrderLine(prev, 'トマト', { orderQty: 3, unit: '個', lot: 6, by: 'B' })
    expect(out.トマト).toEqual({ orderQty: 3, stock: 5, unit: '個', lot: 6, by: 'B' })
  })

  it('unit/lot/by 未指定なら既存値を引き継ぐ', () => {
    const prev = { A: { orderQty: 1, stock: null, unit: '本', lot: 12, by: 'たろう' } }
    const out = applyOrderLine(prev, 'A', { orderQty: 2 })
    expect(out.A.unit).toBe('本')
    expect(out.A.lot).toBe(12)
    expect(out.A.by).toBe('たろう')
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

// 保留 = 在庫は数えたが、発注数はまだ決めていない行。
// 実運用では棚の前で適正な発注量まで判断できず、在庫だけ記録して後から詳しい人や
// 社内の入出庫情報と突き合わせて決めていた。以前は発注数0の行を落としていたため、
// **後で見たい品目ほど発注一覧から消えていた**。
describe('保留（在庫だけ・発注数0）は持たない（2026-09-28 廃止）', () => {
  const held = { orderQty: 0, stock: 6, unit: '本', lot: 24, by: '田中' }

  it('以前の版が端末に残した保留は、読み込み時に落とす', () => {
    const out = dropHeldLines({ トマト: held, レタス: { orderQty: 3, stock: 2, unit: '玉', lot: 1 } })
    expect(Object.keys(out)).toEqual(['レタス'])
  })

  it('発注が取り消されたら、在庫を数えていても下書きから外す', () => {
    const next = applyOrderLine({ トマト: { orderQty: 2, stock: 6, unit: '本', lot: 24 } }, 'トマト', { orderQty: 0 })
    expect(next.トマト).toBeUndefined()
  })

  it('サーバのスナップショットに無い保留は残さない', () => {
    const next = mergeOrderSnapshot({ トマト: held, レタス: { orderQty: 1, stock: 2, unit: '玉', lot: 1 } },
                                    { レタス: { orderQty: 3, unit: '玉', lot: 1, enteredBy: '佐藤' } })
    expect(next.レタス).toMatchObject({ orderQty: 3, by: '佐藤', stock: 2 })
    expect(next.トマト).toBeUndefined()
  })

  it('同期ペイロードには発注数>0 だけを載せる', () => {
    const out = orderDraftToPayload({ トマト: held, レタス: { orderQty: 3, unit: '玉', lot: 1 } }, '田中')
    expect(Object.keys(out)).toEqual(['レタス'])
  })
})
