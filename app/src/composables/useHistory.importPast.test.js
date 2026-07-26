import { describe, it, expect, beforeEach } from 'vitest'
import { useHistory } from './useHistory.js'
import { consumptionIntervals } from '../services/impliedConsumption.js'

describe('useHistory.importPastSnapshot', () => {
  beforeEach(() => { localStorage.clear() })

  it('過去日付のスナップショットを挿入し、金額を集計する', () => {
    const { importPastSnapshot, getSnapshots } = useHistory()
    // 既存分を掃除
    for (const s of getSnapshots()) useHistory().deleteSnapshot(s.date)

    const snap = importPastSnapshot({
      date: '2026-05-31',
      items: [
        { item: '豚バラ', qty: 2, unit: 'kg', unitPrice: 500 },
        { item: 'ビール', qty: 10, unit: '本', unitPrice: 200 },
      ],
    })
    expect(snap.date).toBe('2026-05-31')
    expect(snap.source).toBe('import')
    expect(snap.totalValue).toBe(2 * 500 + 10 * 200)
    expect(getSnapshots().some(s => s.date === '2026-05-31')).toBe(true)
  })

  it('不正な入力は null', () => {
    const { importPastSnapshot } = useHistory()
    expect(importPastSnapshot({ date: '', items: [] })).toBeNull()
    expect(importPastSnapshot({ date: '2026-05-31', items: [] })).toBeNull()
  })

  it('取り込んだ過去棚卸が消費逆算の観測点になる', () => {
    const { importPastSnapshot, getSnapshots } = useHistory()
    for (const s of getSnapshots()) useHistory().deleteSnapshot(s.date)

    importPastSnapshot({ date: '2026-05-01', items: [{ item: '米', qty: 20 }] })
    importPastSnapshot({ date: '2026-05-08', items: [{ item: '米', qty: 12 }] })

    // 棚卸2点（残高20→12、入庫なし）→ 消費 8
    const iv = consumptionIntervals('米', { snapshots: getSnapshots() })
    expect(iv).toHaveLength(1)
    expect(iv[0].consumed).toBe(8)
  })
})
