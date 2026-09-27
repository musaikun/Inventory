// 行配列（棚卸の items・発注や入出庫の lines）から、品目名で行を引く索引。
// 分析は「全品目 × 全記録」を回すので、毎回 find で線形に探すと品目数の2乗で遅くなる。
// 索引は配列ごとに1回だけ作って使い回す。値は行そのものを持つので、行の数量を
// その場で書き換える訂正（patchSnapshotItems）にもそのまま追従する。行数が変われば作り直す。
const _cache = new WeakMap()

/** 品目名 → その品目の行（配列の順）。同名の行が複数あっても find と同じ順で見られる */
function _index(lines) {
  let c = _cache.get(lines)
  if (c && c.len === lines.length) return c.map
  const map = new Map()
  for (const l of lines) {
    const k = l?.item
    if (k == null) continue
    const arr = map.get(k)
    if (arr) arr.push(l); else map.set(k, [l])
  }
  _cache.set(lines, { len: lines.length, map })
  return map
}

/** lines.find(l => l.item === item && pred(l)) と同じ結果を、索引で速く返す */
export function findLine(lines, item, pred = null) {
  if (!Array.isArray(lines) || lines.length === 0) return undefined
  const arr = _index(lines).get(item)
  if (!arr) return undefined
  return pred ? arr.find(pred) : arr[0]
}

/** lines.filter(l => l.item === item) と同じ */
export function linesOf(lines, item) {
  if (!Array.isArray(lines) || lines.length === 0) return []
  return _index(lines).get(item) || []
}
