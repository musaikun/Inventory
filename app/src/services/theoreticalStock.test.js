import { describe, it, expect } from 'vitest'
import { theoreticalStock } from './theoreticalStock.js'

const snap = (date, savedAt, items) => ({ date, savedAt, items })
const move = (date, type, lines, savedAt = `${date}T12:00:00Z`) => ({ date, type, savedAt, lines })

describe('theoreticalStock（理論在庫の導出）', () => {
  it('直近棚卸を基準に、その後の入出庫を加減算する', () => {
    const snaps = [
      snap('2026-07-01', '2026-07-01T22:00:00Z', [{ item: 'トマト', qty: 10 }]),
      snap('2026-06-01', '2026-06-01T22:00:00Z', [{ item: 'トマト', qty: 99 }]),  // 古い方は無視
    ]
    const moves = [
      move('2026-07-03', 'in',  [{ item: 'トマト', qty: 6 }]),
      move('2026-07-05', 'out', [{ item: 'トマト', qty: 2 }]),
    ]
    const t = theoreticalStock('トマト', snaps, moves)
    expect(t.qty).toBe(14)  // 10 + 6 − 2
    expect(t.baseQty).toBe(10)
    expect(t.baseDate).toBe('2026-07-01')
    expect(t.inQty).toBe(6)
    expect(t.outQty).toBe(2)
    expect(t.moveCount).toBe(2)
  })

  it('基準日より前の入出庫は反映しない', () => {
    const snaps = [snap('2026-07-01', '2026-07-01T22:00:00Z', [{ item: 'A', qty: 5 }])]
    const moves = [move('2026-06-30', 'in', [{ item: 'A', qty: 100 }])]
    expect(theoreticalStock('A', snaps, moves).qty).toBe(5)
  })

  it('棚卸と同日の入出庫は、棚卸より後に記録された分だけ反映', () => {
    const snaps = [snap('2026-07-01', '2026-07-01T12:00:00Z', [{ item: 'A', qty: 5 }])]
    const moves = [
      move('2026-07-01', 'in', [{ item: 'A', qty: 3 }], '2026-07-01T10:00:00Z'),  // 棚卸前 → 無視
      move('2026-07-01', 'in', [{ item: 'A', qty: 2 }], '2026-07-01T15:00:00Z'),  // 棚卸後 → 反映
    ]
    expect(theoreticalStock('A', snaps, moves).qty).toBe(7)
  })

  it('棚卸実績が無ければ 0 起点で入出庫のみ加減算（マイナスも許す）', () => {
    const moves = [
      move('2026-07-01', 'in',  [{ item: 'A', qty: 3 }]),
      move('2026-07-02', 'out', [{ item: 'A', qty: 5 }]),
    ]
    const t = theoreticalStock('A', [], moves)
    expect(t.qty).toBe(-2)
    expect(t.baseQty).toBeNull()
    expect(t.baseDate).toBeNull()
  })

  it('基準点も入出庫も無い品目は null', () => {
    expect(theoreticalStock('無い品目', [], [])).toBeNull()
    const snaps = [snap('2026-07-01', '2026-07-01T22:00:00Z', [{ item: '別品目', qty: 1 }])]
    expect(theoreticalStock('無い品目', snaps, [])).toBeNull()
  })

  it('棚卸で未入力（qty=null）の品目は基準点にならない', () => {
    const snaps = [
      snap('2026-07-10', '2026-07-10T22:00:00Z', [{ item: 'A', qty: null }]),
      snap('2026-07-01', '2026-07-01T22:00:00Z', [{ item: 'A', qty: 8 }]),
    ]
    const t = theoreticalStock('A', snaps, [])
    expect(t.baseDate).toBe('2026-07-01')
    expect(t.qty).toBe(8)
  })

  it('他品目の行は無視する', () => {
    const snaps = [snap('2026-07-01', '2026-07-01T22:00:00Z', [{ item: 'A', qty: 5 }])]
    const moves = [move('2026-07-02', 'in', [{ item: 'B', qty: 100 }, { item: 'A', qty: 1 }])]
    expect(theoreticalStock('A', snaps, moves).qty).toBe(6)
  })

  it('asOf を指定するとその日までの入出庫のみ反映', () => {
    const snaps = [snap('2026-07-01', '2026-07-01T22:00:00Z', [{ item: 'A', qty: 5 }])]
    const moves = [
      move('2026-07-02', 'in', [{ item: 'A', qty: 2 }]),
      move('2026-07-09', 'in', [{ item: 'A', qty: 9 }]),
    ]
    expect(theoreticalStock('A', snaps, moves, { asOf: '2026-07-05' }).qty).toBe(7)
  })

  it('小数の加減算は3桁で丸める', () => {
    const snaps = [snap('2026-07-01', '2026-07-01T22:00:00Z', [{ item: 'A', qty: 0.1 }])]
    const moves = [move('2026-07-02', 'in', [{ item: 'A', qty: 0.2 }])]
    expect(theoreticalStock('A', snaps, moves).qty).toBe(0.3)
  })
})
