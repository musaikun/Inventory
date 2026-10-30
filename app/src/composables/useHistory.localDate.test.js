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
})
