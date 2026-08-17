/**
 * router 層の HTTP ステータス伝播（DATA-002 第1修正セッション §4）。
 *
 * handler は `{ _status }` で失敗を表す。router がそれを `jsonResponse(..., 200)` で
 * 包み直すと、client は「保存できた」として扱う。`POST /store/:code/sessions` が
 * その状態だったため、不正な種別の作成失敗が HTTP 200 で届いていた。
 *
 * 手製のSQL文字列モックではなく、全migrationを当てた実SQLite（d1Harness）へ
 * worker.fetch をそのまま通す。ルーティング・認証・handler・レスポンスまで一気通貫で見る。
 */
import { describe, it, expect } from 'vitest'
import { createD1 } from './d1Harness.js'
import worker from '../src/index.js'

const CODE = 'SHOPAA'

function setup() {
  const h = createD1()
  h.seedStore(CODE)
  const token = h.seedToken(CODE)
  return { h, token, env: { DB: h.db, ALLOWED_ORIGIN: 'https://inventory-app.pages.dev' } }
}

function post(path, token, body) {
  return new Request(`https://worker.example${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const sessionRows = h => h.rows('SELECT * FROM sessions WHERE shop_code = ?', CODE)

describe('POST /store/:code/sessions のステータス伝播', () => {
  it('不正な種別は HTTP 400 / code=invalid_type で、DB 行を作らない', async () => {
    const { h, token, env } = setup()
    const res  = await worker.fetch(post(`/store/${CODE}/sessions`, token, { type: 'nope' }), env)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('invalid_type')
    expect(body._status).toBeUndefined()
    expect(sessionRows(h)).toHaveLength(0)
  })

  it('正常な種別は HTTP 200 で作成される', async () => {
    const { h, token, env } = setup()
    const res  = await worker.fetch(post(`/store/${CODE}/sessions`, token, { type: 'order' }), env)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.type).toBe('order')
    expect(body.status).toBe('active')
    expect(body._status).toBeUndefined()
    expect(sessionRows(h)).toHaveLength(1)
    expect(sessionRows(h)[0].type).toBe('order')
  })

  it('種別を省略した場合の既定（stock）は維持する', async () => {
    const { h, token, env } = setup()
    const res  = await worker.fetch(post(`/store/${CODE}/sessions`, token, {}), env)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.type).toBe('stock')
    expect(sessionRows(h)[0].type).toBe('stock')
  })

  it('未認証は 401（DB 行を作らない）', async () => {
    const { h, env } = setup()
    const res = await worker.fetch(post(`/store/${CODE}/sessions`, 'bad-token', { type: 'stock' }), env)
    expect(res.status).toBe(401)
    expect(sessionRows(h)).toHaveLength(0)
  })
})

describe('完了APIのステータス伝播', () => {
  it('snapshot 無しの stock 完了は HTTP 400 で届く', async () => {
    const { h, token, env } = setup()
    const sid = '11111111-1111-4111-8111-111111111111'
    h.seedSession(CODE, sid)

    const res  = await worker.fetch(post(`/store/${CODE}/sessions/${sid}/complete`, token, {
      inventory: { 品目0: { qty: 1, unit: '個' } }, prices: {},
    }), env)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('snapshot_required')
    expect(body._status).toBeUndefined()
    expect(h.rows('SELECT status FROM sessions WHERE id = ?', sid)[0].status).toBe('active')
  })
})

// ── 再レビュー: 新しい 409 / 400 が HTTP でも正しく返る ──────────────────────
// handler が `{ _status }` で返す失敗は、router が resultResponse を通さないと
// HTTP 200 で届く。追加した契約ぶんも HTTP レベルで固定し、本文へ `_status` が
// 漏れていないことを毎回確認する。
describe('完了契約の新しいステータスがHTTPで返る', () => {
  const SID = '11111111-1111-4111-8111-111111111111'

  const stockBody = (over = {}) => ({
    inventory: { 品目0: { qty: 1, unit: '個' } },
    prices: {},
    takenAt: '2026-08-09',
    snapshot: { sessionId: SID, items: [{ item: '品目0', qty: 1, unit: '個' }] },
    ...over,
  })

  function put(path, token, body) {
    return new Request(`https://worker.example${path}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('active への PUT completed は HTTP 409 / use_complete_endpoint', async () => {
    const { h, token, env } = setup()
    h.seedSession(CODE, SID)

    const res  = await worker.fetch(put(`/store/${CODE}/sessions/${SID}`, token, { status: 'completed', itemCount: 1 }), env)
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe('use_complete_endpoint')
    expect(body._status).toBeUndefined()
    expect(h.rows('SELECT status FROM sessions WHERE id = ?', SID)[0].status).toBe('active')
    expect(h.rows('SELECT * FROM store_history WHERE shop_code = ?', CODE)).toHaveLength(0)
  })

  it('completed → active は HTTP 409 / session_completed', async () => {
    const { h, token, env } = setup()
    h.seedSession(CODE, SID)
    await worker.fetch(post(`/store/${CODE}/sessions/${SID}/complete`, token, stockBody()), env)

    const res  = await worker.fetch(put(`/store/${CODE}/sessions/${SID}`, token, { status: 'active', itemCount: 0 }), env)
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe('session_completed')
    expect(body._status).toBeUndefined()
    expect(h.rows('SELECT status FROM sessions WHERE id = ?', SID)[0].status).toBe('completed')
  })

  it('takenAt と snapshot.date の不一致は HTTP 400 / snapshot_date_mismatch', async () => {
    const { h, token, env } = setup()
    h.seedSession(CODE, SID)

    const res = await worker.fetch(post(`/store/${CODE}/sessions/${SID}/complete`, token, stockBody({
      snapshot: { sessionId: SID, date: '2026-08-10', items: [{ item: '品目0', qty: 1, unit: '個' }] },
    })), env)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('snapshot_date_mismatch')
    expect(body._status).toBeUndefined()
    expect(h.rows('SELECT * FROM inventory_lines WHERE shop_code = ?', CODE)).toHaveLength(0)
  })

  it('別内容の完了再送は HTTP 409 / completion_intent_conflict', async () => {
    const { h, token, env } = setup()
    h.seedSession(CODE, SID)
    const first = await worker.fetch(post(`/store/${CODE}/sessions/${SID}/complete`, token, stockBody()), env)
    expect(first.status).toBe(200)

    const res = await worker.fetch(post(`/store/${CODE}/sessions/${SID}/complete`, token, stockBody({
      inventory: { 品目0: { qty: 99, unit: '個' } },
      snapshot: { sessionId: SID, items: [{ item: '品目0', qty: 99, unit: '個' }] },
    })), env)
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe('completion_intent_conflict')
    expect(body._status).toBeUndefined()
    expect(h.rows('SELECT qty FROM inventory_lines WHERE shop_code = ?', CODE)[0].qty).toBe(1)
  })

  it('同一内容の完了再送は HTTP 200（replay）', async () => {
    const { h, token, env } = setup()
    h.seedSession(CODE, SID)
    const first = await worker.fetch(post(`/store/${CODE}/sessions/${SID}/complete`, token, stockBody()), env)
    const res   = await worker.fetch(post(`/store/${CODE}/sessions/${SID}/complete`, token, stockBody()), env)
    const body  = await res.json()

    expect(first.status).toBe(200)
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.replay).toBe(true)
    expect(body._status).toBeUndefined()
    expect(h.rows('SELECT * FROM store_history WHERE shop_code = ?', CODE)).toHaveLength(1)
  })
})

