import { describe, it, expect } from 'vitest'
import { doneItems, filterDone, lateness, kindOf, groupByDay, summarize, mergeById, whoDid } from './doneHistory.js'

const NOW = new Date('2026-11-18T12:00:00+09:00').getTime()
const iso = s => new Date(s).toISOString()
const T = (o) => ({ id: o.id, text: o.text ?? o.id, date: o.date ?? '2026-11-10', doneAt: o.doneAt ?? null, updatedAt: o.updatedAt ?? '1', ...o })

const list = [
  T({ id: 'a', text: '仕込み表の確認', date: '2026-11-17', doneAt: iso('2026-11-17T10:00:00+09:00'), doneBy: '田中', category: 'prep' }),
  T({ id: 'b', text: '換気扇の掃除', date: '2026-11-10', doneAt: iso('2026-11-12T09:00:00+09:00'), doneBy: '佐藤', category: 'clean' }),
  T({ id: 'c', text: '製氷機の修理', date: '2026-10-01', progress: 'doing', deadline: null, doneAt: iso('2026-11-16T18:00:00+09:00'), doneBy: '田中', note: '業者 3回目' }),
  T({ id: 'd', text: '備品の棚を作る', date: '', doneAt: iso('2026-08-01T10:00:00+09:00'), doneBy: '佐藤' }),
  T({ id: 'e', text: 'まだ', date: '2026-11-18' }),                                                  // 済んでいない
  T({ id: 'f', text: '店内改装', category: 'event', doneAt: iso('2026-11-15T10:00:00+09:00') }),     // イベント
  T({ id: 'g', text: '消した', doneAt: iso('2026-11-15T10:00:00+09:00'), deletedAt: 'x' }),
  T({ id: 'h', text: '参加申請', kind: 'staff_join', doneAt: iso('2026-11-15T10:00:00+09:00') }),
]

describe('doneHistory', () => {
  it('済んだものだけ、新しい順。イベント・消したもの・アプリが作ったものは入れない', () => {
    expect(doneItems(list).map(t => t.id)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('種類: 進行中・いつか・やること', () => {
    expect(['a', 'c', 'd'].map(id => kindOf(list.find(t => t.id === id)))).toEqual(['task', 'progress', 'someday'])
  })

  it('遅れ: やることは日付、進行中は締め切り。期限の無いものは null', () => {
    expect(lateness(list[0])).toEqual({ late: false, days: 0 })
    expect(lateness(list[1])).toEqual({ late: true, days: 2 })
    expect(lateness(list[2])).toBeNull()                       // 締め切り未定
    expect(lateness(list[3])).toBeNull()                       // いつか
    expect(lateness(T({ id: 'x', progress: 'doing', deadline: '2026-11-10', doneAt: iso('2026-11-13T10:00:00+09:00') }))).toEqual({ late: true, days: 3 })
  })

  it('期間・種類・ジャンル・人・遅れ・文字で絞れる', () => {
    const d = doneItems(list)
    const ids = f => filterDone(d, { now: NOW, ...f }).map(t => t.id)
    expect(ids({ days: 7 })).toEqual(['a', 'c', 'b'])
    expect(ids({ days: 365 })).toEqual(['a', 'c', 'b', 'd'])
    expect(ids({ kind: 'progress' })).toEqual(['c'])
    expect(ids({ category: 'clean' })).toEqual(['b'])
    expect(ids({ category: 'none' })).toEqual(['c', 'd'])
    expect(ids({ who: '田中' })).toEqual(['a', 'c'])
    expect(ids({ late: 'late' })).toEqual(['b'])
    expect(ids({ late: 'ok' })).toEqual(['a', 'c', 'd'])
    expect(ids({ q: '業者' })).toEqual(['c'])                   // メモも探す
  })

  it('「全員」のやることは印を付けた人を並べる', () => {
    expect(whoDid(T({ id: 'z', assign: 'all', doneList: [{ name: '田中' }, { name: '佐藤' }] }))).toBe('田中・佐藤')
  })

  it('済んだ日ごとにまとめる・数のまとめ', () => {
    const d = filterDone(doneItems(list), { now: NOW, days: 30 })
    expect(groupByDay(d).map(g => [g.day, g.items.map(t => t.id)])).toEqual([['2026-11-17', ['a']], ['2026-11-16', ['c']], ['2026-11-12', ['b']]])
    expect(summarize(d)).toEqual({ total: 3, late: 1, byKind: { task: 2, progress: 1, someday: 0 } })
  })

  it('取り寄せた分とまとめるときは、同じ1件は新しい方', () => {
    const m = mergeById([T({ id: 'a', text: '古い', updatedAt: '1' })], [T({ id: 'a', text: '新しい', updatedAt: '2' }), T({ id: 'q' })])
    expect(m.map(t => [t.id, t.text])).toEqual([['a', '新しい'], ['q', 'q']])
  })
})
