// 戻るは常に「ひとつ前の画面」＝その画面へ来る前に居た画面へ返す。
//
// データ管理はホームと仕入れの両方から開けるのに、戻り先がホーム固定だった。
// 仕入れ → データ管理 → 戻る で仕入れではなくホームへ飛び、入り直しになっていた。
// 端末の戻るとページ内の戻るは、同じ「戻る」なので必ず同じ行き先にする。
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
  await flush()
  return host
}

const view   = () => document.body.dataset.view
const button = label => [...host.querySelectorAll('button')].find(b => b.textContent.includes(label))
const byText = label => [...host.querySelectorAll('button, .master-card, .flow-card')]
  .find(el => el.textContent.includes(label))

async function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flush()
}
// 端末（PWA / ブラウザ）の戻る
async function deviceBack() {
  window.dispatchEvent(new PopStateEvent('popstate'))
  await flush()
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

async function seedItems() {
  const { useConfig } = await import('./composables/useConfig.js')
  const cfg = useConfig()
  cfg.setEmptyList()
  cfg.addItem('トマト', 120, '野菜', '個')
  await flush()
}

async function openMovement() {
  await click(button('入出庫') || button('仕入れ'))
  expect(view()).toBe('movement')
}
async function openMasterFromMovement() {
  await click(button('データ管理へ'))
  expect(view()).toBe('master')
}

describe('戻るはひとつ前の画面へ返す', () => {
  it('ホーム → データ管理 → 戻る は ホーム', async () => {
    await mountApp()
    await seedItems()
    await click(byText('データ管理'))
    expect(view()).toBe('master')

    await deviceBack()
    expect(view()).toBe('sessions')
  }, 20000)

  it('仕入れ → データ管理 → 戻る は 仕入れ。もう一度でホーム', async () => {
    await mountApp()
    await seedItems()
    await openMovement()
    await openMasterFromMovement()

    await deviceBack()
    expect(view()).toBe('movement')     // 開いた元の画面へ返る（ホームではない）

    await deviceBack()
    expect(view()).toBe('sessions')     // 仕入れはホームから開いたのでホームへ
  }, 20000)

  it('往復したあとも戻るは行き止まりにならずホームへ抜ける', async () => {
    await mountApp()
    await seedItems()
    await openMovement()
    await openMasterFromMovement()

    // master ⇄ movement を行き来しても、戻るを続ければ必ずホームに着く
    for (let i = 0; i < 4 && view() !== 'sessions'; i++) await deviceBack()
    expect(view()).toBe('sessions')
  }, 20000)

  it('ページ内の戻るボタンも端末の戻ると同じ行き先', async () => {
    await mountApp()
    await seedItems()
    await openMovement()
    await openMasterFromMovement()

    await click(host.querySelector('.mm-back') || button('戻る') || button('‹'))
    expect(view()).toBe('movement')
  }, 20000)
})
