import { describe, it, expect, beforeEach } from 'vitest'
import { handleRegister, handleLogin, handleLogout, verifyAuth, verifyStoreAccess } from './authHandler.js'

// ── 最小限の D1 モック（authHandler が使うクエリだけ解釈する）──────────────────
function createMockD1() {
  const stores   = []
  const tokens   = []
  const attempts = []   // login_attempts

  function exec(sql, args) {
    const s = sql.replace(/\s+/g, ' ').trim()

    if (s.startsWith('SELECT shop_code FROM stores WHERE shop_code')) {
      return stores.find(r => r.shop_code === args[0]) ?? null
    }
    if (s.startsWith('INSERT INTO stores')) {
      const [shop_code, store_name, pin_hash, created_at, updated_at] = args
      stores.push({ shop_code, store_name, pin_hash, created_at, updated_at })
      return { success: true }
    }
    if (s.startsWith('SELECT shop_code, store_name, pin_hash FROM stores')) {
      return stores.find(r => r.shop_code === args[0]) ?? null
    }
    if (s.startsWith('SELECT pin_hash FROM stores')) {
      return stores.find(r => r.shop_code === args[0]) ?? null
    }
    if (s.startsWith('INSERT INTO auth_tokens')) {
      const [token, shop_code, expires_at, created_at] = args
      tokens.push({ token, shop_code, expires_at, created_at })
      return { success: true }
    }
    if (s.startsWith('DELETE FROM auth_tokens WHERE token')) {
      const i = tokens.findIndex(t => t.token === args[0])
      if (i >= 0) tokens.splice(i, 1)
      return { success: true }
    }
    if (s.startsWith('DELETE FROM auth_tokens WHERE shop_code')) {
      for (let i = tokens.length - 1; i >= 0; i--) {
        if (tokens[i].shop_code === args[0]) tokens.splice(i, 1)
      }
      return { success: true }
    }
    if (s.startsWith('SELECT shop_code FROM auth_tokens WHERE token')) {
      const t = tokens.find(t => t.token === args[0])
      if (!t) return null
      // expires_at > datetime('now') を時刻比較で再現
      if (new Date(t.expires_at).getTime() <= Date.now()) return null
      return { shop_code: t.shop_code }
    }
    // ── login_attempts（総当たり対策）──
    if (s.startsWith('SELECT COUNT(*) AS n FROM login_attempts')) {
      const [shop_code, since] = args
      const n = attempts.filter(a => a.shop_code === shop_code && a.attempted_at > since).length
      return { n }
    }
    if (s.startsWith('INSERT INTO login_attempts')) {
      const [shop_code, attempted_at] = args
      attempts.push({ shop_code, attempted_at })
      return { success: true }
    }
    if (s.startsWith('DELETE FROM login_attempts WHERE shop_code')) {
      for (let i = attempts.length - 1; i >= 0; i--) {
        if (attempts[i].shop_code === args[0]) attempts.splice(i, 1)
      }
      return { success: true }
    }
    throw new Error('Unhandled SQL in mock: ' + s)
  }

  function prepare(sql) {
    let bound = []
    const stmt = {
      bind(...a) { bound = a; return stmt },
      async first() { return exec(sql, bound) },
      async run()   { return exec(sql, bound) },
    }
    return stmt
  }

  return { prepare, _stores: stores, _tokens: tokens, _attempts: attempts }
}

// Authorization: Bearer <token> を持つ擬似 Request
function reqWithToken(token) {
  return { headers: { get: (h) => (h === 'Authorization' ? `Bearer ${token}` : null) } }
}

