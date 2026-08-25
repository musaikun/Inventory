// 発注セッションから「戻る」を押したときの行き先。
//
// 発注はホームに入口が無く、「仕入れ」カードの発注タブからしか始められない。
// 戻るでホームへ返すと、発注一覧まで（ホーム → 仕入れ → 発注タブ）と一段遠くなり、
// 続けて発注を見るのが手間になる。始めた場所＝発注タブへ返す。
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
        id: 'ord-1', type: 'order', status: 'active', startedAt: new Date().toISOString(),
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

const button = (label) => [...host.querySelectorAll('button')].find(b => b.textContent.includes(label))
async function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flush()
}

const movementPage = () => host.querySelector('.mv')
const activeTab = () => host.querySelector('.mv-tab.on')?.textContent.trim()

// ホーム → 仕入れ → 発注タブ → 発注を開始
async function startOrderSession() {
  await click(button('入出庫') || button('仕入れ'))
  expect(movementPage()).not.toBeNull()
  await click(button('発注'))
  await click(host.querySelector('.mv-order-start'))
}

beforeAll(async () => { await import('./App.vue'); vi.resetModules() })

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  localStorage.setItem('_auth_token', 'tok-1')
  localStorage.setItem('_auth_store_name', 'A店')
  localStorage.setItem('_shop_code', 'STOREA')
})

afterEach(() => {
  if (app) { app.unmount(); app = null }
  if (host) { host.remove(); host = null }
  window.history.replaceState({}, '', '/')
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('発注セッションの戻る', () => {
  it('「仕入れ」カードの発注タブへ返る（ホームではない）', async () => {
    await mountApp()
    const { useConfig } = await import('./composables/useConfig.js')
    const cfg = useConfig()
    cfg.setEmptyList()
    cfg.addItem('トマト', 120, '野菜', '個')
    await flush()

    await startOrderSession()
    // 発注セッション画面にいる（仕入れページは閉じている）
    expect(movementPage()).toBeNull()

    // セッションを離れるボタン（ヘッダー左）。発注中は行き先が「仕入れ」なので 🛒 になる
    const leave = host.querySelector('.home-btn')
    expect(leave.textContent.trim()).toBe('🛒')
    expect(leave.getAttribute('title')).toBe('仕入れに戻る')
    await click(leave)

    expect(movementPage()).not.toBeNull()
    expect(activeTab()).toContain('発注')
  }, 20000)

  it('棚卸セッションは従来どおりホーム（セッション一覧）へ返る', async () => {
    await mountApp()
    const { useConfig } = await import('./composables/useConfig.js')
    const cfg = useConfig()
    cfg.setEmptyList()
    cfg.addItem('トマト', 120, '野菜', '個')
    await flush()

    await click(host.querySelector('.hero-start'))
    const confirm = host.querySelector('.start-btn.primary')
    if (confirm) await click(confirm)

    const leave = host.querySelector('.home-btn')
    expect(leave.textContent.trim()).toBe('🏠')
    expect(leave.getAttribute('title')).toBe('セッション一覧に戻る')
    await click(leave)

    expect(movementPage()).toBeNull()
    expect(host.querySelector('.hero-start')).not.toBeNull()   // ホームに戻っている
  }, 20000)

  it('ホームから開いた「仕入れ」は在庫タブから始まる', async () => {
    await mountApp()
    const { useConfig } = await import('./composables/useConfig.js')
    const cfg = useConfig()
    cfg.setEmptyList()
    cfg.addItem('トマト', 120, '野菜', '個')
    await flush()

    await click(button('入出庫') || button('仕入れ'))
    expect(activeTab()).toBe('在庫')
  }, 20000)
})
