/**
 * ホームの「今日のやること」に出す、気になる順の一覧（User決定 2026-11-06・モック docs/mocks/home-trim.html）。
 * 期限切れ → 遅れ（時刻を過ぎてまだ）→ 止まっている（進行中で動いていない）→ 自分の → 次の時刻、の順。
 * 件数は全部を数え、一覧は max 行まで（残りは more）。画面の状態に依らない純粋な関数（テストしやすいように）
 */

const _min = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m }
const _md = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
const _late = mins => (mins >= 60 ? `遅れ ${Math.floor(mins / 60)}時間` : `遅れ ${mins}分`)
const _who = t => (t.assign === 'all' ? '全員' : t.assign === 'person' ? (t.assigneeName || '') : '')

/**
 * @param {object} p
 * @param {Array} p.today      今日のやること（tasksOn）
 * @param {Array} p.overdue    期限切れ（overdueTasks）
 * @param {Array} p.stale      止まっている進行中（isStale のもの）
 * @param {Array} p.checklists 今日のチェック表（checklistsForDay）
 * @param {string} p.now       今の時刻 'HH:MM'
 * @param {(t) => boolean} p.isMine   自分の担当か
 * @param {(t) => boolean} p.isDone   済んだか（「全員」は自分が印を付けたか）
 */
export function homeAttention({ today = [], overdue = [], stale = [], checklists = [], now, isMine = () => false, isDone = t => !!t.doneAt }, max = 5) {
  const nowMin = _min(now)
  const rows = []
  for (const t of overdue) rows.push({ key: t.id, kind: 'over', tag: '期限切れ', text: t.text, side: _md(t.date), mine: isMine(t) })

  const open = today.filter(t => !t.progress && !isDone(t))
  // 遅れの境目: 終わりの時刻があれば終わり、無ければ始まり（店の今の帯と同じ）
  const lateAt = t => (t.endTime && t.endTime > t.dueTime ? t.endTime : t.dueTime)
  const lateTasks = open.filter(t => t.dueTime && _min(lateAt(t)) < nowMin)
  const lateCls = []
  for (const r of checklists) {
    const s = r.slots.find(x => x.slot && !x.complete && _min(x.slot) < nowMin)
    if (s) lateCls.push({ r, s })
  }
  const late = [
    ...lateTasks.map(t => ({ at: lateAt(t), row: { key: t.id, kind: 'late', tag: _late(nowMin - _min(lateAt(t))), text: t.text, side: _who(t), mine: isMine(t) } })),
    ...lateCls.map(({ r, s }) => ({ at: s.slot, row: { key: `cl:${r.cl.id}:${s.slot}`, kind: 'late', tag: _late(nowMin - _min(s.slot)), text: `${r.cl.name}（${s.filled}/${s.total}）`, side: '全員', mine: false, checklist: true } })),
  ].sort((a, b) => a.at.localeCompare(b.at)).map(x => x.row)
  rows.push(...late)

  for (const t of stale) rows.push({ key: t.id, kind: 'stuck', tag: '止まっている', text: t.text, side: _who(t) || '担当なし', mine: isMine(t) })

  const lateIds = new Set(lateTasks.map(t => t.id))
  const rest = open.filter(t => !lateIds.has(t.id))
  const mine = rest.filter(isMine)
  for (const t of mine) rows.push({ key: t.id, kind: 'mine', tag: 'あなた', text: t.text, side: t.dueTime || '今日', mine: true })
  for (const t of rest.filter(t => !isMine(t))) rows.push({ key: t.id, kind: 'next', tag: t.dueTime || '今日', text: t.text, side: _who(t), mine: false })

  const counts = {
    over: overdue.length,
    late: late.length,
    stuck: stale.length,
    mine: rows.filter(r => r.mine && r.kind !== 'next').length,
  }
  return { rows: rows.slice(0, max), more: Math.max(0, rows.length - max), counts }
}
