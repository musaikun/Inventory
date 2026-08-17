import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('./pdfParser.js', () => ({ parsePdfFile: async () => ({}) }))

import worker from './index.js'

// ── ルーティング検証用の統合 D1 モック ──────────────────────────────────────────
function createMockD1({ failTables = [] } = {}) {
  const stores  = []
  const tokens  = []
  const configs = {}
  const ipRows  = []
  const orders  = []
  const orderLines = []
  const pushSubscriptions = []
  const sessions = []
  const inventoryLines = []
  const movements = []
  const movementLines = []
  const history = []

  function exec(sql, args) {
    const s = sql.replace(/\s+/g, ' ').trim()

    for (const t of failTables) {
      if (s.includes(t)) throw new Error(`no such table: ${t}`)
    }

    if (s.startsWith('SELECT') && s.includes('FROM auth_tokens')) {
      const t = tokens.find(t => t.token === args[0])
      if (!t || new Date(t.expires_at).getTime() <= Date.now()) return null
      return { shop_code: t.shop_code }
    }
    if (s.startsWith('SELECT pin_hash, deleted_at, deletion_pending_at FROM stores')) {
      const r = stores.find(r => r.shop_code === args[0])
      return r ? {
        pin_hash: r.pin_hash ?? null,
        deleted_at: r.deleted_at ?? null,
        deletion_pending_at: r.deletion_pending_at ?? null,
      } : null
    }
    if (s.startsWith('SELECT deleted_at, deletion_pending_at FROM stores')) {
      const r = stores.find(r => r.shop_code === args[0])
      return r ? {
        deleted_at: r.deleted_at ?? null,
        deletion_pending_at: r.deletion_pending_at ?? null,
      } : null
    }
    if (s.startsWith('SELECT shop_code, store_name, pin_hash, plan, created_at, deleted_at, deletion_pending_at FROM stores')) {
      const r = stores.find(r => r.shop_code === args[0])
      return r ? {
        shop_code: r.shop_code,
        store_name: r.store_name ?? null,
        pin_hash: r.pin_hash ?? null,
        plan: r.plan ?? 'free',
        created_at: r.created_at ?? '',
        deleted_at: r.deleted_at ?? null,
        deletion_pending_at: r.deletion_pending_at ?? null,
      } : null
    }
    if (s.startsWith('SELECT shop_code, active_room, created_at, plan FROM stores')) {
      const r = stores.find(r => r.shop_code === args[0])
      return r ? { shop_code: r.shop_code, active_room: null, created_at: r.created_at ?? '', plan: r.plan ?? 'free' } : null
    }
    if (s.startsWith('SELECT shop_code FROM stores')) {
      const r = stores.find(r => r.shop_code === args[0]) ?? null
      if (r && s.includes('deleted_at IS NULL') && (r.deleted_at || r.deletion_pending_at)) return null
      return r
    }
    if (s.startsWith('INSERT INTO stores')) {
      stores.push(args.length >= 5
        ? { shop_code: args[0], store_name: args[1], pin_hash: args[2], plan: args[3] }
        : { shop_code: args[0] })
      return { success: true }
    }
    if (s.startsWith('INSERT INTO auth_tokens')) {
      tokens.push({ token: args[0], shop_code: args[1], expires_at: args[2] })
      return { success: true }
    }
    if (s.startsWith('DELETE FROM auth_tokens WHERE shop_code')) {
      for (let i = tokens.length - 1; i >= 0; i--) {
        if (tokens[i].shop_code === args[0]) tokens.splice(i, 1)
      }
      return { success: true }
    }
    if (s.startsWith('DELETE FROM auth_tokens WHERE token')) {
      const i = tokens.findIndex(t => t.token === args[0])
      if (i >= 0) tokens.splice(i, 1)
      return { success: true }
    }
    if (s.startsWith('SELECT COUNT(*) AS n FROM login_attempts')) return { n: 0 }
    if (s.startsWith('INSERT INTO login_attempts'))               return { success: true }
    if (s.startsWith('DELETE FROM login_attempts'))               return { success: true }
    if (s.startsWith('SELECT COUNT(*) AS n FROM ip_attempts')) {
      const [ip, kind, since] = args
      return { n: ipRows.filter(r => r.ip === ip && r.kind === kind && r.attempted_at > since).length }
    }
    if (s.startsWith('INSERT INTO ip_attempts')) {
      ipRows.push({ ip: args[0], kind: args[1], attempted_at: args[2] })
      return { success: true }
    }
    if (s.startsWith('DELETE FROM ip_attempts')) return { success: true }
    if (s.startsWith('SELECT shop_code FROM push_subscriptions WHERE endpoint')) {
      const row = pushSubscriptions.find(item => item.endpoint === args[0])
      return row ? { shop_code: row.shop_code } : null
    }
    if (s.startsWith('INSERT INTO push_subscriptions')) {
      const [shopCode, endpoint, p256dh, auth] = args
      const existing = pushSubscriptions.find(item => item.endpoint === endpoint)
      if (existing) {
        if (s.includes('push_subscriptions.shop_code = excluded.shop_code') && existing.shop_code !== shopCode) {
          return { success: true, meta: { changes: 0 } }
        }
        existing.shop_code = shopCode
        existing.p256dh = p256dh
        existing.auth = auth
      } else {
        pushSubscriptions.push({ shop_code: shopCode, endpoint, p256dh, auth })
      }
      return { success: true, meta: { changes: 1 } }
    }
    if (s.startsWith('DELETE FROM push_subscriptions WHERE shop_code')) {
      const [shopCode, endpoint] = args
      const index = pushSubscriptions.findIndex(item => item.shop_code === shopCode && item.endpoint === endpoint)
      if (index >= 0) pushSubscriptions.splice(index, 1)
      return { success: true, meta: { changes: index >= 0 ? 1 : 0 } }
    }
    if (s.startsWith('INSERT INTO store_configs')) {
      configs[args[0]] = args[1]
      return { success: true }
    }
    if (s.startsWith('SELECT shop_code FROM orders WHERE id')) {
      const order = orders.find(o => o.id === args[0])
      return order ? { shop_code: order.shop_code } : null
    }
    if (s.startsWith('DELETE FROM order_lines WHERE order_id')) {
      const [id, shop] = args
      for (let i = orderLines.length - 1; i >= 0; i--) {
        if (orderLines[i].order_id === id && orderLines[i].shop_code === shop) orderLines.splice(i, 1)
      }
      return { success: true }
    }
    if (s.startsWith('DELETE FROM orders WHERE id')) {
      const [id, shop] = args
      const i = orders.findIndex(o => o.id === id && o.shop_code === shop)
      if (i >= 0) orders.splice(i, 1)
      return { success: true }
    }
    if (s.startsWith('SELECT shop_code FROM movements WHERE id')) {
      const m = movements.find(x => x.id === args[0])
      return m ? { shop_code: m.shop_code } : null
    }
    if (s.startsWith('DELETE FROM movement_lines WHERE movement_id')) {
      const [id, shop] = args
      for (let i = movementLines.length - 1; i >= 0; i--) {
        if (movementLines[i].movement_id === id && movementLines[i].shop_code === shop) movementLines.splice(i, 1)
      }
      return { success: true, meta: { changes: 1 } }
    }
    if (s.startsWith('DELETE FROM movements WHERE id')) {
      const [id, shop] = args
      const i = movements.findIndex(x => x.id === id && x.shop_code === shop)
      if (i >= 0) movements.splice(i, 1)
      return { success: true, meta: { changes: i >= 0 ? 1 : 0 } }
    }
    if (s.startsWith('DELETE FROM store_history')) {
      const before = history.length
      const [shop, key] = args
      for (let i = history.length - 1; i >= 0; i--) {
        const row = history[i]
        const hit = s.includes('session_id = ?')
          ? row.shop_code === shop && row.session_id === key
          : row.shop_code === shop && row.snapshot_date === key && row.session_id == null
        if (hit) history.splice(i, 1)
      }
      return { success: true, meta: { changes: before - history.length } }
    }
    // 取込台帳（migration 0015）と完了claim（migration 0016）。
    // このモックはルーティングとHTTPステータスの検証用なので、行は持たず件数0で応答する。
    // 実データを伴う挙動は test/ledgerLifecycle.sqlite.test.js（実SQLite）で固定している。
    if (s.startsWith('DELETE FROM import_batch_requests') || s.startsWith('DELETE FROM session_completions')) {
      return { success: true, meta: { changes: 0 } }
    }
    if (s.startsWith('SELECT id, shop_code, started_at')) return []
    // GET /store/:code/sessions/:id/lines（DATA-002 Phase 1）
    // shop_code を WHERE に含まないSQLでは絞り込まない＝店舗境界の抜けをテストで検出する
    if (s.startsWith('SELECT id, started_at, ended_at, status, item_count, total_value, type FROM sessions')) {
      const [id, shop] = args
      return sessions.find(x =>
        x.id === id && (s.includes('shop_code = ?') ? x.shop_code === shop : true)
      ) ?? null
    }
    if (s.includes('FROM inventory_lines')) {
      const [sessionId, shop] = args
      return inventoryLines.filter(l =>
        l.session_id === sessionId && (s.includes('shop_code = ?') ? l.shop_code === shop : true)
      )
    }
    throw new Error('Unhandled SQL in mock: ' + s)
  }

  function prepare(sql) {
    let bound = []
    const stmt = {
      bind(...a) { bound = a; return stmt },
      async first() { return exec(sql, bound) },
      async run()   { return exec(sql, bound) },
      async all()   { return { results: exec(sql, bound) ?? [] } },
    }
    return stmt
  }

  // D1 の batch は1トランザクション。failAt で「巻き戻って 503 になる」経路を作る。
  let failAt = null
  async function batch(stmts) {
    const out = []
    for (let i = 0; i < stmts.length; i++) {
      if (failAt === i) { failAt = null; throw new Error('D1_ERROR: injected failure') }
      out.push(await stmts[i].run())
    }
    return out
  }

  return {
    prepare,
    batch,
    _failBatchAt(i) { failAt = i },
    _movements: movements,
    _movementLines: movementLines,
    _history: history,
    _stores: stores,
    _configs: configs,
    _ipRows: ipRows,
    _orders: orders,
    _orderLines: orderLines,
    _sessions: sessions,
    _inventoryLines: inventoryLines,
    _pushSubscriptions: pushSubscriptions,
    _failTables: failTables,
  }
}

