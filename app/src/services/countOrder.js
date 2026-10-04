/**
 * 前回の棚卸で「数えた順」を取り出し、並び替えに使う（User決定 2026-10-04）。
 *
 * 決まりは単純にしてある（人に選ばせることを増やさない）:
 * - 使う棚卸は直近の1回だけ（変更履歴か入力順が残っているもの）
 * - 並び順 = 数量を入れた順。複数人なら担当者ごとの順。人の切れ目がそのまま場所の切れ目
 * - 同じ品目が離れた所でもう一度出てきたら、そこにも置く（2か所にある扱い）。複数人でも同じ
 * - 上書き（数え間違いを直した）と取り消しは順番に使わない。直前と同じ品目の連続も1つにまとめる
 * - 時間があいたかどうかでは区切らない（営業中に数えると普通にあく）。区切りは人が決める
 */
import { toEpochMs } from './participantStats.js'

// 「ここで数えた」とみなす入れ方。overwrite（直す）・remove は数えた位置ではない
const COUNT_ACTIONS = new Set(['new', 'add', 'set'])

const _key = e => e?.enteredById || `name:${e?.enteredBy || ''}`

/**
 * 1回の棚卸から、担当者ごとの数えた順を作る。
 * @param {object} snap      履歴のスナップショット（auditLog / entryLog）
 * @param {Set<string>|null} known  今ある品目（無い品目は落とす）。null なら落とさない
 * @returns {{ who: string, items: string[] }[]} 数え始めの早い人から
 */
export function countSequences(snap, known = null) {
  const keep = n => typeof n === 'string' && n && (!known || known.has(n))
  const log = Array.isArray(snap?.auditLog) ? snap.auditLog : []
  const ops = log
    .map((e, i) => ({ e, i, t: toEpochMs(e?.timestamp) }))
    .filter(({ e }) => COUNT_ACTIONS.has(e?.action) && keep(e?.ingredient))
    .sort((a, b) => ((a.t ?? 0) - (b.t ?? 0)) || (a.i - b.i))
  if (ops.length) {
    const people = new Map()
    for (const { e } of ops) {
      const k = _key(e)
      if (!people.has(k)) people.set(k, { who: e.enteredBy || '名前未設定', items: [] })
      const list = people.get(k).items
      if (list[list.length - 1] !== e.ingredient) list.push(e.ingredient)
    }
    return [...people.values()]
  }
  // 変更履歴の無い古い記録は、初めて入れた順（1人ぶん）
  const entry = (Array.isArray(snap?.entryLog) ? snap.entryLog : []).filter(keep)
  return entry.length ? [{ who: '', items: [...new Set(entry)] }] : []
}

/**
 * 直近の棚卸（数えた順が取れるもの）を探す。
 * @param {object[]} snapshots 新しい順
 * @returns {{ snap: object, seqs: object[] } | null}
 */
export function latestCountOrder(snapshots, known = null) {
  for (const snap of snapshots ?? []) {
    if (snap?.importBatchId) continue           // 過去データの取込は数えた順を持たない
    const seqs = countSequences(snap, known)
    if (seqs.some(s => s.items.length >= 2)) return { snap, seqs }
  }
  return null
}

/**
 * 並び替え（軸）の品目の並びを数えた順に並べ直す（品目全体の並び＝ジャンル順の元は触らない）。
 * 数えた品目を先に（初めて出てきた順）、数えていない品目は今の順のまま後ろへ。
 * 割り当ては触らないので「各場所の中が数えた順・数えていない品目は各場所の末尾」になる。
 */
export function orderByCount(order, seqs) {
  const counted = []
  const seen = new Set()
  for (const s of seqs) for (const it of s.items) {
    if (!seen.has(it) && order.includes(it)) { seen.add(it); counted.push(it) }
  }
  return [...counted, ...order.filter(n => !seen.has(n))]
}

/** 数えた順の行（場所を作る画面用）。人の切れ目の位置も返す */
export function countRows(seqs) {
  const rows = []
  const personCuts = []
  const times = new Map()
  for (const s of seqs) {
    if (rows.length) personCuts.push(rows.length)
    for (const it of s.items) { rows.push({ item: it, who: s.who }); times.set(it, (times.get(it) || 0) + 1) }
  }
  for (const r of rows) r.multi = times.get(r.item) > 1
  return { rows, personCuts }
}

/** 区切り位置（行の番号）で行を場所に分ける */
export function splitRows(rows, cuts) {
  const places = []
  rows.forEach((r, i) => {
    if (!places.length || cuts.has(i)) places.push({ at: i, rows: [] })
    places[places.length - 1].rows.push({ ...r, i })
  })
  return places
}
