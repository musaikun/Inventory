import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'

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

let app = null
let host = null

async function flush(n = 4) {
  for (let i = 0; i < n; i++) await nextTick()
}

async function mountApp() {
  window.history.replaceState({}, '', '/')
  const { default: App } = await import('./App.vue')
  apiFetchMock.mockImplementation(path => {
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

function pressBrowserBack() {
  window.dispatchEvent(new PopStateEvent('popstate'))
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

describe('画面内の「戻る」も import中断guard を見る', () => {
  // モーダルには focus trap が無いので、ポインタを overlay で塞いでも
  // キーボードの Tab で背景の「‹ 戻る」へ到達して実行できる。
  // そこで view が切り替わるとモーダルごと unmount され、確定していない
  // importBatchId と計画を失う（履歴に別の取消導線が無い）。
  //
  // ページの判定は root class で行う（見出し文言はセッション一覧のカードにも出るため）。
  //   .mp = MasterManagePage / .mv = MovementPage
  function backButton(root) {
    return [...root.querySelectorAll('button')].find(b => b.textContent.includes('戻る'))
  }
  async function clickEl(el) {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush(8)
  }

  async function openMaster(el) {
    await clickEl(el.querySelector('.master-card'))
    expect(el.querySelector('.mp')).not.toBeNull()
  }
  async function openMovement(el) {
    await clickEl(el.querySelector('.move-start'))
    expect(el.querySelector('.mv')).not.toBeNull()
  }

  for (const [label, open, sel] of [
    ['データ管理（MasterManagePage）', openMaster,   '.mp'],
    ['入出庫（MovementPage）',        openMovement, '.mv'],
  ]) {
    it(`${label}: guard中は画面内の戻るで画面が変わらない`, async () => {
      const el = await mountApp()
      await open(el)

      const { registerModalBackGuard } = await import('./composables/appMenuState.js')
      const unregister = registerModalBackGuard(() => true)

      const before = el.textContent
      await clickEl(backButton(el))

      // ページに留まる ＝ 子のモーダルも unmount されず、batchID と計画を保持できる
      expect(el.querySelector(sel)).not.toBeNull()
      expect(el.textContent).toBe(before)

      unregister()
    }, 15000)

    it(`${label}: guard解除後は画面内の戻るで通常どおり戻れる`, async () => {
      const el = await mountApp()
      await open(el)

      const { registerModalBackGuard } = await import('./composables/appMenuState.js')
      registerModalBackGuard(() => true)()   // 登録してすぐ解除

      await clickEl(backButton(el))
      expect(el.querySelector(sel)).toBeNull()
    }, 15000)
  }
})
