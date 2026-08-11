import { describe, it, expect } from 'vitest'
import { missingSnapshots } from './historyBackfill.js'

const snap = (date, savedAt, extra = {}) => ({
  date, savedAt, items: [{ item: 'トマト', qty: 1 }], ...extra,
})

describe('missingSnapshots（履歴バックフィルの差分判定）', () => {
  it('D1 に無いスナップショットを送信対象にする', () => {
    const local  = [snap('2026-07-07', '2026-07-07T10:00:00Z')]
    const remote = []
    expect(missingSnapshots(local, remote).map(s => s.date)).toEqual(['2026-07-07'])
  })

  it('D1 にあるものは送らない', () => {
    const local  = [snap('2026-07-07', '2026-07-07T10:00:00Z')]
    const remote = [snap('2026-07-07', '2026-07-07T10:00:00Z')]
    expect(missingSnapshots(local, remote)).toEqual([])
  })

  it('D1 側が古ければ送り直す（訂正・ロックが届いていない）', () => {
    const local  = [snap('2026-07-07', '2026-07-07T10:00:00Z', { updatedAt: '2026-07-08T09:00:00Z' })]
    const remote = [snap('2026-07-07', '2026-07-07T10:00:00Z')]
    expect(missingSnapshots(local, remote).map(s => s.date)).toEqual(['2026-07-07'])
  })

  it('D1 側が新しければ送らない', () => {
    const local  = [snap('2026-07-07', '2026-07-07T10:00:00Z')]
    const remote = [snap('2026-07-07', '2026-07-09T10:00:00Z')]
    expect(missingSnapshots(local, remote)).toEqual([])
  })

  it('履歴の取得に失敗（null）したときは何も送らない', () => {
    const local = [snap('2026-07-07', '2026-07-07T10:00:00Z')]
    expect(missingSnapshots(local, null)).toEqual([])
    expect(missingSnapshots(local, undefined)).toEqual([])
  })

  it('中身の無いスナップショットは対象外', () => {
    const local = [
      { date: '2026-07-07', savedAt: '2026-07-07T10:00:00Z', items: [] },
      { date: '2026-07-08', savedAt: '2026-07-08T10:00:00Z' },
      snap('2026-07-09', '2026-07-09T10:00:00Z'),
    ]
    expect(missingSnapshots(local, []).map(s => s.date)).toEqual(['2026-07-09'])
  })

  it('新しい日付から上限件数だけ返す', () => {
    const local = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04']
      .map(d => snap(d, `${d}T10:00:00Z`))
    expect(missingSnapshots(local, [], 2).map(s => s.date)).toEqual(['2026-07-04', '2026-07-03'])
  })

  it('保存時刻が壊れていても落ちない（最古扱いでリモート優先）', () => {
    const local  = [snap('2026-07-07', 'not-a-date')]
    const remote = [snap('2026-07-07', 'also-broken')]
    expect(missingSnapshots(local, remote)).toEqual([])
    expect(missingSnapshots([], [])).toEqual([])
    expect(missingSnapshots(null, [])).toEqual([])
  })
})
