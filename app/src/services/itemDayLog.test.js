import { describe, it, expect } from 'vitest'
import { itemDayLog } from './itemDayLog.js'

const mv = (id, date, type, qty, savedAt, extra = {}) => ({ id, date, type, savedAt, lines: [{ item: '豆', qty, unit: 'p' }], ...extra })

describe('itemDayLog（品目シートのカレンダーと日の明細）', () => {
  it('入庫と出庫は差し引かずに日ごとに足す・棚卸はその日の数・取り消しは数に入れない', () => {
    const { days, entries } = itemDayLog('豆', [
      mv('a', '2026-10-01', 'in', 6, '2026-10-01T01:00:00Z'),
      mv('b', '2026-10-01', 'out', 2, '2026-10-01T06:00:00Z'),
      mv('c', '2026-10-01', 'in', 1, '2026-10-01T07:00:00Z'),
      mv('d', '2026-10-01', 'out', 5, '2026-10-01T08:00:00Z', { deletedAt: '2026-10-01T09:00:00Z' }),
    ], [{ date: '2026-10-01', savedAt: '2026-10-01T10:00:00Z', items: [{ item: '豆', qty: 8 }] }])
    expect(days['2026-10-01']).toEqual({ in: 7, out: 2, st: 8 })
    expect(entries['2026-10-01'].map(e => e.kind)).toEqual(['in', 'out', 'in', 'out', 'st'])
    expect(entries['2026-10-01'][3].deleted).toBe(true)
  })

  it('他の品目の行は拾わない', () => {
    const { days } = itemDayLog('豆', [{ id: 'x', date: '2026-10-02', type: 'in', lines: [{ item: '牛乳', qty: 3 }] }], [])
    expect(days).toEqual({})
  })
})
