// ── 認証（店舗アカウント登録・ログイン・トークン検証）────────────────────────

import { _now, genUniqueShopCode } from './workerUtils.js'
import { LOGIN_WINDOW_MS, LOGIN_MAX_FAILS, TOKEN_EXPIRY_MS, MAX_STORE_NAME_LEN, PBKDF2_ITERATIONS } from './constants.js'
import { entitlement } from './entitlements.js'

// ── PIN ハッシュ（PBKDF2・ランダムsalt）─────────────────────────────────────────
// 新形式: "pbkdf2$<iterations>$<saltB64>$<hashB64>"。
// 旧形式（SHA-256(shopCode:pin) の64桁hex）はログイン成功時に透過的に再ハッシュする。
function _b64(bytes)  { return btoa(String.fromCharCode(...new Uint8Array(bytes))) }
function _unb64(s)    { return Uint8Array.from(atob(s), c => c.charCodeAt(0)) }

function _ctEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

async function _deriveBits(pin, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256)
  return new Uint8Array(bits)
}

// 新形式ハッシュを生成する（登録・透過移行で使用）
async function _hashPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await _deriveBits(pin, salt, PBKDF2_ITERATIONS)
  return `pbkdf2$${PBKDF2_ITERATIONS}$${_b64(salt)}$${_b64(hash)}`
}

