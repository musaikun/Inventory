// 品目の点検。発注・金額の計算に効く欄が空の品目を拾う。純関数。
// 非表示の品目は数えない（棚卸にも発注にも出ないので、直しても何も変わらない）。
import { parseLot } from '../services/lot.js'

export const ITEM_CHECKS = [
  { key: 'lot',   label: '入数',     why: '空だと推奨発注数が1個単位で出ます' },
  { key: 'unit',  label: '単位',     why: '数量の意味が読めません' },
  { key: 'price', label: '単価',     why: '在庫金額に入りません' },
  { key: 'genre', label: 'ジャンル', why: '一覧で「その他」にまとまります' },
]

export function missingFields(item, config) {
  const out = []
  if (parseLot(config.lotSizes?.[item]) == null) out.push('lot')
  if (!String(config.units?.[item] ?? '').trim()) out.push('unit')
  if (!(Number(config.prices?.[item]) > 0)) out.push('price')
  if (!String(config.categories?.[item] ?? '').trim()) out.push('genre')
  return out
}

/** @returns {Array<{ item:string, missing:string[] }>} 空欄のある品目（リストの順） */
export function itemCheckRows(config) {
  const hidden = new Set(config.hiddenItems ?? [])
  const out = []
  for (const item of config.order ?? []) {
    if (hidden.has(item)) continue
    const missing = missingFields(item, config)
    if (missing.length) out.push({ item, missing })
  }
  return out
}
