// 履歴の日付は端末の地域の日付（UTC だと日本時間 0〜9時に完了した棚卸が前日になる）
import { describe, it, expect, afterEach, vi } from 'vitest'

const prevTz = process.env.TZ
afterEach(() => { vi.useRealTimers(); process.env.TZ = prevTz })

describe('buildSnapshot の日付', () => {
  it('日本時間の朝（UTC では前日）に完了しても、その日の日付になる', async () => {
    process.env.TZ = 'Asia/Tokyo'
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-30T23:30:00Z'))   // 日本時間 10/31 8:30
    vi.resetModules()
    const { useHistory } = await import('./useHistory.js')
    const snap = useHistory().buildSnapshot({ トマト: { qty: 1, unit: '個', enteredBy: 'A', updatedAt: Date.now() } }, {}, ['トマト'], {}, ['トマト'], [], null, null, 's-1')
    expect(snap.date).toBe('2026-10-31')
  })

  it('日をまたいだ棚卸は始めた日を棚卸日にし、行に数えた時刻を持たせる（User決定 2026-11-05）', async () => {
    process.env.TZ = 'Asia/Tokyo'
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-01T13:30:00Z'))   // 日本時間 11/1 22:30 に完了
    vi.resetModules()
    const { useHistory } = await import('./useHistory.js')
    const at = Date.parse('2026-10-31T12:10:00Z')
    const snap = useHistory().buildSnapshot({ トマト: { qty: 1, unit: '個', enteredBy: 'A', updatedAt: at } }, {}, ['トマト'], {}, [], [], null, null, 's-1',
      null, null, null, null, null, null, null, '2026-10-31')
    expect(snap.date).toBe('2026-10-31')
    expect(snap.items[0].at).toBe(at)
    // 先の日付は受けない（今日にする）
    const later = useHistory().buildSnapshot({ トマト: { qty: 1, unit: '個', updatedAt: at } }, {}, ['トマト'], {}, [], [], null, null, 's-2',
      null, null, null, null, null, null, null, '2026-11-09')
    expect(later.date).toBe('2026-11-01')
  })
})

