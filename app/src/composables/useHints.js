// 操作の説明・おすすめを ✕ で消した記録（User決定 2026-10-03）。
// - 端末ごとに覚える（説明が要るかは人と端末で違う。店で共有しない）
// - ✕ は二度と出さない。「あとで」は数日後にまた出す
// - 各種設定からまとめて元に戻せる
import { reactive, computed } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

export const SNOOZE_DAYS = 3
const DAY_MS = 24 * 60 * 60 * 1000

function _load() {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEYS.hints) || 'null')
    return {
      hidden: Array.isArray(v?.hidden) ? v.hidden.filter(x => typeof x === 'string') : [],
      until: v?.until && typeof v.until === 'object' ? v.until : {},
    }
  } catch { return { hidden: [], until: {} } }
}

const state = reactive(_load())
function _save() {
  try { localStorage.setItem(STORAGE_KEYS.hints, JSON.stringify({ hidden: state.hidden, until: state.until })) } catch { /* 保存できなくても今の画面では消える */ }
}

/** 今出してよいか（✕ で消していない・「あとで」の期限が過ぎた） */
export function isHintShown(id, now = Date.now()) {
  if (state.hidden.includes(id)) return false
  const u = Number(state.until[id])
  return !(Number.isFinite(u) && u > now)
}
export function dismissHint(id) {
  if (!state.hidden.includes(id)) state.hidden.push(id)
  delete state.until[id]
  _save()
}
export function snoozeHint(id, days = SNOOZE_DAYS, now = Date.now()) {
  state.until[id] = now + days * DAY_MS
  _save()
}
export function restoreHints() {
  state.hidden = []
  state.until = {}
  _save()
}
/** 消した・あとでにした説明の数（各種設定の「元に戻す」に出す） */
export const hiddenHintCount = computed(() => state.hidden.length + Object.keys(state.until).length)
// テスト用：保存先から読み直す
export function _reloadHints() { Object.assign(state, _load()) }
