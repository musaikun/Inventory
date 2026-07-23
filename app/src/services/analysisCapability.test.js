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
