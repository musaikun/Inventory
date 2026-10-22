import { describe, it, expect } from 'vitest'
import { scheduledOn, dayRun, dayChecklist, checklistsOn, checklistHistory, repeatLabel, whenLabel, runKey, weekMarks, currentSlot, upcoming, WHOLE } from './checklistSchedule.js'

const items = [{ id: 'a', text: 'ガスの元栓' }, { id: 'b', text: 'ダスター漂白' }]
const cl = (o = {}) => ({ id: 'c1', name: '退店チェック', items, repeat: 'daily', repeatDays: null, startDate: '2026-10-01', dueTimes: [], ...o })

describe('ルーティンの予定', () => {
  it('繰り返しごとに出す日', () => {
    expect(scheduledOn(cl(), '2026-10-20')).toBe(true)
    expect(scheduledOn(cl(), '2026-09-30')).toBe(false)   // 数え始める日より前
    expect(scheduledOn(cl({ repeat: 'weekly', repeatDays: '1,4' }), '2026-10-19')).toBe(true)   // 月
    expect(scheduledOn(cl({ repeat: 'weekly', repeatDays: '1,4' }), '2026-10-20')).toBe(false)  // 火
    expect(scheduledOn(cl({ repeat: 'monthly', repeatDays: '31' }), '2026-11-30')).toBe(true)   // 無い日は月末
    expect(scheduledOn(cl({ repeat: 'monthly', repeatDays: '31' }), '2026-11-29')).toBe(false)
    expect(scheduledOn(cl({ repeat: 'none', startDate: '2026-10-22' }), '2026-10-22')).toBe(true)
    expect(scheduledOn(cl({ repeat: 'none', startDate: '2026-10-22' }), '2026-10-23')).toBe(false)
    expect(scheduledOn(cl({ paused: true }), '2026-10-20')).toBe(false)
    // 毎月は複数の日・月末も
    expect(scheduledOn(cl({ repeat: 'monthly', repeatDays: '1,15' }), '2026-10-15')).toBe(true)
    expect(scheduledOn(cl({ repeat: 'monthly', repeatDays: 'L' }), '2026-10-31')).toBe(true)
    expect(scheduledOn(cl({ repeat: 'monthly', repeatDays: 'L' }), '2026-10-30')).toBe(false)
  })

  it('記録があれば記録の項目、「今日はなし」も済みに数える', () => {
    const runs = { [runKey('c1', '2026-10-20')]: { items: [items[0]], marks: { a: { s: 'skip' } } } }
    const r = dayRun(cl({ items: [...items, { id: 'z', text: '新しい項目' }] }), runs, '2026-10-20')
    expect(r.total).toBe(1)
    expect(r.complete).toBe(true)
    // お休み中でも、記録のある日は出す
    expect(dayRun(cl({ paused: true }), runs, '2026-10-20')).not.toBeNull()
  })

  it('その日の表は時刻の順（時刻なしは後ろ）', () => {
    const list = [cl({ id: 'x', name: '終日' }), cl({ id: 'y', name: '退店', dueTimes: ['22:00'] }), cl({ id: 'z', name: '開店', dueTimes: ['09:00'] })]
    expect(checklistsOn(list, {}, '2026-10-20').map(r => r.cl.name)).toEqual(['開店', '退店', '終日'])
  })

  it('記録: 済み・未完了・手つかず・今日の途中', () => {
    const runs = {
      [runKey('c1', '2026-10-19')]: { items, marks: { a: { s: 'done', by: '佐藤', at: '2026-10-19T13:00:00Z' }, b: { s: 'done', by: '佐藤', at: '2026-10-19T13:05:00Z' } } },
      [runKey('c1', '2026-10-18')]: { items, marks: { a: { s: 'done', by: '山田', at: '2026-10-18T13:00:00Z' } } },
      [runKey('c1', '2026-10-20')]: { items, marks: { a: { s: 'done', by: '鈴木', at: '2026-10-20T13:00:00Z' } } },
    }
    const h = checklistHistory(cl({ startDate: '2026-10-17' }), runs, { today: '2026-10-20', days: 10 })
    expect(h.map(x => [x.date, x.status])).toEqual([
      ['2026-10-20', 'open'], ['2026-10-19', 'done'], ['2026-10-18', 'partial'], ['2026-10-17', 'none'],
    ])
    expect(h[1].names).toEqual(['佐藤'])
  })

  it('繰り返しの一言', () => {
    expect(repeatLabel(cl())).toBe('毎日')
    expect(repeatLabel(cl({ repeat: 'weekly', repeatDays: '6,0' }))).toBe('土・日')
    expect(repeatLabel(cl({ repeat: 'monthly', repeatDays: '1' }))).toBe('毎月1日')
    expect(repeatLabel(cl({ repeat: 'none', startDate: '2026-12-30' }))).toBe('12/30だけ')
    expect(whenLabel(cl({ dueTimes: ['21:00', '10:00'] }))).toBe('毎日 10:00・21:00')
    expect(repeatLabel(cl({ repeat: 'monthly', repeatDays: '1,15,L' }))).toBe('毎月1日・15日・月末')
  })

  it('項目なしのルーティン: 全体を1つの印で済ませる', () => {
    const r = cl({ id: 'r1', name: 'ゴミ出し', items: [] })
    expect(dayRun(r, {}, '2026-10-20').items).toEqual([{ id: WHOLE, text: 'ゴミ出し' }])
    const runs = { [runKey('r1', '2026-10-20')]: { items: [], marks: { [WHOLE]: { s: 'done' } } } }
    expect(dayChecklist(r, runs, '2026-10-20').complete).toBe(true)
  })

  it('これから: 今日は出ない毎週・毎月のものを近い順に', () => {
    const list = [cl({ id: 'w', name: '大掃除', repeat: 'weekly', repeatDays: '6' }), cl({ id: 'm', name: '発注書', repeat: 'monthly', repeatDays: '1' }), cl({ id: 'd', name: '毎日' })]
    expect(upcoming(list, '2026-10-20').map(x => [x.cl.name, x.date])).toEqual([['大掃除', '2026-10-24'], ['発注書', '2026-11-01']])
  })

  it('1日に何回も: 回ごとの進み具合・今やる回・この7日', () => {
    const c = cl({ dueTimes: ['10:00', '15:00', '21:00'], startDate: '2026-10-10' })
    const runs = {
      [runKey('c1', '2026-10-20', '10:00')]: { items, marks: { a: { s: 'done' }, b: { s: 'done' } } },
      [runKey('c1', '2026-10-19', '10:00')]: { items, marks: { a: { s: 'done' }, b: { s: 'done' } } },
      [runKey('c1', '2026-10-19', '15:00')]: { items, marks: { a: { s: 'done' }, b: { s: 'skip' } } },
      [runKey('c1', '2026-10-19', '21:00')]: { items, marks: { a: { s: 'done' }, b: { s: 'done' } } },
    }
    const d = dayChecklist(c, runs, '2026-10-20')
    expect([d.doneSlots, d.totalSlots, d.complete]).toEqual([1, 3, false])
    expect(currentSlot(d, '16:30').slot).toBe('15:00')
    expect(currentSlot(d, '09:00').slot).toBe('15:00')
    expect(dayChecklist(c, runs, '2026-10-19').complete).toBe(true)
    expect(weekMarks(c, runs, '2026-10-20').map(w => w.mark)).toEqual(['n', 'n', 'n', 'n', 'n', 'y', 't'])
    // 時刻を変えても、前の時刻で✓した回は記録から出る
    const moved = cl({ dueTimes: ['11:00'], startDate: '2026-10-10' })
    expect(dayChecklist(moved, runs, '2026-10-19').slots.map(x => x.slot)).toEqual(['10:00', '11:00', '15:00', '21:00'])
    expect(dayRun(c, runs, '2026-10-20', '09:00')).toBeNull()
  })
})
