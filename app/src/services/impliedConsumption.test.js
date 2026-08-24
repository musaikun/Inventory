import { describe, it, expect } from 'vitest'
import { stockObservations, consumptionIntervals, avgDailyConsumption } from './impliedConsumption.js'

const snap = (date, items) => ({ date, items })
const order = (date, lines) => ({ date, lines })
const move = (date, type, lines) => ({ date, type, lines })
const _daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)

describe('stockObservations（在庫観測点）', () => {
  it('棚卸と発注時在庫を日付昇順で集める（qty/stock 無しは除外）', () => {
    const snaps = [snap('2026-07-10', [{ item: 'A', qty: 8 }]), snap('2026-07-01', [{ item: 'A', qty: null }])]
    const orders = [order('2026-07-05', [{ item: 'A', stock: 5 }]), order('2026-07-07', [{ item: 'A', stock: null }])]
    const obs = stockObservations('A', snaps, orders)
    expect(obs).toEqual([
      { date: '2026-07-05', qty: 5, src: 'order' },
      { date: '2026-07-10', qty: 8, src: 'stocktake' },
    ])
  })
})

describe('consumptionIntervals（消費の逆算）', () => {
  it('出庫記録が無くても 前在庫＋入庫−今在庫 で消費を出す', () => {
    // 7/1 在庫10 → 7/5 入庫6 → 7/8 在庫12 : 消費 = 10 + 6 − 12 = 4
    const snaps = [snap('2026-07-01', [{ item: 'A', qty: 10 }]), snap('2026-07-08', [{ item: 'A', qty: 12 }])]
    const moves = [move('2026-07-05', 'in', [{ item: 'A', qty: 6 }])]
    const iv = consumptionIntervals('A', { snapshots: snaps, movements: moves })
    expect(iv).toHaveLength(1)
    expect(iv[0]).toMatchObject({ fromDate: '2026-07-01', toDate: '2026-07-08', inflow: 6, outflow: 0, consumed: 4, days: 7 })
    expect(iv[0].perDay).toBeCloseTo(4 / 7, 3)
    expect(iv[0].flagged).toBe(false)
  })

  it('記録済み出庫があれば差し引く', () => {
    const snaps = [snap('2026-07-01', [{ item: 'A', qty: 10 }]), snap('2026-07-03', [{ item: 'A', qty: 5 }])]
    const moves = [move('2026-07-02', 'out', [{ item: 'A', qty: 2 }])]
    // 消費 = 10 + 0 − 2 − 5 = 3
    expect(consumptionIntervals('A', { snapshots: snaps, movements: moves })[0].consumed).toBe(3)
  })

  it('発注時在庫も観測点として使い、複数区間を出す', () => {
    const snaps = [snap('2026-07-01', [{ item: 'A', qty: 10 }])]
    const orders = [order('2026-07-04', [{ item: 'A', stock: 4 }]), order('2026-07-08', [{ item: 'A', stock: 1 }])]
    const iv = consumptionIntervals('A', { snapshots: snaps, orders })
    expect(iv.map(x => x.consumed)).toEqual([6, 3])   // 10→4=6, 4→1=3
  })

  it('マイナス消費（入庫漏れ等）は flagged=true', () => {
    const snaps = [snap('2026-07-01', [{ item: 'A', qty: 3 }]), snap('2026-07-02', [{ item: 'A', qty: 8 }])]
    const iv = consumptionIntervals('A', { snapshots: snaps })
    expect(iv[0].consumed).toBe(-5)
    expect(iv[0].flagged).toBe(true)
  })

  it('観測点が1つ以下なら空', () => {
    expect(consumptionIntervals('A', { snapshots: [snap('2026-07-01', [{ item: 'A', qty: 3 }])] })).toEqual([])
    expect(consumptionIntervals('A', {})).toEqual([])
  })
})

