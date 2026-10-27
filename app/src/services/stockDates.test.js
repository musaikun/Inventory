import { describe, it, expect } from 'vitest'
import { stockDatesOf, expiryOf, expiryLabel, lastDateKind } from './stockDates.js'

const mv = (id, date, lines, extra = {}) => ({ id, date, type: 'in', savedAt: `${date}T09:00:00Z`, lines, ...extra })

describe('入庫ごとの日付（stockDates）', () => {
  const moves = [
    mv('a', '2026-10-20', [{ item: '牛乳', qty: 4, lotDate: '2026-10-28', lotKind: 'exp' }]),
    mv('b', '2026-10-25', [{ item: '牛乳', qty: 3, lotDate: '2026-11-03', lotKind: 'exp' }]),
    mv('c', '2026-10-26', [{ item: '米', qty: 2 }]),
    { id: 'o', date: '2026-10-26', type: 'out', lines: [{ item: '牛乳', qty: 2 }] },
  ]

  it('残りは新しい入庫から割り当て、古い順に返す（古いものから使った）', () => {
    expect(stockDatesOf('牛乳', moves, 5)).toEqual([
      { date: '2026-10-28', kind: 'exp', qty: 2, movementId: 'a' },
      { date: '2026-11-03', kind: 'exp', qty: 3, movementId: 'b' },
    ])
  })

  it('入庫で説明できない分は日付なし・日付を入れていない入庫は買った日', () => {
    expect(stockDatesOf('米', moves, 3)).toEqual([
      { date: null, kind: null, qty: 1, movementId: null },
      { date: '2026-10-26', kind: 'buy', qty: 2, movementId: 'c' },
    ])
  })

  it('見込みが無い・0なら束も無い。取り消した入庫は数えない', () => {
    expect(stockDatesOf('牛乳', moves, 0)).toEqual([])
    expect(stockDatesOf('牛乳', moves, null)).toEqual([])
    const voided = [mv('x', '2026-10-27', [{ item: '牛乳', qty: 9, lotDate: '2026-10-29', lotKind: 'exp' }], { deletedAt: '2026-10-27T10:00:00Z' }), ...moves]
    expect(stockDatesOf('牛乳', voided, 3)[0].movementId).toBe('b')
  })

  it('いちばん近い期限と知らせの段階', () => {
    const d = stockDatesOf('牛乳', moves, 5)
    expect(expiryOf(d, '2026-10-20')).toMatchObject({ date: '2026-10-28', daysLeft: 8, level: 'ok', qty: 2 })
    expect(expiryOf(d, '2026-10-26')).toMatchObject({ daysLeft: 2, level: 'soon' })
    expect(expiryOf(d, '2026-10-29')).toMatchObject({ daysLeft: -1, level: 'over' })
    expect(expiryOf(stockDatesOf('米', moves, 3))).toBe(null)
  })

  it('表示の文', () => {
    expect(expiryLabel({ daysLeft: 2 })).toBe('期限 あと2日')
    expect(expiryLabel({ daysLeft: 0 })).toBe('期限 今日まで')
    expect(expiryLabel({ daysLeft: -3 })).toBe('期限切れ 3日')
    expect(expiryLabel(null)).toBe('')
  })

  it('次の入庫の既定は、その品目で最後に使った種類', () => {
    expect(lastDateKind('牛乳', moves)).toBe('exp')
    expect(lastDateKind('米', moves)).toBe('buy')
    expect(lastDateKind('塩', moves)).toBe('buy')
  })
})
