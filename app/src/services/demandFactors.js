// 日ごとの需要要因（暦ベース・API不要・純関数）。カレンダー可視化と、将来の
// 発注推奨への反映で共用する。天気・予約など外部データは別モジュール（後段）。
//
// 「見せる」用のフラグ集合を返すのが役割。ここでは補正値は計算しない（＝効かせるは別レイヤー）。

import { isHoliday, holidayName } from './jpHolidays.js'

const pad = (n) => String(n).padStart(2, '0')

// Date | 'YYYY-MM-DD' → Date（ローカル正午でTZずれを回避）
function toDate(date) {
  if (date instanceof Date) return date
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}
function keyOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

// 週末または祝日（＝休業日になりやすい日）
export function isOffDay(date) {
  const d = toDate(date)
  const w = d.getDay()
  return w === 0 || w === 6 || isHoliday(d)
}

// その日が属する連続休業日（週末＋祝日）の連長。休業日でなければ 0。
export function consecutiveOffLength(date) {
  const d = toDate(date)
  if (!isOffDay(d)) return 0
  let len = 1
  const back = new Date(d)
  back.setDate(back.getDate() - 1)
  while (isOffDay(back)) { len++; back.setDate(back.getDate() - 1) }
  const fwd = new Date(d)
  fwd.setDate(fwd.getDate() + 1)
  while (isOffDay(fwd)) { len++; fwd.setDate(fwd.getDate() + 1) }
  return len
}

// 3連休以上か（大型連休・連休の判定）
export function isLongWeekend(date) {
  return consecutiveOffLength(date) >= 3
}

// 銀行休業日か（週末・祝日・年末年始12/31〜1/3）。給料日の繰り上げ判定に使う。
export function isBankHoliday(date) {
  const d = toDate(date)
  const w = d.getDay()
  if (w === 0 || w === 6) return true
  if (isHoliday(d)) return true
  const m = d.getMonth() + 1, day = d.getDate()
  if (m === 12 && day === 31) return true
  if (m === 1 && day <= 3) return true
  return false
}

// nominalDay(1..) が銀行休業日なら前営業日へ繰り上げた「実際の支給日」Date を返す。
// 例: 25日が日曜 → 前の金曜（土・祝はさらに遡る）。
export function precedingBankDay(year, month0, nominalDay) {
  const dim = new Date(year, month0 + 1, 0).getDate()
  const d = new Date(year, month0, Math.min(nominalDay, dim))
  let guard = 0
  while (isBankHoliday(d) && guard++ < 20) d.setDate(d.getDate() - 1)
  return d
}
function _isSameDay(d, y, m0, day) {
  return d.getFullYear() === y && d.getMonth() === m0 && d.getDate() === day
}

// 慣習的な繁忙/休業スパン（法定祝日ではないが全国的に共通・短期で強い）。無ければ null。
export function customarySpan(date) {
  const d = toDate(date)
  const m = d.getMonth() + 1
  const day = d.getDate()
  if (m === 8 && day >= 13 && day <= 16) return 'お盆'
  if ((m === 12 && day >= 29) || (m === 1 && day <= 3)) return '年末年始'
  return null
}

// 学校の長期休暇（全国一般デフォルト・地域差は考慮しない広いスパン）。無ければ null。
// 夏 7/20–8/31 / 冬 12/25–1/7 / 春 3/25–4/5。お盆・年末年始は customarySpan が優先。
export function seasonBreak(date) {
  const d = toDate(date)
  const m = d.getMonth() + 1
  const day = d.getDate()
  if ((m === 7 && day >= 20) || m === 8) return '夏休み'
  if ((m === 12 && day >= 25) || (m === 1 && day <= 7)) return '冬休み'
  if ((m === 3 && day >= 25) || (m === 4 && day <= 5)) return '春休み'
  return null
}

// 日ごとの要因フラグ一式。
//   opts.paydays: 給料日とみなす日（既定 [25]＝最も一般的）。monthEndPayday: 月末も給料日扱い。
export function dayFactors(date, opts = {}) {
  const d = toDate(date)
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  const daysInMonth = new Date(y, m, 0).getDate()
  // 給料日の一般デフォルト（最も多い25日＋15日）。opts.paydays で上書き可。
  const paydays = Array.isArray(opts.paydays) ? opts.paydays : [25, 15]

  const next = new Date(d)
  next.setDate(next.getDate() + 1)

  const monthEnd = day === daysInMonth
  const holiday = isHoliday(d)
  const weekend = d.getDay() === 0 || d.getDay() === 6
  const eve = !holiday && isHoliday(next)

  // 給料日: 各候補を銀行営業日へ繰り上げた「実際の支給日」と一致するか。
  let payday = false
  let paydayLabel = ''
  for (const nd of paydays) {
    if (_isSameDay(precedingBankDay(y, d.getMonth(), nd), y, d.getMonth(), day)) { payday = true; paydayLabel = `${nd}日`; break }
  }
  if (!payday && opts.monthEndPayday && _isSameDay(precedingBankDay(y, d.getMonth(), daysInMonth), y, d.getMonth(), day)) {
    payday = true; paydayLabel = '月末'
  }
  // 年金支給日: 偶数月15日（銀行休業日なら前営業日へ繰り上げ）。
  const pension = [2, 4, 6, 8, 10, 12].includes(m) &&
    _isSameDay(precedingBankDay(y, d.getMonth(), 15), y, d.getMonth(), day)

  return {
    date:         keyOf(d),
    weekday:      d.getDay(),                       // 0=日..6=土
    holiday,
    holidayName:  holidayName(d),                   // 祝日名 | null
    holidayEve:   eve,                              // 祝前日（自身は非祝日で翌日が祝日）
    // 祝前日の種別: 平日の祝前日は需要インパクトが大きい／休日(週末)の祝前日は連休の一部で意味が違う
    holidayEveKind: eve ? (weekend ? 'weekend' : 'weekday') : null,
    weekend,
    payday,                                         // 給料日（銀行休業日繰り上げ後）
    paydayLabel,                                    // '25日' | '15日' | '月末' | ''
    pension,                                        // 年金支給日（偶数月15日・繰り上げ後）
    monthEnd,
    fifthMultiple: day % 5 === 0,                   // 5の倍数日
    longWeekend:  isLongWeekend(d),                 // 3連休以上に含まれる
    span:         customarySpan(d),                 // 'お盆' | '年末年始' | null（短期・強い）
    seasonBreak:  seasonBreak(d),                   // '夏休み' | '冬休み' | '春休み' | null（広い）
  }
}