describe('avgDailyConsumption（直近の平均日消費）', () => {
  it('flagged 区間を除いて平均日消費を出す', () => {
    const snaps = [
      snap(_daysAgo(8), [{ item: 'A', qty: 10 }]),
      snap(_daysAgo(4), [{ item: 'A', qty: 2 }]),   // 4日で8消費 → 2/日
    ]
    const v = avgDailyConsumption('A', { snapshots: snaps })
    expect(v).toBeCloseTo(2, 3)
  })

  it('データ不足は null', () => {
    expect(avgDailyConsumption('A', {})).toBeNull()
  })
})

// D1: 未記録入庫による過小評価を塞ぐ。
// 部分利用（週1回だけアプリを使う）の店では、使わない曜日の発注・納品が記録されない。
// その分が「消費」に化けると、適正在庫が低く学習されて欠品につながる。
// 在庫が減ってさえいればマイナスにならず、negative の判定だけでは素通りする。
describe('発注があったはずなのに入庫が無い区間', () => {
  const snaps = [
    snap('2026-08-05', [{ item: 'A', qty: 10 }]),   // 水
    snap('2026-08-12', [{ item: 'A', qty: 5 }]),    // 翌週水
  ]

  it('発注レコードがあるのに入庫0件なら missing_inflow で外す', () => {
    const orders = [order('2026-08-07', [{ item: 'A', qty: 2 }])]
    const [iv] = consumptionIntervals('A', { snapshots: snaps, orders })
    expect(iv.consumed).toBe(5)               // 見かけ上は素直な数字
    expect(iv.flagged).toBe(true)             // でも記録外の納品が混ざっている
    expect(iv.flagReason).toBe('missing_inflow')
    expect(avgDailyConsumption('A', { snapshots: snaps, orders })).toBeNull()
  })

  it('発注曜日をまたぐのに入庫0件でも外す（アプリ外で発注していても効く）', () => {
    const [iv] = consumptionIntervals('A', { snapshots: snaps, orderDays: [1, 5] })  // 月・金
    expect(iv.flagReason).toBe('missing_inflow')
  })

  it('入庫が記録されていれば通常どおり数える', () => {
    const orders = [order('2026-08-07', [{ item: 'A', qty: 2 }])]
    const moves  = [move('2026-08-08', 'in', [{ item: 'A', qty: 20 }])]
    const [iv] = consumptionIntervals('A', { snapshots: snaps, orders, movements: moves })
    expect(iv.consumed).toBe(25)              // 10 + 20 − 5
    expect(iv.flagged).toBe(false)
    expect(iv.flagReason).toBeNull()
  })

  it('発注の予定も記録も無ければ、入庫0件でも通す（毎日発注しない品目）', () => {
    const [iv] = consumptionIntervals('A', { snapshots: snaps })
    expect(iv.flagged).toBe(false)
    expect(iv.consumed).toBe(5)
  })

  it('区間の終端に発注しても数えない（納品は次の区間に来る）', () => {
    const orders = [order('2026-08-12', [{ item: 'A', qty: 2 }])]
    const [iv] = consumptionIntervals('A', { snapshots: snaps, orders })
    expect(iv.flagged).toBe(false)
  })

  it('区間の外の発注は数えない', () => {
    const orders = [order('2026-08-04', [{ item: 'A', qty: 2 }]),   // 区間の開始日より前
                    order('2026-08-20', [{ item: 'A', qty: 2 }])]   // 区間の後
    const [iv] = consumptionIntervals('A', { snapshots: snaps, orders })
    expect(iv.flagged).toBe(false)
  })

  it('区間が7日以上なら、どの発注曜日でも必ずまたぐ', () => {
    const long = [
      snap('2026-08-01', [{ item: 'A', qty: 10 }]),
      snap('2026-08-30', [{ item: 'A', qty: 2 }]),
    ]
    const [iv] = consumptionIntervals('A', { snapshots: long, orderDays: [3] })
    expect(iv.flagReason).toBe('missing_inflow')
  })

  it('マイナス消費は従来どおり negative として外す', () => {
    const up = [
      snap('2026-08-05', [{ item: 'A', qty: 2 }]),
      snap('2026-08-12', [{ item: 'A', qty: 9 }]),
    ]
    const [iv] = consumptionIntervals('A', { snapshots: up })
    expect(iv.flagReason).toBe('negative')
  })
})
