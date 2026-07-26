import { describe, it, expect } from 'vitest'
import { buildImportMovements } from './deliveryImportCommit.js'

describe('buildImportMovements', () => {
  it('日付×仕入先ごとに入庫レコードへ畳み込む', () => {
    const rows = [
      { date: '2026-06-01', type: 'in', supplier: '八百屋', item: '玉ねぎ', qty: 20, unit: 'kg' },
      { date: '2026-06-01', type: 'in', supplier: '八百屋', item: 'レタス', qty: 24, unit: '玉' },
      { date: '2026-06-01', type: 'in', supplier: '肉のヤマ', item: '鶏もも', qty: 5, unit: 'kg' },
      { date: '2026-06-03', type: 'in', supplier: '八百屋', item: 'トマト', qty: 3, unit: 'kg' },
    ]
    const out = buildImportMovements(rows, { batchId: 'imp_x' })
    expect(out).toHaveLength(3)  // (6/1 八百屋)(6/1 肉のヤマ)(6/3 八百屋)
    expect(out[0]).toMatchObject({
      type: 'in', date: '2026-06-01', note: '八百屋', source: 'import', importBatchId: 'imp_x',
    })
    expect(out[0].lines).toEqual([
      { item: '玉ねぎ', qty: 20, unit: 'kg' },
      { item: 'レタス', qty: 24, unit: '玉' },
    ])
    expect(out[1]).toMatchObject({ date: '2026-06-01', note: '肉のヤマ' })
    expect(out[2]).toMatchObject({ date: '2026-06-03', note: '八百屋' })
  })

  it('日付昇順かつ同一日内は仕入先の入力初出順を保持する', () => {
    const rows = [
      { date: '2026-06-03', type: 'in', supplier: '青果店', item: 'トマト', qty: 3, unit: 'kg' },
      { date: '2026-06-01', type: 'in', supplier: '八百屋', item: '玉ねぎ', qty: 20, unit: 'kg' },
      { date: '2026-06-01', type: 'in', supplier: '肉のヤマ', item: '鶏もも', qty: 5, unit: 'kg' },
      { date: '2026-06-01', type: 'in', supplier: '八百屋', item: 'レタス', qty: 24, unit: '玉' },
    ]

    const out = buildImportMovements(rows)

    expect(out.map(({ date, note }) => [date, note])).toEqual([
      ['2026-06-01', '八百屋'],
      ['2026-06-01', '肉のヤマ'],
      ['2026-06-03', '青果店'],
    ])
    expect(out[0].lines.map(line => line.item)).toEqual(['玉ねぎ', 'レタス'])
  })

  it('item 無し・qty<=0・出庫・日付無しは除外', () => {
    const rows = [
      { date: '2026-06-01', type: 'in', item: '', qty: 3 },
      { date: '2026-06-01', type: 'in', item: 'A', qty: 0 },
      { date: '2026-06-01', type: 'out', item: 'B', qty: 3 },
      { date: '', type: 'in', item: 'C', qty: 3 },
      { date: '2026-06-01', type: 'in', item: 'D', qty: 2, unit: '本' },
    ]
    const out = buildImportMovements(rows, { batchId: 'imp_y' })
    expect(out).toHaveLength(1)
    expect(out[0].lines).toEqual([{ item: 'D', qty: 2, unit: '本' }])
  })

  it('空入力は空配列', () => {
    expect(buildImportMovements([], {})).toEqual([])
  })
})
