// カレンダーの「やること」（店で共有するTODO・User決定 2026-10-04）。
//
// - いつか（2026-10-13）: date = ''（日付を決めていない）。日誌のリストの下にだけ出し、月・1日・期限切れ・バッジには数えない
// - 1件 = { id, date(YYYY-MM-DD か ''), text, createdBy, createdById, createdAt, doneAt, doneBy, deletedAt, updatedAt,
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
import { deviceName, actorId, isMeId } from './useDeviceId.js'
import { isAdmin, can } from './useAuth.js'
import * as R from '../services/taskRights.js'
import { loadTasksFromD1, saveTaskToD1, markTaskInD1 } from './useStore.js'
import { ownPushEndpoint } from './usePush.js'

export const TASK_TEXT_MAX = 200

const _data = reactive({ list: [] })
const _seenAt = ref('')

function _load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.tasks) || '[]')
    if (Array.isArray(parsed)) _data.list = parsed.filter(t => t && t.id && typeof t.date === 'string')
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
const _DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const _dateOk = d => d === '' || _DATE_RE.test(d)

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
    .filter(t => _alive(t) && !t.doneAt && t.date && t.date < today)
    .sort((a, b) => a.date.localeCompare(b.date) || _byTime(a, b))
}
export const overdueCount = computed(() => overdueTasks().length)

/** 消していないやることすべて（やること画面の「これから」「完了」で日ごとにまとめる） */
export const aliveTasks = computed(() => _data.list.filter(_alive))
/** いつか（日付なし）の、まだ終わっていないもの（追加した順） */
export const somedayTasks = computed(() => _data.list
  .filter(t => _alive(t) && t.date === '' && !t.doneAt)
  .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')))
/** 自分に関係するもの: 自分が担当（特定の人）か、「全員」で自分がまだ印を付けていない／付けたもの */
export function isForMe(t) { return isAssignedToMe(t) || t?.assign === 'all' }

/**
 * 済み: since（YYYY-MM-DD）以降に終えたもの。終えた日（端末の日付）ごと・新しい日から、その日の中も新しい順。
 * 「全員」は全員がそろって完了したもの（doneAt）だけ
 */
export function doneTaskGroups(since) {
  const m = new Map()
  for (const t of _data.list) {
    if (!_alive(t) || !t.doneAt) continue
    const d = localDateKey(new Date(t.doneAt))
    if (d < since) continue
    ;(m.get(d) ?? m.set(d, []).get(d)).push(t)
  }
  return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, items]) => ({ date, items: items.sort((a, b) => b.doneAt.localeCompare(a.doneAt)) }))
}

/** 期限から遅れて終えたか。期限は日付（時刻があればその時刻、なければその日の終わり）。days は日付の差（同じ日に時刻を過ぎたら 0） */
export function doneLateness(t) {
  if (!t?.doneAt) return null
  if (!t.date) return { late: false, days: 0 }   // いつか（期限なし）
  const done = new Date(t.doneAt)
  const due = new Date(`${t.date}T${t.dueTime || '23:59'}:59`)
  if (done <= due) return { late: false, days: 0 }
  const day = k => Date.UTC(...k.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)))
  return { late: true, days: Math.round((day(localDateKey(done)) - day(t.date)) / 86400_000) }
}

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const _time = v => (typeof v === 'string' && TIME_RE.test(v) ? v : null)

