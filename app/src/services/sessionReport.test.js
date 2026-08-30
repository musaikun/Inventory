import { describe, it, expect } from 'vitest'
import { buildSessionReport, findPrevSnapshot, MOVER_LIMIT } from './sessionReport.js'

const item = (name, qty, unitPrice) => ({
  item: name,
  qty,
  unit: '個',
  unitPrice,
  subtotal: qty != null && unitPrice != null ? Math.round(qty * unitPrice) : null,
  code: '', flagged: false, category: null,
})

const e = (id, name, by, action, totalQty, at) => ({
  id, ingredient: name, action, delta: 0, totalQty, unit: '個',
  enteredBy: by, enteredById: by, timestamp: at,
})

const T = 1_700_000_000_000

function snap({ items = [], totalValue = null, auditLog = [], flaggedItems = [], date = '2026-08-30', savedAt = '2026-08-30T10:00:00.000Z', sessionId = 'sess-now', activeMs = null } = {}) {
  return { date, savedAt, sessionId, items, totalValue, auditLog, flaggedItems, activeMs, participants: null }
}

describe('件数の集計', () => {
  it('未入力と入力済みを数える', () => {
    const r = buildSessionReport(snap({
      items: [item('A', 3, 100), item('B', null, 100), item('C', 2, 50)],
      totalValue: 400,
    }))
    expect(r.items).toMatchObject({ total: 3, filled: 2, missing: 1 })
  })

  it('フラグ件数を出す', () => {
    const r = buildSessionReport(snap({ items: [item('A', 1, 10)], flaggedItems: ['A'] }))
    expect(r.items.flagged).toBe(1)
  })
})

// レポートの信頼性はここで決まる。合計金額だけ出すと、単価未設定で半分しか
// 計上されていない数字を正しい在庫金額だと誤読させる。
describe('金額に入っていない品目', () => {
  it('数量はあるが単価が無い品目を数え、partial を立てる', () => {
    const r = buildSessionReport(snap({
      items: [item('A', 3, 100), item('B', 5, null), item('C', 2, null)],
      totalValue: 300,
    }))
    expect(r.value).toMatchObject({ total: 300, pricedCount: 1, unpricedCount: 2, partial: true })
  })

  it('全品目に単価があれば partial は立たない', () => {
    const r = buildSessionReport(snap({ items: [item('A', 3, 100)], totalValue: 300 }))
    expect(r.value).toMatchObject({ unpricedCount: 0, partial: false })
  })

  // 未入力の品目は「単価が無い」に数えない（そもそも棚卸していない）
  it('未入力は単価未設定に数えない', () => {
    const r = buildSessionReport(snap({ items: [item('A', null, null)] }))
    expect(r.value.unpricedCount).toBe(0)
  })
})

describe('担当者', () => {
  it('人数と、複数人が触った品目数を出す', () => {
    const r = buildSessionReport(snap({
      items: [item('A', 8, 100), item('B', 5, 100)],
      totalValue: 1300,
      auditLog: [
        e('1', 'A', '端末A', 'new', 3, T),
        e('2', 'B', '端末A', 'new', 5, T + 1000),
        e('3', 'A', '端末B', 'overwrite', 8, T + 2000),
      ],
    }))
    expect(r.people.count).toBe(2)
    expect(r.people.sharedItems).toBe(1)   // A は2人が触った
    // 重複ありの操作件数。端末A が2操作、端末B が1操作
    expect(r.people.list.find(p => p.name === '端末A').count).toBe(2)
    expect(r.people.list.find(p => p.name === '端末B').count).toBe(1)
  })
})

