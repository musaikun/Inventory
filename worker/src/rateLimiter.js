// ── IP 単位レート制限（店舗コード横断のログイン総当たり・ルームコード探索対策）──
// kind: 'login'（ログイン失敗）| 'probe'（存在しない店舗/ルームへのアクセス）

import { _now } from './workerUtils.js'
import { IP_RATE_WINDOW_MS, IP_MAX_FAILS } from './constants.js'

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown'
}

export async function isIpBlocked(db, ip, kind) {
  const since = new Date(Date.now() - IP_RATE_WINDOW_MS).toISOString()
  const row = await db.prepare(
    'SELECT COUNT(*) AS n FROM ip_attempts WHERE ip = ? AND kind = ? AND attempted_at > ?'
  ).bind(ip, kind, since).first()
  return (row?.n ?? 0) >= IP_MAX_FAILS
}

export async function recordIpFail(db, ip, kind) {
  const before = new Date(Date.now() - IP_RATE_WINDOW_MS).toISOString()
  await db.prepare('DELETE FROM ip_attempts WHERE ip = ? AND kind = ? AND attempted_at <= ?')
    .bind(ip, kind, before).run()
  await db.prepare('INSERT INTO ip_attempts (ip, kind, attempted_at) VALUES (?, ?, ?)')
    .bind(ip, kind, _now()).run()
}
