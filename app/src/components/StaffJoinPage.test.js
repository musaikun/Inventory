// 招待から参加する（段 2-1・User決定 2026-10-07）。名前と6桁の暗証番号で申請し、承認されたらそのままログインする。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({ HTTP_BASE: '', WS_BASE: '', apiFetch: vi.fn(), setAuthInvalidatedHandler: vi.fn() }))

let app = null, host = null, api, events
const tick = async () => { for (let i = 0; i < 6; i++) await nextTick() }
const TOKEN = 'a'.repeat(48)

beforeEach(() => { localStorage.clear(); vi.resetModules(); vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }) })
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; vi.useRealTimers() })

async function mount(token = TOKEN) {
  ({ apiFetch: api } = await import('../utils/api.js'))
  api.mockImplementation(async (path, opts) => {
    if (path.startsWith('/staff/invite?')) return { storeName: '本店', shopCode: 'ABCDEF', name: '山田', role: 'arbeit', expiresAt: new Date(Date.now() + 9 * 60000).toISOString() }
    if (path === '/staff/join') return { pendingKey: 'b'.repeat(48), shopCode: 'ABCDEF', storeName: '本店', name: JSON.parse(opts.body).name, staffId: 'st_1' }
    if (path.startsWith('/staff/pending?')) return api._approved ? { status: 'active', token: 'tok', shopCode: 'ABCDEF', storeName: '本店', staff: { id: 'st_1', name: '山田', role: 'arbeit' } } : { status: 'pending' }
    return {}
  })
  const { default: Page } = await import('./StaffJoinPage.vue')
  host = document.createElement('div'); document.body.appendChild(host)
  events = []
  app = createApp({ render: () => h(Page, { token, onDone: () => events.push('done') }) }); app.mount(host)
  await tick()
}
const set = async (sel, v) => { const el = host.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input')); await tick() }
const click = async el => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick() }

describe('招待から参加', () => {
  it('店と役割を見せ、暗証番号が合わなければ申請しない', async () => {
    await mount()
    expect(host.textContent).toContain('本店')
    expect(host.textContent).toContain('アルバイトとして招待')
    expect(host.querySelector('#sj-name').value).toBe('山田')
    await set('#sj-pin', '284713'); await set('#sj-pin2', '284714')
    await click(host.querySelector('.sj-btn.pri'))
    expect(host.textContent).toContain('確認の暗証番号が合いません')
    expect(api.mock.calls.some(c => c[0] === '/staff/join')).toBe(false)
  })

  it('申請すると承認を待ち、承認されたらこの端末がスタッフとしてログインする', async () => {
    await mount()
    await set('#sj-pin', '284713'); await set('#sj-pin2', '284713')
    await click(host.querySelector('.sj-btn.pri'))
    expect(host.textContent).toContain('参加を申請しました')
    api._approved = true
    await vi.advanceTimersByTimeAsync(5000); await tick()
    const auth = await import('../composables/useAuth.js')
    expect(auth.currentStaff.value).toEqual({ id: 'st_1', name: '山田', role: 'arbeit' })
    expect(auth.currentRole.value).toBe('arbeit')
    expect(auth.isAdmin.value).toBe(false)
    expect(events).toContain('done')
    expect(localStorage.getItem('_staff_join')).toBeNull()
  })
})
