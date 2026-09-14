// カレンダーの読み方（マスの星・祝日名・凡例）と、日をタップして開く詳細モーダルの回帰。
//
// マスは「その日に何をしたか」だけを星で示す。件数・金額をマスに書くと、
// 6行×7列の一覧が数字で埋まって暦として読めなくなるため、詳細は日をタップして読む。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

vi.mock('../utils/api.js', () => ({
  HTTP_BASE: 'https://worker.test',
  apiFetch: vi.fn(async () => ({})),
  setAuthInvalidatedHandler: vi.fn(),
}))

const NOW = new Date(2026, 8, 20, 10, 0, 0)   // 2026-09-20 10:00（ローカル）
const DAY = '2026-09-05'
const HOLIDAY = '2026-09-21'                  // 敬老の日

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
  return root.querySelectorAll('.hc-weeks .hc-cell')[firstDow + d - 1]
}

async function tapDay(root, dateKey) {
  cellOf(root, dateKey).dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
}

// その日のマスに、棚卸・発注・入庫・出庫をすべて置く
function seedAllKinds() {
  localStorage.setItem(STORAGE_KEYS.config, JSON.stringify({
    order: ['牛肉'], prices: { 牛肉: 500 },
  }))
  localStorage.setItem(STORAGE_KEYS.history, JSON.stringify({
    s1: {
      date: DAY, sessionId: 's1',
      items: [{ item: '牛肉', qty: 3, unitPrice: 100, subtotal: 300 }],
      totalValue: 300, savedAt: `${DAY}T09:00:00.000Z`,
    },
  }))
  localStorage.setItem(STORAGE_KEYS.orders, JSON.stringify([{
    id: 'o1', date: DAY, supplier: '肉屋', savedAt: `${DAY}T10:00:00.000Z`,
    lines: [{ item: '牛肉', qty: 2, unit: 'kg' }],
  }]))
  localStorage.setItem(STORAGE_KEYS.movements, JSON.stringify([
    { id: 'm1', date: DAY, type: 'in',  savedAt: `${DAY}T11:00:00.000Z`, lines: [{ item: '牛肉', qty: 2, unit: 'kg' }] },
    { id: 'm2', date: DAY, type: 'out', savedAt: `${DAY}T12:00:00.000Z`, lines: [{ item: '牛肉', qty: 1, unit: 'kg' }] },
  ]))
  return [{ id: 's1', status: 'completed', type: 'stock', startedAt: `${DAY}T08:00:00.000Z`, endedAt: `${DAY}T09:00:00.000Z` }]
}

describe('HistoryCalendar マスの読み方', () => {
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

  it('星の意味は上部の凡例で示し、切り替えボタンは置かない', async () => {
    const root = await mountCal(seedAllKinds())
    const key = root.querySelector('.hc-key')
    expect(key).not.toBeNull()
    expect(key.querySelectorAll('.dot').length).toBe(4)   // 棚卸・発注・入庫・出庫
    expect(key.textContent).toContain('棚卸')
    expect(key.textContent).toContain('入庫')
    expect(key.querySelectorAll('button').length).toBe(0)
    expect(root.querySelectorAll('button.hc-leg').length).toBe(0)
  })

  it('マスに出るのは星だけで、件数・金額は書かない', async () => {
    const root = await mountCal(seedAllKinds())
    const cell = cellOf(root, DAY)

    expect(cell.querySelector('.dot-stock')).not.toBeNull()
    expect(cell.querySelector('.dot-order')).not.toBeNull()
    expect(cell.querySelector('.dot-in')).not.toBeNull()
    expect(cell.querySelector('.dot-out')).not.toBeNull()
    // 日付・星以外の文字（品目数・金額）がマスに出ていない
    expect(cell.textContent.replace(/[★\s]/g, '')).toBe('5')
  })

  it('記録の無い日には星を出さない', async () => {
    const root = await mountCal(seedAllKinds())
    expect(cellOf(root, '2026-09-06').querySelector('.hc-dots')).toBeNull()
  })

  it('祝日はマスに名前を出す', async () => {
    const root = await mountCal()
    expect(cellOf(root, HOLIDAY).querySelector('.hc-hol-name').textContent).toBe('敬老の日')
    expect(cellOf(root, DAY).querySelector('.hc-hol-name')).toBeNull()
  })
})

describe('HistoryCalendar 日の詳細モーダル', () => {
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

  it('開いた直後は詳細を出さない（カレンダーだけを見せる）', async () => {
    const root = await mountCal(seedAllKinds())
    expect(root.querySelector('.hc-day-sheet')).toBeNull()
  })

  it('日をタップするとその日の詳細がモーダルで開き、✕で閉じる', async () => {
    const root = await mountCal(seedAllKinds())
    await tapDay(root, DAY)

    const sheet = root.querySelector('.modal-overlay .hc-day-sheet')
    expect(sheet).not.toBeNull()
    expect(sheet.textContent).toContain('9月5日')
    expect(sheet.textContent).toContain('棚卸')
    expect(sheet.textContent).toContain('発注')

    sheet.querySelector('.hc-sheet-close').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(root.querySelector('.hc-day-sheet')).toBeNull()
  })

  it('記録の無い日でも開ける（暦の条件を読むため）', async () => {
    const root = await mountCal(seedAllKinds())
    await tapDay(root, '2026-09-06')
    expect(root.querySelector('.hc-day-sheet').textContent).toContain('この日はアプリの記録はありません')
  })

  it('棚卸の行から確認ページへ渡し、そのときモーダルは畳む', async () => {
    const sessions = seedAllKinds()
    const { default: HistoryCalendar } = await import('./HistoryCalendar.vue')
    const seen = []
    host = document.createElement('div')
    document.body.appendChild(host)
    app = createApp(HistoryCalendar, { sessions, onViewSession: (s) => seen.push(s) })
    app.mount(host)
    for (let i = 0; i < 4; i++) await nextTick()

    await tapDay(host, DAY)
    host.querySelector('.hc-entry-stock').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()

    expect(seen.map(s => s.id)).toEqual(['s1'])
    expect(host.querySelector('.hc-day-sheet')).toBeNull()
  })

  it('端末の戻るは、画面ではなくモーダルを1枚閉じる', async () => {
    const { consumeInnerLayerBack } = await import('../composables/appMenuState.js')
    const root = await mountCal(seedAllKinds())

    expect(consumeInnerLayerBack()).toBe(false)   // 何も開いていない＝画面側へ渡す
    await tapDay(root, DAY)
    expect(consumeInnerLayerBack()).toBe(true)    // モーダルを閉じて戻るを消費
    await nextTick()
    expect(root.querySelector('.hc-day-sheet')).toBeNull()
    expect(consumeInnerLayerBack()).toBe(false)
  })
})
