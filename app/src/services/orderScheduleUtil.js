// 発注スケジュール（頻度＝発注する曜日・締切時間）にまつわる純関数。副作用なし。
// schedule = { days: number[] (0=日..6=土), deadline: 'HH:MM' | '' }

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

export function weekdayLabel(n) {
  return WEEKDAY_LABELS[n] ?? ''
}

// スケジュールが設定済みか（発注曜日が1つ以上）
export function hasSchedule(schedule) {
  return !!(schedule && Array.isArray(schedule.days) && schedule.days.length > 0)
}

// '火・金 / 締切15:00' のような要約。未設定は ''
export function scheduleSummary(schedule) {
  if (!hasSchedule(schedule)) return ''
  const days = [...schedule.days].sort((a, b) => a - b).map(weekdayLabel).join('・')
  const dl = schedule.deadline ? ` / 締切${schedule.deadline}` : ''
  return days + dl
}

// 指定日(Date)が発注日か
export function isOrderDay(schedule, date = new Date()) {
  if (!hasSchedule(schedule)) return false
  return schedule.days.includes(date.getDay())
}

// 次の発注曜日ラベル。today は含めず翌日以降で最も近い発注曜日。
export function nextOrderDayLabel(schedule, date = new Date()) {
  if (!hasSchedule(schedule)) return ''
  for (let i = 1; i <= 7; i++) {
    const d = (date.getDay() + i) % 7
    if (schedule.days.includes(d)) return weekdayLabel(d)
  }
  return ''
}

// 締切ステータス。deadline='HH:MM'。now 基準。
//   { has, past, label }。past=締切を過ぎている。
export function deadlineStatus(schedule, now = new Date()) {
  if (!hasSchedule(schedule) || !schedule.deadline) return { has: false, past: false, label: '' }
  const [h, m] = String(schedule.deadline).split(':').map(Number)
  if (!Number.isFinite(h)) return { has: false, past: false, label: '' }
  const dl = new Date(now)
  dl.setHours(h, Number.isFinite(m) ? m : 0, 0, 0)
  const diffMin = Math.round((dl - now) / 60000)
  if (diffMin < 0) return { has: true, past: true, label: `締切${schedule.deadline} 超過` }
  const hh = Math.floor(diffMin / 60)
  const mm = diffMin % 60
  const remain = hh > 0 ? `あと${hh}時間${mm ? mm + '分' : ''}` : `あと${mm}分`
  return { has: true, past: false, label: `締切${schedule.deadline}（${remain}）` }
}

// 今日の発注の位置づけラベル。
//   発注日: '火曜の発注（次は金曜）' / 非発注日: '発注日ではありません（次の発注は金曜）'
export function todayOrderContext(schedule, date = new Date()) {
  if (!hasSchedule(schedule)) return ''
  const today = weekdayLabel(date.getDay())
  const next  = nextOrderDayLabel(schedule, date)
  if (isOrderDay(schedule, date)) {
    return next ? `${today}曜の発注（次は${next}曜）` : `${today}曜の発注`
  }
  return next ? `発注日ではありません（次の発注は${next}曜）` : ''
}

// ── 複数スケジュール ────────────────────────────────────────────────────────
// 仕入先ごとに発注曜日・締切が違うため、スケジュールは配列で持つ。
// schedules = [{ id, name, days, deadline }]（最大 MAX_ORDER_SCHEDULES 件）
// 旧・単一形式 { days, deadline } は normalizeSchedules が1件へ移行する。

export const MAX_ORDER_SCHEDULES = 5
const NAME_MAX = 20

let _idSeq = 0
function _newId() {
  _idSeq += 1
  return `sch_${Date.now().toString(36)}_${_idSeq.toString(36)}`
}

