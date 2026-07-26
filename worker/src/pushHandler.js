import webpush from 'web-push'
import { cleanupExpiredAccountDeletionRecords } from './accountDeletion.js'
import { cleanupExpiredSecurityRecords } from './rateLimiter.js'

const MAX_PUSH_ENDPOINT_CHARS = 2048

function _decodeBase64Url(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return null
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return null
  const unpadded = value.replace(/=+$/, '')
  if (unpadded.length % 4 === 1) return null
  try {
    const base64 = unpadded.replace(/-/g, '+').replace(/_/g, '/')
      + '='.repeat((4 - (unpadded.length % 4)) % 4)
    return Uint8Array.from(atob(base64), char => char.charCodeAt(0))
  } catch (_) {
    return null
  }
}

function _normalizePushEndpoint(value) {
  if (typeof value !== 'string' || value !== value.trim() || value.length === 0 || value.length > MAX_PUSH_ENDPOINT_CHARS) {
    return null
  }
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()
    const isIpLiteral = hostname.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)
    if (
      url.protocol !== 'https:' || url.username || url.password || url.hash
      || (url.port && url.port !== '443')
      || !hostname.includes('.') || hostname === 'localhost' || hostname.endsWith('.local') || isIpLiteral
    ) return null
    return url.href
  } catch (_) {
    return null
  }
}

function _validatePushSubscription(sub) {
  if (!sub || typeof sub !== 'object' || Array.isArray(sub)) return null
  const endpoint = _normalizePushEndpoint(sub.endpoint)
  const keys = sub.keys
  if (!endpoint || !keys || typeof keys !== 'object' || Array.isArray(keys)) return null
  const publicKey = _decodeBase64Url(keys.p256dh)
  const authSecret = _decodeBase64Url(keys.auth)
  // Push API / RFC 8291: uncompressed P-256 public key (65 octets, 0x04) + 16-octet auth secret.
  if (!publicKey || publicKey.length !== 65 || publicKey[0] !== 0x04) return null
  if (!authSecret || authSecret.length !== 16) return null
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth }
}

function _initVapid(env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false
  webpush.setVapidDetails(
    env.VAPID_SUBJECT || 'mailto:support@tanaoro.com',
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
  )
  return true
}

async function _send(env, sub, payload) {
  if (!_initVapid(env)) return
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 24 }
    )
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run()
    }
  }
}

export async function savePushSubscription(db, shopCode, sub) {
  const validated = _validatePushSubscription(sub)
  if (!validated) {
    return { _status: 400, code: 'invalid_subscription', error: 'Push購読情報が不正です' }
  }
  const owner = await db.prepare(
    'SELECT shop_code FROM push_subscriptions WHERE endpoint = ?'
  ).bind(validated.endpoint).first()
  if (owner && owner.shop_code !== shopCode) {
    return { _status: 409, code: 'subscription_conflict', error: 'このPush購読は別の店舗に登録されています' }
  }

  const result = await db.prepare(`
    INSERT INTO push_subscriptions (shop_code, endpoint, p256dh, auth)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      p256dh     = excluded.p256dh,
      auth       = excluded.auth,
      updated_at = datetime('now')
    WHERE push_subscriptions.shop_code = excluded.shop_code
  `).bind(shopCode, validated.endpoint, validated.p256dh, validated.auth).run()
  if (Number(result?.meta?.changes ?? 1) === 0) {
    return { _status: 409, code: 'subscription_conflict', error: 'このPush購読は別の店舗に登録されています' }
  }
  return { ok: true }
}

export async function deletePushSubscription(db, shopCode, endpoint) {
  const normalized = _normalizePushEndpoint(endpoint)
  if (!normalized) {
    return { _status: 400, code: 'invalid_subscription', error: 'Push購読情報が不正です' }
  }
  await db.prepare('DELETE FROM push_subscriptions WHERE shop_code = ? AND endpoint = ?')
    .bind(shopCode, normalized).run()
  return { ok: true }
}

