// 信頼済み端末（0027）: 第三者が PIN をまちがえ続けても、店主のいつもの端末は締め出されない。
// 鍵の無い端末の失敗は今までどおり店舗全体で15分に5回まで。上限に達した瞬間、店主・管理者の端末へ知らせる。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createD1 } from './d1Harness.js'
import { sendWebPush } from '../src/webPush.js'
import worker from '../src/index.js'
import { handleRegister } from '../src/authHandler.js'

vi.mock('../src/webPush.js', () => ({ sendWebPush: vi.fn(async () => 201) }))

let h, env, reg
beforeEach(async () => {
  vi.mocked(sendWebPush).mockClear()
  h = createD1()
  env = { DB: h.db, ALLOWED_ORIGIN: '', VAPID_PUBLIC_KEY: 'k', VAPID_PRIVATE_KEY: 'k' }
  reg = await handleRegister(h.db, { pin: '1234' })
})
// 試す側は毎回 IP を変える（IP 単位の制限ではなく、店舗単位の締め出しを見るため）
let ipN = 0
const login = (body) => worker.fetch(new Request('https://w/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `198.51.100.${++ipN % 250}` },
  body: JSON.stringify({ shopCode: reg.shopCode, ...body }),
}), env)

describe('信頼済み端末', () => {
  it('登録した端末には鍵を渡し、D1 にはハッシュで残す', async () => {
    expect(reg.deviceKey).toMatch(/^[0-9a-f]{48}$/)
    const rows = h.rows('SELECT key_hash FROM login_devices WHERE shop_code = ?', reg.shopCode)
    expect(rows).toHaveLength(1)
    expect(rows[0].key_hash).toMatch(/^h1:/)
    expect(rows[0].key_hash).not.toContain(reg.deviceKey)
  })

  it('鍵の無い端末が5回まちがえると、鍵の無い端末は正しい PIN でも入れない。いつもの端末は入れる', async () => {
    for (let i = 0; i < 5; i++) expect((await login({ pin: '0000' })).status).toBe(401)
    expect((await login({ pin: '1234' })).status).toBe(429)
    expect((await login({ pin: '1234', deviceKey: 'forged-key' })).status).toBe(429)   // 偽の鍵は鍵なしと同じ
    const ok = await login({ pin: '1234', deviceKey: reg.deviceKey })
    expect(ok.status).toBe(200)
    expect((await ok.json()).deviceKey).toBe(reg.deviceKey)   // 同じ鍵のまま
    // 店主が入っても、第三者の失敗は数え直さない
    expect((await login({ pin: '1234' })).status).toBe(429)
  })

  it('いつもの端末の失敗は、その端末の分だけで数える', async () => {
    for (let i = 0; i < 5; i++) expect((await login({ pin: '0000', deviceKey: reg.deviceKey })).status).toBe(401)
    expect((await login({ pin: '1234', deviceKey: reg.deviceKey })).status).toBe(429)
    const other = await login({ pin: '1234' })   // 新しい端末は止まっていない
    expect(other.status).toBe(200)
    expect((await other.json()).deviceKey).toMatch(/^[0-9a-f]{48}$/)   // 新しい鍵が渡る
  })

  it('上限に達した瞬間だけ、店主・管理者の端末へ知らせる（スタッフの端末には送らない）', async () => {
    const sub = (endpoint, actor) => h.rows(
      'INSERT INTO push_subscriptions (endpoint, shop_code, p256dh, auth, created_at, actor_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING endpoint',
      endpoint, reg.shopCode, 'p', 'a', '2026-10-09T00:00:00.000Z', actor)
    h.rows("INSERT INTO staff (id, shop_code, name, role, status, created_at, updated_at) VALUES ('st_admin', ?, '店長', 'admin', 'active', 'x', 'x') RETURNING id", reg.shopCode)
    h.rows("INSERT INTO staff (id, shop_code, name, role, status, created_at, updated_at) VALUES ('st_arb', ?, '山田', 'arbeit', 'active', 'x', 'x') RETURNING id", reg.shopCode)
    sub('https://push.example/owner', 'device-owner')
    sub('https://push.example/admin', 'st_admin')
    sub('https://push.example/arbeit', 'st_arb')

    for (let i = 0; i < 4; i++) await login({ pin: '0000' })
    expect(sendWebPush).not.toHaveBeenCalled()
    const fifth = await login({ pin: '0000' })
    expect(fifth.status).toBe(401)
    expect(await fifth.json()).not.toHaveProperty('lockedNow')   // 内部の印は返さない
    const sentTo = vi.mocked(sendWebPush).mock.calls.map(c => c[0].endpoint).sort()
    expect(sentTo).toEqual(['https://push.example/admin', 'https://push.example/owner'])
    expect(vi.mocked(sendWebPush).mock.calls[0][1].tag).toBe('login-locked')
    await login({ pin: '1234' })   // 止まっている間は知らせ直さない
    expect(vi.mocked(sendWebPush)).toHaveBeenCalledTimes(2)
  })
})

describe('0027 が未適用の D1（Worker を先に更新した場合）', () => {
  it('ログインできて、締め出しは従来どおり店舗全体で働く', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const { migrationFiles, applyMigrations } = await import('./d1Harness.js')
    const sqlite = new DatabaseSync(':memory:')
    applyMigrations(sqlite, migrationFiles({ to: '0026_zzz' }))
    const prepare = sql => {
      let v = []
      const st = {
        bind(...a) { v = a; return st },
        async first() { return sqlite.prepare(sql).get(...v) ?? null },
        async all() { return { results: sqlite.prepare(sql).all(...v) } },
        async run() { const r = sqlite.prepare(sql).run(...v); return { success: true, meta: { changes: Number(r.changes) } } },
      }
      return st
    }
    const db = { prepare, async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out } }
    const old = await handleRegister(db, { pin: '1234' })
    expect(old.token).toBeTruthy()
    expect(old.deviceKey).toBeUndefined()   // 表が無いので鍵は渡さない
    const env0 = { DB: db, ALLOWED_ORIGIN: '' }
    const call = (pin, ip) => worker.fetch(new Request('https://w/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
      body: JSON.stringify({ shopCode: old.shopCode, pin, deviceKey: 'whatever' }),
    }), env0)
    expect((await call('1234', '203.0.113.1')).status).toBe(200)
    for (let i = 0; i < 5; i++) expect((await call('0000', `203.0.113.${10 + i}`)).status).toBe(401)
    expect((await call('1234', '203.0.113.30')).status).toBe(429)
  })
})
