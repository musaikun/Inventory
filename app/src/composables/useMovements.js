import { localDateKey } from '../utils/localDate.js'
import { reactive, ref, toRaw } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'
import { effectiveLot } from '../services/lot.js'

// 入出庫レコード（フロー）。発注(useOrders)と同型の別倉庫。
// 1レコード = { id, date, type: 'in'|'out', note, savedAt, orderId, source, importBatchId, lines:[{ item, qty, unit }] }
// orderId       = 発注からの納品取込で作られた入庫の場合、その発注レコードの id。
// source        = 'import' なら過去履歴の一括取込由来（手入力と区別）。既定 null。
// importBatchId = 取込単位のID（一括取消・再取込の追跡）。既定 null。
const _data = reactive({ list: [] })
// 読み出しは素のデータ（toRaw）で返し、変更の検知は _rev（版数）で行う。
// 分析・仕入れの計算は全品目×全記録を読むので、リアクティブの Proxy 越しだと約20倍遅い
// （品目357×棚卸40回で 仕入れの発注基準 2〜5秒 → 0.1〜0.2秒）。
// 書き換えは必ず _persist（またはリセット）を通るので、そこで _rev を進める。
const _rev = ref(0)

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
  _rev.value++
  try { localStorage.setItem(STORAGE_KEYS.movements, JSON.stringify(_data.list)) } catch (_) {}
}

_load()

// アカウント切替時のローカル全消去（入出庫レコード）。
export function resetLocalData() {
  _data.list = []
  _rev.value++
  try { localStorage.removeItem(STORAGE_KEYS.movements) } catch (_) {}
}

function _today() { return localDateKey() }   // UTC だと日本時間の朝9時まで前日になる
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

// 入庫として未反映の発注を返す（純関数）。直近 sinceDays 日の発注のうち、その発注ID
// (orderId) を持つ入庫がまだ記録されていないもの。日付の新しい順。
// ホームカードのバッジと入庫タブの「反映しますか？」プロンプトで共用する。
export function unreflectedOrders(orders = [], movements = [], sinceDays = 30) {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString().slice(0, 10)
  const reflected = new Set((movements || []).map(m => m?.orderId).filter(Boolean))
  return (orders || [])
    .filter(o => o && o.id && (o.date || '') >= since && !reflected.has(o.id))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
}

export const MOVEMENT_RESTORE_WINDOW_MS = 24 * 60 * 60 * 1000   // 取り消しを元に戻せる期間（Worker と同じ）

/** 取り消した入出庫を、まだ元に戻せるか */
export function canRestoreMovement(m, now = Date.now()) {
  const at = Date.parse(m?.deletedAt || '')
  return Number.isFinite(at) && now - at <= MOVEMENT_RESTORE_WINDOW_MS
}

export function useMovements() {
  /**
   * 入出庫を記録する。qty>0 の行だけ保存。
   * @param {object} opts { type: 'in'|'out', date, note, lines:[{item,qty,unit}] }
   * @returns {object|null} 保存したレコード（有効行が無ければ null）
   */
  function saveMovement({ type = 'in', date = null, note = '', orderId = null, source = null, importBatchId = null, by = '', byId = '', lines = [] } = {}) {
    const cleanLines = _cleanLines(lines)
    if (cleanLines.length === 0) return null
    const rec = {
      id:      _uid(),
      date:    date || _today(),
      type:    type === 'out' ? 'out' : 'in',
      note:    (note || '').trim(),
      orderId: type !== 'out' && orderId ? orderId : null,
      source:  source || null,
      importBatchId: importBatchId || null,
      by:      (by || '').trim() || null,   // 登録した人（スタッフは本人の名前・オーナーは端末名。品目シートの明細に出す）
      byId:    byId || null,
      savedAt: new Date().toISOString(),
      lines:   cleanLines,
    }
    _data.list.push(rec)
    _persist()
    return rec
  }

  const _byNewest = (a, b) =>
    (b.date || '').localeCompare(a.date || '') || (b.savedAt || '').localeCompare(a.savedAt || '')

  /**
   * 有効な入出庫を新しい順（date desc, savedAt desc）で返す。
   * 取り消した入出庫（deletedAt）は含めない＝理論在庫・カレンダーの★・分析には数えない。
   */
  function getMovements() {
    void _rev.value
    return toRaw(_data.list).filter(m => !m.deletedAt).sort(_byNewest)
  }

  /** 取り消した入出庫も含めて返す（品目シートの日の明細で「取り消し済み」を見せる） */
  function getAllMovements() {
    void _rev.value
    return [...toRaw(_data.list)].sort(_byNewest)
  }

  /**
   * 入出庫を取り消す。記録は消さずに印を付ける（User決定 2026-10-03・migration 0019）。
   * 返したレコードを saveMovementToD1 へ渡すとサーバーにも印が付く。
   */
  function voidMovement(id) {
    const m = _data.list.find(x => x.id === id)
    if (!m || m.deletedAt) return null
    m.deletedAt = new Date().toISOString()
    m.syncPending = true
    _persist()
    return toRaw(m)
  }

  /** 取り消しを元に戻す（取り消してから24時間以内）。戻せなければ null */
  function restoreMovement(id, now = Date.now()) {
    const m = _data.list.find(x => x.id === id)
    if (!m || !m.deletedAt || !canRestoreMovement(m, now)) return null
    m.deletedAt = null
    m.syncPending = true
    _persist()
    return toRaw(m)
  }

  /** サーバーに届いた（取り消し・元に戻すの送信が済んだ） */
  function markMovementSynced(id) {
    const m = _data.list.find(x => x.id === id)
    if (m && m.syncPending) { delete m.syncPending; _persist() }
  }

  /** 入出庫を削除 */
  function deleteMovement(id) {
    const i = _data.list.findIndex(m => m.id === id)
    if (i >= 0) { _data.list.splice(i, 1); _persist() }
  }

  /** 取込バッチをまとめて削除（一括取消）。削除したレコードidの配列を返す（D1削除に対応）。*/
  function deleteImportBatch(importBatchId) {
    if (!importBatchId) return []
    const removed = _data.list.filter(m => m.importBatchId === importBatchId).map(m => m.id)
    if (removed.length) {
      _data.list = _data.list.filter(m => m.importBatchId !== importBatchId)
      _persist()
    }
    return removed
  }

  /**
   * D1 等から取得した入出庫配列をローカルへ反映（id で重複排除）。
   * 既にある記録は、取り消しの印と登録した人だけサーバーに合わせる（別の端末での取り消しを反映）。
   * この端末の取り消し・元に戻すがまだ届いていない記録（syncPending）は端末側を保つ。
   */
  function applyRemoteMovements(movements) {
    if (!Array.isArray(movements)) return
    const byId = new Map(_data.list.map(m => [m.id, m]))
    for (const m of movements) {
      if (!m?.id) continue
      const cur = byId.get(m.id)
      if (!cur) { _data.list.push(m); byId.set(m.id, m); continue }
      if (!cur.syncPending && 'deletedAt' in m) cur.deletedAt = m.deletedAt ?? null
      // 登録した人はサーバーが正（スタッフは本人の名前で刻まれ、削除すると「（削除済み）」が付く）
      if (m.by && !cur.syncPending) { cur.by = m.by; if (m.byId) cur.byId = m.byId }
    }
    _persist()
  }

  return {
    saveMovement, getMovements, getAllMovements, deleteMovement, deleteImportBatch, applyRemoteMovements,
    voidMovement, restoreMovement, markMovementSynced,
  }
}
