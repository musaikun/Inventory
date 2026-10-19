// 発注数の参考の数（User決定 2026-10-17）。データが足りないものは出さない・何から出た数かを添える
import { describe, it, expect } from 'vitest'
import { orderRefs, unusualOrder } from './orderRefs.js'

const o = (date, qty, item = 'キャベツ') => ({ date, lines: [{ item, qty }] })
const TODAY = '2026-10-20'   // 火曜

describe('orderRefs', () => {
  it('記録が無ければ何も出さない（推奨も出さない）', () => {
    const r = orderRefs([], 'キャベツ', TODAY)
    expect(r.refs).toEqual([])
  })

  it('前回は1回でも。同じ曜日の平均は3回から。直近1週間は2回から。今日の分は入れない', () => {
    const orders = [o('2026-09-29', 2), o('2026-10-06', 3), o('2026-10-13', 1), o('2026-10-17', 4), o(TODAY, 9), o('2026-10-15', 5, '玉ねぎ')]
    const r = orderRefs(orders, 'キャベツ', TODAY)
    expect(r.last).toEqual({ date: '2026-10-17', qty: 4 })
    expect(r.weekday).toEqual({ avg: 2, count: 3, label: '火' })
    expect(r.week).toEqual({ avg: 2.5, count: 2 })   // 10/13・10/17
    expect(r.refs.map(x => x.key)).toEqual(['wd', 'week', 'last'])
    expect(orderRefs(orders.slice(1), 'キャベツ', TODAY).weekday).toBeNull()   // 火曜は2回だけ
  })

  it('推奨は補充目標が分かるときだけ（仮の目標からは出さない）。入数で切り上げ', () => {
    expect(orderRefs([], 'キャベツ', TODAY, { target: { value: 10, source: 'manual' }, stock: 3 }).recommend).toEqual({ qty: 7, target: 10, stock: 3 })
    expect(orderRefs([], 'キャベツ', TODAY, { target: { value: 30, source: 'par' }, stock: 5, lot: 12 }).recommend.qty).toBe(3)
    expect(orderRefs([], 'キャベツ', TODAY, { target: { value: 10, source: 'assumed' }, stock: 3 }).recommend).toBeNull()
    expect(orderRefs([], 'キャベツ', TODAY, { target: { value: 10, source: 'manual' } }).recommend, '在庫が分からなければ出さない').toBeNull()
  })
})

describe('unusualOrder', () => {
  it('いつもの3倍以上・3分の1以下だけ。比べる数が無ければ訊かない', () => {
    const refs = { weekday: { avg: 2 } }
    expect(unusualOrder(6, refs)).toEqual({ usual: 2, ratio: 3 })
    expect(unusualOrder(5, refs)).toBeNull()
    expect(unusualOrder(0.5, refs)).not.toBeNull()
    expect(unusualOrder(8, {})).toBeNull()
    expect(unusualOrder(8, { week: { avg: 2 } })).not.toBeNull()
  })
})
