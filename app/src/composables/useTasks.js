// カレンダーの「やること」（店で共有するTODO・User決定 2026-10-04）。
//
// - 1件 = { id, date(YYYY-MM-DD), text, createdBy, createdById, createdAt, doneAt, doneBy, deletedAt, updatedAt }
// - 端末に置いて（localStorage）すぐ出し、サーバーへは保存の列（useStore の _save）で送る。
//   他の端末の変更は loadTasksFromD1 で取り込み、同じ1件は updatedAt の新しい方を残す
// - 消すときも行は残し deletedAt を立てる（他の端末へ「消した」を届けるため）
// - 「誰が」は今は端末名。自分の追加かどうかは端末ID（createdById）で見る（名前は重なることがある）
// - 新着: 他の端末が追加した、まだ確認していないもの。確認した時刻は端末ごとに覚える
import { reactive, ref, computed } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'
import { localDateKey } from '../utils/localDate.js'
import { deviceId, deviceName } from './useDeviceId.js'
import { loadTasksFromD1, saveTaskToD1 } from './useStore.js'
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

/** その日のやること（追加した順） */
export function tasksOn(date) {
  return _data.list.filter(t => t.date === date && _alive(t)).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
}

/** 日付 → まだ終わっていないやることの数。カレンダーの印に使う */
export const openTaskCounts = computed(() => {
  const m = new Map()
  for (const t of _data.list) if (_alive(t) && !t.doneAt) m.set(t.date, (m.get(t.date) || 0) + 1)
  return m
})
/** やることがある日（未完了があるか） */
export const openTaskDates = computed(() => new Set(openTaskCounts.value.keys()))

export function addTask(date, text) {
  const body = String(text ?? '').trim().slice(0, TASK_TEXT_MAX)
  if (!body || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const now = _now()
  const t = {
    id: _uid(), date, text: body,
    createdBy: deviceName.value || '', createdById: deviceId, createdAt: now,
    doneAt: null, doneBy: null, deletedAt: null, updatedAt: now,
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
  return _patch(id, t.doneAt ? { doneAt: null, doneBy: null } : { doneAt: _now(), doneBy: deviceName.value || '' })
}
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
    .filter(t => _alive(t) && t.createdById !== deviceId && (t.createdAt || '') > seen)
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
  return _data.list.filter(t => t.date === today && _alive(t) && !t.doneAt).length
})

export function isMyTask(t) { return t?.createdById === deviceId }

// テスト用：保存先から読み直す
export function _reloadTasks() { _load() }
