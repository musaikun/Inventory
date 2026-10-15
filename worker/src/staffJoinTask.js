// スタッフの参加申請を、店の管理者のやることにする（User決定 2026-10-14）。
//
// - 管理者（店長）は店に1人。申請があったら管理者の担当で「○○さんから参加の申請がありました…」を作る。
//   管理者がいなければオーナーの担当
// - 承認・お断り・取り消し（申請中に削除）で、自動で完了にする（人の手では完了・直す・消すができない）
// - 1日たっても終わっていなければ、担当へもう一度知らせる（pushHandler の cron）
import { OWNER_ID } from './ownerHandler.js'

export const JOIN_KIND = 'staff_join'
const _now = () => new Date().toISOString()
const _dayJst = (ms = Date.now()) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10)
export const joinTaskText = name => `${name}さんから参加の申請がありました。承認するか決めてください`

/** 申請を受け持つ人: 管理者（店長）。いなければオーナー */
export async function responsibleAdmin(db, code) {
  const admin = await db.prepare("SELECT id, name FROM staff WHERE shop_code = ? AND role = 'admin' AND status = 'active' ORDER BY created_at LIMIT 1")
    .bind(code).first()
  if (admin) return { id: admin.id, name: admin.name }
  const st = await db.prepare('SELECT owner_name FROM stores WHERE shop_code = ?').bind(code).first().catch(() => null)
  return { id: OWNER_ID, name: st?.owner_name || 'オーナー' }
}

/** 申請のやることを作る（同じ申請で2つ作らない）。管理者だけに見せる（visibility 'admins'・2026-10-15） */
export async function createJoinTask(db, code, staffId, name) {
  const who = await responsibleAdmin(db, code)
  const now = _now()
  await db.prepare(`
    INSERT OR IGNORE INTO tasks (id, shop_code, task_date, body, created_by, created_by_id, created_at, updated_at,
      assign_mode, assignee_id, assignee_name, kind, ref_id, visibility)
    VALUES (?, ?, ?, ?, 'タナオロ', 'system', ?, ?, 'person', ?, ?, ?, ?, 'admins')
  `).bind(`t_join_${staffId}`, code, _dayJst(), joinTaskText(name), now, now, who.id, who.name, JOIN_KIND, staffId).run()
  return who
}

/** 承認・お断りで申請のやることを完了にする。result は「承認しました」など */
export async function resolveJoinTask(db, code, staffId, name, result, actor) {
  const now = _now()
  await db.prepare(`
    UPDATE tasks SET done_at = ?, done_by = ?, done_by_id = ?, body = ?, updated_at = ?
    WHERE shop_code = ? AND kind = ? AND ref_id = ? AND done_at IS NULL AND deleted_at IS NULL
  `).bind(now, actor?.name || '', actor?.id || null, `${name}さんの参加申請：${result}`, now, code, JOIN_KIND, staffId).run()
}
