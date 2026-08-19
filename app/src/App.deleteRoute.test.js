import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'

// App レベルの回帰テスト。
// Google Play の Data deletion URL（`?delete-account`）は、アプリ未インストール・未ログインでも
// 到達できる必要がある。App が認証・room・セッション復元より先にこのルートを判定し、
// 実際に公開削除ページを描画することを固定する。
vi.mock('./utils/api.js', () => ({
  HTTP_BASE: 'https://worker.test',
  WS_BASE: 'wss://worker.test',
  apiFetch: vi.fn().mockResolvedValue({}),
  setAuthInvalidatedHandler: vi.fn(),
}))
vi.mock('./utils/analytics.js', () => ({
  initAnalytics: vi.fn(),
  track: vi.fn(),
  resetAnalytics: vi.fn(),
}))

let app = null
let host = null

async function mountApp(search) {
  window.history.replaceState({}, '', search)
  const { default: App } = await import('./App.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(App)
  app.mount(host)
  await nextTick()
  await nextTick()
  return host
}

// App のモジュールグラフを先に温める（既定 5 秒 testTimeout の枯渇対策）。
// 初回 import は transform とモジュール評価で数秒かかる。test 本体でこれを払うと
// 環境が混み合ったときに 5 秒へ届く。hook（既定 10 秒）で払い、直後に registry を
// 捨てることで、各 test は毎回まっさらなモジュール状態から軽く始められる。
beforeAll(async () => { await import('./App.vue'); vi.resetModules() })

beforeEach(() => { localStorage.clear() })

afterEach(() => {
  if (app) { app.unmount(); app = null }
  if (host) { host.remove(); host = null }
  window.history.replaceState({}, '', '/')
  vi.clearAllMocks()
  vi.resetModules()
})

describe('App の起動ルート', () => {
  it('未ログイン + ?delete-account で公開削除ページを表示する', async () => {
    const el = await mountApp('/?delete-account')

    // 公開削除ページの本文（アプリ名・削除申請・ログイン欄）が描画される
    expect(el.textContent).toContain('アカウント削除の申請')
    expect(el.textContent).toContain('タナオロ')
    expect(el.querySelector('#dap-code')).toBeTruthy()
    expect(el.querySelector('#dap-pin')).toBeTruthy()
  })

  it('ログイン済みでも ?delete-account を優先し、セッション一覧を出さない', async () => {
    localStorage.setItem('_auth_token', 'tok-1')
    localStorage.setItem('_auth_store_name', 'A店')
    localStorage.setItem('_shop_code', 'STOREA')

    const el = await mountApp('/?delete-account')

    expect(el.textContent).toContain('アカウント削除の申請')
    // ログイン済みなので削除対象が確定して表示される
    expect(el.textContent).toContain('削除対象のアカウント')
    expect(el.textContent).toContain('STOREA')
  })

  it('?delete-account が無ければ削除ページを表示しない（通常起動を妨げない）', async () => {
    const el = await mountApp('/')

    expect(el.textContent).not.toContain('アカウント削除の申請')
    expect(el.querySelector('#dap-code')).toBeNull()
  })
})
