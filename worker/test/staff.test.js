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
    expect(p.staff).toEqual({ id: j.staffId, name: '山田', role: 'arbeit', grants: [] })
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

describe('役割と足し引き（段 2-3）', () => {
  it('アルバイトは棚卸を始められない。足し引きで「棚卸」を足すと始められる', async () => {
    const { can } = await import('../src/permissions.js')
    const { ctxCan, authContext } = await import('../src/staffHandler.js')
    const { staffId, token } = await joinAndApprove('山田', 'arbeit')
    let ctx = await authContext(db, req(token))
    expect(ctxCan(ctx, 'stock.start')).toBe(false)
    expect(ctxCan(ctx, 'count')).toBe(true)
    expect(ctxCan(ctx, 'money')).toBe(false)
    await handleStaffAction(db, req(owner), code, staffId, 'grants', { grants: ['stock', 'bogus'] })
    ctx = await authContext(db, req(token))
    expect(ctx.grants).toEqual(['stock'])
    expect(ctxCan(ctx, 'stock.start')).toBe(true)
    expect(ctxCan(ctx, 'stock.discard')).toBe(false)
    expect(can('shain', [], 'item.admin')).toBe(false)
    expect(can('admin', [], 'item.admin')).toBe(true)
  })
})

describe('サーバーで権限を守る（ルーター経由）', () => {
  it('アルバイトは棚卸の開始・単価の変更ができず、品目を足すことはできる', async () => {
    const worker = (await import('../src/index.js')).default
    const env = { DB: db, ALLOWED_ORIGIN: 'http://localhost:5199' }
    const { token } = await joinAndApprove('山田', 'arbeit')
    const call = (path, method, body, tok = token) => worker.fetch(new Request(`https://w.test${path}`, {
      method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', Origin: 'http://localhost:5199' },
      body: body ? JSON.stringify(body) : undefined,
    }), env, { waitUntil() {} })
    const start = await call(`/store/${code}/sessions`, 'POST', { type: 'stock' })
    expect(start.status).toBe(403)
    expect((await start.json()).error).toContain('棚卸を始める')
    expect((await call(`/store/${code}/sessions`, 'POST', { type: 'stock' }, owner)).status).toBe(200)
    const cfg = { order: ['トマト'], units: { トマト: '個' }, prices: { トマト: 100 } }
    expect((await call(`/store/${code}/config`, 'PUT', cfg, owner)).status).toBe(200)
    // 単価は金額を見られない人からは採らない（端末には単価を渡していない）。前の単価のまま残る
    expect((await call(`/store/${code}/config`, 'PUT', { ...cfg, prices: { トマト: 120 } })).status).toBe(200)
    expect((await (await call(`/store/${code}/config`, 'GET', null, owner)).json()).prices).toEqual({ トマト: 100 })
    expect((await call(`/store/${code}/config`, 'PUT', { ...cfg, order: ['トマト', 'なす'], units: { ...cfg.units, なす: '本' } })).status).toBe(200)
  })
})

