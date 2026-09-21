/**
 * 同じ日に2回目の棚卸を始めたとき（User指示 2026-09-21）。
 *
 * 以前は**別のセッションとして2本できていた**。数え直しのつもりで始めた2回目が、
 * 1回目と並んで履歴に残り、消費の計算も「同じ日に2回棚卸した」ものとして扱われる。
 * たいていは続きか数え直しなので、まず「続きから」を勧める。
 * 別の棚卸として増やす道も残す（本当に2回数える日もある）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'

const TODAY = new Date()
const iso = (d) => d.toISOString()
const DONE_TODAY = {
  id: 'sess-today', type: 'stock', status: 'completed',
  startedAt: iso(new Date(TODAY.getTime() - 3600_000)), endedAt: iso(TODAY), itemCount: 12,
}
const DONE_YESTERDAY = {
  id: 'sess-yesterday', type: 'stock', status: 'completed',
  startedAt: iso(new Date(TODAY.getTime() - 26 * 3600_000)),
  endedAt:   iso(new Date(TODAY.getTime() - 25 * 3600_000)), itemCount: 12,
}

let sessionList = []
vi.mock('../utils/api.js', () => ({
  HTTP_BASE: 'https://worker.test',
  apiFetch: vi.fn(async () => ({})),
  setAuthInvalidatedHandler: vi.fn(),
}))
const createSession = vi.fn(async () => ({ id: 'sess-new', type: 'stock', status: 'active' }))
vi.mock('../composables/useAuth.js', () => ({
  getSessions:     vi.fn(async () => sessionList),
  createSession:   (...a) => createSession(...a),
  updateSession:   vi.fn(),
  deleteSession:   vi.fn(),
  logout:          vi.fn(),
  isAuthenticated: { value: true },
  storeName:       { value: 'テスト店' },
}))
vi.mock('../composables/useSync.js', () => ({ fetchRoomStatus: vi.fn(async () => null) }))
vi.mock('../composables/useWeather.js', () => ({
  useWeather: () => ({ state: { loc: null, weather: {}, loading: false, error: null } }),
  requestGeolocation: vi.fn(),
}))

let app = null, host = null, events = []

/** 品目リストが入っている端末にする（空だと開始前に取込の案内が挟まる） */
function seedConfig() {
  localStorage.setItem('inventory_config_v1', JSON.stringify({
    order: ['トマト', 'レタス'], units: { トマト: '箱', レタス: '玉' },
    isCustom: true, savedAt: new Date().toISOString(),
  }))
}

async function mountPage() {
  const { default: SessionListPage } = await import('./SessionListPage.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(SessionListPage, {
    onStartSession:  (s) => events.push(['start', s?.id]),
    onResumeSession: (s) => events.push(['resume', s?.id]),
  })
  app.mount(host)
  for (let i = 0; i < 8; i++) await nextTick()
  return host
}
/** 開始を押す（品目リストが入っていれば、そのまま開始まで進む） */
async function pressStart(root) {
  root.querySelector('.hero-start').click()
  for (let i = 0; i < 8; i++) await nextTick()
}

beforeEach(() => { localStorage.clear(); seedConfig(); events = []; createSession.mockClear() })
afterEach(() => {
  if (app) { app.unmount(); app = null }
  if (host) { host.remove(); host = null }
  vi.resetModules()
  delete globalThis.confirm
})

describe('本日すでに棚卸が終わっているとき', () => {
  it('「再編集でいいですか？」と訊いて、OKならその棚卸の続きから', async () => {
    sessionList = [DONE_TODAY]
    let asked = ''
    globalThis.confirm = (m) => { asked = m; return true }
    const root = await mountPage()
    await pressStart(root)

    expect(asked).toContain('本日すでに棚卸は行われています')
    expect(asked).toContain('再編集')
    expect(events).toEqual([['resume', 'sess-today']])
    expect(createSession).not.toHaveBeenCalled()   // 新しいセッションは作らない
  })

  it('キャンセルなら、別の棚卸として新しく始める（本当に2回数える日もある）', async () => {
    sessionList = [DONE_TODAY]
    globalThis.confirm = () => false
    const root = await mountPage()
    await pressStart(root)

    expect(createSession).toHaveBeenCalled()
    expect(events).toEqual([['start', 'sess-new']])
  })
})

describe('本日はまだ棚卸していないとき', () => {
  it('何も訊かずに始める', async () => {
    sessionList = [DONE_YESTERDAY]
    let asked = false
    globalThis.confirm = () => { asked = true; return true }
    const root = await mountPage()
    await pressStart(root)

    expect(asked).toBe(false)
    expect(createSession).toHaveBeenCalled()
  })

  it('完了が1件も無くても始められる', async () => {
    sessionList = []
    globalThis.confirm = () => true
    const root = await mountPage()
    await pressStart(root)
    expect(createSession).toHaveBeenCalled()
  })
})
