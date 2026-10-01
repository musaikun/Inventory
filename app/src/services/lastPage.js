import { STORAGE_KEYS } from '../utils/storageKeys.js'

/**
 * リロードしても同じページに留まるための「最後に見ていたページ」。
 *
 * 対象は独立ページ（入出庫）だけ。履歴・レポート・管理（データ管理）はホームのタブ（タブはホーム側が覚える）。
 * セッション画面は pendingSession からの復元が正なので、ここでは扱わない
 * （両方が行き先を決めると、進行中セッションより古いページが勝つことがある）。
 *
 * 入出庫はタブ（入庫・出庫）まで含めて1つのページ状態として持つ。
 */
export const RESTORABLE_PAGES = ['movement']
const MOVEMENT_TABS = ['in', 'out']

export function saveLastPage(view, tab = null) {
  try {
    if (!RESTORABLE_PAGES.includes(view)) { clearLastPage(); return }
    const payload = { view }
    if (view === 'movement' && MOVEMENT_TABS.includes(tab)) payload.tab = tab
    localStorage.setItem(STORAGE_KEYS.lastPage, JSON.stringify(payload))
  } catch (_) {}
}

// { view, tab } | null。壊れた値・対象外のページは null（＝通常どおりホームへ）
export function readLastPage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.lastPage)
    if (!raw) return null
    const saved = JSON.parse(raw)
    if (!RESTORABLE_PAGES.includes(saved?.view)) return null
    const tab = saved.view === 'movement' && MOVEMENT_TABS.includes(saved.tab) ? saved.tab : 'in'
    return { view: saved.view, tab }
  } catch (_) {
    return null
  }
}

export function clearLastPage() {
  try { localStorage.removeItem(STORAGE_KEYS.lastPage) } catch (_) {}
}
