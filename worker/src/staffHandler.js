/**
 * スタッフごとのログイン（段 2-1・User決定 2026-10-07。設計は docs/proposals.md）。
 *
 * - 管理者（オーナー＝今の店舗ログイン、または role=admin のスタッフ）が1人ずつ招待を出す（10分・1回きり）
 * - スタッフは招待から名前と6桁の暗証番号を入れて申請 → 管理者が承認 → 申請した端末がそのままログインする
 * - 以降は「店舗コード＋名前＋暗証番号」でログイン（失敗は 店舗×名前×端末 で15分に5回まで）
 * - 停止・削除はその人のトークンを即座に消す。削除は行と名前を残し（記録の「○○（削除済み）」用）、暗証番号を消す
 */
import { _now } from './workerUtils.js'
import { _hashPin, verifyPinHash, extractBearerToken, tokenHash, tokenKeys } from './authHandler.js'
import { LOGIN_WINDOW_MS, LOGIN_MAX_FAILS, TOKEN_EXPIRY_MS } from './constants.js'
import { entitlement } from './entitlements.js'
import { normalizeGrants, can } from './permissions.js'

export const STAFF_ROLES = ['arbeit', 'shain', 'admin']
export const INVITE_TTL_MS = 10 * 60 * 1000
const NAME_MAX = 30

