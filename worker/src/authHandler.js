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
export async function _hashPin(pin) {
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

// ── トークンの保存形 ────────────────────────────────────────────────────────────
// D1 にはトークンのハッシュだけを置く（"h1:" + SHA-256 の16進）。DB の中身が漏れても、
// そのまま Bearer に使える値は出ない。トークンは 24 バイトの乱数なので、遅いハッシュは要らない。
// この変更より前に生のまま保存したトークン（30日で失効）も引けるよう、照合は2つの鍵で行う。
export async function tokenHash(token) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(token)))
  return 'h1:' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}
/**
 * `WHERE token IN (?, ?)` に渡す鍵（ハッシュ・旧形式の生）。
 * 送られてきた値が保存形（"h1:..."）なら旧形式としては引かない。引くと、漏れた DB の
 * ハッシュ値をそのまま Bearer に使えてしまう。発行するトークンは16進だけなので "h1:" で始まらない。
 */
export async function tokenKeys(token) {
  const t = String(token)
  const hash = await tokenHash(t)
  return [hash, t.startsWith('h1:') ? hash : t]
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
  ).bind(await tokenHash(token), code, expires, now).run()

  const deviceKey = await _issueLoginDevice(db, code, null)
  return { shopCode: code, token, storeName: storeName || null, ...entitlement({ plan }), ...(deviceKey ? { deviceKey } : {}) }
}

// ── 信頼済み端末（PIN の締め出し対策・0027）─────────────────────────────────────
// 一度ログインに成功した端末には鍵を渡し、次のログインで送ってもらう。鍵を持つ端末の失敗は
// その端末の分だけで数え、鍵の無い端末の失敗は今までどおり店舗全体でまとめて止める。
// 第三者が PIN をまちがえ続けても、店主のいつもの端末は締め出されない。総当たりへの強さは変わらない。
// 鍵は auth_tokens と同じく SHA-256 で保存する。表が無い（0027 未適用）ときは鍵なしと同じに倒す。
const MAX_LOGIN_DEVICES = 20

async function _knownDeviceHash(db, shopCode, rawKey) {
  const key = typeof rawKey === 'string' ? rawKey.slice(0, 128) : ''
  if (!key) return null
  try {
    const h = await tokenHash(key)
    const row = await db.prepare('SELECT 1 AS x FROM login_devices WHERE shop_code = ? AND key_hash = ?').bind(shopCode, h).first()
    return row ? h : null
  } catch (_) { return null }
}

// ログインに成功した端末の鍵を記録して返す（知っている端末なら同じ鍵）。失敗してもログインは止めない
async function _issueLoginDevice(db, shopCode, knownHash, knownKey = '') {
  const now = _now()
  try {
    if (knownHash) {
      await db.prepare('UPDATE login_devices SET last_used_at = ? WHERE shop_code = ? AND key_hash = ?').bind(now, shopCode, knownHash).run()
      return knownKey
    }
    const key = _genToken()
    await db.prepare('INSERT INTO login_devices (shop_code, key_hash, created_at, last_used_at) VALUES (?, ?, ?, ?)')
      .bind(shopCode, await tokenHash(key), now, now).run()
    await db.prepare(`DELETE FROM login_devices WHERE shop_code = ? AND key_hash NOT IN (
      SELECT key_hash FROM login_devices WHERE shop_code = ? ORDER BY last_used_at DESC LIMIT ${MAX_LOGIN_DEVICES})`).bind(shopCode, shopCode).run()
    return key
  } catch (e) {
    console.error('[auth] login device issue failed (continue):', e?.message ?? e)
    return ''
  }
}

