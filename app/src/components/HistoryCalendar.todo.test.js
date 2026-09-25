// 履歴カレンダーの「今日のやること」（自動）と「一覧」（業務ごとに日付を探して詳細へ）。
// カレンダー自体にはフィルタも予定も足さない（2026-09-08 / 09-21 の判断を崩さない）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

vi.mock('../utils/api.js', () => ({
  HTTP_BASE: 'https://worker.test',
  apiFetch: vi.fn(async () => ({})),
  setAuthInvalidatedHandler: vi.fn(),
}))

const NOW = new Date(2026, 8, 20, 10, 0, 0)   // 2026-09-20（日）

let app = null
let host = null
let viewed = []

async function mountCal(sessions = []) {
  const { default: HistoryCalendar } = await import('./HistoryCalendar.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(HistoryCalendar, { sessions, onViewSession: s => viewed.push(s) })
  app.mount(host)
  for (let i = 0; i < 4; i++) await nextTick()
  return host
}
async function click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await nextTick(); await nextTick() }
const btn = label => [...host.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(label))

function seed() {
  localStorage.setItem(STORAGE_KEYS.config, JSON.stringify({
    order: ['牛肉'], prices: { 牛肉: 500 },
    orderSchedules: [{ id: 'a', name: '青果', days: [0], deadline: '15:00' }],
  }))
  localStorage.setItem(STORAGE_KEYS.orders, JSON.stringify([
    { id: 'o1', date: '2026-09-18', supplier: '肉屋', savedAt: '2026-09-18T01:00:00Z', lines: [{ item: '牛肉', qty: 2, unit: 'kg' }] },
  ]))
  localStorage.setItem(STORAGE_KEYS.movements, JSON.stringify([
    { id: 'm1', date: '2026-09-12', type: 'out', savedAt: '2026-09-12T01:00:00Z', lines: [{ item: '牛肉', qty: 1, unit: 'kg' }] },
  ]))
  localStorage.setItem(STORAGE_KEYS.dayNotes, JSON.stringify({ '2026-09-15': { text: '貸切', tags: [], excluded: false } }))
  return [{ id: 's1', status: 'completed', type: 'stock', startedAt: '2026-09-05T08:00:00Z', endedAt: '2026-09-05T09:00:00Z' }]
}

beforeEach(() => {
  localStorage.clear()
  viewed = []
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  if (app)  { app.unmount(); app = null }
  if (host) { host.remove();  host = null }
  vi.useRealTimers()
  vi.resetModules()
})

describe('今日のやること', () => {
  it('発注日と入庫の未記録を出し、マスには予定を載せない', async () => {
    const root = await mountCal(seed())
    const todo = root.querySelector('.hc-todo')
    expect(todo.textContent).toContain('青果の発注日')
    expect(todo.textContent).toContain('9/18 の発注の入庫が未記録')
    expect(root.querySelector('.hc-key').querySelectorAll('button').length).toBe(0)   // 凡例は押せないまま
  })

  it('入庫の未記録を押すと、その発注の日のシートが開く', async () => {
    const root = await mountCal(seed())
    await click([...root.querySelectorAll('.hc-todo-row')].find(r => r.textContent.includes('9/18')))
    const sheet = root.querySelector('.hc-day-sheet')
    expect(sheet.textContent).toContain('9月18日')
    expect(sheet.querySelector('[data-rec="o1"] .hc-order-lines')).not.toBeNull()   // 該当の発注が開いている
  })

  it('やることが無ければ枠を出さない', async () => {
    const root = await mountCal([])
    expect(root.querySelector('.hc-todo')).toBeNull()
  })
})

describe('一覧（業務ごとに日付を探す）', () => {
  it('新しい順に月見出しつきで並び、業務で絞れる', async () => {
    const root = await mountCal(seed())
    await click(btn('一覧'))
    const rows = () => [...root.querySelectorAll('.hc-list-row')].map(r => r.textContent)
    expect(rows().length).toBe(4)                       // 発注・メモ・出庫・棚卸
    expect(rows()[0]).toContain('9/18')
    expect(root.querySelector('.hc-list-month').textContent).toBe('2026年9月')
    await click([...root.querySelectorAll('.hc-kind')].find(b => b.textContent.includes('出庫')))
    expect(rows()).toEqual([expect.stringContaining('9/12')])
    await click([...root.querySelectorAll('.hc-kind')].find(b => b.textContent.includes('メモ')))
    expect(rows()[0]).toContain('貸切')
  })

  it('棚卸の行は詳細ページへ、それ以外はその日のシートへ', async () => {
    const root = await mountCal(seed())
    await click(btn('一覧'))
    await click([...root.querySelectorAll('.hc-list-row')].find(r => r.textContent.includes('棚卸')))
    expect(viewed.map(s => s.id)).toEqual(['s1'])
    await click([...root.querySelectorAll('.hc-list-row')].find(r => r.textContent.includes('出庫')))
    expect(root.querySelector('.hc-day-sheet').textContent).toContain('9月12日')
  })
})
