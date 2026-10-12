// App を実際にマウントするテスト（App.*.test.js）の共通の準備。
//
// 店舗 STOREA にログイン済みの端末で App を開き、Worker の応答は最小限に差し替える。
// vi.mock は各テストファイルに書く（ファイルの先頭へ持ち上げられるため、ここからは張れない）。
// ここに置くのは、どのファイルでも同じ形だった「温める・ログイン済みにする・開く・片付ける」だけ。
import { vi } from 'vitest'
import { createApp, nextTick } from 'vue'

export const STORE_CODE = 'STOREA'

export async function flush(n = 6) {
  for (let i = 0; i < n; i++) await nextTick()
}

export async function click(el, n = 6) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flush(n)
}

export const button = (root, label) => [...root.querySelectorAll('button')].find(b => b.textContent.includes(label))

/**
 * App のモジュールグラフを先に温める（beforeAll で呼ぶ）。
 * 初回 import は transform と評価で数秒かかり、test 本体で払うと既定 5 秒の testTimeout に届くことがある。
 * hook（既定 10 秒）で払い、直後に registry を捨てて、各 test はまっさらなモジュールから始める。
 */
export async function warmApp() {
  await import('../App.vue')
  vi.resetModules()
}

/** localStorage を空にし、STOREA にログイン済みの端末にする（beforeEach で呼ぶ） */
export function resetSignedIn() {
  vi.resetModules()
  localStorage.clear(); sessionStorage.clear()
  localStorage.setItem('_auth_token', 'tok-1')
  localStorage.setItem('_auth_store_name', 'A店')
  localStorage.setItem('_shop_code', STORE_CODE)
}

/**
 * STOREA の Worker の応答。店舗は「ルームなし」、セッション一覧・履歴は空、それ以外は {}。
 * createdSession を渡すと POST /sessions（開始）でそのセッションを返す（開始時刻は今）。
 */
export function stubStoreApi(apiFetchMock, { createdSession = null } = {}) {
  apiFetchMock.mockImplementation((path, opts = {}) => {
    if (path === `/store/${STORE_CODE}`) return Promise.resolve({ shopCode: STORE_CODE, activeRoom: null })
    if (createdSession && path === `/store/${STORE_CODE}/sessions` && opts.method === 'POST') {
      return Promise.resolve({ ...createdSession, startedAt: new Date().toISOString() })
    }
    if (typeof path === 'string' && (path.endsWith('/sessions') || path.endsWith('/history'))) {
      return Promise.resolve([])
    }
    return Promise.resolve({})
  })
}

let _app = null
let _host = null

/** url を開いた状態で App をマウントし、描画を待ってから host を返す */
export async function mountApp(url = '/', { ticks = 6 } = {}) {
  window.history.replaceState({}, '', url)
  const { default: App } = await import('../App.vue')
  _host = document.createElement('div')
  document.body.appendChild(_host)
  _app = createApp(App)
  _app.mount(_host)
  await flush(ticks)
  return _host
}

/** マウントした App を外す（再読み込みを再現するときにも使う） */
export function unmountApp() {
  if (_app) { _app.unmount(); _app = null }
  if (_host) { _host.remove(); _host = null }
}

/** afterEach で呼ぶ。App を外し、URL とモックを元に戻す */
export function teardownApp() {
  unmountApp()
  window.history.replaceState({}, '', '/')
  vi.restoreAllMocks()
  vi.clearAllMocks()
}
