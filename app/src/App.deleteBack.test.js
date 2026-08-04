import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'

// PLAY-002: App の Android/PWA Back 制御と削除モーダルの実結合を固定する。
// 公開削除ページはモーダル表示 state がローカルなため、App の showDeleteAccount だけでは
// Back を処理できない。モーダルが登録した handler を App が消費する経路を検証する。
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

async function mountApp(search = '/?delete-account') {
  window.history.replaceState({}, '', search)
  const { default: App } = await import('./App.vue')
  apiFetchMock.mockImplementation(path => {
    if (path === '/store/STOREA') {
      return Promise.resolve({ shopCode: 'STOREA', activeRoom: null })
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

async function flush(n = 4) {
  for (let i = 0; i < n; i++) await nextTick()
}

async function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flush()
}

async function type(el, value) {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

function button(root, label) {
  return [...root.querySelectorAll('button')].find(el => el.textContent.includes(label))
}

function seedAuthenticatedAccount() {
  localStorage.setItem('_auth_token', 'tok-1')
  localStorage.setItem('_auth_store_name', 'A店')
  localStorage.setItem('_shop_code', 'STOREA')
}

async function openDeleteModal(el) {
  await click(button(el, 'アカウント削除に進む'))
  return el.querySelector('[role="dialog"]')
}

async function moveToConfirm(dialog) {
  await type(dialog.querySelector('#da-pin'), '1234')
  await type(dialog.querySelector('#da-confirm'), 'STOREA')
  await click(button(dialog, '削除に進む'))
}

function pressBrowserBack() {
  window.dispatchEvent(new PopStateEvent('popstate'))
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  seedAuthenticatedAccount()
})

afterEach(() => {
  if (app) { app.unmount(); app = null }
  if (host) { host.remove(); host = null }
  window.history.replaceState({}, '', '/')
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('App の削除モーダル Back 制御', () => {
  it('公開削除ページの入力中は Back でモーダルだけを閉じる', async () => {
    const el = await mountApp()
    expect(await openDeleteModal(el)).not.toBeNull()
    const pushStateSpy = vi.spyOn(window.history, 'pushState')

    pressBrowserBack()
    await flush()

    expect(pushStateSpy).toHaveBeenCalledTimes(1)
    expect(el.querySelector('[role="dialog"]')).toBeNull()
    expect(el.textContent).toContain('アカウント削除の申請')
    const { consumeDeleteAccountBack } = await import('./composables/appMenuState.js')
    expect(consumeDeleteAccountBack()).toBe(false)
  }, 15000)

  it('最終確認中は Back でモーダルだけを閉じる', async () => {
    const el = await mountApp()
    const dialog = await openDeleteModal(el)
    await moveToConfirm(dialog)
    expect(dialog.textContent).toContain('本当に削除しますか')

    pressBrowserBack()
    await flush()

    expect(el.querySelector('[role="dialog"]')).toBeNull()
    expect(el.textContent).toContain('アカウント削除の申請')
  })

  it('削除処理中と完了表示では Back を消費してモーダルを維持する', async () => {
    const el = await mountApp()
    let resolveDelete
    apiFetchMock.mockImplementation((path, opts = {}) => {
      if (path === '/auth/account' && opts.method === 'DELETE') {
        return new Promise(resolve => { resolveDelete = resolve })
      }
      return Promise.resolve({})
    })

    const dialog = await openDeleteModal(el)
    await moveToConfirm(dialog)
    await click(button(dialog, '完全に削除する'))
    expect(dialog.textContent).toContain('削除しています')
    const pushStateSpy = vi.spyOn(window.history, 'pushState')

    pressBrowserBack()
    await flush()

    expect(pushStateSpy).toHaveBeenCalledTimes(1)
    expect(el.querySelector('[role="dialog"]')).toBe(dialog)
    expect(dialog.textContent).toContain('削除しています')

    resolveDelete({
      ok: true,
      status: 'deleted',
      deletedAt: '2026-08-04T00:00:00Z',
      alreadyDeleted: false,
      requestId: 'req-1',
    })
    await flush(12)
    expect(dialog.textContent).toContain('アカウントを削除しました')

    pressBrowserBack()
    await flush()

    expect(pushStateSpy).toHaveBeenCalledTimes(2)
    expect(el.querySelector('[role="dialog"]')).toBe(dialog)
    expect(dialog.textContent).toContain('アカウントを削除しました')
  })

  it('App共通stateの削除モーダルも処理中は Back で閉じない', async () => {
    const el = await mountApp('/')
    const { showDeleteAccount } = await import('./composables/appMenuState.js')
    showDeleteAccount.value = true
    await flush()

    apiFetchMock.mockImplementation((path, opts = {}) => {
      if (path === '/auth/account' && opts.method === 'DELETE') return new Promise(() => {})
      return Promise.resolve({})
    })

    const dialog = el.querySelector('[role="dialog"]')
    await moveToConfirm(dialog)
    await click(button(dialog, '完全に削除する'))
    expect(dialog.textContent).toContain('削除しています')

    pressBrowserBack()
    await flush()

    expect(showDeleteAccount.value).toBe(true)
    expect(el.querySelector('[role="dialog"]')).toBe(dialog)
    expect(dialog.textContent).toContain('削除しています')
  })

  it('通信エラー表示は Back で閉じ、handlerも解除する', async () => {
    const el = await mountApp()
    const error = new Error('しばらくしてから再試行してください')
    error.status = 503
    error.code = 'service_unavailable'
    error.body = { retryable: true }
    apiFetchMock.mockImplementation((path, opts = {}) => {
      if (path === '/auth/account' && opts.method === 'DELETE') return Promise.reject(error)
      return Promise.resolve({})
    })

    const dialog = await openDeleteModal(el)
    await moveToConfirm(dialog)
    await click(button(dialog, '完全に削除する'))
    expect(dialog.textContent).toContain('削除を完了できませんでした')

    const pushStateSpy = vi.spyOn(window.history, 'pushState')
    pressBrowserBack()
    await flush()

    expect(pushStateSpy).toHaveBeenCalledTimes(1)
    expect(el.querySelector('[role="dialog"]')).toBeNull()
    const { consumeDeleteAccountBack } = await import('./composables/appMenuState.js')
    expect(consumeDeleteAccountBack()).toBe(false)
  })
})
