import { reactive } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

// 発注レコード（フロー）。棚卸スナップショット（残高）とは別倉庫。
// 1レコード = { id, date(YYYY-MM-DD), supplier, axis, savedAt, lines:[{ item, qty, unit }] }
// supplier/axis は「仕入先」や「場所」など、グルーピングに使った軸の値と名前。
const _data = reactive({ list: [] })

function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.orders)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) _data.list = parsed
      else if (Array.isArray(parsed?.list)) _data.list = parsed.list
    }
  } catch (_) {}
}

function _persist() {
  try { localStorage.setItem(STORAGE_KEYS.orders, JSON.stringify(_data.list)) } catch (_) {}
}

_load()

function _today() { return new Date().toISOString().slice(0, 10) }
function _uid() { return 'o_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) }

export function useOrders() {
  /**
   * 発注を記録する。qty>0 の行だけ保存。
   * @param {object} opts { supplier, axis, date, lines:[{item,qty,unit}] }
   * @returns {object|null} 保存したレコード（有効行が無ければ null）
   */
  function saveOrder({ supplier = '', axis = '', date = null, lines = [] } = {}) {
    const cleanLines = (lines || [])
      .map(l => ({ item: l.item, qty: Number(l.qty), unit: l.unit || '' }))
      .filter(l => l.item && Number.isFinite(l.qty) && l.qty > 0)
    if (cleanLines.length === 0) return null
    const rec = {
      id:       _uid(),
      date:     date || _today(),
      supplier: supplier || '',
      axis:     axis || '',
      savedAt:  new Date().toISOString(),
      lines:    cleanLines,
    }
    _data.list.push(rec)
    _persist()
    return rec
  }

  /** 全発注を新しい順（date desc, savedAt desc）で返す */
  function getOrders() {
    return [..._data.list].sort((a, b) =>
      (b.date || '').localeCompare(a.date || '') || (b.savedAt || '').localeCompare(a.savedAt || '')
    )
  }

  /** 指定月（YYYY-MM）の発注 */
  function getOrdersByMonth(monthKey) {
    return getOrders().filter(o => (o.date || '').slice(0, 7) === monthKey)
  }

  /** 発注を削除 */
  function deleteOrder(id) {
    const i = _data.list.findIndex(o => o.id === id)
    if (i >= 0) { _data.list.splice(i, 1); _persist() }
  }

  /**
   * 指定 supplier の最新発注から「品目→数量」を返す（次回発注の目安用）。
   * supplier 未指定なら全発注を横断して品目ごとの直近数量。
   */
  function getLastOrderQty(supplier = null) {
    const orders = getOrders()  // 新しい順
    const map = {}
    for (const o of orders) {
      if (supplier != null && o.supplier !== supplier) continue
      for (const l of o.lines) {
        if (!(l.item in map)) map[l.item] = l.qty   // 新しい順なので最初に見たものが直近
      }
    }
    return map
  }

  /** D1 等から取得した発注配列をローカルへ反映（id で重複排除） */
  function applyRemoteOrders(orders) {
    if (!Array.isArray(orders)) return
    const seen = new Set(_data.list.map(o => o.id))
    for (const o of orders) {
      if (o?.id && !seen.has(o.id)) { _data.list.push(o); seen.add(o.id) }
    }
    _persist()
  }

  return { saveOrder, getOrders, getOrdersByMonth, deleteOrder, getLastOrderQty, applyRemoteOrders }
}
