// 金額（money）と、古い API の権限を、全マイグレーションを当てた SQLite と router で通す。
// 画面で隠すだけでは、アルバイトのトークンで API を直接呼べば単価が読め、履歴も消せた。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import worker from '../src/index.js'
import { handleRegister } from '../src/authHandler.js'
import { handleStaffInvite, handleStaffJoin, handleStaffPending, handleStaffAction } from '../src/staffHandler.js'

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
  return { prepare, async batch(list) { const out = []; for (const s of list) out.push(await s.all()); return out } }
}
const req = token => new Request('https://w.test/', { headers: token ? { Authorization: `Bearer ${token}` } : {} })

let owner, code, env
beforeEach(async () => {
  db = makeDb()
  const r = await handleRegister(db, { storeName: '本店', pin: '1234' })
  owner = r.token; code = r.shopCode
  env = { DB: db, ALLOWED_ORIGIN: 'http://localhost:5199' }
})
afterEach(() => sqlite?.close())

async function staffToken(name, role, grants = null) {
  const { invite } = await handleStaffInvite(db, req(owner), code, { name, role })
  const j = await handleStaffJoin(db, { token: invite.token, name, pin: '284713' })
  await handleStaffAction(db, req(owner), code, j.staffId, 'approve')
  if (grants) await handleStaffAction(db, req(owner), code, j.staffId, 'grants', { grants })
  return (await handleStaffPending(db, j.pendingKey)).token
}
const call = (path, method, body, tok) => worker.fetch(new Request(`https://w.test${path}`, {
  method, headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), 'Content-Type': 'application/json', Origin: 'http://localhost:5199' },
  body: body ? JSON.stringify(body) : undefined,
}), env, { waitUntil() {} })
const json = async res => res.json()

const cfg = { order: ['トマト', 'なす'], units: { トマト: '個', なす: '本' }, prices: { トマト: 100, なす: 80 } }
const SID = '11111111-1111-4111-8111-111111111111'
const snap = () => ({
  date: '2026-10-07', sessionId: SID,
  items: [
    { item: 'トマト', qty: 3, unit: '個', unitPrice: 100, subtotal: 300 },
    { item: 'なす',   qty: 2, unit: '本', unitPrice: 80,  subtotal: 160 },
  ],
  totalValue: 460,
  participants: [{ name: '厨房', totalValue: 460, items: [{ item: 'トマト', qty: 3, unit: '個', subtotal: 300 }] }],
})
const storedHistory = () => JSON.parse(sqlite.prepare('SELECT snapshot_json FROM store_history WHERE session_id = ?').get(SID).snapshot_json)

describe('品目リスト（config）の単価', () => {
  it('金額を見られない人には単価を渡さない。オーナー・社員には渡す', async () => {
    expect((await call(`/store/${code}/config`, 'PUT', cfg, owner)).status).toBe(200)
    const arbeit = await staffToken('山田', 'arbeit')
    const shain  = await staffToken('佐藤', 'shain')
    expect((await json(await call(`/store/${code}/config`, 'GET', null, arbeit))).prices).toEqual({})
    expect((await json(await call(`/store/${code}/config`, 'GET', null, arbeit))).order).toEqual(cfg.order)
    expect((await json(await call(`/store/${code}/config`, 'GET', null, shain))).prices).toEqual(cfg.prices)
    expect((await json(await call(`/store/${code}/config`, 'GET', null, owner))).prices).toEqual(cfg.prices)
  })

  it('単価を持たない端末が保存しても、店の単価は消えない（送られた単価は採らない）', async () => {
    await call(`/store/${code}/config`, 'PUT', cfg, owner)
    const arbeit = await staffToken('山田', 'arbeit')
    const mine = await json(await call(`/store/${code}/config`, 'GET', null, arbeit))
    // アルバイトが品目を足す（受け取った config に1品目足して丸ごと保存）
    const next = { ...mine, order: [...mine.order, 'きゅうり'], units: { ...mine.units, きゅうり: '本' } }
    expect((await call(`/store/${code}/config`, 'PUT', next, arbeit)).status).toBe(200)
    const saved = await json(await call(`/store/${code}/config`, 'GET', null, owner))
    expect(saved.order).toEqual(['トマト', 'なす', 'きゅうり'])
    expect(saved.prices).toEqual(cfg.prices)
    // 単価を書き換えようとしても採らない
    expect((await call(`/store/${code}/config`, 'PUT', { ...saved, prices: { トマト: 1 } }, arbeit)).status).toBe(200)
    expect((await json(await call(`/store/${code}/config`, 'GET', null, owner))).prices).toEqual(cfg.prices)
  })
})

