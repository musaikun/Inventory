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

async function seedItems() {
  const { useConfig } = await import('./composables/useConfig.js')
  const cfg = useConfig()
  cfg.setEmptyList()
  cfg.addItem('トマト', 120, '野菜', '個')
  await flush()
}

describe('再読込しても同じページに留まる', () => {
  it('仕入れ', async () => {
    await mountApp()
    await seedItems()
    await click(button('入出庫') || button('仕入れ'))
    expect(view()).toBe('movement')

    await reload()
    expect(view()).toBe('movement')
  }, 20000)

  it('仕入れはタブまで戻る', async () => {
    await mountApp()
    await seedItems()
    await click(button('入出庫') || button('仕入れ'))
    await click(button('発注'))
    expect(host.querySelector('.mv-tab.on').textContent).toContain('発注')

    await reload()
    expect(view()).toBe('movement')
    expect(host.querySelector('.mv-tab.on').textContent).toContain('発注')
  }, 20000)

  it('履歴カレンダー', async () => {
    await mountApp()
    await seedItems()
    await click(button('履歴'))
    expect(view()).toBe('history')

    await reload()
    expect(view()).toBe('history')
  }, 20000)

  it('データ管理', async () => {
    await mountApp()
    await seedItems()
    // データ管理はカード（品目マスタ）から開く
    await click(host.querySelector('.master-card') || button('データ管理'))
    expect(view()).toBe('master')

    await reload()
    expect(view()).toBe('master')
  }, 20000)

  it('進行中セッションは保存ページより優先する', async () => {
    await mountApp()
    await seedItems()
    await click(button('入出庫') || button('仕入れ'))
    expect(view()).toBe('movement')

    // 仕入れページに居るあいだに、別端末などで進行中の棚卸が残った状態を作る
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
    await click(button('入出庫') || button('仕入れ'))
    await click(button('戻る'))
    expect(view()).toBe('sessions')

    await reload()
    expect(view()).toBe('sessions')
  }, 20000)
})
