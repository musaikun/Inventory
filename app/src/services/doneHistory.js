/**
 * 済んだ業務の履歴（User 2026-11-18）。「済んだものをざっくり全体で見たい。期間・ジャンル・属性で絞れるとよい」。
 * 対象は日付のあるやること・いつか・進行中。イベント（済みが無い）・消したもの・アプリが作ったもの（参加申請など）は入れない。
 * 定期のチェック表は別の記録（RoutineRecords）にある。
 */
import { localDateKey } from '../utils/localDate.js'

export const KIND_LABEL = { task: 'やること', progress: '進行中', someday: 'いつか' }
export const CATEGORY_LABEL = { prep: '仕込み', clean: '清掃', order: '発注・納品' }
export const PERIODS = [
  { days: 7, label: '1週間' }, { days: 30, label: '1か月' }, { days: 90, label: '3か月' }, { days: 365, label: '1年' },
]

export const kindOf = t => (t.progress ? 'progress' : t.date === '' ? 'someday' : 'task')

const _utc = k => Date.UTC(...k.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)))
const _diff = (a, b) => Math.round((_utc(b) - _utc(a)) / 86400_000)

/**
 * 期限に対してどうだったか。null = 期限の無いもの（いつか・締め切り未定の進行中）
 * 進行中は締め切り（deadline）、やることはその日（と時刻）が期限
 */
export function lateness(t) {
  if (!t?.doneAt) return null
  const doneDay = localDateKey(new Date(t.doneAt))
  if (t.progress) {
    if (!t.deadline) return null
    const d = _diff(t.deadline, doneDay)
    return { late: d > 0, days: Math.max(0, d) }
  }
  if (!t.date) return null
  const due = new Date(`${t.date}T${t.dueTime || '23:59'}:59`)
  if (new Date(t.doneAt) <= due) return { late: false, days: 0 }
  return { late: true, days: Math.max(0, _diff(t.date, doneDay)) }
}

/** 履歴に入れる済んだもの（済んだ時刻の新しい順） */
export function doneItems(list) {
  return (list ?? [])
    .filter(t => t && t.doneAt && !t.deletedAt && t.category !== 'event' && !t.kind)
    .sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)))
}

/**
 * 絞り込み。f = { days, kind, category, who, late, q, now }
 *   kind: '' | 'task' | 'progress' | 'someday' ／ category: '' | 'prep' | 'clean' | 'order' | 'none'
 *   who: '' | 済ませた人の名前 ／ late: '' | 'ok' | 'late' ／ q: 名前・メモの文字
 */
export function filterDone(items, f = {}) {
  const now = f.now ?? Date.now()
  const from = f.days ? now - f.days * 86400_000 : -Infinity
  const q = (f.q || '').trim().toLowerCase()
  return items.filter(t => {
    if (new Date(t.doneAt).getTime() < from) return false
    if (f.kind && kindOf(t) !== f.kind) return false
    if (f.category && (f.category === 'none' ? !!t.category : t.category !== f.category)) return false
    if (f.who && whoDid(t) !== f.who) return false
    if (f.late) {
      const l = lateness(t)
      if (f.late === 'late' ? !l?.late : !!l?.late) return false
    }
    if (q && !`${t.text} ${t.note || ''}`.toLowerCase().includes(q)) return false
    return true
  })
}

/** 済ませた人（「全員」は印を付けた人を並べる） */
export function whoDid(t) {
  if (t.assign === 'all') return (t.doneList || []).map(x => x.name).filter(Boolean).join('・')
  return t.doneBy || ''
}

/** 済ませた日ごとにまとめる [{ day, items }]（新しい日から） */
export function groupByDay(items) {
  const out = []
  for (const t of items) {
    const day = localDateKey(new Date(t.doneAt))
    const last = out[out.length - 1]
    if (last?.day === day) last.items.push(t); else out.push({ day, items: [t] })
  }
  return out
}

/** 数のまとめ { total, late, byKind } */
export function summarize(items) {
  const byKind = { task: 0, progress: 0, someday: 0 }
  let late = 0
  for (const t of items) { byKind[kindOf(t)]++; if (lateness(t)?.late) late++ }
  return { total: items.length, late, byKind }
}

/** 一覧と取り寄せた分をまとめる（同じ1件は updatedAt の新しい方） */
export function mergeById(a, b) {
  const m = new Map()
  for (const t of [...(a ?? []), ...(b ?? [])]) {
    if (!t?.id) continue
    const cur = m.get(t.id)
    if (!cur || String(t.updatedAt || '') > String(cur.updatedAt || '')) m.set(t.id, t)
  }
  return [...m.values()]
}
