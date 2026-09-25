// 履歴カレンダーの「今日のやること」。アプリが記録から自動で出す分だけ。純関数。
//
// 過去のマスには予定を重ねない（予定は後から変わるので、過去に重ねると嘘になる）。
// ここで出すのは「今日」の話だけで、やり残し（納品の反映待ち）は今日の欄へ持ってくる。
// 実績が入れば done になり、✓ 付きで残る（その日にやったことが見える）。

import { hasSchedule, scheduleName } from './orderScheduleUtil.js'

const DAY = 86400000
const PENDING_DAYS = 30        // 納品の反映待ちを遡る日数（仕入れ画面の未反映と同じ）
const STOCK_INTERVALS = 5      // 棚卸の間隔は直近いくつの平均で見るか

function _days(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / DAY) }
function _md(k) { const [, m, d] = k.split('-').map(Number); return `${m}/${d}` }
function _addDays(k, n) {
  const t = new Date(k + 'T12:00:00'); t.setDate(t.getDate() + n)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

/**
 * @param {object} p
 * @param {string} p.today           'YYYY-MM-DD'（ローカル日付）
 * @param {Array}  p.orderSchedules  config.orderSchedules
 * @param {Array}  p.orders          発注 [{ id, date, lines }]
 * @param {Array}  p.movements       入出庫 [{ orderId }]
 * @param {string[]} p.stockKeys     棚卸を行った日（重複可）
 * @returns {Array<{ id, kind:'order'|'delivery'|'stock', label, sub, done, date? }>}
 */
export function calendarTodos({ today, orderSchedules = [], orders = [], movements = [], stockKeys = [] } = {}) {
  const out = []
  const dow = new Date(today + 'T12:00:00').getDay()

  // 1. 今日が発注日。どの仕入先の発注かは記録と結び付いていないので、今日の発注が1件でもあれば済み
  const orderedToday = orders.some(o => o?.date === today)
  ;(orderSchedules || []).forEach((s, i) => {
    if (!hasSchedule(s) || !s.days.includes(dow)) return
    out.push({
      id: `order:${s.id ?? i}`, kind: 'order', done: orderedToday,
      label: `${scheduleName(s, i)}の発注日`,
      sub: orderedToday ? '今日の発注を記録済み' : (s.deadline ? `締切 ${s.deadline}` : ''),
    })
  })

  // 2. 納品の反映待ち（発注したのに入庫が未記録）。古い順に、いつの発注か分かるように
  const since = _addDays(today, -PENDING_DAYS)
  const reflected = new Set((movements || []).map(m => m?.orderId).filter(Boolean))
  const pending = (orders || [])
    .filter(o => o?.id && o.date && o.date >= since && o.date <= today && !reflected.has(o.id))
    .sort((a, b) => a.date.localeCompare(b.date))
  for (const o of pending) {
    const n = (o.lines || []).length
    out.push({
      id: `delivery:${o.id}`, kind: 'delivery', done: false, date: o.date,
      label: `${_md(o.date)} の発注の入庫が未記録`,
      sub: `${o.supplier ? o.supplier + '・' : ''}${n}品目。届いていれば入庫に記録`,
    })
  }

  // 3. 棚卸の目安日。いつもの間隔（直近の平均）を過ぎたら出す。記録が2回未満なら間隔が分からないので出さない
  const keys = [...new Set(stockKeys.filter(Boolean))].filter(k => k <= today).sort()
  if (keys.length >= 2) {
    const recent = keys.slice(-(STOCK_INTERVALS + 1))
    let sum = 0
    for (let i = 1; i < recent.length; i++) sum += _days(recent[i - 1], recent[i])
    const avg = Math.max(1, Math.round(sum / (recent.length - 1)))
    const last = keys[keys.length - 1]
    const since = _days(last, today)
    if (last === today) {
      out.push({ id: 'stock', kind: 'stock', done: true, label: '棚卸', sub: '今日の棚卸を記録済み' })
    } else if (since >= avg) {
      out.push({
        id: 'stock', kind: 'stock', done: false,
        label: '棚卸の目安日を過ぎています',
        sub: `前回（${_md(last)}）から${since}日。いつもは約${avg}日ごと`,
      })
    }
  }
  return out
}

/** 今日以降で発注日にあたるか（マスの予定の印用）。過去は常に false */
export function isUpcomingOrderDay(key, today, orderSchedules = []) {
  if (!key || key < today) return false
  const dow = new Date(key + 'T12:00:00').getDay()
  return (orderSchedules || []).some(s => hasSchedule(s) && s.days.includes(dow))
}
