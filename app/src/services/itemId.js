// 品目の変わらない ID（ITEM-001 段 I-1・User 決定 2026-11-28）。
// 店で作った品目の ID は「店舗コード＋最初の名前」から決まる値（it_ ＋ 16 桁の16進）。
// どの端末で付けても同じ値になるので、2台が同時に付けても食い違わない。名前を変えても ID は変えない。
// 名前を変えた後に同じ名前で新しい品目を作ると計算上は同じ値になるので、使用中の ID と重なれば番号を足して付け直す。
// 本部の品目（og_…）は組織の単位でサーバーが付ける（テナント T-4・まだ無い）。純関数。

// 53 ビットのハッシュ（cyrb53）を2つの種で回して 64 ビットぶんにする
function _cyrb53(str, seed) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
}

/** 店舗コードと名前から決まる ID */
export function itemIdFor(shop, name) {
  return 'it_' + _cyrb53(`${shop || ''}\u0000${name}`, 0x9e3779b9)
}

export const isItemId = v => typeof v === 'string' && /^(it|og)_[0-9a-f]{16}$/.test(v)

/**
 * 名前 → ID の表に、まだ ID の無い品目を足す。今ある対応は変えない・消さない（消した品目の ID も残す）。
 * @returns {{ map: object, added: number }} map は新しいオブジェクト（足すものが無ければ元のまま）
 */
export function ensureItemIds(itemIds, names, shop) {
  const src = itemIds && typeof itemIds === 'object' && !Array.isArray(itemIds) ? itemIds : {}
  const map = {}
  for (const [n, id] of Object.entries(src)) if (isItemId(id)) map[n] = id
  const used = new Set(Object.values(map))
  let added = 0
  for (const n of names || []) {
    if (typeof n !== 'string' || !n || map[n]) continue
    let id = itemIdFor(shop, n)
    for (let k = 1; used.has(id); k++) id = itemIdFor(shop, `${n}#${k}`)
    map[n] = id; used.add(id); added++
  }
  return { map: added || Object.keys(map).length !== Object.keys(src).length ? map : src, added }
}

/** 名前を変えたとき、ID を新しい名前へ引き継ぐ（古い名前の対応は外す） */
export function renameItemId(itemIds, oldName, newName) {
  if (!itemIds || !itemIds[oldName] || oldName === newName) return itemIds
  const map = { ...itemIds, [newName]: itemIds[oldName] }
  delete map[oldName]
  return map
}
