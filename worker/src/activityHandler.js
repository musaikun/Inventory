// スタッフ1人の行動の記録（User決定 2026-10-15・スタッフ画面で人を押したとき）。
//
// - 作業時間: アプリを開いていた区間（work_sessions）
// - やったこと: 棚卸・発注を始めた／完了した、入庫・出庫、やることを作った／完了した（日時の新しい順）
// 見られるのは「ほかのスタッフの使用履歴」（monitor）を持つ人。直近 days 日（既定30・最大90）
const KEEP_DAYS = 90

/** @param {string} actorId スタッフ ID（オーナーは 'owner'） */
export async function handleStaffActivity(db, code, actorId, days = 30, nowMs = Date.now()) {
  const d = Math.min(Math.max(Number(days) || 30, 1), KEEP_DAYS)
  const since = new Date(nowMs - d * 86400_000).toISOString()
  const all = async (sql, ...args) => (await db.prepare(sql).bind(...args).all()).results ?? []

  const work = (await all(`
    SELECT started_at, last_seen_at FROM work_sessions
    WHERE shop_code = ? AND actor_id = ? AND last_seen_at >= ? ORDER BY started_at DESC LIMIT 500
  `, code, actorId, since)).map(r => ({
    startedAt: r.started_at, lastSeenAt: r.last_seen_at,
    minutes: Math.max(1, Math.round((Date.parse(r.last_seen_at) - Date.parse(r.started_at)) / 60000)),
  }))

  const actions = []
  const kindOf = t => (t === 'order' ? 'order' : 'stock')
  for (const r of await all(`
    SELECT type, started_at, ended_at, status, item_count, started_by_id, completed_by_id FROM sessions
    WHERE shop_code = ? AND deleted_at IS NULL AND import_batch_id IS NULL
      AND ((started_by_id = ? AND started_at >= ?) OR (completed_by_id = ? AND ended_at >= ?))
  `, code, actorId, since, actorId, since)) {
    const k = kindOf(r.type), label = k === 'order' ? '発注' : '棚卸'
    if (r.started_by_id === actorId && r.started_at >= since) actions.push({ at: r.started_at, kind: k, text: `${label}を始めた` })
    if (r.completed_by_id === actorId && r.status === 'completed' && r.ended_at) {
      actions.push({ at: r.ended_at, kind: k, text: `${label}を${k === 'order' ? '確定' : '完了'}`, sub: r.item_count ? `${r.item_count}品目` : '' })
    }
  }
  for (const r of await all(`
    SELECT m.type, m.saved_at, COUNT(l.id) AS n, MIN(l.item) AS first
    FROM movements m LEFT JOIN movement_lines l ON l.movement_id = m.id
    WHERE m.shop_code = ? AND m.created_by_id = ? AND m.saved_at >= ? AND m.deleted_at IS NULL
    GROUP BY m.id
  `, code, actorId, since)) {
    const out = r.type === 'out'
    actions.push({ at: r.saved_at, kind: out ? 'out' : 'in', text: `${out ? '出庫' : '入庫'} ${r.n}品目`, sub: r.first ? `${r.first}${r.n > 1 ? ' ほか' : ''}` : '' })
  }
  for (const r of await all(`
    SELECT body, created_at, done_at, created_by_id, done_by_id FROM tasks
    WHERE shop_code = ? AND deleted_at IS NULL AND kind IS NULL
      AND ((created_by_id = ? AND created_at >= ?) OR (done_by_id = ? AND done_at >= ?))
  `, code, actorId, since, actorId, since)) {
    if (r.created_by_id === actorId && r.created_at >= since) actions.push({ at: r.created_at, kind: 'task', text: `やること「${r.body}」を作成` })
    if (r.done_by_id === actorId && r.done_at && r.done_at >= since) actions.push({ at: r.done_at, kind: 'done', text: `「${r.body}」を完了` })
  }
  actions.sort((a, b) => (b.at || '').localeCompare(a.at || ''))
  return { days: d, work, actions: actions.slice(0, 300) }
}
