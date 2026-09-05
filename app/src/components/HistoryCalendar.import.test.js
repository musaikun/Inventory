// 取り込んだ過去データが履歴カレンダーの「その日」に星として出ることの回帰。
//
// 取込は棚卸・納品（入庫）・出庫の3種類で、どれも実施日は過去。取り込んだ日に
// 星が出てしまうと、カレンダーを開いた人には「入れたはずの日に何も無い」ように見える。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

vi.mock('../utils/api.js', () => ({
  HTTP_BASE: 'https://worker.test',
  apiFetch: vi.fn(async () => ({})),
  setAuthInvalidatedHandler: vi.fn(),
}))

// 月内に「今日」と「過去の実施日」を両方置けるよう、時計を月の中ほどへ固定する。
const NOW = new Date(2026, 8, 20, 10, 0, 0)   // 2026-09-20 10:00（ローカル）
const PAST = '2026-09-05'

let app = null
let host = null

async function mountCal(sessions = []) {
  const { default: HistoryCalendar } = await import('./HistoryCalendar.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(HistoryCalendar, { sessions })
  app.mount(host)
  for (let i = 0; i < 4; i++) await nextTick()
  return host
}

// 日付 → その日のセル要素。先頭に前月ぶんの空セルが並ぶので曜日ぶんずらす。
function cellOf(root, dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number)
  const firstDow = new Date(y, m - 1, 1).getDay()
  const cells = root.querySelectorAll('.hc-weeks .hc-cell')
  return cells[firstDow + d - 1]
}

describe('HistoryCalendar 取込データの星', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    if (app)  { app.unmount(); app = null }
    if (host) { host.remove();  host = null }
    vi.useRealTimers()
    vi.resetModules()
  })

  it('取り込んだ過去の棚卸は、実施日のマスに星が出る', async () => {
    // サーバーは取込セッションの ended_at に「取り込んだ時刻」を入れる。
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify({
      imp1: {
        date: PAST, sessionId: 'imp1', source: 'import', importBatchId: 'b1',
        items: [{ item: '牛肉', qty: 3, unitPrice: 100, subtotal: 300 }],
        totalValue: 300, savedAt: `${PAST}T00:00:00.000Z`,
      },
    }))
    const root = await mountCal([{
      id: 'imp1', status: 'completed', type: 'stock',
      startedAt: `${PAST}T00:00:00.000Z`, endedAt: NOW.toISOString(),
    }])

    expect(cellOf(root, PAST).querySelector('.dot-stock')).not.toBeNull()
    expect(cellOf(root, '2026-09-20').querySelector('.dot-stock')).toBeNull()
  })

  it('取り込んだ納品（入庫）は、納品日のマスに星が出る', async () => {
    localStorage.setItem(STORAGE_KEYS.movements, JSON.stringify([{
      id: 'm1', date: PAST, type: 'in', source: 'import', importBatchId: 'b2',
      savedAt: NOW.toISOString(), lines: [{ item: '牛肉', qty: 2, unit: 'kg' }],
    }]))
    const root = await mountCal()
    expect(cellOf(root, PAST).querySelector('.dot-in')).not.toBeNull()
  })

  it('取込の行は、取り込んだ時刻ではなく「取込」と示す', async () => {
    // 取込の savedAt / endedAt は取り込んだ日時。その日の時刻として出すと、
    // 実施日のシートに別の日の時刻が並ぶ。
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify({
      imp1: {
        date: PAST, sessionId: 'imp1', source: 'import', importBatchId: 'b1',
        items: [{ item: '牛肉', qty: 3, unitPrice: 100, subtotal: 300 }], totalValue: 300,
      },
    }))
    localStorage.setItem(STORAGE_KEYS.movements, JSON.stringify([{
      id: 'm1', date: PAST, type: 'in', source: 'import', importBatchId: 'b2',
      savedAt: NOW.toISOString(), lines: [{ item: '牛肉', qty: 2, unit: 'kg' }],
    }]))
    const root = await mountCal([{
      id: 'imp1', status: 'completed', type: 'stock', importBatchId: 'b1',
      startedAt: `${PAST}T00:00:00.000Z`, endedAt: NOW.toISOString(),
    }])
    cellOf(root, PAST).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()

    const sheet = root.querySelector('.hc-sheet')
    expect(sheet.textContent).toContain('9月5日')
    expect(sheet.querySelectorAll('.hc-entry-imported').length).toBe(2)   // 棚卸・入庫
    expect(sheet.querySelector('.hc-entry-time')).toBeNull()
  })

  it('取り込んだ出庫は、出庫日のマスに星が出る', async () => {
    localStorage.setItem(STORAGE_KEYS.movements, JSON.stringify([{
      id: 'm2', date: PAST, type: 'out', source: 'import', importBatchId: 'b3',
      savedAt: NOW.toISOString(), lines: [{ item: '牛肉', qty: 1, unit: 'kg' }],
    }]))
    const root = await mountCal()
    expect(cellOf(root, PAST).querySelector('.dot-out')).not.toBeNull()
  })
})
