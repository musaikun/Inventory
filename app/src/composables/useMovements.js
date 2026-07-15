import { reactive } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'
import { effectiveLot } from '../services/lot.js'

// 入出庫レコード（フロー）。発注(useOrders)と同型の別倉庫。
// 1レコード = { id, date, type: 'in'|'out', note, savedAt, orderId, lines:[{ item, qty, unit }] }
// orderId = 発注からの納品取込で作られた入庫の場合、その発注レコードの id。
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

// アカウント切替時のローカル全消去（入出庫レコード）。
export function resetLocalData() {
  _data.list = []
  try { localStorage.removeItem(STORAGE_KEYS.movements) } catch (_) {}
}

function _today() { return new Date().toISOString().slice(0, 10) }
function _uid() { return 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) }

function _cleanLines(lines) {
  return (lines || [])
    .map(l => ({ item: l.item, qty: Number(l.qty), unit: l.unit || '' }))
    .filter(l => l.item && Number.isFinite(l.qty) && l.qty > 0)
}

// 発注レコード → 入庫行への換算。発注の qty は LOT 数（発注回数）なので、
// 納品数量 = qty × 入数 に直す。
export function deliveryLinesFromOrder(order) {
  return (order?.lines || [])
    .map(l => ({ item: l.item, qty: Number(l.qty) * effectiveLot(l.lot), unit: l.unit || '' }))
    .filter(l => l.item && Number.isFinite(l.qty) && l.qty > 0)
}

export function useMovements() {
  /**
   * 入出庫を記録する。qty>0 の行だけ保存。
   * @param {object} opts { type: 'in'|'out', date, note, lines:[{item,qty,unit}] }
   * @returns {object|null} 保存したレコード（有効行が無ければ null）
   */
  function saveMovement({ type = 'in', date = null, note = '', orderId = null, lines = [] } = {}) {
    const cleanLines = _cleanLines(lines)
    if (cleanLines.length === 0) return null
    const rec = {
      id:      _uid(),
      date:    date || _today(),
      type:    type === 'out' ? 'out' : 'in',
      note:    (note || '').trim(),
      orderId: type !== 'out' && orderId ? orderId : null,
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
