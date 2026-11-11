// やることのお気に入り（ひな形・User決定 2026-11-05・モック docs/mocks/task-create.html）。
//
// - 店で共有（サーバーが正・migration 0035）。端末には写しを置いて、開いたときすぐ出す
// - 足すのは「やることを作る」を持つ人。直す（名前）・外すのは作った人と管理者
// - 中身は日付を持たない（使うときに追加の画面で日付を選ぶ）
//   kind: 'task' | 'checklist' | 'routine' | 'progress' | 'someday'
//   data: { items?, dueTime?, dueTimes?, repeat?, repeatDays?, assign?, note? }
import { reactive, computed } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'
import { deviceName, actorId, isMeId } from './useDeviceId.js'
import { isAdmin, can } from './useAuth.js'
import { loadTemplatesFromD1, saveTemplateToD1 } from './useStore.js'

export const TEMPLATE_NAME_MAX = 60
export const KIND_ICON = { task: 'date', checklist: 'clipboard', routine: 'repeat', progress: 'hourglass', someday: 'inbox' }   // 線のアイコンの名前（LineIcon）
export const KIND_LABEL = { task: 'やること', checklist: 'チェック表', routine: '定期', progress: '進行中', someday: 'いつか' }

const _data = reactive({ list: [] })
function _load() {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEYS.taskTemplates) || 'null')
    _data.list = Array.isArray(v) ? v.filter(x => x?.id) : []
  } catch (_) { _data.list = [] }
}
function _persist() { try { localStorage.setItem(STORAGE_KEYS.taskTemplates, JSON.stringify(_data.list)) } catch (_) {} }
_load()

export function resetLocalData() {
  _data.list = []
  try { localStorage.removeItem(STORAGE_KEYS.taskTemplates) } catch (_) {}
}

const _uid = () => 'tp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
const _now = () => new Date().toISOString()

/** 使っているお気に入り（並び順） */
export const templates = computed(() => _data.list.filter(x => !x.deletedAt).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || (a.createdAt || '').localeCompare(b.createdAt || '')))
export const canAddTemplate = computed(() => can('task.create'))
export function canEditTemplate(t) { return !!t && (isAdmin.value || isMeId(t.createdById)) }

export async function pullTemplates() {
  const r = await loadTemplatesFromD1()
  if (!r?.ok) return false
  _data.list = Array.isArray(r.templates) ? r.templates : []
  _persist()
  return true
}

/** 同じ種類・同じ名前のお気に入りがあるか（二重に入れない） */
export function findTemplate(kind, name) {
  const n = String(name ?? '').trim()
  return templates.value.find(t => t.kind === kind && t.name === n) ?? null
}

async function _send(t, prev) {
  const i = _data.list.findIndex(x => x.id === t.id)
  if (i >= 0) _data.list.splice(i, 1, t); else _data.list.push(t)
  _persist()
  try {
    const r = await saveTemplateToD1(t)
    if (r?.template) { const j = _data.list.findIndex(x => x.id === t.id); if (j >= 0) _data.list.splice(j, 1, r.template) }
    _persist()
    return r?.template ?? t
  } catch (e) {
    const j = _data.list.findIndex(x => x.id === t.id)
    if (prev) _data.list.splice(j, 1, prev); else if (j >= 0) _data.list.splice(j, 1)
    _persist()
    throw e
  }
}

