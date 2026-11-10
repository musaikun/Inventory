// オーナーの暗証番号を6桁へ（D-036）: 変える画面・ログイン後の知らせ
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

const calls = []
let reply = async () => ({ ok: true, pinUpgrade: null })
vi.mock('../utils/api.js', () => ({ HTTP_BASE: '', WS_BASE: '', setAuthInvalidatedHandler: vi.fn(),
  apiFetch: vi.fn(async (path, opt) => { calls.push([path, JSON.parse(opt?.body || 'null')]); return reply(path, opt) }) }))

let app = null, host = null, events = []
const tick = async () => { for (let i = 0; i < 6; i++) await nextTick() }
const q = s => document.body.querySelector(s)
const btn = t => [...document.body.querySelectorAll('button')].find(b => b.textContent.trim() === t)
async function type(label, v) { const el = q(`input[aria-label="${label}"]`); el.value = v; el.dispatchEvent(new Event('input')); await tick() }
async function mount(mode) {
  const { default: Sheet } = await import('./PinChangeSheet.vue')
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp({ render: () => h(Sheet, { mode, onClose: () => events.push('close'), onDone: () => events.push('done') }) }); app.mount(host); await tick()
}
beforeEach(() => { localStorage.clear(); vi.resetModules(); calls.length = 0; events = []; reply = async () => ({ ok: true, pinUpgrade: null }) })
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; document.body.innerHTML = '' })

describe('暗証番号を変える', () => {
  it('弱い番号・確認ちがいは送らない。正しく入れると /auth/pin に送り、印を消す', async () => {
    localStorage.setItem('_auth_pin_upgrade', JSON.stringify({ due: new Date(Date.now() + 86400_000).toISOString(), overdue: false }))
    await mount('upgrade')
    const A = await import('../composables/useAuth.js')
    expect(A.pinUpgrade.value).toBeTruthy()
    expect(document.body.textContent).toContain('までは今の4桁でも入れます')
    await type('今の暗証番号', '1234'); await type('新しい暗証番号', '123456'); await type('新しい暗証番号（確認）', '123456')
    q('form').dispatchEvent(new Event('submit', { cancelable: true })); await tick()
    expect(q('[role=alert]').textContent).toContain('連続')
    await type('新しい暗証番号', '583920'); await type('新しい暗証番号（確認）', '583921')
    q('form').dispatchEvent(new Event('submit', { cancelable: true })); await tick()
    expect(q('[role=alert]').textContent).toContain('一致しません')
    expect(calls).toEqual([])
    await type('新しい暗証番号（確認）', '583920')
    q('form').dispatchEvent(new Event('submit', { cancelable: true })); await tick()
    expect(calls).toEqual([['/auth/pin', { currentPin: '1234', newPin: '583920' }]])
    expect(A.pinUpgrade.value).toBeNull()
    expect(document.body.textContent).toContain('暗証番号を変えました')
    expect(events).toContain('done')
  })

  it('期限までは「あとで」で閉じられ、期限を過ぎたら閉じられない', async () => {
    localStorage.setItem('_auth_pin_upgrade', JSON.stringify({ due: new Date(Date.now() + 86400_000).toISOString(), overdue: false }))
    await mount('upgrade')
    expect(btn('あとで')).toBeTruthy()
    app.unmount(); host.remove(); vi.resetModules()
    localStorage.setItem('_auth_pin_upgrade', JSON.stringify({ due: new Date(Date.now() - 1000).toISOString(), overdue: false }))
    await mount('upgrade')
    expect(btn('あとで')).toBeUndefined()
    expect(document.body.textContent).toContain('変えるまで先へ進めません')
    q('.pc-bg').dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick()
    expect(events, '外を押しても閉じない').toEqual([])
  })

  it('今の番号が違えば知らせて入れ直してもらう', async () => {
    reply = async () => { const e = new Error('今の暗証番号が正しくありません'); e.code = 'wrong_pin'; throw e }
    await mount('change')
    await type('今の暗証番号', '9999'); await type('新しい暗証番号', '583920'); await type('新しい暗証番号（確認）', '583920')
    q('form').dispatchEvent(new Event('submit', { cancelable: true })); await tick()
    expect(q('[role=alert]').textContent).toContain('今の暗証番号が正しくありません')
    expect(q('input[aria-label="今の暗証番号"]').value).toBe('')
    expect(btn('やめる')).toBeTruthy()
  })
})
