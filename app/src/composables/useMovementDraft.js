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
  // R2-01: 未記録の入力が無ければ既定日付は常に今日（前回操作日の残留＝分析汚染を防ぐ）。
  //         入力途中（ドラフトあり）のときだけ、ユーザーが選んだ日付を保持する。
  if (!_draft.date || _isEmpty()) _draft.date = _today()
}

// 入庫・出庫に qty>0 の入力が1つも無いか
function _isEmpty() {
  for (const m of ['in', 'out']) {
    const obj = _draft[m] || {}
    for (const k in obj) if (Number(obj[k]) > 0) return false
  }
  return true
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
    // R2-01: 入力が全て無くなったら既定日付を今日へ戻す（前回操作日の残留＝分析汚染を防ぐ）
    if (_isEmpty()) _draft.date = _today()
  }
  return { draft: _draft, draftCount: _count, hasDraft: _hasDraft, clearMode, discardAll: _clear }
}
