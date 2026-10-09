// 日誌の「記録」（実行した棚卸・発注・入出庫）を日ごとに組み立てる（User決定 2026-10-09）。
//
// - 棚卸: 始め〜終わり。操作が5分以上なかった区間は「中断」（棚卸の変更の記録の時刻から割り出す。
//   今は実働時間の合計しか保存していないので、区間は記録の時刻の空きで見る。過去の棚卸にも使える）
// - 発注: 同じ発注（sessionId）でまとめる（仕入先ごとに分かれて保存されている）
// - 入出庫: 品目シートで1つずつ入れたもの（isQuickMovement）は、同じ種類で30分以内に続いたものを1件にまとめる。
//   納品の取込・発注からの入庫など、まとめて入れた記録はそのまま
// 画面には依存しない（テストしやすいように、材料は引数で受け取る）
import { isQuickMovement } from './itemDayLog.js'

export const PAUSE_MS = 5 * 60 * 1000
export const MOVE_MERGE_MS = 30 * 60 * 1000

const _ms = v => {
  if (v == null || v === '') return null
  const t = typeof v === 'number' ? v : Date.parse(v)
  return Number.isFinite(t) ? t : null
}

/**
 * 作業の区間と中断。stamps は入力の時刻（ミリ秒）。始め・終わりが無ければ stamps の最初・最後。
 * 中断＝隣り合う入力の間が PAUSE_MS 以上空いたところ（始め〜最初の入力、最後の入力〜終わりは数えない）。
 */
export function workSpans(start, end, stamps = []) {
  const ts = stamps.map(_ms).filter(t => t != null).sort((a, b) => a - b)
  const from = _ms(start) ?? ts[0] ?? null
  const to = _ms(end) ?? ts[ts.length - 1] ?? null
  const pauses = []
  for (let i = 1; i < ts.length; i++) {
    const gap = ts[i] - ts[i - 1]
    if (gap >= PAUSE_MS) pauses.push({ from: ts[i - 1], to: ts[i], ms: gap })
  }
  const total = from != null && to != null ? Math.max(0, to - from) : null
  const activeMs = total != null ? Math.max(0, total - pauses.reduce((s, p) => s + p.ms, 0)) : null
  return { from, to, pauses, activeMs }
}

/** 品目シートで1つずつ入れた入出庫を、同じ種類・30分以内の続きで1件にまとめる */
export function mergeMovements(moves = []) {
  const out = []
  const alive = moves.filter(m => !m.deletedAt)
  for (const type of ['in', 'out']) {
    const quick = alive.filter(m => m.type === type && isQuickMovement(m)).sort((a, b) => (_ms(a.savedAt) ?? 0) - (_ms(b.savedAt) ?? 0))
    let cur = null
    for (const m of quick) {
      const t = _ms(m.savedAt) ?? 0
      if (cur && t - cur.last <= MOVE_MERGE_MS) {
        cur.moves.push(m); cur.last = t
      } else {
        cur = { moves: [m], first: t, last: t }
        out.push(cur)
      }
    }
    for (const m of alive.filter(x => x.type === type && !isQuickMovement(x))) {
      const t = _ms(m.savedAt) ?? 0
      out.push({ moves: [m], first: t, last: t })
    }
  }
  return out.map(g => {
    const m0 = g.moves[0]
    const byItem = new Map()
    for (const m of g.moves) for (const l of m.lines ?? []) {
      const cur = byItem.get(l.item)
      if (cur) cur.qty = Math.round((cur.qty + Number(l.qty)) * 1000) / 1000
      else byItem.set(l.item, { item: l.item, qty: Number(l.qty), unit: l.unit || '' })
    }
    const lines = [...byItem.values()]
    const kind = m0.type === 'out' ? 'out' : 'in'
    return {
      key: `${kind}-${m0.id}`, kind, at: g.first, end: g.moves.length > 1 ? g.last : null,
      title: `${kind === 'out' ? '出庫' : '入庫'} ${lines.length}品目`,
      by: [...new Set(g.moves.map(m => m.by).filter(Boolean))].join('・'),
      note: m0.note || (m0.source === 'import' ? '取込' : ''),
      lines, count: g.moves.length,
    }
  })
}

/** 発注は同じ発注（sessionId）で1件に。sessionId の無いものはそのまま */
export function mergeOrders(orders = []) {
  const groups = new Map()
  for (const o of orders) {
    const k = o.sessionId || o.id
    ;(groups.get(k) ?? groups.set(k, []).get(k)).push(o)
  }
  return [...groups.values()].map(list => {
    const at = Math.min(...list.map(o => _ms(o.savedAt) ?? Infinity))
    const lines = list.flatMap(o => (o.lines ?? []).map(l => ({ ...l, supplier: o.supplier || '' })))
    const suppliers = [...new Set(list.map(o => o.supplier).filter(Boolean))]
    return {
      key: `order-${list[0].sessionId || list[0].id}`, kind: 'order', at: Number.isFinite(at) ? at : null, end: null,
      title: `発注 ${suppliers.length > 1 ? `${suppliers.length}社 ` : ''}${lines.length}品目`,
      by: '', note: suppliers.join('・'), lines, sessionId: list[0].sessionId ?? null,
    }
  })
}

/**
 * その日の棚卸の記録。sessions は完了した棚卸（日付はカレンダーと同じ決め方で呼び出し側が絞る）。
 * snapshotOf(id) → 端末にある明細（auditLog の時刻・参加者・金額）
 */
export function stockRecords(sessions = [], snapshotOf = () => null) {
  return sessions.map(s => {
    const snap = snapshotOf(s.id)
    const stamps = (snap?.auditLog ?? []).map(e => e.timestamp)
    const imported = !!s.importBatchId
    const span = imported ? { from: null, to: null, pauses: [], activeMs: null } : workSpans(s.startedAt, s.endedAt, stamps)
    const people = (snap?.participants ?? []).map(p => ({ name: p.name, count: p.items?.length ?? 0 }))
    const items = snap ? snap.items.filter(i => i.qty != null).length : (s.itemCount ?? 0)
    return {
      key: `stock-${s.id}`, kind: 'stock', at: span.from, end: span.to, pauses: span.pauses,
      activeMs: snap?.activeMs ?? span.activeMs,
      title: `棚卸 完了 ・ ${items}品目`, items, imported,
      by: people.map(p => p.name).join('・'), people,
      total: snap?.totalValue ?? null, session: s,
    }
  })
}

/** 1日の記録を時刻の順に（時刻の無いもの＝取込などは最後） */
export function sortRecords(list) {
  return [...list].sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity))
}

export function fmtDuration(ms) {
  if (ms == null) return ''
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}分`
  return `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ''}`
}
export function fmtHm(ms) {
  if (ms == null) return ''
  const d = new Date(ms)
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * 棚卸が載る日（カレンダーと同じ決め方）。通常は終わった日（深夜に終えた棚卸も作業日へ）。
 * 取込は終わりが「取り込んだ日時」なので、始め（実施日 'YYYY-MM-DD…'）の日付だけを使う
 */
export function stockDateKey(s, snap = null) {
  const imported = !!s?.importBatchId || snap?.source === 'import' || !!snap?.importBatchId
  if (imported) {
    const d = String(s.startedAt || '').slice(0, 10) || snap?.date || ''
    if (d) return d
  }
  const v = String(s?.endedAt ?? s?.startedAt ?? '')
  if (!v) return ''
  if (!v.includes('T')) return v.slice(0, 10)
  const t = new Date(v)
  if (Number.isNaN(t.getTime())) return v.slice(0, 10)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}