function makeReq(method, path, { body, token, ip } = {}) {
  return {
    method,
    url: `https://api.test${path}`,
    headers: {
      get: (h) => {
        if (h === 'Authorization' && token) return `Bearer ${token}`
        if (h === 'CF-Connecting-IP')       return ip ?? '198.51.100.1'
        return null
      },
    },
    json: async () => body ?? {},
  }
}

function base64Url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function validPushSubscription(endpoint = 'https://push.example.com/subscription/abc') {
  const publicKey = new Uint8Array(65).fill(1)
  publicKey[0] = 0x04
  return {
    endpoint,
    keys: {
      p256dh: base64Url(publicKey),
      auth: base64Url(new Uint8Array(16).fill(2)),
    },
  }
}

function makeHttpReq(method, path, { body, rawBody, token } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return new Request(`https://api.test${path}`, {
    method,
    headers,
    body: rawBody ?? JSON.stringify(body ?? {}),
  })
}

describe('Worker ルーティング（特性テスト）', () => {
  let db, env

  beforeEach(() => {
    db  = createMockD1()
    env = { DB: db, ROOMS: { idFromName: () => 'x', get: () => null }, ALLOWED_ORIGIN: '' }
  })

  it('GET /health は 200 OK を返す', async () => {
    const res = await worker.fetch(makeReq('GET', '/health'), env)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('OK')
  })

  it('未知のパスは 404 を返す', async () => {
    const res = await worker.fetch(makeReq('GET', '/no/such/route'), env)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBeTruthy()
  })

  it('POST /auth/register で店舗コードとトークンを発行する', async () => {
    const res  = await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.shopCode).toMatch(/^[A-Z]{6}$/)
    expect(body.token).toBeTruthy()
  })

  it('Pro Review envの登録店舗はplan=proになる', async () => {
    env.DEFAULT_STORE_PLAN = 'pro'
    const res = await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.plan).toBe('pro')
    expect(body.isPro).toBe(true)
  })

  it('DELETE /auth/account をaccount deletion handlerへ接続する', async () => {
    const res = await worker.fetch(makeReq('DELETE', '/auth/account', {
      body: { requestId: 'invalid', pin: '1234', confirmation: 'ABCDEF' },
    }), env)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('invalid_request')
  })

  it('GET /store/:code は存在しない店舗で 404', async () => {
    const res = await worker.fetch(makeReq('GET', '/store/ZZZZZZ'), env)
    expect(res.status).toBe(404)
  })

  it('GET /store/:code は存在する店舗の情報を返す', async () => {
    const reg  = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)).json()
    const res  = await worker.fetch(makeReq('GET', `/store/${reg.shopCode}`), env)
    expect(res.status).toBe(200)
    expect((await res.json()).shopCode).toBe(reg.shopCode)
  })

  it('削除pending店舗はPush購読と公開resultを遮断する', async () => {
    const reg = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)).json()
    const store = db._stores.find(row => row.shop_code === reg.shopCode)
    store.deletion_pending_at = new Date().toISOString()

    const push = await worker.fetch(makeReq('POST', `/store/${reg.shopCode}/push/subscribe`, {
      body: { endpoint: 'https://push.example/sub', keys: {} },
    }), env)
    const result = await worker.fetch(makeReq('GET', `/room/${reg.shopCode}/result?s=session-1`), env)

    // Push APIはstrict authのため、pendingでtokenが無効化された時点で401。
    expect(push.status).toBe(401)
    expect(result.status).toBe(404)
    expect(db._ipRows.filter(row => row.kind === 'probe')).toHaveLength(1)
  })

  it('Push購読作成は認証なしでは拒否する', async () => {
    const reg = await (await worker.fetch(makeReq('POST', '/auth/register', {
      body: { pin: '1234' },
    }), env)).json()
    const res = await worker.fetch(makeHttpReq(
      'POST',
      `/store/${reg.shopCode}/push/subscribe`,
      { body: validPushSubscription() },
    ), env)

    expect(res.status).toBe(401)
    expect(db._pushSubscriptions).toHaveLength(0)
  })

  it('Push購読は無効URLと8KiB超payloadを拒否する', async () => {
    const reg = await (await worker.fetch(makeReq('POST', '/auth/register', {
      body: { pin: '1234' },
    }), env)).json()
    const invalid = validPushSubscription('http://localhost/push')
    const invalidRes = await worker.fetch(makeHttpReq(
      'POST',
      `/store/${reg.shopCode}/push/subscribe`,
      { body: invalid, token: reg.token },
    ), env)
    const oversizedRes = await worker.fetch(makeHttpReq(
      'POST',
      `/store/${reg.shopCode}/push/subscribe`,
      { rawBody: JSON.stringify({ ...validPushSubscription(), padding: 'x'.repeat(9000) }), token: reg.token },
    ), env)

    expect(invalidRes.status).toBe(400)
    expect(oversizedRes.status).toBe(413)
    expect(db._pushSubscriptions).toHaveLength(0)
  })

  it('Push endpointは所有店舗だけが更新・削除できる', async () => {
    const first = await (await worker.fetch(makeReq('POST', '/auth/register', {
      body: { pin: '1234' },
    }), env)).json()
    const second = await (await worker.fetch(makeReq('POST', '/auth/register', {
      body: { pin: '5678' },
    }), env)).json()
    const subscription = validPushSubscription()

    const created = await worker.fetch(makeHttpReq(
      'POST',
      `/store/${first.shopCode}/push/subscribe`,
      { body: subscription, token: first.token },
    ), env)
    const conflict = await worker.fetch(makeHttpReq(
      'POST',
      `/store/${second.shopCode}/push/subscribe`,
      { body: subscription, token: second.token },
    ), env)
    const foreignDelete = await worker.fetch(makeHttpReq(
      'DELETE',
      `/store/${second.shopCode}/push/subscribe`,
      { body: { endpoint: subscription.endpoint }, token: second.token },
    ), env)

    expect(created.status).toBe(200)
    expect(conflict.status).toBe(409)
    expect(foreignDelete.status).toBe(200)
    expect(db._pushSubscriptions).toHaveLength(1)
    expect(db._pushSubscriptions[0].shop_code).toBe(first.shopCode)

    const ownerDelete = await worker.fetch(makeHttpReq(
      'DELETE',
      `/store/${first.shopCode}/push/subscribe`,
      { body: { endpoint: subscription.endpoint }, token: first.token },
    ), env)
    expect(ownerDelete.status).toBe(200)
    expect(db._pushSubscriptions).toHaveLength(0)
  })

  it('PIN設定店舗の config PUT はトークン無しだと 401', async () => {
    const reg = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)).json()
    const res = await worker.fetch(makeReq('PUT', `/store/${reg.shopCode}/config`, { body: { items: [] } }), env)
    expect(res.status).toBe(401)
  })

  it('PIN設定店舗の config PUT はトークン付きなら 200', async () => {
    const reg = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)).json()
    const res = await worker.fetch(makeReq('PUT', `/store/${reg.shopCode}/config`, { body: { items: [] }, token: reg.token }), env)
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('レガシー店舗（PIN未設定）の config PUT はトークン無しでも 200', async () => {
    const created = await (await worker.fetch(makeReq('POST', '/store/create'), env)).json()
    const res = await worker.fetch(makeReq('PUT', `/store/${created.shopCode}/config`, { body: { items: [] } }), env)
    expect(res.status).toBe(200)
  })

  it('巨大な config PUT は 413', async () => {
    const reg = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)).json()
    const res = await worker.fetch(makeReq('PUT', `/store/${reg.shopCode}/config`, {
      body: { blob: 'x'.repeat(1_100_000) }, token: reg.token,
    }), env)
    expect(res.status).toBe(413)
  })

  it('GET /store/:code/sessions はトークン無しだと 401', async () => {
    const reg = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)).json()
    const res = await worker.fetch(makeReq('GET', `/store/${reg.shopCode}/sessions`), env)
    expect(res.status).toBe(401)
  })

  it('GET /store/:code/sessions はトークン付きなら 200 で配列を返す', async () => {
    const reg = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)).json()
    const res = await worker.fetch(makeReq('GET', `/store/${reg.shopCode}/sessions`, { token: reg.token }), env)
    expect(res.status).toBe(200)
    expect(Array.isArray(await res.json())).toBe(true)
  })

  it('他店舗のトークンでは sessions にアクセスできない', async () => {
    const a = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)).json()
    const b = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '5678' } }), env)).json()
    const res = await worker.fetch(makeReq('GET', `/store/${a.shopCode}/sessions`, { token: b.token }), env)
    expect(res.status).toBe(401)
  })

  // IMPORT-001: 過去棚卸の取込・取消。単価と在庫を書き換えるので strict auth の側に置く。
  describe('過去棚卸の取込 API', () => {
    const BATCH = 'imp_abc123'
    const body  = { date: '2026-07-01', items: [{ item: 'A', qty: 1 }] }

    it('POST /imports/:batchId/sessions はトークン無しだと 401', async () => {
      const reg = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)).json()
      const res = await worker.fetch(makeReq('POST', `/store/${reg.shopCode}/imports/${BATCH}/sessions`, { body }), env)
      expect(res.status).toBe(401)
    })

    it('POST /imports/:batchId/sessions は他店舗のトークンでは 401', async () => {
      const a = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)).json()
      const b = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '5678' } }), env)).json()
      const res = await worker.fetch(makeReq('POST', `/store/${a.shopCode}/imports/${BATCH}/sessions`, { body, token: b.token }), env)
      expect(res.status).toBe(401)
    })

    it('DELETE /imports/:batchId はトークン無しだと 401', async () => {
      const reg = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)).json()
      const res = await worker.fetch(makeReq('DELETE', `/store/${reg.shopCode}/imports/${BATCH}`), env)
      expect(res.status).toBe(401)
    })

    it('DELETE /imports/:batchId は他店舗のトークンでは 401', async () => {
      const a = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)).json()
      const b = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '5678' } }), env)).json()
      const res = await worker.fetch(makeReq('DELETE', `/store/${a.shopCode}/imports/${BATCH}`, { token: b.token }), env)
      expect(res.status).toBe(401)
    })

    it('取込IDが64文字を超える経路は route に一致しない（404）', async () => {
      const reg = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)).json()
      const res = await worker.fetch(makeReq('DELETE', `/store/${reg.shopCode}/imports/${'a'.repeat(65)}`, { token: reg.token }), env)
      expect(res.status).toBe(404)
    })
  })

  // DATA-002 Phase 1: 端末に snapshot が無くても詳細を開けるようにする経路。
  // 単価・在庫金額を返すため、認可の穴は「他店舗の在庫金額が読める」に直結する。
  describe('GET /store/:code/sessions/:id/lines', () => {
    const SID = '11111111-1111-4111-8111-111111111111'

    it('トークン無しは 401', async () => {
      const reg = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)).json()
      const res = await worker.fetch(makeReq('GET', `/store/${reg.shopCode}/sessions/${SID}/lines`), env)
      expect(res.status).toBe(401)
    })

    it('他店舗のトークンでは読めない（401）', async () => {
      const a = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)).json()
      const b = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '5678' } }), env)).json()
      const res = await worker.fetch(makeReq('GET', `/store/${a.shopCode}/sessions/${SID}/lines`, { token: b.token }), env)
      expect(res.status).toBe(401)
    })

    it('自店舗のトークンでも、他店舗のセッションIDなら 404 で明細を返さない', async () => {
      const a = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)).json()
      const b = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '5678' } }), env)).json()
      db._sessions.push({ id: SID, shop_code: a.shopCode, started_at: '2026-07-07T01:00:00Z', status: 'completed' })
      db._inventoryLines.push({
        session_id: SID, shop_code: a.shopCode, taken_at: '2026-07-07',
        item_name: '鶏もも', category: null, qty: 3, unit: 'kg', unit_price: 500, line_value: 1500,
      })

      const res = await worker.fetch(makeReq('GET', `/store/${b.shopCode}/sessions/${SID}/lines`, { token: b.token }), env)
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.lines).toBeUndefined()
    })

    it('自店舗のセッションなら 200 で明細を返す', async () => {
      const a = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)).json()
      db._sessions.push({
        id: SID, shop_code: a.shopCode, started_at: '2026-07-07T01:00:00Z',
        ended_at: '2026-07-07T02:00:00Z', status: 'completed', item_count: 1, total_value: 1500, type: 'stock',
      })
      db._inventoryLines.push({
        session_id: SID, shop_code: a.shopCode, taken_at: '2026-07-07',
        item_name: '鶏もも', category: null, qty: 3, unit: 'kg', unit_price: 500, line_value: 1500,
      })

      const res = await worker.fetch(makeReq('GET', `/store/${a.shopCode}/sessions/${SID}/lines`, { token: a.token }), env)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.date).toBe('2026-07-07')
      expect(body.lines).toEqual([
        { item: '鶏もも', qty: 3, unit: 'kg', unitPrice: 500, subtotal: 1500, category: null },
      ])
    })
  })

  it('SEC-002: 他店舗のorder DELETEは404をHTTPへ伝播し、元データを残す', async () => {
    const a = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)).json()
    const b = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '5678' } }), env)).json()
    db._orders.push({ id: 'shared-order', shop_code: a.shopCode })
    db._orderLines.push({ order_id: 'shared-order', shop_code: a.shopCode })

    const res = await worker.fetch(makeReq('DELETE', `/store/${b.shopCode}/orders/shared-order`, { token: b.token }), env)

    expect(res.status).toBe(404)
    expect((await res.json()).error).toBeTruthy()
    expect(db._orders).toHaveLength(1)
    expect(db._orderLines).toHaveLength(1)
  })

  // 削除系のHTTPステータス契約（第2セッション §3）。
  // movement DELETE と history DELETE は 200 固定で返しており、
  // 「消せていない」ことが client 側で判定できなかった。
  describe('削除APIのHTTPステータス契約', () => {
    async function reg(pin = '1234') {
      return (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin } }), env)).json()
    }

    it('存在しない入出庫の DELETE は 404 を HTTP へ伝播する', async () => {
      const a = await reg()
      const res = await worker.fetch(makeReq('DELETE', `/store/${a.shopCode}/movements/none`, { token: a.token }), env)
      expect(res.status).toBe(404)
      expect((await res.json()).code).toBe('movement_not_found')
    })

    it('他店舗の入出庫 DELETE も 404 で、元データを消さない', async () => {
      const a = await reg('1234')
      const b = await reg('5678')
      db._movements.push({ id: 'shared-move', shop_code: a.shopCode })
      db._movementLines.push({ movement_id: 'shared-move', shop_code: a.shopCode })

      const res = await worker.fetch(makeReq('DELETE', `/store/${b.shopCode}/movements/shared-move`, { token: b.token }), env)
      expect(res.status).toBe(404)
      expect(db._movements).toHaveLength(1)
      expect(db._movementLines).toHaveLength(1)
    })

    it('入出庫 DELETE の batch が巻き戻ったら 503 を返し、client に成功と読ませない', async () => {
      const a = await reg()
      db._movements.push({ id: 'm1', shop_code: a.shopCode })
      db._movementLines.push({ movement_id: 'm1', shop_code: a.shopCode })
      db._failBatchAt(1)

      const res = await worker.fetch(makeReq('DELETE', `/store/${a.shopCode}/movements/m1`, { token: a.token }), env)
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body).toMatchObject({ code: 'movement_delete_failed', retryable: true })
      expect(body.ok).toBeUndefined()
      expect(db._movements).toHaveLength(1)
    })

    it('成功した入出庫 DELETE は 200', async () => {
      const a = await reg()
      db._movements.push({ id: 'm1', shop_code: a.shopCode })
      const res = await worker.fetch(makeReq('DELETE', `/store/${a.shopCode}/movements/m1`, { token: a.token }), env)
      expect(res.status).toBe(200)
      expect(db._movements).toHaveLength(0)
    })

    it('発注 DELETE の batch が巻き戻ったら 503', async () => {
      const a = await reg()
      db._orders.push({ id: 'o1', shop_code: a.shopCode })
      db._failBatchAt(1)
      const res = await worker.fetch(makeReq('DELETE', `/store/${a.shopCode}/orders/o1`, { token: a.token }), env)
      expect(res.status).toBe(503)
      expect((await res.json()).code).toBe('order_delete_failed')
      expect(db._orders).toHaveLength(1)
    })

    it('履歴 DELETE が失敗したら 503 を返し、成功として届けない', async () => {
      const failing = createMockD1({ failTables: ['store_history'] })
      const failEnv = { ...env, DB: failing }
      const a = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), failEnv)).json()

      const res = await worker.fetch(makeReq('DELETE', `/store/${a.shopCode}/history/sess-1`, { token: a.token }), failEnv)
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body).toMatchObject({ code: 'history_delete_failed', retryable: true })
      expect(body.ok).toBeUndefined()
    })

    it('履歴 DELETE は sessionId 指定で該当行だけ消し、件数を返す', async () => {
      const a = await reg()
      db._history.push({ shop_code: a.shopCode, session_id: 'sess-1', snapshot_date: '2026-07-07' })
      db._history.push({ shop_code: a.shopCode, session_id: 'sess-2', snapshot_date: '2026-07-07' })

      const res = await worker.fetch(makeReq('DELETE', `/store/${a.shopCode}/history/sess-1`, { token: a.token }), env)
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ ok: true, removed: 1 })
      expect(db._history.map(r => r.session_id)).toEqual(['sess-2'])
    })
  })
})

