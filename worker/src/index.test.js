import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('./pdfParser.js', () => ({ parsePdfFile: async () => ({}) }))

import worker from './index.js'

// ── ルーティング検証用の統合 D1 モック ──────────────────────────────────────────
function createMockD1({ failTables = [] } = {}) {
  const stores  = []
  const tokens  = []
  const configs = {}
  const ipRows  = []

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
    if (s.startsWith('SELECT pin_hash FROM stores')) {
      const r = stores.find(r => r.shop_code === args[0])
      return r ? { pin_hash: r.pin_hash ?? null } : null
    }
    if (s.startsWith('SELECT shop_code, store_name, pin_hash FROM stores')) {
      const r = stores.find(r => r.shop_code === args[0])
      return r ? { shop_code: r.shop_code, store_name: r.store_name ?? null, pin_hash: r.pin_hash ?? null } : null
    }
    if (s.startsWith('SELECT shop_code, active_room, created_at FROM stores')) {
      const r = stores.find(r => r.shop_code === args[0])
      return r ? { shop_code: r.shop_code, active_room: null, created_at: r.created_at ?? '' } : null
    }
    if (s.startsWith('SELECT shop_code FROM stores')) {
      return stores.find(r => r.shop_code === args[0]) ?? null
    }
    if (s.startsWith('INSERT INTO stores')) {
      stores.push(args.length >= 5
        ? { shop_code: args[0], store_name: args[1], pin_hash: args[2] }
        : { shop_code: args[0] })
      return { success: true }
    }
    if (s.startsWith('INSERT INTO auth_tokens')) {
      tokens.push({ token: args[0], shop_code: args[1], expires_at: args[2] })
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
    if (s.startsWith('INSERT INTO store_configs')) {
      configs[args[0]] = args[1]
      return { success: true }
    }
    if (s.startsWith('SELECT id, shop_code, started_at')) return []
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

  return { prepare, _stores: stores, _configs: configs, _ipRows: ipRows, _failTables: failTables }
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

describe('フェイルオープン（レート制限テーブル未作成でも本体機能を殺さない）', () => {
  function makeEnv(db) {
    return {
      DB: db,
      ROOMS: {
        idFromName: () => 'x',
        get: () => ({ fetch: async () => new Response('{}', { status: 200 }) }),
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

  it('stores 自体が読めない場合はルーム接続を素通しする（DO に委ねる）', async () => {
    const db  = createMockD1({ failTables: ['ip_attempts', 'stores'] })
    const env = makeEnv(db)
    const res = await worker.fetch(makeReq('GET', '/room/ABCDEF/status'), env)
    expect(res.status).toBe(200)
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