describe('「誰が」を本人へ（段 2-2）', () => {
  it('スタッフの記録はトークンの本人名で刻み、削除したら「（削除済み）」が付く', async () => {
    const worker = (await import('../src/index.js')).default
    const env = { DB: db, ALLOWED_ORIGIN: 'http://localhost:5199' }
    const { token, staffId } = await joinAndApprove('佐藤', 'shain')
    const call = (path, method, body, tok = token) => worker.fetch(new Request(`https://w.test${path}`, {
      method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', Origin: 'http://localhost:5199' },
      body: body ? JSON.stringify(body) : undefined,
    }), env, { waitUntil() {} })

    // 画面が別の名前を送っても、本人の名前になる
    expect((await call(`/store/${code}/sessions`, 'POST', { type: 'stock', by: 'なりすまし', byId: 'dev-x' })).status).toBe(200)
    // オーナーは端末名のまま
    expect((await call(`/store/${code}/sessions`, 'POST', { type: 'order', by: '厨房', byId: 'dev-1' }, owner)).status).toBe(200)
    const sessions = await (await call(`/store/${code}/sessions`, 'GET')).json()
    expect(sessions.map(s => s.startedBy).sort()).toEqual(['佐藤', '厨房'])
    // 完了した人もトークンの本人（クエリの名前は使わない）
    const ord = sessions.find(s => s.type === 'order')
    expect((await call(`/store/${code}/sessions/${ord.id}/complete?by=x&byId=y`, 'POST', { itemCount: 0 })).status).toBe(200)
    expect((await (await call(`/store/${code}/sessions`, 'GET')).json()).find(s => s.id === ord.id).completedBy).toBe('佐藤')

    const task = { id: 't_' + 'a'.repeat(16), date: '2026-10-07', text: '冷蔵庫の掃除', createdBy: 'だれか', createdById: 'dev-x', updatedAt: '2026-10-07T01:00:00.000Z' }
    expect((await call(`/store/${code}/tasks`, 'POST', task)).status).toBe(200)
    // オーナーが完了 → 完了した人は端末名。その後の日付の変更では完了した人は変わらない
    await call(`/store/${code}/tasks`, 'POST', { ...task, doneAt: '2026-10-07T02:00:00.000Z', doneBy: '厨房', doneById: 'dev-1', updatedAt: '2026-10-07T02:00:00.000Z' }, owner)
    await call(`/store/${code}/tasks`, 'POST', { ...task, date: '2026-10-08', doneAt: '2026-10-07T02:00:00.000Z', updatedAt: '2026-10-07T03:00:00.000Z' })
    let [t] = await (await call(`/store/${code}/tasks`, 'GET')).json()
    expect(t.createdBy).toBe('佐藤')
    expect(t.createdById).toBe(staffId)
    expect(t.doneBy).toBe('厨房')
    expect(t.date).toBe('2026-10-08')

    await call(`/store/${code}/movements`, 'POST', { type: 'in', date: '2026-10-07', by: 'なりすまし', lines: [{ item: 'トマト', qty: 1, unit: '個' }] })

    await handleStaffAction(db, req(owner), code, staffId, 'delete')
    ;[t] = await (await call(`/store/${code}/tasks`, 'GET', null, owner)).json()
    expect(t.createdBy).toBe('佐藤（削除済み）')
    const s2 = await (await call(`/store/${code}/sessions`, 'GET', null, owner)).json()
    expect(s2.map(s => s.startedBy).sort()).toEqual(['佐藤（削除済み）', '厨房'])
    const [m] = await (await call(`/store/${code}/movements`, 'GET', null, owner)).json()
    expect(m.by).toBe('佐藤（削除済み）')
  })
})

describe('やることの担当（段 2-4）', () => {
  it('全員: 一人ひとりの印をサーバーで合流し、全員そろったら完了。特定の人・担当の変更は作る権限', async () => {
    const worker = (await import('../src/index.js')).default
    const env = { DB: db, ALLOWED_ORIGIN: 'http://localhost:5199' }
    const a = await joinAndApprove('山田', 'arbeit')
    const b = await joinAndApprove('佐藤', 'shain')
    const call = (path, method, body, tok) => worker.fetch(new Request(`https://w.test${path}`, {
      method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', Origin: 'http://localhost:5199' },
      body: body ? JSON.stringify(body) : undefined,
    }), env, { waitUntil() {} })

    const names = await (await call(`/store/${code}/staff/names`, 'GET', null, a.token)).json()
    expect(names.staff.map(x => x.name)).toEqual(['山田', '佐藤'])

    const task = { id: 't_all1', date: '2026-10-07', text: '手洗いの確認', assign: 'all', updatedAt: '2026-10-07T01:00:00.000Z' }
    expect((await call(`/store/${code}/tasks`, 'POST', task, b.token)).status).toBe(200)
    // 端末が完了の時刻を送っても「全員」は印で決まる
    await call(`/store/${code}/tasks`, 'POST', { ...task, doneAt: '2026-10-07T01:30:00.000Z', updatedAt: '2026-10-07T01:30:00.000Z' }, b.token)
    const get = async () => (await (await call(`/store/${code}/tasks`, 'GET', null, owner)).json()).find(t => t.id === 't_all1')
    expect((await get()).doneAt).toBeNull()

    expect((await call(`/store/${code}/tasks/t_all1/mark`, 'POST', { done: true, by: 'x', byId: 'y' }, a.token)).status).toBe(200)
    let t = await get()
    expect(t.doneList.map(x => x.name)).toEqual(['山田'])
    expect(t.doneAt).toBeNull()
    await call(`/store/${code}/tasks/t_all1/mark`, 'POST', { done: true }, b.token)
    t = await get()
    expect(t.doneList.map(x => x.name).sort()).toEqual(['佐藤', '山田'])
    expect(t.doneAt).not.toBeNull()
    await call(`/store/${code}/tasks/t_all1/mark`, 'POST', { done: false }, a.token)
    t = await get()
    expect(t.doneList.map(x => x.name)).toEqual(['佐藤'])
    expect(t.doneAt).toBeNull()

    // アルバイトは担当を変えられない（作る権限が無い）。社員は変えられる
    // 印はサーバーの今の時刻で updated_at を進めるので、この後の変更はそれより新しい時刻で送る
    const later = m => new Date(Date.now() + m * 60000).toISOString()
    const person = { ...task, assign: 'person', assigneeId: a.staffId, assigneeName: '山田', updatedAt: later(1) }
    expect((await call(`/store/${code}/tasks`, 'POST', person, a.token)).status).toBe(403)
    expect((await call(`/store/${code}/tasks`, 'POST', person, b.token)).status).toBe(200)
    expect((await get()).assigneeName).toBe('山田')
    // アルバイトでも完了の印は付けられる
    expect((await call(`/store/${code}/tasks`, 'POST', { ...person, doneAt: later(2), updatedAt: later(2) }, a.token)).status).toBe(200)
    expect((await get()).doneBy).toBe('山田')

    await handleStaffAction(db, req(owner), code, a.staffId, 'delete')
    expect((await get()).assigneeName).toBe('山田（削除済み）')
  })
})

