// ルーム（Durable Object）でも、金額を見られないスタッフのホストには単価を渡さない（段 2-3 の money）。
// ゲストへは以前から落としていた（S-G）。ホストはトークンで人を確かめて決める。
// トークンの役割は全マイグレーションを当てた SQLite で本物を作る。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { RoomDO } from '../src/RoomDO.js'
import { makeState } from './doState.js'
import { handleRegister } from '../src/authHandler.js'
import { handleStaffInvite, handleStaffJoin, handleStaffPending, handleStaffAction } from '../src/staffHandler.js'

const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url))
let sqlite, db, owner, code
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
async function staffToken(name, role) {
  const { invite } = await handleStaffInvite(db, req(owner), code, { name, role })
  const j = await handleStaffJoin(db, { token: invite.token, name, pin: '284713' })
  await handleStaffAction(db, req(owner), code, j.staffId, 'approve')
  return (await handleStaffPending(db, j.pendingKey)).token
}
function makeWs() {
  const sent = []
  let att = null
  return {
    deserializeAttachment() { return att },
    serializeAttachment(v) { att = v },
    send(d) { sent.push(JSON.parse(d)) },
    close() {},
    _att: () => att,
    _sent: sent,
  }
}

const PRICES = { トマト: 100, なす: 80 }
function room(wsList) {
  const state = makeState(wsList, { shopCode: code, config: { order: ['トマト', 'なす'], prices: PRICES } })
  return new RoomDO(state, { DB: db })
}

beforeEach(async () => {
  db = makeDb()
  const r = await handleRegister(db, { storeName: '本店', pin: '1234' })
  owner = r.token; code = r.shopCode
})
afterEach(() => sqlite?.close())

describe('ホストへの単価', () => {
  it('オーナー・社員のホストには単価を渡す', async () => {
    for (const tok of [owner, await staffToken('佐藤', 'shain')]) {
      const ws = makeWs()
      const r = room([ws])
      await r._handleMessage(ws, { type: 'join', role: 'host', deviceId: 'd-1', deviceName: '厨房', authToken: tok })
      expect(ws._sent[0].type).toBe('joined')
      expect(ws._sent[0].config.prices).toEqual(PRICES)
      expect(ws._att().noMoney).toBeUndefined()
    }
  })

  it('アルバイトのホストには単価を渡さない（joined・その後の配信とも）', async () => {
    const ws = makeWs()
    const r = room([ws])
    await r._handleMessage(ws, { type: 'join', role: 'host', deviceId: 'd-2', deviceName: '山田', authToken: await staffToken('山田', 'arbeit') })
    expect(ws._sent[0].type).toBe('joined')
    expect(ws._sent[0].config.prices).toBeUndefined()
    expect(ws._sent[0].config.order).toEqual(['トマト', 'なす'])
    expect(ws._att()).toMatchObject({ isHost: true, noMoney: true })
    r._broadcastPriceAware({ type: 'config_update', order: ['トマト'], prices: PRICES })
    expect(ws._sent.at(-1).prices).toBeUndefined()
  })

  it('アルバイトのホストが送った品目リスト・開始の設定では、単価は前の値のまま', async () => {
    const ws = makeWs()
    const r = room([ws])
    await r._handleMessage(ws, { type: 'join', role: 'host', deviceId: 'd-2', deviceName: '山田', authToken: await staffToken('山田', 'arbeit') })
    await r._handleMessage(ws, { type: 'config', order: ['トマト', 'なす', 'きゅうり'], prices: {} })
    expect(r.state._store.get('config').prices).toEqual(PRICES)
    expect(r.state._store.get('config').order).toEqual(['トマト', 'なす', 'きゅうり'])
    await r._handleMessage(ws, { type: 'session_start', sessionId: 's-new', inventory: {}, config: { order: ['トマト'], prices: { トマト: 1 } } })
    expect(r.state._store.get('config').prices).toEqual(PRICES)
  })

  it('保護された店で人が分からないホスト（トークン無し）には単価を渡さない', async () => {
    const r = room([])
    expect(await r._hostSeesMoney(code, '')).toBe(false)
    expect(await r._hostSeesMoney(code, 'expired-or-forged')).toBe(false)
    expect(await r._hostSeesMoney(code, owner)).toBe(true)
  })

  it('PIN の無い古い店（役割が無い）は従来どおり見せる', async () => {
    sqlite.prepare("INSERT INTO stores (shop_code, created_at, updated_at) VALUES ('LEGACY', 'x', 'x')").run()
    const r = room([])
    expect(await r._hostSeesMoney('LEGACY', '')).toBe(true)
  })
})
