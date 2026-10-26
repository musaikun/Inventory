// 申し送り（User決定 2026-10-25・migration 0032・モック docs/mocks/journal-calendar-v4.html）。
//
// - 📣 伝える（tell）: 読むだけ。読んだ人が「確認」を押すと、誰が読んだかが残る（reads_json）
// - 🙏 頼む（ask）: 相手といつを付けて、その人のやることを作る（やることは端末が作り、その id を task_id に）
// - 伝えたことも、あとで「やることにする」で task_id を付けられる（1つだけ）
// - 書けるのは店の誰でも。消せるのは書いた人と管理者。時刻はサーバーが刻む
// - 読むのは直近 sinceDays 日（既定 14）。消したものは出さない

export const HANDOFF_KINDS = ['tell', 'ask']
export const HANDOFF_BODY_MAX = 300

const _ID = /^[\w-]{1,64}$/
const _now = () => new Date().toISOString()
const _short = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
const _json = (s, fallback) => { try { const v = JSON.parse(s ?? ''); return v ?? fallback } catch (_) { return fallback } }

function _row(r) {
  return {
    id: r.id, kind: r.kind, body: r.body,
    by: r.by_name || '', byId: r.by_id || null,
    toId: r.to_id || null, toName: r.to_name || null,
    taskId: r.task_id || null,
    reads: _json(r.reads_json, []),
    createdAt: r.created_at,
  }
}

export async function handleHandoffsGet(db, code, sinceDays, { nowMs = Date.now() } = {}) {
  const n = Math.min(60, Math.max(1, Number(sinceDays) || 14))
  const since = new Date(nowMs - n * 86400_000).toISOString()
  const rows = (await db.prepare('SELECT * FROM handoffs WHERE shop_code = ? AND created_at >= ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200')
    .bind(code, since).all()).results ?? []
  return { ok: true, handoffs: rows.map(_row) }
}

export async function handleHandoffAdd(db, code, body = {}, who = {}, { nowIso = _now() } = {}) {
  const kind = HANDOFF_KINDS.includes(body.kind) ? body.kind : null
  if (!kind) return { _status: 400, error: '伝えるか頼むかを選んでください' }
  const text = _short(body.body, HANDOFF_BODY_MAX)
  if (!text) return { _status: 400, error: '中身を入れてください' }
  if (!who?.id) return { _status: 400, error: '誰の書き込みか分かりません' }
  const id = typeof body.id === 'string' && _ID.test(body.id) ? body.id : 'h_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  const toId = kind === 'ask' && typeof body.toId === 'string' && _ID.test(body.toId) ? body.toId : null
  const toName = toId ? _short(body.toName, 40) : null
  const taskId = typeof body.taskId === 'string' && _ID.test(body.taskId) ? body.taskId : null
  const by = _short(who.name, 40)
  // 同じ id を2度送っても1件（電波の再送）
  await db.prepare(`INSERT INTO handoffs (id, shop_code, kind, body, by_name, by_id, to_id, to_name, task_id, reads_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?) ON CONFLICT(shop_code, id) DO NOTHING`)
    .bind(id, code, kind, text, by, who.id, toId, toName, taskId, nowIso).run()
  const row = await db.prepare('SELECT * FROM handoffs WHERE shop_code = ? AND id = ?').bind(code, id).first()
  return { ok: true, handoff: _row(row) }
}

async function _alive(db, code, id) {
  if (!_ID.test(String(id))) return null
  const row = await db.prepare('SELECT * FROM handoffs WHERE shop_code = ? AND id = ?').bind(code, id).first()
  return row && !row.deleted_at ? row : null
}

/** 「確認」: 読んだ人を足す（同じ人は1回） */
export async function handleHandoffRead(db, code, id, who = {}, { nowIso = _now() } = {}) {
  if (!who?.id) return { _status: 400, error: '誰が読んだか分かりません' }
  for (let i = 0; i < 3; i++) {
    const row = await _alive(db, code, id)
    if (!row) return { _status: 404, error: '見つかりません' }
    const reads = _json(row.reads_json, [])
    if (reads.some(r => r.id === who.id)) return { ok: true, handoff: _row(row) }
    const next = JSON.stringify([...reads, { id: who.id, name: _short(who.name, 40), at: nowIso }].slice(-50))
    // ほかの端末が同時に押したら読み直す
    const res = await db.prepare('UPDATE handoffs SET reads_json = ? WHERE shop_code = ? AND id = ? AND reads_json = ?').bind(next, code, id, row.reads_json).run()
    if (res?.meta?.changes === 1) return { ok: true, handoff: _row({ ...row, reads_json: next }) }
  }
  return { _status: 409, error: 'もう一度押してください' }
}

/**
 * タスク化（連絡のメッセージ → やること・User決定 2026-10-26）: 作ったやることの id を付ける（1つだけ。先に付いていればそのまま）。
 * clear: true は「取り消す」。付いている id が同じときだけ外す
 */
export async function handleHandoffTask(db, code, id, body = {}) {
  const taskId = typeof body.taskId === 'string' && _ID.test(body.taskId) ? body.taskId : null
  if (!taskId) return { _status: 400, error: 'やることが分かりません' }
  const row = await _alive(db, code, id)
  if (!row) return { _status: 404, error: '見つかりません' }
  if (body.clear === true) await db.prepare('UPDATE handoffs SET task_id = NULL WHERE shop_code = ? AND id = ? AND task_id = ?').bind(code, id, taskId).run()
  else if (!row.task_id) await db.prepare('UPDATE handoffs SET task_id = ? WHERE shop_code = ? AND id = ? AND task_id IS NULL').bind(taskId, code, id).run()
  const after = await _alive(db, code, id)
  return { ok: true, handoff: _row(after) }
}

/** 消す: 書いた人と管理者 */
export async function handleHandoffDelete(db, code, id, who = {}, { admin = false, nowIso = _now() } = {}) {
  const row = await _alive(db, code, id)
  if (!row) return { ok: true }
  if (!admin && row.by_id !== who?.id) return { _status: 403, error: '消せるのは書いた人と管理者だけです' }
  await db.prepare('UPDATE handoffs SET deleted_at = ? WHERE shop_code = ? AND id = ?').bind(nowIso, code, id).run()
  return { ok: true }
}
