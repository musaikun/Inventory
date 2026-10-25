// 申し送り（User決定 2026-10-25・モック docs/mocks/journal-calendar-v4.html・サーバー migration 0032）。
//
// - 📣 伝える（tell）: 読むだけ。「確認」で誰が読んだかが残る
// - 🙏 頼む（ask）: 相手といつを付けると、その人のやることになる（やることを作って、その id を申し送りに付ける）
// - 伝えたことも「やることにする」でやることにできる（1つだけ）
// - 日誌のその日に出すのは、前の日と当日に書いたもの（新しい順）
// - サーバーが正。端末には写し（localStorage）を置いて、開いたときすぐ出す
import { reactive, computed } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'
import { localDateKey } from '../utils/localDate.js'
import { deviceName, actorId, isMeId } from './useDeviceId.js'
import { isAdmin } from './useAuth.js'
import { loadHandoffsFromD1, addHandoffToD1, actHandoffInD1 } from './useStore.js'
import { addTask, removeTask } from './useTasks.js'

export const HANDOFF_BODY_MAX = 300
const _data = reactive({ list: [] })

function _load() {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEYS.handoffs) || '[]')
    _data.list = Array.isArray(v) ? v.filter(x => x?.id) : []
  } catch (_) { _data.list = [] }
}
function _persist() {
  try { localStorage.setItem(STORAGE_KEYS.handoffs, JSON.stringify(_data.list.slice(0, 200))) } catch (_) {}
}
_load()

export function resetLocalData() {
  _data.list = []
  try { localStorage.removeItem(STORAGE_KEYS.handoffs) } catch (_) {}
}

const _uid = () => 'h_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
const _put = h => { _data.list = [h, ..._data.list.filter(x => x.id !== h.id)].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')); _persist() }

export const handoffs = computed(() => _data.list)

export async function pullHandoffs() {
  const r = await loadHandoffsFromD1()
  if (!r?.ok) return false
  // まだ届いていない自分の書き込み（id が送り先に無いもの）は残す
  const got = new Set((r.handoffs ?? []).map(h => h.id))
  _data.list = [...(r.handoffs ?? []), ..._data.list.filter(h => h.pending && !got.has(h.id))]
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  _persist()
  return true
}

const _dayOf = h => localDateKey(new Date(h.createdAt))
/** その日に出す申し送り（前の日と当日に書いたもの・新しい順） */
export function handoffsFor(date) {
  const prev = localDateKey(new Date(new Date(date + 'T00:00:00').getTime() - 86400_000))
  return _data.list.filter(h => { const d = _dayOf(h); return d === date || d === prev })
}
/** 申し送りから作ったやること（task id → 申し送り） */
export const handoffOfTask = computed(() => new Map(_data.list.filter(h => h.taskId).map(h => [h.taskId, h])))

export const isReadByMe = h => !!h?.reads?.some(r => isMeId(r.id))
export const isMine = h => isMeId(h?.byId)
export const canRemoveHandoff = h => isMine(h) || isAdmin.value

async function _send(h) {
  _put({ ...h, pending: true })
  try {
    const r = await addHandoffToD1({ id: h.id, kind: h.kind, body: h.body, toId: h.toId, toName: h.toName, taskId: h.taskId, by: h.by, byId: h.byId })
    if (r?.handoff) _put(r.handoff)
    return r?.handoff ?? h
  } catch (e) {
    _data.list = _data.list.filter(x => x.id !== h.id); _persist()
    throw e
  }
}
const _draft = (kind, body, extra = {}) => {
  const text = String(body ?? '').trim().slice(0, HANDOFF_BODY_MAX)
  if (!text) throw new Error('中身を入れてください')
  return { id: _uid(), kind, body: text, by: deviceName.value || '', byId: actorId(), toId: null, toName: null, taskId: null, reads: [], createdAt: new Date().toISOString(), ...extra }
}

/** 📣 伝える */
export function tellHandoff(body) { return _send(_draft('tell', body)) }

/**
 * 🙏 頼む: その人（いなければ「誰でも」）の、その日のやることを作ってから送る
 * @param {{ body: string, to?: { id, name } | null, date: string, progress?: boolean }} p
 */
export async function askHandoff({ body, to = null, date, progress = false }) {
  const h = _draft('ask', body, to ? { toId: to.id, toName: to.name } : {})
  const t = addTask(date, h.body, to ? { mode: 'person', id: to.id, name: to.name } : { mode: 'anyone' }, null, progress ? { progress: 'doing' } : {})
  if (!t) throw new Error('やることを作れませんでした')
  try { return await _send({ ...h, taskId: t.id }) } catch (e) { removeTask(t.id); throw e }
}

/** 📣 を「やることにする」 */
export async function handoffToTask(h, { body, to = null, date, progress = false }) {
  const t = addTask(date, String(body || h.body).trim().slice(0, HANDOFF_BODY_MAX), to ? { mode: 'person', id: to.id, name: to.name } : { mode: 'anyone' }, null, progress ? { progress: 'doing' } : {})
  if (!t) throw new Error('やることを作れませんでした')
  _put({ ...h, taskId: t.id })
  try { const r = await actHandoffInD1(h.id, 'task', { taskId: t.id }); if (r?.handoff) _put(r.handoff) } catch (_) { /* やることは残す。次に読んだときに揃う */ }
  return t
}

/** 「確認」 */
export async function readHandoff(h) {
  if (isReadByMe(h)) return
  _put({ ...h, reads: [...(h.reads ?? []), { id: actorId(), name: deviceName.value || '', at: new Date().toISOString() }] })
  try { const r = await actHandoffInD1(h.id, 'read'); if (r?.handoff) _put(r.handoff) } catch (_) { _put(h) }
}

export async function removeHandoff(h) {
  if (!canRemoveHandoff(h)) return
  const before = _data.list
  _data.list = _data.list.filter(x => x.id !== h.id); _persist()
  try { await actHandoffInD1(h.id, 'delete') } catch (e) { _data.list = before; _persist(); throw e }
}

export function _reloadHandoffs() { _load() }
