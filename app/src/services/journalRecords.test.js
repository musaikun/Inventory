import { describe, it, expect } from 'vitest'
import { workSpans, mergeMovements, mergeOrders, stockRecords, stockDateKey, sortRecords, fmtDuration, PAUSE_MS } from './journalRecords.js'

const T = (h, m = 0) => new Date(2026, 9, 9, h, m).getTime()

describe('日誌の記録（User決定 2026-10-09）', () => {
  it('棚卸は始め〜終わり。入力が5分以上空いたところを中断にし、実働はその分を引く', () => {
    const s = workSpans(new Date(T(9)).toISOString(), new Date(T(12)).toISOString(),
      [T(9, 1), T(9, 30), T(10, 10), T(10, 50), T(11, 0), T(11, 4), T(11, 59)])
    expect(s.from).toBe(T(9)); expect(s.to).toBe(T(12))
    // 9:01→9:30（29分）、9:30→10:10（40分）、10:10→10:50（40分）、10:50→11:00（10分）、11:04→11:59（55分）が5分以上。11:00→11:04 は続き
    expect(s.pauses.map(p => Math.round(p.ms / 60000))).toEqual([29, 40, 40, 10, 55])
    expect(s.activeMs).toBe(3 * 3600_000 - (29 + 40 + 40 + 10 + 55) * 60000)
    expect(workSpans(null, null, [T(9), T(9, 3)]).pauses).toEqual([])
    expect(PAUSE_MS).toBe(300000)
  })

  it('品目シートの入出庫は、同じ種類で30分以内の続きを1件にまとめ、品目ごとに数を足す', () => {
    const q = (id, type, item, qty, h, m) => ({ id, type, date: '2026-10-09', savedAt: new Date(T(h, m)).toISOString(), lines: [{ item, qty, unit: '個' }], by: '山田' })
    const recs = mergeMovements([
      q('a', 'in', 'キャベツ', 6, 11, 0), q('b', 'in', 'トマト', 24, 11, 10), q('c', 'in', 'キャベツ', 2, 11, 30),
      q('d', 'in', '牛乳', 12, 13, 0),                     // 30分より空いたので別の1件
      q('e', 'out', 'トマト', 1, 11, 5),                     // 種類が違うので別
      { id: 'f', type: 'in', date: '2026-10-09', savedAt: new Date(T(15)).toISOString(), source: 'import', lines: [{ item: 'A', qty: 1 }, { item: 'B', qty: 2 }] },
      { ...q('g', 'in', 'X', 1, 11, 1), deletedAt: 'x' },    // 取り消したものは数えない
    ])
    const ins = recs.filter(r => r.kind === 'in')
    expect(ins.map(r => r.title)).toEqual(['入庫 2品目', '入庫 1品目', '入庫 2品目'])
    expect(ins[0].lines).toEqual([{ item: 'キャベツ', qty: 8, unit: '個' }, { item: 'トマト', qty: 24, unit: '個' }])
    expect(ins[0].count).toBe(3)
    expect(ins[2].note).toBe('取込')
    expect(recs.filter(r => r.kind === 'out')).toHaveLength(1)
  })

  it('発注は同じ発注でまとめ、仕入先の数と品目数を出す', () => {
    const recs = mergeOrders([
      { id: 'o1', sessionId: 's1', supplier: '○○青果', savedAt: new Date(T(15, 12)).toISOString(), lines: [{ item: 'a', qty: 1 }, { item: 'b', qty: 1 }] },
      { id: 'o2', sessionId: 's1', supplier: '△△乳業', savedAt: new Date(T(15, 12)).toISOString(), lines: [{ item: 'c', qty: 1 }] },
      { id: 'o3', sessionId: null, supplier: '', savedAt: new Date(T(9)).toISOString(), lines: [{ item: 'd', qty: 1 }] },
    ])
    expect(sortRecords(recs).map(r => r.title)).toEqual(['発注 1品目', '発注 2社 3品目'])
  })

  it('棚卸の記録: 端末の明細から人・品目数・中断。取込は時刻を持たない。載る日はカレンダーと同じ', () => {
    const s = { id: 's1', startedAt: new Date(T(9)).toISOString(), endedAt: new Date(T(12)).toISOString() }
    const snap = { items: [{ qty: 1 }, { qty: null }, { qty: 2 }], participants: [{ name: '佐藤', items: [1, 2] }], auditLog: [{ timestamp: T(9, 1) }, { timestamp: T(10, 0) }], totalValue: 1000, activeMs: 7200_000 }
    const [r] = stockRecords([s], () => snap)
    expect(r).toMatchObject({ kind: 'stock', items: 2, by: '佐藤', total: 1000, activeMs: 7200_000 })
    expect(r.pauses).toHaveLength(1)
    const [imp] = stockRecords([{ ...s, importBatchId: 'b1' }], () => null)
    expect(imp.at).toBeNull()
    expect(stockDateKey({ startedAt: '2026-09-30T00:00:00.000Z', endedAt: '2026-10-09T10:00:00Z', importBatchId: 'b' })).toBe('2026-09-30')
    expect(stockDateKey(s)).toBe('2026-10-09')
    expect(fmtDuration(8400_000)).toBe('2時間20分')
  })
})
