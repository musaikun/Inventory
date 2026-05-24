// ── 認証（店舗アカウント登録・ログイン・トークン検証）────────────────────────

function _now() { return new Date().toISOString() }

async function _hashPin(shopCode, pin) {
  const data = `${shopCode}:${pin}`
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function _genToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

function _genShopCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  return Array.from({ length: 6 }, () => c[Math.floor(Math.random() * c.length)]).join('')
}

function _extractToken(request) {
  const auth = request.headers.get('Authorization') ?? ''
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
}

// POST /auth/register  body: { storeName?, pin }
export async function handleRegister(db, body) {
  const pin       = String(body.pin ?? '').replace(/\D/g, '').slice(0, 4)
  const storeName = String(body.storeName ?? '').trim().slice(0, 50)
  if (pin.length !== 4) return { _status: 400, error: 'PINは4桁の数字で入力してください' }

  // 重複しない店舗コードを発行
  let code, existing
  do {
    code     = _genShopCode()
    existing = await db.prepare('SELECT shop_code FROM stores WHERE shop_code = ?').bind(code).first()
  } while (existing)

  const pinHash = await _hashPin(code, pin)
  const token   = _genToken()
  const now     = _now()
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

  await db.prepare(
    'INSERT INTO stores (shop_code, store_name, pin_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(code, storeName || null, pinHash, now, now).run()

  await db.prepare(
    'INSERT INTO auth_tokens (token, shop_code, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).bind(token, code, expires, now).run()

  return { shopCode: code, token, storeName: storeName || null }
}

// POST /auth/login  body: { shopCode, pin }
export async function handleLogin(db, body) {
  const shopCode = String(body.shopCode ?? '').toUpperCase().trim()
  const pin      = String(body.pin      ?? '').replace(/\D/g, '')

  const store = await db.prepare(
    'SELECT shop_code, store_name, pin_hash FROM stores WHERE shop_code = ?'
  ).bind(shopCode).first()

  if (!store)           return { _status: 401, error: '店舗コードが見つかりません' }
  if (!store.pin_hash)  return { _status: 401, error: 'このアカウントはPINが未設定です。新規登録してください。' }

  const pinHash = await _hashPin(shopCode, pin)
  if (pinHash !== store.pin_hash) return { _status: 401, error: 'PINが正しくありません' }

  const token   = _genToken()
  const now     = _now()
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

  await db.prepare(
    'INSERT INTO auth_tokens (token, shop_code, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).bind(token, shopCode, expires, now).run()

  return { token, shopCode, storeName: store.store_name ?? null }
}

// POST /auth/logout
export async function handleLogout(db, request) {
  const token = _extractToken(request)
  if (token) {
    await db.prepare('DELETE FROM auth_tokens WHERE token = ?').bind(token).run()
  }
  return { ok: true }
}

// Bearer トークンを検証して shopCode を返す（無効なら null）
export async function verifyAuth(db, request) {
  const token = _extractToken(request)
  if (!token) return null
  const row = await db.prepare(
    "SELECT shop_code FROM auth_tokens WHERE token = ? AND expires_at > datetime('now')"
  ).bind(token).first()
  return row?.shop_code ?? null
}
