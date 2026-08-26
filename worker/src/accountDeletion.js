import { extractBearerToken, verifyPinHash } from './authHandler.js'
import {
  ACCOUNT_DELETION_RETENTION_MS,
  LOGIN_MAX_FAILS,
  LOGIN_WINDOW_MS,
  MAX_TOKEN_LEN,
} from './constants.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function deletionUnavailable() {
  return {
    _status: 503,
    code: 'deletion_temporarily_unavailable',
    error: 'アカウントを削除できませんでした。同じ画面から再試行してください',
    retryable: true,
  }
}

function deletionSuccess(requestId, deletedAt, alreadyDeleted) {
  return {
    ok: true,
    status: 'deleted',
    requestId,
    deletedAt,
    alreadyDeleted,
  }
}

async function findActiveReceipt(db, requestId, nowIso) {
  return db.prepare(`
    SELECT request_id, completed_at
    FROM account_deletion_receipts
    WHERE request_id = ? AND expires_at > ?
  `).bind(requestId, nowIso).first()
}

async function loadDeletionIdentity(db, token) {
  return db.prepare(`
    SELECT t.shop_code, s.pin_hash, s.deletion_pending_at,
           s.deletion_request_id, s.deleted_at
    FROM auth_tokens t
    JOIN stores s ON s.shop_code = t.shop_code
    WHERE t.token = ? AND t.expires_at > datetime('now')
  `).bind(token).first()
}

async function checkPinRateLimit(db, shopCode, nowMs) {
  const since = new Date(nowMs - LOGIN_WINDOW_MS).toISOString()
  const row = await db.prepare(`
    SELECT COUNT(*) AS n
    FROM login_attempts
    WHERE shop_code = ? AND attempted_at > ?
  `).bind(shopCode, since).first()
  return (row?.n ?? 0) >= LOGIN_MAX_FAILS
}

async function markDeletionPending(db, shopCode, requestId, pendingAt) {
  return db.prepare(`
    UPDATE stores
    SET deletion_pending_at = ?, deletion_request_id = ?
    WHERE shop_code = ?
      AND deleted_at IS NULL
      AND (deletion_pending_at IS NULL OR deletion_request_id = ?)
  `).bind(pendingAt, requestId, shopCode, requestId).run()
}

function deletionStatements(db, shopCode, requestId, completedAt, expiresAt) {
  return [
    db.prepare('DELETE FROM inventory_lines WHERE shop_code = ?').bind(shopCode),
    db.prepare('DELETE FROM sessions WHERE shop_code = ?').bind(shopCode),
    db.prepare('DELETE FROM order_lines WHERE shop_code = ?').bind(shopCode),
    db.prepare('DELETE FROM orders WHERE shop_code = ?').bind(shopCode),
    db.prepare('DELETE FROM movement_lines WHERE shop_code = ?').bind(shopCode),
    db.prepare('DELETE FROM movements WHERE shop_code = ?').bind(shopCode),
    db.prepare('DELETE FROM item_par_levels WHERE shop_code = ?').bind(shopCode),
    db.prepare('DELETE FROM store_history WHERE shop_code = ?').bind(shopCode),
    // 過去棚卸取込の要求台帳（migration 0015）と棚卸完了のclaim（migration 0016）。
    // どちらも店舗の業務データなので削除範囲に含める（DATA-002 §6）。
    db.prepare('DELETE FROM import_batch_requests WHERE shop_code = ?').bind(shopCode),
    db.prepare('DELETE FROM session_completions WHERE shop_code = ?').bind(shopCode),
    // 操作ログ（migration 0017）。誰が何を変えたかの記録も店舗の業務データ
    db.prepare('DELETE FROM session_audit WHERE shop_code = ?').bind(shopCode),
    db.prepare('DELETE FROM store_inventory WHERE shop_code = ?').bind(shopCode),
    db.prepare('DELETE FROM store_configs WHERE shop_code = ?').bind(shopCode),
    db.prepare('DELETE FROM push_subscriptions WHERE shop_code = ?').bind(shopCode),
    db.prepare('DELETE FROM login_attempts WHERE shop_code = ?').bind(shopCode),
    db.prepare('DELETE FROM auth_tokens WHERE shop_code = ?').bind(shopCode),
    db.prepare(`
      UPDATE stores
      SET store_name = NULL,
          pin_hash = NULL,
          active_room = NULL,
          plan = 'free',
          created_at = ?,
          updated_at = ?,
          deletion_pending_at = NULL,
          deletion_request_id = NULL,
          deleted_at = ?
      WHERE shop_code = ?
        AND deletion_request_id = ?
        AND deleted_at IS NULL
    `).bind(completedAt, completedAt, completedAt, shopCode, requestId),
    db.prepare(`
      INSERT INTO account_deletion_receipts (request_id, completed_at, expires_at)
      SELECT ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM stores
        WHERE shop_code = ?
          AND deleted_at = ?
          AND pin_hash IS NULL
          AND deletion_pending_at IS NULL
      )
      ON CONFLICT(request_id) DO NOTHING
    `).bind(requestId, completedAt, expiresAt, shopCode, completedAt),
  ]
}

