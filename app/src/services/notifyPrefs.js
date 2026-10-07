// 通知の設定（端末ごと・User決定 2026-10-05）。サーバーの worker/src/pushPlan.js と同じ形・同じ既定。
// どちらかを変えたら両方を変える（サーバーは受け取った値を自分でもそろえ直す）。
export const NOTIFY_DAY_OPTIONS = [0, 1, 3, 7]
export const ORDER_LEAD_OPTIONS = [60, 120, 180]
export const GAP_MIN = 7
export const GAP_MAX = 90

export const DEFAULT_PREFS = Object.freeze({
  hour: 9,
  monthEnd:      { on: true,  days: [0, 1] },
  gap:           { on: true,  days: 35 },
  stale:         { on: true },
  taskDay:       { on: true,  days: [0, 1] },
  taskAdded:     { on: true },
  taskAssigned:  { on: true },
  orderDeadline: { on: false, mins: [60] },
})

const _bool = (v, d) => (typeof v === 'boolean' ? v : d)
const _pick = (arr, allowed, d) => {
  if (!Array.isArray(arr)) return [...d]
  return [...new Set(arr.map(Number).filter(n => allowed.includes(n)))].sort((a, b) => a - b)
}

export function normalizePrefs(src) {
  const p = src && typeof src === 'object' && !Array.isArray(src) ? src : {}
  const d = DEFAULT_PREFS
  const hour = Number.isInteger(p.hour) && p.hour >= 0 && p.hour <= 23 ? p.hour : d.hour
  const gapDays = Number(p.gap?.days)
  return {
    hour,
    monthEnd:      { on: _bool(p.monthEnd?.on, d.monthEnd.on), days: _pick(p.monthEnd?.days, NOTIFY_DAY_OPTIONS, d.monthEnd.days) },
    gap:           { on: _bool(p.gap?.on, d.gap.on), days: Number.isInteger(gapDays) && gapDays >= GAP_MIN && gapDays <= GAP_MAX ? gapDays : d.gap.days },
    stale:         { on: _bool(p.stale?.on, d.stale.on) },
    taskDay:       { on: _bool(p.taskDay?.on, d.taskDay.on), days: _pick(p.taskDay?.days, NOTIFY_DAY_OPTIONS, d.taskDay.days) },
    taskAdded:     { on: _bool(p.taskAdded?.on, d.taskAdded.on) },
    taskAssigned:  { on: _bool(p.taskAssigned?.on, d.taskAssigned.on) },
    orderDeadline: { on: _bool(p.orderDeadline?.on, d.orderDeadline.on), mins: _pick(p.orderDeadline?.mins, ORDER_LEAD_OPTIONS, d.orderDeadline.mins) },
  }
}

export const dayLabel = n => (n === 0 ? '当日' : n === 1 ? '前日' : `${n}日前`)
export const leadLabel = m => `${m / 60}時間前`