describe('総当たり対策（ルームプローブ・IPレート制限）', () => {
  let db, env, roomFetched

  beforeEach(() => {
    db = createMockD1()
    roomFetched = 0
    env = {
      DB: db,
      ROOMS: {
        idFromName: () => 'x',
        get: () => ({ fetch: async () => { roomFetched++; return new Response('{}', { status: 200 }) } }),
      },
      ALLOWED_ORIGIN: '',
    }
  })

  it('存在しない店舗コードのルームアクセスは 404 で DO に到達しない', async () => {
    const res = await worker.fetch(makeReq('GET', '/room/ZZZZZZ/status'), env)
    expect(res.status).toBe(404)
    expect(roomFetched).toBe(0)
  })

  it('存在する店舗コードのルームアクセスは DO に転送される', async () => {
    const reg = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)).json()
    const res = await worker.fetch(makeReq('GET', `/room/${reg.shopCode}/status`), env)
    expect(res.status).toBe(200)
    expect(roomFetched).toBe(1)
  })

  it('ルームプローブ失敗が IP 単位で記録される', async () => {
    await worker.fetch(makeReq('GET', '/room/ZZZZZZ/status', { ip: '203.0.113.9' }), env)
    expect(db._ipRows.filter(r => r.ip === '203.0.113.9' && r.kind === 'probe')).toHaveLength(1)
  })

  it('プローブ失敗が上限に達した IP は 429 でブロックされる', async () => {
    for (let i = 0; i < 30; i++) {
      await worker.fetch(makeReq('GET', '/room/ZZZZZZ/status', { ip: '203.0.113.9' }), env)
    }
    const res = await worker.fetch(makeReq('GET', '/room/AAAAAA/status', { ip: '203.0.113.9' }), env)
    expect(res.status).toBe(429)
  })

  it('別 IP はブロックされない', async () => {
    for (let i = 0; i < 30; i++) {
      await worker.fetch(makeReq('GET', '/room/ZZZZZZ/status', { ip: '203.0.113.9' }), env)
    }
    const reg = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)).json()
    const res = await worker.fetch(makeReq('GET', `/room/${reg.shopCode}/status`, { ip: '198.51.100.2' }), env)
    expect(res.status).toBe(200)
  })

  it('ログイン失敗も IP 単位で記録され、上限超過で 429（店舗コード横断の総当たり対策）', async () => {
    const reg = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)).json()
    for (let i = 0; i < 30; i++) {
      await worker.fetch(makeReq('POST', '/auth/login', {
        body: { shopCode: reg.shopCode, pin: '0000' }, ip: '203.0.113.9',
      }), env)
    }
    const res = await worker.fetch(makeReq('POST', '/auth/login', {
      body: { shopCode: reg.shopCode, pin: '1234' }, ip: '203.0.113.9',
    }), env)
    expect(res.status).toBe(429)
  })
})