describe('authHandler', () => {
  let db
  beforeEach(() => { db = createMockD1() })

  // O-01 店舗の新規登録
  it('正常登録で6文字の店舗コードとトークンを発行する', async () => {
    const res = await handleRegister(db, { storeName: 'テスト店', pin: '1234' })
    expect(res.shopCode).toMatch(/^[A-Z]{6}$/)
    expect(res.token).toBeTruthy()
    expect(db._stores).toHaveLength(1)
    expect(db._tokens).toHaveLength(1)
  })

  it('PINが4桁でない場合は400を返し店舗を作らない', async () => {
    const res = await handleRegister(db, { pin: '12' })
    expect(res._status).toBe(400)
    expect(db._stores).toHaveLength(0)
  })

  // O-02 別端末からのログイン（単一ホストセッション: 旧トークンは失効）
  it('正しいPINでログインすると新トークンを発行し、旧トークンを無効化する', async () => {
    const reg = await handleRegister(db, { pin: '1234' })
    const res = await handleLogin(db, { shopCode: reg.shopCode, pin: '1234' })
    expect(res.token).toBeTruthy()
    expect(res.shopCode).toBe(reg.shopCode)
    // 単一セッション: 有効トークンは常に最新の1つだけ
    expect(db._tokens).toHaveLength(1)
    expect(db._tokens[0].token).toBe(res.token)
  })

  // 別端末ログインで前の端末のトークンが失効する（ホスト1台制限の核心）
  it('別端末でログインすると前の端末のトークンは verifyAuth で無効になる', async () => {
    const reg = await handleRegister(db, { pin: '1234' })          // 端末A（登録）
    expect(await verifyAuth(db, reqWithToken(reg.token))).toBe(reg.shopCode)
    const login = await handleLogin(db, { shopCode: reg.shopCode, pin: '1234' }) // 端末B
    // 端末A の旧トークンは失効、端末B の新トークンは有効
    expect(await verifyAuth(db, reqWithToken(reg.token))).toBeNull()
    expect(await verifyAuth(db, reqWithToken(login.token))).toBe(reg.shopCode)
  })

  // O-03 誤PINの拒否
  it('誤ったPINは401を返しトークンを発行しない', async () => {
    const reg = await handleRegister(db, { pin: '1234' })
    const before = db._tokens.length
    const res = await handleLogin(db, { shopCode: reg.shopCode, pin: '9999' })
    expect(res._status).toBe(401)
    expect(db._tokens).toHaveLength(before)
  })

  it('存在しない店舗コードは401を返す', async () => {
    const res = await handleLogin(db, { shopCode: 'ZZZZZZ', pin: '1234' })
    expect(res._status).toBe(401)
  })

  it('PINは店舗コードでソルトされ、別店舗の同一PINでもハッシュが衝突しない', async () => {
    const a = await handleRegister(db, { pin: '1234' })
    const b = await handleRegister(db, { pin: '1234' })
    const ha = db._stores.find(s => s.shop_code === a.shopCode).pin_hash
    const hb = db._stores.find(s => s.shop_code === b.shopCode).pin_hash
    expect(ha).not.toBe(hb)
  })

  // verifyAuth
  it('有効なトークンは shopCode を返す', async () => {
    const reg = await handleRegister(db, { pin: '1234' })
    const code = await verifyAuth(db, reqWithToken(reg.token))
    expect(code).toBe(reg.shopCode)
  })

  it('無効なトークンは null を返す', async () => {
    await handleRegister(db, { pin: '1234' })
    expect(await verifyAuth(db, reqWithToken('deadbeef'))).toBeNull()
  })

  it('Authorizationヘッダーが無ければ null を返す', async () => {
    const req = { headers: { get: () => null } }
    expect(await verifyAuth(db, req)).toBeNull()
  })

  it('期限切れトークンは null を返す', async () => {
    const reg = await handleRegister(db, { pin: '1234' })
    // モック内のトークンを過去に失効させる
    db._tokens[0].expires_at = new Date(Date.now() - 1000).toISOString()
    expect(await verifyAuth(db, reqWithToken(reg.token))).toBeNull()
  })

  // ログアウト
  it('ログアウト後はトークンが無効化される', async () => {
    const reg = await handleRegister(db, { pin: '1234' })
    await handleLogout(db, reqWithToken(reg.token))
    expect(await verifyAuth(db, reqWithToken(reg.token))).toBeNull()
  })

  // ── 総当たり対策（ログイン回数制限）─────────────────────────────────────────
  it('PINを5回間違えると6回目は429でブロックされる', async () => {
    const reg = await handleRegister(db, { pin: '1234' })
    for (let i = 0; i < 5; i++) {
      const r = await handleLogin(db, { shopCode: reg.shopCode, pin: '0000' })
      expect(r._status).toBe(401)
    }
    const blocked = await handleLogin(db, { shopCode: reg.shopCode, pin: '0000' })
    expect(blocked._status).toBe(429)
  })

  it('ブロック中は正しいPINでも429（解除は時間経過のみ）', async () => {
    const reg = await handleRegister(db, { pin: '1234' })
    for (let i = 0; i < 5; i++) await handleLogin(db, { shopCode: reg.shopCode, pin: '0000' })
    const res = await handleLogin(db, { shopCode: reg.shopCode, pin: '1234' })
    expect(res._status).toBe(429)
  })

  it('ログイン成功で失敗履歴がクリアされる', async () => {
    const reg = await handleRegister(db, { pin: '1234' })
    await handleLogin(db, { shopCode: reg.shopCode, pin: '0000' })
    await handleLogin(db, { shopCode: reg.shopCode, pin: '0000' })
    const ok = await handleLogin(db, { shopCode: reg.shopCode, pin: '1234' })
    expect(ok.token).toBeTruthy()
    expect(db._attempts.filter(a => a.shop_code === reg.shopCode)).toHaveLength(0)
  })

  // ── 後方互換ソフト認証（verifyStoreAccess）──────────────────────────────────
  it('PIN設定店舗は有効トークンがあればアクセス許可', async () => {
    const reg = await handleRegister(db, { pin: '1234' })
    expect(await verifyStoreAccess(db, reg.shopCode, reqWithToken(reg.token))).toBe(true)
  })

  it('PIN設定店舗はトークン無しならアクセス拒否', async () => {
    const reg = await handleRegister(db, { pin: '1234' })
    const noTokenReq = { headers: { get: () => null } }
    expect(await verifyStoreAccess(db, reg.shopCode, noTokenReq)).toBe(false)
  })

  it('PIN設定店舗は別店舗のトークンではアクセス拒否', async () => {
    const a = await handleRegister(db, { pin: '1234' })
    const b = await handleRegister(db, { pin: '5678' })
    expect(await verifyStoreAccess(db, a.shopCode, reqWithToken(b.token))).toBe(false)
  })

  it('レガシー店舗（PIN未設定）はトークン無しでもアクセス許可', async () => {
    db._stores.push({ shop_code: 'LEGACY', store_name: null, pin_hash: null })
    const noTokenReq = { headers: { get: () => null } }
    expect(await verifyStoreAccess(db, 'LEGACY', noTokenReq)).toBe(true)
  })
})
