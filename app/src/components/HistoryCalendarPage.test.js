// 履歴カレンダーを専用ページへ移したことの回帰。
// 守りたいのは「ホームから1タップで履歴に入り、そこで完結する」こと:
// 完了済み棚卸だけをカレンダーへ渡す、Free上限を明示する、戻れる、削除は確認を挟む。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'

const TODAY = new Date().toISOString().slice(0, 10)
const iso = (d, h = '02') => `${d}T${h}:00:00.000Z`

let sessionsResponse = []
const deleteSessionMock = vi.fn(async () => ({}))

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
  return { id, status: 'completed', type: 'stock', startedAt: iso(date, '01'), endedAt: iso(date) }
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
      { id: 's2', status: 'completed', type: 'order', startedAt: iso(TODAY, '01'), endedAt: iso(TODAY) },
      { id: 's3', status: 'active',    type: 'stock', startedAt: iso(TODAY, '01') },
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
