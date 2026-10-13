// 暗証番号の総当たり対策（loginGuard.js・migration 0028）を、全migrationを当てた実SQLiteで確かめる。
//
// User の合格ライン（2026-10-13）:
//   ① 100万通りを試す以前に、数十回程度で攻撃コストが急激に上がる
//   ② IP を変えるだけでは突破できない
//   ③ API を直接叩いても同じ制限（端末IDなど送る側が決める値で数え直させない）
//   ④ 店のスタッフ3〜10人が同時に使っても影響しない（店の Wi-Fi では全員が同じグローバル IP）
//   ＋ 同時リクエストで上限をすり抜けられない
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createD1 } from './d1Harness.js'
import worker from '../src/index.js'
import { handleRegister, handleLogin } from '../src/authHandler.js'
import {
  handleStaffInvite, handleStaffJoin, handleStaffPending, handleStaffAction, handleStaffLogin,
} from '../src/staffHandler.js'
import {
  reserveLoginAttempt, lockMinutesAfter, OWNER_ACCOUNT, staffAccount, GUARD_DECAY_MS,
} from '../src/loginGuard.js'

let h, reg
const owner = () => new Request('https://w/', { headers: { Authorization: `Bearer ${reg.token}` } })
async function addStaff(name, pin) {
  const { invite } = await handleStaffInvite(h.db, owner(), reg.shopCode, { name, role: 'arbeit' })
  const j = await handleStaffJoin(h.db, { token: invite.token, name, pin })
  await handleStaffAction(h.db, owner(), reg.shopCode, j.staffId, 'approve')
  await handleStaffPending(h.db, j.pendingKey)
}
const post = (path, body, ip) => new Request(`https://worker.example${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
  body: JSON.stringify(body),
})

beforeEach(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})   // security event のログを黙らせる
  h = createD1()
  reg = await handleRegister(h.db, { storeName: '本店', pin: '582941' })
})
afterEach(() => vi.restoreAllMocks())

describe('① 数十回程度で攻撃コストが急激に上がる', () => {
  it('5回ごとにロックし、ロックは 15分→30分→1時間→…→24時間（上限）と倍になる', () => {
    expect([1, 4, 6, 9].map(lockMinutesAfter)).toEqual([0, 0, 0, 0])
    expect([5, 10, 15, 20, 25, 30, 35, 40, 45, 500].map(lockMinutesAfter))
      .toEqual([15, 30, 60, 120, 240, 480, 960, 1440, 1440, 1440])
  })

  it('SQL のロックも同じ式で掛かり、ロック中は1回も試させない', async () => {
    const acc = staffAccount('山田')
    let now = Date.UTC(2026, 9, 13)
    for (let n = 1; n <= 45; n++) {
      const r = await reserveLoginAttempt(h.db, reg.shopCode, acc, now)
      expect(r, `${n}回目`).toMatchObject({ ok: true, fails: n })
      const lock = h.rows('SELECT locked_until FROM login_guard WHERE account_key = ?', acc)[0].locked_until
      if (lockMinutesAfter(n)) {
        expect(lock - now).toBe(lockMinutesAfter(n) * 60000)
        expect((await reserveLoginAttempt(h.db, reg.shopCode, acc, lock - 1)).ok).toBe(false)   // 切れる1ms前
        now = lock                                                                                // 切れた瞬間に次
      } else {
        expect(lock).toBeNull()
        now += 1000
      }
    }
  })

  it('ロックが切れるたびに試し続けても、30日で200回に届かない（6桁＝約100万通り）', async () => {
    const acc = staffAccount('佐藤')
    const start = Date.UTC(2026, 9, 13)
    let now = start, tries = 0
    while (now < start + 30 * 86400_000) {
      const r = await reserveLoginAttempt(h.db, reg.shopCode, acc, now)
      if (r.ok) { tries++; now += 1000; continue }
      now = r.lockedUntil                       // ロックが切れるまで待つしかない
    }
    expect(tries).toBeLessThan(200)
    expect(tries).toBeGreaterThan(40)          // 最初の40回までは段階的（正規の人が数回まちがえても困らない）
  })

  it('7日あいたら数え直す（たまに間違える人をずっと重く扱わない）', async () => {
    const acc = staffAccount('鈴木')
    const t0 = Date.UTC(2026, 9, 13)
    for (let i = 0; i < 3; i++) await reserveLoginAttempt(h.db, reg.shopCode, acc, t0 + i)
    expect((await reserveLoginAttempt(h.db, reg.shopCode, acc, t0 + GUARD_DECAY_MS + 10)).fails).toBe(1)
  })

  it('オーナーのログインも同じ: 5回まちがえると正しいPINでも止まり、切れたら入れて回数は消える', async () => {
    for (let i = 0; i < 5; i++) expect((await handleLogin(h.db, { shopCode: reg.shopCode, pin: '0000' }))._status).toBe(401)
    const locked = await handleLogin(h.db, { shopCode: reg.shopCode, pin: '582941' })
    expect(locked._status).toBe(429)
    expect(locked.error).toMatch(/あと\d+分/)
    h.sqlite.prepare('UPDATE login_guard SET locked_until = ? WHERE account_key = ?').run(Date.now() - 1, OWNER_ACCOUNT)
    expect((await handleLogin(h.db, { shopCode: reg.shopCode, pin: '582941' })).token).toBeTruthy()
    expect(h.rows('SELECT * FROM login_guard WHERE account_key = ?', OWNER_ACCOUNT)).toEqual([])
  })
})

describe('② IP を変えても ③ API を直接叩いても、同じアカウントは同じ数え方', () => {
  it('毎回ちがう IP・端末IDで /auth/staff-login を叩いても、5回で止まる', async () => {
    await addStaff('山田', '284713')
    const env = { DB: h.db, ALLOWED_ORIGIN: '' }
    for (let i = 0; i < 5; i++) {
      const res = await worker.fetch(post('/auth/staff-login', { shopCode: reg.shopCode, name: '山田', pin: '000001', deviceId: `dev-${i}` }, `198.51.100.${i}`), env)
      expect(res.status).toBe(401)
    }
    const res = await worker.fetch(post('/auth/staff-login', { shopCode: reg.shopCode, name: '山田', pin: '284713', deviceId: 'new' }, '203.0.113.200'), env)
    expect(res.status).toBe(429)
  })

  it('毎回ちがう IP で /auth/login を叩いても、オーナーは5回で止まる', async () => {
    const env = { DB: h.db, ALLOWED_ORIGIN: '' }
    for (let i = 0; i < 5; i++) {
      expect((await worker.fetch(post('/auth/login', { shopCode: reg.shopCode, pin: '0000' }, `198.51.100.${i}`), env)).status).toBe(401)
    }
    expect((await worker.fetch(post('/auth/login', { shopCode: reg.shopCode, pin: '582941' }, '203.0.113.200'), env)).status).toBe(429)
  })
})

describe('同時リクエストで上限をすり抜けない', () => {
  it('同じアカウントへ50件を同時に送っても、暗証番号を確かめるのは5件だけ', async () => {
    await addStaff('山田', '284713')
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) =>
      handleStaffLogin(h.db, { shopCode: reg.shopCode, name: '山田', pin: String(100000 + i * 7919).slice(0, 6), deviceId: `d${i}` })))
    const statuses = results.map(r => r._status ?? 200)
    expect(statuses.filter(s => s === 401)).toHaveLength(5)
    expect(statuses.filter(s => s === 429)).toHaveLength(45)
  })

  it('1つの IP から別々の店へ50件を同時に送っても、IP の上限（30）を超えて確かめない', async () => {
    const env = { DB: h.db, ALLOWED_ORIGIN: '' }
    const res = await Promise.all(Array.from({ length: 50 }, (_, i) =>
      worker.fetch(post('/auth/login', { shopCode: `ZZ${String(i).padStart(4, 'A')}`, pin: '582941' }, '203.0.113.9'), env)))
    const statuses = res.map(r => r.status)
    expect(statuses.filter(s => s === 429)).toHaveLength(20)
    expect(statuses.filter(s => s === 401)).toHaveLength(30)
  })
})

describe('④ 店のスタッフが同時に使っても影響しない（同じ Wi-Fi・同じ IP）', () => {
  it('10人が同じ IP から同時に何度ログインしても止まらない（成功は IP の回数に数えない）', async () => {
    const people = Array.from({ length: 10 }, (_, i) => ({ name: `スタッフ${i + 1}`, pin: String(284713 + i * 1013) }))
    for (const p of people) await addStaff(p.name, p.pin)
    const env = { DB: h.db, ALLOWED_ORIGIN: '' }
    for (let round = 0; round < 4; round++) {                // 40回 > IP の上限30
      const res = await Promise.all(people.map(p =>
        worker.fetch(post('/auth/staff-login', { shopCode: reg.shopCode, name: p.name, pin: p.pin, deviceId: p.name }, '203.0.113.50'), env)))
      expect(res.map(r => r.status)).toEqual(Array(10).fill(200))
    }
  })

  it('1人が5回まちがえて止まっても、同じ IP の他の人は入れる', async () => {
    await addStaff('山田', '284713')
    await addStaff('佐藤', '395824')
    const env = { DB: h.db, ALLOWED_ORIGIN: '' }
    for (let i = 0; i < 6; i++) await worker.fetch(post('/auth/staff-login', { shopCode: reg.shopCode, name: '山田', pin: '000001', deviceId: 'a' }, '203.0.113.50'), env)
    const res = await worker.fetch(post('/auth/staff-login', { shopCode: reg.shopCode, name: '佐藤', pin: '395824', deviceId: 'b' }, '203.0.113.50'), env)
    expect(res.status).toBe(200)
  })
})
