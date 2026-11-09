// ルーティン（毎日・毎週・毎月の決まった仕事。中の項目は任意＋1日に何回も・User決定 2026-10-19 / 2026-10-22・モック docs/mocks/journal-routine.html）。
// 以前の名前は「毎日のチェック」（コードの名前は checklist のまま）。
//
// - 表は店ごと（サーバーが正）。作るのは「やることを作る」を持つ人（スタッフも・2026-11-05）、直す・お休み・消すのは作った人と管理者。
//   その場で送る（届かなければ戻して知らせる）
// - ✓・「今日はなし」は誰でも（担当の人がいれば担当と管理者）。まず画面に出し、サーバーの結果（記録の1日分）で揃える
// - 外せるのは付けた人がその日のうち（管理者はいつでも）。サーバーも同じ規則で確かめる
// - 端末には写し（localStorage）を置いて、開いたときすぐ出す
import { reactive, computed } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'
import { localDateKey } from '../utils/localDate.js'
import { deviceName, actorId, isMeId } from './useDeviceId.js'
import { isAdmin, can } from './useAuth.js'
import { loadChecklistsFromD1, saveChecklistToD1, markChecklistInD1 } from './useStore.js'
import { runKey, checklistsOn, dayRun, dayChecklist } from '../services/checklistSchedule.js'

export const CL_NAME_MAX = 60
export const CL_ITEM_MAX = 100
export const CL_ITEMS_MAX = 50
export const CL_TIMES_MAX = 8

const _data = reactive({ lists: [], runs: {} })

function _load() {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEYS.checklists) || 'null')
    _data.lists = Array.isArray(v?.lists) ? v.lists.filter(x => x?.id) : []
    _data.runs = v?.runs && typeof v.runs === 'object' ? v.runs : {}
  } catch (_) { _data.lists = []; _data.runs = {} }
}
function _persist() {
  try { localStorage.setItem(STORAGE_KEYS.checklists, JSON.stringify({ lists: _data.lists, runs: _data.runs })) } catch (_) {}
}
_load()

export function resetLocalData() {
  _data.lists = []; _data.runs = {}
  try { localStorage.removeItem(STORAGE_KEYS.checklists) } catch (_) {}
}

const _uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
export const newItemId = () => _uid('i_')
const _now = () => new Date().toISOString()

/** 使っている表（消したものは除く） */
export const checklists = computed(() => _data.lists.filter(x => !x.deletedAt))
export const checklistRuns = computed(() => _data.runs)
export function checklistsForDay(date) { return checklistsOn(_data.lists, _data.runs, date) }
export function runOf(cl, date, slot = '') { return dayRun(cl, _data.runs, date, slot) }
export function dayOf(cl, date) { return dayChecklist(cl, _data.runs, date) }

export async function pullChecklists() {
  const r = await loadChecklistsFromD1()
  if (!r?.ok) return false
  _data.lists = Array.isArray(r.checklists) ? r.checklists : []
  const runs = { ..._data.runs }
  for (const x of r.runs ?? []) if (x?.checklistId && x.date) runs[runKey(x.checklistId, x.date, x.slot ?? '')] = x
  _data.runs = runs
  _persist()
  return true
}

// ── 表を作る（やることを作れる人）・直す（作った人と管理者）──
export const canEditChecklists = computed(() => can('task.create'))
export function canEditChecklist(cl) { return !!cl && (isAdmin.value || isMeId(cl.createdById)) }

/**
 * 保存。繰り返し（種類・曜日・日）を変えたら、予定を数え始める日を今日にする（過去の「手つかず」を作り直さない）。
 * 先の日（startDate > 今日）を渡したら、繰り返しもその日から
 * @returns {Promise<object>} 保存した表。届かなければ投げる（画面で知らせる）
 */
