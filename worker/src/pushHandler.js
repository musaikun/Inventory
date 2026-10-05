import webpush from 'web-push'
import { cleanupExpiredAccountDeletionRecords } from './accountDeletion.js'
import { cleanupExpiredSecurityRecords } from './rateLimiter.js'
import { normalizePrefs, parsePrefs, planNotifications, jstParts, SENT_KEEP_DAYS } from './pushPlan.js'

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
  if (!_initVapid(env)) return false
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 24 }
    )
    return true
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run()
    }
    return false
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

  // 通知の設定（端末ごと）。送られてこなければ今の設定を残す（古い端末は送らない）
  const prefsJson = sub.prefs !== undefined ? JSON.stringify(normalizePrefs(sub.prefs)) : null
  const result = await db.prepare(`
    INSERT INTO push_subscriptions (shop_code, endpoint, p256dh, auth, prefs_json)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      p256dh     = excluded.p256dh,
      auth       = excluded.auth,
      prefs_json = COALESCE(excluded.prefs_json, push_subscriptions.prefs_json),
      updated_at = datetime('now')
    WHERE push_subscriptions.shop_code = excluded.shop_code
  `).bind(shopCode, validated.endpoint, validated.p256dh, validated.auth, prefsJson).run()
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
  await db.prepare('DELETE FROM push_sent WHERE endpoint = ? AND NOT EXISTS (SELECT 1 FROM push_subscriptions WHERE endpoint = ?)')
    .bind(normalized, normalized).run()
  return { ok: true }
}

/** PUT /store/:code/push/prefs … この端末の通知の設定を変える（購読済みの端末だけ） */
export async function savePushPrefs(db, shopCode, body) {
  const endpoint = _normalizePushEndpoint(body?.endpoint)
  if (!endpoint) return { _status: 400, code: 'invalid_subscription', error: 'Push購読情報が不正です' }
  const prefs = normalizePrefs(body?.prefs)
  const result = await db.prepare('UPDATE push_subscriptions SET prefs_json = ?, updated_at = datetime(\'now\') WHERE shop_code = ? AND endpoint = ?')
    .bind(JSON.stringify(prefs), shopCode, endpoint).run()
  if (Number(result?.meta?.changes ?? 0) === 0) {
    return { _status: 404, code: 'not_subscribed', error: 'この端末は通知を受け取る設定になっていません' }
  }
  return { ok: true, prefs }
}

/** POST /store/:code/push/test … この端末へ試しの通知を1件送る */
export async function sendTestPush(env, shopCode, body) {
  const endpoint = _normalizePushEndpoint(body?.endpoint)
  if (!endpoint) return { _status: 400, code: 'invalid_subscription', error: 'Push購読情報が不正です' }
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return { _status: 503, code: 'push_not_configured', error: '通知を送る準備がサーバーでできていません' }
  }
  const sub = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE shop_code = ? AND endpoint = ?')
    .bind(shopCode, endpoint).first()
  if (!sub) return { _status: 404, code: 'not_subscribed', error: 'この端末は通知を受け取る設定になっていません' }
  const ok = await _send(env, sub, { title: 'タナオロ', body: '通知のテストです。この端末で受け取れています🔔', tag: 'test', url: '/' })
  return ok ? { ok: true } : { _status: 502, code: 'push_failed', error: '通知を送れませんでした' }
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
  try {
    await env.DB.prepare('DELETE FROM push_sent WHERE sent_at < datetime(\'now\', ?)').bind(`-${SENT_KEEP_DAYS} days`).run()
  } catch (error) {
    console.warn('[push] sent-mark cleanup failed:', error?.message ?? error)
  }
  if (!env.VAPID_PUBLIC_KEY) return
  try {
    await sendScheduledPushes(env, new Date())
  } catch (error) {
    console.error('[push] scheduled send failed:', error?.message ?? error)
  }
}

/**
 * 毎時の通知（User決定 2026-10-05）。端末ごとの設定（prefs_json）で、いま送るものを決めて送る。
 * 同じ通知は push_sent の印で一度だけ。店舗のデータは、その店に今送るものがありそうなときだけ読む。
 */
