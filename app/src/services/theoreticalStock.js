// 理論在庫（帳簿在庫）の導出。責務: 直近棚卸の残高を基準点に、それ以降の
// 入出庫を加減算した「今あるはずの数」を返す。純関数・書き込みなし。
//
// 理論在庫 = 直近棚卸残高 + その後の入庫合計 − その後の出庫合計
// 棚卸実績が無い品目は 0 起点で入出庫のみ加減算する（個人利用の入出庫先行に対応）。
// 記録されない消費（営業中の使用等）は含まれないため、値は「参考値」であり
// 実地の入力（棚卸・発注時在庫）とのズレ検出に使う。

import { findLine, linesOf } from '../utils/lineIndex.js'

function _round(v) { return Math.round(v * 1000) / 1000 }

// 基準点の日付と時刻。明細の行が「数えた時刻」（at・ms）を持てばそれを使う。
// 日をまたいだ棚卸では、棚卸日（始めた日）と完了の時刻ではなく、その品目を数えた時点から入出庫を数える
// （1日目に数えた品目に2日目の納品を足し、2日目に数えた品目には足さない・User決定 2026-11-05）
function _pad(n) { return String(n).padStart(2, '0') }
function _baseOf(s, it) {
  const ms = Number(it?.at)
  if (it?.at != null && Number.isFinite(ms) && ms > 0) {
    const t = new Date(ms)
    return { date: `${t.getFullYear()}-${_pad(t.getMonth() + 1)}-${_pad(t.getDate())}`, savedAt: t.toISOString() }
  }
  return { date: s.date || '', savedAt: s.savedAt || '' }
}

/**
 * @param {string} item      品目名
 * @param {Array}  snapshots useHistory.getSnapshots() の配列（順不同でよい）
 * @param {Array}  movements useMovements.getMovements() の配列（順不同でよい）
 * @param {object} opts      { asOf: 'YYYY-MM-DD' } この日までの入出庫のみ反映
 * @returns {object|null} { qty, baseQty, baseDate, inQty, outQty, moveCount }
 *   基準点も入出庫も無い品目は null（理論在庫を語れない）
 */
export function theoreticalStock(item, snapshots = [], movements = [], { asOf = null } = {}) {
  let base = null
  for (const s of snapshots) {
    const it = findLine(s?.items, item, i => i.qty != null)
    if (!it) continue
    const { date: d, savedAt: at } = _baseOf(s, it)
    if (!base || d.localeCompare(base.date) > 0 || (d === base.date && at.localeCompare(base.savedAt) > 0)) {
      base = { date: d, savedAt: at, qty: Number(it.qty) }
    }
  }

  let inQty = 0
  let outQty = 0
  let moveCount = 0
  for (const m of movements) {
    if (!m || !Array.isArray(m.lines)) continue
    const d = m.date || ''
    if (asOf && d.localeCompare(asOf) > 0) continue
    if (base) {
      const cmp = d.localeCompare(base.date)
      if (cmp < 0) continue
      // 棚卸と同日の入出庫は、棚卸カウントより後に記録されたものだけ反映
      if (cmp === 0 && (m.savedAt || '').localeCompare(base.savedAt) <= 0) continue
    }
    let touched = false
    for (const l of linesOf(m.lines, item)) {
      const q = Number(l.qty)
      if (!Number.isFinite(q) || q <= 0) continue
      if (m.type === 'out') outQty += q
      else inQty += q
      touched = true
    }
    if (touched) moveCount++
  }

  if (!base && moveCount === 0) return null
  return {
    qty:       _round((base ? base.qty : 0) + inQty - outQty),
    baseQty:   base ? base.qty : null,
    baseDate:  base ? base.date : null,
    inQty:     _round(inQty),
    outQty:    _round(outQty),
    moveCount,
  }
}
