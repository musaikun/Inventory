import { reactive, computed, watch } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

// 未記録の入出庫入力（ドラフト）。ページを離れても端末に保持し、ホームカードでも
// 「未記録の入力あり」を出せるよう共有する。
// 形: { in: { item: qty }, out: { item: qty }, date, note, orderId, orderLabel }
const _draft = reactive({ in: {}, out: {}, date: '', note: '', orderId: null, orderLabel: '' })

function _today() { return new Date().toISOString().slice(0, 10) }

function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.movementDraft)
    if (raw) {
      const p = JSON.parse(raw)
      _draft.in    = (p && typeof p.in === 'object' && p.in) || {}
      _draft.out   = (p && typeof p.out === 'object' && p.out) || {}
      _draft.date  = p?.date || ''
      _draft.note  = p?.note || ''
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

// アカウント切替時のローカル全消去（未記録の入出庫ドラフト）。
export function resetLocalData() {
  _draft.in = {}
  _draft.out = {}
  _draft.note = ''
  _draft.orderId = null
  _draft.orderLabel = ''
  _draft.date = _today()
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
  // 保存後にそのモードの入力を消す（他モードのドラフトは残す）
  function clearMode(mode) {
    _draft[mode === 'out' ? 'out' : 'in'] = {}
    _draft.orderId = null
    _draft.orderLabel = ''
    _draft.note = ''
  }
  return { draft: _draft, draftCount: _count, hasDraft: _hasDraft, clearMode }
}
