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

  // 端末時計で新旧を決めない（DATA-001 §4）。時計が過去へずれた端末の訂正でも送る。
  it('端末時計が過去でも、未送信の訂正（dirty）は送る', () => {
    const local = [snap('2026-07-07', '2026-07-07T10:00:00Z', {
      dirty: true, updatedAt: '2000-01-01T00:00:00Z', serverRevision: 3,
    })]
    const remote = [snap('2026-07-07', '2026-07-07T10:00:00Z', { serverRevision: 3 })]
    expect(missingSnapshots(local, remote).map(s => s.date)).toEqual(['2026-07-07'])
  })

  it('端末時計が未来でも、サーバー確認済み（synced）なら送らない', () => {
    const local = [snap('2026-07-07', '2026-07-07T10:00:00Z', {
      dirty: false, synced: true, updatedAt: '2099-01-01T00:00:00Z', serverRevision: 4,
    })]
    const remote = [snap('2026-07-07', '2026-07-07T10:00:00Z', { serverRevision: 4 })]
    expect(missingSnapshots(local, remote)).toEqual([])
  })

  // 完了していない棚卸のスナップショットを送ると、サーバー側で
  // 「session は active なのに完了履歴だけある」状態が生まれる。
  it('進行中セッションのスナップショットは送らない', () => {
    const local = [
      snap('2026-07-07', '2026-07-07T10:00:00Z', { sessionId: 'live' }),
      snap('2026-07-06', '2026-07-06T10:00:00Z', { sessionId: 'done' }),
    ]
    const got = missingSnapshots(local, [], { activeSessionIds: ['live'] })
    expect(got.map(s => s.sessionId)).toEqual(['done'])
  })

  it('進行中セッションIDの指定が無ければ従来どおり全件対象', () => {
    const local = [snap('2026-07-07', '2026-07-07T10:00:00Z', { sessionId: 'live' })]
    expect(missingSnapshots(local, []).map(s => s.sessionId)).toEqual(['live'])
  })

  it('上限は positional でもオプションでも指定できる', () => {
    const local = ['2026-07-01', '2026-07-02', '2026-07-03']
      .map(d => snap(d, `${d}T10:00:00Z`))
    expect(missingSnapshots(local, [], 1).map(s => s.date)).toEqual(['2026-07-03'])
    expect(missingSnapshots(local, [], { limit: 1 }).map(s => s.date)).toEqual(['2026-07-03'])
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
