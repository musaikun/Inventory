/**
 * 品目リスト（config）の書き換えに要る権限を、前後の差から決める（段 2-3）。
 *
 * config は丸ごと PUT されるので、何を変えたかはサーバーで前と比べて判断する。
 * - 品目が消えた → item.admin（削除・取込の全入れ替え・全品目の削除）
 * - 今ある品目の情報（単位・単価・ジャンル・コード・入数・写真・非表示）→ item.edit
 * - 並び替え（振り分け・並び替えの名前・分類先・並び）→ sort
 * - 発注点・補充目標・発注日と締切・発注の前提 → orderSettings
 * - 新しい品目を足しただけ（その品目の情報を含む）・辞書（音声の言い換え）→ 誰でも（item.add）
 * 返すのは要る権限の配列（空なら誰でも）。
 */
const ITEM_MAPS = ['units', 'prices', 'categories', 'codes', 'prevMonths', 'lotSizes', 'images']
const SORT_MAPS = ['tagsA', 'tagsB']
const ORDER_MAPS = ['reorderPoints', 'replenishTargets']

const _j = v => JSON.stringify(v ?? null)
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
const _arr = v => (Array.isArray(v) ? v : [])

function _changedForExisting(prev, next, key, existing) {
  const a = _obj(prev?.[key]), b = _obj(next?.[key])
  for (const n of existing) if (_j(a[n]) !== _j(b[n])) return true
  return false
}

export function configChangePerms(prev, next) {
  const need = new Set()
  const before = _arr(prev?.order), after = _arr(next?.order)
  const afterSet = new Set(after)
  if (before.some(n => !afterSet.has(n))) need.add('item.admin')
  const existing = before.filter(n => afterSet.has(n))
  if (ITEM_MAPS.some(k => _changedForExisting(prev, next, k, existing))) need.add('item.edit')
  const hidPrev = new Set(_arr(prev?.hiddenItems)), hidNext = new Set(_arr(next?.hiddenItems))
  if (existing.some(n => hidPrev.has(n) !== hidNext.has(n))) need.add('item.edit')
  if (SORT_MAPS.some(k => _changedForExisting(prev, next, k, existing))) need.add('sort')
  const names = c => _arr(c?.axisNames).map(x => x || '').concat(['', '']).slice(0, 2)
  if (_j(names(prev)) !== _j(names(next))) need.add('sort')
  for (const k of ['axisGroupsA', 'axisGroupsB']) if (_j(_arr(prev?.[k])) !== _j(_arr(next?.[k]))) need.add('sort')
  // 今ある品目どうしの並び（取込順・並び替えの順）
  const keptOrder = after.filter(n => before.includes(n))
  if (_j(keptOrder) !== _j(existing)) need.add('sort')
  const exSet = new Set(existing)
  for (const k of ['axisItemOrderA', 'axisItemOrderB']) {
    if (!Array.isArray(prev?.[k])) continue   // 古い設定（並びを持たない）からの最初の保存は比べない
    const a = _arr(prev[k]).filter(n => exSet.has(n)), b = _arr(next?.[k]).filter(n => exSet.has(n))
    if (_j(a) !== _j(b)) need.add('sort')
  }
  if (ORDER_MAPS.some(k => _changedForExisting(prev, next, k, existing))) need.add('orderSettings')
  if (_j(_arr(prev?.orderSchedules)) !== _j(_arr(next?.orderSchedules))) need.add('orderSettings')
  if (_j(prev?.orderAssumptions ?? null) !== _j(next?.orderAssumptions ?? null)) need.add('orderSettings')
  return [...need]
}
