import { describe, it, expect } from 'vitest'
import { normalizePrefs, planNotifications, usualHour } from './pushPlan.js'

// JST の 'YYYY-MM-DD HH:00' を UTC の Date に
const jst = (s) => new Date(new Date(s.replace(' ', 'T') + ':00+09:00').getTime())
const P = (over = {}) => ({ ...normalizePrefs(null), ...over })   // 計画の関数は形さえ合えば何でも受け取る
const keys = r => r.map(x => x.key)

describe('normalizePrefs', () => {
  it('ONにしたら全部届く。端末から来た設定は読まない。時刻だけ人ごと（User決定 2026-10-16）', () => {
    const p = normalizePrefs({ hour: 20, monthEnd: { on: false }, orderDeadline: { on: false } })
    expect(p.hour).toBe(9)
    expect(p.monthEnd).toEqual({ on: true, days: [0, 1] })
    expect(p.gap).toEqual({ on: true, days: 35 })
    expect(p.orderDeadline).toEqual({ on: true, mins: [60] })
    expect([p.stale.on, p.taskDay.on, p.taskAdded.on, p.taskAssigned.on]).toEqual([true, true, true, true])
    expect(normalizePrefs(null, 7).hour).toBe(7)
    expect(normalizePrefs(null, 30).hour).toBe(9)
  })
})

describe('usualHour（いつも最初に開く時刻）', () => {
  it('日ごとの最初に開いた時刻の真ん中の「時」。3日分に満たなければ null', () => {
    // JST 9:40 / 9:10（同じ日の 15:00 は数えない）/ 10:20
    const at = ['2026-10-01T00:40:00Z', '2026-10-02T00:10:00Z', '2026-10-02T06:00:00Z', '2026-10-03T01:20:00Z']
    expect(usualHour(at)).toBe(9)
    expect(usualHour(at.slice(0, 3))).toBeNull()
    // JST の日付で分ける（UTC 23:30 は JST 翌日 8:30）
    expect(usualHour(['2026-10-01T23:30:00Z', '2026-10-02T23:30:00Z', '2026-10-03T23:30:00Z'])).toBe(8)
    expect(usualHour([])).toBeNull()
  })
})

describe('planNotifications', () => {
  it('月末: 選んだ時刻に、選んだ日数前だけ', () => {
    expect(keys(planNotifications({ now: jst('2026-10-30 09:00'), prefs: P() }))).toEqual(['me:2026-10:1'])
    expect(planNotifications({ now: jst('2026-10-30 09:00'), prefs: P() })[0].payload.body).toContain('明日は月末です。10/31（土）')
    expect(keys(planNotifications({ now: jst('2026-10-31 09:00'), prefs: P() }))).toEqual(['me:2026-10:0'])
    expect(planNotifications({ now: jst('2026-10-31 10:00'), prefs: P() })).toEqual([])          // 時刻が違う
    expect(planNotifications({ now: jst('2026-10-28 09:00'), prefs: P() })).toEqual([])          // 3日前は選んでいない
    expect(keys(planNotifications({ now: jst('2026-10-28 09:00'), prefs: P({ monthEnd: { on: true, days: [3] } }) }))).toEqual(['me:2026-10:3'])
    expect(planNotifications({ now: jst('2026-10-31 09:00'), prefs: P({ monthEnd: { on: false, days: [0] } }) })).toEqual([])
  })

  it('しばらく棚卸していない: 日数を過ぎたら、前回の棚卸ごとに1つの印', () => {
    const r = planNotifications({ now: jst('2026-10-06 09:00'), prefs: P(), lastCompletedAt: '2026-08-31 15:30:00' })
    expect(keys(r)).toEqual(['gap:2026-09-01'])   // UTC 15:30 は JST の翌日
    expect(r[0].payload.body).toContain('9/1）から35日')
    expect(planNotifications({ now: jst('2026-10-05 09:00'), prefs: P(), lastCompletedAt: '2026-08-31T15:30:00Z' })).toEqual([])
  })

  it('途中のままの棚卸とやることの日', () => {
    const r = planNotifications({
      now: jst('2026-10-05 09:00'), prefs: P(), staleSessionIds: ['s1'],
      openTasks: [{ date: '2026-10-05', text: '霜取り' }, { date: '2026-10-06', text: '発注先に電話' }, { date: '2026-10-06', text: '掃除' }, { date: '2026-10-08', text: '3日後' }],
    })
    expect(keys(r)).toEqual(['stale:s1', 'task:2026-10-05:0', 'task:2026-10-06:1'])
    expect(r[1].payload.body).toBe('今日のやること：霜取り')
    expect(r[2].payload.body).toBe('明日のやること：発注先に電話 ほか1件')
  })

  it('発注の締切: 曜日が合う日の、締切の○時間前を含む1時間に送る（時刻の設定は関係ない）', () => {
    const prefs = P({ hour: 20, orderDeadline: { on: true, mins: [60, 180] } })
    const schedules = [{ id: 'a', name: '青果', days: [1], deadline: '15:30' }]   // 2026-10-05 は月曜
    expect(keys(planNotifications({ now: jst('2026-10-05 14:00'), prefs, schedules }))).toEqual(['ord:2026-10-05:a:60'])
    expect(planNotifications({ now: jst('2026-10-05 14:00'), prefs, schedules })[0].payload.body).toBe('「青果」の発注の締切は 15:30 です（あと1時間30分）🧾')
    expect(keys(planNotifications({ now: jst('2026-10-05 12:00'), prefs, schedules }))).toEqual(['ord:2026-10-05:a:180'])
    expect(planNotifications({ now: jst('2026-10-06 14:00'), prefs, schedules })).toEqual([])   // 火曜
    expect(keys(planNotifications({ now: jst('2026-10-05 14:00'), prefs: P(), schedules }))).toEqual(['ord:2026-10-05:a:60'])   // 既定でON・1時間前
  })
})