export async function sendScheduledPushes(env, now) {
  const db = env.DB
  const t = jstParts(now)
  const { results: rows } = await db.prepare(
    'SELECT shop_code, endpoint, p256dh, auth, prefs_json FROM push_subscriptions',
  ).all()
  const byShop = new Map()
  for (const r of rows ?? []) {
    const prefs = parsePrefs(r.prefs_json)
    if (prefs.hour !== t.hour && !prefs.orderDeadline.on) continue
    if (!byShop.has(r.shop_code)) byShop.set(r.shop_code, [])
    byShop.get(r.shop_code).push({ sub: r, prefs })
  }
  const until = new Date(Date.UTC(t.y, t.m - 1, t.d + 7)).toISOString().slice(0, 10)
  for (const [shop, list] of byShop) {
    const daily = list.some(x => x.prefs.hour === t.hour)
    const order = list.some(x => x.prefs.orderDeadline.on)
    let lastCompletedAt = null, staleSessionIds = [], openTasks = [], schedules = []
    if (daily) {
      const last = await db.prepare(
        "SELECT MAX(ended_at) AS at FROM sessions WHERE shop_code = ? AND status = 'completed' AND type = 'stock' AND deleted_at IS NULL AND import_batch_id IS NULL",
      ).bind(shop).first()
      lastCompletedAt = last?.at ?? null
      const { results: stale } = await db.prepare(`
        SELECT id FROM sessions
        WHERE shop_code = ? AND status = 'active' AND deleted_at IS NULL
          AND started_at < datetime('now', '-24 hours') AND started_at > datetime('now', '-7 days')
      `).bind(shop).all()
      staleSessionIds = (stale ?? []).map(r => r.id)
      const { results: tasks } = await db.prepare(`
        SELECT task_date, body FROM tasks
        WHERE shop_code = ? AND task_date >= ? AND task_date <= ? AND done_at IS NULL AND deleted_at IS NULL
        ORDER BY created_at
      `).bind(shop, t.key, until).all()
      openTasks = (tasks ?? []).map(r => ({ date: r.task_date, text: r.body }))
    }
    if (order) {
      const cfg = await db.prepare('SELECT config_json FROM store_configs WHERE shop_code = ?').bind(shop).first()
      try { schedules = JSON.parse(cfg?.config_json ?? '{}')?.orderSchedules ?? [] } catch (_) { schedules = [] }
      if (!Array.isArray(schedules)) schedules = []
    }
    for (const { sub, prefs } of list) {
      const plan = planNotifications({ now, prefs, lastCompletedAt, staleSessionIds, openTasks, schedules })
      for (const n of plan) {
        const mark = await db.prepare('INSERT OR IGNORE INTO push_sent (endpoint, sent_key) VALUES (?, ?)')
          .bind(sub.endpoint, n.key).run()
        if (Number(mark?.meta?.changes ?? 0) === 0) continue   // もう送った
        await _send(env, sub, n.payload)
      }
    }
  }
}

/**
 * やることが追加されたことを、同じ店舗の他の端末へ知らせる（User決定 2026-10-04）。
 * 追加した端末の購読（exceptEndpoint）には送らない。通知の許可を出していない端末には届かない。
 */
export async function notifyTaskAdded(env, shopCode, task, exceptEndpoint = '') {
  if (!env.DB || !env.VAPID_PUBLIC_KEY) return
  const { results: subs } = await env.DB.prepare(
    'SELECT endpoint, p256dh, auth, prefs_json FROM push_subscriptions WHERE shop_code = ?',
  ).bind(shopCode).all()
  const who = task?.createdBy ? `${task.createdBy}さん` : 'だれか'
  const [, m, d] = String(task?.date ?? '').split('-').map(Number)
  const when = m && d ? `${m}/${d} ` : ''
  for (const sub of (subs ?? [])) {
    if (exceptEndpoint && sub.endpoint === exceptEndpoint) continue
    if (!parsePrefs(sub.prefs_json).taskAdded.on) continue
    await _send(env, sub, {
      title: 'タナオロ',
      body:  `${who}がやることを追加しました：${when}${task?.text ?? ''}`,
      tag:   'task',
      url:   '/',
    })
  }
}
