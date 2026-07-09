// 学習ロジック（責務: 発注後在庫を求め、曜日別に集計し、適正在庫を算出する）。
// 発注ロジック(orderSuggestion.js)とは分離。すべて純関数・副作用なし。
//
// 学習対象は「利用者が最終確定した発注後在庫」。発注量そのものではなく、
// 発注後に店舗が維持しようとした在庫量を学習する。
//
// 学習イベント: { item, date:'YYYY-MM-DD', postStock:number, excluded?:boolean }
//   date から曜日を導出して曜日別に束ねる。excluded=true は学習から除外
//   （臨時大量発注・誤入力・オープン/閉店・イベント等、将来の除外フラグ用）。

import { effectiveLot } from './lot.js'
import { medianEstimator } from './estimators/median.js'

export const DEFAULT_WINDOW = 12

// 発注後在庫 = 現在在庫 + 発注数量 × LOT
// ※現在在庫 + 発注数量 ではない。必ず LOT を掛ける。
export function postOrderStock(stock, orderQty, lot) {
  if (stock == null || stock === '' || orderQty == null || orderQty === '') return null
  const s = Number(stock)
  const q = Number(orderQty)
  if (!Number.isFinite(s) || !Number.isFinite(q)) return null
  return s + q * effectiveLot(lot)
}

// 'YYYY-MM-DD' → 曜日番号（0=日 .. 6=土）。ローカルタイムのずれを避け UTC 正午で判定。
export function weekdayOf(dateStr) {
  if (!dateStr) return null
  const [y, m, d] = String(dateStr).split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
}

// 発注後在庫の直近サンプル（同一品目・同一曜日）を古い順で返す。
// window 件に絞り、excluded は除外する。
export function samplesFor(events, item, weekday, { window = DEFAULT_WINDOW } = {}) {
  return (events || [])
    .filter(e => e && e.item === item && !e.excluded &&
                 Number.isFinite(Number(e.postStock)) &&
                 weekdayOf(e.date) === weekday)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .slice(-window)
    .map(e => Number(e.postStock))
}

// 適正在庫。サンプルが無ければ null（コールドスタート）。
export function parLevel(events, item, weekday, opts = {}) {
  const { estimator = medianEstimator, ...rest } = opts
  const samples = samplesFor(events, item, weekday, rest)
  return estimator.estimate(samples)
}
