// 設定の「品目ごとのまとまり」（ITEM-001 I-4b・User 決定 2026-11-28）。
//   items: { 品目の ID: { name, unit, price, category, code, lotSize, …, hidden, manual, … } }
// 本部が配る品目（テナント T-4）と同じ形。
//
// 移行の間（古い端末・古い Worker と混ざる間）は、今の「項目ごとの表」（units・prices…・品目名がキー）を正とし、
// items は保存のたびに表から作り直して一緒に持つ（toConfigItems）。読み込みは表を使い、
// 表が無くて items だけがある設定（将来の配布物・I-6 以降）は items から表を組み立てる（expandConfigItems）。
// items を正に切り替えるのは、古い端末の受け付けを止める I-6。純関数。

// [まとまりの項目, 項目ごとの表]。上の6つは本部が配る項目（品目マスタ）、残りは店ごとの項目
export const ITEM_FIELDS = [
  ['unit', 'units'], ['category', 'categories'], ['code', 'codes'], ['lotSize', 'lotSizes'], ['price', 'prices'], ['image', 'images'],
  ['prevMonth', 'prevMonths'], ['reorderPoint', 'reorderPoints'], ['replenishTarget', 'replenishTargets'],
  ['added', 'itemAdded'], ['hiddenAt', 'hiddenAt'], ['tagsA', 'tagsA'], ['tagsB', 'tagsB'], ['tagsR', 'tagsR'],
]
// [まとまりの印, 品目名の配列]
export const ITEM_FLAGS = [
  ['hidden', 'hiddenItems'], ['hiddenAuto', 'hiddenAuto'], ['manual', 'manualItems'], ['routeMore', 'routeMore'],
]

const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)

/** 項目ごとの表 → 品目ごとのまとまり（並びは order の順） */
export function toConfigItems(cfg) {
  const ids = _obj(cfg?.itemIds) ?? {}
  const flags = ITEM_FLAGS.map(([k, arr]) => [k, new Set(Array.isArray(cfg?.[arr]) ? cfg[arr] : [])])
  const out = {}
  for (const name of Array.isArray(cfg?.order) ? cfg.order : []) {
    const id = ids[name]
    if (typeof name !== 'string' || !id || out[id]) continue
    const it = { name }
    for (const [k, map] of ITEM_FIELDS) {
      const v = _obj(cfg?.[map])?.[name]
      if (v !== undefined && v !== null && v !== '') it[k] = v
    }
    for (const [k, set] of flags) if (set.has(name)) it[k] = true
    out[id] = it
  }
  return out
}

/**
 * 品目ごとのまとまり → 項目ごとの表。src に既にある表は変えない（表が正）。
 * items が無い、または表が揃っていれば src をそのまま返す。
 */
export function expandConfigItems(src) {
  const items = _obj(src?.items)
  if (!items) return src
  const missing = ITEM_FIELDS.filter(([, map]) => src[map] === undefined)
  const missingFlags = ITEM_FLAGS.filter(([, arr]) => src[arr] === undefined)
  if (Array.isArray(src.order) && !missing.length && !missingFlags.length && _obj(src.itemIds)) return src
  const out = { ...src }
  const entries = Object.entries(items).filter(([, it]) => typeof it?.name === 'string' && it.name)
  if (!Array.isArray(out.order)) out.order = entries.map(([, it]) => it.name)
  if (!_obj(out.itemIds)) out.itemIds = Object.fromEntries(entries.map(([id, it]) => [it.name, id]))
  for (const [k, map] of missing) {
    out[map] = {}
    for (const [, it] of entries) if (it[k] !== undefined) out[map][it.name] = it[k]
  }
  for (const [k, arr] of missingFlags) out[arr] = entries.filter(([, it]) => it[k]).map(([, it]) => it.name)
  return out
}
