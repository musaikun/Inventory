// カレンダーのマスの印（User 2026-10-05）。
// 五十日・給料日・祝前日の印は出さない。やることは左上に件数。4種類の星も横1列。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({ HTTP_BASE: '', apiFetch: vi.fn(async () => ({})), setAuthInvalidatedHandler: vi.fn() }))

let app = null, host = null
const tick = async () => { for (let i = 0; i < 4; i++) await nextTick() }
const cellOf = d => [...host.querySelectorAll('.hc-cell')].find(c => c.querySelector('.hc-day')?.textContent === String(d))
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; vi.useRealTimers(); vi.resetModules(); localStorage.clear() })

describe('マスの印', () => {
  it('五十日・給料日・祝前日の印は出さず、やることは左上に未完了の件数', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 4, 10))
    const T = await import('../composables/useTasks.js')
    T.addTask('2026-10-10', '霜取り'); T.addTask('2026-10-10', '掃除')
    T.toggleTask(T.addTask('2026-10-10', '済んだ').id)
    const line = [{ item: 'トマト', qty: 1, unit: '個' }]
    ;(await import('../composables/useOrders.js')).useOrders().saveOrder({ date: '2026-10-25', lines: line })
    const mv = (await import('../composables/useMovements.js')).useMovements()
    mv.saveMovement({ type: 'in', date: '2026-10-25', lines: line })
    mv.saveMovement({ type: 'out', date: '2026-10-25', lines: line })
    const { default: HistoryCalendar } = await import('./HistoryCalendar.vue')
    host = document.createElement('div'); document.body.appendChild(host)
    app = createApp(HistoryCalendar, {
      sessions: [{ id: 's1', status: 'completed', type: 'stock', startedAt: '2026-10-25T01:00:00Z', endedAt: '2026-10-25T02:00:00Z' }],
    })
    app.mount(host); await tick()
    expect(host.querySelector('.hc-gotobi-mark, .hc-pay-mark, .eve-weekday, .eve-weekend')).toBeNull()
    expect(cellOf(10).querySelector('.hc-task-mark').textContent).toBe('2')
    expect(cellOf(11).querySelector('.hc-task-mark')).toBeNull()
    // 4種類そろった日も横1列（2×2 に折り返さない）
    const dots = cellOf(25).querySelector('.hc-dots')
    expect(dots.querySelectorAll('.dot').length).toBe(4)
    expect(dots.classList.contains('dots-4')).toBe(true)
    expect(dots.classList.contains('dots-grid')).toBe(false)
  })
})
