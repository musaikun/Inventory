// 暗証番号の総当たりを、アカウント単位で段階的に止める（オーナーとスタッフ・migration 0028）。
//
// 合格ライン（User 2026-10-13）:
//   ① 数十回程度で攻撃コストが急激に上がる … 5回ごとにロックし、ロックは 15分→30分→…→24時間と倍になる
//   ② IP を変えるだけでは突破できない       … 数えるのは「店×アカウント」。IP も端末IDも鍵にしない
//   ③ API を直接叩いても同じ制限            … サーバーだけで数える。送られてくる値（端末IDなど）で数え直させない
//   ④ 店のスタッフが同時に使っても影響しない … アカウントごとに数えるので、他の人の失敗や同じ Wi-Fi の影響を受けない
//   ＋ 同時リクエストですり抜けない          … 確かめる**前**に1回ぶんを1つの UPSERT で数え、ロック中なら何も通さない
//
// 見積もり（6桁の暗証番号＝約100万通り）: 最初の40回に約32時間かかり、以降は24時間に5回。
// 1年で試せるのは約1,900回（当たる見込み 約0.2%）。オーナーの4桁PIN（1万通り）では約19%になるので、
// PIN を長くするかは SEC-006 で別に決める。
import { securityEvent } from './securityLog.js'

export const GUARD_STEP          = 5                  // この回数ごとにロック
export const GUARD_BASE_LOCK_MIN = 15                 // 最初のロック
export const GUARD_MAX_LOCK_MIN  = 24 * 60            // ロックの上限
export const GUARD_DECAY_MS      = 7 * 86400_000      // 最後の試行からこれだけあいたら数え直す

export const OWNER_ACCOUNT = 'owner'
/** スタッフのアカウント。名前は正規化済み（staffHandler の _nameKey）を渡す */
export const staffAccount = nameKey => `staff:${nameKey}`

/** n 回目の試行のあとに掛けるロック（分）。0 ならロックしない（SQL と同じ式・テスト用） */
export function lockMinutesAfter(n) {
  if (!Number.isInteger(n) || n <= 0 || n % GUARD_STEP !== 0) return 0
  return Math.min(GUARD_MAX_LOCK_MIN, GUARD_BASE_LOCK_MIN * 2 ** Math.min(n / GUARD_STEP - 1, 7))
}

// 「今回が何回目か」。7日あいていれば 1 から数え直す。
// パラメータ: ?1 店舗コード ／ ?2 アカウント ／ ?3 今（epoch ms）／ ?4 数え直しの境（今 − 7日）
const N = 'CASE WHEN login_guard.last_at <= ?4 THEN 1 ELSE login_guard.fails + 1 END'
const RESERVE_SQL = `
  INSERT INTO login_guard (shop_code, account_key, fails, locked_until, last_at)
  VALUES (?1, ?2, 1, NULL, ?3)
  ON CONFLICT (shop_code, account_key) DO UPDATE SET
    fails        = ${N},
    locked_until = CASE WHEN (${N}) % ${GUARD_STEP} = 0
                     THEN ?3 + 60000 * min(${GUARD_MAX_LOCK_MIN}, ${GUARD_BASE_LOCK_MIN} << min((${N}) / ${GUARD_STEP} - 1, 7))
                     ELSE NULL END,
    last_at      = ?3
  WHERE login_guard.locked_until IS NULL OR login_guard.locked_until <= ?3
  RETURNING fails, locked_until`

/**
 * 1回ぶんの試行を数える（暗証番号を確かめる前に呼ぶ）。
 * @returns {Promise<{ ok: true, fails: number|null } | { ok: false, lockedUntil: number|null }>}
 *   ok:false はロック中（暗証番号を確かめずに 429 を返す）。
 *   表が無い・D1 障害のときは数えずに通す（レート制限はフェイルオープン・D-015）。
 */
export async function reserveLoginAttempt(db, shopCode, account, nowMs = Date.now()) {
  try {
    const row = await db.prepare(RESERVE_SQL)
      .bind(shopCode, account, nowMs, nowMs - GUARD_DECAY_MS)
      .first()
    if (row) return { ok: true, fails: Number(row.fails) }
    const cur = await db.prepare('SELECT locked_until FROM login_guard WHERE shop_code = ? AND account_key = ?')
      .bind(shopCode, account).first()
    return { ok: false, lockedUntil: cur?.locked_until ?? null }
  } catch (e) {
    console.error('[loginGuard] reserve failed (fail-open):', e?.message ?? e)
    securityEvent('login_guard_unavailable', { shop: shopCode })
    return { ok: true, fails: null }
  }
}

/** 正しい暗証番号だったとき・管理者が解除したときに、数えた回数とロックを消す */
export async function clearLoginGuard(db, shopCode, account) {
  try {
    await db.prepare('DELETE FROM login_guard WHERE shop_code = ? AND account_key = ?').bind(shopCode, account).run()
  } catch (e) {
    console.error('[loginGuard] clear failed:', e?.message ?? e)
  }
}

/** ロック中の案内（あと何分）。分からなければ一般的な文 */
export function lockedMessage(lockedUntil, nowMs = Date.now()) {
  const min = Number.isFinite(Number(lockedUntil)) ? Math.max(1, Math.ceil((Number(lockedUntil) - nowMs) / 60000)) : null
  if (!min) return '暗証番号を続けて間違えたため、しばらくログインを止めています。時間をおいてお試しください'
  const wait = min >= 60 ? `${Math.ceil(min / 60)}時間` : `${min}分`
  return `暗証番号を続けて間違えたため、ログインを止めています。あと${wait}ほどでお試しいただけます`
}

/** 毎時の cron（staffHandler の cleanupStaffRecords の batch）。最後の試行から7日たち、ロックも切れた行を消す */
export function cleanupLoginGuardStatement(db, nowMs = Date.now()) {
  return db.prepare('DELETE FROM login_guard WHERE last_at <= ? AND (locked_until IS NULL OR locked_until <= ?)')
    .bind(nowMs - GUARD_DECAY_MS, nowMs)
}
