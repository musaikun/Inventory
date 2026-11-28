// 行配列（棚卸の items・発注や入出庫の lines）から、品目で行を引く索引。
// 分析は「全品目 × 全記録」を回すので、毎回 find で線形に探すと品目数の2乗で遅くなる。
// 索引は配列ごとに1回だけ作って使い回す。値は行そのものを持つので、行の数量を
// その場で書き換える訂正（patchSnapshotItems）にもそのまま追従する。行数が変われば作り直す。
//
// 品目の結び方（ITEM-001 I-4a）: 鍵は品目の変わらない ID。行に ID（itemId）があればそれ、
// 無い古い行は名前から ID を求める（useConfig が setItemKeyResolver で渡す itemIdOf）。
// 名前を変えた品目の古い行も、最初の名前から決まる ID になるので、新しい名前の品目として見つかる。
// 求め方が渡されていない（純粋な関数のテストなど）ときは、従来どおり名前で結ぶ。
const _cache = new WeakMap()
const ID_RE = /^(it|og)_[0-9a-f]{16}$/
let _resolve = null   // 名前 → ID（統合の付け替えまで済ませた ID）
let _canon = null     // 行の ID → 統合の付け替えを済ませた ID（ITEM-001 I-5）
let _ver = 0          // 名前 → ID の対応が変わったら上げる（索引を作り直す）

/** 名前 → ID の求め方を渡す（useConfig が1回呼ぶ）。canon は行の ID を統合先へ付け替える。null で名前に戻す */
export function setItemKeyResolver(fn, canon = null) {
  _resolve = typeof fn === 'function' ? fn : null
  _canon = typeof canon === 'function' ? canon : null
  _ver++
}
/** 名前 → ID の対応が変わった（設定の itemIds が変わった） */
export function bumpItemKeys() { _ver++ }

/** 品目名 → 鍵 */
export function itemKey(name) { return name == null ? null : (_resolve ? _resolve(name) : name) }
/** 行 → 鍵 */
export function lineKey(l) {
  if (!l) return null
  if (_resolve && typeof l.itemId === 'string' && ID_RE.test(l.itemId)) return _canon ? _canon(l.itemId) : l.itemId
  return itemKey(l.item)
}
/** 行がその品目のものか（l.item === name の代わり） */
export function sameItem(l, name) { const k = lineKey(l); return k != null && k === itemKey(name) }

/** 鍵 → その品目の行（配列の順）。同じ品目の行が複数あっても find と同じ順で見られる */
function _index(lines) {
  let c = _cache.get(lines)
  if (c && c.len === lines.length && c.ver === _ver) return c.map
  const map = new Map()
  for (const l of lines) {
    const k = lineKey(l)
    if (k == null) continue
    const arr = map.get(k)
    if (arr) arr.push(l); else map.set(k, [l])
  }
  _cache.set(lines, { len: lines.length, ver: _ver, map })
  return map
}

/** lines.find(l => sameItem(l, item) && pred(l)) と同じ結果を、索引で速く返す */
export function findLine(lines, item, pred = null) {
  if (!Array.isArray(lines) || lines.length === 0) return undefined
  const arr = _index(lines).get(itemKey(item))
  if (!arr) return undefined
  return pred ? arr.find(pred) : arr[0]
}

/** lines.filter(l => sameItem(l, item)) と同じ */
export function linesOf(lines, item) {
  if (!Array.isArray(lines) || lines.length === 0) return []
  return _index(lines).get(itemKey(item)) || []
}
