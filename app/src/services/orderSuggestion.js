// 発注ロジック（責務: 現在在庫を受け取り、適正在庫から不足を求め、LOT 単位へ補正して
// 推奨発注数を返す）。学習ロジック(orderLearning.js)とは分離。純関数・副作用なし。
//
// 推奨発注数の単位は「発注回数（LOT 数）」。1 = LOT 1 つ分を発注 = 入数ぶん納品される。

import { effectiveLot } from './lot.js'

// 不足量 = 適正在庫 - 現在在庫
export function shortage(parLevel, currentStock) {
  if (parLevel == null) return 0
  const s = Number(currentStock)
  const cur = Number.isFinite(s) ? s : 0
  return parLevel - cur
}

// 推奨発注数（LOT 数）。不足を LOT で割った整数部（floor）。
// LOT 未満の不足は発注しない。端数（1 LOT 未満の不足）は許容し、過剰発注しない。
export function suggestOrder(parLevel, currentStock, lot) {
  const lack = shortage(parLevel, currentStock)
  if (!(lack > 0)) return 0
  return Math.floor(lack / effectiveLot(lot))
}
