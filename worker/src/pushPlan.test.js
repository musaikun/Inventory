import { describe, it, expect } from 'vitest'
import { normalizePrefs, planNotifications, DEFAULT_PREFS } from './pushPlan.js'

// JST の 'YYYY-MM-DD HH:00' を UTC の Date に
const jst = (s) => new Date(new Date(s.replace(' ', 'T') + ':00+09:00').getTime())
const P = (over = {}) => normalizePrefs({ ...DEFAULT_PREFS, ...over })
const keys = r => r.map(x => x.key)

describe('normalizePrefs', () => {
  it('壊れた値は既定へ、選べない日・時間は落とす', () => {
    const p = normalizePrefs({ hour: 25, monthEnd: { on: 'x', days: [1, 2, 7, 7] }, gap: { days: 3 }, orderDeadline: { on: true, mins: [30, 120] } })
    expect(p.hour).toBe(9)
    expect(p.monthEnd).toEqual({ on: true, days: [1, 7] })
    expect(p.gap.days).toBe(35)
    expect(p.orderDeadline).toEqual({ on: true, mins: [120] })
    expect(normalizePrefs(null)).toEqual(normalizePrefs(DEFAULT_PREFS))
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
    expect(planNotifications({ now: jst('2026-10-05 14:00'), prefs: P(), schedules })).toEqual([])   // 既定はオフ
  })
})
