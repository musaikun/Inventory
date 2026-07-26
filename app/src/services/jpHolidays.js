// 日本の祝日判定（純関数・API不要・外部依存なし）。
// 現行の祝日法（山の日新設2016・天皇誕生日変更2020以降）に準拠：
//   固定祝日 ＋ ハッピーマンデー ＋ 春分/秋分 ＋ 振替休日 ＋ 国民の休日。
// ※2020・2021 の五輪特例移動（海の日/スポーツの日/山の日）は対象外（先読み用途のため）。
// 対象年は概ね 2022 以降を想定（近似式の有効域は 1980..2099）。

const pad = (n) => String(n).padStart(2, '0')
const keyOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`  // m は 1..12

// 春分/秋分の日（近似式・1980..2099 で有効）
function vernalEquinoxDay(year) {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))
}
function autumnalEquinoxDay(year) {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))
}

// month(1..12) の n 番目の weekday(0=日..6=土) の日付(1..)を返す
function nthWeekday(year, month, weekday, n) {
  const first = new Date(year, month - 1, 1).getDay()
  const offset = (weekday - first + 7) % 7
  return 1 + offset + (n - 1) * 7
}

// その年の「国民の祝日」本体（振替・国民の休日を除く）を Map(key -> 名称) で返す
function baseHolidays(year) {
  const h = new Map()
  const add = (m, d, name) => h.set(keyOf(year, m, d), name)
  add(1, 1, '元日')
  add(1, nthWeekday(year, 1, 1, 2), '成人の日')       // 1月第2月曜
  add(2, 11, '建国記念の日')
  if (year >= 2020) add(2, 23, '天皇誕生日')
  add(3, vernalEquinoxDay(year), '春分の日')
  add(4, 29, '昭和の日')
  add(5, 3, '憲法記念日')
  add(5, 4, 'みどりの日')
  add(5, 5, 'こどもの日')
  add(7, nthWeekday(year, 7, 1, 3), '海の日')         // 7月第3月曜
  if (year >= 2016) add(8, 11, '山の日')
  add(9, nthWeekday(year, 9, 1, 3), '敬老の日')       // 9月第3月曜
  add(9, autumnalEquinoxDay(year), '秋分の日')
  add(10, nthWeekday(year, 10, 1, 2), 'スポーツの日') // 10月第2月曜
  add(11, 3, '文化の日')
  add(11, 23, '勤労感謝の日')
  return h
}

// 振替休日・国民の休日を加えた、その年の全祝日 Map(key -> 名称)
function holidaysForYear(year) {
  const base = baseHolidays(year)
  const result = new Map(base)

  // 国民の休日: 前日・翌日がともに本体祝日で、その日が本体祝日でなく日曜でもない平日
  for (let m = 1; m <= 12; m++) {
    const dim = new Date(year, m, 0).getDate()
    for (let d = 1; d <= dim; d++) {
      const k = keyOf(year, m, d)
      if (base.has(k)) continue
      const dt = new Date(year, m - 1, d)
      if (dt.getDay() === 0) continue
      const prev = new Date(year, m - 1, d - 1)
      const next = new Date(year, m - 1, d + 1)
      const pk = keyOf(prev.getFullYear(), prev.getMonth() + 1, prev.getDate())
      const nk = keyOf(next.getFullYear(), next.getMonth() + 1, next.getDate())
      if (base.has(pk) && base.has(nk)) result.set(k, '国民の休日')
    }
  }

  // 振替休日: 本体祝日が日曜 → 直後の「祝日でない日」を振替休日にする（連続祝日は繰り越す）
  for (const [k] of base) {
    const [y, mm, dd] = k.split('-').map(Number)
    const dt = new Date(y, mm - 1, dd)
    if (dt.getDay() !== 0) continue
    let cur = new Date(y, mm - 1, dd + 1)
    for (let guard = 0; guard < 10; guard++) {
      const ck = keyOf(cur.getFullYear(), cur.getMonth() + 1, cur.getDate())
      if (!base.has(ck) && !result.has(ck)) { result.set(ck, '振替休日'); break }
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1)
    }
  }

  return result
}

const _cache = new Map()
function _yearMap(year) {
  if (!_cache.has(year)) _cache.set(year, holidaysForYear(year))
  return _cache.get(year)
}

// date は Date | 'YYYY-MM-DD'
function _key(date) {
  if (typeof date === 'string') return date.slice(0, 10)
  return keyOf(date.getFullYear(), date.getMonth() + 1, date.getDate())
}
function _year(date) {
  return typeof date === 'string' ? Number(date.slice(0, 4)) : date.getFullYear()
}

// 祝日名（祝日でなければ null）
export function holidayName(date) {
  return _yearMap(_year(date)).get(_key(date)) ?? null
}

// 祝日か
export function isHoliday(date) {
  return holidayName(date) != null
}
