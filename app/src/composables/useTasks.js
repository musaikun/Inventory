// カレンダーの「やること」（店で共有するTODO・User決定 2026-10-04）。
//
// - 1件 = { id, date(YYYY-MM-DD), text, createdBy, createdById, createdAt, doneAt, doneBy, deletedAt, updatedAt,
//          assign, assigneeId, assigneeName, doneList, dueTime }
// - 時刻（dueTime 'HH:MM'・TODO 本格化 A）: その日の中は時刻の順、時刻なしは後ろ
// - 期限切れ: 日付が過ぎても終わっていないもの。今日の一覧の上に残す（繰り返し（B）は持ち越さない予定）
// - 担当（段 2-4）: assign = 'anyone'（誰でも・誰か1人が完了）/ 'all'（全員・一人ひとりが印）/ 'person'（特定の人）/ 'none'（未定）
//   「全員」の印は端末どうしで上書きし合わないよう、サーバーの /mark で合流させる。完了（doneAt）はサーバーが決める
// - 端末に置いて（localStorage）すぐ出し、サーバーへは保存の列（useStore の _save）で送る。
//   他の端末の変更は loadTasksFromD1 で取り込み、同じ1件は updatedAt の新しい方を残す
// - 消すときも行は残し deletedAt を立てる（他の端末へ「消した」を届けるため）
// - 「誰が」はスタッフなら本人の名前、オーナーなら端末名（段 2-2）。自分のものかは ID（createdById＝スタッフ ID か端末 ID）で見る
// - 新着: 他の端末が追加した、まだ確認していないもの。確認した時刻は端末ごとに覚える
import { reactive, ref, computed } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'
import { localDateKey } from '../utils/localDate.js'
import { deviceName, actorId } from './useDeviceId.js'
import { loadTasksFromD1, saveTaskToD1, markTaskInD1 } from './useStore.js'
import { ownPushEndpoint } from './usePush.js'

export const TASK_TEXT_MAX = 200

const _data = reactive({ list: [] })
const _seenAt = ref('')

function _load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.tasks) || '[]')
    if (Array.isArray(parsed)) _data.list = parsed.filter(t => t && t.id && t.date)
  } catch (_) { /* 壊れていたら空から */ }
  try { _seenAt.value = localStorage.getItem(STORAGE_KEYS.tasksSeen) || '' } catch (_) { _seenAt.value = '' }
}
function _persist() {
  try { localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify(_data.list)) } catch (_) { /* 保存できなくても今の画面には出る */ }
}
_load()

/** アカウント切替時のローカル全消去 */
export function resetLocalData() {
  _data.list = []
  _seenAt.value = ''
  try { localStorage.removeItem(STORAGE_KEYS.tasks); localStorage.removeItem(STORAGE_KEYS.tasksSeen) } catch (_) {}
}

function _uid() { return 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }
const _now = () => new Date().toISOString()
const _alive = t => !t.deletedAt

async function _send(task) {
  const pushEndpoint = await ownPushEndpoint()
  return saveTaskToD1(pushEndpoint ? { ...task, pushEndpoint } : task)
}

const _byTime = (a, b) =>
  (a.dueTime ? 0 : 1) - (b.dueTime ? 0 : 1) || (a.dueTime || '').localeCompare(b.dueTime || '') || (a.createdAt || '').localeCompare(b.createdAt || '')

/** その日のやること（時刻の順、時刻なしは追加した順で後ろ） */
export function tasksOn(date) {
  return _data.list.filter(t => t.date === date && _alive(t)).sort(_byTime)
}

/** 期限切れ: today より前の日付で、まだ終わっていないもの（古い日から） */
export function overdueTasks(today = localDateKey()) {
  return _data.list
    .filter(t => _alive(t) && !t.doneAt && t.date < today)
    .sort((a, b) => a.date.localeCompare(b.date) || _byTime(a, b))
}
export const overdueCount = computed(() => overdueTasks().length)

/** 消していないやることすべて（やること画面の「これから」「完了」で日ごとにまとめる） */
export const aliveTasks = computed(() => _data.list.filter(_alive))
/** 自分に関係するもの: 自分が担当（特定の人）か、「全員」で自分がまだ印を付けていない／付けたもの */
export function isForMe(t) { return isAssignedToMe(t) || t?.assign === 'all' }

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const _time = v => (typeof v === 'string' && TIME_RE.test(v) ? v : null)

/** 日付 → まだ終わっていないやることの数。カレンダーの印に使う */
export const openTaskCounts = computed(() => {
  const m = new Map()
  for (const t of _data.list) if (_alive(t) && !t.doneAt) m.set(t.date, (m.get(t.date) || 0) + 1)
  return m
})
/** やることがある日（未完了があるか） */
export const openTaskDates = computed(() => new Set(openTaskCounts.value.keys()))

export const TASK_ASSIGNS = ['anyone', 'all', 'person', 'none']
function _assignFields(a) {
  const mode = TASK_ASSIGNS.includes(a?.mode) ? a.mode : 'anyone'
  if (mode === 'person' && !a?.id) return { assign: 'anyone', assigneeId: null, assigneeName: null }
  return { assign: mode, assigneeId: mode === 'person' ? a.id : null, assigneeName: mode === 'person' ? (a.name || '') : null }
}

