// やることのお気に入り（ひな形・User決定 2026-11-05・migration 0035・モック docs/mocks/task-create.html）
//
// - 店で共有。読むのは店の誰でも。足すのは「やることを作る」を持つ人（ルーターで確かめる）
// - 直す・外すのは作った人と管理者
// - 中身（data）は日付を持たない。使うときに追加の画面で日付を選ぶ
import { cleanItems, cleanTimes, cleanDays, CL_REPEAT, CL_NAME_MAX } from './checklistHandler.js'

export const TEMPLATE_KINDS = ['task', 'checklist', 'routine', 'progress', 'someday']
export const TEMPLATES_MAX = 100   // 1店のお気に入りの数

const _ID = /^[\w-]{1,64}$/
const _TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const _now = () => new Date().toISOString()
const _short = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
const _iso = v => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null)
const _json = (s, fallback) => { try { const v = JSON.parse(s ?? ''); return v ?? fallback } catch (_) { return fallback } }

/** 中身をととのえる（種類に要らないものは捨てる） */
export function cleanTemplateData(kind, d = {}) {
  const out = {}
  if (kind === 'checklist') { const items = cleanItems(d.items); if (items.length) out.items = items }
  if (kind === 'checklist' || kind === 'routine') {
    const repeat = CL_REPEAT.includes(d.repeat) ? d.repeat : 'none'
    out.repeat = kind === 'routine' && repeat === 'none' ? 'daily' : repeat
    const days = cleanDays(out.repeat, d.repeatDays)
    if (days) out.repeatDays = days
    const times = cleanTimes(d.dueTimes)
    if (times) out.dueTimes = times.split(',')
  }
  if (kind === 'task' && typeof d.dueTime === 'string' && _TIME.test(d.dueTime)) out.dueTime = d.dueTime
  if (d.assign && typeof d.assign === 'object') {
    const mode = d.assign.mode === 'person' ? 'person' : 'all'
    out.assign = mode === 'person' && _ID.test(d.assign.id ?? '') ? { mode, id: d.assign.id, name: _short(d.assign.name, 40) } : { mode: 'all' }
  }
  const note = _short(d.note, 500)
  if (note && kind !== 'checklist' && kind !== 'routine') out.note = note
  return out
}

const _row = r => ({
  id: r.id, kind: r.kind, name: r.name, data: _json(r.data_json, {}), sort: r.sort ?? 0,
  createdBy: r.created_by ?? '', createdById: r.created_by_id ?? '', createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at ?? null,
})

/** GET /store/:code/templates */
export async function handleTemplatesGet(db, code) {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString()
  const rows = (await db.prepare(`
    SELECT * FROM task_templates WHERE shop_code = ? AND (deleted_at IS NULL OR updated_at >= ?) ORDER BY sort, created_at LIMIT 300
  `).bind(code, since).all()).results ?? []
  return { ok: true, templates: rows.map(_row) }
}

/**
 * POST /store/:code/templates … 足す・直す（名前・並び）・外す（deletedAt）
 * @param {{ id: string, name: string }} who
 */
export async function handleTemplateUpsert(db, code, body = {}, who = {}, { admin = true } = {}) {
  const id = typeof body.id === 'string' ? body.id : ''
  const kind = TEMPLATE_KINDS.includes(body.kind) ? body.kind : ''
  const name = _short(body.name, CL_NAME_MAX)
  if (!_ID.test(id) || !kind || !name) return { _status: 400, code: 'invalid_template', error: 'お気に入りの内容が正しくありません（名前を入れてください）' }
  const prev = await db.prepare('SELECT shop_code, updated_at, created_by, created_by_id, created_at FROM task_templates WHERE id = ?').bind(id).first()
  if (prev && prev.shop_code !== code) return { _status: 404, error: '見つかりません' }   // 他店舗のIDは存在を漏らさない
  if (prev && !admin && prev.created_by_id !== who.id) {
    return { _status: 403, code: 'template_forbidden', error: 'このお気に入りを直す・外すのは、作った人と管理者だけです' }
  }
  if (!prev) {
    const n = await db.prepare('SELECT COUNT(*) AS n FROM task_templates WHERE shop_code = ? AND deleted_at IS NULL').bind(code).first()
    if ((n?.n ?? 0) >= TEMPLATES_MAX) return { _status: 409, code: 'template_limit', error: `お気に入りは${TEMPLATES_MAX}件までです。使わないものを外してください` }
  }
  const updatedAt = _iso(body.updatedAt) ?? _now()
  if (prev && prev.updated_at > updatedAt) return { ok: true, stale: true }
  const sort = Number.isInteger(body.sort) ? Math.max(-1e6, Math.min(1e6, body.sort)) : 0
  const row = {
    id, kind, name, data_json: JSON.stringify(cleanTemplateData(kind, body.data)), sort,
    created_by: prev ? prev.created_by : _short(who.name, 40), created_by_id: prev ? prev.created_by_id : _short(who.id, 64),
    created_at: prev ? prev.created_at : updatedAt, updated_at: updatedAt, deleted_at: _iso(body.deletedAt),
  }
  await db.prepare(`
    INSERT INTO task_templates (id, shop_code, kind, name, data_json, sort, created_by, created_by_id, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind, name = excluded.name, data_json = excluded.data_json, sort = excluded.sort,
      updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
    WHERE task_templates.shop_code = excluded.shop_code AND task_templates.updated_at <= excluded.updated_at
  `).bind(row.id, code, row.kind, row.name, row.data_json, row.sort, row.created_by, row.created_by_id, row.created_at, row.updated_at, row.deleted_at).run()
  return { ok: true, created: !prev, template: _row(row) }
}
