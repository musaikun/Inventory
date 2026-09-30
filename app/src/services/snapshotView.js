/**
 * 完了した棚卸（スナップショット）を InventoryTable で見せるための config を組む。
 * 詳細画面（ホスト）と共有URLの閲覧画面（ゲスト）の共通部品。
 *
 * **並びはホームに揃える**（User指示 2026-09-30）。ホームはジャンルを分類コード順、
 * 振り分けは振り分けページで決めたグループ順に並べる。スナップショットにはコードそのものが
 * 無かったため、閲覧画面ではジャンルが五十音順になり、ホームと並びが違っていた。
 *
 * 並びの決め方（上ほど優先）:
 *   1. live（この端末の店舗設定。ログイン中の詳細画面で渡す）
 *   2. スナップショットに保存した並び（categoryOrder / axisGroupsA / axisGroupsB）
 *   3. 品目の並び（config.order 順）で最初に出てきた順（古い記録の代わり）
 */

// ホームの InventoryTable と同じ比べ方（分類コード順 → 五十音順）
function _byHomeCategoryOrder(codes) {
  return (a, b) => {
    const ca = codes?.[a], cb = codes?.[b]
    if (ca != null && cb != null && ca !== cb) return ca - cb
    if (ca != null && cb == null) return -1
    if (cb != null && ca == null) return  1
    return a.localeCompare(b, 'ja')
  }
}

/**
 * 店舗設定から、ホームと同じ並びのジャンル名一覧を作る（完了時にスナップショットへ残す）。
 * @param {object} config useConfig の config
 * @returns {string[]}
 */
export function categoryOrderOf(config) {
  const cats = new Set()
  for (const c of Object.values(config?.categories ?? {})) if (c) cats.add(c)
  return [...cats].sort(_byHomeCategoryOrder(config?.categoryCodes ?? {}))
}

function _splitTags(v) {
  if (Array.isArray(v)) return v.filter(Boolean)
  return String(v ?? '').split('|').map(s => s.trim()).filter(Boolean)
}

/**
 * @param {object} snap  スナップショット、または共有URLの結果（items / axisNames / categoryOrder ...）
 * @param {object} [opts]
 * @param {object} [opts.live]           店舗設定（ログイン中のみ）
 * @param {boolean} [opts.withPrices]    単価を載せる（ホストの詳細だけ）
 */
export function snapshotViewConfig(snap, { live = null, withPrices = false } = {}) {
  const items = Array.isArray(snap?.items) ? snap.items : []
  const order = [], categories = {}, prices = {}, codes = {}, tagsA = {}, tagsB = {}
  const firstSeen = []
  for (const it of items) {
    if (!it?.item) continue
    order.push(it.item)
    if (it.category != null) {
      categories[it.item] = it.category
      if (!firstSeen.includes(it.category)) firstSeen.push(it.category)
    }
    if (withPrices && it.unitPrice != null) prices[it.item] = it.unitPrice
    if (it.code) codes[it.item] = it.code
    const a = _splitTags(it.tagA), b = _splitTags(it.tagB)
    if (a.length) tagsA[it.item] = a
    if (b.length) tagsB[it.item] = b
  }

  // ジャンルの並び → InventoryTable が読む categoryCodes（数値）へ
  const liveOrder = live ? categoryOrderOf(live) : []
  const saved = Array.isArray(snap?.categoryOrder) ? snap.categoryOrder : []
  const catOrder = liveOrder.length ? liveOrder : saved.length ? saved : firstSeen
  const categoryCodes = {}
  catOrder.forEach((c, i) => { categoryCodes[c] = i + 1 })
  // 並びに無いジャンル（あとから消した等）は、見た順で後ろへ
  let next = catOrder.length + 1
  for (const c of firstSeen) if (categoryCodes[c] == null) categoryCodes[c] = next++

  const pickGroups = (key) => {
    const l = live?.[key]
    if (Array.isArray(l) && l.length) return [...l]
    return Array.isArray(snap?.[key]) ? [...snap[key]] : []
  }
  const names = Array.isArray(snap?.axisNames) ? snap.axisNames : ['', '']
  return {
    order, categories, prices, codes, categoryCodes,
    prevMonths: {}, lotSizes: {}, units: {},
    // 振り分け（セッションで使ったもの）。名前が無い軸は出さない（InventoryTable の sortOpts）
    axisNames: [names[0] || '', names[1] || ''],
    tagsA, tagsB,
    axisGroupsA: pickGroups('axisGroupsA'),
    axisGroupsB: pickGroups('axisGroupsB'),
  }
}