/** 日付 → まだ終わっていないやることの数。カレンダーの印に使う */
export const openTaskCounts = computed(() => {
  const m = new Map()
  for (const t of _data.list) if (_alive(t) && !t.doneAt && t.date) m.set(t.date, (m.get(t.date) || 0) + 1)
  return m
})
/** 日付 → { total: その日のやることの数, open: まだ終わっていない数 }。月のマスの件数と状態に使う（2026-10-14） */
export const taskDayStats = computed(() => {
  const m = new Map()
  for (const t of _data.list) {
    if (!_alive(t) || !t.date) continue
    const s = m.get(t.date) ?? m.set(t.date, { total: 0, open: 0 }).get(t.date)
    s.total++
    if (!t.doneAt) s.open++
  }
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
  if (!body || !_dateOk(date)) return null
  const now = _now()
  const t = {
    id: _uid(), date, text: body,
    createdBy: deviceName.value || '', createdById: actorId(), createdAt: now,
    doneAt: null, doneBy: null, deletedAt: null, updatedAt: now,
    ..._assignFields(assign), doneList: [], dueTime: date ? _time(dueTime) : null,
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
// ── 権限（User決定 2026-10-14・規則は services/taskRights.js。サーバーも同じ規則で確かめる）──
const _dayLocal = iso => (iso ? localDateKey(new Date(iso)) : '')
function _me() { return { id: actorId(), admin: isAdmin.value, canCreate: can('task.create') } }
/** 完了の印を押せるか（未完了なら付ける、完了なら取り消す。「全員」は自分の印） */
export function canToggleTask(t) {
  if (!t || t.deletedAt) return false
  if (t.assign === 'all') return isMarkedByMe(t) ? R.canUnmark({ doneList: (t.doneList || []).map(x => (isMeId(x.id) ? { ...x, id: actorId() } : x)) }, _me(), localDateKey(), _dayLocal) : true
  return t.doneAt ? R.canUndo(t, _me(), localDateKey(), _dayLocal) : R.canComplete(t, _me())
}
/** 文面・日付・時刻・担当を直せるか（未完了の間だけ、作った人と管理者） */
export function canEditTask(t) { return R.canEdit(t, _me()) }
/** 消せるか（未完了の間だけ、作った人と管理者。完了したものは誰も消せない） */
export function canRemoveTask(t) { return R.canRemove(t, _me()) }
/** 押せないときの一言 */
export function toggleDenyReason(t) {
  if (!t || canToggleTask(t)) return ''
  if (t.assign === 'all' || t.doneAt) return '完了を取り消せるのは、完了した人がその日のうちだけです（それ以降は管理者）'
  return '担当の人だけが完了にできます'
}

export function toggleTask(id) {
  const t = _data.list.find(x => x.id === id)
  if (!t || !canToggleTask(t)) return null
  if (t.assign === 'all') { markTask(t); return t }
  const me = _me()
  if (t.doneAt) return _patch(id, { doneAt: null, doneBy: null, doneById: null, ...R.undoKeep(t, me) })
  // その日のうちに取り消した本人が付け直したら、元の完了時刻に戻す
  return _patch(id, { doneAt: R.redoDoneAt(t, me, _now(), localDateKey(), _dayLocal), doneBy: deviceName.value || '', doneById: me.id, prevDoneAt: null, prevDoneById: null })
}

/** 「全員」のやることで、自分が印を付けたか */
export function isMarkedByMe(t) { return !!t?.doneList?.some(x => isMeId(x.id)) }

/** 「全員」の印を付ける・外す。まず画面に出し、サーバーの結果（完了したか）で揃える。届かなければ戻す */
async function markTask(t) {
  const before = [...(t.doneList || [])]
  const done = !isMarkedByMe(t)
  const me = actorId()
  t.doneList = done ? [...before.filter(x => !isMeId(x.id)), { id: me, name: deviceName.value || '', at: _now() }] : before.filter(x => !isMeId(x.id))
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
  if (!t || !canEditTask(t)) return null
  const fields = {}
  if (text !== undefined) {
    const body = String(text ?? '').trim().slice(0, TASK_TEXT_MAX)
    if (!body) return null
    fields.text = body
  }
  if (date !== undefined) {
    if (!_dateOk(date)) return null
    fields.date = date
    if (date === '') fields.dueTime = null   // いつかに時刻は持たせない
  }
  if (dueTime !== undefined && fields.date !== '') fields.dueTime = _time(dueTime)
  return _patch(id, fields)
}

/** 担当を変える（作る権限のある人。段 2-4） */
export function setTaskAssign(id, assign) {
  const t = _data.list.find(x => x.id === id)
  return t && canEditTask(t) ? _patch(id, _assignFields(assign)) : null
}
export function removeTask(id) {
  const t = _data.list.find(x => x.id === id)
  return t && canRemoveTask(t) ? _patch(id, { deletedAt: _now() }) : null
}

/** サーバーの一覧を取り込む（同じ1件は updatedAt の新しい方） */
export function applyRemoteTasks(remote) {
  if (!Array.isArray(remote)) return
  const byId = new Map(_data.list.map(t => [t.id, t]))
  let changed = false
  for (const r of remote) {
    if (!r?.id || typeof r.date !== 'string') continue
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
  if (Array.isArray(list)) {
    applyRemoteTasks(list)
    // サーバーに無い「いつか」は送り直す。いつかに対応する前の Worker は日付なしを 400 で断り、
    // 断られた保存は捨てられるので、端末にだけ残ったままになる（2026-10-13）
    const onServer = new Set(list.map(r => r?.id))
    for (const t of _data.list) if (t.date === '' && !onServer.has(t.id)) _send({ ...t })
  }
  return Array.isArray(list)
}

/** 他の端末が追加して、この端末ではまだ確認していないもの（追加した順） */
export const newTasks = computed(() => {
  const seen = _seenAt.value
  if (!seen) return []
  return _data.list
    .filter(t => _alive(t) && !isMeId(t.createdById) && (t.createdAt || '') > seen)
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
  return _data.list.filter(t => t.date && t.date <= today && _alive(t) && !t.doneAt).length   // 期限切れも含める
})

export function isMyTask(t) { return !!t && isMeId(t.createdById) }
/** 自分が担当のやること（特定の人で自分） */
export function isAssignedToMe(t) { return t?.assign === 'person' && isMeId(t.assigneeId) }

// テスト用：保存先から読み直す
export function _reloadTasks() { _load() }
