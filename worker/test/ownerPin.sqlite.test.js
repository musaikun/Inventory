// オーナー PIN の6桁化（D-030・migration 0029）を、全migrationを当てた実SQLiteで確かめる。
// 新しい店は6桁。以前に4桁で登録した店は4桁のまま入れるが、ログインした時点で6桁への変更を求め、
// 変えたら4桁では入れず、ほかの端末のオーナーのログインは切れる。
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createD1 } from './d1Harness.js'
import worker from '../src/index.js'
import { handleRegister, handleLogin, handleOwnerPinChange, _hashPin, verifyAuth } from '../src/authHandler.js'
import { handleMe, handleStaffInvite, handleStaffJoin, handleStaffAction, handleStaffPending } from '../src/staffHandler.js'

let h
const bearer = token => new Request('https://w/', { headers: { Authorization: `Bearer ${token}` } })
const change = (token, currentPin, newPin) => handleOwnerPinChange(h.db, bearer(token), { currentPin, newPin })

/** 以前の登録（4桁・pin_digits なし）の店を作る */
async function legacyStore(pin = '1234') {
  const reg = await handleRegister(h.db, { pin: '582941' })
  h.sqlite.prepare('UPDATE stores SET pin_hash = ?, pin_digits = NULL WHERE shop_code = ?').run(await _hashPin(pin), reg.shopCode)
  return reg.shopCode
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  h = createD1()
})
afterEach(() => vi.restoreAllMocks())

describe('新しい店は6桁', () => {
  it('6桁で登録でき、ログインしても変更は求めない', async () => {
    const reg = await handleRegister(h.db, { pin: '582941' })
    expect(h.rows('SELECT pin_digits FROM stores WHERE shop_code = ?', reg.shopCode)[0].pin_digits).toBe(6)
    const login = await handleLogin(h.db, { shopCode: reg.shopCode, pin: '582941' })
    expect(login.token).toBeTruthy()
    expect(login.pinUpgradeRequired).toBe(false)
    expect((await handleMe(h.db, bearer(login.token))).pinUpgradeRequired).toBe(false)
  })

  it('4桁・弱い並びでは登録できない', async () => {
    for (const pin of ['1234', '123456', '000000', '454545']) {
      expect((await handleRegister(h.db, { pin }))).toMatchObject({ _status: 400, code: 'weak_pin' })
    }
  })
})

describe('以前に4桁で登録した店', () => {
  it('4桁で入れるが、ログインとアプリの起動（/auth/me）で6桁への変更を求める', async () => {
    const code = await legacyStore('1234')
    const login = await handleLogin(h.db, { shopCode: code, pin: '1234' })
    expect(login.token).toBeTruthy()
    expect(login.pinUpgradeRequired).toBe(true)
    expect((await handleMe(h.db, bearer(login.token))).pinUpgradeRequired).toBe(true)
  })

  it('6桁へ変えると、4桁では入れず、6桁で入れて、変更はもう求めない', async () => {
    const code = await legacyStore('1234')
    const { token } = await handleLogin(h.db, { shopCode: code, pin: '1234' })
    expect(await change(token, '1234', '582941')).toEqual({ ok: true, pinUpgradeRequired: false })
    expect((await handleLogin(h.db, { shopCode: code, pin: '1234' }))._status).toBe(401)
    const again = await handleLogin(h.db, { shopCode: code, pin: '582941' })
    expect(again.pinUpgradeRequired).toBe(false)
  })

  it('変えたら、この端末以外のオーナーのログインは切れ、スタッフのログインは残る', async () => {
    const code = await legacyStore('1234')
    const other = (await handleLogin(h.db, { shopCode: code, pin: '1234' })).token   // 4桁を知っている誰か
    // オーナーのログインは同じ店の前のオーナーtokenを消すので、手で2本目を作る（別の端末で開いたまま）
    const me = (await handleLogin(h.db, { shopCode: code, pin: '1234' })).token
    h.sqlite.prepare("INSERT INTO auth_tokens (token, shop_code, expires_at, created_at) VALUES ('raw-other', ?, '2999-01-01T00:00:00.000Z', '2026-10-13')").run(code)
    const { invite } = await handleStaffInvite(h.db, bearer(me), code, { name: '山田', role: 'arbeit' })
    const j = await handleStaffJoin(h.db, { token: invite.token, name: '山田', pin: '284713' })
    await handleStaffAction(h.db, bearer(me), code, j.staffId, 'approve')
    const staff = (await handleStaffPending(h.db, j.pendingKey)).token

    expect((await change(me, '1234', '582941')).ok).toBe(true)
    expect(await verifyAuth(h.db, bearer(me))).toBe(code)
    expect(await verifyAuth(h.db, bearer('raw-other'))).toBeNull()
    expect(await verifyAuth(h.db, bearer(other))).toBeNull()
    expect(await verifyAuth(h.db, bearer(staff))).toBe(code)
  })
})

