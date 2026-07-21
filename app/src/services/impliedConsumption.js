// 論理出庫（推定消費）の逆算。責務: 在庫の観測点（棚卸・発注時の在庫入力）の間で、
// 入庫を足し・記録済み出庫を引いて「消費量」を逆算する。純関数・副作用なし。
//
//   消費 = 前回在庫 ＋ 期間中の入庫 − 記録済み出庫 − 今回在庫
//
// 飲食店は出庫をほぼ記録しないが、発注のたびに在庫を入力すれば消費が1点ずつ取れる。
// マイナス消費（入庫の記録漏れ・計数ミス）は flagged=true にして統計から除外できる。
// あくまで推定値。棚卸で定期的に基準点をリセットして精度を保つ前提。

function _ymd(s) { return (s || '').slice(0, 10) }

/**
 * 品目の在庫観測点を日付昇順で返す。
 * @param {Array} snapshots useHistory.getSnapshots() 形式 [{ date, items:[{item,qty}] }]
 * @param {Array} orders    useOrders.getOrders() 形式 [{ date, lines:[{item,stock}] }]
 * @returns {Array} [{ date:'YYYY-MM-DD', qty:number, src:'stocktake'|'order' }]
 */
export function stockObservations(item, snapshots = [], orders = []) {
  const obs = []
  for (const s of snapshots) {
    const it = (s?.items || []).find(i => i.item === item && i.qty != null)
    if (it) obs.push({ date: _ymd(s.date), qty: Number(it.qty), src: 'stocktake' })
  }
  for (const o of orders) {
    const line = (o?.lines || []).find(l => l.item === item && l.stock != null && l.stock !== '')
    if (line) obs.push({ date: _ymd(o.date), qty: Number(line.stock), src: 'order' })
  }
  return obs
    .filter(o => o.date && Number.isFinite(o.qty))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// 品目の入庫 or 出庫を日付キー→数量合計に集計
function _flowByDate(item, movements, type) {
  const map = {}
  for (const mv of movements || []) {
    if (mv?.type !== type) continue
    const line = (mv.lines || []).find(l => l.item === item)
    if (!line) continue
    const k = _ymd(mv.date)
    const q = Number(line.qty)
    if (k && Number.isFinite(q)) map[k] = (map[k] || 0) + q
  }
  return map
}

// (afterDate, throughDate] の合計（観測点をまたぐフローは後の観測日側の区間に含める）
function _sumBetween(map, afterDate, throughDate) {
  let t = 0
  for (const k in map) if (k > afterDate && k <= throughDate) t += map[k]
  return t
}

function _daysBetween(d1, d2) {
  const a = new Date(d1 + 'T00:00:00Z').getTime()
  const b = new Date(d2 + 'T00:00:00Z').getTime()
  const days = Math.round((b - a) / 86400000)
  return days > 0 ? days : 0
}

function _round(v) { return Math.round(v * 1000) / 1000 }

/**
 * 連続する在庫観測の間で消費を逆算した区間の配列を返す（古い順）。
 * @returns {Array} [{ fromDate, toDate, days, fromQty, toQty, inflow, outflow, consumed, perDay, flagged }]
 */
export function consumptionIntervals(item, { snapshots = [], orders = [], movements = [] } = {}) {
  const obs = stockObservations(item, snapshots, orders)
  if (obs.length < 2) return []
  const inMap  = _flowByDate(item, movements, 'in')
  const outMap = _flowByDate(item, movements, 'out')
  const out = []
  for (let i = 1; i < obs.length; i++) {
    const p = obs[i - 1], c = obs[i]
    if (p.date === c.date) continue     // 同日観測は区間にならない
    const inflow  = _round(_sumBetween(inMap,  p.date, c.date))
    const outflow = _round(_sumBetween(outMap, p.date, c.date))
    const consumed = _round(p.qty + inflow - outflow - c.qty)
    const days = _daysBetween(p.date, c.date)
    out.push({
      fromDate: p.date, toDate: c.date, days,
      fromQty: p.qty, toQty: c.qty, inflow, outflow,
      consumed,
      perDay: days > 0 ? _round(consumed / days) : null,
      flagged: consumed < 0,            // マイナス消費＝入庫漏れ・計数ミスの疑い
    })
  }
  return out
}

/**
 * 直近 windowDays 日の平均日消費（マイナス消費区間は除外）。データ不足は null。
 * 出庫の記録が無くても、在庫観測＋入庫から消費を出せるのが肝。
 */
export function avgDailyConsumption(item, { windowDays = 30, snapshots = [], orders = [], movements = [] } = {}) {
  const intervals = consumptionIntervals(item, { snapshots, orders, movements })
  if (!intervals.length) return null
  const since = new Date(Date.now() - windowDays * 86400000).toISOString().slice(0, 10)
  let consumed = 0, days = 0
  for (const iv of intervals) {
    if (iv.flagged) continue
    if (iv.toDate < since) continue     // 窓の外
    consumed += iv.consumed
    days += iv.days
  }
  return days > 0 ? _round(consumed / days) : null
}
