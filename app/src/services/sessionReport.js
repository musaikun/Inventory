/**
 * 完了した棚卸の「レポート」。**ホストにだけ見せる**（金額を含むため）。
 *
 * 品目一覧を1行ずつ追うのではなく、**その棚卸が信用できるかを先に判断する**ための面。
 * だから件数と金額だけでなく、「金額に入っていない品目が何件あるか」「何品目を
 * 複数人が触ったか」を必ず出す。合計金額だけを大きく出すと、実際には単価未設定で
 * 半分しか計上されていない数字を、正しい在庫金額だと誤読させる。
 *
 * 入力はスナップショット（`useHistory.buildSnapshot` の出力）だけ。副作用は持たない。
 */

import { participantStats, sharedItemCounts } from './participantStats.js'

/** 金額差の大きい品目を何件まで出すか */
export const MOVER_LIMIT = 5

function _num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** 品目 → 小計。金額のある品目だけ入る。 */
function _subtotals(snapshot) {
  const m = new Map()
  for (const it of (snapshot?.items ?? [])) {
    if (it?.item && it.subtotal != null) m.set(it.item, it.subtotal)
  }
  return m
}

/**
 * 前回との比較。**両方に金額がある品目だけ**を比べる。
 * 片方が単価未設定の品目を 0 として扱うと、単価を入れ忘れただけで
 * 「在庫が丸ごと消えた」ように見える差分が出る。
 */
function _compare(snapshot, prev) {
  if (!prev) return null

  const curr = _subtotals(snapshot)
  const before = _subtotals(prev)

  const currItems = new Set((snapshot?.items ?? []).filter(i => i?.qty != null).map(i => i.item))
  const prevItems = new Set((prev?.items ?? []).filter(i => i?.qty != null).map(i => i.item))

  const movers = []
  for (const [item, now] of curr) {
    if (!before.has(item)) continue
    const diff = now - before.get(item)
    if (diff !== 0) movers.push({ item, prev: before.get(item), curr: now, diff })
  }
  movers.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || a.item.localeCompare(b.item, 'ja'))

  const currTotal = _num(snapshot?.totalValue)
  const prevTotal = _num(prev?.totalValue)
  const valueDiff = currTotal != null && prevTotal != null ? currTotal - prevTotal : null

  return {
    date: prev?.date ?? null,
    totalValue: prevTotal,
    valueDiff,
    // 前回が 0 円のときは割合を出さない（∞ や 0除算を画面へ出さない）
    valuePct: valueDiff != null && prevTotal ? Math.round((valueDiff / prevTotal) * 1000) / 10 : null,
    itemDiff: currItems.size - prevItems.size,
    addedItems:   [...currItems].filter(i => !prevItems.has(i)).length,
    removedItems: [...prevItems].filter(i => !currItems.has(i)).length,
    movers: movers.slice(0, MOVER_LIMIT),
    moversTruncated: Math.max(0, movers.length - MOVER_LIMIT),
  }
}

/**
 * @param {object} snapshot 対象の棚卸スナップショット
 * @param {object|null} prev 直前に完了した棚卸（無ければ null）
 */
export function buildSessionReport(snapshot, prev = null) {
  const items = Array.isArray(snapshot?.items) ? snapshot.items : []

  const filled = items.filter(i => i?.qty != null)
  // 「数量は入っているのに単価が無い」＝ 合計金額に**入っていない**品目。
  // レポートの信頼性はここで決まるので、必ず数えて表に出す。
  const unpriced = filled.filter(i => i.unitPrice == null)

  const people = participantStats(snapshot)
  const shared = sharedItemCounts(snapshot)
  const sharedItems = Object.values(shared).filter(n => n > 1).length

  return {
    date:     snapshot?.date ?? null,
    savedAt:  snapshot?.savedAt ?? null,
    activeMs: _num(snapshot?.activeMs),

    items: {
      total:   items.length,
      filled:  filled.length,
      missing: items.length - filled.length,
      flagged: Array.isArray(snapshot?.flaggedItems) ? snapshot.flaggedItems.length : 0,
    },

    value: {
      total:         _num(snapshot?.totalValue),
      pricedCount:   filled.length - unpriced.length,
      unpricedCount: unpriced.length,
      // 金額が一部しか計上されていない棚卸かどうか。画面の注意書きの出し分けに使う。
      partial:       unpriced.length > 0,
    },

    people: {
      count:       people.length,
      sharedItems,                                   // 複数人が触った品目数
      approximate: people.some(p => p.approximate),  // 操作ログが無く品目単位でしか数えられていない
      list: people.map(p => ({
        name: p.name, count: p.count, itemCount: p.itemCount,
        sharedCount: p.sharedCount, totalValue: p.totalValue,
      })),
    },

    prev: _compare(snapshot, prev),
  }
}

/**
 * 履歴一覧から「この棚卸の直前に完了したもの」を選ぶ。
 * 同じセッションは除く。日付が同じでも保存時刻で前後を決める（同日2回に対応する）。
 */
export function findPrevSnapshot(snapshot, all = []) {
  const ts = (s) => {
    const raw = s?.savedAt ? new Date(s.savedAt).getTime()
              : s?.date    ? new Date(`${s.date}T00:00:00`).getTime()
              : NaN
    return Number.isFinite(raw) ? raw : null
  }
  const base = ts(snapshot)
  if (base == null) return null

  let best = null, bestTs = -Infinity
  for (const s of all) {
    if (!s || s === snapshot) continue
    if (s.sessionId && snapshot?.sessionId && s.sessionId === snapshot.sessionId) continue
    const t = ts(s)
    if (t == null || t >= base) continue
    if (t > bestTs) { best = s; bestTs = t }
  }
  return best
}
