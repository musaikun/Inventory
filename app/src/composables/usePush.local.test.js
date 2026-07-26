import { describe, it, expect, vi, afterEach } from 'vitest'

// api.js をモックし、unsubscribePushLocal が remote API（apiFetch）を一切呼ばないことを固定する。
vi.mock('../utils/api.js', () => ({
  HTTP_BASE: '',
  apiFetch: vi.fn(),
}))
import { apiFetch } from '../utils/api.js'

// unsubscribePushLocal（アカウント削除の finalize から使う）が、
// SW 未登録でも hang せず、remote を呼ばずに browser 購読だけ解除することを検証する。

function setupPushEnv(getRegistration) {
  // `ready` は永久に解決しない Promise にして、実装が誤って await しないことも担保する。
  Object.defineProperty(globalThis.navigator, 'serviceWorker', {
    value: { getRegistration, ready: new Promise(() => {}) },
    configurable: true,
  })
  vi.stubGlobal('PushManager', function PushManager() {})
  vi.stubGlobal('Notification', function Notification() {})
}

afterEach(() => {
  try { delete globalThis.navigator.serviceWorker } catch (_) {}
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  localStorage.clear()
  vi.resetModules()
})

describe('unsubscribePushLocal', () => {
  it('SW 登録が無い（getRegistration=undefined）でも hang せず true を返す', async () => {
    setupPushEnv(vi.fn().mockResolvedValue(undefined))
    const { unsubscribePushLocal, pushSubscribed } = await import('./usePush.js')

    await expect(unsubscribePushLocal()).resolves.toBe(true)
    expect(pushSubscribed.value).toBe(false)
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('既存購読は browser 側 unsubscribe だけ呼び、remote API は呼ばない', async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true)
    const getSubscription = vi.fn().mockResolvedValue({ unsubscribe })
    setupPushEnv(vi.fn().mockResolvedValue({ pushManager: { getSubscription } }))
    const { unsubscribePushLocal } = await import('./usePush.js')

    await expect(unsubscribePushLocal()).resolves.toBe(true)
    expect(getSubscription).toHaveBeenCalledOnce()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('Push 非対応環境でも購読表示 key を消し、false を返す', async () => {
    // globals を stub しない → pushSupported=false。事前に購読フラグを立てておく。
    localStorage.setItem('tanaoro_push_subscribed', '1')
    const { unsubscribePushLocal, pushSubscribed } = await import('./usePush.js')
    expect(pushSubscribed.value).toBe(true)

    await expect(unsubscribePushLocal()).resolves.toBe(false)
    expect(pushSubscribed.value).toBe(false)
    expect(localStorage.getItem('tanaoro_push_subscribed')).toBeNull()
    expect(apiFetch).not.toHaveBeenCalled()
  })
})
