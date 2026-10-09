// ルーターがセキュリティ上の出来事をログへ残すこと（OPS-001）。警報はこの type で組む。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createD1 } from './d1Harness.js'
import worker from '../src/index.js'
import { handleRegister } from '../src/authHandler.js'
import { handleStaffInvite, handleStaffJoin, handleStaffPending, handleStaffAction } from '../src/staffHandler.js'

afterEach(() => vi.restoreAllMocks())

function events() {
  const out = []
  vi.spyOn(console, 'warn').mockImplementation(s => { try { const j = JSON.parse(s); if (j.evt === 'security') out.push(j) } catch (_) {} })
  return out
}
const post = (path, body, { ip = '203.0.113.9', token } = {}) => new Request(`https://worker.example${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
})

describe('セキュリティイベント', () => {
  it('ログイン失敗・締め出しを、店舗と伏せた IP つきで残す（PIN は残さない）', async () => {
    const h = createD1()
    const env = { DB: h.db, ALLOWED_ORIGIN: '' }
    const reg = await handleRegister(h.db, { pin: '1234' })
    const ev = events()
    for (let i = 0; i < 6; i++) await worker.fetch(post('/auth/login', { shopCode: reg.shopCode, pin: '9999' }), env)
    expect(ev.filter(e => e.type === 'login_failed')).toHaveLength(5)
    expect(ev.find(e => e.type === 'login_locked')).toMatchObject({ shop: reg.shopCode, ip: '203.0.113.x' })
    expect(JSON.stringify(ev)).not.toContain('9999')
  })

  it('権限の拒否（perm_denied）を、役割と足りない権限つきで残す', async () => {
    const h = createD1()
    const env = { DB: h.db, ALLOWED_ORIGIN: '' }
    const reg = await handleRegister(h.db, { pin: '1234' })
    const own = new Request('https://w/', { headers: { Authorization: `Bearer ${reg.token}` } })
    const { invite } = await handleStaffInvite(h.db, own, reg.shopCode, { name: '山田', role: 'arbeit' })
    const j = await handleStaffJoin(h.db, { token: invite.token, name: '山田', pin: '284713' })
    await handleStaffAction(h.db, own, reg.shopCode, j.staffId, 'approve')
    const staff = (await handleStaffPending(h.db, j.pendingKey)).token
    const ev = events()
    const res = await worker.fetch(post(`/store/${reg.shopCode}/sessions`, { type: 'stock' }, { token: staff }), env)
    expect(res.status).toBe(403)
    expect(ev.find(e => e.type === 'perm_denied')).toMatchObject({ shop: reg.shopCode, role: 'arbeit', missing: ['stock.start'], method: 'POST' })
  })

  it('登録の回数制限に当たったら ip_blocked（kind=register）', async () => {
    const h = createD1()
    const env = { DB: h.db, ALLOWED_ORIGIN: '' }
    const ev = events()
    for (let i = 0; i < 6; i++) await worker.fetch(post('/auth/register', { pin: '1234' }, { ip: '198.51.100.20' }), env)
    expect(ev.filter(e => e.type === 'ip_attempt' && e.kind === 'register')).toHaveLength(5)
    expect(ev.find(e => e.type === 'ip_blocked')).toMatchObject({ kind: 'register', ip: '198.51.100.x' })
  })
})
