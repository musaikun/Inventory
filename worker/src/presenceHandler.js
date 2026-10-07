// ログイン中の表示と作業の記録（スタッフのログイン 段 2-5・User決定 2026-10-07）。
//
// - 端末はアプリを開いている間 90秒ごとに POST /presence（閉じるときは state: 'off'）
// - 1回＝ work_sessions の1行。前の知らせから5分以内なら同じ1回を延ばし、それより空いたら別の1回
// - いま開いている＝閉じた知らせが無く、最後の知らせから150秒以内
// - 見られるのは管理者だけ（GET /presence。権限 monitor）。スタッフの画面には「管理者から見える」と出す
const ONLINE_MS   = 150_000
const CONTINUE_MS = 5 * 60_000
const KEEP_DAYS   = 90

const _now = () => new Date().toISOString()
const _short = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '')

/**
 * @param {{ id: string, name: string, staff: boolean, staffId?: string }} actor
 * @param {'on'|'off'} state
 */
export async function handlePresenceBeat(db, code, actor, state = 'on', nowMs = Date.now()) {
  if (!actor?.id) return { _status: 400, error: '誰か分かりません' }
  const now = new Date(nowMs).toISOString()
  const name = _short(actor.name, 40) || '名前未設定'
  const last = await db.prepare(`
    SELECT id, last_seen_at, closed_at FROM work_sessions
    WHERE shop_code = ? AND actor_id = ? ORDER BY last_seen_at DESC LIMIT 1
  `).bind(code, actor.id).first()
  const closed = state === 'off' ? now : null
  if (last && nowMs - Date.parse(last.last_seen_at) <= CONTINUE_MS) {
    await db.prepare('UPDATE work_sessions SET last_seen_at = ?, closed_at = ?, name = ? WHERE id = ?')
      .bind(now, closed, name, last.id).run()
    return { ok: true }
  }
  if (state === 'off') return { ok: true }   // 開いていない間に「閉じた」だけ届いても記録は作らない
  await db.batch([
    db.prepare(`INSERT INTO work_sessions (id, shop_code, actor_id, staff_id, name, started_at, last_seen_at, closed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`).bind(crypto.randomUUID(), code, actor.id, actor.staff ? actor.id : null, name, now, now),
    db.prepare('DELETE FROM work_sessions WHERE shop_code = ? AND last_seen_at < ?')
      .bind(code, new Date(nowMs - KEEP_DAYS * 86400_000).toISOString()),
  ])
  return { ok: true }
}

/**
 * 管理者向け: いま開いている人と、直近 days 日の開いていた記録・人ごとの合計（分）。
 * スタッフは承認済み・停止中も含めて全員を並べ、一度も開いていない人も出す。
 */
export async function handlePresenceGet(db, code, days = 7, nowMs = Date.now()) {
  const d = Math.min(Math.max(Number(days) || 7, 1), KEEP_DAYS)
  const since = new Date(nowMs - d * 86400_000).toISOString()
  const rows = (await db.prepare(`
    SELECT actor_id, staff_id, name, started_at, last_seen_at, closed_at FROM work_sessions
    WHERE shop_code = ? AND last_seen_at >= ? ORDER BY started_at DESC LIMIT 2000
  `).bind(code, since).all()).results ?? []
  const staff = (await db.prepare(`
    SELECT id, name, role, status FROM staff WHERE shop_code = ? AND status IN ('active', 'stopped', 'deleted') ORDER BY created_at
  `).bind(code).all()).results ?? []
  const lastSeen = (await db.prepare(`
    SELECT actor_id, MAX(last_seen_at) AS seen FROM work_sessions WHERE shop_code = ? GROUP BY actor_id
  `).bind(code).all()).results ?? []
  const seenMap = new Map(lastSeen.map(r => [r.actor_id, r.seen]))

  const people = new Map()
  const person = (id, base) => {
    if (!people.has(id)) people.set(id, { id, minutes: 0, online: false, lastSeenAt: seenMap.get(id) ?? null, onlineSince: null, ...base })
    return people.get(id)
  }
  for (const s of staff) {
    if (s.status === 'deleted' && !seenMap.has(s.id)) continue
    person(s.id, { name: s.status === 'deleted' ? `${s.name}（削除済み）` : s.name, role: s.role, status: s.status, owner: false })
  }
  const sessions = []
  for (const r of rows) {
    const p = person(r.actor_id, { name: r.name, role: r.staff_id ? null : 'owner', status: 'active', owner: !r.staff_id })
    const start = Date.parse(r.started_at), end = Date.parse(r.last_seen_at)
    const minutes = Math.max(1, Math.round((end - start) / 60000))
    p.minutes += minutes
    const online = !r.closed_at && nowMs - end <= ONLINE_MS
    if (online) { p.online = true; p.onlineSince = r.started_at }
    sessions.push({ id: r.actor_id, name: p.name, startedAt: r.started_at, lastSeenAt: r.last_seen_at, minutes, online })
  }
  const list = [...people.values()].sort((a, b) => (b.online - a.online) || (b.lastSeenAt || '').localeCompare(a.lastSeenAt || ''))
  return { days: d, people: list, sessions }
}