describe('障害境界（レート制限はfail-open、店舗認可はfail-closed）', () => {
  function makeEnv(db, onRoomFetch = () => {}) {
    return {
      DB: db,
      ROOMS: {
        idFromName: () => 'x',
        get: () => ({ fetch: async () => { onRoomFetch(); return new Response('{}', { status: 200 }) } }),
      },
      ALLOWED_ORIGIN: '',
    }
  }

  it('ip_attempts が無くてもルーム接続は通る（マイグレーション未適用事故の防御）', async () => {
    const db  = createMockD1({ failTables: ['ip_attempts'] })
    const env = makeEnv(db)
    const reg = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)).json()
    const res = await worker.fetch(makeReq('GET', `/room/${reg.shopCode}/status`), env)
    expect(res.status).toBe(200)
  })

  it('ip_attempts が無くても存在しないコードは 404（記録失敗は無視）', async () => {
    const db  = createMockD1({ failTables: ['ip_attempts'] })
    const env = makeEnv(db)
    const res = await worker.fetch(makeReq('GET', '/room/ZZZZZZ/status'), env)
    expect(res.status).toBe(404)
  })

  it('stores 自体が読めない場合は503で閉じ、DOへ到達させない', async () => {
    let roomFetched = 0
    const db  = createMockD1({ failTables: ['ip_attempts', 'stores'] })
    const env = makeEnv(db, () => { roomFetched++ })
    const res = await worker.fetch(makeReq('GET', '/room/ABCDEF/status'), env)
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('service_unavailable')
    expect(roomFetched).toBe(0)
  })

  it('DB binding が無い場合もルームゲートを503で閉じる', async () => {
    let roomFetched = 0
    const env = makeEnv(undefined, () => { roomFetched++ })
    const res = await worker.fetch(makeReq('GET', '/room/ABCDEF/status'), env)
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('service_unavailable')
    expect(roomFetched).toBe(0)
  })

  it('login_attempts / ip_attempts が無くても正しい PIN でログインできる', async () => {
    const db  = createMockD1()
    const env = makeEnv(db)
    const reg = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)).json()
    db._failTables.push('login_attempts', 'ip_attempts')
    const res = await worker.fetch(makeReq('POST', '/auth/login', {
      body: { shopCode: reg.shopCode, pin: '1234' },
    }), env)
    expect(res.status).toBe(200)
    expect((await res.json()).token).toBeTruthy()
  })
})

