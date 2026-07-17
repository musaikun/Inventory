import { reactive, computed, watch } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

// 未記録の入出庫入力（ドラフト）。ページを離れても端末に保持し、ホームカードでも
// 「未記録の入力あり」を出せるよう共有する。
// 形: { in: { item: qty }, out: { item: qty }, date, noteIn, noteOut, orderId, orderLabel }
// メモはモード別（noteIn/noteOut）。orderId/orderLabel は入庫（発注→入庫の紐付け）専用。
const _draft = reactive({ in: {}, out: {}, date: '', noteIn: '', noteOut: '', orderId: null, orderLabel: '' })

function _today() { return new Date().toISOString().slice(0, 10) }

function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.movementDraft)
    if (raw) {
      const p = JSON.parse(raw)
      _draft.in    = (p && typeof p.in === 'object' && p.in) || {}
      _draft.out   = (p && typeof p.out === 'object' && p.out) || {}
      _draft.date  = p?.date || ''
      // 旧形式（単一 note）からの移行: 入庫メモとして引き継ぐ
      _draft.noteIn  = p?.noteIn ?? p?.note ?? ''
      _draft.noteOut = p?.noteOut ?? ''
      _draft.orderId    = p?.orderId ?? null
      _draft.orderLabel = p?.orderLabel || ''
    }
  } catch (_) {}
  if (!_draft.date) _draft.date = _today()
}

function _persist() {
  try { localStorage.setItem(STORAGE_KEYS.movementDraft, JSON.stringify(_draft)) } catch (_) {}
}

_load()
watch(_draft, _persist, { deep: true })

// 入力を空にする（入庫・出庫・メモ・発注紐付け）。日付は今日に戻す。
function _clear() {
  _draft.in = {}
  _draft.out = {}
  _draft.noteIn = ''
  _draft.noteOut = ''
  _draft.orderId = null
  _draft.orderLabel = ''
  _draft.date = _today()
}

// アカウント切替時のローカル全消去（未記録の入出庫ドラフト）。
export function resetLocalData() {
  _clear()
  try { localStorage.removeItem(STORAGE_KEYS.movementDraft) } catch (_) {}
}

// qty>0 の入力数（入庫＋出庫）。ホームカードのバッジ・保持判定に使う。
const _count = computed(() => {
  let n = 0
  for (const m of ['in', 'out']) {
    const obj = _draft[m] || {}
    for (const k in obj) if (Number(obj[k]) > 0) n++
  }
  return n
})
const _hasDraft = computed(() => _count.value > 0)

export function useMovementDraft() {
  // 保存後にそのモードの入力・メモだけ消す（他モードのドラフトは残す）。
  // 発注紐付け(orderId/orderLabel)は入庫専用なので、入庫の保存でのみクリアする。
  function clearMode(mode) {
    if (mode === 'out') {
      _draft.out = {}
      _draft.noteOut = ''
    } else {
      _draft.in = {}
      _draft.noteIn = ''
      _draft.orderId = null
      _draft.orderLabel = ''
    }
  }
  return { draft: _draft, draftCount: _count, hasDraft: _hasDraft, clearMode, discardAll: _clear }
}
