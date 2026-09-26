// 発注・入出庫の「その日」はローカル日付。UTC の日付を使うと、日本時間 0:00〜9:00 の記録が前日になる。
// どのタイムゾーンでも通るように、期待値は端末のローカル時刻で組み立てる（TZ=Asia/Tokyo で不具合が再現する）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { localDateKey } from './localDate.js'

const NIGHT = new Date(2026, 8, 27, 0, 47)   // ローカルで 9/27 0:47

describe('localDateKey', () => {
  it('ローカルの年月日を返す', () => {
    expect(localDateKey(NIGHT)).toBe('2026-09-27')
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})

describe('深夜に記録した発注・入出庫の日付', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NIGHT)
  })
  afterEach(() => { vi.useRealTimers() })

  it('発注は記録したローカルの日付で残る（前日に入らない）', async () => {
    const { useOrders } = await import('../composables/useOrders.js')
    const rec = useOrders().upsertOrder({ id: 'o1', lines: [{ item: 'トマト', qty: 2, unit: '個' }] })
    expect(rec.date).toBe('2026-09-27')
  })

  it('入出庫も同じ', async () => {
    const { useMovements } = await import('../composables/useMovements.js')
    const rec = useMovements().saveMovement({ type: 'in', lines: [{ item: 'トマト', qty: 2, unit: '個' }] })
    expect(rec.date).toBe('2026-09-27')
  })
})
