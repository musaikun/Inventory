// 棚卸セッションで端末/ブラウザの「戻る」を押したときの行き先。
//
// ホームのタブ（_persistedTab）と在庫分析 overlay（_showDashboard）は SessionListPage の
// モジュールスコープにあり、画面を跨いで残る。そのため
//   - ダッシュボードタブを見てから棚卸へ入る → 戻るとダッシュボードタブに出る
//   - overlay を開いたまま棚卸へ入る → セッション画面での戻るが overlay 側に食われる
// が起きていた。棚卸から戻る先は常に**ホームの「セッション」タブ**（主導線）にする。
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }))

vi.mock('./utils/api.js', () => ({
  HTTP_BASE: 'https://worker.test',
  WS_BASE: 'wss://worker.test',
  apiFetch: apiFetchMock,
  setAuthInvalidatedHandler: vi.fn(),
}))
vi.mock('./utils/analytics.js', () => ({
  initAnalytics: vi.fn(), track: vi.fn(), resetAnalytics: vi.fn(),
}))

let app = null
let host = null

async function flush(n = 6) {
  for (let i = 0; i < n; i++) await nextTick()
}

async function mountApp() {
  window.history.replaceState({}, '', '/')
  const { default: App } = await import('./App.vue')
  apiFetchMock.mockImplementation((path, opts = {}) => {
    if (path === '/store/STOREA') return Promise.resolve({ shopCode: 'STOREA', activeRoom: null })
    if (path === '/store/STOREA/sessions' && opts.method === 'POST') {
      return Promise.resolve({
        id: 'stk-1', type: 'stock', status: 'active', startedAt: new Date().toISOString(),
      })
    }
    if (typeof path === 'string' && (path.endsWith('/sessions') || path.endsWith('/history'))) {
      return Promise.resolve([])
    }
    return Promise.resolve({})
  })

  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(App)
  app.mount(host)
  await flush()
  return host
}

async function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flush()
}

async function browserBack() {
  window.dispatchEvent(new PopStateEvent('popstate'))
  await flush(20)   // onGoHome は markSessionActive の応答を待ってから画面を切り替える
}

const inSession   = () => !!host.querySelector('.home-btn')
const onHomeMain  = () => !!host.querySelector('.act.stock')       // ホームの操作ボタン「棚卸」
const homeTabName = () => host.querySelector('.bnav button.on')?.textContent.trim()

async function startStockSession() {
  const { useConfig } = await import('./composables/useConfig.js')
  const cfg = useConfig()
  cfg.setEmptyList()
  cfg.addItem('トマト', 120, '野菜', '個')
  await flush()

  await click(host.querySelector('.act.stock'))          // 開始シートを開く
  await click(host.querySelector('.sh .bb.stock'))       // ひとりで始める
  expect(inSession()).toBe(true)
}

beforeAll(async () => { await import('./App.vue'); vi.resetModules() })

beforeEach(() => {
  vi.resetModules()
  localStorage.clear(); sessionStorage.clear()
  localStorage.setItem('_auth_token', 'tok-1')
  localStorage.setItem('_auth_store_name', 'A店')
  localStorage.setItem('_shop_code', 'STOREA')
  localStorage.setItem('tanaoro_onboarded', '1')   // 初回オンボーディングに戻るを食わせない
})

afterEach(() => {
  if (app) { app.unmount(); app = null }
  if (host) { host.remove(); host = null }
  window.history.replaceState({}, '', '/')
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('棚卸セッションでブラウザの戻る', () => {
  it('ホームのメイン画面（在庫タブ）へ戻る', async () => {
    await mountApp()
    await startStockSession()

    await browserBack()

    expect(inSession()).toBe(false)
    expect(onHomeMain()).toBe(true)
    expect(homeTabName()).toContain('在庫')
  }, 20000)

  it('管理タブを見てから始めても、戻ると在庫タブに出る', async () => {
    await mountApp()
    const list = await import('./components/SessionListPage.vue')

    // ホームで管理タブへ切り替えてから棚卸を開始する
    list._persistedTab.value = 'dashboard'
    await flush()
    expect(homeTabName()).toContain('管理')
    list._persistedTab.value = 'sessions'
    await flush()
    await startStockSession()
    list._persistedTab.value = 'dashboard'   // 棚卸中もホーム側のタブは残ったまま

    await browserBack()

    expect(onHomeMain()).toBe(true)
    expect(homeTabName()).toContain('在庫')
    expect(list._persistedTab.value).toBe('sessions')
  }, 20000)

  it('在庫分析を開いたまま棚卸へ入っても、1回の戻るでホームへ抜ける', async () => {
    await mountApp()
    const list = await import('./components/SessionListPage.vue')

    await startStockSession()
    list._showDashboard.value = true   // ホーム側の overlay フラグが残っている状態

    await browserBack()

    expect(inSession()).toBe(false)
    expect(onHomeMain()).toBe(true)
    expect(list._showDashboard.value).toBe(false)
  }, 20000)
})
