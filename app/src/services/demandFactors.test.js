import { describe, it, expect } from 'vitest'
import {
  isOffDay, consecutiveOffLength, isLongWeekend, customarySpan, seasonBreak, dayFactors,
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

  it('seasonBreak: 夏休み・冬休み・春休み（全国一般デフォルト）', () => {
    expect(seasonBreak('2025-08-15')).toBe('夏休み')
    expect(seasonBreak('2025-07-25')).toBe('夏休み')
    expect(seasonBreak('2025-07-19')).toBe(null)
    expect(seasonBreak('2025-12-26')).toBe('冬休み')
    expect(seasonBreak('2026-01-05')).toBe('冬休み')
    expect(seasonBreak('2025-03-30')).toBe('春休み')
    expect(seasonBreak('2025-04-05')).toBe('春休み')
    expect(seasonBreak('2025-04-06')).toBe(null)
    expect(seasonBreak('2025-06-10')).toBe(null)
  })

  it('dayFactors: 祝前日と種別（平日/休日）', () => {
    // 2025-01-12(日) の翌日 1/13 が成人の日 → 1/12 は祝前日（休日=週末）
    const f = dayFactors('2025-01-12')
    expect(f.holidayEve).toBe(true)
    expect(f.holidayEveKind).toBe('weekend')
    // 2025-02-10(月・平日) の翌日 2/11 が建国記念の日 → 平日の祝前日
    const wd = dayFactors('2025-02-10')
    expect(wd.holidayEve).toBe(true)
    expect(wd.holidayEveKind).toBe('weekday')
    // 成人の日当日は holidayEve=false（自身が祝日）
    expect(dayFactors('2025-01-13').holidayEve).toBe(false)
    expect(dayFactors('2025-01-13').holidayEveKind).toBe(null)
  })

  it('dayFactors: 給料日（既定25日）・月末・5の倍数', () => {
    const f25 = dayFactors('2025-06-25')   // 2025-06-25 は水曜（銀行営業日）
    expect(f25.payday).toBe(true)
    expect(f25.paydayLabel).toBe('25日')
    expect(f25.fifthMultiple).toBe(true)   // 25 は5の倍数
    expect(f25.monthEnd).toBe(false)

    const fEnd = dayFactors('2025-06-30')
    expect(fEnd.monthEnd).toBe(true)
    expect(fEnd.payday).toBe(false)                          // 既定では月末は給料日でない
    expect(dayFactors('2025-06-30', { monthEndPayday: true }).payday).toBe(true)

    expect(dayFactors('2025-06-24').payday).toBe(false)
    expect(dayFactors('2025-06-20').fifthMultiple).toBe(true)
  })

  it('給料日: 銀行休業日は前営業日へ繰り上げ（25日が日曜→前の金曜）', () => {
    // 2025-05-25 は日曜 → 実際の給料日は 5/23(金)
    expect(dayFactors('2025-05-23').payday).toBe(true)
    expect(dayFactors('2025-05-23').paydayLabel).toBe('25日')
    expect(dayFactors('2025-05-25').payday).toBe(false)      // 日曜当日は給料日でない
  })

  it('年金支給日: 偶数月15日（繰り上げ後）・15日は給料日ではない', () => {
    // 2025-06-15(日) → 繰り上げ 6/13(金)。6月は偶数月 → 年金
    expect(dayFactors('2025-06-13').pension).toBe(true)
    expect(dayFactors('2025-06-13').payday).toBe(false)      // 既定は25日のみ → 15日は給料日でない
    expect(dayFactors('2025-06-15').pension).toBe(false)     // 日曜当日は繰り上げ先でない
    expect(dayFactors('2025-07-15').pension).toBe(false)     // 奇数月は年金でない
  })

  it('五十日（ごとおび）: 5の倍数日・休業日は前営業日へ繰り上げ', () => {
    expect(dayFactors('2025-07-10').gotobi).toBe(true)   // 7/10(木) 平日
    expect(dayFactors('2025-07-25').gotobi).toBe(true)   // 7/25(金)
    expect(dayFactors('2025-07-11').gotobi).toBe(false)  // 5の倍数でない
    // 2025-05-25(日) → 繰り上げ 5/23(金)が五十日マーク
    expect(dayFactors('2025-05-23').gotobi).toBe(true)
    expect(dayFactors('2025-05-25').gotobi).toBe(false)
  })

  it('dayFactors: 祝日名と曜日', () => {
    const f = dayFactors('2025-01-01')
    expect(f.holiday).toBe(true)
    expect(f.holidayName).toBe('元日')
    expect(f.weekday).toBe(3)  // 2025-01-01 は水曜
  })

  it('dayFactors: 給料日を任意指定できる（例 15日・平日）', () => {
    expect(dayFactors('2025-07-15', { paydays: [15] }).payday).toBe(true)   // 火曜
    expect(dayFactors('2025-07-25', { paydays: [15] }).payday).toBe(false)
  })
})
