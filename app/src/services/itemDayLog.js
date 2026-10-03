// 1品目の「日ごとの動き」。品目シートのカレンダーと日の明細に使う（User決定 2026-10-03）。
// 純関数・書き込みなし。
//
// - 入庫と出庫は差し引かず、日ごとに別々に足す（カレンダーのマスは「+6 / −2」の2段表示）
// - 棚卸した日は、その日に数えた数（同じ日に2回なら後の方）
// - 取り消した入出庫（deletedAt）は数に入れないが、明細には「取り消し済み」として残す
import { findLine, linesOf } from '../utils/lineIndex.js'

function _time(iso) {
  const d = new Date(iso || '')
  if (isNaN(d)) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * @param {string} item
 * @param {Array} movements useMovements.getMovements()
 * @param {Array} snapshots useHistory.getSnapshots()
 * @returns {{ days: Object<string, {in:number,out:number,st:number|null}>, entries: Object<string, Array> }}
 *   entries[date] = [{ key, kind:'in'|'out'|'st', qty, unit, time, at, by, movementId, deleted }]（時刻の古い順）
 */
export function itemDayLog(item, movements = [], snapshots = []) {
  const days = {}
  const entries = {}
  const day = d => (days[d] ??= { in: 0, out: 0, st: null })
  const push = (d, e) => (entries[d] ??= []).push(e)

  for (const m of movements) {
    if (!m || !Array.isArray(m.lines) || !m.date) continue
    for (const l of linesOf(m.lines, item)) {
      const q = Number(l.qty)
      if (!Number.isFinite(q) || q <= 0) continue
      const kind = m.type === 'out' ? 'out' : 'in'
      const deleted = !!m.deletedAt
      if (!deleted) day(m.date)[kind] += q
      push(m.date, {
        key: `${m.id}:${kind}`, kind, qty: q, unit: l.unit || '', at: m.savedAt || '', time: _time(m.savedAt),
        by: m.by || '', movementId: m.id, deleted, deletedAt: m.deletedAt || null,
      })
    }
  }

  const stAt = {}
  for (const s of snapshots) {
    const line = findLine(s?.items, item, i => i.qty != null)
    if (!line || !s.date) continue
    const at = s.savedAt || ''
    if (stAt[s.date] == null || at > stAt[s.date]) { stAt[s.date] = at; day(s.date).st = Number(line.qty) }
    push(s.date, {
      key: `st:${s.sessionId || s.date}:${at}`, kind: 'st', qty: Number(line.qty), unit: line.unit || '',
      at, time: _time(at), by: '', movementId: null, deleted: false,
    })
  }

  for (const list of Object.values(entries)) list.sort((a, b) => (a.at || '').localeCompare(b.at || ''))
  for (const d of Object.values(days)) { d.in = Math.round(d.in * 1000) / 1000; d.out = Math.round(d.out * 1000) / 1000 }
  return { days, entries }
}
