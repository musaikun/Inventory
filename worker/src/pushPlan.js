/**
 * 通知の設定（端末ごと）と、毎時の cron で「いま何を送るか」を決める（User決定 2026-10-05）。
 *
 * 決め方は純粋な関数にしてある（D1・送信は pushHandler.js）。同じ通知を二度送らないための
 * 印（key）も一緒に返し、送る側は push_sent に印を入れられたときだけ送る。
 *
 * 時刻はすべて日本時間（JST = UTC+9）で考える。
 */

export const NOTIFY_DAY_OPTIONS = [0, 1, 3, 7]      // 当日・前日・3日前・7日前
export const NOTIFY_HOUR_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]
export const ORDER_LEAD_OPTIONS = [60, 120, 180]     // 発注の締切の何分前（cron が毎時なので1時間刻み）
export const GAP_MIN = 7
export const GAP_MAX = 90

/**
 * 通知は「受け取る」をONにしたら全部届く（User決定 2026-10-16）。種類ごとのオン・オフ、日数・時刻の選択はなくした。
 * 月末の棚卸は前日と当日、しばらく棚卸していないのは35日、発注の締切は1時間前。
 * 日付で知らせる通知の時刻（hour）は、その人がいつもその日に最初にアプリを開く時刻（usualHour）。記録が無ければ9時。
 * 以前の端末が送ってくる設定（prefs_json）は読まない（形だけ残す）
 */
export const DEFAULT_HOUR = 9
export const DEFAULT_PREFS = Object.freeze({
  hour: DEFAULT_HOUR,
  monthEnd:      { on: true, days: [0, 1] },
  gap:           { on: true, days: 35 },
  stale:         { on: true },
  taskDay:       { on: true, days: [0, 1] },
  taskAdded:     { on: true },
  taskAssigned:  { on: true },
  orderDeadline: { on: true, mins: [60] },
})

/** いつも同じ設定（hour だけ人ごとに変わる） */
export function normalizePrefs(_src, hour = DEFAULT_HOUR) {
  const d = DEFAULT_PREFS
  return {
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_HOUR,
    monthEnd: { ...d.monthEnd, days: [...d.monthEnd.days] }, gap: { ...d.gap }, stale: { ...d.stale },
    taskDay: { ...d.taskDay, days: [...d.taskDay.days] }, taskAdded: { ...d.taskAdded }, taskAssigned: { ...d.taskAssigned },
    orderDeadline: { ...d.orderDeadline, mins: [...d.orderDeadline.mins] },
  }
}

/**
 * いつもその日に最初にアプリを開く時刻（JST の時）。開いた記録（work_sessions の started_at）から、
 * 日ごとの最初の時刻をとり、その真ん中（中央値）の「時」。3日分に満たなければ null（既定の9時）
 * 例: 9:40・9:10・10:20 に最初に開く人 → 9時（いつも開く前後に届く）
 */
export const USUAL_MIN_DAYS = 3
export function usualHour(startedAts) {
  const first = new Map()
  for (const iso of startedAts ?? []) {
    const ms = Date.parse(iso || '')
    if (!Number.isFinite(ms)) continue
    const j = new Date(ms + 9 * 3600 * 1000)
    const key = j.toISOString().slice(0, 10)
    const min = j.getUTCHours() * 60 + j.getUTCMinutes()
    if (!first.has(key) || first.get(key) > min) first.set(key, min)
  }
  if (first.size < USUAL_MIN_DAYS) return null
  const mins = [...first.values()].sort((a, b) => a - b)
  return Math.floor(mins[Math.floor((mins.length - 1) / 2)] / 60)
}

export function parsePrefs(json) {
  if (!json) return normalizePrefs(null)
  try { return normalizePrefs(JSON.parse(json)) } catch (_) { return normalizePrefs(null) }
}

// ── 日付（JST）────────────────────────────────────────────
const JST_MS = 9 * 3600 * 1000
const DAY_MS = 86400000
const _pad = n => String(n).padStart(2, '0')
/** UTC の Date → JST の { y, m, d, hour, minute, dow, key:'YYYY-MM-DD', dayMs } */
export function jstParts(now) {
  const j = new Date(now.getTime() + JST_MS)
  const y = j.getUTCFullYear(), m = j.getUTCMonth() + 1, d = j.getUTCDate()
  return {
    y, m, d, hour: j.getUTCHours(), minute: j.getUTCMinutes(), dow: j.getUTCDay(),
    key: `${y}-${_pad(m)}-${_pad(d)}`,
    dayMs: Date.UTC(y, m - 1, d),            // JST のその日の 0時を UTC の数直線で表したもの
  }
}
const _keyOf = ms => { const t = new Date(ms); return `${t.getUTCFullYear()}-${_pad(t.getUTCMonth() + 1)}-${_pad(t.getUTCDate())}` }
const _md = key => { const [, m, d] = key.split('-').map(Number); return `${m}/${d}` }
const _dowJa = ms => '日月火水木金土'[new Date(ms).getUTCDay()]
const _when = n => (n === 0 ? '今日' : n === 1 ? '明日' : `${n}日後`)

