// 品目の発注基準（発注点・補充目標）を1か所で決める。純関数・副作用なし。
//
// 手動の発注点があればそれが全て。無い品目は、店舗が仮定を保存しているときに限り
// 目安（消費推定 → 在庫の最小値 → 仮）をその場で使う。目安は保存しないので、
// 実績が貯まれば仮は自然に消え、人が入れた値は上書きされない。
// 仮定が未設定の店は従来どおり（手動の発注点だけ）。

import { avgDailyConsumption } from './impliedConsumption.js'
import { suggestReorderPoint } from './reorderSuggestion.js'
import { assumedBase } from './assumedOrderBase.js'
import { replenishTarget, targetBasisLabel } from './replenishTarget.js'

function _manual(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * @returns {{ reorder: {value,source,basis}|null, target: {value,source,basis}|null }}
 */
export function orderBaseFor(item, {
  reorderPoints = {}, replenishTargets = {}, assumptions = null, category = '',
  snapshots = [], orders = [], movements = [], orderDays = [], horizonDays = 7, parLevel = null,
} = {}) {
  const man = _manual(reorderPoints?.[item])
  const reorder = man != null
    ? { value: man, source: 'manual', basis: '手動で設定した発注点' }
    : assumptions
      ? suggestReorderPoint(item, { snapshots, orders, movements, orderDays, horizonDays, assumptions, category })
      : null

  const dailyConsumption = avgDailyConsumption(item, { windowDays: 30, snapshots, orders, movements, orderDays })
  const a = reorder?.source === 'assumed'
    ? assumedBase(item, { snapshots, orders, assumptions, category, intervalDays: horizonDays })
    : null
  const reorderPoint = reorder?.value ?? null
  const t = replenishTarget({
    manual: replenishTargets?.[item] ?? null,
    parLevel, reorderPoint, dailyConsumption, horizonDays,
    assumedTarget: a?.target ?? null,
  })
  const target = t
    ? { ...t, basis: targetBasisLabel(t, { reorderPoint, dailyConsumption, horizonDays, assumedBasis: a?.targetBasis }) }
    : null
  return { reorder, target }
}
