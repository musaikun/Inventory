// 営業日（business date）
// 飲食店は深夜に閉店し、日付が変わってから在庫を登録することがある。
// 切替時刻（既定 朝5:00）より前の登録は「前営業日」として扱う。
// これにより月末判定・日次差分が実態（営業日）に一致する。
// ローカル時刻ベース（当面は端末＝店舗のタイムゾーン＝JSTを前提）。

export const DEFAULT_CUTOVER_HOUR = 5

function _ymd(d) {
  const y  = d.getFullYear()
  const m  = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/**
 * 記録時刻から営業日（YYYY-MM-DD）を求める。
 * @param {Date|string|number} ts        記録時刻（savedAt 等）
 * @param {number}             cutoverHour 営業日切替時刻（0-23、既定5）
 * @returns {string|null}
 */
export function businessDate(ts, cutoverHour = DEFAULT_CUTOVER_HOUR) {
  const d = ts instanceof Date ? new Date(ts.getTime()) : new Date(ts)
  if (isNaN(d.getTime())) return null
  if (d.getHours() < cutoverHour) d.setDate(d.getDate() - 1)
  return _ymd(d)
}

/** 'YYYY-MM-DD' → 'YYYY-MM' */
export function monthKeyOf(dateStr) {
  return typeof dateStr === 'string' ? dateStr.slice(0, 7) : null
}

/**
 * スナップショット群から「各月の月末在庫」を自動指定する。
 * ルール: 営業日ベースで、その月に登録された最後のカウントを月末在庫とする
 *         （3日猶予などは設けない。深夜またぎは営業日で吸収される）。
 * overrides で個別月を手動上書きできる。
 *
 * @param {Array}  snapshots  { date, savedAt, sessionId } を持つ配列
 * @param {Object} overrides  { 'YYYY-MM': snapshotDate } 手動指定
 * @param {number} cutoverHour
 * @returns {Object} { 'YYYY-MM': { date, bizDate, sessionId, manual } }
 */
export function designateMonthEnds(snapshots, overrides = {}, cutoverHour = DEFAULT_CUTOVER_HOUR) {
  const byMonth = new Map()
  for (const s of snapshots || []) {
    const biz = businessDate(s.savedAt ?? s.date, cutoverHour) || s.date || null
    if (!biz) continue
    const mk = monthKeyOf(biz)
    const ts = new Date(s.savedAt ?? s.date).getTime() || 0
    const cur = byMonth.get(mk)
    // 営業日が新しい方を採用。同一営業日なら実登録時刻が後のものを優先。
    if (!cur || biz > cur.bizDate || (biz === cur.bizDate && ts > cur.ts)) {
      byMonth.set(mk, { date: s.date, bizDate: biz, sessionId: s.sessionId ?? null, manual: false, ts })
    }
  }

  const result = {}
  for (const [mk, v] of byMonth) result[mk] = v

  for (const mk of Object.keys(overrides || {})) {
    const wantedDate = overrides[mk]
    if (!wantedDate) continue
    const snap = (snapshots || []).find(s => s.date === wantedDate)
    result[mk] = {
      date:      wantedDate,
      bizDate:   snap ? (businessDate(snap.savedAt ?? snap.date, cutoverHour) || snap.date) : wantedDate,
      sessionId: snap?.sessionId ?? null,
      manual:    true,
    }
  }
  return result
}

/** 指定した snapshot.date が、いずれかの月の「月末在庫」として採用されているか */
export function monthEndLabelFor(date, designation) {
  for (const mk of Object.keys(designation || {})) {
    if (designation[mk]?.date === date) return mk   // 'YYYY-MM'
  }
  return null
}
