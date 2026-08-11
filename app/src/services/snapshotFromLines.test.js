import { describe, it, expect } from 'vitest'
import { buildSnapshotFromLines, SNAPSHOT_SOURCE_LINES } from './snapshotFromLines.js'

const base = {
  sessionId: 'sess-1',
  date:      '2026-07-07',
  startedAt: '2026-07-07T01:00:00Z',
  endedAt:   '2026-07-07T02:30:00Z',
  status:    'completed',
  totalValue: 2000,
  truncated: false,
  lines: [
    { item: '鶏もも', qty: 3, unit: 'kg', unitPrice: 500, subtotal: 1500, category: null },
    { item: '玉ねぎ', qty: 2, unit: '箱', unitPrice: 250, subtotal: 500,  category: '野菜' },
  ],
}

describe('buildSnapshotFromLines', () => {
  it('明細を詳細画面が読める形へ組み立てる', () => {
    const snap = buildSnapshotFromLines(base)
    expect(snap.date).toBe('2026-07-07')
    expect(snap.sessionId).toBe('sess-1')
    expect(snap.items).toHaveLength(2)
    expect(snap.items[0]).toMatchObject({
      item: '鶏もも', qty: 3, unit: 'kg', unitPrice: 500, subtotal: 1500,
    })
    // 詳細画面が参照する項目が欠けていない
    expect(snap.items[0]).toHaveProperty('code')
    expect(snap.items[0]).toHaveProperty('flagged', false)
    expect(snap.entryLog).toEqual([])
    expect(snap.auditLog).toEqual([])
  })

  it('出所を示す印を付け、訂正できない状態にする', () => {
    const snap = buildSnapshotFromLines(base)
    expect(snap.source).toBe(SNAPSHOT_SOURCE_LINES)
    // 端末に実体が無いため編集させない（patchSnapshotItems が書き換える先が無い）
    expect(snap.locked).toBe(true)
  })

  it('savedAt は完了時刻。復元した瞬間を基準にしない', () => {
    const snap = buildSnapshotFromLines(base)
    expect(snap.savedAt).toBe('2026-07-07T02:30:00Z')
  })

  it('endedAt が無ければ startedAt を使う', () => {
    const snap = buildSnapshotFromLines({ ...base, endedAt: null })
    expect(snap.savedAt).toBe('2026-07-07T01:00:00Z')
  })

  it('合計はサーバーの total_value を優先する（打ち切り時に過小表示しない）', () => {
    const snap = buildSnapshotFromLines({ ...base, totalValue: 999999, truncated: true })
    expect(snap.totalValue).toBe(999999)
    expect(snap.truncated).toBe(true)
  })

  it('total_value が無ければ明細から積み上げる', () => {
    const snap = buildSnapshotFromLines({ ...base, totalValue: null })
    expect(snap.totalValue).toBe(2000)
  })

  it('単価が無い明細だけなら totalValue は null', () => {
    const snap = buildSnapshotFromLines({
      ...base, totalValue: null,
      lines: [{ item: '塩', qty: 1, unit: '袋', unitPrice: null, subtotal: null, category: null }],
    })
    expect(snap.totalValue).toBeNull()
  })

  it('subtotal が欠けていれば qty×unitPrice で補う', () => {
    const snap = buildSnapshotFromLines({
      ...base, totalValue: null,
      lines: [{ item: '鶏もも', qty: 3, unit: 'kg', unitPrice: 500, category: null }],
    })
    expect(snap.items[0].subtotal).toBe(1500)
  })

  it('未入力（qty が null）の明細は null のまま保つ', () => {
    const snap = buildSnapshotFromLines({
      ...base, totalValue: null,
      lines: [{ item: '塩', qty: null, unit: '袋', unitPrice: 100, subtotal: null, category: null }],
    })
    expect(snap.items[0].qty).toBeNull()
    expect(snap.items[0].subtotal).toBeNull()
  })

  it('品目名が空の行は捨てる', () => {
    const snap = buildSnapshotFromLines({
      ...base,
      lines: [{ item: '  ', qty: 1 }, { item: '鶏もも', qty: 3, unitPrice: 500, subtotal: 1500 }],
    })
    expect(snap.items.map(i => i.item)).toEqual(['鶏もも'])
  })

  it('明細が無ければ null を返す（呼び出し側が従来のメッセージを出せる）', () => {
    expect(buildSnapshotFromLines({ ...base, lines: [] })).toBeNull()
    expect(buildSnapshotFromLines({ ...base, lines: null })).toBeNull()
    expect(buildSnapshotFromLines(null)).toBeNull()
    expect(buildSnapshotFromLines(undefined)).toBeNull()
  })

  it('有効な品目が1件も無ければ null', () => {
    expect(buildSnapshotFromLines({ ...base, lines: [{ item: '', qty: 1 }] })).toBeNull()
  })

  it('date が無ければ endedAt から日付を導く', () => {
    const snap = buildSnapshotFromLines({ ...base, date: '' })
    expect(snap.date).toBe('2026-07-07')
  })
})
