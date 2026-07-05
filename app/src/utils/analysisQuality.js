// 分析の精度ガード
// - null（未入力）と 0（在庫ゼロ）を厳格に区別する
// - 単位変更・異常な増減を検知（消さずにフラグ）
// - スナップショットの信頼度をシビアに採点する
//
// 方針: 信頼度は「完全性（入力済み割合）」を直接掛け算し、
//       入力件数が少なければ即キャップする。甘い数字を出さない。

/** 未入力(null/undefined)でなく、実数が入っているか */
export function isEntered(item) {
  return !!item && item.qty !== null && item.qty !== undefined && !Number.isNaN(item.qty)
}

/**
 * 2時点の差分を安全に計算。未入力があれば比較不能として除外。
 * @returns {{comparable:boolean, delta?:number, direction?:string, unitChanged?:boolean}}
 */
export function safeDelta(curItem, prevItem) {
  if (!isEntered(curItem) || !isEntered(prevItem)) return { comparable: false }
  const delta = curItem.qty - prevItem.qty
  return {
    comparable:  true,
    delta,
    direction:   delta > 0 ? 'increase' : delta < 0 ? 'decrease' : 'flat',
    unitChanged: (curItem.unit || '') !== (prevItem.unit || ''),
  }
}

/**
 * 前回→今回の異常検知（データ掃除＋盗難/廃棄/誤カウント発見）。
 * @param {Object} cur  今回スナップショット { items:[{item,qty,unit,...}] }
 * @param {Object} prev 前回スナップショット
 * @param {Object} opts { ratioThreshold=10, deliveryExpected=false }
 * @returns {Array} [{ item, type, prev, cur, ... }]
 */
export function detectAnomalies(cur, prev, opts = {}) {
  const ratioThreshold  = opts.ratioThreshold ?? 10
  const deliveryExpected = !!opts.deliveryExpected
  const prevMap = new Map()
  for (const it of prev?.items || []) prevMap.set(it.item, it)

  const flags = []
  for (const it of cur?.items || []) {
    const p = prevMap.get(it.item)
    const d = safeDelta(it, p)
    if (!d.comparable) continue

    if (d.unitChanged) {
      flags.push({ item: it.item, type: 'unit_changed', prevUnit: p.unit || '', curUnit: it.unit || '' })
    }
    // 納品が無い前提なのに在庫が増えた → 物理的に不自然
    if (!deliveryExpected && d.direction === 'increase') {
      flags.push({ item: it.item, type: 'unexpected_increase', prev: p.qty, cur: it.qty, delta: d.delta })
    }
    // 桁違いの増減（誤入力の典型）
    if (p.qty > 0 && it.qty > 0) {
      const ratio = it.qty / p.qty
      if (ratio >= ratioThreshold || ratio <= 1 / ratioThreshold) {
        flags.push({ item: it.item, type: 'extreme_ratio', prev: p.qty, cur: it.qty, ratio: Math.round(ratio * 10) / 10 })
      }
    }
  }
  return flags
}

/**
 * スナップショットの信頼度（シビア設定）。
 * @param {Object} snap { items, savedAt }
 * @param {Object} opts { now, anomalyCount }
 * @returns {{score:number, label:string, completeness:number, entered:number, total:number, ageDays:number, reasons:string[]}}
 */
export function snapshotConfidence(snap, opts = {}) {
  const now      = opts.now ? new Date(opts.now).getTime() : Date.now()
  const items    = snap?.items || []
  const total    = items.length
  const entered  = items.filter(isEntered).length
  const completeness = total ? entered / total : 0
  const ageDays  = snap?.savedAt ? (now - new Date(snap.savedAt).getTime()) / 86400000 : Infinity
  const anomalyCount = opts.anomalyCount ?? 0
  const reasons  = []

  // 完全性を直接掛ける（50%入力なら即50点）
  let score = 100 * completeness
  if (completeness < 1) reasons.push(`入力 ${Math.round(completeness * 100)}%（未入力あり）`)

  // 件数が少ないと厳しくキャップ
  if (entered < 5)       { score = Math.min(score, 20); reasons.push('入力件数が非常に少ない') }
  else if (entered < 10) { score = Math.min(score, 40); reasons.push('入力件数が少ない') }
  else if (entered < 20) { score = Math.min(score, 70); reasons.push('入力件数がやや少ない') }

  // 鮮度
  if (ageDays > 400)      { score *= 0.5; reasons.push('1年以上前のデータ') }
  else if (ageDays > 120) { score *= 0.8; reasons.push('120日以上前のデータ') }

  // 異常件数の減点
  if (anomalyCount > 0) { score -= anomalyCount * 5; reasons.push(`異常フラグ ${anomalyCount}件`) }

  score = Math.max(0, Math.min(100, Math.round(score)))

  let label = '不足'
  if (score >= 90)      label = '高'
  else if (score >= 70) label = '中'
  else if (score >= 50) label = '低'

  return {
    score, label,
    completeness: Math.round(completeness * 100),
    entered, total,
    ageDays: Number.isFinite(ageDays) ? Math.round(ageDays) : null,
    reasons,
  }
}
