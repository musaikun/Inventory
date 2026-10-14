// オーナーを1人にまとめる（User決定 2026-10-14）。
//
// 以前はオーナーの「誰が」を端末 ID で記録していたので、スマホと PC のオーナーが別の人に見えた
// （作業時間・やることの作った人・担当に入れられない）。オーナーはどの端末でも ID 'owner'、
// 名前は店に1つ（stores.owner_name）。名前は管理画面からだけ変え、変えたら過去の記録の名前もそろえる。
// 既存の記録（スタッフの ID でない「誰が」＝オーナーの端末 ID）は、店ごとに初回のアクセスで 'owner' へ寄せる。

export const OWNER_ID = 'owner'
const NAME_MAX = 40
const _now = () => new Date().toISOString()
export const normOwnerName = v => (typeof v === 'string' ? v.trim().slice(0, NAME_MAX) : '')

/** オーナーの名前（未設定なら ''） */
export async function getOwnerName(db, code) {
  const r = await db.prepare('SELECT owner_name FROM stores WHERE shop_code = ?').bind(code).first().catch(() => null)
  return r?.owner_name ?? ''
}

/**
 * オーナーの記録の名前を name にそろえる（ID 'owner' で結び付いたものだけ）。
 * やることは updated_at を進め、各端末が次に取り直したときに新しい名前へそろうようにする。
 */
async function _renameOwnerRecords(db, code, name, now) {
  const id = OWNER_ID
  await db.batch([
    db.prepare('UPDATE tasks SET created_by = ?, updated_at = ? WHERE shop_code = ? AND created_by_id = ?').bind(name, now, code, id),
    db.prepare('UPDATE tasks SET done_by = ?, updated_at = ? WHERE shop_code = ? AND done_by_id = ?').bind(name, now, code, id),
    db.prepare('UPDATE tasks SET assignee_name = ?, updated_at = ? WHERE shop_code = ? AND assignee_id = ?').bind(name, now, code, id),
    db.prepare('UPDATE movements SET created_by = ? WHERE shop_code = ? AND created_by_id = ?').bind(name, code, id),
    db.prepare('UPDATE sessions SET started_by = ? WHERE shop_code = ? AND started_by_id = ?').bind(name, code, id),
    db.prepare('UPDATE sessions SET completed_by = ? WHERE shop_code = ? AND completed_by_id = ?').bind(name, code, id),
    db.prepare('UPDATE work_sessions SET name = ? WHERE shop_code = ? AND actor_id = ?').bind(name, code, id),
  ])
  // 「全員」の印の名前（JSON の並び）
  const rows = (await db.prepare("SELECT id, done_list_json FROM tasks WHERE shop_code = ? AND instr(done_list_json, '\"owner\"') > 0")
    .bind(code).all()).results ?? []
  for (const r of rows) {
    const list = _parse(r.done_list_json).map(x => (x.id === id ? { ...x, name } : x))
    await db.prepare('UPDATE tasks SET done_list_json = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(list), now, r.id).run()
  }
}

function _parse(json) {
  try { const a = JSON.parse(json || '[]'); return Array.isArray(a) ? a.filter(x => x && typeof x.id === 'string') : [] } catch (_) { return [] }
}

/** オーナーの名前を変える（管理画面・オーナー本人だけ）。過去の記録の名前もそろえる */
export async function setOwnerName(db, code, name) {
  const n = normOwnerName(name)
  if (!n) return { _status: 400, error: '名前を入れてください' }
  const clash = await db.prepare("SELECT id FROM staff WHERE shop_code = ? AND status IN ('active','stopped','pending') AND lower(trim(name)) = lower(?)")
    .bind(code, n).first()
  if (clash) return { _status: 409, error: '同じ名前のスタッフがいます。別の名前にしてください' }
  const now = _now()
  await db.prepare('UPDATE stores SET owner_name = ?, updated_at = ? WHERE shop_code = ?').bind(n, now, code).run()
  await _renameOwnerRecords(db, code, n, now)
  return { ok: true, name: n }
}

/**
 * 店ごとに1回: オーナーの端末 ID で記録された「誰が」を 'owner' へ寄せ、名前が無ければ fallbackName で決める。
 * スタッフの ID でない ID ＝ オーナーの端末（スタッフは段 2-2 から本人の ID で記録している）。
 * @returns {Promise<string>} オーナーの名前
 */
export async function ensureOwnerUnified(db, code, fallbackName = '') {
  const st = await db.prepare('SELECT owner_name, owner_unified_at FROM stores WHERE shop_code = ?').bind(code).first().catch(() => null)
  if (!st) return ''
  if (st.owner_unified_at) return st.owner_name ?? ''
  const now = _now()
  const notStaff = col => `${col} IS NOT NULL AND ${col} != '' AND ${col} != '${OWNER_ID}' AND ${col} NOT IN (SELECT id FROM staff WHERE shop_code = ?)`
  await db.batch([
    db.prepare(`UPDATE tasks SET created_by_id = '${OWNER_ID}', updated_at = ? WHERE shop_code = ? AND ${notStaff('created_by_id')}`).bind(now, code, code),
    db.prepare(`UPDATE tasks SET done_by_id = '${OWNER_ID}', updated_at = ? WHERE shop_code = ? AND ${notStaff('done_by_id')}`).bind(now, code, code),
    db.prepare(`UPDATE movements SET created_by_id = '${OWNER_ID}' WHERE shop_code = ? AND ${notStaff('created_by_id')}`).bind(code, code),
    db.prepare(`UPDATE sessions SET started_by_id = '${OWNER_ID}' WHERE shop_code = ? AND ${notStaff('started_by_id')}`).bind(code, code),
    db.prepare(`UPDATE sessions SET completed_by_id = '${OWNER_ID}' WHERE shop_code = ? AND ${notStaff('completed_by_id')}`).bind(code, code),
    db.prepare(`UPDATE work_sessions SET actor_id = '${OWNER_ID}' WHERE shop_code = ? AND staff_id IS NULL`).bind(code),
    db.prepare(`UPDATE push_subscriptions SET actor_id = '${OWNER_ID}' WHERE shop_code = ? AND ${notStaff('actor_id')}`).bind(code, code),
  ])
  // 「全員」の印: オーナーの端末ごとの印を1つにまとめる
  const staffIds = new Set(((await db.prepare('SELECT id FROM staff WHERE shop_code = ?').bind(code).all()).results ?? []).map(r => r.id))
  const rows = (await db.prepare("SELECT id, done_list_json FROM tasks WHERE shop_code = ? AND done_list_json IS NOT NULL AND done_list_json != '[]'")
    .bind(code).all()).results ?? []
  for (const r of rows) {
    const list = _parse(r.done_list_json)
    if (!list.some(x => !staffIds.has(x.id) && x.id !== OWNER_ID)) continue
    const out = []
    for (const x of list) {
      const id = staffIds.has(x.id) ? x.id : OWNER_ID
      if (!out.some(y => y.id === id)) out.push({ ...x, id })
    }
    await db.prepare('UPDATE tasks SET done_list_json = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(out), now, r.id).run()
  }
  let name = st.owner_name ?? ''
  if (!name) {
    name = normOwnerName(fallbackName) || 'オーナー'
    await db.prepare('UPDATE stores SET owner_name = ? WHERE shop_code = ?').bind(name, code).run()
  }
  await _renameOwnerRecords(db, code, name, now)
  await db.prepare('UPDATE stores SET owner_unified_at = ? WHERE shop_code = ?').bind(now, code).run()
  return name
}
