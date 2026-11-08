/**
 * ホームの「店の今」カード（User決定 2026-11-08・モック docs/mocks/home-now.html の ①② だけ）。
 * ① 今日の流れ: 人×時間の小さなガント。時刻のあるやること・チェック表の回を、担当の行に帯で。今の線
 * ② 進行中: 何日かかかるもの。作った日→締め切りの棒に今日の印、手順の進み、止まっている・締め切り過ぎ
 * 画面の状態に依らない純粋な関数（テストしやすいように）
 */

export const FLOW_MAX_ROWS = 5
export const PROG_MAX = 4
const DEFAULT_MIN = 30   // 終わりの無いものは30分の帯に

const _m = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m }
const _day = k => Date.parse(`${k}T00:00:00`)

/** 帯の状態: 済み / 今 / 遅れ / これから */
// 遅れの境目は「終わり」。終わりの無いものは始まりを過ぎたら遅れ（ホームの今日のやることと同じ・homeAttention）
export function blockState({ start, end, done, lateAt = end }, now) {
  if (done) return 'done'
  if (lateAt <= now) return 'late'
  if (start <= now && now < end) return 'now'
  return 'plan'
}

/**
 * @param {object} p
 * @param {Array} p.tasks       今日のやること（tasksOn）
 * @param {Array} p.checklists  今日のチェック表（checklistsForDay）
 * @param {string} p.now        'HH:MM'
 * @param {(t) => boolean} [p.isDone]
 * @returns {{ rows: { key, name, blocks: { key, text, start, end, state }[] }[], from: number, to: number, now: number, more: number }}
 */
export function todayFlow({ tasks = [], checklists = [], now, isDone = t => !!t.doneAt }) {
  const nowM = _m(now)
  const items = []
  for (const t of tasks) {
    if (!t.dueTime || t.progress) continue
    const start = _m(t.dueTime)
    const end = t.endTime && _m(t.endTime) > start ? _m(t.endTime) : start + DEFAULT_MIN
    const hasEnd = !!t.endTime && _m(t.endTime) > start
    items.push({ key: t.id, text: t.text, start, end, lateAt: hasEnd ? end : start, done: isDone(t), ...who(t) })
  }
  for (const r of checklists) {
    for (const s of r.slots) {
      if (!s.slot) continue
      const start = _m(s.slot)
      items.push({ key: `cl:${r.cl.id}:${s.slot}`, text: r.cl.name, start, end: start + DEFAULT_MIN, lateAt: start, done: s.complete, ...who(r.cl) })
    }
  }
  if (!items.length) return { rows: [], from: 0, to: 0, now: nowM, more: 0 }
  // 行: 担当ごと（全員は「全員」の行）。最初の帯が早い順
  const by = new Map()
  for (const it of items) {
    if (!by.has(it.rowKey)) by.set(it.rowKey, { key: it.rowKey, name: it.rowName, blocks: [] })
    by.get(it.rowKey).blocks.push({ key: it.key, text: it.text, start: it.start, end: it.end, state: blockState(it, nowM) })
  }
  const rows = [...by.values()]
  for (const r of rows) r.blocks.sort((a, b) => a.start - b.start)
  rows.sort((a, b) => a.blocks[0].start - b.blocks[0].start)
  // 横の範囲: 帯と今を含む、1時間ごとに切った幅（最低6時間）
  const lo = Math.min(nowM, ...items.map(i => i.start)), hi = Math.max(nowM, ...items.map(i => i.end))
  let from = Math.floor(lo / 60) * 60, to = Math.ceil(hi / 60) * 60
  if (to - from < 360) { const pad = 360 - (to - from); from = Math.max(0, from - Math.floor(pad / 120) * 60); to = Math.min(1440, from + 360) }
  return { rows: rows.slice(0, FLOW_MAX_ROWS), from, to, now: nowM, more: Math.max(0, rows.length - FLOW_MAX_ROWS) }
}
function who(x) {
  if (x.assign === 'person' && x.assigneeId) return { rowKey: `p:${x.assigneeId}`, rowName: x.assigneeName || '?' }
  return { rowKey: 'all', rowName: '全員' }
}

/**
 * ② 進行中。締め切り過ぎ → 止まっている → 締め切りが近い順 → 締め切りなし
 * @param {Array} list  進行中のやること（progressTasks）
 * @param {string} today 'YYYY-MM-DD'
 * @param {(t) => boolean} isStale
 */
export function progressBars(list = [], today, isStale = () => false) {
  const T = _day(today)
  const out = list.map(t => {
    const startK = (t.createdAt || '').slice(0, 10) || t.date || today
    const steps = Array.isArray(t.steps) ? t.steps : []
    const over = !!t.deadline && t.deadline < today
    let pos = null
    if (t.deadline) {
      const S = _day(startK), E = _day(t.deadline)
      pos = E > S ? Math.min(1, Math.max(0, (T - S) / (E - S))) : 1
    }
    return {
      id: t.id, text: t.text, who: t.assign === 'person' ? (t.assigneeName || '') : t.assign === 'all' ? '全員' : '',
      start: startK, deadline: t.deadline || '', pos, over, stale: !over && isStale(t),
      done: steps.filter(s => s.done).length, total: steps.length, waiting: t.progress === 'waiting',
    }
  })
  const rank = x => (x.over ? 0 : x.stale ? 1 : x.deadline ? 2 : 3)
  out.sort((a, b) => rank(a) - rank(b) || (a.deadline || '9').localeCompare(b.deadline || '9'))
  return { items: out.slice(0, PROG_MAX), more: Math.max(0, out.length - PROG_MAX) }
}