// 直近の失敗回数。鍵のある端末はその端末の分、鍵の無い端末は鍵の無い失敗をまとめて数える。
// 0027 未適用（列が無い）なら従来どおり店舗全体で数える。
async function _recentLoginFails(db, shopCode, deviceHash) {
  const since = new Date(Date.now() - LOGIN_WINDOW_MS).toISOString()
  try {
    const row = deviceHash
      ? await db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE shop_code = ? AND device_key_hash = ? AND attempted_at > ?').bind(shopCode, deviceHash, since).first()
      : await db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE shop_code = ? AND device_key_hash IS NULL AND attempted_at > ?').bind(shopCode, since).first()
    return row?.n ?? 0
  } catch (_) {
    const row = await db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE shop_code = ? AND attempted_at > ?').bind(shopCode, since).first()
    return row?.n ?? 0
  }
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

  // 直近の失敗回数が上限を超えていたらブロック（正しいPINでも429）。
  // 信頼済み端末（0027）はその端末の失敗だけで数える。第三者の失敗で店主が締め出されないように。
  // フェイルオープン: login_attempts が読めなくてもログイン自体は止めない
  const deviceHash = await _knownDeviceHash(db, shopCode, body.deviceKey)
  let fails = 0
  try {
    fails = await _recentLoginFails(db, shopCode, deviceHash)
    if (fails >= LOGIN_MAX_FAILS) {
      return { _status: 429, error: 'ログイン試行が多すぎます。15分ほど待ってから再度お試しください' }
    }
  } catch (e) {
    console.error('[auth] login_attempts check failed (fail-open):', e?.message ?? e)
  }

  const { ok, needsRehash } = await verifyPinHash(shopCode, pin, store.pin_hash)
  if (!ok) {
    const now = _now()
    await db.prepare('INSERT INTO login_attempts (shop_code, attempted_at, device_key_hash) VALUES (?, ?, ?)')
      .bind(shopCode, now, deviceHash).run().catch(() =>
        db.prepare('INSERT INTO login_attempts (shop_code, attempted_at) VALUES (?, ?)').bind(shopCode, now).run())
      .catch(e => console.error('[auth] login_attempts insert failed (fail-open):', e?.message ?? e))
    // 鍵の無い端末の失敗でちょうど上限に達した＝ここから15分、新しい端末からは入れない。店主へ知らせる（router）
    const lockedNow = !deviceHash && fails + 1 === LOGIN_MAX_FAILS
    return { _status: 401, error: 'PINが正しくありません', ...(lockedNow ? { lockedNow: true } : {}) }
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

  // 成功: 同じ側（この端末／鍵の無い端末）の失敗履歴だけをクリアする。
  // 店主がいつもの端末で入っても、第三者の失敗の数え直しにはしない。
  await (deviceHash
    ? db.prepare('DELETE FROM login_attempts WHERE shop_code = ? AND device_key_hash = ?').bind(shopCode, deviceHash).run()
    : db.prepare('DELETE FROM login_attempts WHERE shop_code = ? AND device_key_hash IS NULL').bind(shopCode).run()
  ).catch(() => db.prepare('DELETE FROM login_attempts WHERE shop_code = ?').bind(shopCode).run())
    .catch(e => console.error('[auth] login_attempts clear failed (fail-open):', e?.message ?? e))

  // 単一ホストセッション: 既存トークンを全て無効化してから新トークンを発行する。
  // これにより、同じ店舗を別端末/別ブラウザからログインすると前の端末は失効し、
  // 複数ホストが同一セッションを同時に開始/再開して整合性が壊れるのを防ぐ。
  // スタッフのトークン（staff_id あり・段 2-1）は消さない。オーナーのログインでスタッフが追い出されないように
  await db.prepare('DELETE FROM auth_tokens WHERE shop_code = ? AND staff_id IS NULL').bind(shopCode).run()

  const token   = _genToken()
  const now     = _now()
  const expires = new Date(Date.now() + TOKEN_EXPIRY_MS).toISOString()

  await db.prepare(
    'INSERT INTO auth_tokens (token, shop_code, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).bind(await tokenHash(token), shopCode, expires, now).run()

  const deviceKey = await _issueLoginDevice(db, shopCode, deviceHash, deviceHash ? body.deviceKey : '')
  return { token, shopCode, storeName: store.store_name ?? null, ...entitlement(store), ...(deviceKey ? { deviceKey } : {}) }
}

// POST /auth/logout
export async function handleLogout(db, request) {
  const token = extractBearerToken(request)
  if (token) {
    await db.prepare('DELETE FROM auth_tokens WHERE token IN (?, ?)').bind(...await tokenKeys(token)).run()
  }
  return { ok: true }
}

// 生トークン文字列を検証して active な shopCode を返す（無効なら null）
// WebSocket の join メッセージなど、ヘッダを使えない経路からも呼べるよう分離する。
export async function verifyAuthToken(db, token) {
  if (!token) return null
  const row = await db.prepare(
    "SELECT shop_code, staff_id FROM auth_tokens WHERE token IN (?, ?) AND expires_at > datetime('now')"
  ).bind(...await tokenKeys(token)).first()
  if (!row?.shop_code) return null
  // スタッフのトークンは、その人が使える状態（承認済み・停止でも削除でもない）のときだけ有効
  if (row.staff_id) {
    const st = await db.prepare('SELECT status FROM staff WHERE id = ? AND shop_code = ?').bind(row.staff_id, row.shop_code).first()
    if (st?.status !== 'active') return null
  }
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