const _hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
const _rand = n => _hex(crypto.getRandomValues(new Uint8Array(n)))
async function _sha256(s) {
  return _hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))))
}
const _normName = s => String(s ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').slice(0, NAME_MAX)
const _nameKey = s => _normName(s).toLowerCase()

/** 6桁の暗証番号として使えるか。同じ数字の並び・連番などは使わせない */
export function pinProblem(pin) {
  if (!/^\d{6}$/.test(pin)) return '暗証番号は6桁の数字で入れてください'
  if (/^(\d)\1{5}$/.test(pin)) return '同じ数字だけの暗証番号は使えません'
  const asc = '01234567890', desc = '09876543210'
  if (asc.includes(pin) || desc.includes(pin)) return '連続した数字の暗証番号は使えません'
  if (/^(\d\d\d)\1$/.test(pin) || /^(\d\d)\1\1$/.test(pin)) return '同じ並びのくり返しは使えません'
  return ''
}

/**
 * トークンから「誰か」を引く。オーナー（staff_id なし）は role='owner'。
 * 停止・削除・承認前のスタッフのトークンは無効（null）。
 */
export async function authContext(db, request) {
  const token = extractBearerToken(request)
  if (!token) return null
  const row = await db.prepare(`
    SELECT a.shop_code, a.staff_id, s.deleted_at, s.deletion_pending_at
    FROM auth_tokens a JOIN stores s ON s.shop_code = a.shop_code
    WHERE a.token IN (?, ?) AND a.expires_at > datetime('now')
  `).bind(...await tokenKeys(token)).first()
  if (!row?.shop_code || row.deleted_at || row.deletion_pending_at) return null
  if (!row.staff_id) return { shopCode: row.shop_code, staffId: null, role: 'owner', name: null, grants: [], isAdmin: true }
  const st = await db.prepare('SELECT id, name, role, status, grants_json FROM staff WHERE id = ? AND shop_code = ?')
    .bind(row.staff_id, row.shop_code).first()
  if (!st || st.status !== 'active') return null
  return { shopCode: row.shop_code, staffId: st.id, role: st.role, name: st.name, grants: _grants(st), isAdmin: st.role === 'admin' }
}

/**
 * 削除したスタッフの記録を「山田（削除済み）」へ（段 2-2・User決定 2026-10-07）。
 * やったことは残し、名前の後ろに印を付けるだけ。ID で結び付いた記録だけを書き換える。
 * やることは updated_at を進め、各端末が次に取り直したときに新しい名前へ揃うようにする。
 */
async function _markDeletedInRecords(db, code, id, name, now) {
  const label = `${name}（削除済み）`
  await db.batch([
    db.prepare('UPDATE tasks SET created_by = ?, updated_at = ? WHERE shop_code = ? AND created_by_id = ?').bind(label, now, code, id),
    db.prepare('UPDATE tasks SET done_by = ?, updated_at = ? WHERE shop_code = ? AND done_by_id = ?').bind(label, now, code, id),
    db.prepare('UPDATE movements SET created_by = ? WHERE shop_code = ? AND created_by_id = ?').bind(label, code, id),
    db.prepare('UPDATE sessions SET started_by = ? WHERE shop_code = ? AND started_by_id = ?').bind(label, code, id),
    db.prepare('UPDATE sessions SET completed_by = ? WHERE shop_code = ? AND completed_by_id = ?').bind(label, code, id),
    db.prepare('UPDATE tasks SET assignee_name = ?, updated_at = ? WHERE shop_code = ? AND assignee_id = ?').bind(label, now, code, id),
    // 「全員」の印の名前（{"id":…,"name":…} の並びで保存している）
    db.prepare(`UPDATE tasks SET done_list_json = replace(done_list_json, ?, ?), updated_at = ?
      WHERE shop_code = ? AND instr(done_list_json, ?) > 0`)
      .bind(`"id":${JSON.stringify(id)},"name":${JSON.stringify(name)}`, `"id":${JSON.stringify(id)},"name":${JSON.stringify(label)}`, now, code, `"id":${JSON.stringify(id)},`),
  ])
}

async function _requireAdmin(db, request, code) {
  const ctx = await authContext(db, request)
  if (!ctx || ctx.shopCode !== code) return { deny: { _status: 401, error: '認証が必要です' } }
  if (!ctx.isAdmin) return { deny: { _status: 403, code: 'forbidden', error: '管理者だけができる操作です' } }
  return { ctx }
}

function _grants(r) {
  try { return normalizeGrants(JSON.parse(r?.grants_json || '[]')) } catch (_) { return [] }
}
const _me = st => ({ id: st.id, name: st.name, role: st.role, grants: _grants(st) })

/** その人がその操作をできるか（オーナー・管理者は全部） */
export function ctxCan(ctx, perm) {
  return !!ctx && can(ctx.role, ctx.grants ?? [], perm)
}

function _staffView(r) {
  return {
    id: r.id, name: r.name, role: r.role, status: r.status, grants: _grants(r),
    createdAt: r.created_at, approvedAt: r.approved_at ?? null, lastSeenAt: r.last_seen_at ?? null,
  }
}

async function _issueToken(db, shopCode, staffId) {
  const token = _rand(24)
  const now = _now()
  const expires = new Date(Date.now() + TOKEN_EXPIRY_MS).toISOString()
  await db.prepare('INSERT INTO auth_tokens (token, shop_code, expires_at, created_at, staff_id) VALUES (?, ?, ?, ?, ?)')
    .bind(await tokenHash(token), shopCode, expires, now, staffId).run()
  return token
}

async function _storeInfo(db, code) {
  return db.prepare('SELECT shop_code, store_name, plan, created_at, deleted_at, deletion_pending_at FROM stores WHERE shop_code = ?')
    .bind(code).first()
}

// ── 管理者の操作 ───────────────────────────────────────────

/** GET /store/:code/staff … スタッフと、まだ使われていない招待の一覧 */
export async function handleStaffList(db, request, code) {
  const { deny } = await _requireAdmin(db, request, code)
  if (deny) return deny
  const { results: staff } = await db.prepare(
    "SELECT * FROM staff WHERE shop_code = ? AND status != 'rejected' ORDER BY created_at",
  ).bind(code).all()
  const { results: invites } = await db.prepare(
    "SELECT id, name, role, expires_at, created_at FROM staff_invites WHERE shop_code = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC",
  ).bind(code, _now()).all()
  return {
    staff: (staff ?? []).map(_staffView),
    invites: (invites ?? []).map(i => ({ id: i.id, name: i.name, role: i.role, expiresAt: i.expires_at })),
  }
}

/** POST /store/:code/staff/invites { name, role } … 招待を出す（生の鍵はこの応答でだけ返す） */
export async function handleStaffInvite(db, request, code, body) {
  const { deny, ctx } = await _requireAdmin(db, request, code)
  if (deny) return deny
  const name = _normName(body?.name)
  const role = STAFF_ROLES.includes(body?.role) ? body.role : null
  if (!name) return { _status: 400, error: '名前を入れてください' }
  if (!role) return { _status: 400, error: '役割を選んでください' }
  const token = _rand(24)
  const id = 'inv_' + _rand(8)
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString()
  await db.prepare(
    'INSERT INTO staff_invites (id, shop_code, token_hash, name, role, expires_at, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(id, code, await _sha256(token), name, role, expiresAt, _now(), ctx.staffId ?? 'owner').run()
  return { invite: { id, name, role, expiresAt, token } }
}

/** DELETE /store/:code/staff/invites/:id … 招待を取り消す */
export async function handleStaffInviteRevoke(db, request, code, id) {
  const { deny } = await _requireAdmin(db, request, code)
  if (deny) return deny
  await db.prepare('DELETE FROM staff_invites WHERE id = ? AND shop_code = ? AND used_at IS NULL').bind(id, code).run()
  return { ok: true }
}

/**
 * POST /store/:code/staff/:id/:action … approve / reject / stop / resume / delete / role
 * 停止・削除・断るは、その人のトークンを即座に消す。
 */
export async function handleStaffAction(db, request, code, id, action, body = {}) {
  const { deny, ctx } = await _requireAdmin(db, request, code)
  if (deny) return deny
  const st = await db.prepare('SELECT * FROM staff WHERE id = ? AND shop_code = ?').bind(id, code).first()
  if (!st || st.status === 'deleted') return { _status: 404, error: 'スタッフが見つかりません' }
  if (ctx.staffId && ctx.staffId === id && ['stop', 'delete', 'role', 'grants'].includes(action)) {
    return { _status: 400, error: '自分自身は変えられません。オーナーか他の管理者に頼んでください' }
  }
  const now = _now()
  const set = (sql, ...args) => db.prepare(`UPDATE staff SET ${sql}, updated_at = ? WHERE id = ? AND shop_code = ?`).bind(...args, now, id, code).run()
  const dropTokens = () => db.prepare('DELETE FROM auth_tokens WHERE staff_id = ?').bind(id).run()
  switch (action) {
    case 'approve':
      if (st.status !== 'pending') return { _status: 409, error: '承認待ちではありません' }
      await set('status = ?, approved_at = ?, approved_by = ?', 'active', now, ctx.staffId ?? 'owner')
      break
    case 'reject':
      if (st.status !== 'pending') return { _status: 409, error: '承認待ちではありません' }
      await set('status = ?, pin_hash = NULL, pending_key_hash = NULL', 'rejected')
      break
    case 'stop':
      if (st.status !== 'active') return { _status: 409, error: '使える状態ではありません' }
      await set('status = ?', 'stopped'); await dropTokens()
      break
    case 'resume':
      if (st.status !== 'stopped') return { _status: 409, error: '停止中ではありません' }
      await set('status = ?', 'active')
      break
    case 'delete':
      await set('status = ?, pin_hash = NULL, pending_key_hash = NULL, deleted_at = ?', 'deleted', now); await dropTokens()
      await _markDeletedInRecords(db, code, id, st.name, now)
      break
    case 'role': {
      const role = STAFF_ROLES.includes(body?.role) ? body.role : null
      if (!role) return { _status: 400, error: '役割を選んでください' }
      await set('role = ?', role)
      break
    }
    case 'grants':
      await set('grants_json = ?', JSON.stringify(normalizeGrants(body?.grants)))
      break
    default:
      return { _status: 404, error: 'Not found' }
  }
  const row = await db.prepare('SELECT * FROM staff WHERE id = ?').bind(id).first()
  return { staff: _staffView(row) }
}

// ── 招待を受けた人（ログイン前）─────────────────────────────

async function _liveInvite(db, token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{48}$/.test(token)) return null
  const inv = await db.prepare('SELECT * FROM staff_invites WHERE token_hash = ?').bind(await _sha256(token)).first()
  if (!inv || inv.used_at || inv.expires_at <= _now()) return null
  const store = await _storeInfo(db, inv.shop_code)
  if (!store || store.deleted_at || store.deletion_pending_at) return null
  return { inv, store }
}

/** GET /staff/invite?token= … 招待の中身（店の名前・名前・役割・期限） */
export async function handleInviteInfo(db, token) {
  const live = await _liveInvite(db, token)
  if (!live) return { _status: 404, code: 'invite_invalid', error: 'この招待は使えません（期限切れ・使用済み・取り消し）。管理者にもう一度出してもらってください' }
  return {
    storeName: live.store.store_name ?? null, shopCode: live.inv.shop_code,
    name: live.inv.name, role: live.inv.role, expiresAt: live.inv.expires_at,
  }
}

/** POST /staff/join { token, name, pin } … 申請。承認を受け取るための鍵を返す */
export async function handleStaffJoin(db, body) {
  const live = await _liveInvite(db, body?.token)
  if (!live) return { _status: 404, code: 'invite_invalid', error: 'この招待は使えません（期限切れ・使用済み・取り消し）。管理者にもう一度出してもらってください' }
  const { inv, store } = live
  const name = _normName(body?.name) || inv.name
  const pin = String(body?.pin ?? '')
  const bad = pinProblem(pin)
  if (bad) return { _status: 400, code: 'weak_pin', error: bad }
  const dup = await db.prepare(
    "SELECT name FROM staff WHERE shop_code = ? AND status IN ('pending','active','stopped')",
  ).bind(inv.shop_code).all()
  if ((dup.results ?? []).some(r => _nameKey(r.name) === _nameKey(name))) {
    return { _status: 409, code: 'name_taken', error: 'その名前は店ですでに使われています。名字＋名前など、見分けのつく名前にしてください' }
  }
  // 招待は1回きり。先に使用済みにしてから作る（同時に2回押されても1人だけ）
  const used = await db.prepare('UPDATE staff_invites SET used_at = ? WHERE id = ? AND used_at IS NULL').bind(_now(), inv.id).run()
  if (Number(used?.meta?.changes ?? 0) === 0) return { _status: 404, code: 'invite_invalid', error: 'この招待はもう使われています' }
  const id = 'st_' + _rand(8)
  const pendingKey = _rand(24)
  const now = _now()
  await db.prepare(`
    INSERT INTO staff (id, shop_code, name, role, pin_hash, status, pending_key_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).bind(id, inv.shop_code, name, inv.role, await _hashPin(pin), await _sha256(pendingKey), now, now).run()
  return { pendingKey, shopCode: inv.shop_code, storeName: store.store_name ?? null, name, staffId: id }
}

/**
 * GET /staff/pending?key= … 承認を待つ端末が聞きに来る。承認されたら1回だけトークンを渡す。
 */
export async function handleStaffPending(db, key) {
  if (typeof key !== 'string' || !/^[0-9a-f]{48}$/.test(key)) return { _status: 404, error: 'Not found' }
  const st = await db.prepare('SELECT * FROM staff WHERE pending_key_hash = ?').bind(await _sha256(key)).first()
  if (!st) return { status: 'gone' }
  if (st.status === 'pending') return { status: 'pending' }
  if (st.status !== 'active') return { status: st.status }
  await db.prepare('UPDATE staff SET pending_key_hash = NULL, last_seen_at = ?, updated_at = ? WHERE id = ?').bind(_now(), _now(), st.id).run()
  const store = await _storeInfo(db, st.shop_code)
  const token = await _issueToken(db, st.shop_code, st.id)
  return {
    status: 'active', token, shopCode: st.shop_code, storeName: store?.store_name ?? null,
    staff: _me(st), ...entitlement(store ?? {}),
  }
}

/** POST /auth/staff-login { shopCode, name, pin, deviceId } */
export async function handleStaffLogin(db, body) {
  const shopCode = String(body?.shopCode ?? '').toUpperCase().trim()
  const name = _normName(body?.name)
  const pin = String(body?.pin ?? '').replace(/\D/g, '')
  const device = String(body?.deviceId ?? '').slice(0, 64) || 'unknown'
  const generic = { _status: 401, error: '店舗コード・名前・暗証番号を確かめてください' }
  if (!shopCode || !name || !pin) return generic
  const store = await _storeInfo(db, shopCode)
  if (!store || store.deleted_at || store.deletion_pending_at) return generic
  const key = _nameKey(name)
  const since = new Date(Date.now() - LOGIN_WINDOW_MS).toISOString()
  const fails = await db.prepare(
    'SELECT COUNT(*) AS n FROM staff_login_attempts WHERE shop_code = ? AND staff_key = ? AND device_id = ? AND attempted_at > ?',
  ).bind(shopCode, key, device, since).first()
  if ((fails?.n ?? 0) >= LOGIN_MAX_FAILS) {
    return { _status: 429, error: '暗証番号を5回まちがえたため、15分止めています。急ぎのときは管理者に解除してもらってください' }
  }
  const { results } = await db.prepare("SELECT * FROM staff WHERE shop_code = ? AND status IN ('active','stopped','pending')").bind(shopCode).all()
  const st = (results ?? []).find(r => _nameKey(r.name) === key)
  const fail = async () => {
    await db.prepare('INSERT INTO staff_login_attempts (shop_code, staff_key, device_id, attempted_at) VALUES (?, ?, ?, ?)')
      .bind(shopCode, key, device, _now()).run().catch(() => {})
    return generic
  }
  if (!st || !st.pin_hash) return fail()
  const { ok } = await verifyPinHash(shopCode, pin, st.pin_hash)
  if (!ok) return fail()
  if (st.status === 'pending') return { _status: 403, code: 'pending', error: 'まだ管理者の承認を待っています' }
  if (st.status === 'stopped') return { _status: 403, code: 'stopped', error: 'このアカウントは止められています。管理者に確かめてください' }
  await db.prepare('DELETE FROM staff_login_attempts WHERE shop_code = ? AND staff_key = ? AND device_id = ?').bind(shopCode, key, device).run().catch(() => {})
  await db.prepare('UPDATE staff SET last_seen_at = ? WHERE id = ?').bind(_now(), st.id).run().catch(() => {})
  const token = await _issueToken(db, shopCode, st.id)
  return {
    token, shopCode, storeName: store.store_name ?? null,
    staff: _me(st), ...entitlement(store),
  }
}

/** POST /store/:code/staff/:id/unlock … 暗証番号の失敗で止まったのを解除（管理者） */
export async function handleStaffUnlock(db, request, code, id) {
  const { deny } = await _requireAdmin(db, request, code)
  if (deny) return deny
  const st = await db.prepare('SELECT name FROM staff WHERE id = ? AND shop_code = ?').bind(id, code).first()
  if (!st) return { _status: 404, error: 'スタッフが見つかりません' }
  await db.prepare('DELETE FROM staff_login_attempts WHERE shop_code = ? AND staff_key = ?').bind(code, _nameKey(st.name)).run()
  return { ok: true }
}

/** GET /auth/me … いまのトークンは誰か（役割の取り直し用） */
export async function handleMe(db, request) {
  const ctx = await authContext(db, request)
  if (!ctx) return { _status: 401, error: '認証が必要です' }
  return { shopCode: ctx.shopCode, role: ctx.role, staff: ctx.staffId ? { id: ctx.staffId, name: ctx.name, role: ctx.role, grants: ctx.grants } : null }
}

/**
 * 定期の掃除（毎時の cron）。プライバシーポリシーの保存期間と合わせる。
 * - 暗証番号の失敗記録: 判定に使う期間（15分）を過ぎたもの
 * - 招待: 期限（発行から10分）を過ぎて15分たったもの（使った・使わないに関わらず）
 * - 開いていた記録（段 2-5）: 90日より古いもの（店ごとの書き込みでも消すが、使われなくなった店の分をここで）
 */
export async function cleanupStaffRecords(db, nowMs = Date.now(), retentionMs = 15 * 60_000) {
  const cutoff = new Date(nowMs - retentionMs).toISOString()
  const old = new Date(nowMs - 90 * 86400_000).toISOString()
  await db.batch([
    db.prepare('DELETE FROM staff_login_attempts WHERE attempted_at <= ?').bind(cutoff),
    db.prepare('DELETE FROM staff_invites WHERE expires_at <= ?').bind(cutoff),
    db.prepare('DELETE FROM work_sessions WHERE last_seen_at < ?').bind(old),
  ])
}
