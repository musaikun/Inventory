// 同じ品目らしい組（重複の候補）を見つける（ITEM-001 I-5）。
// 強い順に: 商品コードが同じ（code）→ 名前をそろえると同じで単位も同じ（name）→ 片方の名前がもう片方に含まれる（like）。
// 名前のそろえ方は音声入力と同じ（utils/itemMatcher の normalize: 字形・大小・空白・カタカナ/ひらがな）。
// 「別の品目」と答えた組（notDuplicates）と、非表示の品目は出さない。純関数。
import { normalize } from '../utils/itemMatcher.js'

const RANK = { code: 0, name: 1, like: 2 }

/**
 * @param {object} p
 * @param {string[]} p.order 品目名
 * @param {object} [p.units] 品目 → 単位
 * @param {object} [p.codes] 品目 → 商品コード
 * @param {string[]} [p.hidden] 非表示の品目
 * @param {string[]} [p.notDuplicates] 'idA|idB'（小さい方が先）
 * @param {(name:string) => string} p.idOf 品目名 → ID
 * @returns {{ a: string, b: string, why: 'code'|'name'|'like', code?: string }[]}
 */
export function findDuplicatePairs({ order = [], units = {}, codes = {}, hidden = [], notDuplicates = [], idOf }) {
  const skip = new Set(notDuplicates)
  const hide = new Set(hidden)
  const items = order.filter(n => typeof n === 'string' && n && !hide.has(n))
    .map(n => ({ n, k: normalize(n), u: String(units[n] ?? '').trim(), c: String(codes[n] ?? '').trim() }))
  const out = []
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const x = items[i], y = items[j]
      const unitOk = !x.u || !y.u || x.u === y.u
      let why = null
      if (x.c && x.c === y.c) why = 'code'
      else if (x.k === y.k && unitOk) why = 'name'
      else if (unitOk && Math.min(x.k.length, y.k.length) >= 2 && (x.k.includes(y.k) || y.k.includes(x.k))) why = 'like'
      if (!why) continue
      const key = [idOf(x.n), idOf(y.n)].sort().join('|')
      if (skip.has(key)) continue
      out.push({ a: x.n, b: y.n, why, ...(why === 'code' ? { code: x.c } : {}) })
    }
  }
  return out.sort((p, q) => RANK[p.why] - RANK[q.why])
}
