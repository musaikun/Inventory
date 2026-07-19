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
