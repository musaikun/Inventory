// 補充目標＝「発注してここまで戻す」水準。責務: 使える材料から目標値と、その根拠を決める。
// 純関数・副作用なし。
//
// 発注点（reorderPoint）は「これを下回ったら発注する」トリガーであって、目標ではない。
// 発注点との差を発注数にすると補充直後にまた発注点を割り、毎回発注が必要になる。
// そこで目標水準を別に持ち、`不足 = 補充目標 − 現在在庫` から発注数を出す。
//
// 優先順位（上ほど強い）:
//   1. manual        … 品目ごとの手動設定。人が決めたものは常に優先する
//   2. par           … 曜日別の学習値（orderLearning.parLevel）。その店の実績そのもの
//   3. consumption   … 発注点 ＋ 発注間隔ぶんの推定消費。消費が算出できるようになったら使う
//   4. reorder       … 発注点 × REORDER_MULTIPLIER。学習も消費も無い初期状態の既定
//   materials が何も無ければ null（＝目標を出せない。推奨も出さない）
//
// 部分利用（週1回・不定期）のユーザーは 2 も 3 も長く貯まらないため、4 が実質の初期値になる。
// D-024 の前提どおり「発注点だけ入れれば初日から推奨が出る」ことを保証する層。

export const REORDER_MULTIPLIER = 2

const _num = (v) => {
  if (v == null || v === '') return null   // Number(null) は 0 になるため、未指定を先に弾く
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * 補充目標を決める。
 * @param {Object} m
 * @param {number|null} m.manual        品目ごとの手動設定
 * @param {number|null} m.parLevel      曜日別の学習値
 * @param {number|null} m.reorderPoint  発注点
 * @param {number|null} m.dailyConsumption 推定日消費
 * @param {number}      m.horizonDays   発注間隔（日）
 * @returns {{ value:number, source:'manual'|'par'|'consumption'|'reorder' }|null}
 */
export function replenishTarget({
  manual = null, parLevel = null, reorderPoint = null,
  dailyConsumption = null, horizonDays = 7,
} = {}) {
  const man = _num(manual)
  if (man != null && man >= 0) return { value: man, source: 'manual' }

  const par = _num(parLevel)
  if (par != null && par > 0) return { value: par, source: 'par' }

  const rp = _num(reorderPoint)
  const avg = _num(dailyConsumption)
  const days = _num(horizonDays) ?? 7
  if (rp != null && avg != null && avg > 0 && days > 0) {
    return { value: Math.round(rp + Math.ceil(avg * days)), source: 'consumption' }
  }
  if (rp != null && rp > 0) return { value: rp * REORDER_MULTIPLIER, source: 'reorder' }

  return null
}

// 根拠の文言。推奨の数字だけ出しても直しようがないので、必ず理由を添えられるようにする。
export function targetBasisLabel(target, { reorderPoint = null, dailyConsumption = null, horizonDays = 7 } = {}) {
  if (!target) return ''
  switch (target.source) {
    case 'manual':      return '手動で設定した補充目標'
    case 'par':         return '同じ曜日の実績から学習した適正在庫'
    case 'consumption': return `発注点 ${reorderPoint} ＋ 推定消費 ${Number(dailyConsumption).toFixed(1)}/日 × ${horizonDays}日`
    case 'reorder':     return `発注点 ${reorderPoint} × ${REORDER_MULTIPLIER}（学習が貯まると自動で切り替わります）`
    default:            return ''
  }
}
