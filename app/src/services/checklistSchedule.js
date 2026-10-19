/**
 * チェック表の「どの日に出すか」と「その日の進み具合」（User決定 2026-10-19・モック docs/mocks/journal-checklist.html）。
 * - 繰り返し: none（start_date の日だけ）/ daily / weekly（曜日 '0,3'）/ monthly（日 '31'。月に無い日は月末）
 * - start_date より前の日は、記録（run）のある日だけ出す（繰り返しを変えても、過去の「手つかず」を作り直さない）
 * - お休み中・消した表は、記録のある日だけ出す
 * - その日の項目は記録があれば記録の写し、無ければ今の表（表を直しても✓を付けた日は崩れない）
 * - 済み＝全部の項目が ✓ か「今日はなし」（「今日はなし」も済みに数える・User決定 2026-10-19）
 */
import { localDateKey } from '../utils/localDate.js'

const _d = date => new Date(date + 'T00:00:00')

/** 予定の上でその日に出すか（記録の有無は見ない） */
export function scheduledOn(cl, date) {
  if (!cl || cl.deletedAt || cl.paused || !cl.startDate || date < cl.startDate) return false
  if (cl.repeat === 'daily') return true
  if (cl.repeat === 'weekly') {
    const days = String(cl.repeatDays ?? '').split(',').filter(Boolean).map(Number)
    return days.includes(_d(date).getDay())
  }
  if (cl.repeat === 'monthly') {
    const n = Number(cl.repeatDays)
    const d = _d(date)
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    return d.getDate() === Math.min(n, last)
  }
  return date === cl.startDate
}

export const runKey = (id, date) => `${id}|${date}`

/** ある表のある日の様子。出さない日なら null */
export function dayRun(cl, runs, date) {
  const run = runs?.[runKey(cl.id, date)] ?? null
  if (!run && !scheduledOn(cl, date)) return null
  const items = run?.items?.length ? run.items : (cl.items ?? [])
  const marks = run?.marks ?? {}
  let done = 0, skip = 0
  for (const it of items) {
    const m = marks[it.id]
    if (m?.s === 'done') done++
    else if (m?.s === 'skip') skip++
  }
  const total = items.length
  const filled = done + skip
  return {
    cl, date, items, marks, done, skip, total, filled,
    complete: total > 0 && filled >= total,
    started: filled > 0,
  }
}

/** その日に出す表（時刻の順。時刻なしは後ろ） */
export function checklistsOn(lists, runs, date) {
  return (lists ?? []).map(cl => dayRun(cl, runs, date)).filter(Boolean)
    .sort((a, b) => (a.cl.dueTime || '99').localeCompare(b.cl.dueTime || '99') || a.cl.name.localeCompare(b.cl.name))
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
    const r = dayRun(cl, runs, date)
    if (r) {
      const status = r.complete ? 'done' : date === today ? 'open' : r.started ? 'partial' : 'none'
      const ats = Object.values(r.marks).map(m => m?.at).filter(Boolean).sort()
      const names = [...new Set(Object.values(r.marks).map(m => m?.by).filter(Boolean))]
      out.push({ ...r, status, from: ats[0] ?? null, to: ats[ats.length - 1] ?? null, names })
    }
    d.setDate(d.getDate() - 1)
  }
  return out
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土']
/** 繰り返しの一言（一覧に出す） */
export function repeatLabel(cl) {
  if (cl.repeat === 'daily') return '毎日'
  if (cl.repeat === 'weekly') return String(cl.repeatDays ?? '').split(',').filter(Boolean).map(n => WEEK[Number(n)]).join('・')
  if (cl.repeat === 'monthly') return `毎月${cl.repeatDays}日`
  const [, m, dd] = String(cl.startDate).split('-').map(Number)
  return m ? `${m}/${dd}だけ` : '1回'
}
