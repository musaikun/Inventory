import { ref, watch } from 'vue'
import { isAuthenticated, updateSession } from './useAuth.js'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

// ── セッションライフサイクル集約（モジュールスコープ シングルトン）─────────────
// D1 sessions テーブルの状態（active / incomplete / completed）への書き込みを
// この1ファイルに集約し、直列化することで「active が completed を上書きする」
// 類の競合を構造的に排除する。
//
// 不変条件:
//   - pendingSession = 現在の D1 セッション { id, shopCode, startedAt, status, itemCount }
//   - touch() は active の保存（デバウンス）。確定後（_finalized）は無視される
//   - markActive() は active の即時保存（保留 touch をキャンセル）
//   - complete() は完了確定。保留中の touch を必ずキャンセルする
//   - begin()/resume()/markActive()/clear() で _finalized をリセット

const pendingSession = ref(null)
let _touchTimer = null
let _finalized  = false   // 確定状態(completed/incomplete)を書いたら true → touch を無視

// リロード復帰用に localStorage へ永続化（ID の変化＝再代入時のみ）
watch(pendingSession, (s) => {
  if (s?.id) localStorage.setItem(STORAGE_KEYS.pendingSession, JSON.stringify(s))
  else       localStorage.removeItem(STORAGE_KEYS.pendingSession)
})

function _canWrite() {
  return isAuthenticated.value && !!pendingSession.value?.id
}

function _cancelTouch() {
  clearTimeout(_touchTimer)
  _touchTimer = null
}

export function useSession() {
  // 新規セッション開始（SessionListPage で createSession 済みのオブジェクトを受け取る）
  function begin(session) {
    _cancelTouch()
    _finalized = false
    pendingSession.value = session
  }

  // 中断セッションの再開
  function resume(session) {
    _cancelTouch()
    _finalized = false
    pendingSession.value = session
  }

  // リロード後に localStorage から復帰
  function restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.pendingSession)
      if (raw) pendingSession.value = JSON.parse(raw)
    } catch (_) {}
    return pendingSession.value
  }

  // 入力中の品目数を active として保存（デバウンス・確定後は無視）
  function touch(count) {
    if (!_canWrite() || _finalized) return
    _cancelTouch()
    _touchTimer = setTimeout(() => {
      if (!_canWrite() || _finalized) return
      updateSession(pendingSession.value.id, 'active', count).catch(() => {})
      if (pendingSession.value) pendingSession.value.itemCount = count
    }, 2000)
  }

  // active を即時保存（一覧へ戻る前のフラッシュ・中断再開時など）。保留 touch はキャンセル
  async function markActive(count) {
    _cancelTouch()
    _finalized = false
    if (!_canWrite()) return
    await updateSession(pendingSession.value.id, 'active', count).catch(() => {})
    if (pendingSession.value) pendingSession.value.status = 'active'
  }

  // 完了確定（保留 touch をキャンセルし、以降の active 書き込みを封じる）
  async function complete(count) {
    _cancelTouch()
    _finalized = true
    if (!_canWrite()) return
    await updateSession(pendingSession.value.id, 'completed', count).catch(() => {})
    if (pendingSession.value) pendingSession.value.status = 'completed'
  }

  // 一覧へ戻る・退出時にセッション参照を破棄
  function clear() {
    _cancelTouch()
    _finalized = false
    pendingSession.value = null
  }

  return { pendingSession, begin, resume, restore, touch, markActive, complete, clear }
}
