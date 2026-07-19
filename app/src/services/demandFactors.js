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

// 慣習的な繁忙/休業スパン（法定祝日ではないが全国的に共通のもの）。無ければ null。
export function customarySpan(date) {
  const d = toDate(date)
  const m = d.getMonth() + 1
  const day = d.getDate()
  if (m === 8 && day >= 13 && day <= 16) return 'お盆'
  if ((m === 12 && day >= 29) || (m === 1 && day <= 3)) return '年末年始'
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
  const paydays = Array.isArray(opts.paydays) ? opts.paydays : [25]

  const next = new Date(d)
  next.setDate(next.getDate() + 1)

  const monthEnd = day === daysInMonth
  const holiday = isHoliday(d)

  return {
    date:         keyOf(d),
    weekday:      d.getDay(),                       // 0=日..6=土
    holiday,
    holidayName:  holidayName(d),                   // 祝日名 | null
    holidayEve:   !holiday && isHoliday(next),      // 祝前日（自身は非祝日で翌日が祝日）
    weekend:      d.getDay() === 0 || d.getDay() === 6,
    payday:       paydays.includes(day) || (!!opts.monthEndPayday && monthEnd),
    monthEnd,
    fifthMultiple: day % 5 === 0,                   // 5の倍数日
    longWeekend:  isLongWeekend(d),                 // 3連休以上に含まれる
    span:         customarySpan(d),                 // 'お盆' | '年末年始' | null
  }
}
