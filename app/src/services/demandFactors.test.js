import { describe, it, expect } from 'vitest'
import {
  isOffDay, consecutiveOffLength, isLongWeekend, customarySpan, dayFactors,
} from './demandFactors.js'

describe('demandFactors（日ごとの需要要因）', () => {
  it('isOffDay: 週末・祝日は休業日', () => {
    expect(isOffDay('2025-01-01')).toBe(true)  // 元日
    expect(isOffDay('2025-01-04')).toBe(true)  // 土
    expect(isOffDay('2025-01-05')).toBe(true)  // 日
    expect(isOffDay('2025-01-06')).toBe(false) // 月・平日
  })

  it('consecutiveOffLength / isLongWeekend', () => {
    // 2025-05-03(土)〜05-06(火・振替) の4連休
    expect(consecutiveOffLength('2025-05-04')).toBe(4)
    expect(isLongWeekend('2025-05-05')).toBe(true)
    // 平日は0
    expect(consecutiveOffLength('2025-05-07')).toBe(0)
    expect(isLongWeekend('2025-01-06')).toBe(false)
  })

  it('customarySpan: お盆・年末年始', () => {
    expect(customarySpan('2025-08-14')).toBe('お盆')
    expect(customarySpan('2025-12-31')).toBe('年末年始')
    expect(customarySpan('2026-01-02')).toBe('年末年始')
    expect(customarySpan('2025-06-10')).toBe(null)
  })

  it('dayFactors: 祝前日', () => {
    // 2025-01-12(日) の翌日 1/13 が成人の日 → 1/12 は祝前日
    const f = dayFactors('2025-01-12')
    expect(f.holidayEve).toBe(true)
    // 成人の日当日は holidayEve=false（自身が祝日）
    expect(dayFactors('2025-01-13').holidayEve).toBe(false)
  })

  it('dayFactors: 給料日（既定25日）・月末・5の倍数', () => {
    const f25 = dayFactors('2025-06-25')
    expect(f25.payday).toBe(true)
    expect(f25.fifthMultiple).toBe(true)   // 25 は5の倍数
    expect(f25.monthEnd).toBe(false)

    const fEnd = dayFactors('2025-06-30')
    expect(fEnd.monthEnd).toBe(true)
    expect(fEnd.payday).toBe(false)                          // 既定では月末は給料日でない
    expect(dayFactors('2025-06-30', { monthEndPayday: true }).payday).toBe(true)

    expect(dayFactors('2025-06-24').payday).toBe(false)
    expect(dayFactors('2025-06-20').fifthMultiple).toBe(true)
  })

  it('dayFactors: 祝日名と曜日', () => {
    const f = dayFactors('2025-01-01')
    expect(f.holiday).toBe(true)
    expect(f.holidayName).toBe('元日')
    expect(f.weekday).toBe(3)  // 2025-01-01 は水曜
  })

  it('dayFactors: 給料日を任意指定できる（例 15日）', () => {
    expect(dayFactors('2025-06-15', { paydays: [15] }).payday).toBe(true)
    expect(dayFactors('2025-06-25', { paydays: [15] }).payday).toBe(false)
  })
})