describe('PIN を変える（POST /auth/pin）', () => {
  it('新しい PIN の決まり・同じ PIN・今の PIN の間違いは、変えずに断る', async () => {
    const code = await legacyStore('1234')
    const { token } = await handleLogin(h.db, { shopCode: code, pin: '1234' })
    expect(await change(token, '1234', '123456')).toMatchObject({ _status: 400, code: 'weak_pin' })
    expect(await change(token, '1234', '5829')).toMatchObject({ _status: 400, code: 'weak_pin' })
    expect(await change(token, '0000', '582941')).toMatchObject({ _status: 401, code: 'wrong_pin' })
    expect((await handleLogin(h.db, { shopCode: code, pin: '1234' })).token).toBeTruthy()   // まだ4桁のまま
  })

  it('今の PIN の確認もログインと同じ段階的なロックに載る（token があっても総当たりできない）', async () => {
    const reg = await handleRegister(h.db, { pin: '582941' })
    for (let i = 0; i < 5; i++) expect((await change(reg.token, `11111${i}`.slice(0, 6), '693027'))._status).toBe(401)
    expect((await change(reg.token, '582941', '693027'))._status).toBe(429)
    expect((await handleLogin(h.db, { shopCode: reg.shopCode, pin: '582941' }))._status).toBe(429)   // ログインも同じロック
  })

  it('スタッフの token・token なしでは変えられない', async () => {
    const reg = await handleRegister(h.db, { pin: '582941' })
    const { invite } = await handleStaffInvite(h.db, bearer(reg.token), reg.shopCode, { name: '山田', role: 'admin' })
    const j = await handleStaffJoin(h.db, { token: invite.token, name: '山田', pin: '284713' })
    await handleStaffAction(h.db, bearer(reg.token), reg.shopCode, j.staffId, 'approve')
    const staff = (await handleStaffPending(h.db, j.pendingKey)).token
    expect(await change(staff, '582941', '693027')).toMatchObject({ _status: 403 })
    expect(await handleOwnerPinChange(h.db, new Request('https://w/'), { currentPin: '582941', newPin: '693027' })).toMatchObject({ _status: 401 })
  })

  it('ルーター経由でも同じ（POST /auth/pin）', async () => {
    const code = await legacyStore('1234')
    const { token } = await handleLogin(h.db, { shopCode: code, pin: '1234' })
    const res = await worker.fetch(new Request('https://worker.example/auth/pin', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPin: '1234', newPin: '582941' }),
    }), { DB: h.db, ALLOWED_ORIGIN: '' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, pinUpgradeRequired: false })
  })
})

describe('account削除の再認証', () => {
  it('6桁の店は6桁で、まだ4桁の店は4桁で削除できる', async () => {
    const { handleAccountDelete } = await import('../src/accountDeletion.js')
    const reg = await handleRegister(h.db, { pin: '582941' })
    const r6 = await handleAccountDelete(h.db, bearer(reg.token), { requestId: '33333333-3333-4333-8333-333333333333', pin: '582941', confirmation: reg.shopCode }, async () => {})
    expect(r6._status ?? 200).toBe(200)
    const code = await legacyStore('1234')
    const { token } = await handleLogin(h.db, { shopCode: code, pin: '1234' })
    const r4 = await handleAccountDelete(h.db, bearer(token), { requestId: '44444444-4444-4444-8444-444444444444', pin: '1234', confirmation: code }, async () => {})
    expect(r4._status ?? 200).toBe(200)
  })
})
