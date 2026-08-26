// 分析の精度ガード
// - null（未入力）と 0（在庫ゼロ）を厳格に区別する
// - 単位変更・異常な増減を検知（消さずにフラグ）

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
