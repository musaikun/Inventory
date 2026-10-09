// リロードしても同じページに留まる（データ管理・履歴カレンダー・仕入れ）。
//
// このアプリはURLルーティングを持たないので、行き先は localStorage の保存値で決まる。
// 守りたい契約:
//   ・独立ページ3つだけが対象。ホーム・セッションから再読込したら従来どおりの行き先
//   ・進行中セッションは保存ページより優先する（数えかけの棚卸へ戻せないほうが実害が大きい）
//   ・仕入れはタブまで戻す
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
  apiFetchMock.mockImplementation((path) => {
    if (path === '/store/STOREA') return Promise.resolve({ shopCode: 'STOREA', activeRoom: null })
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

// 実際の再読込に相当: 同じ localStorage のまま App を作り直す
async function reload() {
  app.unmount(); host.remove()
  app = null; host = null
  vi.resetModules()
  return mountApp()
}

const button = (label) => [...host.querySelectorAll('button')].find(b => b.textContent.includes(label))
async function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flush()
}

const view = () => document.body.dataset.view

beforeAll(async () => { await import('./App.vue'); vi.resetModules() })

beforeEach(() => {
  vi.resetModules()
  localStorage.clear(); sessionStorage.clear()
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

async function seedItems() {
  const { useConfig } = await import('./composables/useConfig.js')
  const cfg = useConfig()
  cfg.setEmptyList()
  cfg.addItem('トマト', 120, '野菜', '個')
  await flush()
}

describe('再読込しても同じページに留まる', () => {
  it('入出庫の記録の画面で閉じていても、開き直すとホーム（入口を外した・2026-10-04）', async () => {
    localStorage.setItem('_last_page_v1', JSON.stringify({ view: 'movement', tab: 'out' }))
    await mountApp()
    await seedItems()
    await reload()
    expect(view()).toBe('sessions')
  }, 20000)

  // 履歴はホームの下部ナビのタブになった（2026-09-30）。再読み込みしても履歴タブのまま
  it('日誌タブ（以前のカレンダー）。見え方（月）も再読み込みで残る', async () => {
    await mountApp()
    await seedItems()
    await click([...host.querySelectorAll('.bnav button')].find(b => b.textContent.includes('日誌')))
    expect(host.querySelector('.jp')).not.toBeNull()
    await click([...host.querySelectorAll('.jp-views button')].find(b => b.textContent.includes('月')))
    expect(host.querySelector('.hcp.embedded')).not.toBeNull()

    await reload()
    expect(view()).toBe('sessions')
    expect(host.querySelector('.bnav button.on').textContent).toContain('日誌')
    expect(host.querySelector('.hcp')).not.toBeNull()
  }, 20000)

  it('管理タブ（データ管理）', async () => {
    await mountApp()
    await seedItems()
    // データ管理はホームの「管理」タブそのもの（2026-10-01）
    await click([...host.querySelectorAll('.bnav button')].find(b => b.textContent.includes('管理')))
    expect(host.querySelector('.mp')).toBeTruthy()

    await reload()
    expect(view()).toBe('sessions')
    expect(host.querySelector('.bnav button.on').textContent).toContain('管理')
  }, 20000)

  it('進行中セッションは保存ページより優先する', async () => {
    await mountApp()
    await seedItems()
    await click([...host.querySelectorAll('.bnav button')].find(b => b.textContent.includes('日誌')))

    // 日誌を見ているあいだに、別端末などで進行中の棚卸が残った状態を作る
    localStorage.setItem('_pending_session_v1', JSON.stringify({
      id: 'sess-1', shopCode: 'STOREA', status: 'active',
      startedAt: new Date().toISOString(), itemCount: 0,
    }))

    await reload()
    expect(view()).toBe('session')
  }, 20000)

  it('ホームで再読込したらホームのまま', async () => {
    await mountApp()
    await seedItems()
    expect(view()).toBe('sessions')

    await reload()
    expect(view()).toBe('sessions')
  }, 20000)
})