describe('前回比', () => {
  const prev = snap({
    items: [item('A', 10, 100), item('B', 4, 50)],
    totalValue: 1200, date: '2026-07-31', savedAt: '2026-07-31T10:00:00.000Z', sessionId: 'sess-prev',
  })

  it('金額差と割合を出す', () => {
    const r = buildSessionReport(snap({
      items: [item('A', 5, 100), item('B', 4, 50)], totalValue: 700,
    }), prev)
    expect(r.prev).toMatchObject({ date: '2026-07-31', totalValue: 1200, valueDiff: -500 })
    expect(r.prev.valuePct).toBeCloseTo(-41.7, 1)
  })

  it('前回が0円なら割合を出さない（0除算を画面に出さない）', () => {
    const zero = { ...prev, totalValue: 0, items: [item('A', 0, 100)] }
    const r = buildSessionReport(snap({ items: [item('A', 1, 100)], totalValue: 100 }), zero)
    expect(r.prev.valueDiff).toBe(100)
    expect(r.prev.valuePct).toBeNull()
  })

  it('増えた品目・減った品目を数える', () => {
    const r = buildSessionReport(snap({
      items: [item('A', 5, 100), item('C', 1, 10)], totalValue: 510,
    }), prev)
    expect(r.prev).toMatchObject({ addedItems: 1, removedItems: 1, itemDiff: 0 })
  })

  it('金額差の大きい順に並べる', () => {
    const r = buildSessionReport(snap({
      items: [item('A', 1, 100), item('B', 10, 50)], totalValue: 600,
    }), prev)
    expect(r.prev.movers[0]).toMatchObject({ item: 'A', prev: 1000, curr: 100, diff: -900 })
    expect(r.prev.movers[1]).toMatchObject({ item: 'B', diff: 300 })
  })

  // 片方が単価未設定の品目を 0 として比べると、単価を入れ忘れただけで
  // 「在庫が丸ごと消えた」差分が出る。両方に金額がある品目だけを比べる。
  it('片方に金額が無い品目は差分に出さない', () => {
    const r = buildSessionReport(snap({
      items: [item('A', 5, null), item('B', 4, 50)], totalValue: 200,
    }), prev)
    expect(r.prev.movers.find(m => m.item === 'A')).toBeUndefined()
  })

  it('件数が多いときは打ち切り、残数を返す', () => {
    const many = Array.from({ length: MOVER_LIMIT + 3 }, (_, i) => item(`I${i}`, 1, 100))
    const manyPrev = Array.from({ length: MOVER_LIMIT + 3 }, (_, i) => item(`I${i}`, 2, 100))
    const r = buildSessionReport(
      snap({ items: many, totalValue: 100 * many.length }),
      { ...prev, items: manyPrev, totalValue: 200 * manyPrev.length },
    )
    expect(r.prev.movers).toHaveLength(MOVER_LIMIT)
    expect(r.prev.moversTruncated).toBe(3)
  })

  it('前回が無ければ null', () => {
    expect(buildSessionReport(snap({ items: [item('A', 1, 10)] })).prev).toBeNull()
  })
})

describe('findPrevSnapshot', () => {
  const mk = (sessionId, savedAt, date) => ({ sessionId, savedAt, date, items: [] })
  const target = mk('now', '2026-08-30T10:00:00.000Z', '2026-08-30')

  it('直前に完了したものを選ぶ', () => {
    const all = [
      target,
      mk('a', '2026-08-01T10:00:00.000Z', '2026-08-01'),
      mk('b', '2026-08-20T10:00:00.000Z', '2026-08-20'),
    ]
    expect(findPrevSnapshot(target, all).sessionId).toBe('b')
  })

  it('自分より後のものは選ばない', () => {
    const all = [target, mk('later', '2026-09-01T10:00:00.000Z', '2026-09-01')]
    expect(findPrevSnapshot(target, all)).toBeNull()
  })

  // 同じ日に2回完了する運用がある。日付だけで選ぶと自分自身を拾う。
  it('同じ日でも保存時刻で前後を決める', () => {
    const earlier = mk('early', '2026-08-30T08:00:00.000Z', '2026-08-30')
    expect(findPrevSnapshot(target, [target, earlier]).sessionId).toBe('early')
  })

  it('同じセッションIDは除く', () => {
    const dup = mk('now', '2026-08-29T10:00:00.000Z', '2026-08-29')
    expect(findPrevSnapshot(target, [target, dup])).toBeNull()
  })
})
