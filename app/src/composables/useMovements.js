import { reactive } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

// 入出庫レコード（フロー）。発注(useOrders)と同型の別倉庫。
// 1レコード = { id, date, type: 'in'|'out', note, savedAt, lines:[{ item, qty, unit }] }
const _data = reactive({ list: [] })

function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.movements)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) _data.list = parsed
    }
  } catch (_) {}
}

function _persist() {
  try { localStorage.setItem(STORAGE_KEYS.movements, JSON.stringify(_data.list)) } catch (_) {}
}

_load()

function _today() { return new Date().toISOString().slice(0, 10) }
function _uid() { return 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) }

function _cleanLines(lines) {
  return (lines || [])
    .map(l => ({ item: l.item, qty: Number(l.qty), unit: l.unit || '' }))
    .filter(l => l.item && Number.isFinite(l.qty) && l.qty > 0)
}

export function useMovements() {
  /**
   * 入出庫を記録する。qty>0 の行だけ保存。
   * @param {object} opts { type: 'in'|'out', date, note, lines:[{item,qty,unit}] }
   * @returns {object|null} 保存したレコード（有効行が無ければ null）
   */
  function saveMovement({ type = 'in', date = null, note = '', lines = [] } = {}) {
    const cleanLines = _cleanLines(lines)
    if (cleanLines.length === 0) return null
    const rec = {
      id:      _uid(),
      date:    date || _today(),
      type:    type === 'out' ? 'out' : 'in',
      note:    (note || '').trim(),
      savedAt: new Date().toISOString(),
      lines:   cleanLines,
    }
    _data.list.push(rec)
    _persist()
    return rec
  }

  /** 全入出庫を新しい順（date desc, savedAt desc）で返す */
  function getMovements() {
    return [..._data.list].sort((a, b) =>
      (b.date || '').localeCompare(a.date || '') || (b.savedAt || '').localeCompare(a.savedAt || '')
    )
  }

  /** 入出庫を削除 */
  function deleteMovement(id) {
    const i = _data.list.findIndex(m => m.id === id)
    if (i >= 0) { _data.list.splice(i, 1); _persist() }
  }

  return { saveMovement, getMovements, deleteMovement }
}
