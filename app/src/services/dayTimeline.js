// 日誌のその日の中身を、タイムラインの行に組み立てる（User決定 2026-10-26・モック キャンバス「日誌カレンダー」①）。
// 何をやったか・これから何をするか。時刻のないもの（期限切れ・時刻なしのやること・進行中・メモ）は「終日」に
// state: done（済み）| todo（まだ）| missed（過ぎた日のやり残し）| live（途中）| plan（先の日の予定）
// 棚卸（始め・終わりのある記録）は区間に（User決定 2026-10-26・キャンバス⑤）: 開始・中断・再開・終了の小さな行（ev）と、
// 縦の線の横の帯（band: start | solid | hatch（中断）| end）。かぶった業務には during（棚卸の最中／棚卸の中断中）
// 画面には依存しない（材料は引数で受け取る）
import { stockTimeLabel, fmtHm, fmtDuration } from './journalRecords.js'
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
 */
export function buildDayTimeline({ date, today, tasks = [], late = [], carry = [], progress = [], lists = [], records = [], live = [], note = '', someday = [] }) {
  const past = date < today, future = date > today
  const _taskState = t => (t.doneAt ? 'done' : past ? 'missed' : future ? 'plan' : 'todo')
  const _who = t => (t.assign === 'person' ? t.assigneeName || '' : '')
  const out = []
  for (const t of late) out.push({ key: t.id, time: '', kind: 'やること', title: t.text, sub: [`${_md(t.date)}から`, _who(t)].filter(Boolean).join(' ・ '), state: 'missed', note: t.note || '', ref: { type: 'task', task: t } })
  for (const t of carry) out.push({ key: t.id, time: '', kind: 'やること', title: t.text, sub: [`期限 ${_md(t.deadline)}`, _who(t)].filter(Boolean).join(' ・ '), state: 'todo', note: t.note || '', ref: { type: 'task', task: t } })
  for (const t of progress) out.push({ key: t.id, time: '', kind: '進行中', title: t.text, sub: [t.progress === 'waiting' ? `待ち${t.waitNote ? `・${t.waitNote}` : ''}` : '', t.lastNote?.body || '', _who(t)].filter(Boolean).join(' ・ '), state: 'live', ref: { type: 'progress', task: t } })
  for (const t of tasks) {
    const sub = t.doneAt ? [t.doneBy, _hm(t.doneAt)].filter(Boolean).join(' ') : [t.deadline ? `期限 ${_md(t.deadline)}` : '', _who(t)].filter(Boolean).join(' ・ ')
    out.push({ key: t.id, time: t.dueTime || '', kind: 'やること', title: t.text, sub, state: _taskState(t), note: t.note || '', ref: { type: 'task', task: t } })
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
  const spans = []
  for (const r of records) {
    if (r.kind === 'stock' && !r.imported && r.at != null && r.end != null && r.end > r.at) {
      const ref = { type: 'record', rec: r }
      const pauses = (r.pauses ?? []).map(p => ({ from: p.from, to: p.to }))
      spans.push({ key: r.key, from: r.at, to: r.end, pauses })
      out.push({ key: `${r.key}-s`, time: _hhmm(r.at), ev: 'start', span: r.key, kind: '棚卸', title: '棚卸 開始', sub: r.by || '', state: 'done', ref })
      pauses.forEach((p, i) => {
        out.push({ key: `${r.key}-p${i}`, time: _hhmm(p.from), ev: 'pause', span: r.key, kind: '棚卸', title: `中断 ${fmtDuration(p.to - p.from)}`, sub: `${fmtHm(p.from)}〜${fmtHm(p.to)}`, state: 'done', ref })
        out.push({ key: `${r.key}-r${i}`, time: _hhmm(p.to), ev: 'resume', span: r.key, kind: '棚卸', title: '再開', sub: '', state: 'done', ref })
      })
      out.push({ key: `${r.key}-e`, time: _hhmm(r.end), ev: 'end', span: r.key, kind: '棚卸', title: r.title, sub: stockTimeLabel(r), state: 'done', ref, pauseCount: pauses.length, pauseMs: pauses.reduce((n, p) => n + (p.to - p.from), 0) })
      continue
    }
    const sub = r.kind === 'stock' ? [stockTimeLabel(r), r.by].filter(Boolean).join(' ・ ') : [r.by, r.lines?.slice(0, 3).map(l => l.item).join('・')].filter(Boolean).join(' ・ ')
    out.push({ key: r.key, time: r.at != null ? _hhmm(r.at) : '', kind: REC[r.kind] || '記録', title: r.title, sub, state: 'done', ref: { type: 'record', rec: r } })
  }
  for (const l of live) {
    out.push({ key: `live-${l.kind}`, time: l.session?.startedAt ? _hhmm(l.session.startedAt) : '', kind: l.kind === 'order' ? '発注' : '棚卸', title: `${l.kind === 'order' ? '発注' : '棚卸'} 途中`, sub: `${l.count}品目`, state: 'live', ref: { type: 'live', session: l.session } })
  }
  for (const t of someday) out.push({ key: t.id, time: '', kind: 'いつか', title: t.text, sub: _who(t), state: 'todo', someday: true, ref: { type: 'task', task: t } })
  if (note) out.push({ key: 'note', time: '', kind: 'メモ', title: note, sub: '', state: 'info', ref: { type: 'note' } })
  const allDay = out.filter(x => !x.time)
  const EV = { start: 0, pause: 1, resume: 2, end: 4 }
  const timed = out.filter(x => x.time).sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0) || (EV[a.ev] ?? 3) - (EV[b.ev] ?? 3))
  // 帯とかぶり: その日の分（時刻）で比べる
  const _min = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m }
  const _mm = ms => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes() }
  for (const x of timed) {
    const t = _min(x.time)
    const sp = spans.find(z => (x.span ? z.key === x.span : t >= _mm(z.from) && t <= _mm(z.to)))
    if (!sp) continue
    const paused = sp.pauses.some(p => t >= _mm(p.from) && t < _mm(p.to))
    x.band = x.ev === 'start' ? 'start' : x.ev === 'end' ? 'end' : x.ev === 'pause' || (paused && x.ev !== 'resume') ? 'hatch' : 'solid'
    if (!x.ev && t >= _mm(sp.from) && t <= _mm(sp.to)) x.during = paused ? '棚卸の中断中' : '棚卸の最中'
  }
  const counted = out.filter(x => x.state !== 'plan' && x.state !== 'info' && x.ref.type !== 'record' && x.ref.type !== 'live' && !x.ev && x.ref.type !== 'progress' && !x.someday && !x.info)
  return { allDay, timed, done: counted.filter(x => x.state === 'done').length, count: counted.length }
}
