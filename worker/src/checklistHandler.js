// 毎日のチェック（中の項目＋繰り返し＋1日に何回も・User決定 2026-10-19・migration 0030・モック docs/mocks/journal-checklist-v3.html）。
//
// - ひな形（checklists）は店ごと。作る・直す・消すのは管理者だけ（ルーターで確かめる）
// - ルーティン（2026-10-22）: 中の項目は任意。項目なし＝押せば済む1件（印の項目 id は '_'）
// - 日・回ごとの✓（checklist_runs）は、その回の最初の✓でひな形の項目を写して作る。回は 'HH:MM'（時刻なしは ''）。あとで表を直しても、その日の記録は崩れない
// - ✓・「今日はなし」の時刻はサーバーが刻む（端末の時計は使わない）。外せるのは付けた人がその日のうち（管理者はいつでも）
// - 印は端末どうしで上書きし合わないよう、読んだ marks_json が変わっていたら読み直す（やることの「全員」の印と同じ）
import { dayJst } from './taskWrite.js'

export const CL_REPEAT = ['none', 'daily', 'weekly', 'monthly']
export const CL_NAME_MAX = 60
export const CL_ITEM_MAX = 100
export const CL_ITEMS_MAX = 50
export const CL_REASON_MAX = 100
export const CL_TIMES_MAX = 8

const _ID = /^[\w-]{1,64}$/
const _DATE = /^\d{4}-\d{2}-\d{2}$/
const _TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const _now = () => new Date().toISOString()
const _short = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
const _iso = v => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null)
const _json = (s, fallback) => { try { const v = JSON.parse(s ?? ''); return v ?? fallback } catch (_) { return fallback } }

/** 項目: [{ id, text }]。空の文面・重なった id は捨てる */
export function cleanItems(v) {
  if (!Array.isArray(v)) return []
  const seen = new Set(), out = []
  for (const x of v) {
    const id = typeof x?.id === 'string' ? x.id : ''
    const text = _short(x?.text, CL_ITEM_MAX)
    if (!_ID.test(id) || !text || seen.has(id)) continue
    seen.add(id); out.push({ id, text })
    if (out.length >= CL_ITEMS_MAX) break
  }
  return out
}

/** 1日の時刻: 'HH:MM' の配列（カンマ区切りでも）→ 並べて重なりを除いたカンマ区切り。無ければ null */
export function cleanTimes(v) {
  const list = (Array.isArray(v) ? v : String(v ?? '').split(',')).map(x => String(x).trim()).filter(x => _TIME.test(x))
  const out = [...new Set(list)].sort().slice(0, CL_TIMES_MAX)
  return out.length ? out.join(',') : null
}

/** 項目なしのルーティンの印に使う項目 id */
export const WHOLE = '_'

/** 繰り返しの日: weekly は曜日（0〜6）、monthly は日（1〜31・月末は 'L'）のカンマ区切り。合わなければ null */
export function cleanDays(mode, v) {
  if (mode === 'weekly') {
    const days = [...new Set((Array.isArray(v) ? v : String(v ?? '').split(',')).filter(x => x !== '' && x != null).map(Number))]
      .filter(n => Number.isInteger(n) && n >= 0 && n <= 6).sort()
    return days.length ? days.join(',') : null
  }
  if (mode === 'monthly') {
    const raw = (Array.isArray(v) ? v : String(v ?? '').split(',')).map(x => String(x).trim()).filter(Boolean)
    const days = [...new Set(raw.filter(x => /^\d{1,2}$/.test(x)).map(Number).filter(n => n >= 1 && n <= 31))].sort((a, b) => a - b)
    const out = [...days.map(String), ...(raw.includes('L') ? ['L'] : [])]
    return out.length ? out.join(',') : null
  }
  return null
}

const _list = r => ({
  id: r.id, name: r.name, items: cleanItems(_json(r.items_json, [])),
  repeat: CL_REPEAT.includes(r.repeat_mode) ? r.repeat_mode : 'none', repeatDays: r.repeat_days ?? null,
  startDate: r.start_date, dueTimes: r.due_times ? r.due_times.split(',') : [],
  assign: r.assign_mode === 'person' ? 'person' : 'anyone', assigneeId: r.assignee_id ?? null, assigneeName: r.assignee_name ?? null,
  paused: !!r.paused, createdBy: r.created_by ?? '', createdById: r.created_by_id ?? '',
  createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at ?? null,
})
const _run = r => ({
  checklistId: r.checklist_id, date: r.run_date, slot: r.run_slot ?? '', items: cleanItems(_json(r.items_json, [])),
  marks: _json(r.marks_json, {}), updatedAt: r.updated_at,
})

