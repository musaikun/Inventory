// ── IP 単位レート制限（店舗コード横断のログイン総当たり・ルームコード探索対策）──
// kind: 'login'（ログイン失敗）| 'probe'（存在しない店舗/ルームへのアクセス）

import { _now } from './workerUtils.js'
import { IP_RATE_WINDOW_MS, IP_MAX_FAILS } from './constants.js'

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown'
}

// フェイルオープン: レート制限の失敗（テーブル未作成・D1障害）でアプリ本体を殺さない
export async function isIpBlocked(db, ip, kind) {
  try {
    const since = new Date(Date.now() - IP_RATE_WINDOW_MS).toISOString()
    const row = await db.prepare(
      'SELECT COUNT(*) AS n FROM ip_attempts WHERE ip = ? AND kind = ? AND attempted_at > ?'
    ).bind(ip, kind, since).first()
    return (row?.n ?? 0) >= IP_MAX_FAILS
  } catch (e) {
    console.error('[rateLimiter] isIpBlocked failed (fail-open):', e?.message ?? e)
    return false
  }
}

export async function recordIpFail(db, ip, kind) {
  try {
    const before = new Date(Date.now() - IP_RATE_WINDOW_MS).toISOString()
    await db.prepare('DELETE FROM ip_attempts WHERE ip = ? AND kind = ? AND attempted_at <= ?')
      .bind(ip, kind, before).run()
    await db.prepare('INSERT INTO ip_attempts (ip, kind, attempted_at) VALUES (?, ?, ?)')
      .bind(ip, kind, _now()).run()
  } catch (e) {
    console.error('[rateLimiter] recordIpFail failed (fail-open):', e?.message ?? e)
  }
}