/** お気に入りに入れる。同じ種類・名前があれば中身を新しくする */
export function addTemplate(kind, name, data = {}) {
  if (!canAddTemplate.value) return Promise.reject(new Error('お気に入りを足す権限がありません'))
  const n = String(name ?? '').trim().slice(0, TEMPLATE_NAME_MAX)
  if (!n) return Promise.reject(new Error('名前を入れてください'))
  const prev = findTemplate(kind, n)
  if (prev && !canEditTemplate(prev)) return Promise.resolve(prev)   // 人が入れた同じものがある（そのまま使う）
  const last = templates.value.reduce((m, t) => Math.max(m, t.sort ?? 0), 0)
  const t = {
    ...(prev ?? {}), id: prev?.id ?? _uid(), kind, name: n, data,
    sort: prev?.sort ?? last + 1,
    createdBy: prev?.createdBy ?? (deviceName.value || ''), createdById: prev?.createdById ?? actorId(),
    createdAt: prev?.createdAt ?? _now(), updatedAt: _now(),
  }
  return _send(t, prev)
}
/** チェック表（項目の並びのひな形）を作る・直す（User決定 2026-11-07・別の入り口「チェック表」） */
export function saveChecklistTemplate(id, name, items) {
  const prev = id ? _data.list.find(x => x.id === id) : null
  if (prev && !canEditTemplate(prev)) return Promise.reject(new Error('このチェック表を直すのは、作った人と管理者だけです'))
  if (!prev && !canAddTemplate.value) return Promise.reject(new Error('チェック表を作る権限がありません'))
  const n = String(name ?? '').trim().slice(0, TEMPLATE_NAME_MAX)
  if (!n) return Promise.reject(new Error('名前を入れてください'))
  const list = (items ?? []).map(x => ({ id: /^[\w-]{1,64}$/.test(x?.id ?? '') ? x.id : 'i_' + Math.random().toString(36).slice(2, 10), text: String(x?.text ?? '').trim().slice(0, 100) })).filter(x => x.text).slice(0, 50)
  if (!list.length) return Promise.reject(new Error('項目を1つ以上入れてください'))
  if (!prev && findTemplate('checklist', n)) return Promise.reject(new Error('同じ名前のチェック表があります'))
  const last = templates.value.reduce((m, t) => Math.max(m, t.sort ?? 0), 0)
  const t = {
    ...(prev ?? {}), id: prev?.id ?? _uid(), kind: 'checklist', name: n, data: { ...(prev?.data ?? {}), items: list },
    sort: prev?.sort ?? last + 1,
    createdBy: prev?.createdBy ?? (deviceName.value || ''), createdById: prev?.createdById ?? actorId(),
    createdAt: prev?.createdAt ?? _now(), updatedAt: _now(),
  }
  return _send(t, prev)
}
/** チェック表（項目のあるひな形） */
export const checklistTemplates = computed(() => templates.value.filter(t => t.kind === 'checklist' && t.data?.items?.length))
export function renameTemplate(id, name) {
  const prev = _data.list.find(x => x.id === id)
  const n = String(name ?? '').trim().slice(0, TEMPLATE_NAME_MAX)
  if (!prev || !canEditTemplate(prev)) return Promise.reject(new Error('このお気に入りを直すのは、作った人と管理者だけです'))
  if (!n) return Promise.reject(new Error('名前を入れてください'))
  return _send({ ...prev, name: n, updatedAt: _now() }, prev)
}
export function removeTemplate(id) {
  const prev = _data.list.find(x => x.id === id)
  if (!prev || !canEditTemplate(prev)) return Promise.reject(new Error('このお気に入りを外すのは、作った人と管理者だけです'))
  return _send({ ...prev, deletedAt: _now(), updatedAt: _now() }, prev)
}
/** 1つ上・下へ（並べ替え） */
export function moveTemplate(id, dir) {
  const list = templates.value
  const i = list.findIndex(x => x.id === id), j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return Promise.resolve(null)
  const a = list[i], b = list[j]
  if (!canEditTemplate(a) || !canEditTemplate(b)) return Promise.reject(new Error('並べ替えられるのは、作った人と管理者だけです'))
  const sa = a.sort ?? i, sb = b.sort ?? j
  const sb2 = sa === sb ? sa + dir : sa
  return Promise.all([_send({ ...a, sort: sb, updatedAt: _now() }, a), _send({ ...b, sort: sb2, updatedAt: _now() }, b)])
}

/** 説明の一行（一覧に出す） */
export function templateSummary(t) {
  const d = t.data ?? {}
  const parts = []
  if (t.kind === 'checklist') parts.push(`${(d.items ?? []).length}項目`)
  if ((t.kind === 'checklist' || t.kind === 'routine') && d.repeat && d.repeat !== 'none') parts.push({ daily: '毎日', weekly: '曜日', monthly: '毎月' }[d.repeat] || '')
  if (t.kind === 'checklist' && (!d.repeat || d.repeat === 'none')) parts.push('1回')
  if (d.dueTimes?.length) parts.push(d.dueTimes.join('・'))
  if (d.dueTime) parts.push(d.dueTime)
  if (d.assign?.mode === 'person') parts.push(d.assign.name || '担当あり')
  return [KIND_LABEL[t.kind], ...parts].filter(Boolean).join(' ・ ')
}
