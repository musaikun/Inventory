// ── IP 単位レート制限（店舗コード横断のログイン総当たり・ルームコード探索対策）──
// kind: 'login'（ログイン失敗）| 'probe'（存在しない店舗/ルームへのアクセス）| 'register'（新規登録・成否を問わず）

import { _now } from './workerUtils.js'
import { securityEvent } from './securityLog.js'
import {
  IP_RATE_WINDOW_MS, IP_MAX_FAILS, SECURITY_ATTEMPT_RETENTION_MS, REGISTER_WINDOW_MS, REGISTER_MAX_PER_IP,
} from './constants.js'

// kind ごとの窓と上限（無い kind は既定の 15分・30回）
const KIND_LIMITS = {
  register: { windowMs: REGISTER_WINDOW_MS, max: REGISTER_MAX_PER_IP },
}
function _limit(kind) {
  return KIND_LIMITS[kind] ?? { windowMs: IP_RATE_WINDOW_MS, max: IP_MAX_FAILS }
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown'
}

// フェイルオープン: レート制限の失敗（テーブル未作成・D1障害）でアプリ本体を殺さない
export async function isIpBlocked(db, ip, kind) {
  try {
    const { windowMs, max } = _limit(kind)
    const since = new Date(Date.now() - windowMs).toISOString()
    const row = await db.prepare(
      'SELECT COUNT(*) AS n FROM ip_attempts WHERE ip = ? AND kind = ? AND attempted_at > ?'
    ).bind(ip, kind, since).first()
    const blocked = (row?.n ?? 0) >= max
    if (blocked) securityEvent('ip_blocked', { ip, kind })
    return blocked
  } catch (e) {
    console.error('[rateLimiter] isIpBlocked failed (fail-open):', e?.message ?? e)
    return false
  }
}

export async function recordIpFail(db, ip, kind) {
  try {
    const before = new Date(Date.now() - _limit(kind).windowMs).toISOString()
    await db.prepare('DELETE FROM ip_attempts WHERE ip = ? AND kind = ? AND attempted_at <= ?')
      .bind(ip, kind, before).run()
    await db.prepare('INSERT INTO ip_attempts (ip, kind, attempted_at) VALUES (?, ?, ?)')
      .bind(ip, kind, _now()).run()
    securityEvent('ip_attempt', { ip, kind })
  } catch (e) {
    console.error('[rateLimiter] recordIpFail failed (fail-open):', e?.message ?? e)
  }
}

// 全account/IPの期限切れsecurity recordを日次cronから削除する。
// per-key cleanupだけでは、そのkeyが再利用されない場合に古いrowが残り続けるため必要。
export async function cleanupExpiredSecurityRecords(db, now = _now()) {
  const nowDate = now instanceof Date ? now : new Date(now)
  if (!Number.isFinite(nowDate.getTime())) throw new TypeError('Invalid cleanup time')
  const cutoff = new Date(nowDate.getTime() - SECURITY_ATTEMPT_RETENTION_MS).toISOString()
  const results = await db.batch([
    db.prepare('DELETE FROM login_attempts WHERE attempted_at <= ?').bind(cutoff),
    db.prepare('DELETE FROM ip_attempts WHERE attempted_at <= ?').bind(cutoff),
  ])
  if (!results.every(result => result?.success === true)) {
    throw new Error('Security record cleanup failed')
  }
  return {
    loginAttemptsDeleted: results[0]?.meta?.changes ?? 0,
    ipAttemptsDeleted: results[1]?.meta?.changes ?? 0,
    cutoff,
  }
}
