// 発注点の初期値提案。責務: 「これを下回ったら発注する」水準の目安を、
// その店にあるデータから出す。純関数・副作用なし。
//
// 部分利用（週1回・不定期）のユーザーは曜日別の学習も消費推定も長く貯まらない。
// そのあいだ推奨発注数を支えるのは手動の発注点なので、**入力の手間を下げること**が
// 分析の高度化より先に効く（D-024）。ここはその入口。
//
// 優先順位:
//   1. consumption  … 推定日消費 × 発注間隔。次の発注日まで持たせる量＝本来の定義
//   2. stocktakeMin … 在庫観測（棚卸・発注時在庫）の最小値。
//                     「これまでで最も少なかったときの在庫」＝実際にそこまで減らして
//                     回っていた水準。消費が出せない店でも、記録された事実から出せる。
//   どちらも出せなければ null（推測で埋めない。理由は analysisCapability が返す）

import { avgDailyConsumption, stockObservations } from './impliedConsumption.js'

export function suggestReorderPoint(item, {
  snapshots = [], orders = [], movements = [], orderDays = [], horizonDays = 7,
} = {}) {
  const avg = avgDailyConsumption(item, { windowDays: 30, snapshots, orders, movements, orderDays })
  if (avg != null && avg > 0) {
    return {
      value: Math.max(1, Math.ceil(avg * horizonDays)),
      source: 'consumption',
      basis: `推定消費 ${avg.toFixed(1)}/日 × ${horizonDays}日`,
    }
  }

  const obs = stockObservations(item, snapshots, orders)
  if (obs.length >= 2) {
    const min = Math.min(...obs.map(o => o.qty))
    if (Number.isFinite(min) && min > 0) {
      return {
        value: Math.round(min),
        source: 'stocktakeMin',
        basis: `これまでの記録で最も少なかったときの在庫（${obs.length}回中）`,
      }
    }
  }
  return null
}

/**
 * 一括設定用に、品目ごとの提案をまとめて出す。
 * @returns {Array} [{ item, current, suggested, source, basis }]（提案が無い品目も含む）
 */
export function suggestReorderPoints(items, { reorderPoints = {}, ...ctx } = {}) {
  return (items || []).map(item => {
    const s = suggestReorderPoint(item, ctx)
    return {
      item,
      current:   reorderPoints?.[item] ?? null,
      suggested: s?.value ?? null,
      source:    s?.source ?? null,
      basis:     s?.basis ?? '',
    }
  })
}
