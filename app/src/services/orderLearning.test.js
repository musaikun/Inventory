import { describe, it, expect } from 'vitest'
import { postOrderStock, weekdayOf, samplesFor, parLevel, DEFAULT_WINDOW } from './orderLearning.js'
import { median } from './estimators/median.js'
import { parseLot, effectiveLot } from './lot.js'

describe('lot（入数）', () => {
  it('文字列から数値を抽出', () => {
    expect(parseLot('24本')).toBe(24)
    expect(parseLot('1.5kg')).toBe(1.5)
    expect(parseLot(24)).toBe(24)
  })
  it('抽出できないものは null、effectiveLot は 1', () => {
    expect(parseLot('本')).toBeNull()
    expect(parseLot('')).toBeNull()
    expect(parseLot(null)).toBeNull()
    expect(parseLot(0)).toBeNull()
    expect(effectiveLot('本')).toBe(1)
    expect(effectiveLot(null)).toBe(1)
    expect(effectiveLot('24本')).toBe(24)
  })
})

describe('median（推定器）', () => {
  it('奇数件は中央、偶数件は平均', () => {
    expect(median([5, 5, 6, 5, 5])).toBe(5)
    expect(median([8, 7, 8, 8, 9])).toBe(8)
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })
  it('空はnull、外れ値に強い', () => {
    expect(median([])).toBeNull()
    expect(median([5, 5, 5, 5, 999])).toBe(5)
  })
})

describe('postOrderStock（発注後在庫）', () => {
  // 発注後在庫 = 現在在庫 + 発注数量 × LOT （在庫+発注数量 ではない）
  it('LOT を掛ける', () => {
    expect(postOrderStock(8, 1, 12)).toBe(20)
    expect(postOrderStock(8, 1, '12本')).toBe(20)
    expect(postOrderStock(5, 2, 6)).toBe(17)
  })
  it('入数不明は LOT=1', () => {
    expect(postOrderStock(8, 3, '本')).toBe(11)
  })
  it('数値でない入力は null', () => {
    expect(postOrderStock('x', 1, 12)).toBeNull()
    expect(postOrderStock(8, null, 12)).toBeNull()
  })
})

describe('weekdayOf', () => {
  it('YYYY-MM-DD から曜日(0=日..6=土)', () => {
    expect(weekdayOf('2026-07-06')).toBe(1) // 月
    expect(weekdayOf('2026-07-11')).toBe(6) // 土
    expect(weekdayOf('2026-07-12')).toBe(0) // 日
    expect(weekdayOf('')).toBeNull()
  })
})

describe('samplesFor / parLevel（曜日別・ローリング窓）', () => {
  // 全て月曜。postStock 5,5,6,5,5 → median 5
  const mondays = ['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29']
  const monEvents = mondays.map((date, i) => ({ item: 'トマト', date, postStock: [5, 5, 6, 5, 5][i] }))
  // 火曜 8,7,8,8,9 → median 8
  const tuesdays = ['2026-06-02', '2026-06-09', '2026-06-16', '2026-06-23', '2026-06-30']
  const tueEvents = tuesdays.map((date, i) => ({ item: 'トマト', date, postStock: [8, 7, 8, 8, 9][i] }))
  const events = [...monEvents, ...tueEvents]

  it('曜日ごとに独立して適正在庫を出す', () => {
    expect(parLevel(events, 'トマト', 1)).toBe(5) // 月
    expect(parLevel(events, 'トマト', 2)).toBe(8) // 火
  })

  it('サンプルが無ければ null（コールドスタート）', () => {
    expect(parLevel(events, 'トマト', 3)).toBeNull()
    expect(parLevel(events, 'レタス', 1)).toBeNull()
  })

  it('excluded は学習から除外', () => {
    const withOutlier = [...monEvents, { item: 'トマト', date: '2026-07-06', postStock: 999, excluded: true }]
    expect(parLevel(withOutlier, 'トマト', 1)).toBe(5)
  })

  it('直近 window 件に絞る（古いものは落とす）', () => {
    // 20週分の月曜、古い方=0、新しい方=10。直近12件だけ見れば全て10付近
    const many = []
    for (let w = 0; w < 20; w++) {
      const d = new Date(Date.UTC(2026, 0, 5 + w * 7, 12)) // 月曜始まり
      const date = d.toISOString().slice(0, 10)
      many.push({ item: 'A', date, postStock: w < 8 ? 0 : 10 })
    }
    // 直近12件: w=8..19 は全て10 → median 10
    expect(parLevel(many, 'A', 1, { window: DEFAULT_WINDOW })).toBe(10)
    // window を全件にすると 0 が混ざる
    expect(parLevel(many, 'A', 1, { window: 100 })).toBe(10) // 8件が0,12件が10 → median 10 (境目)
  })

  it('samplesFor は古い順に返す', () => {
    const s = samplesFor(monEvents, 'トマト', 1)
    expect(s).toEqual([5, 5, 6, 5, 5])
  })
})
