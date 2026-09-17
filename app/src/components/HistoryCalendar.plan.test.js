// カレンダーの「予定」と日別メモの入力。
//
//   ・日別メモは自由記述と学習除外の2つだけ。定型チップ（貸切・イベント…）は置かない
//     ＝ 用意された言葉から選ぶ記録ではなく、店の言葉で書いた1行を残すため。
//   ・仕入れ管理の発注スケジュール（発注する曜日）を暦へ写す。**今日以降だけ**に出し、
//     実績（★）とは形を変える。過去のマスに予定を出すと「その日に発注した」と読める。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

vi.mock('../utils/api.js', () => ({
  HTTP_BASE: 'https://worker.test',
  apiFetch: vi.fn(async () => ({})),
  setAuthInvalidatedHandler: vi.fn(),
}))

const NOW = new Date(2026, 8, 20, 10, 0, 0)   // 2026-09-20（日）10:00 ローカル

let app = null
let host = null

// 日・火が発注日のスケジュール（今日=日曜も発注日になる並びにして境界を見る）
function seedSchedule(schedules = [{ id: 'sc1', name: '青果', days: [0, 2], deadline: '15:00' }]) {
  localStorage.setItem(STORAGE_KEYS.config, JSON.stringify({ order: ['牛肉'], orderSchedules: schedules }))
}

async function mountCal() {
  const { default: HistoryCalendar } = await import('./HistoryCalendar.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(HistoryCalendar, { sessions: [] })
  app.mount(host)
  for (let i = 0; i < 4; i++) await nextTick()
  return host
}

function cellOf(root, dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number)
  const firstDow = new Date(y, m - 1, 1).getDay()
  return root.querySelectorAll('.hc-weeks .hc-cell')[firstDow + d - 1]
}

async function tapDay(root, dateKey) {
  cellOf(root, dateKey).dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
}

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

describe('日別メモ', () => {
  it('定型チップは置かず、自由記述と学習除外だけにする', async () => {
    const root = await mountCal()
    await tapDay(root, '2026-09-15')

    const memo = root.querySelector('.hc-memo')
    expect(memo).not.toBeNull()
    expect(memo.querySelectorAll('.hc-memo-tag').length).toBe(0)
    for (const t of ['貸切', 'イベント', 'メニュー変更', '悪天候', '仕込み過多']) {
      expect([...memo.querySelectorAll('button')].some(b => b.textContent.trim() === t)).toBe(false)
    }
    expect(memo.querySelector('.hc-memo-text')).not.toBeNull()
    expect(memo.querySelector('.hc-memo-excl')).not.toBeNull()
  })

  it('新しいメモには本文を保存し、タグは追加しない', async () => {
    const root = await mountCal()
    await tapDay(root, '2026-09-15')

    const ta = root.querySelector('.hc-memo-text')
    ta.value = '近隣で花火大会'
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    root.querySelector('.hc-memo-save').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.dayNotes))
    expect(saved['2026-09-15'].text).toBe('近隣で花火大会')
    expect(saved['2026-09-15'].tags).toEqual([])
  })

  it('既存メモを書き直しても以前のタグと学習除外を失わず、別の日にはタグを持ち越さない', async () => {
    localStorage.setItem(STORAGE_KEYS.dayNotes, JSON.stringify({
      '2026-09-15': { text: '以前の記録', tags: ['貸切'], excluded: true },
    }))
    const root = await mountCal()
    await tapDay(root, '2026-09-15')

    const ta = root.querySelector('.hc-memo-text')
    ta.value = '貸切の詳細を追記'
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    root.querySelector('.hc-memo-save').click()
    await nextTick()

    let saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.dayNotes))
    expect(saved['2026-09-15']).toEqual({ text: '貸切の詳細を追記', tags: ['貸切'], excluded: true })

    root.querySelector('.hc-day-close').click()
    await nextTick()
    await tapDay(root, '2026-09-16')
    root.querySelector('.hc-memo-save').click()
    await nextTick()
    saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.dayNotes))
    expect(saved['2026-09-16']).toBeUndefined()
    expect(saved['2026-09-15'].tags).toEqual(['貸切'])
  })
})

describe('発注スケジュールの反映', () => {
  it('今日以降の発注曜日のマスに予定の帯を出す', async () => {
    seedSchedule()
    const root = await mountCal()
    expect(cellOf(root, '2026-09-20').querySelector('.hc-plan-bar')).not.toBeNull()  // 今日（日）
    expect(cellOf(root, '2026-09-22').querySelector('.hc-plan-bar')).not.toBeNull()  // 火
    expect(cellOf(root, '2026-09-27').querySelector('.hc-plan-bar')).not.toBeNull()  // 日
  })

  it('過去のマスには出さない（実績の★と読み分けられなくなる）', async () => {
    seedSchedule()
    const root = await mountCal()
    expect(cellOf(root, '2026-09-13').querySelector('.hc-plan-bar')).toBeNull()  // 過去の日曜
    expect(cellOf(root, '2026-09-15').querySelector('.hc-plan-bar')).toBeNull()  // 過去の火曜
  })

  it('発注日でない曜日には出さない', async () => {
    seedSchedule()
    const root = await mountCal()
    expect(cellOf(root, '2026-09-23').querySelector('.hc-plan-bar')).toBeNull()  // 水
  })

  it('スケジュール未設定なら帯も凡例も出さない', async () => {
    const root = await mountCal()
    expect(root.querySelector('.hc-plan-bar')).toBeNull()
    expect(root.querySelector('.hc-plan-key')).toBeNull()
  })

  it('設定していれば凡例に「発注予定」を足す（★の凡例は4つのまま）', async () => {
    seedSchedule()
    const root = await mountCal()
    const key = root.querySelector('.hc-key')
    expect(key.textContent).toContain('発注予定')
    expect(key.querySelectorAll('.dot').length).toBe(4)
  })

  it('詳細モーダルに予定の名前と締切を出す', async () => {
    seedSchedule()
    const root = await mountCal()
    await tapDay(root, '2026-09-22')

    const plan = root.querySelector('.hc-day-sheet .hc-plan')
    expect(plan).not.toBeNull()
    expect(plan.textContent).toContain('発注予定')
    expect(plan.textContent).toContain('青果（締切15:00）')
  })

  it('締切が未設定なら名前だけを出す', async () => {
    seedSchedule([{ id: 'sc1', name: '肉屋', days: [2], deadline: '' }])
    const root = await mountCal()
    await tapDay(root, '2026-09-22')
    expect(root.querySelector('.hc-day-sheet .hc-plan').textContent).toContain('肉屋')
    expect(root.querySelector('.hc-day-sheet .hc-plan').textContent).not.toContain('締切')
  })

  it('複数のスケジュールが同じ日に重なれば両方出す', async () => {
    seedSchedule([
      { id: 'sc1', name: '青果', days: [2], deadline: '15:00' },
      { id: 'sc2', name: '肉屋', days: [2], deadline: '10:00' },
    ])
    const root = await mountCal()
    await tapDay(root, '2026-09-22')
    const chips = [...root.querySelectorAll('.hc-day-sheet .hc-plan-chip')].map(c => c.textContent.trim())
    expect(chips).toEqual(['青果（締切15:00）', '肉屋（締切10:00）'])
  })

  it('過去の発注曜日を開いても予定は出さない', async () => {
    seedSchedule()
    const root = await mountCal()
    await tapDay(root, '2026-09-15')
    expect(root.querySelector('.hc-day-sheet .hc-plan')).toBeNull()
  })
})
