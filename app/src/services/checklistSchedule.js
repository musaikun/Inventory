/**
 * ルーティン（毎日・毎週・毎月の決まった仕事）の「どの日に出すか」と「その日の進み具合」
 * （User決定 2026-10-19 → 2026-10-22 に「毎日のチェック」から改名・モック docs/mocks/journal-routine.html）。
 * - 繰り返し: none（start_date の日だけ）/ daily / weekly（曜日 '0,3'）/ monthly（日 '1,15,L'。L＝月末、月に無い日は月末）
 * - 中の項目は任意。項目なし＝押せば済む1件（印の項目 id は WHOLE）
 * - 1日に何回も: dueTimes（'HH:MM' の配列）。回ごとに別の記録（slot＝'HH:MM'。時刻なしは ''）
 * - start_date より前の日は、記録（run）のある日だけ出す（繰り返しを変えても、過去の「手つかず」を作り直さない）
 * - お休み中・消した表は、記録のある日だけ出す
 * - その回の項目は記録があれば記録の写し、無ければ今の表（表を直しても✓を付けた回は崩れない）
 * - 済み＝全部の項目が ✓ か「今日はなし」（「今日はなし」も済みに数える・User決定 2026-10-19）
 */
import { localDateKey } from '../utils/localDate.js'

const _d = date => new Date(date + 'T00:00:00')
/** 項目なしのルーティンの印に使う項目 id（サーバーと同じ） */
export const WHOLE = '_'
/** 項目なし（押せば済む1件）か */
export const isSimple = cl => !(cl?.items?.length)

/** 予定の上でその日に出すか（記録の有無は見ない） */
export function scheduledOn(cl, date) {
  if (!cl || cl.deletedAt || cl.paused || !cl.startDate || date < cl.startDate) return false
  if (cl.repeat === 'daily') return true
  if (cl.repeat === 'weekly') {
    const days = String(cl.repeatDays ?? '').split(',').filter(Boolean).map(Number)
    return days.includes(_d(date).getDay())
  }
  if (cl.repeat === 'monthly') {
    const d = _d(date)
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    return String(cl.repeatDays ?? '').split(',').filter(Boolean)
      .some(x => (x === 'L' ? d.getDate() === last : d.getDate() === Math.min(Number(x), last)))
  }
  return date === cl.startDate
}

/** 1日の回（時刻の順）。時刻なしは [''] */
export function slotsOf(cl) {
  const t = Array.isArray(cl?.dueTimes) ? cl.dueTimes.filter(Boolean) : []
  return t.length ? [...t].sort() : ['']
}

export const runKey = (id, date, slot = '') => `${id}|${date}|${slot}`

function _slotRun(cl, run, date, slot) {
  const own = run?.items?.length ? run.items : (cl.items ?? [])
  const items = own.length ? own : [{ id: WHOLE, text: cl.name }]
  const marks = run?.marks ?? {}
  let done = 0, skip = 0
  for (const it of items) {
    const m = marks[it.id]
    if (m?.s === 'done') done++
    else if (m?.s === 'skip') skip++
  }
  const total = items.length
  const filled = done + skip
  const ats = Object.values(marks).map(m => m?.at).filter(Boolean).sort()
  return {
    cl, date, slot, items, marks, done, skip, total, filled,
    complete: total > 0 && filled >= total,
    started: filled > 0,
    lastAt: ats[ats.length - 1] ?? null,
  }
}

/** ある表のある日の、ある回。出さない日・回なら null */
export function dayRun(cl, runs, date, slot = '') {
  const run = runs?.[runKey(cl.id, date, slot)] ?? null
  if (!run && !(scheduledOn(cl, date) && slotsOf(cl).includes(slot))) return null
  return _slotRun(cl, run, date, slot)
}

/**
 * ある表のある日（全部の回）。出さない日なら null
 * 今の時刻の回に加えて、時刻を変える前に✓を付けた回も記録から出す
 */
export function dayChecklist(cl, runs, date) {
  const prefix = `${cl.id}|${date}|`
  const fromRuns = Object.keys(runs ?? {}).filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length))
  const planned = scheduledOn(cl, date) ? slotsOf(cl) : []
  const keys = [...new Set([...planned, ...fromRuns])].sort()
  if (!keys.length) return null
  const slots = keys.map(s => _slotRun(cl, runs?.[runKey(cl.id, date, s)] ?? null, date, s))
  const doneSlots = slots.filter(s => s.complete).length
  return {
    cl, date, slots,
    timed: slots.some(s => s.slot),
    doneSlots, totalSlots: slots.length,
    complete: doneSlots === slots.length,
    started: slots.some(s => s.started),
    filled: slots.reduce((n, s) => n + s.filled, 0),
    total: slots.reduce((n, s) => n + s.total, 0),
  }
}

