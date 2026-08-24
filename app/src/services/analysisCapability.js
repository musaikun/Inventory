// 算出の可否判定（ゲート）。責務: 「消費量・適正在庫・発注理論値」を出すのに必要な
// データが揃っているかを判定し、不足時は取込を促すヒント文を返す。純関数・副作用なし。
//
// 消費逆算（impliedConsumption）は在庫の観測点（棚卸 or 発注時在庫）が2つ以上必要。
// 揃っていなければ数字を出さず、「過去の棚卸を取り込むと算出できます」と案内する。

import { stockObservations, consumptionIntervals } from './impliedConsumption.js'

/**
 * 品目単位の算出可否。
 * @returns {{ available:boolean, points:number, need:number, hint:string }}
 */
export function itemConsumptionAvailability(item, { snapshots = [], orders = [], movements = [], orderDays = [] } = {}) {
  const points = stockObservations(item, snapshots, orders).length
  if (points < 2) {
    const need = 2 - points
    const hint = points === 0
      ? '過去の棚卸を取り込むと、消費量・適正在庫を算出できます'
      : `棚卸があと${need}回あれば、消費量・適正在庫を算出できます`
    return { available: false, points, need, hint }
  }

  // 観測点が足りていても、区間がすべて弾かれていれば消費は出せない。
  // 「出せない理由」を分けて返す（記録漏れなのか、データ不足なのかで次の手が違う）。
  const intervals = consumptionIntervals(item, { snapshots, orders, movements, orderDays })
  const usable = intervals.filter(iv => !iv.flagged)
  if (usable.length) return { available: true, points, need: 0, hint: '' }

  const missing = intervals.some(iv => iv.flagReason === 'missing_inflow')
  const hint = missing
    ? '発注したはずの入庫が記録されていない期間があるため、消費量を算出していません。届いた分を入庫として記録すると算出できます'
    : '在庫が増えている期間があり、消費量を算出できません（入庫の記録漏れ・数え間違いの可能性）'
  return { available: false, points, need: 0, hint, reason: missing ? 'missing_inflow' : 'negative' }
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