// 1件の正規化。days は 0..6 の整数（重複除去・昇順）、deadline は 'HH:MM' のみ。
export function normalizeSchedule(s) {
  const days = Array.isArray(s?.days)
    ? [...new Set(s.days.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b)
    : []
  const deadline = /^\d{1,2}:\d{2}$/.test(s?.deadline || '') ? s.deadline : ''
  const name = String(s?.name ?? '').trim().slice(0, NAME_MAX)
  const id = typeof s?.id === 'string' && s.id ? s.id : _newId()
  return { id, name, days, deadline }
}

// 配列の正規化。曜日が1つも無い行は捨てる（空行を保存し続けない）。
// legacy = 旧 config.orderSchedule。orderSchedules が無いときだけ1件へ移行する。
export function normalizeSchedules(list, legacy) {
  const src = Array.isArray(list) && list.length ? list
    : (legacy && Array.isArray(legacy.days) && legacy.days.length ? [legacy] : [])
  const out = []
  const seen = new Set()
  for (const s of src) {
    const n = normalizeSchedule(s)
    if (!n.days.length) continue
    if (seen.has(n.id)) n.id = _newId()   // 取込などで id が重複しても表示キーを壊さない
    seen.add(n.id)
    out.push(n)
    if (out.length >= MAX_ORDER_SCHEDULES) break
  }
  return out
}

// 表示名。未入力なら「発注1」「発注2」…（並び順で決まる）
export function scheduleName(s, index = 0) {
  return String(s?.name ?? '').trim() || `発注${index + 1}`
}

export function hasAnySchedule(list) {
  return Array.isArray(list) && list.some(hasSchedule)
}

// 全スケジュールの発注曜日の和集合（昇順）。消費推定の orderDays に渡す。
export function allOrderDays(list) {
  const set = new Set()
  for (const s of (list || [])) for (const d of (s?.days || [])) {
    const n = Number(d)
    if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n)
  }
  return [...set].sort((a, b) => a - b)
}

// 発注間隔（＝補充が効くまでの日数）。和集合の最大ギャップ。未設定・週1は7日。
// 仕入先ごとに間隔は違うが、品目とスケジュールの紐付けはまだ無いので店舗全体で1つに寄せる。
export function orderIntervalDays(list) {
  const days = allOrderDays(list)
  if (days.length < 2) return 7
  let maxGap = 0
  for (let i = 0; i < days.length; i++) {
    const gap = (days[(i + 1) % days.length] - days[i] + 7) % 7 || 7
    maxGap = Math.max(maxGap, gap)
  }
  return maxGap
}

// 今日が発注日のスケジュール
export function todaySchedules(list, date = new Date()) {
  return (list || []).filter(s => isOrderDay(s, date))
}

// 翌日以降で最も近い発注。{ dayLabel, names[] } | null（当日は含めない）
export function nextScheduleOccurrence(list, date = new Date()) {
  if (!hasAnySchedule(list)) return null
  for (let i = 1; i <= 7; i++) {
    const d = (date.getDay() + i) % 7
    const names = (list || [])
      .map((s, idx) => (s?.days || []).includes(d) ? scheduleName(s, idx) : null)
      .filter(Boolean)
    if (names.length) return { dayLabel: weekdayLabel(d), names }
  }
  return null
}

// 今日の位置づけ。'今日は「青果」の発注日（次は金曜の「肉」）' など。
export function schedulesTodayContext(list, date = new Date()) {
  if (!hasAnySchedule(list)) return ''
  const today = (list || [])
    .map((s, idx) => isOrderDay(s, date) ? scheduleName(s, idx) : null)
    .filter(Boolean)
  const next = nextScheduleOccurrence(list, date)
  const nextText = next ? `次は${next.dayLabel}曜の「${next.names.join('・')}」` : ''
  if (today.length) {
    return nextText ? `今日は「${today.join('・')}」の発注日（${nextText}）` : `今日は「${today.join('・')}」の発注日`
  }
  return nextText ? `今日は発注日ではありません（${nextText}）` : ''
}

// 一覧表示用の行。today=今日が発注日 / deadline=締切ステータス
//   days     … '火・金'（締切は含めない。カードで別行に出すため）
//   deadline … 残り時間つきの締切ステータス。今日が発注日のときだけ意味を持つ
//   deadlineAt … 'HH:MM'。今日でない日の表示に使う（「あと◯時間」は今日の話なので出さない）
export function scheduleRows(list, now = new Date()) {
  return (list || []).map((s, idx) => ({
    id: s.id ?? String(idx),
    name: scheduleName(s, idx),
    summary: scheduleSummary(s),
    days: [...(s?.days ?? [])].sort((a, b) => a - b).map(weekdayLabel).join('・'),
    today: isOrderDay(s, now),
    deadline: deadlineStatus(s, now),
    deadlineAt: s?.deadline || '',
    next: nextOrderDayLabel(s, now),
  }))
}
