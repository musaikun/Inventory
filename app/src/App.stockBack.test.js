// 棚卸セッションで端末/ブラウザの「戻る」を押したときの行き先。
//
// ホームのタブ（_persistedTab）と在庫分析 overlay（_showDashboard）は SessionListPage の
// モジュールスコープにあり、画面を跨いで残る。そのため
//   - ダッシュボードタブを見てから棚卸へ入る → 戻るとダッシュボードタブに出る
//   - overlay を開いたまま棚卸へ入る → セッション画面での戻るが overlay 側に食われる
// が起きていた。棚卸から戻る先は常に**ホームの「セッション」タブ**（主導線）にする。
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { flush, click, warmApp, resetSignedIn, stubStoreApi, mountApp as mountTestApp, unmountApp, teardownApp } from './test-support/appHarness.js'

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

let host = null


async function mountApp() {
  stubStoreApi(apiFetchMock, { createdSession: { id: 'stk-1', type: 'stock', status: 'active' } })
  host = await mountTestApp('/')
  return host
}


async function browserBack() {
  window.dispatchEvent(new PopStateEvent('popstate'))
  await flush(20)   // onGoHome は markSessionActive の応答を待ってから画面を切り替える
}

const inSession   = () => !!host.querySelector('.home-btn')
const onHomeMain  = () => !!host.querySelector('.ht-grid')         // ホームタブのショートカット
// 棚卸・発注の開始はホームのショートカットだけ（在庫タブには置かない・User決定 2026-10-10）
const shortcut = label => [...host.querySelectorAll('.ht-grid .ht-sc')].find(b => b.querySelector('b')?.textContent === label)
// ホームのタブに居なければ、下のナビの「ホーム」へ移ってから押す
async function goShortcut(label) {
  if (!shortcut(label)) await click([...host.querySelectorAll('.bnav button')].find(b => b.textContent.includes('ホーム')))
  return shortcut(label)
}

const homeTabName = () => host.querySelector('.bnav button.on')?.textContent.trim()

async function startStockSession() {
  const { useConfig } = await import('./composables/useConfig.js')
  const cfg = useConfig()
  cfg.setEmptyList()
  cfg.addItem('トマト', 120, '野菜', '個')
  await flush()

  await click(await goShortcut('棚卸'))          // 開始シートを開く
  await click(host.querySelector('.sh .bb.stock'))       // ひとりで始める
  expect(inSession()).toBe(true)
}

beforeAll(warmApp)

beforeEach(() => {
  resetSignedIn()
  localStorage.setItem('tanaoro_onboarded', '1')   // 初回オンボーディングに戻るを食わせない
})

afterEach(() => {
  teardownApp()
  host = null
})

describe('棚卸セッションでブラウザの戻る', () => {
  it('ホームタブへ戻る（開始もホームから・User決定 2026-10-10）', async () => {
    await mountApp()
    await startStockSession()

    await browserBack()

    expect(inSession()).toBe(false)
    expect(onHomeMain()).toBe(true)
    expect(homeTabName()).toContain('ホーム')
  }, 20000)

  it('管理タブを見てから始めても、戻るとホームタブに出る', async () => {
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
    expect(homeTabName()).toContain('ホーム')
    expect(list._persistedTab.value).toBe('home')
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
