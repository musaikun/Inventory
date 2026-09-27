// 在庫だけ数えて（発注数なしで）完了した発注セッションも、カレンダーに残る。
// 発注の記録（orders）は発注数が1件以上のときしか作られず、以前はどこにも出なかった（User報告 2026-09-27）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

vi.mock('../utils/api.js', () => ({
  HTTP_BASE: 'https://worker.test',
  apiFetch: vi.fn(async () => ({})),
  setAuthInvalidatedHandler: vi.fn(),
}))

let app = null
let host = null
async function mountCal(orderSessions) {
  const { default: HistoryCalendar } = await import('./HistoryCalendar.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(HistoryCalendar, { sessions: [], orderSessions })
  app.mount(host)
  for (let i = 0; i < 4; i++) await nextTick()
  return host
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 27, 12, 0, 0))
})
afterEach(() => {
  if (app)  { app.unmount(); app = null }
  if (host) { host.remove();  host = null }
  vi.useRealTimers()
  vi.resetModules()
})

const sess = (id, ended) => ({ id, status: 'completed', type: 'order', startedAt: ended, endedAt: ended })

describe('発注数なしで完了した発注セッション', () => {
  it('発注の★が付き、その日のシートに「発注を完了」と保留の品目数が出る', async () => {
    localStorage.setItem('order_draft_ord_x1', JSON.stringify({ トマト: { orderQty: 0, stock: 5 }, 豚バラ: { orderQty: 0, stock: 2 } }))
    const root = await mountCal([sess('x1', '2026-09-27T03:00:00.000Z')])
    expect(root.querySelectorAll('.hc-cell .dot-order').length).toBe(1)
    root.querySelector('.hc-cell .dot-order').closest('.hc-cell').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick(); await nextTick()
    const sheet = root.querySelector('.hc-day-sheet')
    expect(sheet.textContent).toContain('発注（1件）')
    expect(sheet.textContent).toContain('発注を完了')
    expect(sheet.textContent).toContain('在庫のみ 2品目')
  })

  it('発注の記録があるセッションは二重に数えない', async () => {
    localStorage.setItem(STORAGE_KEYS.orders, JSON.stringify([
      { id: 'ord_x2', date: '2026-09-27', sessionId: 'x2', savedAt: '2026-09-27T03:00:00Z', lines: [{ item: '牛肉', qty: 2, unit: 'kg' }] },
    ]))
    const root = await mountCal([sess('x2', '2026-09-27T03:00:00.000Z')])
    root.querySelector('.hc-cell .dot-order').closest('.hc-cell').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick(); await nextTick()
    expect(root.querySelector('.hc-day-sheet').textContent).toContain('発注（1件）')
    expect(root.querySelector('.hc-entry-bare')).toBeNull()
  })
})
