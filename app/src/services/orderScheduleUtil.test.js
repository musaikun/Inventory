import { describe, it, expect } from 'vitest'
import {
  weekdayLabel, hasSchedule, scheduleSummary, isOrderDay,
  nextOrderDayLabel, deadlineStatus, todayOrderContext,
  MAX_ORDER_SCHEDULES, normalizeSchedules, scheduleName, hasAnySchedule,
  allOrderDays, orderIntervalDays, todaySchedules, nextScheduleOccurrence,
  schedulesTodayContext, scheduleRows,
} from './orderScheduleUtil.js'

// 2026-07-21 は火曜日
const TUE = new Date(2026, 6, 21, 10, 0, 0)   // 火 10:00
const WED = new Date(2026, 6, 22, 10, 0, 0)   // 水 10:00
const sched = { days: [2, 5], deadline: '15:00' }  // 火・金 / 締切15:00

describe('orderScheduleUtil', () => {
  it('weekdayLabel', () => {
    expect(weekdayLabel(0)).toBe('日')
    expect(weekdayLabel(2)).toBe('火')
    expect(weekdayLabel(9)).toBe('')
  })

  it('hasSchedule は曜日が1つ以上で true', () => {
    expect(hasSchedule(sched)).toBe(true)
    expect(hasSchedule({ days: [], deadline: '15:00' })).toBe(false)
    expect(hasSchedule(null)).toBe(false)
  })

  it('scheduleSummary は曜日を昇順で・締切付きで要約', () => {
    expect(scheduleSummary(sched)).toBe('火・金 / 締切15:00')
    expect(scheduleSummary({ days: [5, 2] })).toBe('火・金')
    expect(scheduleSummary({ days: [] })).toBe('')
  })

  it('isOrderDay', () => {
    expect(isOrderDay(sched, TUE)).toBe(true)   // 火＝発注日
    expect(isOrderDay(sched, WED)).toBe(false)  // 水＝発注日でない
  })

  it('nextOrderDayLabel は翌日以降で最も近い発注曜日（当日は含めない）', () => {
    expect(nextOrderDayLabel(sched, TUE)).toBe('金')  // 火の次は金
    expect(nextOrderDayLabel(sched, WED)).toBe('金')  // 水の次は金
  })

  it('deadlineStatus: 締切前は残り時間、過ぎたら超過', () => {
    const before = deadlineStatus(sched, new Date(2026, 6, 21, 13, 0, 0))  // 13:00 → 締切15:00まで2時間
    expect(before.past).toBe(false)
    expect(before.label).toContain('あと2時間')
    const after = deadlineStatus(sched, new Date(2026, 6, 21, 16, 0, 0))   // 16:00 → 超過
    expect(after.past).toBe(true)
    expect(after.label).toContain('超過')
  })

  it('deadlineStatus: 締切未設定は has=false', () => {
    expect(deadlineStatus({ days: [2] }, TUE).has).toBe(false)
  })

  it('todayOrderContext: 発注日と非発注日で文言が変わる', () => {
    expect(todayOrderContext(sched, TUE)).toBe('火曜の発注（次は金曜）')
    expect(todayOrderContext(sched, WED)).toBe('発注日ではありません（次の発注は金曜）')
    expect(todayOrderContext({ days: [] }, TUE)).toBe('')
  })
})

// ── 複数スケジュール ────────────────────────────────────────────────────────
const FRI = new Date(2026, 6, 24, 10, 0, 0)  // 金 10:00

const multi = () => normalizeSchedules([
  { id: 's1', name: '青果', days: [2, 5], deadline: '15:00' },  // 火・金
  { id: 's2', name: '肉',   days: [1],    deadline: '' },       // 月
])

