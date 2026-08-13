import { ref, watch } from 'vue'
import { isAuthenticated, updateSession, completeSession as completeSessionApi } from './useAuth.js'
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

/**
 * 実行中の完了要求（sessionId 単位で1本）。
 *
 * 完了は3か所から起こる — 完了ボタン、完了済みセッションでホームへ戻る、
 * ホストからの session_ended 受信。これらが重なると同じセッションへ完了APIが
 * 複数本走り、片方の失敗でもう片方の成功が上書きされたり、後片付けが二重に走る。
 * 同じセッションへの2つ目以降は**実行中の1本に合流させる**。
 */
let _completing = null    // { id, promise }
export const isCompleting = ref(false)

// リロード復帰用に localStorage へ永続化（ID の変化＝再代入時のみ）
watch(pendingSession, (s) => {
  if (s?.id) localStorage.setItem(STORAGE_KEYS.pendingSession, JSON.stringify(s))
  else       localStorage.removeItem(STORAGE_KEYS.pendingSession)
})

function _canWrite() {
  return isAuthenticated.value && !!pendingSession.value?.id
}

// アカウント切替時のローカル全消去（進行中セッション）。watch が localStorage も消す。
export function resetLocalData() {
  _cancelTouch()
  _finalized = false
  _completing = null
  isCompleting.value = false
  pendingSession.value = null
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
  /**
   * 完了確定。明細・完了状態・スナップショットはサーバー側で1トランザクションとして
   * 書かれる（DATA-001）。
   *
   * 失敗しても `updateSession(id, 'completed')` へ**フォールバックしない**。
   * かつてはそうしていたが、それは「明細の保存に失敗したのに、セッションだけ
   * 完了として残す」という DATA-001 そのものの状態を、クライアント側から作る動きだった。
   * 一覧には出るのに詳細が開けない棚卸（R-001）は、この経路でも生まれる。
   *
   * 失敗時は完了扱いにせず、`_finalized` も戻して再試行できる状態にする。
   * 同じ内容・同じ sessionId で再送でき、サーバー側は冪等。
   *
   * 完了ボタン・ホームへ戻る・session_ended が重なっても、同じセッションへの
   * 完了要求は1本に束ねる（実行中のものへ合流する）。
   *
   * @returns {Promise<{ ok: boolean, reason?, retryable?, result? }>}
   */
  function complete(count, payload = null) {
    const id = pendingSession.value?.id
    // 実行中の1本へ合流する。二重押し・二重経路でも完了要求は増やさない。
    if (_completing && _completing.id === id) return _completing.promise

    const promise = _complete(count, payload).finally(() => {
      if (_completing?.promise === promise) { _completing = null; isCompleting.value = false }
    })
    _completing = { id, promise }
    isCompleting.value = true
    return promise
  }

  async function _complete(count, payload) {
    _cancelTouch()
    _finalized = true
    // 未ログイン・セッション未確立。サーバーに書くものが無いので、ローカルの完了は成立する
    if (!_canWrite()) return { ok: true, reason: 'offline' }
    const id = pendingSession.value.id

    if (payload) {
      try {
        const res = await completeSessionApi(
          id, payload.inventory, payload.prices, payload.takenAt, payload.snapshot ?? null,
        )
        // スナップショットを送ったのに保存されていない = 一覧には出るが詳細が開けない
        // 状態（R-001）そのもの。完了として扱わず、明細ごと送り直せるようにする。
        if (payload.snapshot && res?.snapshotSaved !== true) {
          _finalized = false
          console.error('[useSession] complete without snapshot:', id)
          return { ok: false, reason: 'snapshot_missing', retryable: true }
        }
        if (pendingSession.value) pendingSession.value.status = 'completed'
        return { ok: true, result: res ?? null }
      } catch (err) {
        // 完了状態を付けないまま返す。次の再送で明細ごとやり直せる
        _finalized = false
        console.error('[useSession] complete failed:', id, err?.message ?? err)
        return { ok: false, reason: 'save_failed', retryable: err?.body?.retryable !== false }
      }
    }

    // payload を持たない経路（明細を伴わない完了）。ここは従来どおり状態のみ更新する
    try {
      await updateSession(id, 'completed', count)
      if (pendingSession.value) pendingSession.value.status = 'completed'
      return { ok: true }
    } catch (err) {
      _finalized = false
      console.error('[useSession] complete(status only) failed:', id, err?.message ?? err)
      return { ok: false, reason: 'save_failed', retryable: true }
    }
  }

  // 一覧へ戻る・退出時にセッション参照を破棄
  function clear() {
    _cancelTouch()
    _finalized = false
    pendingSession.value = null
  }

  return { pendingSession, isCompleting, begin, resume, restore, touch, markActive, complete, clear }
}