/** @param {{ mode: string, id?: string, name?: string }} [assign] 担当（省略は「誰でも」） */
export function addTask(date, text, assign = null, dueTime = null) {
  const body = String(text ?? '').trim().slice(0, TASK_TEXT_MAX)
  if (!body || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const now = _now()
  const t = {
    id: _uid(), date, text: body,
    createdBy: deviceName.value || '', createdById: actorId(), createdAt: now,
    doneAt: null, doneBy: null, deletedAt: null, updatedAt: now,
    ..._assignFields(assign), doneList: [], dueTime: _time(dueTime),
  }
  _data.list.push(t)
  _persist()
  _send(t)
  return t
}

function _patch(id, fields) {
  const t = _data.list.find(x => x.id === id)
  if (!t) return null
  Object.assign(t, fields, { updatedAt: _now() })
  _persist()
  _send({ ...t })
  return t
}
export function toggleTask(id) {
  const t = _data.list.find(x => x.id === id)
  if (!t) return null
  if (t.assign === 'all') { markTask(t); return t }
  return _patch(id, t.doneAt ? { doneAt: null, doneBy: null, doneById: null } : { doneAt: _now(), doneBy: deviceName.value || '', doneById: actorId() })
}

/** 「全員」のやることで、自分が印を付けたか */
export function isMarkedByMe(t) { return !!t?.doneList?.some(x => x.id === actorId()) }

/** 「全員」の印を付ける・外す。まず画面に出し、サーバーの結果（完了したか）で揃える。届かなければ戻す */
async function markTask(t) {
  const before = [...(t.doneList || [])]
  const done = !isMarkedByMe(t)
  const me = actorId()
  t.doneList = done ? [...before.filter(x => x.id !== me), { id: me, name: deviceName.value || '', at: _now() }] : before.filter(x => x.id !== me)
  _persist()
  try {
    const r = await markTaskInD1(t.id, done, deviceName.value || '', me)
    if (!r?.ok) throw new Error(r?.error || 'mark failed')
    if (!r.skipped) { t.doneList = r.doneList ?? t.doneList; t.doneAt = r.doneAt ?? null }
  } catch (_) {
    t.doneList = before
  }
  _persist()
}

/** 文面・日付・時刻を直す（作る権限のある人。TODO 本格化 A）。日付を変えると別の日へ移る */
export function editTask(id, { text, date, dueTime } = {}) {
  const t = _data.list.find(x => x.id === id)
  if (!t) return null
  const fields = {}
  if (text !== undefined) {
    const body = String(text ?? '').trim().slice(0, TASK_TEXT_MAX)
    if (!body) return null
    fields.text = body
  }
  if (date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
    fields.date = date
  }
  if (dueTime !== undefined) fields.dueTime = _time(dueTime)
  return _patch(id, fields)
}

/** 担当を変える（作る権限のある人。段 2-4） */
export function setTaskAssign(id, assign) { return _patch(id, _assignFields(assign)) }
export function removeTask(id) { return _patch(id, { deletedAt: _now() }) }

/** サーバーの一覧を取り込む（同じ1件は updatedAt の新しい方） */
export function applyRemoteTasks(remote) {
  if (!Array.isArray(remote)) return
  const byId = new Map(_data.list.map(t => [t.id, t]))
  let changed = false
  for (const r of remote) {
    if (!r?.id || !r.date) continue
    const cur = byId.get(r.id)
    if (!cur) { _data.list.push({ ...r }); changed = true; continue }
    if ((r.updatedAt || '') > (cur.updatedAt || '')) { Object.assign(cur, r); changed = true }
  }
  // 初めて読んだ端末では、すでにあるものを「新着」にしない
  if (!_seenAt.value) markTasksSeen()
  if (changed) _persist()
}

export async function pullTasks() {
  const list = await loadTasksFromD1()
  if (Array.isArray(list)) applyRemoteTasks(list)
  return Array.isArray(list)
}

/** 他の端末が追加して、この端末ではまだ確認していないもの（追加した順） */
export const newTasks = computed(() => {
  const seen = _seenAt.value
  if (!seen) return []
  return _data.list
    .filter(t => _alive(t) && t.createdById !== actorId() && (t.createdAt || '') > seen)
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
})
export function isNewTask(t) { return newTasks.value.some(x => x.id === t.id) }

export function markTasksSeen() {
  _seenAt.value = _now()
  try { localStorage.setItem(STORAGE_KEYS.tasksSeen, _seenAt.value) } catch (_) {}
}

/** 今日の未完了のやることの数（ナビのバッジ） */
export const todayOpenCount = computed(() => {
  const today = localDateKey()
  return _data.list.filter(t => t.date <= today && _alive(t) && !t.doneAt).length   // 期限切れも含める
})

export function isMyTask(t) { return !!t && t.createdById === actorId() }
/** 自分が担当のやること（特定の人で自分） */
export function isAssignedToMe(t) { return t?.assign === 'person' && t.assigneeId === actorId() }

// テスト用：保存先から読み直す
export function _reloadTasks() { _load() }