/**
 * GET /store/:code/checklists?sinceDays=N … 表（消したものは N日以内に消したものだけ）と、N日以内の日の記録
 */
export async function handleChecklistsGet(db, code, sinceDays) {
  const n = Math.min(Math.max(Number(sinceDays) || 120, 1), 400)
  const since = new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10)
  const lists = (await db.prepare(`
    SELECT * FROM checklists WHERE shop_code = ? AND (deleted_at IS NULL OR updated_at >= ?) ORDER BY created_at LIMIT 500
  `).bind(code, since).all()).results ?? []
  const runs = (await db.prepare(`
    SELECT checklist_id, run_date, run_slot, items_json, marks_json, updated_at FROM checklist_runs
    WHERE shop_code = ? AND run_date >= ? ORDER BY run_date DESC LIMIT 5000
  `).bind(code, since).all()).results ?? []
  return { ok: true, checklists: lists.map(_list), runs: runs.map(_run) }
}

/**
 * POST /store/:code/checklists … 表を作る・直す・お休み・消す（管理者だけ・ルーターで確かめる）
 * @param {{ id: string, name: string }} who 作った人（新しく作るときだけ刻む）
 */
export async function handleChecklistUpsert(db, code, body = {}, who = {}) {
  const id = typeof body.id === 'string' ? body.id : ''
  const name = _short(body.name, CL_NAME_MAX)
  const items = cleanItems(body.items)
  const repeat = CL_REPEAT.includes(body.repeat) ? body.repeat : 'none'
  const repeatDays = cleanDays(repeat, body.repeatDays)
  const startDate = typeof body.startDate === 'string' && _DATE.test(body.startDate) ? body.startDate : ''
  const deletedAt = _iso(body.deletedAt)
  if (!_ID.test(id) || !name || !startDate) {
    return { _status: 400, code: 'invalid_checklist', error: 'ルーティンの内容が正しくありません（名前を入れてください）' }
  }
  if ((repeat === 'weekly' || repeat === 'monthly') && !repeatDays) {
    return { _status: 400, code: 'invalid_checklist', error: '繰り返す曜日・日を選んでください' }
  }
  const assign = body.assign === 'person' ? 'person' : 'anyone'
  const assigneeId = assign === 'person' ? (_short(body.assigneeId, 64) || null) : null
  if (assign === 'person' && !assigneeId) return { _status: 400, code: 'invalid_checklist', error: '担当の人を選んでください' }
  const prev = await db.prepare('SELECT shop_code, updated_at, created_by, created_by_id, created_at FROM checklists WHERE id = ?').bind(id).first()
  if (prev && prev.shop_code !== code) return { _status: 404, error: '見つかりません' }   // 他店舗のIDは存在を漏らさない
  const updatedAt = _iso(body.updatedAt) ?? _now()
  if (prev && prev.updated_at > updatedAt) return { ok: true, stale: true }
  const row = {
    id, name, items_json: JSON.stringify(items), repeat_mode: repeat, repeat_days: repeatDays, start_date: startDate,
    due_times: cleanTimes(body.dueTimes),
    assign_mode: assign, assignee_id: assigneeId, assignee_name: assign === 'person' ? (_short(body.assigneeName, 40) || null) : null,
    paused: body.paused ? 1 : 0,
    created_by: prev ? prev.created_by : _short(who.name, 40), created_by_id: prev ? prev.created_by_id : _short(who.id, 64),
    created_at: prev ? prev.created_at : updatedAt, updated_at: updatedAt, deleted_at: deletedAt,
  }
  await db.prepare(`
    INSERT INTO checklists (id, shop_code, name, items_json, repeat_mode, repeat_days, start_date, due_times,
      assign_mode, assignee_id, assignee_name, paused, created_by, created_by_id, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, items_json = excluded.items_json, repeat_mode = excluded.repeat_mode, repeat_days = excluded.repeat_days,
      start_date = excluded.start_date, due_times = excluded.due_times, assign_mode = excluded.assign_mode,
      assignee_id = excluded.assignee_id, assignee_name = excluded.assignee_name, paused = excluded.paused,
      updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
    WHERE checklists.shop_code = excluded.shop_code AND checklists.updated_at <= excluded.updated_at
  `).bind(row.id, code, row.name, row.items_json, row.repeat_mode, row.repeat_days, row.start_date, row.due_times,
    row.assign_mode, row.assignee_id, row.assignee_name, row.paused, row.created_by, row.created_by_id,
    row.created_at, row.updated_at, row.deleted_at).run()
  return { ok: true, created: !prev, checklist: _list(row) }
}