const _payload = (body, tag) => ({ title: 'タナオロ', body, tag, url: '/' })

/**
 * いま送る通知を決める（1端末ぶん）。
 * @param {object} a
 * @param {Date}   a.now
 * @param {object} a.prefs           normalizePrefs 済み
 * @param {string|null} a.lastCompletedAt  最後に終えた棚卸の時刻（ISO / 'YYYY-MM-DD HH:MM:SS'）
 * @param {string[]} a.staleSessionIds     始めて1日以上・7日以内の途中の棚卸
 * @param {{date:string, text:string}[]} a.openTasks  まだ終わっていないやること（今日〜7日後）
 * @param {{id:string, name:string, days:number[], deadline:string}[]} a.schedules  発注日・締切
 * @returns {{ key: string, payload: object }[]}
 */
export function planNotifications({ now, prefs, lastCompletedAt = null, staleSessionIds = [], openTasks = [], schedules = [] }) {
  const t = jstParts(now)
  const out = []
  const atHour = t.hour === prefs.hour

  if (atHour && prefs.monthEnd.on) {
    const lastDay = new Date(Date.UTC(t.y, t.m, 0)).getUTCDate()
    const left = lastDay - t.d
    if (prefs.monthEnd.days.includes(left)) {
      const endKey = `${t.y}-${_pad(t.m)}-${_pad(lastDay)}`
      const body = left === 0 ? '今日は月末です。棚卸の日です📋'
        : left === 1 ? `明日は月末です。${_md(endKey)}（${_dowJa(t.dayMs + DAY_MS)}）は棚卸の日です📋`
        : `月末（${_md(endKey)}）まであと${left}日です。棚卸の準備をしましょう📋`
      out.push({ key: `me:${t.y}-${_pad(t.m)}:${left}`, payload: _payload(body, 'month-end') })
    }
  }

  if (atHour && prefs.gap.on && lastCompletedAt) {
    const last = new Date(String(lastCompletedAt).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(lastCompletedAt) ? '' : 'Z'))
    if (!Number.isNaN(last.getTime())) {
      const lastKey = jstParts(last).key
      const days = Math.floor((t.dayMs - jstParts(last).dayMs) / DAY_MS)
      if (days >= prefs.gap.days) {
        out.push({ key: `gap:${lastKey}`, payload: _payload(`前回の棚卸（${_md(lastKey)}）から${days}日たちました。そろそろ棚卸しましょう📋`, 'reminder') })
      }
    }
  }

  if (atHour && prefs.stale.on) {
    for (const id of staleSessionIds) {
      out.push({ key: `stale:${id}`, payload: _payload('棚卸が途中のままです🔖 続きからすぐ再開できます', 'stale-session') })
    }
  }

  if (atHour && prefs.taskDay.on) {
    for (const n of prefs.taskDay.days) {
      const dateKey = _keyOf(t.dayMs + n * DAY_MS)
      const list = openTasks.filter(x => x.date === dateKey)
      if (!list.length) continue
      const head = list[0].text.length > 40 ? list[0].text.slice(0, 40) + '…' : list[0].text
      const more = list.length > 1 ? ` ほか${list.length - 1}件` : ''
      const label = n <= 1 ? `${_when(n)}のやること` : `${_md(dateKey)}（${_when(n)}）のやること`
      out.push({ key: `task:${dateKey}:${n}`, payload: _payload(`${label}：${head}${more}`, 'task-day') })
    }
  }

  if (prefs.orderDeadline.on) {
    const nowMin = t.hour * 60   // cron は毎時0分。この1時間に来る分を送る
    for (const s of schedules) {
      if (!Array.isArray(s?.days) || !s.days.includes(t.dow)) continue
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(s.deadline ?? ''))
      if (!m) continue
      const dl = Number(m[1]) * 60 + Number(m[2])
      for (const lead of prefs.orderDeadline.mins) {
        const at = dl - lead
        if (at < 0 || at < nowMin || at >= nowMin + 60) continue
        const name = String(s.name || '発注').slice(0, 30)
        const rem = dl - nowMin   // 送るのは毎時0分なので、残りは「決めた何時間前」より少し長いことがある
        const left = `${Math.floor(rem / 60)}時間${rem % 60 ? `${rem % 60}分` : ''}`
        out.push({
          key: `ord:${t.key}:${s.id ?? name}:${lead}`,
          payload: _payload(`「${name}」の発注の締切は ${_pad(Number(m[1]))}:${m[2]} です（あと${left}）🧾`, 'order-deadline'),
        })
      }
    }
  }
  return out
}

/** 送った通知の印の保ち期間（古い印は cron で消す） */
export const SENT_KEEP_DAYS = 45
