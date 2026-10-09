/**
 * 恒久ロック済みの履歴は API からも書き換えさせない。
 *
 * 画面ではロック済みの訂正を止めていたが、POST /store/:code/history は丸ごと upsert だったため、
 * トークンがあれば確定した棚卸の数量・在庫金額を書き換えられた。
 * 全migrationを当てた実SQLiteへ worker.fetch を通し、判定と upsert の条件の両方を確かめる。
 */
import { describe, it, expect } from 'vitest'
import { createD1 } from './d1Harness.js'
import worker from '../src/index.js'
import { historySnapshotStatement } from '../src/storeHandler.js'

const CODE = 'SHOPAA'
const SID  = '11111111-1111-4111-8111-111111111111'

function setup() {
  const h = createD1()
  h.seedStore(CODE)
  const token = h.seedToken(CODE)
  return { h, token, env: { DB: h.db, ALLOWED_ORIGIN: 'https://inventory-app.pages.dev' } }
}
const post = (token, body) => new Request(`https://worker.example/store/${CODE}/history`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
const snap = (over = {}) => ({
  date: '2026-10-01', sessionId: SID,
  items: [{ item: 'トマト', qty: 3, unit: '個', unitPrice: 100, subtotal: 300 }],
  totalValue: 300,
  ...over,
})
const row = h => h.rows('SELECT snapshot_json, revision FROM store_history WHERE session_id = ?', SID)[0]

describe('ロック済みの履歴', () => {
  it('ロックの前は訂正でき、ロック（中身は同じ）も通る', async () => {
    const { h, token, env } = setup()
    expect((await worker.fetch(post(token, snap()), env)).status).toBe(200)
    expect((await worker.fetch(post(token, snap({ items: [{ item: 'トマト', qty: 4, unit: '個' }] })), env)).status).toBe(200)
    expect((await worker.fetch(post(token, snap({ items: [{ item: 'トマト', qty: 4, unit: '個' }], locked: true })), env)).status).toBe(200)
    expect(JSON.parse(row(h).snapshot_json).locked).toBe(true)
  })

  it('ロック後に数量を変える保存は 409 snapshot_locked で、記録は変わらない', async () => {
    const { h, token, env } = setup()
    await worker.fetch(post(token, snap({ locked: true })), env)
    const before = row(h)
    const res = await worker.fetch(post(token, snap({ items: [{ item: 'トマト', qty: 99, unit: '個' }], totalValue: 9900, locked: true })), env)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('snapshot_locked')
    expect(row(h)).toEqual(before)
  })

  it('ロックを外して書き換えることもできない', async () => {
    const { h, token, env } = setup()
    await worker.fetch(post(token, snap({ locked: true })), env)
    const res = await worker.fetch(post(token, snap({ items: [{ item: 'トマト', qty: 1, unit: '個' }], locked: false })), env)
    expect(res.status).toBe(409)
    expect(JSON.parse(row(h).snapshot_json).locked).toBe(true)
  })

  it('同じ中身の送り直しは 200 で、書かずに今の版を返す（参加者などを差し替えない）', async () => {
    const { h, token, env } = setup()
    await worker.fetch(post(token, snap({ locked: true, participants: [{ name: '厨房' }] })), env)
    const before = row(h)
    const res = await worker.fetch(post(token, snap({ locked: true, participants: [{ name: 'なりすまし' }], totalValue: 1 })), env)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.unchanged).toBe(true)
    expect(body.serverRevision).toBe(before.revision)
    expect(row(h)).toEqual(before)
  })

  it('確認をすり抜けても、upsert はロック済みの行を上書きしない', async () => {
    const { h, token, env } = setup()
    await worker.fetch(post(token, snap({ locked: true })), env)
    const before = row(h)
    await historySnapshotStatement(h.db, CODE, snap({ items: [{ item: 'トマト', qty: 50, unit: '個' }] }), new Date().toISOString()).run()
    expect(row(h).snapshot_json).toBe(before.snapshot_json)
  })

  it('日付だけの古い行（sessionId 無し）も同じ', async () => {
    const { h, token, env } = setup()
    const legacy = { date: '2026-09-01', items: [{ item: 'なす', qty: 2, unit: '本' }], locked: true }
    expect((await worker.fetch(post(token, legacy), env)).status).toBe(200)
    const res = await worker.fetch(post(token, { ...legacy, items: [{ item: 'なす', qty: 7, unit: '本' }] }), env)
    expect(res.status).toBe(409)
    const r = h.rows("SELECT snapshot_json FROM store_history WHERE snapshot_date = '2026-09-01' AND session_id IS NULL")[0]
    expect(JSON.parse(r.snapshot_json).items[0].qty).toBe(2)
  })
})
