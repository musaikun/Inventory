// 算出の可否判定（ゲート）。責務: 「消費量・適正在庫・発注理論値」を出すのに必要な
// データが揃っているかを判定し、不足時は取込を促すヒント文を返す。純関数・副作用なし。
//
// 消費逆算（impliedConsumption）は在庫の観測点（棚卸 or 発注時在庫）が2つ以上必要。
// 揃っていなければ数字を出さず、「過去の棚卸を取り込むと算出できます」と案内する。

import { stockObservations } from './impliedConsumption.js'

/**
 * 品目単位の算出可否。
 * @returns {{ available:boolean, points:number, need:number, hint:string }}
 */
export function itemConsumptionAvailability(item, { snapshots = [], orders = [] } = {}) {
  const points = stockObservations(item, snapshots, orders).length
  if (points >= 2) return { available: true, points, need: 0, hint: '' }
  const need = 2 - points
  const hint = points === 0
    ? '過去の棚卸を取り込むと、消費量・適正在庫を算出できます'
    : `棚卸があと${need}回あれば、消費量・適正在庫を算出できます`
  return { available: false, points, need, hint }
}

// 店舗全体の下地判定に使う「観測点のある棚卸日数」。qty のある品目を含む日をカウント。
function _stocktakeDates(snapshots) {
  let n = 0
  for (const s of snapshots || []) {
    if ((s?.items || []).some(i => i && i.qty != null)) n++
  }
  return n
}

/**
 * 店舗全体で消費・発注理論値の算出下地があるか。
 * @returns {{ ready:boolean, stocktakes:number, hint:string }}
 */
export function storeConsumptionReadiness({ snapshots = [] } = {}) {
  const stocktakes = _stocktakeDates(snapshots)
  const ready = stocktakes >= 2
  const hint = ready
    ? ''
    : stocktakes === 0
      ? '過去の棚卸を取り込むと、消費量・適正在庫・発注の理論値が算出できます'
      : 'あと1回分の棚卸があれば、消費量・発注の理論値が算出できます'
  return { ready, stocktakes, hint }
}
