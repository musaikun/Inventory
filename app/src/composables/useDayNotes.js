import { reactive } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

// 日別メモ。端末保存（localStorage）。形: { 'YYYY-MM-DD': { text, tags:[] } }
// 以前の「学習から除外（excluded）」はやめた（User決定 2026-11-11・D-041）。古い値は読んでも使わない
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
  function hasNote(date)   { const n = _data.notes[date]; return !!(n && (n.text || (n.tags && n.tags.length))) }
  function noteDates()     { return Object.keys(_data.notes).filter(hasNote) }

  function setNote(date, { text = '', tags = [] } = {}) {
    if (!date) return
    const t  = String(text || '').trim().slice(0, 500)
    const tg = Array.isArray(tags) ? [...new Set(tags.filter(Boolean))] : []
    if (!t && tg.length === 0) delete _data.notes[date]
    else _data.notes[date] = { text: t, tags: tg }
    _persist()
  }

  return { getNote, hasNote, setNote, noteDates }
}