// ── S-E: CORS フェイルクローズ ────────────────────────────────────────────────
import { isAllowedOrigin, purgeAccountRooms } from './index.js'

describe('PLAY-001: account room purge routing', () => {
  it('棚卸・発注の2つのDOを専用内部requestで削除する', async () => {
    const names = []
    const requests = []
    const rooms = {
      idFromName(name) { names.push(name); return name },
      get(id) {
        return {
          async fetch(request) {
            requests.push({ id, request })
            return new Response('{ok:true}', { status: 200 })
          },
        }
      },
    }

    await purgeAccountRooms(rooms, 'ABCDEF')

    expect(names).toEqual(['room:ABCDEF', 'room:ABCDEF:order'])
    expect(requests).toHaveLength(2)
    for (const { request } of requests) {
      expect(request.method).toBe('DELETE')
      expect(new URL(request.url).pathname).toBe('/internal/account-delete')
      expect(request.headers.get('X-Inventory-Internal-Action')).toBe('account-delete-v1')
    }
  })

  it('どちらかのDOが失敗statusなら削除成功にしない', async () => {
    const rooms = {
      idFromName(name) { return name },
      get(id) {
        return {
          async fetch() {
            return new Response('{}', { status: id.endsWith(':order') ? 503 : 200 })
          },
        }
      },
    }

    await expect(purgeAccountRooms(rooms, 'ABCDEF')).rejects.toThrow('Durable Object purge failed')
  })
})

