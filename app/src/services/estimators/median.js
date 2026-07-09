// 適正在庫の推定器（estimator）。交換可能なインターフェース:
//   { id, estimate(samples:number[]) => number|null }
// 将来は trimmed / weighted / ai などを同じ形で差し替える。

export function median(values) {
  const nums = (values || []).filter(v => Number.isFinite(v)).slice().sort((a, b) => a - b)
  const n = nums.length
  if (n === 0) return null
  const mid = n >> 1
  return n % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2
}

export const medianEstimator = {
  id: 'median',
  estimate: median,
}