describe('ログイン中と作業の記録（段 2-5）', () => {
  it('知らせで開いている人が分かり、5分以上あくと別の1回。見られるのは管理者だけ', async () => {
    const { handlePresenceBeat, handlePresenceGet } = await import('../src/presenceHandler.js')
    const worker = (await import('../src/index.js')).default
    const env = { DB: db, ALLOWED_ORIGIN: 'http://localhost:5199' }
    const a = await joinAndApprove('山田', 'arbeit')
    const call = (path, method, body, tok) => worker.fetch(new Request(`https://w.test${path}`, {
      method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', Origin: 'http://localhost:5199' },
      body: body ? JSON.stringify(body) : undefined,
    }), env, { waitUntil() {} })

    // ルーター経由: スタッフは本人、オーナーは端末名
    expect((await call(`/store/${code}/presence`, 'POST', { by: 'x', byId: 'y' }, a.token)).status).toBe(200)
    expect((await call(`/store/${code}/presence`, 'POST', { by: '厨房', byId: 'dev-1' }, owner)).status).toBe(200)
    expect((await call(`/store/${code}/presence`, 'GET', null, a.token)).status).toBe(403)
    const r = await (await call(`/store/${code}/presence`, 'GET', null, owner)).json()
    const yamada = r.people.find(p => p.id === a.staffId)
    expect(yamada).toMatchObject({ name: '山田', online: true })
    expect(r.people.find(p => p.id === 'dev-1')).toMatchObject({ name: '厨房', owner: true, online: true })

    // 閉じた知らせでオフライン。5分以内にまた開けば同じ1回、それより空けば別の1回
    const t0 = Date.parse('2026-10-07T09:00:00.000Z')
    const actor = { id: 'dev-2', name: 'ホール', staff: false }
    await handlePresenceBeat(db, code, actor, 'on', t0)
    await handlePresenceBeat(db, code, actor, 'on', t0 + 90_000)
    await handlePresenceBeat(db, code, actor, 'off', t0 + 120_000)
    let g = await handlePresenceGet(db, code, 7, t0 + 130_000)
    expect(g.people.find(p => p.id === 'dev-2').online).toBe(false)
    await handlePresenceBeat(db, code, actor, 'on', t0 + 200_000)
    g = await handlePresenceGet(db, code, 7, t0 + 210_000)
    expect(g.people.find(p => p.id === 'dev-2').online).toBe(true)
    expect(g.sessions.filter(s => s.id === 'dev-2')).toHaveLength(1)
    await handlePresenceBeat(db, code, actor, 'on', t0 + 20 * 60_000)
    g = await handlePresenceGet(db, code, 7, t0 + 20 * 60_000)
    expect(g.sessions.filter(s => s.id === 'dev-2')).toHaveLength(2)
    expect(g.people.find(p => p.id === 'dev-2').minutes).toBe(4)   // 3分20秒→3分 ＋ 0分→1分
  })
})