describe('S-E: CORS フェイルクローズ（isAllowedOrigin）', () => {
  it('Origin 無し（同一オリジン/WS/server-to-server）は許可', () => {
    expect(isAllowedOrigin('', '')).toBe(true)
    expect(isAllowedOrigin(undefined, '')).toBe(true)
  })
  it('本番/プレビュー（*.inventory-app.pages.dev）と localhost は既定で許可', () => {
    expect(isAllowedOrigin('https://inventory-app.pages.dev', '')).toBe(true)
    expect(isAllowedOrigin('https://feature-x.inventory-app.pages.dev', '')).toBe(true)
    expect(isAllowedOrigin('http://localhost:5173', '')).toBe(true)
    expect(isAllowedOrigin('http://127.0.0.1:8080', '')).toBe(true)
  })
  it('未設定でも見知らぬ Origin は拒否（フェイルクローズ）', () => {
    expect(isAllowedOrigin('https://evil.example.com', '')).toBe(false)
    // 類似ドメインのなりすまし（サフィックス偽装）も拒否
    expect(isAllowedOrigin('https://evil-inventory-app.pages.dev', '')).toBe(false)
    expect(isAllowedOrigin('https://inventory-app.pages.dev.evil.com', '')).toBe(false)
  })
  it('ALLOWED_ORIGIN（カンマ区切りの完全一致）で独自ドメインを追加できる', () => {
    expect(isAllowedOrigin('https://tanaoro.example', 'https://tanaoro.example')).toBe(true)
    expect(isAllowedOrigin('https://a.example', 'https://b.example, https://a.example')).toBe(true)
  })
})

