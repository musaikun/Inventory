import { describe, it, expect } from 'vitest'
import { median, weekdayOrderHistory } from './orderItemHistory.js'

// 火曜日の日付（2025年）: 6/3, 6/10, 6/17, 6/24, 7/1, 7/8 …
const orders = [
  { date: '2025-06-03', lines: [{ item: '唐揚げ', qty: 2 }] },
  { date: '2025-06-10', lines: [{ item: '唐揚げ', qty: 3 }] },
  { date: '2025-06-17', lines: [{ item: '唐揚げ', qty: 2 }] },
  { date: '2025-06-24', lines: [{ item: '唐揚げ', qty: 4 }] },
  { date: '2025-07-01', lines: [{ item: '唐揚げ', qty: 3 }, { item: 'ポテト', qty: 5 }] },
  { date: '2025-07-08', lines: [{ item: '唐揚げ', qty: 3 }] },  // 直近の火曜
  { date: '2025-07-09', lines: [{ item: '唐揚げ', qty: 9 }] },  // 水曜（同曜でない→除外）
]

describe('median', () => {
  it('奇数・偶数・空', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBe(null)
  })
})

describe('weekdayOrderHistory（品目×同曜の発注履歴）', () => {
  const TUE = 2
  it('同曜だけを拾い、前週/先月/中央値/推移を返す', () => {
    // before=2025-07-15（火）: 7/8までが履歴。水曜7/9は除外。
    const h = weekdayOrderHistory(orders, '唐揚げ', TUE, { window: 6, before: '2025-07-15' })
    expect(h.count).toBe(6)                         // 火曜6回
    expect(h.lastWeek.qty).toBe(3)                  // 直近火曜 7/8 = 3
    expect(h.lastWeek.date).toBe('2025-07-08')
    expect(h.lastMonth.qty).toBe(2)                 // 4回前 6/17 = 2
    expect(h.values).toEqual([2, 3, 2, 4, 3, 3])    // 古い→新しい
    expect(h.median).toBe(3)                        // 中央値
  })

  it('before で当日以降を除外（当日の入力を混ぜない）', () => {
    // before=2025-07-08 → 7/8自身も除外され、直近は7/1
    const h = weekdayOrderHistory(orders, '唐揚げ', TUE, { before: '2025-07-08' })
    expect(h.lastWeek.date).toBe('2025-07-01')
  })

  it('同一日に複数発注（仕入先違い）は合算', () => {
    const multi = [
      { date: '2025-07-08', lines: [{ item: '唐揚げ', qty: 2 }] },
      { date: '2025-07-08', lines: [{ item: '唐揚げ', qty: 1 }] },
    ]
    const h = weekdayOrderHistory(multi, '唐揚げ', 2, { before: '2025-07-15' })
    expect(h.lastWeek.qty).toBe(3)
  })

  it('window で直近サンプルを絞る', () => {
    const h = weekdayOrderHistory(orders, '唐揚げ', 2, { window: 2, before: '2025-07-15' })
    expect(h.values).toEqual([3, 3])   // 直近2件（7/1, 7/8）
  })

  it('該当なしは空', () => {
    const h = weekdayOrderHistory(orders, '存在しない', 2, {})
    expect(h.count).toBe(0)
    expect(h.lastWeek).toBe(null)
    expect(h.median).toBe(null)
  })
})
