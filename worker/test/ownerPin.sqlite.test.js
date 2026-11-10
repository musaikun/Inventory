// オーナーの暗証番号を6桁にそろえる（D-036・migration 0037）。全マイグレーションを当てた SQLite で確かめる
import { describe, it, expect } from 'vitest'
import { createD1 } from './d1Harness.js'
import { handleRegister, handleLogin, handlePinChange, _hashPin } from '../src/authHandler.js'
import { handleMe } from '../src/staffHandler.js'

const req = token => new Request('https://w.test/', { headers: { Authorization: `Bearer ${token}` } })
async function seedLegacy(h, code = 'OLDAAA', pin = '1234') {
  // migration 前からある店（pin_digits は NULL＝4桁）
  h.db.prepare && await h.db.prepare("INSERT INTO stores (shop_code, store_name, pin_hash, plan, created_at, updated_at) VALUES (?, '古い店', ?, 'free', datetime('now'), datetime('now'))").bind(code, await _hashPin(pin)).run()
  return code
}

describe('オーナーの暗証番号（6桁へ）', () => {
  it('新しい店は6桁だけ。4桁・弱い並びは登録できない', async () => {
    const h = createD1()
    expect(await handleRegister(h.db, { pin: '1234' })).toMatchObject({ _status: 400, code: 'invalid_pin' })
    expect(await handleRegister(h.db, { pin: '123456' })).toMatchObject({ _status: 400 })
    const ok = await handleRegister(h.db, { pin: '583920' })
    expect(ok.shopCode).toBeTruthy()
    expect(h.rows('SELECT pin_digits, pin_upgrade_due FROM stores')[0]).toEqual({ pin_digits: 6, pin_upgrade_due: null })
    expect((await handleLogin(h.db, { shopCode: ok.shopCode, pin: '583920' })).pinUpgrade).toBeNull()
  })

  it('4桁の店: そのままログインでき、初めてのログインで30日の期限が入る（次のログインでも同じ期限）。/auth/me にも出る', async () => {
    const h = createD1()
    const code = await seedLegacy(h)
    const a = await handleLogin(h.db, { shopCode: code, pin: '1234' })
    expect(a.token).toBeTruthy()
    expect(a.pinUpgrade.overdue).toBe(false)
    const days = (Date.parse(a.pinUpgrade.due) - Date.now()) / 86400_000
    expect(days).toBeGreaterThan(29.9); expect(days).toBeLessThan(30.1)
    const b = await handleLogin(h.db, { shopCode: code, pin: '1234' })
    expect(b.pinUpgrade.due).toBe(a.pinUpgrade.due)
    expect((await handleMe(h.db, req(b.token))).pinUpgrade).toEqual({ due: a.pinUpgrade.due, overdue: false })
  })

  it('期限を過ぎても4桁でログインはできる（overdue で知らせ、画面で変えてもらう）', async () => {
    const h = createD1()
    const code = await seedLegacy(h)
    await h.db.prepare("UPDATE stores SET pin_digits = 4, pin_upgrade_due = ? WHERE shop_code = ?").bind(new Date(Date.now() - 1000).toISOString(), code).run()
    const r = await handleLogin(h.db, { shopCode: code, pin: '1234' })
    expect(r.token).toBeTruthy()
    expect(r.pinUpgrade.overdue).toBe(true)
  })

  it('変える: 今の番号が違えば401（回数に数える）、弱い番号は400。変えたら6桁で入れ、4桁では入れず、期限は消える', async () => {
    const h = createD1()
    const code = await seedLegacy(h)
    const { token } = await handleLogin(h.db, { shopCode: code, pin: '1234' })
    expect(await handlePinChange(h.db, req(token), { currentPin: '9999', newPin: '583920' })).toMatchObject({ _status: 401, code: 'wrong_pin' })
    expect(h.rows('SELECT COUNT(*) AS n FROM login_attempts')[0].n).toBe(1)
    expect(await handlePinChange(h.db, req(token), { currentPin: '1234', newPin: '111111' })).toMatchObject({ _status: 400 })
    expect(await handlePinChange(h.db, req(token), { currentPin: '1234', newPin: '583920' })).toEqual({ ok: true, pinUpgrade: null })
    expect(h.rows('SELECT pin_digits, pin_upgrade_due FROM stores')[0]).toEqual({ pin_digits: 6, pin_upgrade_due: null })
    expect((await handleLogin(h.db, { shopCode: code, pin: '1234' }))._status).toBe(401)
    expect((await handleLogin(h.db, { shopCode: code, pin: '583920' })).pinUpgrade).toBeNull()
  })

  it('スタッフのトークンや無いトークンでは変えられない', async () => {
    const h = createD1()
    const code = await seedLegacy(h)
    await handleLogin(h.db, { shopCode: code, pin: '1234' })
    expect((await handlePinChange(h.db, req('nope'), { currentPin: '1234', newPin: '583920' }))._status).toBe(401)
    await h.db.prepare("INSERT INTO auth_tokens (token, shop_code, staff_id, expires_at, created_at) VALUES ('staff-t', ?, 'st_x', datetime('now', '+1 day'), datetime('now'))").bind(code).run()
    expect((await handlePinChange(h.db, req('staff-t'), { currentPin: '1234', newPin: '583920' }))._status).toBe(403)
  })
})
