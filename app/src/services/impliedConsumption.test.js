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
