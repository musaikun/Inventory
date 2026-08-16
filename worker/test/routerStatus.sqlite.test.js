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
