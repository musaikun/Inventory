import { describe, it, expect } from 'vitest'
import { itemConsumptionAvailability, storeConsumptionReadiness } from './analysisCapability.js'

const snap = (date, items) => ({ date, items })

describe('itemConsumptionAvailability', () => {
  it('観測点2つ以上 → available', () => {
    const snaps = [snap('2026-05-01', [{ item: '米', qty: 20 }]), snap('2026-05-08', [{ item: '米', qty: 12 }])]
    const r = itemConsumptionAvailability('米', { snapshots: snaps })
    expect(r).toMatchObject({ available: true, points: 2, need: 0 })
    expect(r.hint).toBe('')
  })

  it('観測点0 → 過去棚卸の取込を促すヒント', () => {
    const r = itemConsumptionAvailability('米', { snapshots: [] })
    expect(r).toMatchObject({ available: false, points: 0, need: 2 })
    expect(r.hint).toMatch(/過去の棚卸を取り込む/)
  })

  it('観測点1 → あと1回のヒント', () => {
    const r = itemConsumptionAvailability('米', { snapshots: [snap('2026-05-01', [{ item: '米', qty: 20 }])] })
    expect(r).toMatchObject({ available: false, points: 1, need: 1 })
    expect(r.hint).toMatch(/あと1回/)
  })

  it('発注時在庫も観測点として数える', () => {
    const snaps = [snap('2026-05-01', [{ item: '米', qty: 20 }])]
    const orders = [{ date: '2026-05-05', lines: [{ item: '米', stock: 8 }] }]
    expect(itemConsumptionAvailability('米', { snapshots: snaps, orders }).available).toBe(true)
  })
})

describe('storeConsumptionReadiness', () => {
  it('棚卸2日分以上で ready', () => {
    const snaps = [snap('2026-05-01', [{ item: '米', qty: 20 }]), snap('2026-05-08', [{ item: '米', qty: 12 }])]
    expect(storeConsumptionReadiness({ snapshots: snaps })).toMatchObject({ ready: true, stocktakes: 2, hint: '' })
  })

  it('棚卸0 → 取込を促す全体ヒント', () => {
    const r = storeConsumptionReadiness({ snapshots: [] })
    expect(r.ready).toBe(false)
    expect(r.hint).toMatch(/過去の棚卸を取り込む/)
  })

  it('棚卸1日分 → あと1回のヒント', () => {
    const r = storeConsumptionReadiness({ snapshots: [snap('2026-05-01', [{ item: '米', qty: 20 }])] })
    expect(r).toMatchObject({ ready: false, stocktakes: 1 })
    expect(r.hint).toMatch(/あと1回/)
  })
})

// D1/D2: 観測点が足りていても、区間がすべて弾かれていれば算出しない。
// 「出せない理由」を分けて返す（記録漏れ／数え間違いで、次にやることが違うため）。
describe('itemConsumptionAvailability — 出せない理由を分ける', () => {
  const snaps = [
    { date: '2026-08-05', items: [{ item: 'A', qty: 10 }] },
    { date: '2026-08-12', items: [{ item: 'A', qty: 5 }] },
  ]

  it('未記録の入庫が疑われるときは、入庫を記録するよう案内する', () => {
    const r = itemConsumptionAvailability('A', {
      snapshots: snaps,
      orders: [{ date: '2026-08-07', lines: [{ item: 'A', qty: 2 }] }],
    })
    expect(r.available).toBe(false)
    expect(r.reason).toBe('missing_inflow')
    expect(r.hint).toContain('入庫として記録')
  })

  it('在庫が増えている区間しか無ければ、記録漏れ・数え間違いとして案内する', () => {
    const up = [
      { date: '2026-08-05', items: [{ item: 'A', qty: 2 }] },
      { date: '2026-08-12', items: [{ item: 'A', qty: 9 }] },
    ]
    const r = itemConsumptionAvailability('A', { snapshots: up })
    expect(r.available).toBe(false)
    expect(r.reason).toBe('negative')
  })

  it('使える区間が1つでもあれば算出できる', () => {
    const r = itemConsumptionAvailability('A', { snapshots: snaps })
    expect(r.available).toBe(true)
    expect(r.hint).toBe('')
  })
})