export async function handleCron(env) {
  if (!env.DB) return
  try {
    await cleanupExpiredAccountDeletionRecords(env.DB)
  } catch (error) {
    console.error('[account-deletion] scheduled cleanup failed:', error?.message ?? error)
  }
  try {
    await cleanupExpiredSecurityRecords(env.DB)
  } catch (error) {
    console.error(JSON.stringify({
      event: 'security-record-cleanup-failed',
      error: error?.message ?? String(error),
    }))
  }
  if (!env.VAPID_PUBLIC_KEY) return

  const now  = new Date()
  // JST = UTC+9
  const jst  = new Date(now.getTime() + 9 * 3600 * 1000)
  const jstDay   = jst.getUTCDate()
  const jstMonth = jst.getUTCMonth() + 1
  const jstYear  = jst.getUTCFullYear()

  const lastDayOfMonth = new Date(jstYear, jstMonth, 0).getDate()
  const isMonthEnd     = jstDay === lastDayOfMonth

  const { results: subs } = await env.DB.prepare(`
    SELECT ps.shop_code, ps.endpoint, ps.p256dh, ps.auth,
           (SELECT MAX(ended_at) FROM sessions WHERE shop_code = ps.shop_code AND status = 'completed') AS last_completed_at,
           s.created_at AS store_created_at
    FROM push_subscriptions ps
    LEFT JOIN stores s ON s.shop_code = ps.shop_code
  `).all()

  for (const sub of (subs ?? [])) {
    if (isMonthEnd) {
      await _send(env, sub, {
        title: 'タナオロ',
        body:  '本日が月末です。タナオロで棚卸を開始しましょう📋',
        tag:   'month-end',
        url:   '/',
      })
      continue
    }

    const lastAt      = sub.last_completed_at ? new Date(sub.last_completed_at) : null
    const createdAt   = sub.store_created_at  ? new Date(sub.store_created_at)  : null
    const daysSinceLast   = lastAt    ? Math.floor((now - lastAt)    / 86400000) : null
    const daysSinceCreate = createdAt ? Math.floor((now - createdAt) / 86400000) : null

    if (!lastAt && daysSinceCreate === 7) {
      await _send(env, sub, {
        title: 'タナオロ',
        body:  'タナオロを試してみましょう✨ 品目リストがなくても今すぐ棚卸を始められます',
        tag:   'onboarding',
        url:   '/',
      })
      continue
    }

    if (daysSinceLast === 25) {
      await _send(env, sub, {
        title: 'タナオロ',
        body:  '今月の棚卸はもうすぐです📋 タナオロで棚卸を始めましょう',
        tag:   'reminder',
        url:   '/',
      })
    } else if (daysSinceLast === 32) {
      await _send(env, sub, {
        title: 'タナオロ',
        body:  '棚卸が遅れています⚠️ 前回から32日が経ちました',
        tag:   'reminder',
        url:   '/',
      })
    }
  }

  // 途中セッション再開通知。
  // D1 sessionsに最終操作時刻はないため、正として保存されるstarted_atを基準にする。
  // 開始から24時間超・7日以内のactive sessionだけを対象にする。
  const { results: stale } = await env.DB.prepare(`
    SELECT s.shop_code, ps.endpoint, ps.p256dh, ps.auth
    FROM sessions s
    JOIN push_subscriptions ps ON ps.shop_code = s.shop_code
    WHERE s.status = 'active'
      AND s.deleted_at IS NULL
      AND s.started_at < datetime('now', '-24 hours')
      AND s.started_at > datetime('now', '-7 days')
  `).all()

  for (const row of (stale ?? [])) {
    await _send(env, row, {
      title: 'タナオロ',
      body:  '棚卸が途中のままです🔖 続きからすぐ再開できます',
      tag:   'stale-session',
      url:   '/',
    })
  }
}