export async function saveChecklist(fields) {
  const prev = fields.id ? _data.lists.find(x => x.id === fields.id) : null
  if (prev ? !canEditChecklist(prev) : !canEditChecklists.value) throw new Error(prev ? 'このチェック表を直すのは、作った人と管理者だけです' : 'チェック表・ルーティンを作る権限がありません')
  const today = localDateKey()
  const schedChanged = !prev || prev.repeat !== fields.repeat || (prev.repeatDays ?? null) !== (fields.repeatDays ?? null)
    || (fields.repeat === 'none' && prev.startDate !== fields.startDate)
  const cl = {
    ...(prev ?? {}),
    ...fields,
    id: prev?.id ?? _uid('cl_'),
    name: String(fields.name ?? '').trim().slice(0, CL_NAME_MAX),
    dueTimes: [...new Set((fields.dueTimes ?? []).filter(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)))].sort().slice(0, CL_TIMES_MAX),
    items: (fields.items ?? []).map(x => ({ id: x.id || newItemId(), text: String(x.text ?? '').trim().slice(0, CL_ITEM_MAX) })).filter(x => x.text).slice(0, CL_ITEMS_MAX),
    // 繰り返しは、先の日を選んで作ったらその日から（追加の画面で日付を選んだとき・2026-11-09 触診）。それ以外は今まで通り
    startDate: fields.repeat === 'none' ? (fields.startDate || today)
      : (fields.startDate && fields.startDate > today ? fields.startDate : (schedChanged ? today : prev.startDate)),
    createdBy: prev?.createdBy ?? (deviceName.value || ''), createdById: prev?.createdById ?? actorId(),
    updatedAt: _now(),
  }
  if (!cl.name) throw new Error('名前を入れてください')   // 項目なし＝押せば済む1件
  return _send(cl, prev)
}
async function _send(cl, prev) {
  const i = _data.lists.findIndex(x => x.id === cl.id)
  if (i >= 0) _data.lists.splice(i, 1, cl); else _data.lists.push(cl)
  _persist()
  try {
    const r = await saveChecklistToD1(cl)
    if (r?.checklist) { const j = _data.lists.findIndex(x => x.id === cl.id); if (j >= 0) _data.lists.splice(j, 1, r.checklist) }
    _persist()
    return r?.checklist ?? cl
  } catch (e) {
    const j = _data.lists.findIndex(x => x.id === cl.id)
    if (prev) _data.lists.splice(j, 1, prev); else if (j >= 0) _data.lists.splice(j, 1)
    _persist()
    throw e
  }
}
export function setChecklistPaused(id, paused) {
  const prev = _data.lists.find(x => x.id === id)
  if (!prev || !canEditChecklist(prev)) return Promise.reject(new Error('このルーティンを直すのは、作った人と管理者だけです'))
  return _send({ ...prev, paused: !!paused, updatedAt: _now() }, prev)
}
export function removeChecklist(id) {
  const prev = _data.lists.find(x => x.id === id)
  if (!prev || !canEditChecklist(prev)) return Promise.reject(new Error('このルーティンを消すのは、作った人と管理者だけです'))
  return _send({ ...prev, deletedAt: _now(), updatedAt: _now() }, prev)
}

// ── ✓ ──
const _dayOf = iso => (iso ? localDateKey(new Date(iso)) : '')
/** この表に✓を付けられるか（担当の人がいれば担当と管理者） */
export function canMarkChecklist(cl) {
  if (!cl || cl.deletedAt) return false
  return cl.assign !== 'person' || isAdmin.value || isMeId(cl.assigneeId)
}
/** 付いている印を外せるか（付けた人がその日のうち・管理者はいつでも） */
export function canUnmark(mark) {
  if (!mark) return true
  return isAdmin.value || (isMeId(mark.byId) && _dayOf(mark.at) === localDateKey())
}

/**
 * 項目に✓（'done'）・今日はなし（'skip'）・外す（null）。slot は回（'HH:MM'。時刻なしは ''）
 * @returns {Promise<void>} 断られたら投げる（画面で知らせる）
 */
export async function markChecklistItem(cl, date, slot, itemId, state, reason = '') {
  if (date > localDateKey()) throw new Error('その日になってから✓を付けてください')
  if (!canMarkChecklist(cl)) throw new Error('このルーティンに✓を付けられるのは、担当の人と管理者だけです')
  const key = runKey(cl.id, date, slot)
  const before = _data.runs[key] ?? null
  const items = before?.items?.length ? before.items : cl.items
  const marks = { ...(before?.marks ?? {}) }
  if (state) marks[itemId] = { s: state, by: deviceName.value || '', byId: actorId(), at: _now(), ...(reason ? { reason } : {}) }
  else delete marks[itemId]
  _data.runs = { ..._data.runs, [key]: { checklistId: cl.id, date, slot, items, marks, updatedAt: _now() } }
  try {
    const r = await markChecklistInD1(cl.id, date, { slot, itemId, state, reason, by: deviceName.value || '', byId: actorId() })
    if (r?.run) _data.runs = { ..._data.runs, [key]: { ...r.run, checklistId: cl.id, date, slot } }
    _persist()
  } catch (e) {
    const runs = { ..._data.runs }
    if (before) runs[key] = before; else delete runs[key]
    _data.runs = runs
    _persist()
    throw e
  }
}

// テスト用
export function _reloadChecklists() { _load() }
