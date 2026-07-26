import { reactive } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

// 日別メモ（内部イベント要因の記録＋学習除外フラグ）。端末保存（localStorage）。
// 形: { 'YYYY-MM-DD': { text, tags:[], excluded } }
//   excluded=true の日は par 学習から除外（貸切・イベント等の異常日が推奨を歪めないため）。
const KEY = STORAGE_KEYS.dayNotes
const _data = reactive({ notes: {} })

function _load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) { const p = JSON.parse(raw); if (p && typeof p === 'object') _data.notes = p }
  } catch (_) {}
}
function _persist() {
  try { localStorage.setItem(KEY, JSON.stringify(_data.notes)) } catch (_) {}
}
_load()

// アカウント切替時のローカル全消去
export function resetLocalData() {
  _data.notes = {}
  try { localStorage.removeItem(KEY) } catch (_) {}
}

export function useDayNotes() {
  function getNote(date)   { return _data.notes[date] || null }
  function hasNote(date)   { const n = _data.notes[date]; return !!(n && (n.text || (n.tags && n.tags.length) || n.excluded)) }
  function isExcluded(date) { return !!_data.notes[date]?.excluded }

  function setNote(date, { text = '', tags = [], excluded = false } = {}) {
    if (!date) return
    const t  = String(text || '').trim().slice(0, 500)
    const tg = Array.isArray(tags) ? [...new Set(tags.filter(Boolean))] : []
    if (!t && tg.length === 0 && !excluded) delete _data.notes[date]
    else _data.notes[date] = { text: t, tags: tg, excluded: !!excluded }
    _persist()
  }

  return { getNote, hasNote, isExcluded, setNote }
}