/** その日に出す表（最初の回の時刻の順。時刻なしは後ろ） */
export function checklistsOn(lists, runs, date) {
  const first = r => r.slots[0]?.slot || '99'
  return (lists ?? []).map(cl => dayChecklist(cl, runs, date)).filter(Boolean)
    .sort((a, b) => first(a).localeCompare(first(b)) || a.cl.name.localeCompare(b.cl.name))
}

/**
 * 記録（新しい日から）。今日から days 日さかのぼって、出す日ごとに1行
 * status: 'done'（済み）/ 'partial'（未完了）/ 'none'（手つかず）/ 'open'（今日でまだ途中）
 */
export function checklistHistory(cl, runs, { today = localDateKey(), days = 60 } = {}) {
  const out = []
  const d = _d(today)
  for (let i = 0; i < days; i++) {
    const date = localDateKey(d)
    const r = dayChecklist(cl, runs, date)
    if (r) {
      const status = r.complete ? 'done' : date === today ? 'open' : r.started ? 'partial' : 'none'
      const marks = r.slots.flatMap(s => Object.values(s.marks))
      const ats = marks.map(m => m?.at).filter(Boolean).sort()
      const names = [...new Set(marks.map(m => m?.by).filter(Boolean))]
      out.push({ ...r, status, from: ats[0] ?? null, to: ats[ats.length - 1] ?? null, names })
    }
    d.setDate(d.getDate() - 1)
  }
  return out
}

/**
 * この7日（古い日から）: 'y' 済み / 'n' やり残し / 't' 今日でまだ / 'o' 予定なし
 */
export function weekMarks(cl, runs, today = localDateKey()) {
  const out = []
  const d = _d(today)
  d.setDate(d.getDate() - 6)
  for (let i = 0; i < 7; i++) {
    const date = localDateKey(d)
    const r = dayChecklist(cl, runs, date)
    out.push({ date, mark: !r ? 'o' : r.complete ? 'y' : date === today ? 't' : 'n' })
    d.setDate(d.getDate() + 1)
  }
  return out
}

/**
 * 今やる回: まだ済んでいない回のうち、時刻を過ぎた最後の回。無ければ次の回
 * （時刻なしの回は、いつでも「今」）
 */
export function currentSlot(day, nowHm) {
  const open = day.slots.filter(s => !s.complete)
  if (!open.length) return null
  const passed = open.filter(s => !s.slot || s.slot <= nowHm)
  return passed.length ? passed[passed.length - 1] : open[0]
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土']
/** 繰り返しの一言（一覧に出す） */
export function repeatLabel(cl) {
  if (cl.repeat === 'daily') return '毎日'
  if (cl.repeat === 'weekly') return String(cl.repeatDays ?? '').split(',').filter(Boolean).map(n => WEEK[Number(n)]).join('・')
  if (cl.repeat === 'monthly') return `毎月${monthDaysLabel(cl.repeatDays)}`
  const [, m, dd] = String(cl.startDate).split('-').map(Number)
  return m ? `${m}/${dd}だけ` : '1回'
}
/** '1,15,L' → '1日・15日・月末' */
export function monthDaysLabel(v) {
  return String(v ?? '').split(',').filter(Boolean).map(x => (x === 'L' ? '月末' : `${x}日`)).join('・')
}
/** 繰り返しの種類（一覧の分け方・札の色） */
export const repeatKind = cl => (['daily', 'weekly', 'monthly'].includes(cl?.repeat) ? cl.repeat : 'none')

/**
 * これから（今日より後に出る、近いもの）。今日は出ない毎週・毎月のものを「これから」の1行に
 * @returns {{ cl, date }[]} 日付の順・limit 件まで
 */
export function upcoming(lists, today = localDateKey(), { days = 31, limit = 3, skip = new Set() } = {}) {
  const out = []
  for (const cl of lists ?? []) {
    if (cl.deletedAt || cl.paused || cl.repeat === 'daily' || skip.has(cl.id)) continue
    const d = _d(today)
    for (let i = 1; i <= days; i++) {
      d.setDate(d.getDate() + 1)
      const k = localDateKey(d)
      if (scheduledOn(cl, k)) { out.push({ cl, date: k }); break }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, limit)
}

/** 「毎日 10:00・15:00・21:00」 */
export function whenLabel(cl) {
  const t = slotsOf(cl).filter(Boolean)
  return `${cl?.repeat === 'weekly' ? '毎週 ' : ''}${repeatLabel(cl)}${t.length ? ` ${t.join('・')}` : ''}`
}
