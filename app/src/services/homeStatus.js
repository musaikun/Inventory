/**
 * ホームの「本日の状況」に並べる行（User決定 2026-11-12・モック docs/mocks/home-status.html 案2）。
 * 今日のやること・定期（今日の回）・期限切れ・持ち越し・進行中を、同じ形（進み具合の棒）で1列に。
 * - 棒は済んだ割合（子タスク・チェック表の項目。項目が無ければ 済み=1／まだ=0）
 * - 進行中は「予定ではここまで」の印（plan: 始まり〜締め切りの今日の位置 0..1）
 * - 札は3つだけ: 遅れ（時刻・締め切りを過ぎた）／本日まで／明日まで（締め切りの前日に限って）
 * - 並び: 遅れ → 本日まで → 明日まで → 今日の時刻の順 → 今日の時刻なし → 締め切りの順。済んだものは出さない
 * 画面の状態に依らない純粋な関数（テストしやすいように）
 */

const _min = hm => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + (m || 0) }
const _md = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
const _hm = t => String(t).replace(/^0/, '')
const _day = k => Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)))
const _diff = (a, b) => Math.round((_day(a) - _day(b)) / 86400_000)   // a - b（日）
const _addDay = (k, n) => { const d = new Date(_day(k) + n * 86400_000); return d.toISOString().slice(0, 10) }
const _who = t => (t.assign === 'person' ? (t.assigneeName || '') : t.assign === 'all' ? '全員' : '')   // 「誰でも」（スタッフのいない店の既定）は出さない
const _steps = t => { const s = Array.isArray(t.steps) ? t.steps : []; return { done: s.filter(x => x.done).length, total: s.length } }

const RANK = { late: 0, today: 1, tmr: 2 }

/**
 * @param {object} p
 * @param {string} p.today 'YYYY-MM-DD'
 * @param {string} p.now   'HH:MM'
 * @param {Array} p.tasks      今日のやること（tasksOn。進行中を含んでいてもよい・外す）
 * @param {Array} p.overdue    期限切れ（overdueTasks）
 * @param {Array} p.carry      期限つきで前の日に作ったもの（carriedTasks）
 * @param {Array} p.checklists 今日の定期（checklistsForDay）
 * @param {Array} p.progress   進行中（progressTasks）
 * @param {(t) => boolean} p.isDone 済んだか（「全員」は自分が印を付けたか）
 * @param {number} [max] 出す行の上限（残りは more）
 */
