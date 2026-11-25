// 棚卸で数えた数と、そのときの帳簿（理論在庫）の差（User決定 2026-11-25・PROD-001）。
// 帳簿 = この棚卸より前の直近の棚卸 ＋ その後、その品目を数えた時点までの入庫 − 出庫。
// 差 = 数えた数 − 帳簿。マイナスは「使った分・ロス」、プラスは「記録していない入庫・数え違い」。
// 帳簿を語れない品目（前の棚卸も入出庫も無い）は比べない。純関数。

import { theoreticalStock, countMoment } from './theoreticalStock.js'

const _r = v => Math.round(v * 1000) / 1000
const _key = s => `${s?.date || ''}\u0000${s?.savedAt || ''}`

/**
 * @param {object} snapshot  比べる棚卸（完了したもの）
 * @param {Array}  snapshots 全部の棚卸（この棚卸を含んでいてもよい）
 * @param {Array}  movements 全部の入出庫
 * @returns {{ compared: number, diffCount: number, list: Array<{ item, unit, book, counted, gap }> }}
 *   list は差のある品目だけ、差の大きい順
 */
export function stockGap(snapshot, snapshots = [], movements = []) {
  const items = Array.isArray(snapshot?.items) ? snapshot.items : []
  const me = _key(snapshot)
  const prior = snapshots.filter(s => s && s !== snapshot && _key(s) < me)
  let compared = 0
  const list = []
  for (const it of items) {
    if (it?.qty == null || !it.item) continue
    const counted = Number(it.qty)
    if (!Number.isFinite(counted)) continue
    const book = theoreticalStock(it.item, prior, movements, { before: countMoment(snapshot, it) })
    if (!book) continue
    compared++
    const gap = _r(counted - book.qty)
    if (gap !== 0) list.push({ item: it.item, unit: it.unit || '', book: book.qty, counted, gap })
  }
  list.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap) || a.item.localeCompare(b.item))
  return { compared, diffCount: list.length, list }
}
