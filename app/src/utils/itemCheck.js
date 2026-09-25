// 品目の点検。発注・金額の計算に効く欄が空の品目を拾う。純関数。
// 非表示の品目は数えない（棚卸にも発注にも出ないので、直しても何も変わらない）。
import { parseLot } from '../services/lot.js'

export const STALE_WINDOW = 3   // 振り分け画面の「直近3回 未計測」と同じ窓

export const ITEM_CHECKS = [
  { key: 'lot',   label: '入数',     chip: '入数なし',     why: '空だと推奨発注数が1個単位で出ます' },
  { key: 'unit',  label: '単位',     chip: '単位なし',     why: '数量の意味が読めません' },
  { key: 'price', label: '単価',     chip: '単価なし',     why: '在庫金額に入りません' },
  { key: 'genre', label: 'ジャンル', chip: 'ジャンルなし', why: '一覧で「その他」にまとまります' },
  { key: 'stale', label: '未計測',   chip: 'しばらく数えていない',
    why: `直近${STALE_WINDOW}回の棚卸で一度も数量が入っていない品目です。使っていなければ非表示にすると棚卸が短くなります` },
]

/**
 * 直近 STALE_WINDOW 回の棚卸で一度も数えていない品目と、最後に数えた日。
 * 定義は振り分け画面（AxisAssignFocus の未計測）と同じ:
 *   ・直近の棚卸に1件も数量が無ければ（比べる相手が無いので）何も出さない
 *   ・前回の棚卸の時点でリストに無かった品目は「新規」なので出さない
 * @param {Array} snapshots useHistory().getSnapshots()（新しい順）
 * @returns {Map<string, string|null>} 品目 → 最後に数えた日（一度も無ければ null）
 */
export function staleItems(order, snapshots = []) {
  const recent = snapshots.slice(0, STALE_WINDOW)
  const counted = new Set()
  for (const s of recent) for (const it of (s.items || [])) if (it.qty != null) counted.add(it.item)
  const out = new Map()
  if (!counted.size) return out
  const lastItems = new Set((snapshots[0]?.items || []).map(it => it.item))
  for (const item of order ?? []) {
    if (counted.has(item) || !lastItems.has(item)) continue
    let last = null
    for (const s of snapshots) {
      if ((s.items || []).some(it => it.item === item && it.qty != null)) { last = String(s.date).slice(0, 10); break }
    }
    out.set(item, last)
  }
  return out
}

export function missingFields(item, config) {
  const out = []
  if (parseLot(config.lotSizes?.[item]) == null) out.push('lot')
  if (!String(config.units?.[item] ?? '').trim()) out.push('unit')
  if (!(Number(config.prices?.[item]) > 0)) out.push('price')
  if (!String(config.categories?.[item] ?? '').trim()) out.push('genre')
  return out
}

/**
 * @returns {Array<{ item:string, missing:string[], last?:string|null }>}
 *   空欄のある品目・しばらく数えていない品目（リストの順）。missing に 'stale' が入ったものは last を持つ
 */
export function itemCheckRows(config, { snapshots = [] } = {}) {
  const hidden = new Set(config.hiddenItems ?? [])
  const stale = staleItems(config.order, snapshots)
  const out = []
  for (const item of config.order ?? []) {
    if (hidden.has(item)) continue
    const missing = missingFields(item, config)
    if (stale.has(item)) missing.push('stale')
    if (missing.length) out.push(stale.has(item) ? { item, missing, last: stale.get(item) } : { item, missing })
  }
  return out
}