export function homeStatus({ today, now, tasks = [], overdue = [], carry = [], checklists = [], progress = [], isDone = t => !!t.doneAt }, max = 8) {
  const nowMin = _min(now || '00:00')
  const tomorrow = _addDay(today, 1)
  // 締め切り（日付）から札
  const dueTag = d => {
    if (!d) return null
    if (d < today) { const n = _diff(today, d); return { k: 'late', label: `${n}日遅れ` } }
    if (d === today) return { k: 'today', label: '本日まで' }
    if (d === tomorrow) return { k: 'tmr', label: '明日まで' }
    return null
  }
  const rows = []
  const push = (r, group, key) => rows.push({ ...r, sort: [RANK[r.tag?.k] ?? 3, group, key] })

  // 今日のやること
  for (const t of tasks) {
    if (t.progress || isDone(t)) continue
    const s = _steps(t)
    const lateAt = t.endTime && t.endTime > (t.dueTime || '') ? t.endTime : t.dueTime
    const late = t.dueTime && _min(lateAt) < nowMin
    const tag = late ? { k: 'late', label: '遅れ' } : dueTag(t.deadline)
    push({
      key: t.id, ref: { type: 'task', id: t.id }, title: t.text, kind: '',
      pct: s.total ? s.done / s.total : 0, plan: null, tag,
      left: [_who(t), s.total ? `子タスク ${s.done}/${s.total}` : ''].filter(Boolean).join(' ・ '),
      right: t.dueTime ? `本日 ${_hm(t.dueTime)}${t.endTime ? `〜${_hm(t.endTime)}` : ''}` : '本日',
    }, t.dueTime ? 0 : 1, t.dueTime || '')
  }
  // 期限切れ（前の日のやること）
  for (const t of overdue) {
    if (isDone(t)) continue
    const s = _steps(t)
    push({
      key: t.id, ref: { type: 'task', id: t.id }, title: t.text, kind: '',
      pct: s.total ? s.done / s.total : 0, plan: null, tag: { k: 'late', label: `${_diff(today, t.deadline && t.deadline < today ? t.deadline : t.date)}日遅れ` },
      left: [_who(t), s.total ? `子タスク ${s.done}/${s.total}` : ''].filter(Boolean).join(' ・ '),
      right: _md(t.date),
    }, -1, t.date)
  }
  // 持ち越し（期限つき・まだ締め切り前）
  for (const t of carry) {
    if (isDone(t)) continue
    const s = _steps(t)
    push({
      key: t.id, ref: { type: 'task', id: t.id }, title: t.text, kind: '',
      pct: s.total ? s.done / s.total : 0, plan: null, tag: dueTag(t.deadline),
      left: [_who(t), s.total ? `子タスク ${s.done}/${s.total}` : ''].filter(Boolean).join(' ・ '),
      right: t.deadline === today ? '本日まで' : `${_md(t.deadline)}まで`,
    }, 2, t.deadline)
  }
  // 定期（今日の回）
  for (const r of checklists) {
    const many = r.slots.length > 1
    r.slots.forEach((s, i) => {
      if (s.complete) return
      const late = s.slot && _min(s.slot) < nowMin
      const simple = !s.total || (s.total === 1 && r.cl.items?.length === 0)
      push({
        key: `cl:${r.cl.id}:${s.slot}`, ref: { type: 'list', clId: r.cl.id, slot: s.slot }, title: many ? `${r.cl.name}（${i + 1}回目）` : r.cl.name, kind: '定期',
        pct: s.total ? s.filled / s.total : 0, plan: null, tag: late ? { k: 'late', label: '遅れ' } : null,
        left: [_who(r.cl), simple ? '' : `${s.filled}/${s.total}`].filter(Boolean).join(' ・ '),
        right: s.slot ? `本日 ${_hm(s.slot)}` : '本日',
      }, s.slot ? 0 : 1, s.slot || '')
    })
  }
  // 進行中（予定ではここまでの印つき）
  for (const t of progress) {
    if (t.doneAt) continue
    const s = _steps(t)
    const start = t.date || (t.createdAt || '').slice(0, 10) || today
    let plan = null
    if (t.deadline) {
      const S = _day(start), E = _day(t.deadline), T = _day(today)
      plan = E > S ? Math.min(1, Math.max(0, (T - S) / (E - S))) : 1
    }
    const end = !t.deadline ? '' : t.deadline === today ? '本日' : _md(t.deadline)
    push({
      key: t.id, ref: { type: 'progress', id: t.id }, title: t.text, kind: '進行中',
      pct: s.total ? s.done / s.total : 0, plan, tag: dueTag(t.deadline),
      left: [_who(t), s.total ? `手順 ${s.done}/${s.total}` : '', t.progress === 'waiting' ? '待ち' : ''].filter(Boolean).join(' ・ '),
      right: start > today ? `${_md(start)}から` : t.deadline ? `${_md(start)}〜${end}` : `${_md(start)}〜 締め切りなし`,
    }, 3, t.deadline || '9999')
  }

  rows.sort((a, b) => a.sort[0] - b.sort[0] || a.sort[1] - b.sort[1] || String(a.sort[2]).localeCompare(String(b.sort[2])))
  const out = rows.map(({ sort, ...r }) => r)
  return { rows: out.slice(0, max), more: Math.max(0, out.length - max), progressCount: progress.filter(t => !t.doneAt).length }
}