/**
 * POST /store/:code/checklists/:id/runs/:date/mark … 項目に✓・「今日はなし」・外す
 * body = { slot: 'HH:MM' | '', itemId, state: 'done' | 'skip' | null, reason? }
 * @param {{ id: string, name: string }} who
 */
export async function handleChecklistMark(db, code, id, date, body = {}, who = {}, { admin = false, nowIso = _now() } = {}) {
  const itemId = typeof body.itemId === 'string' ? body.itemId : ''
  const state = body.state === 'done' || body.state === 'skip' ? body.state : null
  const slot = typeof body.slot === 'string' ? body.slot : ''
  if (slot && !_TIME.test(slot)) return { _status: 400, error: '回の時刻が正しくありません' }
  if (!who?.id) return { _status: 400, error: '誰の印か分かりません' }
  if (!_ID.test(id) || !_DATE.test(date) || !_ID.test(itemId)) return { _status: 400, error: '内容が正しくありません' }
  const today = dayJst(nowIso)
  if (date > today) return { _status: 403, code: 'checklist_forbidden', error: 'その日になってから✓を付けてください' }
  const cl = await db.prepare('SELECT items_json, assign_mode, assignee_id, deleted_at FROM checklists WHERE id = ? AND shop_code = ?').bind(id, code).first()
  if (!cl || cl.deleted_at) return { _status: 404, error: '見つかりません' }
  if (cl.assign_mode === 'person' && cl.assignee_id !== who.id && !admin) {
    return { _status: 403, code: 'checklist_forbidden', error: 'このルーティンに✓を付けられるのは、担当の人と管理者だけです' }
  }
  for (let i = 0; i < 4; i++) {
    const run = await db.prepare('SELECT items_json, marks_json FROM checklist_runs WHERE shop_code = ? AND checklist_id = ? AND run_date = ? AND run_slot = ?')
      .bind(code, id, date, slot).first()
    const items = run ? cleanItems(_json(run.items_json, [])) : cleanItems(_json(cl.items_json, []))
    // 項目なしのルーティンは、全体を1つの印（'_'）で済ませる
    if (!(items.length ? items.some(x => x.id === itemId) : itemId === WHOLE)) return { _status: 404, error: '項目が見つかりません' }
    const marks = run ? _json(run.marks_json, {}) : {}
    const cur = marks[itemId]
    if (!state) {
      if (!cur) return { ok: true, run: { checklistId: id, date, slot, items, marks } }
      if (!admin && (cur.byId !== who.id || dayJst(cur.at) !== today)) {
        return { _status: 403, code: 'checklist_forbidden', error: '外せるのは、付けた人がその日のうちだけです（それ以降は管理者）' }
      }
      delete marks[itemId]
    } else if (cur?.s === state && cur.byId === who.id && (state === 'done' || (cur.reason ?? '') === _short(body.reason, CL_REASON_MAX))) {
      return { ok: true, run: { checklistId: id, date, slot, items, marks } }   // 同じ印の送り直し（時刻は前のまま）
    } else {
      const reason = state === 'skip' ? _short(body.reason, CL_REASON_MAX) : ''
      marks[itemId] = { s: state, by: _short(who.name, 40), byId: who.id, at: nowIso, ...(reason ? { reason } : {}) }
    }
    const next = JSON.stringify(marks)
    const r = run
      ? await db.prepare(`UPDATE checklist_runs SET marks_json = ?, updated_at = ?
          WHERE shop_code = ? AND checklist_id = ? AND run_date = ? AND run_slot = ? AND marks_json = ?`)
        .bind(next, nowIso, code, id, date, slot, run.marks_json).run()
      : await db.prepare(`INSERT INTO checklist_runs (shop_code, checklist_id, run_date, run_slot, items_json, marks_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`)
        .bind(code, id, date, slot, JSON.stringify(items), next, nowIso).run()
    if (r?.meta?.changes === 1) return { ok: true, run: { checklistId: id, date, slot, items, marks, updatedAt: nowIso } }
  }
  return { _status: 409, error: '同時に✓が付きました。もう一度押してください' }
}
