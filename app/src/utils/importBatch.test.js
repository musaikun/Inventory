import { describe, it, expect } from 'vitest'
import { lineKey, existingLineKeys, annotateDuplicates, newImportBatchId } from './importBatch.js'

describe('lineKey', () => {
  it('日付+種別+品目+数量で一意キー（数量の表記ゆれを正規化）', () => {
    expect(lineKey({ date: '2026-06-01', type: 'in', item: '玉ねぎ', qty: 3 }))
      .toBe('2026-06-01|in|玉ねぎ|3')
    expect(lineKey({ date: '2026-06-01', type: 'in', item: '玉ねぎ', qty: '3.0' }))
      .toBe(lineKey({ date: '2026-06-01', type: 'in', item: '玉ねぎ', qty: 3 }))
  })
  it('種別未指定は in 扱い', () => {
    expect(lineKey({ date: '2026-06-01', item: 'A', qty: 1 })).toBe('2026-06-01|in|A|1')
  })
})

describe('existingLineKeys', () => {
  it('既存レコードの全明細キーを集める', () => {
    const movements = [
      { date: '2026-06-01', type: 'in', lines: [{ item: '玉ねぎ', qty: 3 }, { item: '鶏もも', qty: 5 }] },
      { date: '2026-06-02', type: 'out', lines: [{ item: '玉ねぎ', qty: 1 }] },
    ]
    const keys = existingLineKeys(movements)
    expect(keys.has('2026-06-01|in|玉ねぎ|3')).toBe(true)
    expect(keys.has('2026-06-02|out|玉ねぎ|1')).toBe(true)
    expect(keys.size).toBe(3)
  })
})

describe('annotateDuplicates', () => {
  it('既存と衝突する行を duplicate=true にする', () => {
    const existing = existingLineKeys([{ date: '2026-06-01', type: 'in', lines: [{ item: '玉ねぎ', qty: 3 }] }])
    const rows = [
      { date: '2026-06-01', type: 'in', name: '玉ねぎ', qty: 3 },  // 既存と重複
      { date: '2026-06-01', type: 'in', name: '鶏もも', qty: 5 },  // 新規
    ]
    const { rows: out, duplicateCount } = annotateDuplicates(rows, existing)
    expect(out[0].duplicate).toBe(true)
    expect(out[1].duplicate).toBe(false)
    expect(duplicateCount).toBe(1)
  })

  it('バッチ内の同一行どうしも重複扱い（2件目以降）', () => {
    const rows = [
      { date: '2026-06-01', type: 'in', name: 'A', qty: 2 },
      { date: '2026-06-01', type: 'in', name: 'A', qty: 2 },  // バッチ内重複
    ]
    const { rows: out, duplicateCount } = annotateDuplicates(rows, new Set())
    expect(out[0].duplicate).toBe(false)
    expect(out[1].duplicate).toBe(true)
    expect(duplicateCount).toBe(1)
  })

  it('itemOf で解決後の品目名に基づく判定もできる', () => {
    const existing = existingLineKeys([{ date: '2026-06-01', type: 'in', lines: [{ item: '玉ねぎ', qty: 3 }] }])
    const rows = [{ date: '2026-06-01', type: 'in', name: 'たまねぎ', qty: 3, resolvedItem: '玉ねぎ' }]
    const { rows: out } = annotateDuplicates(rows, existing, r => r.resolvedItem)
    expect(out[0].duplicate).toBe(true)
  })
})

describe('newImportBatchId', () => {
  it('imp_ 接頭辞で毎回異なる', () => {
    const a = newImportBatchId(), b = newImportBatchId()
    expect(a).toMatch(/^imp_/)
    expect(a).not.toBe(b)
  })
})
