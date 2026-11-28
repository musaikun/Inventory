// ホームの背景の月ごとの色とモチーフ（User決定 2026-11-28）
import { describe, it, expect } from 'vitest'
import { seasonMonth, ringColors, seasonMotifs, MONTHS, DEFAULT_RING, mixColor } from './seasonBg.js'

describe('seasonBg', () => {
  it('月は日本の暦。南半球は6か月ずらし、季節の無い地域（緯度±15°）は出さない', () => {
    expect(seasonMonth('2026-04-08')).toBe(4)
    expect(seasonMonth('2026-04-08', 35.6)).toBe(4)          // 東京
    expect(seasonMonth('2026-04-08', -33.8)).toBe(10)        // シドニー: 4月は秋
    expect(seasonMonth('2026-12-20', -33.8)).toBe(6)
    expect(seasonMonth('2026-04-08', 1.3)).toBeNull()        // シンガポール
    expect(seasonMotifs('2026-04-08', 1.3)).toEqual([])
    expect(ringColors('2026-04-08', 1.3)).toEqual(DEFAULT_RING)
  })

  it('1月は初日の出（太陽と後ろの光と雲）、12か月すべてにモチーフがある', () => {
    expect(MONTHS).toHaveLength(12)
    expect(MONTHS[0].name).toBe('初日の出')
    const jan = seasonMotifs('2026-01-05')
    expect(jan.map(m => m.cls)).toEqual(['k-halo', 'k-glow', 'k-drift', 'k-drift', 'k-drift'])
    for (let m = 1; m <= 12; m++) expect(seasonMotifs(`2026-${String(m).padStart(2, '0')}-10`).length).toBeGreaterThan(0)
  })

  it('同じ月のモチーフは1つずつ速さ・遅れが違う（揃って動かない）', () => {
    const apr = seasonMotifs('2026-04-08')
    expect(new Set(apr.map(m => `${m.style.animationDuration}/${m.style.animationDelay}`)).size).toBe(apr.length)
  })

  it('月の終わりの3日は次の月の色へ少しずつ寄せる', () => {
    expect(ringColors('2026-04-20')).toEqual(MONTHS[3].ring)
    const end = ringColors('2026-04-30')
    expect(end).not.toEqual(MONTHS[3].ring)
    expect(end[0]).toBe(mixColor(MONTHS[3].ring[0], MONTHS[4].ring[0], 0.75))
    expect(ringColors('2026-12-31')[0]).toBe(mixColor(MONTHS[11].ring[0], MONTHS[0].ring[0], 0.75))   // 12月 → 1月
  })
})
