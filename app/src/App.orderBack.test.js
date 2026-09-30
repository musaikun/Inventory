// 発注セッションから「戻る」を押したときの行き先。
//
// 画面の再設計（2026-09-30）で、発注はホームの操作ボタンから始めるようになった。
// 以前は「仕入れ」の発注タブからしか始められず、戻る先も発注タブだった。今は棚卸と同じくホームへ返す。
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

// ホームの操作ボタン「発注」→ 開始シート →「ひとりで始める」
async function startOrderSession() {
  await click(host.querySelector('.act.order'))
  expect(host.querySelector('.sh').textContent).toContain('仕入先へは送信されません')   // 記録のみであることを開始前に言う
  await click(host.querySelector('.sh .bb.order'))
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
  async function seed() {
    const { useConfig } = await import('./composables/useConfig.js')
    const cfg = useConfig()
    cfg.setEmptyList()
    cfg.addItem('トマト', 120, '野菜', '個')
    await flush()
  }

  it('発注もホームから始め、離れるとホームへ返る（仕入れの発注タブではない）', async () => {
    await mountApp()
    await seed()
    await startOrderSession()
    expect(movementPage()).toBeNull()

    const leave = host.querySelector('.home-btn')
    expect(leave.textContent.trim()).toBe('🏠')
    expect(leave.getAttribute('title')).toBe('ホームに戻る')
    await click(leave)

    expect(movementPage()).toBeNull()
    expect(host.querySelector('.act.order')).not.toBeNull()   // ホームに戻っている
  }, 20000)

  it('棚卸セッションもホームへ返る', async () => {
    await mountApp()
    await seed()
    await click(host.querySelector('.act.stock'))
    await click(host.querySelector('.sh .bb.stock'))

    const leave = host.querySelector('.home-btn')
    expect(leave.getAttribute('title')).toBe('ホームに戻る')
    await click(leave)
    expect(host.querySelector('.act.stock')).not.toBeNull()
  }, 20000)

  it('ホームの「入出庫」は仕入れの入庫タブ、管理の「仕入れ」は在庫タブから開く', async () => {
    await mountApp()
    await seed()
    await click(host.querySelector('.act:not(.stock):not(.order)'))
    expect(activeTab()).toContain('入庫')

    await click(host.querySelector('.mv-back'))
    await click([...host.querySelectorAll('.bnav button')].find(b => b.textContent.includes('管理')))
    await click([...host.querySelectorAll('.m-card')].find(b => b.textContent.includes('仕入れ')))
    expect(activeTab()).toBe('在庫')
  }, 20000)
})
