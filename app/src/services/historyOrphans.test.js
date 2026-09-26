import { describe, it, expect } from 'vitest'
import { orphanSnapshots, SESSIONS_LIMIT } from './historyOrphans.js'

const s = (sessionId, date) => ({ sessionId, date, items: [] })

describe('orphanSnapshots（カレンダーに無い棚卸）', () => {
  it('sessions に行の無い記録を新しい順に返す', () => {
    const out = orphanSnapshots([s('a', '2026-09-01'), s('b', '2026-09-05'), s('c', '2026-09-03')], [{ id: 'a', startedAt: '2026-09-01T10:00:00Z' }])
    expect(out.map(x => x.sessionId)).toEqual(['b', 'c'])
  })
  it('sessions を取得できていなければ判定しない。sessionId の無い旧データも出さない', () => {
    expect(orphanSnapshots([s('b', '2026-09-05')], null)).toEqual([])
    expect(orphanSnapshots([{ date: '2026-09-05', items: [] }], [])).toEqual([])
  })
  it('sessions が上限まで返ったときは、返った範囲より古い記録を判定しない', () => {
    const sessions = Array.from({ length: SESSIONS_LIMIT }, (_, i) => ({ id: 'x' + i, startedAt: `2026-08-${String(10 + (i % 20)).padStart(2, '0')}T10:00:00Z` }))
    const out = orphanSnapshots([s('old', '2026-07-01'), s('recent', '2026-09-01')], sessions)
    expect(out.map(x => x.sessionId)).toEqual(['recent'])
  })
})
