// 通知の設定（User決定 2026-10-05）。ONにできない理由を出し、種類ごとの設定を端末とサーバーへ送る。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({ HTTP_BASE: '', WS_BASE: '', apiFetch: vi.fn(), setAuthInvalidatedHandler: vi.fn() }))

let app = null, host = null, api = null
const tick = async () => { for (let i = 0; i < 12; i++) await nextTick() }
const click = async el => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick() }
const sw = label => host.querySelector(`.ns-sw[aria-label="${label}"]`)
const itemOf = title => [...host.querySelectorAll('.ns-item')].find(i => i.querySelector('b').textContent === title)
const chip = (title, label) => [...itemOf(title).querySelectorAll('.ns-chip')].find(c => c.textContent === label)

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

  it('ONにすると設定ごと購読を送り、変えた設定はサーバーへ送る', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    pushEnv()
    await mount()
    api.mockImplementation(async path => (path === '/api/push/vapid-key' ? { key: 'BAAA' } : {}))
    await click(sw('この端末で通知を受け取る'))
    await vi.advanceTimersByTimeAsync(0); await tick()
    const subCall = api.mock.calls.find(c => c[0] === '/store/ABCDEF/push/subscribe')
    expect(JSON.parse(subCall[1].body).prefs.monthEnd).toEqual({ on: true, days: [0, 1] })
    expect(host.querySelector('.ns-state').textContent).toContain('この端末で受け取ります')

    await click(chip('月末の棚卸', '3日前'))
    await click(sw('発注の締切'))
    await click(chip('発注の締切', '2時間前'))
    vi.advanceTimersByTime(700)
    await tick(); await tick()
    const put = api.mock.calls.filter(c => c[0] === '/store/ABCDEF/push/prefs')
    expect(put.length).toBe(1)
    const sent = JSON.parse(put[0][1].body)
    expect(sent.endpoint).toBe('https://push.example/me')
    expect(sent.prefs.monthEnd.days).toEqual([0, 1, 3])
    expect(sent.prefs.orderDeadline).toEqual({ on: true, mins: [60, 120] })
    expect(JSON.parse(localStorage.getItem('tanaoro_push_prefs')).orderDeadline.on).toBe(true)
  })
})
