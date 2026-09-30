// 棚卸・発注セッションの一覧と、開始・再開・破棄・ルーム状態の取得。
//
// もとはホーム（SessionListPage）の中にあり、発注の開始だけは仕入れ（MovementPage）にも
// 別に書かれていた。画面の再設計（proposals.md 2026-09-30「表がホーム」）で開始の入口が
// ホーム以外（表の上の操作ボタン）へ移るため、画面から切り離して共通にする。
//
// 画面ごとに呼ぶ（呼ぶたびに独立した状態を持つ）。画面遷移（emit）は呼ぶ側の仕事で、
// ここは「何が起きたか」を返すだけにする。
import { ref, computed } from 'vue'
import { getSessions, createSession, deleteSession, logout } from './useAuth.js'
import { useConfig } from './useConfig.js'
import { useHistory } from './useHistory.js'
import { shopCode } from './useStore.js'
import { fetchRoomStatus } from './useSync.js'
import { isSessionLocked, deleteConfirmMessage } from '../services/sessionLock.js'

const _localDateKey = (d) => new Date(d).toLocaleDateString('sv-SE')   // YYYY-MM-DD（ローカル日）

export function useSessionLauncher() {
  const { itemCount } = useConfig()
  const { getSnapshotBySessionId } = useHistory()

  const sessions     = ref([])
  const loading      = ref(true)
  const error        = ref('')
  // どちらを開始処理中か（null | 'stock' | 'order'）。棚卸・発注は独立したセッションなので、
  // 「開始中…」表示も disabled も自分の種別のときだけに閉じる
  const startingKind = ref(null)
  const deletingId   = ref(null)

  /** 一覧を読む。認証切れ（401）ならログアウトして 'unauthorized' を返す（戻り先は呼ぶ側が決める） */
  async function load() {
    loading.value = true
    error.value   = ''
    try {
      const list = await getSessions()
      sessions.value = Array.isArray(list) ? list : []
      return 'ok'
    } catch (e) {
      const msg = String(e?.message ?? '')
      if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
        await logout()
        return 'unauthorized'
      }
      error.value = msg
      return 'error'
    } finally {
      loading.value = false
    }
  }

  const inProgressSessions = computed(() =>
    sessions.value
      .filter(s => s.status !== 'completed')
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
  )
  // 種類で振り分け（棚卸=stock / 発注=order）。type未設定の旧行は棚卸扱い。
  const stockInProgress = computed(() => inProgressSessions.value.filter(s => (s.type ?? 'stock') !== 'order'))
  const orderInProgress = computed(() => inProgressSessions.value.filter(s => s.type === 'order'))
  // 棚卸: 1店舗=同時に1棚卸。最新の進行中が主、残りはレガシー整理用
  const activeSession       = computed(() => stockInProgress.value[0] || null)
  const otherActiveSessions = computed(() => stockInProgress.value.slice(1))
  const activeOrderSession  = computed(() => orderInProgress.value[0] || null)
  const completedSessions   = computed(() =>
    sessions.value.filter(s => s.status === 'completed' && (s.type ?? 'stock') !== 'order')
  )

  function isLocked(session) {
    return isSessionLocked(session, {
      // 恒久ロック（新しい棚卸の完了で確定済み）。新しい方を削除しても外れない。
      snapshotLocked: !!getSnapshotBySessionId(session.id)?.locked,
      completedSessions: completedSessions.value,
    })
  }

  // 過去の棚卸の取込。endedAt は「取り込んだ時刻」なので、今日の棚卸とは数えない
  function _isImported(s) {
    return !!s?.importBatchId || getSnapshotBySessionId(s?.id)?.source === 'import'
  }

  // 棚卸を実施した時点。取込は実施日の正午として扱う（取り込んだ日を「前回」にしない）
  function stockAt(s) {
    if (_isImported(s)) {
      const d = String(s.startedAt || '').slice(0, 10) || getSnapshotBySessionId(s.id)?.date
      return d ? `${d}T12:00:00` : null
    }
    return s.endedAt ?? s.startedAt
  }

  /**
   * その日すでに終わっている棚卸（まだ編集できるもの）。
   *
   * 同じ日に2回棚卸すると、以前は**別のセッションとして2本できていた**。
   * 数え直しのつもりで始めた2回目が、1回目と並んで履歴に残り、消費の計算も
   * 「同じ日に2回棚卸した」ものとして扱われる。たいていは**続きか数え直し**なので、
   * まず続きから開けるように訊く。
   */
  const todayDone = computed(() => {
    const key = _localDateKey(Date.now())
    return completedSessions.value.find(sess => {
      if (_isImported(sess)) return false
      const at = sess.endedAt ?? sess.startedAt
      if (!at) return false
      return _localDateKey(at) === key && !isLocked(sess)
    }) ?? null
  })

  /**
   * 棚卸を始める。同じ日の2回目は作らずに { sameDay } を返す（続きから開くか、新しく始めるかは
   * 画面が訊く。以前はブラウザの confirm で、OK/キャンセルの意味が読みにくかった）。
   * 新しく始めると決めたら force: true で呼ぶ。
   * @returns {{ sameDay: object } | { session: object } | null}  null = 失敗（error に理由）
   */
  async function startStock({ force = false } = {}) {
    const done = todayDone.value
    if (done && !force) return { sameDay: done }
    startingKind.value = 'stock'
    try {
      return { session: await createSession() }
    } catch (e) {
      error.value = e?.message || '棚卸を開始できませんでした'
      return null
    } finally {
      startingKind.value = null
    }
  }

  /**
   * 発注を始める（type=order の型付きセッション。棚卸の一覧は type=stock で振り分けるため汚さない）。
   * @returns {object|null} 作ったセッション。null = 失敗（error に理由）
   */
  async function startOrder() {
    if (itemCount.value === 0) { error.value = '先に品目マスタを登録してください（取込む、または棚卸で追加）'; return null }
    startingKind.value = 'order'
    error.value = ''
    try {
      return await createSession('order')
    } catch (e) {
      error.value = e?.message || '発注を開始できませんでした'
      return null
    } finally {
      startingKind.value = null
    }
  }

  /**
   * セッションを削除。confirmed でなければブラウザの確認を出す。消したら true。
   *
   * onlyIfActive: 「中断中の破棄」として消すとき。消す直前にサーバーの最新を読み直し、
   * **もう完了していたら消さない**。画面の一覧は開いたときの状態のままなので、別の端末で
   * 完了した棚卸が、この端末では「中断中」の帯に残って見えることがある。そこから破棄すると
   * 完了済みの棚卸（履歴・記録ごと）が消えていた（User報告 2026-09-30・実データ消失）。
   */
  async function remove(session, { confirmed = false, onlyIfActive = false } = {}) {
    const locked = session.status === 'completed' && isLocked(session)
    if (!confirmed && !confirm(deleteConfirmMessage(session, locked))) return false
    deletingId.value = session.id
    try {
      if (onlyIfActive) {
        const latest = await getSessions()
        if (Array.isArray(latest)) sessions.value = latest
        const now = Array.isArray(latest) ? latest.find(s => s.id === session.id) : null
        if (!now || now.status === 'completed') {
          error.value = now
            ? 'この棚卸は別の端末ですでに完了しています。消さずに残しました（履歴で見られます）。'
            : 'このセッションはもうありません。'
          return false
        }
      }
      await deleteSession(session.id)
      sessions.value = sessions.value.filter(s => s.id !== session.id)
      return true
    } catch (e) {
      error.value = e?.message || '削除できませんでした'
      return false
    } finally {
      deletingId.value = null
    }
  }

  // ── ルームの状態（進行中の棚卸・発注に誰が繋がっているか）───────────
  const liveRoom      = ref(null)   // 棚卸ルーム /status
  const liveOrderRoom = ref(null)   // 発注ルーム /status（type=order）
  const now           = ref(Date.now())
  let _timer = null

  async function pollRooms() {
    now.value = Date.now()
    if (!shopCode.value) { liveRoom.value = null; liveOrderRoom.value = null; return }
    liveRoom.value = await fetchRoomStatus(shopCode.value, 'stock')
    liveOrderRoom.value = activeOrderSession.value ? await fetchRoomStatus(shopCode.value, 'order') : null
  }
  function startRoomPolling(ms = 5000) {
    stopRoomPolling()
    pollRooms()
    _timer = setInterval(pollRooms, ms)
  }
  function stopRoomPolling() {
    if (_timer) clearInterval(_timer)
    _timer = null
  }

  // 指定セッションに対応するライブルーム状態に正規化（別セッションのルームは無視）
  function _normStatus(r, session) {
    if (!r || !session) return null
    if (r.sessionId && r.sessionId !== session.id) return null
    return {
      ...r,
      participants: Array.isArray(r.participants) ? r.participants : [],
      clientCount:  typeof r.clientCount === 'number' ? r.clientCount : 0,
      roomExists:   r.roomExists ?? r.isActive ?? false,
      totalItems:   typeof r.totalItems === 'number' ? r.totalItems : null,
    }
  }
  const liveStatus      = computed(() => _normStatus(liveRoom.value, activeSession.value))
  const orderLiveStatus = computed(() => _normStatus(liveOrderRoom.value, activeOrderSession.value))

  return {
    sessions, loading, error, startingKind, deletingId,
    load, inProgressSessions, stockInProgress, orderInProgress,
    activeSession, otherActiveSessions, activeOrderSession, completedSessions,
    isLocked, stockAt, todayDone, startStock, startOrder, remove,
    now, liveRoom, liveOrderRoom, pollRooms, startRoomPolling, stopRoomPolling, liveStatus, orderLiveStatus,
  }
}
