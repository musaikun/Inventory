import { describe, it, expect } from 'vitest'
import {
  weekdayLabel, hasSchedule, scheduleSummary, isOrderDay,
  nextOrderDayLabel, deadlineStatus, todayOrderContext,
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
