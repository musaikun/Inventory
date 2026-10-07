// スタッフごとのログイン（段 2-1・User決定 2026-10-07）を、現行の全マイグレーションを当てた SQLite で通す。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { handleRegister, handleLogin, verifyAuthToken } from '../src/authHandler.js'
import {
  handleStaffInvite, handleInviteInfo, handleStaffJoin, handleStaffPending, handleStaffAction,
  handleStaffList, handleStaffLogin, handleStaffUnlock, handleMe, pinProblem,
} from '../src/staffHandler.js'

const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url))
let sqlite, db
function makeDb() {
  sqlite = new DatabaseSync(':memory:')
  for (const f of readdirSync(migrationsDir).filter(n => n.endsWith('.sql')).sort()) sqlite.exec(readFileSync(join(migrationsDir, f), 'utf8'))
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
  return { prepare, async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out } }
}
const req = token => new Request('https://w.test/', { headers: token ? { Authorization: `Bearer ${token}` } : {} })

let owner, code
beforeEach(async () => {
  db = makeDb()
  const r = await handleRegister(db, { storeName: '本店', pin: '1234' })
  owner = r.token; code = r.shopCode
})
afterEach(() => sqlite?.close())

async function joinAndApprove(name = '山田', role = 'arbeit', pin = '284713') {
  const { invite } = await handleStaffInvite(db, req(owner), code, { name, role })
  const j = await handleStaffJoin(db, { token: invite.token, name, pin })
  await handleStaffAction(db, req(owner), code, j.staffId, 'approve')
  const p = await handleStaffPending(db, j.pendingKey)
  return { staffId: j.staffId, token: p.token, pendingKey: j.pendingKey }
}

describe('暗証番号', () => {
  it('6桁で、同じ数字・連番・くり返しは使えない', () => {
    expect(pinProblem('12345')).toMatch('6桁')
    for (const p of ['000000', '123456', '987654', '123123', '121212']) expect(pinProblem(p)).not.toBe('')
    expect(pinProblem('284713')).toBe('')
  })
})

describe('招待 → 申請 → 承認', () => {
  it('招待は1回きり。承認されるまで待ち、承認されたら申請した端末に1回だけトークンを渡す', async () => {
    const { invite } = await handleStaffInvite(db, req(owner), code, { name: '山田', role: 'arbeit' })
    expect((await handleInviteInfo(db, invite.token)).name).toBe('山田')
    expect((await handleStaffJoin(db, { token: invite.token, name: '山田', pin: '111111' }))._status).toBe(400)
    const j = await handleStaffJoin(db, { token: invite.token, name: '山田', pin: '284713' })
    expect(j.pendingKey).toMatch(/^[0-9a-f]{48}$/)
    expect((await handleStaffJoin(db, { token: invite.token, name: '別人', pin: '284713' }))._status).toBe(404)   // 使用済み
    expect((await handleStaffPending(db, j.pendingKey)).status).toBe('pending')
    expect((await handleStaffLogin(db, { shopCode: code, name: '山田', pin: '284713', deviceId: 'd1' })).code).toBe('pending')
    await handleStaffAction(db, req(owner), code, j.staffId, 'approve')
    const p = await handleStaffPending(db, j.pendingKey)
    expect(p.status).toBe('active')
    expect(p.staff).toEqual({ id: j.staffId, name: '山田', role: 'arbeit' })
    expect(await verifyAuthToken(db, p.token)).toBe(code)
    expect((await handleStaffPending(db, j.pendingKey)).status).toBe('gone')   // 2回目は渡さない
    expect((await handleMe(db, req(p.token))).role).toBe('arbeit')
  })

  it('期限切れの招待は使えない', async () => {
    const { invite } = await handleStaffInvite(db, req(owner), code, { name: '佐藤', role: 'shain' })
    sqlite.prepare("UPDATE staff_invites SET expires_at = '2000-01-01T00:00:00.000Z'").run()
    expect((await handleInviteInfo(db, invite.token))._status).toBe(404)
  })

  it('同じ名前は2人目を受け付けない', async () => {
    await joinAndApprove('山田')
    const { invite } = await handleStaffInvite(db, req(owner), code, { name: '山田', role: 'arbeit' })
    expect((await handleStaffJoin(db, { token: invite.token, name: ' 山田 ', pin: '284713' })).code).toBe('name_taken')
  })
})

describe('権限と停止', () => {
  it('管理者でないスタッフは招待もスタッフ一覧もできない', async () => {
    const { token } = await joinAndApprove('山田', 'shain')
    expect((await handleStaffInvite(db, req(token), code, { name: 'x', role: 'arbeit' }))._status).toBe(403)
    expect((await handleStaffList(db, req(token), code))._status).toBe(403)
    const admin = await joinAndApprove('鈴木', 'admin', '502719')
    expect((await handleStaffList(db, req(admin.token), code)).staff).toHaveLength(2)
  })

  it('停止・削除でトークンが即座に無効。削除済みは名前を残し暗証番号を消す', async () => {
    const { staffId, token } = await joinAndApprove()
    await handleStaffAction(db, req(owner), code, staffId, 'stop')
    expect(await verifyAuthToken(db, token)).toBeNull()
    expect((await handleStaffLogin(db, { shopCode: code, name: '山田', pin: '284713', deviceId: 'd1' })).code).toBe('stopped')
    await handleStaffAction(db, req(owner), code, staffId, 'delete')
    const row = sqlite.prepare('SELECT name, status, pin_hash FROM staff WHERE id = ?').get(staffId)
    expect(row).toEqual({ name: '山田', status: 'deleted', pin_hash: null })
  })

  it('オーナーがログインし直しても、スタッフは追い出されない', async () => {
    const { token } = await joinAndApprove()
    await handleLogin(db, { shopCode: code, pin: '1234' })
    expect(await verifyAuthToken(db, token)).toBe(code)
    expect(await verifyAuthToken(db, owner)).toBeNull()   // オーナーの古いトークンは今まで通り1つだけ
  })
})

describe('スタッフのログイン', () => {
  it('店舗コード・名前・暗証番号で入れる。5回まちがえたらその端末からは15分止め、管理者が解除できる', async () => {
    const { staffId } = await joinAndApprove()
    const ok = await handleStaffLogin(db, { shopCode: code.toLowerCase(), name: '山田', pin: '284713', deviceId: 'd1' })
    expect(ok.token).toBeTruthy()
    for (let i = 0; i < 5; i++) expect((await handleStaffLogin(db, { shopCode: code, name: '山田', pin: '000001', deviceId: 'd2' }))._status).toBe(401)
    expect((await handleStaffLogin(db, { shopCode: code, name: '山田', pin: '284713', deviceId: 'd2' }))._status).toBe(429)
    expect((await handleStaffLogin(db, { shopCode: code, name: '山田', pin: '284713', deviceId: 'd1' })).token).toBeTruthy()   // 別の端末は止めない
    await handleStaffUnlock(db, req(owner), code, staffId)
    expect((await handleStaffLogin(db, { shopCode: code, name: '山田', pin: '284713', deviceId: 'd2' })).token).toBeTruthy()
  })
})
