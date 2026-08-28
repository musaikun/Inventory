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
// 戻るの受け皿（sentinel）が前に積まれているか。
// jsdom は popstate を投げても履歴の位置が動かないため、実ブラウザの
// 「受け皿が無ければアプリを離れる」は再現できない。積み直しの有無で代替する。
let pushSpy = null
const sentinelCount = () => pushSpy.mock.calls.length

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

describe('アプリを閉じる前に確認する', () => {
  const exitTitle = () => [...host.querySelectorAll('.name-modal-title')]
    .find(e => e.textContent.includes('アプリを終了しますか'))

  it('閉じるものが無いところまで戻ると、確認を出して留まる', async () => {
    await mountApp()
    await seedItems()
    expect(view()).toBe('sessions')

    await deviceBack()                       // ホーム → ランディング（閉じるものがあった）
    expect(view()).toBe('landing')
    expect(exitTitle()).toBeFalsy()

    await deviceBack()                       // ここから先は閉じるものが無い
    expect(exitTitle()).toBeTruthy()         // いきなり離れず確認を出す
    expect(view()).toBe('landing')           // 画面は残る
  }, 20000)

  it('キャンセルすると留まり、受け皿も残る', async () => {
    await mountApp()
    await seedItems()
    await deviceBack()

    pushSpy = vi.spyOn(window.history, 'pushState')
    await deviceBack()
    expect(exitTitle()).toBeTruthy()
    expect(sentinelCount()).toBe(1)          // 確認を出したうえで受け皿は積み直す

    await click(host.querySelector('.btn-secondary'))
    expect(exitTitle()).toBeFalsy()

    await deviceBack()                       // もう一度戻ると、また確認が出る
    expect(exitTitle()).toBeTruthy()
  }, 20000)

  it('確認が開いているあいだの戻るはキャンセル扱い', async () => {
    await mountApp()
    await seedItems()
    await deviceBack()
    await deviceBack()
    expect(exitTitle()).toBeTruthy()

    await deviceBack()
    expect(exitTitle()).toBeFalsy()          // 閉じるだけでアプリは離れない
  }, 20000)

  it('「終了する」を選ぶと履歴を戻ってアプリを離れる', async () => {
    await mountApp()
    await seedItems()
    await deviceBack()
    await deviceBack()

    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    await click(host.querySelector('.exit-modal-ok'))
    expect(exitTitle()).toBeFalsy()
    expect(backSpy).toHaveBeenCalled()       // 受け皿を戻って離脱へ
    backSpy.mockRestore()
  }, 20000)

  it('進み直したあとのデータ管理でも、戻るはホームへ返る', async () => {
    await mountApp()
    await seedItems()
    await deviceBack()                       // ランディングまで戻る
    await deviceBack()                       // 終了確認
    await click(host.querySelector('.btn-secondary'))

    await click(button('はじめる') || button('使ってみる') || host.querySelector('button'))
    await flush()
    await click(byText('データ管理'))
    expect(view()).toBe('master')

    await deviceBack()
    expect(view()).toBe('sessions')          // アプリを離れず、ホームへ
  }, 20000)
})

describe('振り分け画面の中でも受け皿を切らさない', () => {
  // User報告: 分類先一覧 → 品目一覧 → 戻る → 分類先一覧 → 品目一覧 → 戻る でアプリが閉じる。
  // 振り分けの2カードは同じ view の中のスライドなので、view を見ているだけでは
  // 受け皿を積み直す機会が無い。操作（pointerdown）でも積み直す。
  async function openAssign() {
    const { useConfig } = await import('./composables/useConfig.js')
    const cfg = useConfig()
    cfg.setEmptyList()
    cfg.addItem('トマト', 120, '野菜', '個')
    cfg.setAxisName(0, '場所')
    cfg.addAxisGroup(0, '冷蔵庫')
    await flush()
    const { showAxisAssign } = await import('./composables/appMenuState.js')
    showAxisAssign.value = true
    await flush()
  }
  const slide = () => host.querySelector('.af-track').style.transform

  // 実機のタップは pointerdown → click の順に来る
  async function tap(el) {
    el.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()
  }

  it('分類先一覧 ⇄ 品目一覧 を繰り返しても、毎回スライドで返る', async () => {
    await mountApp()
    await openAssign()

    for (let i = 0; i < 3; i++) {
      await tap(host.querySelector('.af-gcard'))
      expect(slide()).toContain('calc(-50%')      // 品目一覧へ
      await deviceBack()
      expect(slide()).toContain('calc(0%')        // 分類先一覧へ戻る
      expect(host.querySelector('.af')).toBeTruthy()
    }
  }, 20000)

  it('受け皿が失われていても、画面を触った時点で積み直す', async () => {
    await mountApp()
    await openAssign()

    // ブラウザが受け皿を読み飛ばした状況を作る（履歴の現在地に印が無い）
    window.history.replaceState({}, '', '/')
    pushSpy = vi.spyOn(window.history, 'pushState')

    await tap(host.querySelector('.af-gcard'))
    expect(sentinelCount()).toBeGreaterThan(0)    // 操作の時点で積み直している
    expect(slide()).toContain('calc(-50%')

    await deviceBack()
    expect(slide()).toContain('calc(0%')
  }, 20000)
})

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