describe('S-E: 許可外 Origin のリクエストは 403', () => {
  it('見知らぬ Origin ヘッダ付きは Forbidden', async () => {
    const db  = createMockD1()
    const env = { DB: db, ROOMS: { idFromName: () => 'x', get: () => null }, ALLOWED_ORIGIN: '' }
    const req = {
      method: 'GET', url: 'https://api.test/health',
      headers: { get: (h) => (h === 'Origin' ? 'https://evil.example.com' : null) },
      json: async () => ({}),
    }
    const res = await worker.fetch(req, env)
    expect(res.status).toBe(403)
  })
})

// ── S-D: /pdf の認証・サイズ上限・レート制限 ──────────────────────────────────
describe('S-D: /pdf エンドポイントのガード', () => {
  function pdfReq({ token, contentLength, bytes = 10, ip } = {}) {
    const buf = new ArrayBuffer(bytes)
    return {
      method: 'POST', url: 'https://api.test/pdf',
      headers: { get: (h) => {
        if (h === 'Authorization' && token) return `Bearer ${token}`
        if (h === 'CF-Connecting-IP')       return ip ?? '198.51.100.7'
        if (h === 'Content-Length')         return contentLength != null ? String(contentLength) : null
        return null
      } },
      json: async () => ({}),
      arrayBuffer: async () => buf,
    }
  }

  it('認証なしは 401', async () => {
    const db = createMockD1(); const env = { DB: db, ROOMS: { idFromName: () => 'x', get: () => null }, ALLOWED_ORIGIN: '' }
    const res = await worker.fetch(pdfReq({}), env)
    expect(res.status).toBe(401)
  })

  it('Content-Length が上限超過なら 413（本体を読む前に弾く）', async () => {
    const db = createMockD1(); const env = { DB: db, ROOMS: { idFromName: () => 'x', get: () => null }, ALLOWED_ORIGIN: '' }
    const reg = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)).json()
    const res = await worker.fetch(pdfReq({ token: reg.token, contentLength: 6 * 1024 * 1024 }), env)
    expect(res.status).toBe(413)
  })

  it('認証あり・小さいPDFは 200（parsePdfFile はモック）', async () => {
    const db = createMockD1(); const env = { DB: db, ROOMS: { idFromName: () => 'x', get: () => null }, ALLOWED_ORIGIN: '' }
    const reg = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)).json()
    const res = await worker.fetch(pdfReq({ token: reg.token, contentLength: 1000, bytes: 1000 }), env)
    expect(res.status).toBe(200)
  })

  it('IPレート制限: 上限超過で 429', async () => {
    const db = createMockD1(); const env = { DB: db, ROOMS: { idFromName: () => 'x', get: () => null }, ALLOWED_ORIGIN: '' }
    const reg = await (await worker.fetch(makeReq('POST', '/auth/register', { body: { pin: '1234' } }), env)).json()
    // ip_attempts を pdf kind で上限まで積む（IP_MAX_FAILS=30）
    for (let i = 0; i < 30; i++) db._ipRows.push({ ip: '198.51.100.7', kind: 'pdf', attempted_at: new Date().toISOString() })
    const res = await worker.fetch(pdfReq({ token: reg.token, contentLength: 1000 }), env)
    expect(res.status).toBe(429)
  })
})
