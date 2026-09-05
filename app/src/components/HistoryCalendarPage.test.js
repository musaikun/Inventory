// 履歴カレンダーを専用ページへ移したことの回帰。
// 守りたいのは「ホームから1タップで履歴に入り、そこで完結する」こと:
// 完了済み棚卸だけをカレンダーへ渡す、Free上限を明示する、戻れる、削除は確認を挟む。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'

// カレンダーはローカル日付でマスを割り当てる。UTC由来の日付・時刻を渡すと、UTCと
// ローカルで日付が変わる時間帯（JSTなら00:00〜09:00）だけ別の日に載って落ちる。
const _pad = n => String(n).padStart(2, '0')
const _localDate = d => `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`
const TODAY = _localDate(new Date())
// 時刻もローカル基準で組み立てる。どのtimezoneでも同じローカル日のマスに載る。
const iso = (d, h = 12) => {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day, h).toISOString()
}

let sessionsResponse = []
const deleteSessionMock = vi.fn(async () => ({}))

// 無料枠の上限は 2026-08-30 に既定 off にした（実運用優先・planLimits.js 参照）。
// 上限そのものが正しく効くかは残したいので、この束だけ「効いている」状態へ固定する。
// 実行時フラグ（setFreeLimitsEnforced）ではなく mock にしているのは、この画面を
// 動的 import で読み込んでおり、モジュール実体が共有されるとは限らないため。
vi.mock('../utils/planLimits.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, limitsEnforced: () => true, historyLimit: () => actual.FREE_HISTORY_COUNT }
})

vi.mock('../utils/api.js', () => ({
  HTTP_BASE: 'https://worker.test',
  apiFetch: vi.fn(async () => ({})),
  setAuthInvalidatedHandler: vi.fn(),
}))
vi.mock('../composables/useAuth.js', () => ({
  getSessions:     vi.fn(async () => sessionsResponse),
  deleteSession:   (...a) => deleteSessionMock(...a),
  logout:          vi.fn(),
  isAuthenticated: { value: true },
  storeName:       { value: 'テスト店' },
}))
vi.mock('../composables/useWeather.js', () => ({
  useWeather: () => ({ state: { loc: null, weather: {}, loading: false, error: null } }),
  requestGeolocation: vi.fn(),
}))

let app = null
let host = null

async function mountPage(props = {}) {
  const { default: HistoryCalendarPage } = await import('./HistoryCalendarPage.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(HistoryCalendarPage, props)
  app.mount(host)
  for (let i = 0; i < 6; i++) await nextTick()   // onMounted の _loadSessions を待つ
  return host
}

function completed(id, date) {
  return { id, status: 'completed', type: 'stock', startedAt: iso(date, 9), endedAt: iso(date) }
}

describe('HistoryCalendarPage', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionsResponse = []
    deleteSessionMock.mockClear()
  })
  afterEach(() => {
    if (app)  { app.unmount(); app = null }
    if (host) { host.remove();  host = null }
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('カレンダーと戻る導線を持つ', async () => {
    const root = await mountPage()
    expect(root.querySelector('.hc')).not.toBeNull()
    expect(root.querySelector('.hcp-title').textContent).toContain('履歴カレンダー')
    expect(root.querySelector('.hcp-back')).not.toBeNull()
  })

  it('戻るで back を通知する', async () => {
    const onBack = vi.fn()
    const root = await mountPage({ onBack })
    root.querySelector('.hcp-back').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('発注・進行中はカレンダーの棚卸として数えない', async () => {
    sessionsResponse = [
      completed('s1', TODAY),
      { id: 's2', status: 'completed', type: 'order', startedAt: iso(TODAY, 9), endedAt: iso(TODAY) },
      { id: 's3', status: 'active',    type: 'stock', startedAt: iso(TODAY, 9) },
    ]
    const root = await mountPage()
    expect(root.querySelector('.hcp-count').textContent).toContain('1回')
  })

  it('無料プランの上限を超える履歴は件数を明示する', async () => {
    sessionsResponse = ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04']
      .map((d, i) => completed(`s${i}`, d))
    const root = await mountPage()
    const notice = root.querySelector('.plan-limit-notice')
    expect(notice).not.toBeNull()
    expect(notice.textContent).toContain('過去 1件')
  })

  it('日付が変わった直後に終えた棚卸も、その日のマスへ載る', async () => {
    // UTCの日付で束ねると、ローカルと日付が違う時間帯（JSTなら00:00〜09:00）に
    // 終えた棚卸が前日へ回る。ローカルのoffsetが0の環境では差が出ない。
    const justAfterMidnight = new Date()
    justAfterMidnight.setHours(0, 30, 0, 0)
    const at = justAfterMidnight.toISOString()
    sessionsResponse = [{ id: 's1', status: 'completed', type: 'stock', startedAt: at, endedAt: at }]
    const root = await mountPage()

    expect(root.querySelector('.hc-entry-del')).not.toBeNull()
  })

  it('削除は確認を挟み、拒否すればAPIを呼ばない', async () => {
    sessionsResponse = [completed('s1', TODAY)]
    vi.stubGlobal('confirm', vi.fn(() => false))
    const root = await mountPage()
    const del = root.querySelector('.hc-entry-del')
    expect(del).not.toBeNull()
    del.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    for (let i = 0; i < 4; i++) await nextTick()
    expect(confirm).toHaveBeenCalled()
    expect(deleteSessionMock).not.toHaveBeenCalled()
  })
})
