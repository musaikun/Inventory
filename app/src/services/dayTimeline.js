// 日誌のその日の中身を、タイムラインの行に組み立てる（User決定 2026-10-26・モック キャンバス「日誌カレンダー」①）。
// 何をやったか・これから何をするか。時刻のないもの（期限切れ・時刻なしのやること・進行中・メモ）は「終日」に
// state: done（済み）| todo（まだ）| missed（過ぎた日のやり残し）| live（途中）| plan（先の日の予定）
// 画面には依存しない（材料は引数で受け取る）
import { stockTimeLabel, fmtHm } from './journalRecords.js'
import { isSimple } from './checklistSchedule.js'

const _hm = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : fmtHm(d.getTime()) }
// 並べるための時刻（'09:05'。fmtHm は '9:05' なので文字の順にならない）
const _hhmm = v => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
const _md = k => { const [, m, d] = String(k).split('-').map(Number); return m ? `${m}/${d}` : '' }

/**
 * @param {object} p
 * @param {string} p.date その日
 * @param {string} p.today 今日
 * @param {object[]} p.tasks その日のやること（進行中は除く）
 * @param {object[]} [p.late] 今日だけ: 前の日から残っているやること
 * @param {object[]} [p.carry] 今日だけ: 期限がまだ先の、前の日からのやること
 * @param {object[]} [p.progress] 今日だけ: 次に見る日が来た進行中
 * @param {object[]} p.lists その日のルーティン（dayChecklist）
 * @param {object[]} p.records 棚卸・発注・入出庫（journalRecords）
 * @param {{ kind: 'stock'|'order', session: object, count: number }[]} [p.live] 今日だけ: 途中の棚卸・発注
 * @param {string} [p.note] その日のメモ
 * @param {object[]} [p.someday] 今日だけ: いつか（日付なし）。数には入れない
 * @param {{ name: string, time: string }[]} [p.plans] 今日と先の日: 発注の締切（発注スケジュール）。数には入れない
 */
export function buildDayTimeline({ date, today, tasks = [], late = [], carry = [], progress = [], lists = [], records = [], live = [], note = '', someday = [], plans = [] }) {
  const past = date < today, future = date > today
  const _taskState = t => (t.doneAt ? 'done' : past ? 'missed' : future ? 'plan' : 'todo')
  const _who = t => (t.assign === 'person' ? t.assigneeName || '' : '')
  const out = []
  for (const t of late) out.push({ key: t.id, time: '', kind: 'やること', title: t.text, sub: [`${_md(t.date)}から`, _who(t)].filter(Boolean).join(' ・ '), state: 'missed', ref: { type: 'task', task: t } })
  for (const t of carry) out.push({ key: t.id, time: '', kind: 'やること', title: t.text, sub: [`期限 ${_md(t.deadline)}`, _who(t)].filter(Boolean).join(' ・ '), state: 'todo', ref: { type: 'task', task: t } })
  for (const t of progress) out.push({ key: t.id, time: '', kind: '進行中', title: t.text, sub: [t.progress === 'waiting' ? `待ち${t.waitNote ? `・${t.waitNote}` : ''}` : '', t.lastNote?.body || '', _who(t)].filter(Boolean).join(' ・ '), state: 'live', ref: { type: 'progress', task: t } })
  for (const t of tasks) {
    const sub = t.doneAt ? [t.doneBy, _hm(t.doneAt)].filter(Boolean).join(' ') : [t.deadline ? `期限 ${_md(t.deadline)}` : '', _who(t)].filter(Boolean).join(' ・ ')
    out.push({ key: t.id, time: t.dueTime || '', kind: 'やること', title: t.text, sub, state: _taskState(t), ref: { type: 'task', task: t } })
  }
  for (const r of lists) {
    const many = r.slots.length > 1
    r.slots.forEach((s, i) => {
      const by = Object.values(s.marks).map(m => m?.by).filter(Boolean)[0] || ''
      const count = isSimple(r.cl) ? '' : `${s.filled}/${s.total}`
      const sub = s.complete ? [by && `${by} ${s.lastAt ? _hm(s.lastAt) : ''}`.trim(), count].filter(Boolean).join(' ・ ') : count
      const state = s.complete ? 'done' : past ? 'missed' : future ? 'plan' : 'todo'
      out.push({ key: `cl-${r.cl.id}-${s.slot}`, time: s.slot || '', kind: 'ルーティン', title: many ? `${r.cl.name}（${i + 1}回目）` : r.cl.name, sub, state, ref: { type: 'list', run: s } })
    })
  }
  const REC = { stock: '棚卸', order: '発注', in: '入庫', out: '出庫' }
  for (const r of records) {
    const sub = r.kind === 'stock' ? [stockTimeLabel(r), r.by].filter(Boolean).join(' ・ ') : [r.by, r.lines?.slice(0, 3).map(l => l.item).join('・')].filter(Boolean).join(' ・ ')
    out.push({ key: r.key, time: r.at != null ? _hhmm(r.at) : '', kind: REC[r.kind] || '記録', title: r.title, sub, state: 'done', ref: { type: 'record', rec: r } })
  }
  for (const l of live) {
    out.push({ key: `live-${l.kind}`, time: l.session?.startedAt ? _hhmm(l.session.startedAt) : '', kind: l.kind === 'order' ? '発注' : '棚卸', title: `${l.kind === 'order' ? '発注' : '棚卸'} 途中`, sub: `${l.count}品目`, state: 'live', ref: { type: 'live', session: l.session } })
  }
  for (const t of someday) out.push({ key: t.id, time: '', kind: 'いつか', title: t.text, sub: _who(t), state: 'todo', someday: true, ref: { type: 'task', task: t } })
  if (!past) for (const pl of plans) out.push({ key: `plan-${pl.name}-${pl.time}`, time: pl.time || '', kind: '発注', title: `発注の締切（${pl.name}）`, sub: '', state: 'plan', info: true, ref: { type: 'plan' } })
  if (note) out.push({ key: 'note', time: '', kind: 'メモ', title: note, sub: '', state: 'info', ref: { type: 'note' } })
  const allDay = out.filter(x => !x.time)
  const timed = out.filter(x => x.time).sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
  const counted = out.filter(x => x.state !== 'plan' && x.state !== 'info' && x.ref.type !== 'record' && x.ref.type !== 'live' && x.ref.type !== 'progress' && !x.someday && !x.info)
  return { allDay, timed, done: counted.filter(x => x.state === 'done').length, count: counted.length }
}