describe('orderScheduleUtil（複数スケジュール）', () => {
  it('normalizeSchedules: days は昇順・重複除去、name は前後空白を落とす', () => {
    const [s] = normalizeSchedules([{ name: '  青果 ', days: [5, 2, 2, 9, -1, 'x'], deadline: '15:00' }])
    expect(s.days).toEqual([2, 5])
    expect(s.name).toBe('青果')
    expect(s.deadline).toBe('15:00')
    expect(typeof s.id).toBe('string')
  })

  it('normalizeSchedules: 曜日が空の行は捨て、5件で打ち切る', () => {
    const list = normalizeSchedules([
      { name: 'A', days: [1] }, { name: '空', days: [] }, { name: 'B', days: [2] },
      { name: 'C', days: [3] }, { name: 'D', days: [4] }, { name: 'E', days: [5] },
      { name: 'F', days: [6] },
    ])
    expect(list.map(s => s.name)).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(list).toHaveLength(MAX_ORDER_SCHEDULES)
  })

  it('normalizeSchedules: 旧・単一形式は1件へ移行する', () => {
    const list = normalizeSchedules(null, { days: [3, 6], deadline: '10:30' })
    expect(list).toHaveLength(1)
    expect(list[0].days).toEqual([3, 6])
    expect(list[0].name).toBe('')
  })

  it('normalizeSchedules: 配列があれば legacy は無視する', () => {
    const list = normalizeSchedules([{ name: '新', days: [1] }], { days: [3], deadline: '' })
    expect(list.map(s => s.name)).toEqual(['新'])
  })

  it('scheduleName: 未入力は並び順から発注1・発注2', () => {
    expect(scheduleName({ name: '青果' }, 0)).toBe('青果')
    expect(scheduleName({ name: '' }, 0)).toBe('発注1')
    expect(scheduleName(null, 2)).toBe('発注3')
  })

  it('hasAnySchedule は曜日を持つ行が1つでもあれば true', () => {
    expect(hasAnySchedule(multi())).toBe(true)
    expect(hasAnySchedule([])).toBe(false)
    expect(hasAnySchedule(null)).toBe(false)
  })

  it('allOrderDays は全スケジュールの和集合（昇順・重複なし）', () => {
    expect(allOrderDays(multi())).toEqual([1, 2, 5])
    expect(allOrderDays([])).toEqual([])
  })

  it('orderIntervalDays は和集合の最大ギャップ、1件以下は7日', () => {
    // 月(1)・火(2)・金(5) → 2→5 が3日、5→1 が3日、1→2 が1日 ⇒ 最大3
    expect(orderIntervalDays(multi())).toBe(3)
    expect(orderIntervalDays([{ days: [1] }])).toBe(7)
    expect(orderIntervalDays([])).toBe(7)
  })

  it('todaySchedules は今日が発注日のものだけ返す', () => {
    expect(todaySchedules(multi(), TUE).map(s => s.name)).toEqual(['青果'])
    expect(todaySchedules(multi(), WED)).toEqual([])
  })

  it('nextScheduleOccurrence は翌日以降の最も近い発注（当日は含めない）', () => {
    expect(nextScheduleOccurrence(multi(), TUE)).toEqual({ dayLabel: '金', names: ['青果'] })
    expect(nextScheduleOccurrence(multi(), FRI)).toEqual({ dayLabel: '月', names: ['肉'] })
    expect(nextScheduleOccurrence([], TUE)).toBe(null)
  })

  it('nextScheduleOccurrence は同じ曜日の複数スケジュールをまとめる', () => {
    const list = normalizeSchedules([{ name: 'A', days: [5] }, { name: 'B', days: [5] }])
    expect(nextScheduleOccurrence(list, TUE)).toEqual({ dayLabel: '金', names: ['A', 'B'] })
  })

  it('schedulesTodayContext は発注日/非発注日で文言が変わる', () => {
    expect(schedulesTodayContext(multi(), TUE)).toBe('今日は「青果」の発注日（次は金曜の「青果」）')
    expect(schedulesTodayContext(multi(), WED)).toBe('今日は発注日ではありません（次は金曜の「青果」）')
    expect(schedulesTodayContext([], TUE)).toBe('')
  })

  it('scheduleRows は名前・要約・今日か・締切を返す', () => {
    const rows = scheduleRows(multi(), TUE)
    expect(rows[0]).toMatchObject({ name: '青果', summary: '火・金 / 締切15:00', today: true })
    expect(rows[0].deadline.has).toBe(true)
    expect(rows[1]).toMatchObject({ name: '肉', summary: '月', today: false })
    expect(rows[1].deadline.has).toBe(false)
  })
})
