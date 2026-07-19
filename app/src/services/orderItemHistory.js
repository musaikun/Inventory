// 品目ごとの「発注量」を同曜でそろえた履歴（純関数）。発注時の確定モーダルで、
// 「唐揚げは前週/先月同曜にいくつ頼んだか・直近のならし」を見せるために使う。
// 全体の件数/金額はムラが大きいので使わず、品目×曜日そろえ＋中央値でノイズを抑える。

import { weekdayOf } from './orderLearning.js'

export function median(nums) {
  const a = (nums || []).map(Number).filter(Number.isFinite).sort((x, y) => x - y)
  if (!a.length) return null
  const m = Math.floor(a.length / 2)
  return a.length % 2 ? a[m] : Math.round(((a[m - 1] + a[m]) / 2) * 100) / 100
}

// orders    : useOrders().getOrders() 相当の配列（{ date, lines:[{item, qty}] }）
// item      : 対象品目
// weekday   : そろえる曜日(0=日..6=土)
// opts.window: 直近の同曜サンプル数（推移・中央値の対象）
// opts.before: この日付(YYYY-MM-DD)以降は履歴から除外（当日の入力を混ぜない）
//
// 返り値: { samples:[{date,qty}], lastWeek, lastMonth, median, values, count }
export function weekdayOrderHistory(orders, item, weekday, { window = 6, before = null } = {}) {
  const byDate = new Map()   // 同一日に複数発注（仕入先違い）は合算
  for (const o of (orders || [])) {
    if (!o || weekdayOf(o.date) !== weekday) continue
    if (before && o.date >= before) continue
    const line = (o.lines || []).find(l => l.item === item)
    const q = line ? Number(line.qty) : NaN
    if (Number.isFinite(q)) byDate.set(o.date, (byDate.get(o.date) || 0) + q)
  }
  const series = [...byDate.entries()]
    .map(([date, qty]) => ({ date, qty }))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))

  const n = series.length
  const recent = series.slice(-window)
  return {
    samples:   recent,
    values:    recent.map(r => r.qty),
    count:     n,
    lastWeek:  n >= 1 ? series[n - 1] : null,   // 直近の同曜（＝前週相当）
    lastMonth: n >= 4 ? series[n - 4] : null,   // 4回前の同曜（＝先月相当）
    median:    median(recent.map(r => r.qty)),
  }
}
