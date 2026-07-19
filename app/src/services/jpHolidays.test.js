import { describe, it, expect } from 'vitest'
import { isHoliday, holidayName } from './jpHolidays.js'

describe('jpHolidays（日本の祝日判定）', () => {
  it('固定祝日・元日', () => {
    expect(holidayName('2025-01-01')).toBe('元日')
    expect(isHoliday('2025-01-01')).toBe(true)
  })

  it('ハッピーマンデー（2025年の実際の日付）', () => {
    expect(holidayName('2025-01-13')).toBe('成人の日')     // 1月第2月曜
    expect(holidayName('2025-07-21')).toBe('海の日')       // 7月第3月曜
    expect(holidayName('2025-09-15')).toBe('敬老の日')     // 9月第3月曜
    expect(holidayName('2025-10-13')).toBe('スポーツの日') // 10月第2月曜
  })

  it('春分・秋分（近似式）', () => {
    expect(holidayName('2025-03-20')).toBe('春分の日')
    expect(holidayName('2025-09-23')).toBe('秋分の日')
    expect(holidayName('2026-03-20')).toBe('春分の日')
    expect(holidayName('2026-09-23')).toBe('秋分の日')
  })

  it('振替休日（2025年）', () => {
    expect(holidayName('2025-02-24')).toBe('振替休日')  // 2/23 天皇誕生日(日)の振替
    expect(holidayName('2025-05-06')).toBe('振替休日')  // 5/4 みどりの日(日)の振替
    expect(holidayName('2025-11-24')).toBe('振替休日')  // 11/23 勤労感謝(日)の振替
  })

  it('国民の休日（2026-09-22: 敬老9/21と秋分9/23に挟まれる）', () => {
    expect(holidayName('2026-09-21')).toBe('敬老の日')
    expect(holidayName('2026-09-22')).toBe('国民の休日')
    expect(holidayName('2026-09-23')).toBe('秋分の日')
  })

  it('祝日でない平日は null', () => {
    expect(holidayName('2025-01-06')).toBe(null)
    expect(isHoliday('2025-06-10')).toBe(false)
  })

  it('Date インスタンスでも判定できる', () => {
    expect(isHoliday(new Date(2025, 0, 1))).toBe(true)   // 2025-01-01
    expect(isHoliday(new Date(2025, 5, 10))).toBe(false) // 2025-06-10
  })
})
