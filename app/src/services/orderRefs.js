// 発注数の「参考の数」（User決定 2026-10-17・モック docs/mocks/order-type-first.html）。
// 推奨を自信ありげに出して間違えさせないため、出すのは「何から出た数か」が分かる参考だけ。
// 欄へは自動で入れない（押したら入る）。データが足りないものは出さない＝「まだ分からない」がそのまま伝わる。
//
//  - 前回          : 1回でも頼んでいれば、直前の発注数
//  - 同じ曜日の平均 : 同じ曜日の発注が 3回以上
//  - 直近1週間      : 1週間に 2回以上頼んでいれば、1回あたりの平均
//  - 推奨          : 補充目標が分かるときだけ（人が決めた発注点・補充目標、または学習した適正在庫）。
//                    「仮」の目標（assumed）からは出さない
import { weekdayOf } from './orderLearning.js'

export const WEEKDAY_MIN = 3
export const WEEK_MIN = 2
const TRUSTED_TARGET = new Set(['manual', 'par', 'consumption', 'reorder'])
const WD = ['日', '月', '火', '水', '木', '金', '土']

const _round1 = n => Math.round(n * 10) / 10
const _addDays = (key, d) => {
  const [y, m, dd] = key.split('-').map(Number)
  const t = new Date(y, m - 1, dd + d)
  const p = n => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`
}

/** 品目の発注数を日ごとに（同じ日の複数発注＝仕入先違いは合算）。today 以降は入れない */
function _byDate(orders, item, today) {
  const m = new Map()
  for (const o of orders ?? []) {
    if (!o?.date || o.deletedAt || o.date >= today) continue
    for (const l of o.lines ?? []) {
      if (l.item !== item) continue
      const q = Number(l.qty)
      if (Number.isFinite(q) && q > 0) m.set(o.date, (m.get(o.date) ?? 0) + q)
    }
  }
  return [...m.entries()].map(([date, qty]) => ({ date, qty })).sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * @param {object[]} orders 発注の記録
 * @param {string} item
 * @param {string} today 'YYYY-MM-DD'（端末の日付）
 * @param {{ target?: {value:number, source:string}|null, stock?: number|null, lot?: number }} [opts]
 * @returns {{ last, weekday, week, recommend, refs: {key,label,qty}[] }}
 */
export function orderRefs(orders, item, today, { target = null, stock = null, lot = 1 } = {}) {
  const days = _byDate(orders, item, today)
  const last = days.length ? days[days.length - 1] : null
  const wd = weekdayOf(today)
  const same = days.filter(d => weekdayOf(d.date) === wd)
  const weekday = same.length >= WEEKDAY_MIN
    ? { avg: _round1(same.reduce((n, d) => n + d.qty, 0) / same.length), count: same.length, label: WD[wd] }
    : null
  const from = _addDays(today, -7)
  const inWeek = days.filter(d => d.date >= from)
  const week = inWeek.length >= WEEK_MIN
    ? { avg: _round1(inWeek.reduce((n, d) => n + d.qty, 0) / inWeek.length), count: inWeek.length }
    : null
  let recommend = null
  if (target && TRUSTED_TARGET.has(target.source) && stock != null && Number.isFinite(Number(stock))) {
    const need = Math.max(0, Number(target.value) - Number(stock))
    const l = Number(lot) > 1 ? Number(lot) : 1
    recommend = { qty: Math.ceil(need / l), target: Number(target.value), stock: Number(stock) }
  }
  const refs = []
  if (recommend) refs.push({ key: 'rec', label: `推奨 ${recommend.qty}`, sub: `目標 ${recommend.target} − 在庫 ${recommend.stock}`, qty: recommend.qty })
  if (weekday) refs.push({ key: 'wd', label: `${weekday.label}曜の平均 ${weekday.avg}`, sub: `${weekday.count}回`, qty: Math.round(weekday.avg) })
  if (week) refs.push({ key: 'week', label: `直近1週間 ${week.avg}`, sub: `1回あたり・${week.count}回`, qty: Math.round(week.avg) })
  if (last) refs.push({ key: 'last', label: `前回 ${last.qty}`, sub: _md(last.date), qty: last.qty })
  return { last, weekday, week, recommend, refs }
}

const _md = d => { const [, m, dd] = String(d).split('-').map(Number); return m && dd ? `${m}/${dd}` : '' }

/**
 * いつもと桁が違うか（確定の前に1回だけ訊く）。同じ曜日の平均（無ければ直近1週間）と比べて
 * 3倍以上か 3分の1以下。比べる数が無ければ訊かない
 * @returns {{ usual: number, ratio: number }|null}
 */
export function unusualOrder(qty, refs) {
  const usual = refs?.weekday?.avg ?? refs?.week?.avg ?? null
  const q = Number(qty)
  if (!usual || !(q > 0)) return null
  const ratio = q / usual
  return ratio >= 3 || ratio <= 1 / 3 ? { usual, ratio } : null
}
