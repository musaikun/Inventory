// S8 — ホームを棚卸中心へ戻したことの回帰。
// 守りたいのは見た目ではなく順路: 「品目を準備 → 棚卸 → 記録を見る」が第一導線で、
// 入出庫・発注はその下のβ機能として置かれていること。
// 並びが崩れると「どれから手を付けるのか」が読めなくなり、初回公開の狙いが消える。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({
  HTTP_BASE: 'https://worker.test',
  apiFetch: vi.fn(async () => ({})),
  setAuthInvalidatedHandler: vi.fn(),
}))
vi.mock('../composables/useAuth.js', () => ({
  getSessions:     vi.fn(async () => []),
  createSession:   vi.fn(),
  updateSession:   vi.fn(),
  deleteSession:   vi.fn(),
  logout:          vi.fn(),
  isAuthenticated: { value: true },
  storeName:       { value: 'テスト店' },
}))
vi.mock('../composables/useSync.js', () => ({
  fetchRoomStatus: vi.fn(async () => null),
}))
vi.mock('../composables/useWeather.js', () => ({
  useWeather: () => ({ state: { loc: null, weather: {}, loading: false, error: null } }),
  requestGeolocation: vi.fn(),
}))

let app = null
let host = null

async function mountPage(props = {}) {
  const { default: SessionListPage } = await import('./SessionListPage.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(SessionListPage, props)
  app.mount(host)
  await nextTick()
  await nextTick()   // onMounted の _loadSessions を待つ
  await nextTick()
  return host
}

// セッションパネル（トラック1枚目）の直下要素を上から並べたクラス列
function panelChildClasses(root) {
  const panel = root.querySelector('.tab-panels-track > .tab-panel')
  return [...panel.children].map(el => el.className)
}
function indexOfClass(classes, name) {
  return classes.findIndex(c => c.split(' ').includes(name))
}

describe('SessionListPage — 棚卸中心の順路', () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers() })
  afterEach(() => {
    if (app) { app.unmount(); app = null }
    if (host) { host.remove(); host = null }
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.resetModules()
  })

  it('準備 → 棚卸 → 記録 → β機能 の順に並ぶ', async () => {
    const root = await mountPage()
    const classes = panelChildClasses(root)

    const prep    = indexOfClass(classes, 'master-card')
    const count   = indexOfClass(classes, 'hero-start')
    const history = indexOfClass(classes, 'history-link')
    const beta    = indexOfClass(classes, 'beta-head')

    expect(prep).toBeGreaterThanOrEqual(0)
    expect(prep).toBeLessThan(count)
    expect(count).toBeLessThan(history)
    expect(history).toBeLessThan(beta)
  })

  it('仕入れはβ機能の区切りより下にある', async () => {
    const root = await mountPage()
    const classes = panelChildClasses(root)
    const beta  = indexOfClass(classes, 'beta-head')
    const group = indexOfClass(classes, 'beta-group')
    expect(beta).toBeGreaterThanOrEqual(0)
    expect(group).toBeGreaterThan(beta)

    const groupEl = root.querySelector('.beta-group')
    expect(groupEl.querySelector('.move-start')).not.toBeNull()
  })

  // 発注の開始・スケジュール設定は「仕入れ」ページ（発注タブ）へ集約した。
  // ホームに2つ目の発注入口を残すと、どちらが正か分からなくなる。
  it('ホームに発注の開始導線を持たない（仕入れカードへ集約）', async () => {
    const root = await mountPage()
    expect(root.querySelector('.order-start')).toBeNull()
    expect(root.querySelector('.order-sched')).toBeNull()
    const move = root.querySelector('.move-start')
    expect(move.textContent).toContain('仕入れ')
    expect(move.textContent).toContain('発注')
  })

  it('棚卸の開始が主操作として置かれている', async () => {
    const root = await mountPage()
    const hero = root.querySelector('.hero-start')
    expect(hero).not.toBeNull()
    expect(hero.textContent).toContain('棚卸を開始')
  })

  it('在庫表示が理論在庫であることと、誤差が出ることを明示する', async () => {
    const root = await mountPage()
    const move = root.querySelector('.move-start')
    expect(move.textContent).toContain('理論在庫')
    expect(move.textContent).toContain('ずれます')
  })

  it('履歴への導線が第一導線の終点にある', async () => {
    const root = await mountPage()
    const link = root.querySelector('.history-link')
    expect(link).not.toBeNull()
    expect(link.textContent).toContain('履歴カレンダー')
  })

  // 履歴カレンダーは専用ページへ移した。ホームはそこへの入口だけを持つ。
  it('履歴カレンダーを押すと専用ページへの遷移を要求する', async () => {
    const onOpenHistory = vi.fn()
    const root = await mountPage({ onOpenHistory })
    root.querySelector('.history-link').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(onOpenHistory).toHaveBeenCalledTimes(1)
  })

  it('ダッシュボードタブにカレンダー関連の表示を持たない', async () => {
    const root = await mountPage()
    const dashboard = root.querySelectorAll('.tab-panels-track > .tab-panel')[1]
    expect(dashboard).not.toBeUndefined()
    expect(dashboard.querySelector('.hc')).toBeNull()        // カレンダー本体
    expect(dashboard.querySelector('.wx-bar')).toBeNull()    // 天気の設定バー
    expect(dashboard.textContent).not.toContain('履歴')
  })
})
