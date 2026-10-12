import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { warmApp, resetSignedIn, stubStoreApi, mountApp as mountTestApp, teardownApp } from './test-support/appHarness.js'

// IMPORT-001: 閉じてはいけないモーダル（過去棚卸取込の結果不明・取消必須）が開いている
// あいだ、Android/PWA・ブラウザの「戻る」でも画面を切り替えないことを App 側で固定する。
//
// モーダル内の閉じるボタン・Escape・overlay だけを塞いでも、Back は App の
// `_closeTopLayer()` が直接 view を切り替えるため、子モーダルの requestClose() を
// 通らずに unmount される。そこで importBatchId と計画を失うと、サーバーに残ったかも
// しれない取込を取り消せなくなる（履歴画面に別の取消導線が無い）。
const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }))

vi.mock('./utils/api.js', () => ({
  HTTP_BASE: 'https://worker.test',
  WS_BASE: 'wss://worker.test',
  apiFetch: apiFetchMock,
  setAuthInvalidatedHandler: vi.fn(),
}))
vi.mock('./utils/analytics.js', () => ({
  initAnalytics: vi.fn(),
  track: vi.fn(),
  resetAnalytics: vi.fn(),
}))

let host = null

async function flush(n = 4) {
  for (let i = 0; i < n; i++) await nextTick()
}

async function mountApp() {
  stubStoreApi(apiFetchMock)
  host = await mountTestApp('/', { ticks: 4 })
  return host
}

function pressBrowserBack() {
  window.dispatchEvent(new PopStateEvent('popstate'))
}

beforeAll(warmApp)

beforeEach(() => {
  resetSignedIn()
})

afterEach(() => {
  teardownApp()
  host = null
})

describe('App の Back 制御は「閉じてはいけないモーダル」を最優先で見る', () => {
  it('guard 登録中は Back で画面が変わらず、戻る操作だけを消費する', async () => {
    const el = await mountApp()
    const { registerModalBackGuard } = await import('./composables/appMenuState.js')
    const unregister = registerModalBackGuard(() => true)

    const before = el.textContent
    const pushStateSpy = vi.spyOn(window.history, 'pushState')

    pressBrowserBack()
    await flush()

    // 何も閉じていない（画面が変わらない）
    expect(el.textContent).toBe(before)
    // sentinel を積み直している（次の Back でアプリを離れない）
    expect(pushStateSpy).toHaveBeenCalledTimes(1)

    unregister()
  }, 15000)

  it('guard を解除すれば従来どおり Back で画面が進む', async () => {
    const el = await mountApp()
    const { registerModalBackGuard } = await import('./composables/appMenuState.js')
    const unregister = registerModalBackGuard(() => true)
    unregister()

    const before = el.textContent
    pressBrowserBack()
    await flush()

    expect(el.textContent).not.toBe(before)
  }, 15000)

  it('guard が false を返すあいだは Back を止めない', async () => {
    const el = await mountApp()
    const { registerModalBackGuard } = await import('./composables/appMenuState.js')
    const unregister = registerModalBackGuard(() => false)

    const before = el.textContent
    pressBrowserBack()
    await flush()

    expect(el.textContent).not.toBe(before)
    unregister()
  }, 15000)
})

// 画面内の「戻る」の guard は入出庫の記録の画面（MovementPage）で見ていたが、その入口を外した（User 2026-10-04）

describe('DesktopNav（1024px以上）も import中断guard を見る', () => {
  // サイドナビは背景に居る。モーダルに focus trap / inert が無いので、overlay が
  // ポインタを遮っても Tab やスクリーンリーダーから実行できる。そこで view を変えると
  // MasterManagePage / MovementPage ごと unmount され、importBatchId と計画を失う。
  //
  // jsdom は matchMedia を持たないため既定ではモバイル経路になる。desktop 相当へ mock する。
  function mockDesktop() {
    window.matchMedia = (query) => ({
      matches: query === '(min-width: 1024px)',
      media: query,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {},
      onchange: null, dispatchEvent: () => false,
    })
  }

  afterEach(() => { delete window.matchMedia })

  it('デスクトップではサイドナビが出る（前提の確認）', async () => {
    mockDesktop()
    const el = await mountApp()
    expect(el.querySelector('.dt-nav-list')).not.toBeNull()
  }, 15000)

  // 入出庫の記録の画面（MovementPage）は入口を外した（User 2026-10-04）
})
