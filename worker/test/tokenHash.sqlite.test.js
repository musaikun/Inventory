// ログイントークンは D1 にハッシュで保存する。全マイグレーションを当てた SQLite と router で確かめる。
// - 登録・ログイン・スタッフの発行のどれも、保存値は "h1:" のハッシュ
// - 保存値（漏れた DB の値）を Bearer にしても入れない
// - この変更より前に生のまま保存したトークンは、失効まで使える（seedToken は生で入れる）
import { describe, it, expect } from 'vitest'
import { createD1 } from './d1Harness.js'
import worker from '../src/index.js'
import { handleRegister, handleLogin } from '../src/authHandler.js'
import { handleStaffInvite, handleStaffJoin, handleStaffPending, handleStaffAction } from '../src/staffHandler.js'

const get = (path, token) => new Request(`https://worker.example${path}`, {
  headers: token ? { Authorization: `Bearer ${token}` } : {},
})
const req = token => new Request('https://w.test/', { headers: { Authorization: `Bearer ${token}` } })

describe('トークンの保存形', () => {
  it('登録・ログイン・スタッフのトークンは、どれもハッシュで保存する', async () => {
    const h = createD1()
    const reg = await handleRegister(h.db, { pin: '1234' })
    const login = await handleLogin(h.db, { shopCode: reg.shopCode, pin: '1234' })
    const { invite } = await handleStaffInvite(h.db, req(login.token), reg.shopCode, { name: '山田', role: 'arbeit' })
    const j = await handleStaffJoin(h.db, { token: invite.token, name: '山田', pin: '284713' })
    await handleStaffAction(h.db, req(login.token), reg.shopCode, j.staffId, 'approve')
    const staff = (await handleStaffPending(h.db, j.pendingKey)).token

    const stored = h.rows('SELECT token FROM auth_tokens').map(r => r.token)
    expect(stored.length).toBe(2)   // ログインで登録時のオーナートークンは消える
    for (const t of stored) expect(t).toMatch(/^h1:[0-9a-f]{64}$/)
    for (const raw of [login.token, staff]) expect(stored).not.toContain(raw)

    const env = { DB: h.db, ALLOWED_ORIGIN: 'https://inventory-app.pages.dev' }
    expect((await worker.fetch(get(`/store/${reg.shopCode}/sessions`, login.token), env)).status).toBe(200)
    expect((await worker.fetch(get(`/store/${reg.shopCode}/sessions`, staff), env)).status).toBe(200)
    for (const t of stored) {
      expect((await worker.fetch(get(`/store/${reg.shopCode}/sessions`, t), env)).status).toBe(401)
    }
  })

  it('生のまま保存した旧トークンは、失効まで使える', async () => {
    const h = createD1()
    h.seedStore('SHOPAA')
    const raw = h.seedToken('SHOPAA')
    const env = { DB: h.db, ALLOWED_ORIGIN: 'https://inventory-app.pages.dev' }
    expect((await worker.fetch(get('/store/SHOPAA/sessions', raw), env)).status).toBe(200)
  })
})