// DELETE /auth/account
// purgeRooms(shopCode) must close and delete both stock/order Durable Objects.
export async function handleAccountDelete(db, request, body = {}, purgeRooms) {
  const requestId = typeof body?.requestId === 'string' ? body.requestId.trim() : ''
  if (!UUID_PATTERN.test(requestId)) {
    return { _status: 400, code: 'invalid_request', error: 'requestIdが無効です' }
  }

  const now = new Date()
  const nowIso = now.toISOString()
  try {
    const receipt = await findActiveReceipt(db, requestId, nowIso)
    if (receipt) return deletionSuccess(requestId, receipt.completed_at, true)
  } catch (error) {
    console.error('[account-deletion] receipt lookup failed:', error?.message ?? error)
    return deletionUnavailable()
  }

  const pin = typeof body?.pin === 'string' ? body.pin : ''
  const confirmation = typeof body?.confirmation === 'string' ? body.confirmation.trim() : ''
  if (!/^\d{4}$/.test(pin) || !confirmation) {
    return { _status: 400, code: 'invalid_request', error: 'PINと店舗コードを確認してください' }
  }

  const token = extractBearerToken(request).slice(0, MAX_TOKEN_LEN)
  let identity
  try {
    identity = await loadDeletionIdentity(db, token)
  } catch (error) {
    console.error('[account-deletion] identity lookup failed:', error?.message ?? error)
    return deletionUnavailable()
  }
  if (!identity || identity.deleted_at || !identity.pin_hash) {
    return { _status: 401, code: 'reauthentication_failed', error: '再認証に失敗しました' }
  }

  const shopCode = identity.shop_code
  if (confirmation !== shopCode) {
    return { _status: 400, code: 'confirmation_mismatch', error: '店舗コードが一致しません' }
  }
  if (identity.deletion_pending_at && identity.deletion_request_id !== requestId) {
    return {
      _status: 409,
      code: 'deletion_in_progress',
      error: '別の削除処理が進行中です',
      retryable: false,
    }
  }

  try {
    if (await checkPinRateLimit(db, shopCode, now.getTime())) {
      return {
        _status: 429,
        code: 'too_many_attempts',
        error: '試行回数が多すぎます。15分ほど待ってから再度お試しください',
      }
    }

    const pinResult = await verifyPinHash(shopCode, pin, identity.pin_hash)
    if (!pinResult.ok) {
      await db.prepare('INSERT INTO login_attempts (shop_code, attempted_at) VALUES (?, ?)')
        .bind(shopCode, nowIso).run()
      return { _status: 401, code: 'reauthentication_failed', error: '再認証に失敗しました' }
    }

    const marker = await markDeletionPending(db, shopCode, requestId, nowIso)
    if (marker?.success !== true || marker?.meta?.changes !== 1) {
      const current = await db.prepare(`
        SELECT deletion_pending_at, deletion_request_id, deleted_at
        FROM stores WHERE shop_code = ?
      `).bind(shopCode).first()
      if (current?.deletion_pending_at && current.deletion_request_id !== requestId) {
        return {
          _status: 409,
          code: 'deletion_in_progress',
          error: '別の削除処理が進行中です',
          retryable: false,
        }
      }
      return deletionUnavailable()
    }
  } catch (error) {
    console.error('[account-deletion] reauthentication or marker failed:', error?.message ?? error)
    return deletionUnavailable()
  }

  try {
    await purgeRooms(shopCode)
  } catch (error) {
    console.error('[account-deletion] Durable Object purge failed:', error?.message ?? error)
    return deletionUnavailable()
  }

  const completedAt = new Date().toISOString()
  const expiresAt = new Date(new Date(completedAt).getTime() + ACCOUNT_DELETION_RETENTION_MS).toISOString()
  try {
    const statements = deletionStatements(db, shopCode, requestId, completedAt, expiresAt)
    const results = await db.batch(statements)
    if (!results.every(result => result?.success === true)) throw new Error('D1 batch returned an unsuccessful result')

    const storeUpdate = results[results.length - 2]
    if (storeUpdate?.meta?.changes !== 1) {
      const receipt = await findActiveReceipt(db, requestId, completedAt)
      if (receipt) return deletionSuccess(requestId, receipt.completed_at, true)
      throw new Error('account tombstone was not written')
    }
  } catch (error) {
    console.error('[account-deletion] D1 deletion batch failed:', error?.message ?? error)
    return deletionUnavailable()
  }

  return deletionSuccess(requestId, completedAt, false)
}

export async function cleanupExpiredAccountDeletionRecords(db, now = new Date()) {
  const nowDate = now instanceof Date ? now : new Date(now)
  if (!Number.isFinite(nowDate.getTime())) throw new TypeError('Invalid cleanup time')
  const nowIso = nowDate.toISOString()
  const tombstoneCutoff = new Date(nowDate.getTime() - ACCOUNT_DELETION_RETENTION_MS).toISOString()

  const results = await db.batch([
    db.prepare('DELETE FROM account_deletion_receipts WHERE expires_at <= ?').bind(nowIso),
    db.prepare(`
      DELETE FROM stores
      WHERE deleted_at IS NOT NULL
        AND deleted_at <= ?
        AND deletion_pending_at IS NULL
    `).bind(tombstoneCutoff),
  ])
  if (!results.every(result => result?.success === true)) {
    throw new Error('Account deletion cleanup failed')
  }
  return {
    receiptsDeleted: results[0]?.meta?.changes ?? 0,
    tombstonesDeleted: results[1]?.meta?.changes ?? 0,
  }
}
