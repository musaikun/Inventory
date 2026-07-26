import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'

// 公開Web削除ページから削除完了まで通し、端末に残るデータを検証する画面レベル回帰。
// 目的（PLAY-003 / DS-01）: 削除成功後に `_data_owner`（削除済み店舗コード）が
// localStorage へ残らないこと。ログアウトでは残す仕様との差分は accountData.test.js で担保。
vi.mock('../utils/api.js', () => ({
  HTTP_BASE: 'https://worker.test',
  apiFetch: vi.fn(),
}))
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

function button(root, label) {
  return [...root.querySelectorAll('button')].find(b => b.textContent.includes(label))
}

// ログインは成功、DELETE /auth/account は deleted を返す
function stubApi() {
  apiFetch.mockImplementation(async (path, opts = {}) => {
    if (path === '/auth/login') return { token: 'tok-1', shopCode: 'STOREA', storeName: 'A店' }
    if (path === '/auth/account' && opts.method === 'DELETE') {
      return { ok: true, status: 'deleted', deletedAt: '2026-07-26T00:00:00Z', alreadyDeleted: false }
    }
    throw new Error(`unexpected call: ${path}`)
  })
}

// ログイン → 削除モーダル → PIN・店舗コード入力 → 最終確認 → 削除実行
async function deleteThroughUi(el) {
  await type(el.querySelector('#dap-code'), 'STOREA')
  await type(el.querySelector('#dap-pin'), '1234')
  await click(button(el, 'ログイン'))
  await click(button(el, 'アカウント削除に進む'))

  const dialog = el.querySelector('[role="dialog"]')
  await type(dialog.querySelector('#da-pin'), '1234')
  await type(dialog.querySelector('#da-confirm'), 'STOREA')
  await click(button(dialog, '削除に進む'))
  await click(button(dialog, '完全に削除する'))
  await nextTick()
  return dialog
}

beforeEach(() => { localStorage.clear() })

afterEach(() => {
  if (app) { app.unmount(); app = null }
  if (host) { host.remove(); host = null }
  vi.clearAllMocks()
  vi.resetModules()
})

describe('公開削除ページ: 削除完了後の端末データ', () => {
  it('削除が完了すると _data_owner（削除済み店舗コード）が残らない', async () => {
    stubApi()
    const el = await mountPage()

    const dialog = await deleteThroughUi(el)

    // 削除APIが契約どおり呼ばれ、完了画面まで到達している
    expect(apiFetch).toHaveBeenCalledWith('/auth/account', expect.objectContaining({ method: 'DELETE' }))
    expect(dialog.textContent).toContain('アカウントを削除しました')

    // 端末に削除済みアカウントの識別子が残らない
    expect(localStorage.getItem('_data_owner')).toBeNull()
    expect(localStorage.getItem('_shop_code')).toBeNull()
    expect(localStorage.getItem('_auth_token')).toBeNull()
    expect(localStorage.getItem('_delete_account_request_id')).toBeNull()
  })

  it('削除に失敗した場合は _data_owner と認証を残す（再試行できる状態を壊さない）', async () => {
    apiFetch.mockImplementation(async (path, opts = {}) => {
      if (path === '/auth/login') return { token: 'tok-1', shopCode: 'STOREA', storeName: 'A店' }
      const err = new Error('しばらくしてから再試行してください')
      err.status = 503
      err.code   = 'service_unavailable'
      err.body   = { retryable: true }
      throw err
    })
    const el = await mountPage()

    const dialog = await deleteThroughUi(el)

    expect(dialog.textContent).not.toContain('アカウントを削除しました')
    expect(localStorage.getItem('_data_owner')).toBe('STOREA')
    expect(localStorage.getItem('_auth_token')).toBe('tok-1')
  })
})