// 旧 SHA-256 ハッシュ（後方互換の検証専用）
async function _legacySha256(shopCode, pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${shopCode}:${pin}`))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// PIN 照合。{ ok, needsRehash } を返す。
// needsRehash = 旧形式、または反復回数が現行値より低い（＝より強い形式へ更新すべき）。
export async function verifyPinHash(shopCode, pin, storedHash) {
  if (typeof storedHash === 'string' && storedHash.startsWith('pbkdf2$')) {
    const [, iterStr, saltB64, hashB64] = storedHash.split('$')
    const iterations = parseInt(iterStr, 10) || PBKDF2_ITERATIONS
    let derived
    try { derived = await _deriveBits(pin, _unb64(saltB64), iterations) }
    catch { return { ok: false, needsRehash: false } }
    return { ok: _ctEqual(derived, _unb64(hashB64)), needsRehash: iterations < PBKDF2_ITERATIONS }
  }
  const legacy = await _legacySha256(shopCode, pin)
  return { ok: legacy === storedHash, needsRehash: true }
}

function _genToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

export function extractBearerToken(request) {
  const auth = request.headers.get('Authorization') ?? ''
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
}

// POST /auth/register  body: { storeName?, pin }
// defaultPlan='pro' は分離されたPro Review Workerだけで指定する。
export async function handleRegister(db, body, { defaultPlan = 'free' } = {}) {
  const pin       = String(body.pin ?? '').replace(/\D/g, '').slice(0, 4)
  const storeName = String(body.storeName ?? '').trim().slice(0, MAX_STORE_NAME_LEN)
  if (pin.length !== 4) return { _status: 400, error: 'PINは4桁の数字で入力してください' }

  const code    = await genUniqueShopCode(db)
  const pinHash = await _hashPin(pin)
  const token   = _genToken()
  const now     = _now()
  const expires = new Date(Date.now() + TOKEN_EXPIRY_MS).toISOString()
  const plan    = defaultPlan === 'pro' ? 'pro' : 'free'

  await db.prepare(
    'INSERT INTO stores (shop_code, store_name, pin_hash, plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(code, storeName || null, pinHash, plan, now, now).run()

  await db.prepare(
    'INSERT INTO auth_tokens (token, shop_code, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).bind(token, code, expires, now).run()

  return { shopCode: code, token, storeName: storeName || null, ...entitlement({ plan }) }
}

// POST /auth/login  body: { shopCode, pin }
export async function handleLogin(db, body) {
  const shopCode = String(body.shopCode ?? '').toUpperCase().trim()
  const pin      = String(body.pin      ?? '').replace(/\D/g, '')

  const store = await db.prepare(
    'SELECT shop_code, store_name, pin_hash, plan, created_at, deleted_at, deletion_pending_at FROM stores WHERE shop_code = ?'
  ).bind(shopCode).first()

  if (!store)           return { _status: 401, error: '店舗コードが見つかりません' }
  if (store.deleted_at || store.deletion_pending_at) {
    return { _status: 401, error: '店舗コードまたはPINを確認してください' }
  }
  if (!store.pin_hash)  return { _status: 401, error: 'このアカウントはPINが未設定です。新規登録してください。' }

  // 直近の失敗回数が上限を超えていたらブロック（正しいPINでも429）
  // フェイルオープン: login_attempts が読めなくてもログイン自体は止めない
  try {
    const since = new Date(Date.now() - LOGIN_WINDOW_MS).toISOString()
    const fails = await db.prepare(
      'SELECT COUNT(*) AS n FROM login_attempts WHERE shop_code = ? AND attempted_at > ?'
    ).bind(shopCode, since).first()
    if ((fails?.n ?? 0) >= LOGIN_MAX_FAILS) {
      return { _status: 429, error: 'ログイン試行が多すぎます。15分ほど待ってから再度お試しください' }
    }
  } catch (e) {
    console.error('[auth] login_attempts check failed (fail-open):', e?.message ?? e)
  }

  const { ok, needsRehash } = await verifyPinHash(shopCode, pin, store.pin_hash)
  if (!ok) {
    await db.prepare('INSERT INTO login_attempts (shop_code, attempted_at) VALUES (?, ?)')
      .bind(shopCode, _now()).run().catch(e =>
        console.error('[auth] login_attempts insert failed (fail-open):', e?.message ?? e))
    return { _status: 401, error: 'PINが正しくありません' }
  }

  // 透過移行: 旧 SHA-256 / 低反復のハッシュを現行 PBKDF2 へ更新する（失敗しても続行）
  if (needsRehash) {
    try {
      await db.prepare('UPDATE stores SET pin_hash = ?, updated_at = ? WHERE shop_code = ?')
        .bind(await _hashPin(pin), _now(), shopCode).run()
    } catch (e) {
      console.error('[auth] pin rehash failed (continue):', e?.message ?? e)
    }
  }

  // 成功: 失敗履歴をクリア
  await db.prepare('DELETE FROM login_attempts WHERE shop_code = ?').bind(shopCode).run().catch(e =>
    console.error('[auth] login_attempts clear failed (fail-open):', e?.message ?? e))

  // 単一ホストセッション: 既存トークンを全て無効化してから新トークンを発行する。
  // これにより、同じ店舗を別端末/別ブラウザからログインすると前の端末は失効し、
  // 複数ホストが同一セッションを同時に開始/再開して整合性が壊れるのを防ぐ。
  await db.prepare('DELETE FROM auth_tokens WHERE shop_code = ?').bind(shopCode).run()

  const token   = _genToken()
  const now     = _now()
  const expires = new Date(Date.now() + TOKEN_EXPIRY_MS).toISOString()

  await db.prepare(
    'INSERT INTO auth_tokens (token, shop_code, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).bind(token, shopCode, expires, now).run()

  return { token, shopCode, storeName: store.store_name ?? null, ...entitlement(store) }
}

// POST /auth/logout
export async function handleLogout(db, request) {
  const token = extractBearerToken(request)
  if (token) {
    await db.prepare('DELETE FROM auth_tokens WHERE token = ?').bind(token).run()
  }
  return { ok: true }
}

// 生トークン文字列を検証して active な shopCode を返す（無効なら null）
// WebSocket の join メッセージなど、ヘッダを使えない経路からも呼べるよう分離する。
export async function verifyAuthToken(db, token) {
  if (!token) return null
  const row = await db.prepare(
    "SELECT shop_code FROM auth_tokens WHERE token = ? AND expires_at > datetime('now')"
  ).bind(token).first()
  if (!row?.shop_code) return null
  const store = await db.prepare(
    'SELECT deleted_at, deletion_pending_at FROM stores WHERE shop_code = ?'
  ).bind(row.shop_code).first()
  return store && !store.deleted_at && !store.deletion_pending_at ? row.shop_code : null
}

// Bearer トークンを検証して shopCode を返す（無効なら null）
export async function verifyAuth(db, request) {
  return verifyAuthToken(db, extractBearerToken(request))
}

// 店舗データAPIのアクセス可否（後方互換ソフト認証）。
// PIN設定済みの店舗は有効なトークン必須。PIN未設定のレガシー店舗は従来通り許可。
export async function verifyStoreAccess(db, code, request) {
  const row = await db.prepare(
    'SELECT pin_hash, deleted_at, deletion_pending_at FROM stores WHERE shop_code = ?'
  ).bind(code).first()
  if (!row || row.deleted_at || row.deletion_pending_at) return false
  if (!row.pin_hash) return true
  const authCode = await verifyAuth(db, request)
  return authCode === code
}
