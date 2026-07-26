// 納品取込の名寄せ突合。責務: 取込各行の「業者商品名」を、既存の品目マスタへ
// どう対応づけるかを判定する純関数・副作用なし。
//
//   matched   … 確信を持って既存品目に一致（完全一致・完全エイリアス一致）→ そのまま取込可
//   candidate … あいまい候補あり（部分一致など）→ ユーザーの確認が必要
//   unmatched … 候補なし → 手動対応づけ or 新規品目として追加
//
// 「重複（既取込）」の判定は idempotency（別ユーティリティ）で行い、ここでは扱わない。

import { normalize, findCandidates } from '../utils/itemMatcher.js'

// 完全一致で確信できる既存品目を返す（無ければ null）。
//   ① 正式品目名そのものと一致  ② 完全なエイリアス一致  ③ マスター辞書キーワードと一致
function _confidentItem(name, { order = [], dictionary = {}, masterDict = {} }) {
  const n = normalize(name)
  if (!n) return null

  for (const o of order) if (normalize(o) === n) return o

  for (const [alias, canon] of Object.entries(dictionary)) {
    if (normalize(alias) === n && order.includes(canon)) return canon
  }

  for (const [kw, canons] of Object.entries(masterDict)) {
    if (normalize(kw) !== n) continue
    const hit = (canons || []).find(c => order.includes(c))
    if (hit) return hit
  }

  return null
}

/**
 * 1行の名寄せ結果を返す。
 * @returns {{ status:'matched'|'candidate'|'unmatched', item:string|null, candidates:string[] }}
 */
export function matchRow(name, ctx = {}) {
  const nm = (name ?? '').trim()
  if (!nm) return { status: 'unmatched', item: null, candidates: [] }

  const confident = _confidentItem(nm, ctx)
  if (confident) return { status: 'matched', item: confident, candidates: [confident] }

  const candidates = findCandidates(nm, ctx)
  if (candidates.length > 0) {
    // 先頭を既定サジェストにするが、確定はユーザーに委ねる
    return { status: 'candidate', item: candidates[0], candidates }
  }

  return { status: 'unmatched', item: null, candidates: [] }
}

/**
 * 取込行配列を名寄せし、行ごとの解決と集計を返す。
 * @param {Array} rows parseDeliveryImportCSV().rows
 * @param {object} ctx { order, dictionary, categories, masterDict }
 * @returns {{ resolved: Array, summary: { matched, candidate, unmatched } }}
 *   resolved[i] = { ...rows[i], match: { status, item, candidates } }
 */
export function matchImportRows(rows = [], ctx = {}) {
  const summary = { matched: 0, candidate: 0, unmatched: 0 }
  const resolved = rows.map(row => {
    const match = matchRow(row.name, ctx)
    summary[match.status]++
    return { ...row, match }
  })
  return { resolved, summary }
}
