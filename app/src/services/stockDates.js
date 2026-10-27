import { localDateKey } from '../utils/localDate.js'

// 入庫ごとの日付（User決定 2026-10-27・migration 0034）。
// - 期限のあるものは期限（kind 'exp'）、ないものは買った日（kind 'buy'）を入庫の行に持たせる。
//   入れていない入庫は、入庫した日を買った日とみなす
// - 同じ品目を別々に買ったら、入庫1回ごとに別の束になる
// - 今の見込み（論理在庫）のうち、どの束が残っているかは「古い入庫から使った」とみなして出す
//   （新しい入庫から順に見込みを割り当てる）。入庫で説明できない分は日付なし
export const EXPIRY_SOON_DAYS = 3   // 期限まで何日になったら知らせるか

const _days = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000)

/**
 * 品目の残っている束。古い順（使う順）。
 * @param {string} item
 * @param {Array} movements 有効な入出庫（取り消しは除いておく）
 * @param {number|null} theo 今の見込み
 * @returns {Array<{ date, kind: 'exp'|'buy'|null, qty, movementId }>}
 */
export function stockDatesOf(item, movements = [], theo = null) {
  let rest = Number(theo)
  if (!Number.isFinite(rest) || rest <= 0) return []
  const ins = []
  for (const m of movements || []) {
    if (!m || m.deletedAt || m.type === 'out') continue
    for (const l of m.lines || []) {
      if (l.item !== item || !(Number(l.qty) > 0)) continue
      ins.push({
        date: l.lotDate || m.date,
        kind: l.lotDate ? (l.lotKind === 'exp' ? 'exp' : 'buy') : 'buy',
        qty: Number(l.qty),
        movementId: m.id,
        _at: `${m.date || ''}|${m.savedAt || ''}`,
      })
    }
  }
  ins.sort((a, b) => b._at.localeCompare(a._at))   // 新しい入庫から
  const out = []
  for (const l of ins) {
    if (rest <= 0) break
    const qty = Math.min(l.qty, rest)
    rest = Math.round((rest - qty) * 1000) / 1000
    out.push({ date: l.date, kind: l.kind, qty, movementId: l.movementId })
  }
  if (rest > 0) out.push({ date: null, kind: null, qty: rest, movementId: null })
  return out.reverse()
}

/**
 * 期限の知らせ。残っている束のうち、いちばん近い期限。
 * @returns {null | { date, daysLeft, level: 'over'|'soon'|'ok', qty }}
 */
export function expiryOf(dates = [], today = localDateKey()) {
  let best = null
  for (const d of dates) {
    if (d.kind !== 'exp' || !d.date) continue
    if (!best || d.date < best.date) best = { date: d.date, qty: d.qty }
    else if (d.date === best.date) best.qty += d.qty
  }
  if (!best) return null
  const daysLeft = _days(today, best.date)
  const level = daysLeft < 0 ? 'over' : daysLeft <= EXPIRY_SOON_DAYS ? 'soon' : 'ok'
  return { ...best, daysLeft, level }
}

/** 「期限 あと2日」「期限切れ 1日」「今日まで」 */
export function expiryLabel(e) {
  if (!e) return ''
  if (e.daysLeft < 0) return `期限切れ ${-e.daysLeft}日`
  if (e.daysLeft === 0) return '期限 今日まで'
  return `期限 あと${e.daysLeft}日`
}

/** この品目の最後の入庫で使った日付の種類（次の入庫の既定にする）。無ければ 'buy' */
export function lastDateKind(item, movements = []) {
  let best = null
  for (const m of movements || []) {
    if (!m || m.deletedAt || m.type === 'out') continue
    for (const l of m.lines || []) {
      if (l.item !== item || !l.lotDate) continue
      const at = `${m.date || ''}|${m.savedAt || ''}`
      if (!best || at > best.at) best = { at, kind: l.lotKind === 'exp' ? 'exp' : 'buy' }
    }
  }
  return best?.kind ?? 'buy'
}
