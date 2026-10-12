// 金額を見られない人への応答と、その人からの保存（moneyGuard.js）の直接テスト。
// HTTP を通した流れは test/staffMoney.test.js。ここは前の版からの戻し方の細かい規則を固定する。
import { describe, it, expect } from 'vitest'
import {
  stripConfigMoney, restoreConfigMoney, stripSnapshotMoney, stripLinesMoney, restoreSnapshotMoney,
} from './moneyGuard.js'

const snap = () => ({
  date: '2026-10-01', totalValue: 1500,
  items: [
    { item: 'トマト', qty: 10, unitPrice: 100, subtotal: 1000 },
    { item: 'なす', qty: 5, unitPrice: 100, subtotal: 500 },
  ],
  participants: [
    { name: '山田', totalValue: 1000, items: [{ item: 'トマト', qty: 10, subtotal: 1000 }] },
  ],
})

describe('応答から金額を落とす', () => {
  it('config は単価だけを空にし、元の値は変えない', () => {
    const cfg = { order: ['トマト'], prices: { トマト: 100 } }
    expect(stripConfigMoney(cfg)).toEqual({ order: ['トマト'], prices: {} })
    expect(cfg.prices).toEqual({ トマト: 100 })
    expect(stripConfigMoney(null)).toBeNull()
  })
  it('履歴は単価・小計・在庫金額・参加者別の金額を null にする', () => {
    const s = snap()
    const out = stripSnapshotMoney(s)
    expect(out.totalValue).toBeNull()
    expect(out.items.every(it => it.unitPrice === null && it.subtotal === null)).toBe(true)
    expect(out.items.map(it => it.qty)).toEqual([10, 5])            // 数量は残す
    expect(out.participants[0]).toMatchObject({ totalValue: null, items: [{ item: 'トマト', qty: 10, subtotal: null }] })
    expect(s.totalValue).toBe(1500)                                  // 元は変えない
  })
  it('明細は金額を落とし、エラー応答はそのまま返す', () => {
    const out = stripLinesMoney({ totalValue: 9, lines: [{ item: 'a', qty: 1, unitPrice: 9, subtotal: 9 }] })
    expect(out).toEqual({ totalValue: null, lines: [{ item: 'a', qty: 1, unitPrice: null, subtotal: null }] })
    const err = { _status: 404, error: 'x' }
    expect(stripLinesMoney(err)).toBe(err)
  })
})

describe('金額を見られない人の保存は、前の版から金額を戻す', () => {
  it('config: 送られた単価は採らず、前の単価を残す', () => {
    const prev = { prices: { トマト: 100 } }
    expect(restoreConfigMoney(prev, { order: ['トマト'], prices: { トマト: 1 } }).prices).toEqual({ トマト: 100 })
    expect(restoreConfigMoney(null, { prices: { トマト: 1 } }).prices).toEqual({})
  })
  it('数量が変わらなければ、小計も在庫金額も前の値のまま（送られた金額は採らない）', () => {
    const next = stripSnapshotMoney(snap())
    next.items[0].subtotal = 999999
    const out = restoreSnapshotMoney(snap(), next)
    expect(out.totalValue).toBe(1500)
    expect(out.items).toEqual(snap().items)
    expect(out.participants[0].totalValue).toBe(1000)
  })
  it('数量を直した品目は 前の単価×数量（四捨五入）、在庫金額は小計の合計', () => {
    const next = stripSnapshotMoney(snap())
    next.items[0].qty = 7.5
    const out = restoreSnapshotMoney(snap(), next)
    expect(out.items[0]).toMatchObject({ qty: 7.5, unitPrice: 100, subtotal: 750 })
    expect(out.items[1]).toMatchObject({ unitPrice: 100, subtotal: 500 })
    expect(out.totalValue).toBe(1250)
  })
  it('前の版に無い品目は単価を知らないので null。品目の増減は在庫金額を計算し直す', () => {
    const next = stripSnapshotMoney(snap())
    next.items.push({ item: 'きゅうり', qty: 3, unitPrice: 50, subtotal: 150 })
    const out = restoreSnapshotMoney(snap(), next)
    expect(out.items[2]).toMatchObject({ item: 'きゅうり', unitPrice: null, subtotal: null })
    expect(out.totalValue).toBe(1500)                                // 小計のある品目だけの合計
  })
  it('前の版が無ければ、金額はすべて null', () => {
    const out = restoreSnapshotMoney(null, snap())
    expect(out.totalValue).toBeNull()
    expect(out.items.every(it => it.unitPrice === null && it.subtotal === null)).toBe(true)
    expect(out.participants[0].totalValue).toBeNull()
  })
})
