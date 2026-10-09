// 信頼済み端末の鍵（Worker 0027）。ログインで送り、返ってきた鍵を店舗ごとに覚える。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

let sent
beforeEach(() => {
  localStorage.clear()
  sent = []
  vi.stubEnv('VITE_SYNC_WORKER_URL', 'https://sync.example.dev')
  vi.stubGlobal('fetch', async (url, opts) => {
    const body = JSON.parse(opts.body)
    sent.push({ url, body })
    return { ok: true, status: 200, json: async () => ({ token: 't', shopCode: 'ABCDEF', storeName: '本店', deviceKey: 'k-from-server' }) }
  })
})

async function auth() {
  vi.resetModules()
  return import('./useAuth.js')
}

describe('ログインと端末の鍵', () => {
  it('初めての端末は鍵を送らず、返ってきた鍵を店舗ごとに覚える', async () => {
    const { login } = await auth()
    await login('abcdef', '1234')
    expect(sent[0].body).toEqual({ shopCode: 'abcdef', pin: '1234' })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.loginDevice))).toEqual({ ABCDEF: 'k-from-server' })
  })

  it('覚えた鍵は、その店舗のログインにだけ送る', async () => {
    localStorage.setItem(STORAGE_KEYS.loginDevice, JSON.stringify({ ABCDEF: 'k1', ZZZZZZ: 'k2' }))
    const { login } = await auth()
    await login('abcdef', '1234')
    expect(sent[0].body.deviceKey).toBe('k1')
  })

  it('登録した端末も鍵を覚える', async () => {
    const { register } = await auth()
    await register('本店', '1234')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.loginDevice))).toEqual({ ABCDEF: 'k-from-server' })
  })

  it('アカウント削除の端末データ消去で鍵も消える（ログアウトでは消さない）', async () => {
    localStorage.setItem(STORAGE_KEYS.loginDevice, JSON.stringify({ ABCDEF: 'k1' }))
    const { logout } = await auth()
    try { await logout() } catch (_) {}
    expect(localStorage.getItem(STORAGE_KEYS.loginDevice)).not.toBeNull()
    const { clearDeviceLocalData } = await import('./accountData.js')
    clearDeviceLocalData()
    expect(localStorage.getItem(STORAGE_KEYS.loginDevice)).toBeNull()
  })
})
