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

  it('ホームの「入出庫」は入庫タブから開く。管理タブに「仕入れ」は無い（入口は1つ）', async () => {
    await mountApp()
    await seed()
    await click(host.querySelector('.act:not(.stock):not(.order)'))
    expect(activeTab()).toContain('入庫')

    await click(host.querySelector('.mv-back'))
    await click([...host.querySelectorAll('.bnav button')].find(b => b.textContent.includes('管理')))
    expect([...host.querySelectorAll('.m-card')].some(b => b.textContent.includes('仕入れ'))).toBe(false)
  }, 20000)
})

// 棚卸中・発注中の ☰ に「中断してホームへ」「破棄…」（画面遷移図の課題③・2026-10-01）。
// 破棄はその場で消さず、ホームの破棄の確認（件数・消す直前のサーバー確認）を開く。
describe('セッションの ☰ から中断・破棄', () => {
  let created = []
  async function mountWithSessions() {
    window.history.replaceState({}, '', '/')
    const { default: App } = await import('./App.vue')
    created = []
    apiFetchMock.mockImplementation((path, opts = {}) => {
      if (path === '/store/STOREA') return Promise.resolve({ shopCode: 'STOREA', activeRoom: null })
      if (path === '/store/STOREA/sessions' && opts.method === 'POST') {
        const s = { id: '11111111-1111-4111-8111-111111111111', type: 'stock', status: 'active', itemCount: 0, startedAt: new Date().toISOString() }
        created.push(s)
        return Promise.resolve(s)
      }
      if (path === '/store/STOREA/sessions') return Promise.resolve(created)
      if (typeof path === 'string' && path.endsWith('/history')) return Promise.resolve([])
      return Promise.resolve({})
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    app = createApp(App)
    app.mount(host)
    await flush()
    const { useConfig } = await import('./composables/useConfig.js')
    const cfg = useConfig()
    cfg.setEmptyList()
    cfg.addItem('トマト', 120, '野菜', '個')
    await flush()
  }
  async function openMenu() { await click(host.querySelector('.am-btn')) }

  it('☰ の「中断してホームへ」でホームに戻り、中断中の帯が出る', async () => {
    await mountWithSessions()
    await click(host.querySelector('.act.stock'))
    await click(host.querySelector('.sh .bb.stock'))
    await openMenu()
    await click(button('中断してホームへ'))
    await flush(10)
    expect(host.querySelector('.act.stock')).not.toBeNull()
    expect(host.querySelector('.strip.pause')).not.toBeNull()
  }, 20000)

  it('☰ の「破棄…」はホームへ戻って破棄の確認を開く（その場では消さない）', async () => {
    await mountWithSessions()
    await click(host.querySelector('.act.stock'))
    await click(host.querySelector('.sh .bb.stock'))
    await openMenu()
    await click(button('この棚卸を破棄'))
    await flush(10)
    expect(host.querySelector('.act.stock')).not.toBeNull()
    expect(host.querySelector('.sh').textContent).toContain('破棄')
    const deletes = apiFetchMock.mock.calls.filter(([, o]) => o?.method === 'DELETE')
    expect(deletes).toHaveLength(0)
  }, 20000)

  // ルームを作らなくても、名前をタップしたときと同じ「担当者ごとの変更履歴」を見られる（User 2026-10-02）
  it('ひとりの棚卸では ☰ の「自分の変更履歴」で自分の入力が見られる', async () => {
    await mountWithSessions()
    await click(host.querySelector('.act.stock'))
    await click(host.querySelector('.sh .bb.stock'))
    const { deviceId } = await import('./composables/useDeviceId.js')
    const { addLocalAuditEntry } = await import('./composables/useSync.js')
    addLocalAuditEntry({ id: 'local-1', ingredient: 'トマト', action: 'new', delta: 5, totalQty: 5, unit: '個', enteredBy: 'テスト', enteredById: deviceId, timestamp: Date.now() })
    await flush()
    await openMenu()
    const item = button('自分の変更履歴')
    expect(item).toBeTruthy()
    expect(item.textContent).toContain('1')
    await click(item)
    await flush()
    expect(document.body.textContent).toContain('トマト')
  }, 20000)
})
