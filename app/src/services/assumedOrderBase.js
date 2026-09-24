// 実績が無い品目の「仮」の発注基準（フェルミ推定）。純関数・副作用なし。
//
// 使える事実は直近の在庫1つだけで、推定の中身はほぼ「何日分置いているか」という仮定。
// だから値は保存せずその場で計算し、常に「仮」と式を添えて出す。保存すると、実績が
// 貯まっても古い仮の数字が手動扱いで残り、消費推定へ切り替わらなくなる。
//
//   日消費     d = 直近在庫 ÷ 在庫日数
//   発注点       = ceil(d × (届くまで + 余裕))
//   補充目標     = ceil(d × (発注間隔 + 届くまで + 余裕))

import { stockObservations } from './impliedConsumption.js'

export const DEFAULT_LEAD_DAYS = 1
export const DEFAULT_SAFETY_DAYS = 1
const MAX_DAYS = 60

function _days(v, { min = 0 } = {}) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= min && n <= MAX_DAYS ? n : null
}

// 在庫日数の既定。定期発注の店で、任意の時点の在庫は平均「発注間隔の半分＋余裕」。
export function defaultStockDays(intervalDays, safetyDays = DEFAULT_SAFETY_DAYS) {
  const i = _days(intervalDays, { min: 1 }) ?? 7
  const s = _days(safetyDays) ?? DEFAULT_SAFETY_DAYS
  return Math.max(1, Math.round(i / 2 + s))
}

/**
 * 保存形の正規化。未設定（保存したことが無い）は null ＝ 仮の基準を使わない。
 * @returns {{ leadDays:number, safetyDays:number, stockDays:number|null, stockDaysByCategory:Object }|null}
 */
export function normalizeAssumptions(src) {
  if (!src || typeof src !== 'object') return null
  const byCat = {}
  for (const [k, v] of Object.entries(src.stockDaysByCategory ?? {})) {
    const d = _days(v, { min: 1 })
    if (k && d != null) byCat[k] = d
  }
  return {
    leadDays:   _days(src.leadDays) ?? DEFAULT_LEAD_DAYS,
    safetyDays: _days(src.safetyDays) ?? DEFAULT_SAFETY_DAYS,
    stockDays:  _days(src.stockDays, { min: 1 }),   // null = 発注間隔から既定を出す
    stockDaysByCategory: byCat,
  }
}

// その品目に使う在庫日数（ジャンル別の上書き → 店舗の値 → 既定）
export function stockDaysFor(assumptions, category, intervalDays) {
  const a = assumptions
  if (!a) return null
  return a.stockDaysByCategory?.[category] ?? a.stockDays ?? defaultStockDays(intervalDays, a.safetyDays)
}

/**
 * 仮の発注基準。仮定が未設定・在庫が無い/0 なら null（推定しない）。
 * @returns {{ daily, qty, stockDays, reorderPoint, target, basis, targetBasis }|null}
 */
export function assumedBase(item, {
  snapshots = [], orders = [], assumptions = null, category = '', intervalDays = 7,
} = {}) {
  if (!assumptions) return null
  const obs = stockObservations(item, snapshots, orders)
  const qty = obs.length ? obs[obs.length - 1].qty : null
  if (!(qty > 0)) return null
  const stockDays = stockDaysFor(assumptions, category, intervalDays)
  if (!(stockDays > 0)) return null
  const { leadDays: L, safetyDays: S } = assumptions
  const I = _days(intervalDays, { min: 1 }) ?? 7
  const daily = qty / stockDays
  return {
    daily, qty, stockDays,
    reorderPoint: Math.max(1, Math.ceil(daily * (L + S))),
    target:       Math.max(1, Math.ceil(daily * (I + L + S))),
    basis: `仮: 在庫${qty} ÷ ${stockDays}日分 × (届くまで${L}＋余裕${S})日`,
    targetBasis: `仮: 在庫${qty} ÷ ${stockDays}日分 × (発注間隔${I}＋届くまで${L}＋余裕${S})日`,
  }
}