describe('履歴の金額', () => {
  it('金額を見られない人には単価・小計・在庫金額を落として渡す', async () => {
    expect((await call(`/store/${code}/history`, 'POST', snap(), owner)).status).toBe(200)
    const arbeit = await staffToken('山田', 'arbeit')
    const [h] = await json(await call(`/store/${code}/history`, 'GET', null, arbeit))
    expect(h.totalValue).toBeNull()
    expect(h.items.map(i => [i.item, i.qty, i.unitPrice, i.subtotal])).toEqual([['トマト', 3, null, null], ['なす', 2, null, null]])
    expect(h.participants[0].totalValue).toBeNull()
    expect(h.participants[0].items[0].subtotal).toBeNull()
    const [full] = await json(await call(`/store/${code}/history`, 'GET', null, owner))
    expect(full.totalValue).toBe(460)
  })

  it('金額を落とした版を送り直されても（ロック）、金額はそのまま残る', async () => {
    await call(`/store/${code}/history`, 'POST', snap(), owner)
    const arbeit = await staffToken('山田', 'arbeit')
    const [h] = await json(await call(`/store/${code}/history`, 'GET', null, arbeit))
    expect((await call(`/store/${code}/history`, 'POST', { ...h, locked: true }, arbeit)).status).toBe(200)
    const s = storedHistory()
    expect(s.locked).toBe(true)
    expect(s.totalValue).toBe(460)
    expect(s.items.map(i => [i.unitPrice, i.subtotal])).toEqual([[100, 300], [80, 160]])
    expect(s.participants[0].totalValue).toBe(460)
    expect(s.participants[0].items[0].subtotal).toBe(300)
  })

  it('数量の訂正は、サーバーの単価で小計と在庫金額を計算し直す', async () => {
    await call(`/store/${code}/history`, 'POST', snap(), owner)
    const arbeit = await staffToken('山田', 'arbeit')
    const [h] = await json(await call(`/store/${code}/history`, 'GET', null, arbeit))
    const fixed = { ...h, items: h.items.map(i => (i.item === 'トマト' ? { ...i, qty: 5 } : i)) }
    expect((await call(`/store/${code}/history`, 'POST', fixed, arbeit)).status).toBe(200)
    const s = storedHistory()
    expect(s.items.map(i => [i.item, i.qty, i.unitPrice, i.subtotal])).toEqual([['トマト', 5, 100, 500], ['なす', 2, 80, 160]])
    expect(s.totalValue).toBe(660)
  })

  it('アルバイトは履歴・発注・入出庫を削除できない（棚卸・発注を破棄する権限）', async () => {
    const arbeit = await staffToken('山田', 'arbeit')
    for (const path of [`/history/${SID}`, '/orders/o_1', '/movements/m_1']) {
      const res = await call(`/store/${code}${path}`, 'DELETE', null, arbeit)
      expect(res.status).toBe(403)
    }
    const shain = await staffToken('佐藤', 'shain')
    expect((await call(`/store/${code}/orders/o_1`, 'DELETE', null, shain)).status).not.toBe(403)
    expect((await call(`/store/${code}/orders/o_1`, 'DELETE', null, owner)).status).not.toBe(403)
  })
})

describe('棚卸の完了と明細', () => {
  it('金額を見られない人が完了しても、単価は店の品目リストから取って在庫金額を記録する', async () => {
    await call(`/store/${code}/config`, 'PUT', cfg, owner)
    const lead = await staffToken('山田', 'arbeit', ['stock'])   // アルバイト＋棚卸を任された人
    const started = await json(await call(`/store/${code}/sessions`, 'POST', { type: 'stock' }, lead))
    const body = {
      inventory: { トマト: { qty: 3, unit: '個' }, なす: { qty: 2, unit: '本' } },
      prices: {},   // 端末は単価を持っていない
      takenAt: '2026-10-07',
      snapshot: { date: '2026-10-07', sessionId: started.id, items: [
        { item: 'トマト', qty: 3, unit: '個', unitPrice: null, subtotal: null },
        { item: 'なす', qty: 2, unit: '本', unitPrice: null, subtotal: null },
      ], totalValue: null },
    }
    const res = await call(`/store/${code}/sessions/${started.id}/complete`, 'POST', body, lead)
    expect(res.status).toBe(200)
    expect((await res.json()).totalValue).toBeNull()   // 本人には金額を返さない
    expect(sqlite.prepare('SELECT total_value FROM sessions WHERE id = ?').get(started.id).total_value).toBe(460)

    const mine = await json(await call(`/store/${code}/sessions/${started.id}/lines`, 'GET', null, lead))
    expect(mine.totalValue).toBeNull()
    expect(mine.lines.every(l => l.unitPrice === null && l.subtotal === null)).toBe(true)
    const full = await json(await call(`/store/${code}/sessions/${started.id}/lines`, 'GET', null, owner))
    expect(full.totalValue).toBe(460)
    expect(full.lines.map(l => [l.item, l.unitPrice, l.subtotal])).toEqual([['トマト', 100, 300], ['なす', 80, 160]])
  })
})

describe('旧経路 /store/create', () => {
  it('廃止した（PIN の無い店舗を認証なしで作れない）', async () => {
    const res = await call('/store/create', 'POST', {})
    expect(res.status).toBe(404)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM stores').get().n).toBe(1)
  })
})
