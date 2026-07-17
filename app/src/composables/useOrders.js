import { reactive } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'
import { postOrderStock } from '../services/orderLearning.js'
import { effectiveLot } from '../services/lot.js'

// 発注レコード（フロー）。棚卸スナップショット（残高）とは別倉庫。
// 1レコード = { id, date, supplier, axis, sessionId, savedAt, lines:[{ item, qty, unit, stock, lot, postStock, excluded }] }
// stock=発注時の現在在庫 / lot=入数(数値) / postStock=発注後在庫（学習対象）/ excluded=学習除外。
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

// アカウント切替時のローカル全消去（発注レコード）。
export function resetLocalData() {
  _data.list = []
  try { localStorage.removeItem(STORAGE_KEYS.orders) } catch (_) {}
}

function _today() { return new Date().toISOString().slice(0, 10) }
function _uid() { return 'o_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) }

function _cleanLines(lines) {
  return (lines || [])
    .map(l => {
      const qty   = Number(l.qty)
      const stock = (l.stock == null || l.stock === '') ? null : Number(l.stock)
      const lot   = effectiveLot(l.lot)
      return {
        item:      l.item,
        qty,
        unit:      l.unit || '',
        stock:     Number.isFinite(stock) ? stock : null,
        lot,
        postStock: stock == null ? null : postOrderStock(stock, qty, lot),
        excluded:  !!l.excluded,
      }
    })
    .filter(l => l.item && Number.isFinite(l.qty) && l.qty > 0)
}

export function useOrders() {
  /**
   * 発注を記録する。qty>0 の行だけ保存。
   * @param {object} opts { supplier, axis, date, sessionId, lines:[{item,qty,unit,stock,lot}] }
   * @returns {object|null} 保存したレコード（有効行が無ければ null）
   */
  function saveOrder({ supplier = '', axis = '', date = null, sessionId = null, lines = [] } = {}) {
    const cleanLines = _cleanLines(lines)
    if (cleanLines.length === 0) return null
    const rec = {
      id:        _uid(),
      date:      date || _today(),
      supplier:  supplier || '',
      axis:      axis || '',
      sessionId: sessionId || null,
      savedAt:   new Date().toISOString(),
      lines:     cleanLines,
    }
    _data.list.push(rec)
    _persist()
    return rec
  }

  /**
   * 指定 id の発注レコードを差し替え（無ければ追加）。進行中発注をセッション単位で
   * 1 レコードに集約する用途。有効行が 0 になったら削除する。
   */
  function upsertOrder({ id, supplier = '', axis = '', date = null, sessionId = null, lines = [] } = {}) {
    if (!id) return null
    const cleanLines = _cleanLines(lines)
    const i = _data.list.findIndex(o => o.id === id)
    if (cleanLines.length === 0) {
      if (i >= 0) { _data.list.splice(i, 1); _persist() }
      return null
    }
    const rec = {
      id,
      date:      date || _today(),
      supplier:  supplier || '',
      axis:      axis || '',
      sessionId: sessionId || null,
      savedAt:   new Date().toISOString(),
      lines:     cleanLines,
    }
    if (i >= 0) _data.list.splice(i, 1, rec)
    else        _data.list.push(rec)
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

  /**
   * 学習イベント配列 [{ item, date, postStock, excluded }] を返す。
   * orderLearning.parLevel にそのまま渡せる。postStock が無い行（在庫未入力）は除く。
   */
  function getLearningEvents() {
    const events = []
    for (const o of _data.list) {
      for (const l of (o.lines || [])) {
        if (l.postStock == null || !Number.isFinite(Number(l.postStock))) continue
        events.push({ item: l.item, date: o.date, postStock: Number(l.postStock), excluded: !!l.excluded })
      }
    }
    return events
  }

  return { saveOrder, upsertOrder, getOrders, getOrdersByMonth, deleteOrder, getLastOrderQty, applyRemoteOrders, getLearningEvents }
}