describe('過去棚卸取込の新しいステータスがHTTPで返る', () => {
  const BATCH = 'imp_router1'
  const DATE  = '2026-07-01'
  const items = n => Array.from({ length: n }, (_, i) => ({ item: `品目${i}`, qty: i + 1, unit: '個' }))

  it('台帳を持たない legacy batch への再取込は HTTP 409 / legacy_import_unverified', async () => {
    const { h, token, env } = setup()
    const first = await worker.fetch(post(`/store/${CODE}/imports/${BATCH}/sessions`, token,
      { date: DATE, items: items(3) }), env)
    expect(first.status).toBe(200)
    h.sqlite.prepare('DELETE FROM import_batch_requests').run()

    const res  = await worker.fetch(post(`/store/${CODE}/imports/${BATCH}/sessions`, token,
      { date: DATE, items: items(2) }), env)
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe('legacy_import_unverified')
    expect(body._status).toBeUndefined()
    expect(h.rows('SELECT * FROM inventory_lines WHERE shop_code = ?', CODE)).toHaveLength(3)
  })

  it('同じ batchId・同じ日付で内容が違えば HTTP 409 / import_intent_conflict', async () => {
    const { h, token, env } = setup()
    await worker.fetch(post(`/store/${CODE}/imports/${BATCH}/sessions`, token, { date: DATE, items: items(3) }), env)

    const res  = await worker.fetch(post(`/store/${CODE}/imports/${BATCH}/sessions`, token,
      { date: DATE, items: items(2) }), env)
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe('import_intent_conflict')
    expect(body._status).toBeUndefined()
    expect(h.rows('SELECT * FROM inventory_lines WHERE shop_code = ?', CODE)).toHaveLength(3)
  })
})
