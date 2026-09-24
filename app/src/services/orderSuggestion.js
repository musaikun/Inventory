// 発注ロジック（責務: 現在在庫を受け取り、適正在庫から不足を求め、LOT 単位へ補正して
// 推奨発注数を返す）。学習ロジック(orderLearning.js)とは分離。純関数・副作用なし。
//
// 推奨発注数の単位は「発注回数（LOT 数）」。1 = LOT 1 つ分を発注 = 入数ぶん納品される。

import { effectiveLot, parseLot } from './lot.js'

// 不足量 = 適正在庫 - 現在在庫
export function shortage(parLevel, currentStock) {
  if (parLevel == null) return 0
  const s = Number(currentStock)
  const cur = Number.isFinite(s) ? s : 0
  return parLevel - cur
}

// 推奨発注数（LOT 数）。不足を LOT で割って切り上げ（User決定 2026-09-24）。
// 不足が少しでもあれば最低 1 LOT。目標を割ったまま次の納品を待たせない。
// 入数の大きい品目は余りが出るので、roundUpExcess で気づけるようにする。
export function suggestOrder(parLevel, currentStock, lot) {
  const lack = shortage(parLevel, currentStock)
  if (!(lack > 0)) return 0
  return Math.ceil(lack / effectiveLot(lot))
}

// 切り上げで目標を超える量（在庫単位）。入数が分かっていて、余りが入数の半分以上のときだけ返す。
// それ未満は 0（知らせるほどの余りではない）。
export function roundUpExcess(parLevel, currentStock, lot) {
  const n = suggestOrder(parLevel, currentStock, lot)
  const l = parseLot(lot)
  if (!n || l == null || l <= 1) return 0
  const excess = n * l - shortage(parLevel, currentStock)
  return excess >= l / 2 ? Math.round(excess * 10) / 10 : 0
}