describe('定期の掃除', () => {
  it('期限を過ぎた招待・暗証番号の失敗・90日より古い開いていた記録を消す', async () => {
    const { cleanupStaffRecords } = await import('../src/staffHandler.js')
    await handleStaffInvite(db, req(owner), code, { name: '田中', role: 'arbeit' })
    sqlite.prepare("INSERT INTO staff_login_attempts (shop_code, staff_key, device_id, attempted_at) VALUES (?, 'x', 'd', '2000-01-01T00:00:00.000Z')").run(code)
    sqlite.prepare("INSERT INTO work_sessions (id, shop_code, actor_id, name, started_at, last_seen_at) VALUES ('w1', ?, 'a', 'A', '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z')").run(code)
    await cleanupStaffRecords(db, Date.now())
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM staff_invites').get().n).toBe(1)   // まだ期限内
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM staff_login_attempts').get().n).toBe(0)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM work_sessions').get().n).toBe(0)
    await cleanupStaffRecords(db, Date.now() + 30 * 60_000)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM staff_invites').get().n).toBe(0)
  })
})

describe('やることの時刻・直す・担当の通知先（TODO 本格化 A）', () => {
  it('時刻を保存し、直すのは作る権限。通知の購読は誰の端末かを覚える', async () => {
    const worker = (await import('../src/index.js')).default
    const env = { DB: db, ALLOWED_ORIGIN: 'http://localhost:5199' }
    const a = await joinAndApprove('山田', 'arbeit')
    const b = await joinAndApprove('佐藤', 'shain')
    const call = (path, method, body, tok) => worker.fetch(new Request(`https://w.test${path}`, {
      method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', Origin: 'http://localhost:5199' },
      body: body ? JSON.stringify(body) : undefined,
    }), env, { waitUntil() {} })
    const later = m => new Date(Date.now() + m * 60000).toISOString()
    const task = { id: 't_time1', date: '2026-10-07', text: '野菜の検品', dueTime: '11:00', updatedAt: later(0) }
    expect((await call(`/store/${code}/tasks`, 'POST', task, b.token)).status).toBe(200)
    const get = async () => (await (await call(`/store/${code}/tasks`, 'GET', null, owner)).json()).find(t => t.id === 't_time1')
    expect((await get()).dueTime).toBe('11:00')
    // 壊れた時刻は時刻なし
    await call(`/store/${code}/tasks`, 'POST', { ...task, dueTime: '25:99', updatedAt: later(1) }, b.token)
    expect((await get()).dueTime).toBeNull()
    // アルバイトは文面・日付・時刻を直せない。完了の印は付けられる
    expect((await call(`/store/${code}/tasks`, 'POST', { ...task, dueTime: null, text: '野菜の検品（午後）', updatedAt: later(2) }, a.token)).status).toBe(403)
    expect((await call(`/store/${code}/tasks`, 'POST', { ...task, dueTime: null, date: '2026-10-08', updatedAt: later(2) }, a.token)).status).toBe(403)
    expect((await call(`/store/${code}/tasks`, 'POST', { ...task, dueTime: null, doneAt: later(3), updatedAt: later(3) }, a.token)).status).toBe(200)
    expect((await get()).doneBy).toBe('山田')

    // 通知の購読: スタッフはトークンの本人、オーナーは送った端末 ID
    const sub = (ep, byId) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${ep}`, keys: { p256dh: 'B' + 'A'.repeat(86), auth: 'A'.repeat(22) }, byId })
    const r1 = await call(`/store/${code}/push/subscribe`, 'POST', sub('a1', 'なりすまし'), a.token)
    const r2 = await call(`/store/${code}/push/subscribe`, 'POST', sub('o1', 'dev-owner'), owner)
    const rows = sqlite.prepare('SELECT endpoint, actor_id FROM push_subscriptions ORDER BY endpoint').all()
    if (r1.status === 200) {
      expect(rows.find(r => r.endpoint.endsWith('a1')).actor_id).toBe(a.staffId)
      expect(rows.find(r => r.endpoint.endsWith('o1')).actor_id).toBe('dev-owner')
    } else {
      throw new Error(`subscribe failed ${r1.status} ${await r1.text()} / ${r2.status}`)
    }
  })
})
