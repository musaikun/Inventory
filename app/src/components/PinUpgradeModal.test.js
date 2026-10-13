// オーナー PIN の6桁化（D-030）の画面側。
// 登録は6桁でないと送らない／ログインは以前の4桁も受け付ける／4桁で入った店には閉じられない変更画面が出て、
// 変えたら消える。サーバー側の決まりは worker/test/ownerPin.sqlite.test.js。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({ HTTP_BASE: 'https://worker.test', apiFetch: vi.fn(), setAuthInvalidatedHandler: vi.fn() }))
vi.mock('../utils/analytics.js', () => ({ initAnalytics: vi.fn(), track: vi.fn(), resetAnalytics: vi.fn() }))

let app = null, host = null, apiFetch, auth
const flush = async (n = 4) => { for (let i = 0; i < n; i++) await nextTick() }
async function type(el, v) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); await nextTick() }
async function click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush() }
const btn = label => [...host.querySelectorAll('button')].find(b => b.textContent.includes(label))

async function mount(component) {
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp(component); app.mount(host); await flush()
}

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  ;({ apiFetch } = await import('../utils/api.js'))
  apiFetch.mockReset()
  auth = await import('../composables/useAuth.js')
})
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

describe('AuthPage', () => {
  it('新規登録は6桁でないと送らない', async () => {
    await mount((await import('./AuthPage.vue')).default)
    await click(btn('新規登録'))
    const [pin, confirm] = host.querySelectorAll('input[type="password"]')
    expect(pin.getAttribute('maxlength')).toBe('6')
    await type(pin, '1234'); await type(confirm, '1234')
    await click(btn('登録して店舗コードを発行'))
    expect(host.querySelector('.form-error').textContent).toContain('6桁')
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('ログインは以前の4桁でも送り、4桁の店なら変更が要る状態になる', async () => {
    apiFetch.mockResolvedValue({ token: 't', shopCode: 'ABCDEF', storeName: null, pinUpgradeRequired: true })
    await mount((await import('./AuthPage.vue')).default)
    await type(host.querySelector('input[type="text"]'), 'ABCDEF')
    await type(host.querySelector('input[type="password"]'), '1234')
    await click(host.querySelector('.auth-submit'))      // タブの「ログイン」ではなく送信ボタン
    expect(apiFetch).toHaveBeenCalledWith('/auth/login', expect.objectContaining({ body: JSON.stringify({ shopCode: 'ABCDEF', pin: '1234' }) }))
    expect(auth.pinUpgradeRequired.value).toBe(true)
  })
})

describe('PinUpgradeModal', () => {
  it('閉じるボタンは無く、今の4桁と新しい6桁（確認つき）で変えると変更が要らない状態に戻る', async () => {
    apiFetch.mockResolvedValueOnce({ token: 't', shopCode: 'ABCDEF', storeName: null, pinUpgradeRequired: true })
    await auth.login('ABCDEF', '1234')
    expect(auth.pinUpgradeRequired.value).toBe(true)
    await mount((await import('./PinUpgradeModal.vue')).default)
    expect(btn('閉じる')).toBeUndefined()
    expect(btn('キャンセル')).toBeUndefined()

    const submit = btn('6桁のPINにする')
    expect(submit.disabled).toBe(true)
    await type(host.querySelector('#pu-current'), '1234')
    await type(host.querySelector('#pu-next'), '582941')
    await type(host.querySelector('#pu-confirm'), '582940')
    expect(submit.disabled).toBe(true)                       // 確認が一致しない
    await type(host.querySelector('#pu-confirm'), '582941')
    apiFetch.mockResolvedValueOnce({ ok: true, pinUpgradeRequired: false })
    await click(submit)
    expect(apiFetch).toHaveBeenLastCalledWith('/auth/pin', expect.objectContaining({ method: 'POST', body: JSON.stringify({ currentPin: '1234', newPin: '582941' }) }))
    expect(auth.pinUpgradeRequired.value).toBe(false)
  })

  it('サーバーが断った理由（弱い並び・今のPINの間違い）をそのまま出し、変更が要る状態のまま', async () => {
    apiFetch.mockResolvedValueOnce({ token: 't', shopCode: 'ABCDEF', storeName: null, pinUpgradeRequired: true })
    await auth.login('ABCDEF', '1234')
    await mount((await import('./PinUpgradeModal.vue')).default)
    await type(host.querySelector('#pu-current'), '1234')
    await type(host.querySelector('#pu-next'), '123456')
    await type(host.querySelector('#pu-confirm'), '123456')
    apiFetch.mockRejectedValueOnce(Object.assign(new Error('連続した数字の暗証番号は使えません'), { status: 400, code: 'weak_pin' }))
    await click(btn('6桁のPINにする'))
    expect(host.querySelector('.pu-error').textContent).toContain('連続した数字')
    expect(auth.pinUpgradeRequired.value).toBe(true)
  })

  it('スタッフとしてログインしているときは、変更が要る状態にならない', async () => {
    apiFetch.mockResolvedValueOnce({ token: 't', shopCode: 'ABCDEF', storeName: null, staff: { id: 'st_1', name: '山田', role: 'arbeit' } })
    await auth.staffLogin('ABCDEF', '山田', '284713', 'd1')
    apiFetch.mockResolvedValueOnce({ staff: { id: 'st_1', name: '山田', role: 'arbeit' }, pinUpgradeRequired: true })
    await auth.refreshMe()
    expect(auth.pinUpgradeRequired.value).toBe(false)
  })
})
