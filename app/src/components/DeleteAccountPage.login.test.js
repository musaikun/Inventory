import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'

// 公開Web削除ページ（DeleteAccountPage）の画面レベル回帰テスト。
// 実際にコンポーネントを mount し、入力イベント → ログインクリック → 削除対象表示まで検証する。
// （@vue/test-utils は未導入のため、Vue 本体の createApp と jsdom の実 DOM で操作する）
vi.mock('../utils/api.js', () => ({
  HTTP_BASE: 'https://worker.test',
  apiFetch: vi.fn(),
}))
// posthog の実初期化を避ける（削除完了時の identity reset は別テストで担保）
vi.mock('../utils/analytics.js', () => ({
  initAnalytics: vi.fn(),
  track: vi.fn(),
  resetAnalytics: vi.fn(),
}))
import { apiFetch } from '../utils/api.js'

let app = null
let host = null

async function mountPage() {
  const { default: DeleteAccountPage } = await import('./DeleteAccountPage.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(DeleteAccountPage)
  app.mount(host)
  await nextTick()
  return host
}

// input要素へ実際に値を入れて input イベントを発火する（v-model 相当の経路を通す）
async function type(el, value) {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

async function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
  await nextTick()
}

beforeEach(() => { localStorage.clear() })

afterEach(() => {
  if (app) { app.unmount(); app = null }
  if (host) { host.remove(); host = null }
  vi.clearAllMocks()
  vi.resetModules()
})

describe('公開削除ページ（画面）', () => {
  it('未ログインでは店舗コードとPINの入力欄・ログインボタンを表示する', async () => {
    const el = await mountPage()

    expect(el.querySelector('#dap-code')).toBeTruthy()
    expect(el.querySelector('#dap-pin')).toBeTruthy()
    // アプリ名（Play listing と一致）と復元不能の明示
    expect(el.textContent).toContain('タナオロ')
    expect(el.textContent).toContain('削除すると元に戻せません')
    // 未ログインでは削除ボタンは出さない
    expect(el.textContent).not.toContain('アカウント削除に進む')
  })

  it('入力 → ログインクリックで、削除対象アカウントの画面へ遷移する', async () => {
    apiFetch.mockResolvedValue({ token: 'tok-1', shopCode: 'STOREA', storeName: 'A店' })
    const el = await mountPage()

    await type(el.querySelector('#dap-code'), 'storea')   // 小文字入力は大文字化される
    await type(el.querySelector('#dap-pin'), '1234')
    expect(el.querySelector('#dap-code').value).toBe('STOREA')

    const loginBtn = [...el.querySelectorAll('button')].find(b => b.textContent.includes('ログイン'))
    expect(loginBtn).toBeTruthy()
    await click(loginBtn)

    expect(apiFetch).toHaveBeenCalledWith('/auth/login', expect.objectContaining({ method: 'POST' }))
    // 削除対象の表示へ遷移し、削除導線が出る
    expect(el.textContent).toContain('削除対象のアカウント')
    expect(el.textContent).toContain('A店')
    expect(el.textContent).toContain('STOREA')
    expect([...el.querySelectorAll('button')].some(b => b.textContent.includes('アカウント削除に進む'))).toBe(true)
    // ログインフォームは消える
    expect(el.querySelector('#dap-code')).toBeNull()
  })

  it('PIN が4桁未満ならAPIを呼ばずエラーを表示する（入力バリデーション）', async () => {
    const el = await mountPage()

    await type(el.querySelector('#dap-code'), 'STOREA')
    await type(el.querySelector('#dap-pin'), '12')
    await click([...el.querySelectorAll('button')].find(b => b.textContent.includes('ログイン')))

    expect(apiFetch).not.toHaveBeenCalled()
    expect(el.querySelector('[role="alert"]').textContent).toContain('4桁')
    expect(el.querySelector('#dap-code')).toBeTruthy()   // 画面は遷移しない
  })

  it('ログイン失敗ではエラーを表示し、削除画面へ進ませない', async () => {
    const err = new Error('店舗コードまたはPINが違います')
    err.status = 401
    apiFetch.mockRejectedValue(err)
    const el = await mountPage()

    await type(el.querySelector('#dap-code'), 'STOREA')
    await type(el.querySelector('#dap-pin'), '9999')
    await click([...el.querySelectorAll('button')].find(b => b.textContent.includes('ログイン')))

    expect(el.querySelector('[role="alert"]').textContent).toContain('違います')
    expect(el.textContent).not.toContain('削除対象のアカウント')
    expect(el.querySelector('#dap-code')).toBeTruthy()
  })

  it('「アカウント削除に進む」で削除モーダルを開く', async () => {
    apiFetch.mockResolvedValue({ token: 'tok-1', shopCode: 'STOREA', storeName: 'A店' })
    const el = await mountPage()

    await type(el.querySelector('#dap-code'), 'STOREA')
    await type(el.querySelector('#dap-pin'), '1234')
    await click([...el.querySelectorAll('button')].find(b => b.textContent.includes('ログイン')))
    await click([...el.querySelectorAll('button')].find(b => b.textContent.includes('アカウント削除に進む')))

    const dialog = el.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    expect(dialog.textContent).toContain('アカウントを削除')
    expect(dialog.querySelector('#da-pin')).toBeTruthy()       // 再認証のPIN欄
    expect(dialog.querySelector('#da-confirm')).toBeTruthy()   // 店舗コード確認欄
  })
})
