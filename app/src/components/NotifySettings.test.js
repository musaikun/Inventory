// 通知の設定（User決定 2026-10-05 → 2026-10-16）。ONにできない理由を出す。ONにしたら全部届く。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({ HTTP_BASE: '', WS_BASE: '', apiFetch: vi.fn(), setAuthInvalidatedHandler: vi.fn() }))

let app = null, host = null, api = null
const tick = async () => { for (let i = 0; i < 12; i++) await nextTick() }
const click = async el => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick() }
const sw = label => host.querySelector(`.ns-sw[aria-label="${label}"]`)

const sub = { endpoint: 'https://push.example/me', toJSON: () => ({ endpoint: 'https://push.example/me', keys: { p256dh: 'p', auth: 'a' } }) }
function pushEnv(permission = 'granted') {
  const reg = { active: {}, pushManager: { subscribe: vi.fn(async () => sub), getSubscription: vi.fn(async () => sub) } }
  Object.defineProperty(globalThis.navigator, 'serviceWorker', { value: { ready: Promise.resolve(reg), getRegistration: async () => reg }, configurable: true })
  vi.stubGlobal('PushManager', function PushManager() {})
  const N = function Notification() {}
  N.permission = permission
  N.requestPermission = vi.fn(async () => permission)
  vi.stubGlobal('Notification', N)
}

async function mount() {
  ({ apiFetch: api } = await import('../utils/api.js'))
  const store = await import('../composables/useStore.js')
  store.shopCode.value = 'ABCDEF'
  const { default: C } = await import('./NotifySettings.vue')
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp({ render: () => h(C) }); app.mount(host)
  await tick()
}

beforeEach(() => { localStorage.clear(); vi.resetModules() })
afterEach(() => {
  app?.unmount(); host?.remove(); app = null; host = null
  try { delete globalThis.navigator.serviceWorker } catch (_) {}
  vi.unstubAllGlobals(); vi.clearAllMocks(); vi.useRealTimers()
})

describe('通知の設定', () => {
  it('サーバーに鍵が無いと、ONにできない理由を出す（押しても何も起きない状態にしない）', async () => {
    pushEnv()
    await mount()
    api.mockImplementation(async path => (path === '/api/push/vapid-key' ? { key: null } : {}))
    await click(sw('この端末で通知を受け取る'))
    expect(host.querySelector('.ns-state.warn').textContent).toContain('サーバーでまだできていません')
    expect(sw('この端末で通知を受け取る').getAttribute('aria-checked')).toBe('false')
  })

  it('アプリの準備（Service Worker）が終わらないときは、止まらずに理由を出す。登録が無ければ登録し直す', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    pushEnv()
    const register = vi.fn(async () => ({ active: null, pushManager: {} }))
    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
      value: { ready: new Promise(() => {}), getRegistration: async () => undefined, register }, configurable: true,
    })
    await mount()
    api.mockImplementation(async path => (path === '/api/push/vapid-key' ? { key: 'BAAA' } : {}))
    await click(sw('この端末で通知を受け取る'))
    expect(host.querySelector('.ns-state').textContent).toContain('設定しています')
    await vi.advanceTimersByTimeAsync(16000)
    await tick()
    expect(register).toHaveBeenCalled()
    expect(host.querySelector('.ns-state.warn').textContent).toContain('一度閉じて開き直して')
    expect(sw('この端末で通知を受け取る').getAttribute('aria-checked')).toBe('false')
  })

  it('端末で通知がブロックされていると、その外し方を出す', async () => {
    pushEnv('denied')
    await mount()
    expect(host.querySelector('.ns-state.warn').textContent).toContain('ブロックされています')
  })

  it('ONにすると購読を送る。ONなら全部届き、選ぶ所は無い', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    pushEnv()
    await mount()
    api.mockImplementation(async path => (path === '/api/push/vapid-key' ? { key: 'BAAA' } : {}))
    await click(sw('この端末で通知を受け取る'))
    await vi.advanceTimersByTimeAsync(0); await tick()
    const subCall = api.mock.calls.find(c => c[0] === '/store/ABCDEF/push/subscribe')
    expect(JSON.parse(subCall[1].body).prefs.monthEnd).toEqual({ on: true, days: [0, 1] })
    expect(host.querySelector('.ns-state').textContent).toContain('この端末で受け取ります')

    // 種類・日数・時刻を選ぶ所は無い。届くものを並べるだけ（User決定 2026-10-16）
    expect(host.querySelectorAll('.ns-sw')).toHaveLength(1)
    expect(host.querySelector('select')).toBeNull()
    expect(host.textContent).toContain('発注の締切（1時間前）')
    expect(host.textContent).toContain('いつもアプリを最初に開く時刻ごろ')
  })
})
