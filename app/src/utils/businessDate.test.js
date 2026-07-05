import { describe, it, expect } from 'vitest'
import { businessDate, monthKeyOf, designateMonthEnds, monthEndLabelFor } from './businessDate.js'

// ローカル時刻で構築（TZ非依存にするため new Date(y, mIndex, d, h, m) を使う）
const at = (y, mIndex, d, h = 12, min = 0) => new Date(y, mIndex, d, h, min)

describe('businessDate', () => {
  it('切替時刻より後はその日', () => {
    expect(businessDate(at(2026, 6, 1, 11), 5)).toBe('2026-07-01')
  })
  it('切替時刻より前（深夜またぎ）は前日', () => {
    // 7/1 3:00 に登録 → 営業日は 6/30
    expect(businessDate(at(2026, 6, 1, 3), 5)).toBe('2026-06-30')
  })
  it('月をまたぐ深夜またぎ', () => {
    // 8/1 4:59 → 7/31
    expect(businessDate(at(2026, 7, 1, 4, 59), 5)).toBe('2026-07-31')
  })
  it('切替時刻ちょうどはその日', () => {
    expect(businessDate(at(2026, 6, 1, 5, 0), 5)).toBe('2026-07-01')
  })
  it('不正値は null', () => {
    expect(businessDate('not-a-date')).toBe(null)
  })
})

describe('monthKeyOf', () => {
  it('YYYY-MM を返す', () => {
    expect(monthKeyOf('2026-07-02')).toBe('2026-07')
  })
})

describe('designateMonthEnds', () => {
  it('その月の最後のカウントを月末在庫に自動指定', () => {
    const snaps = [
      { date: '2026-07-10', savedAt: at(2026, 6, 10, 12), sessionId: 'a' },
      { date: '2026-07-28', savedAt: at(2026, 6, 28, 12), sessionId: 'b' },
      { date: '2026-07-15', savedAt: at(2026, 6, 15, 12), sessionId: 'c' },
    ]
    const d = designateMonthEnds(snaps, {}, 5)
    expect(d['2026-07'].date).toBe('2026-07-28')
    expect(d['2026-07'].manual).toBe(false)
  })

  it('深夜またぎの翌月頭は前月の月末在庫になる', () => {
    const snaps = [
      { date: '2026-06-30', savedAt: at(2026, 5, 30, 20), sessionId: 'a' },
      // 7/1 の 2:00 登録 → 営業日 6/30 → 6月扱い、かつ 6/30 より後
      { date: '2026-07-01', savedAt: at(2026, 6, 1, 2), sessionId: 'b' },
    ]
    const d = designateMonthEnds(snaps, {}, 5)
    expect(d['2026-06'].date).toBe('2026-07-01')
    expect(d['2026-07']).toBeUndefined()
  })

  it('手動上書きが優先される', () => {
    const snaps = [
      { date: '2026-07-02', savedAt: at(2026, 6, 2, 12), sessionId: 'a' },
      { date: '2026-07-28', savedAt: at(2026, 6, 28, 12), sessionId: 'b' },
    ]
    const d = designateMonthEnds(snaps, { '2026-07': '2026-07-02' }, 5)
    expect(d['2026-07'].date).toBe('2026-07-02')
    expect(d['2026-07'].manual).toBe(true)
  })
})

describe('monthEndLabelFor', () => {
  it('採用中の月キーを返す', () => {
    const designation = { '2026-07': { date: '2026-07-28' } }
    expect(monthEndLabelFor('2026-07-28', designation)).toBe('2026-07')
    expect(monthEndLabelFor('2026-07-10', designation)).toBe(null)
  })
})
