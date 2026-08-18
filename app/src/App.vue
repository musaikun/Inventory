<script setup>
import { ref, computed, watch, watchEffect, nextTick, onMounted, onUnmounted } from 'vue'
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { useVoice, parseText } from './composables/useVoice.js'
import { useInventory, applyRemoteUpdate, applyRemoteRemove, applyRemoteRecountFlag, applyPersistedInventory } from './composables/useInventory.js'
import { useConfig, applyRemoteConfig, setConfigChangedCallback } from './composables/useConfig.js'
import { useHistory } from './composables/useHistory.js'
import { useActiveTimer, computeActive } from './composables/useActiveTimer.js'
import {
  useSync,
  setInventoryCallbacks, registerInventoryGetter,
  setRecountFlagCallback, registerRecountFlagsGetter,
  registerConfigGetter, setConfigCallback,
  setDoneCallback, setMessageCallback, setDissolvedCallback,
  setConflictCallback, setConflictQueueCallback, setConflictNotifyCallback,
  setNameTakenCallback, setParticipantJoinCallback, setParticipantLeaveCallback,
  setGuestLeaveCallback, setRemoteUpdateCallback, setClearInventoryCallback,
  setSessionEndedCallback, setNewSessionStartedCallback, setResetConfigCallback,
  setExpectedSessionId,
  setOrderCallbacks, setOrdersSnapshotCallback, registerOrdersGetter,
  broadcastOrderUpdate, broadcastOrderRemove,
  broadcastUpdate, broadcastRemove, broadcastDone, broadcastUndone, broadcastConfig,
  broadcastSessionEnd, broadcastSessionStart, broadcastRecountFlag,
  broadcastConflictNotify, dismissConflict, broadcastTyping, typingMap, lockedIngredients, broadcastMessage,
  markMessagesRead, addLocalAuditEntry, clearAuditLog, restoreSession,
  getSavedGuestSession, discardSavedSession,
  hasHostToken, dissolveRoomRemote,
  broadcastItemAddRequest, broadcastItemAddResponse, dismissItemAddRequest,
  setItemAddRequestCallback, setItemAddResponseCallback, pendingItemRequests,
  fetchRoomStatus, fetchRoomResult,
  captureSyncConnection, isSyncConnectionStale,
} from './composables/useSync.js'
import { deviceId, deviceName, setDeviceName } from './composables/useDeviceId.js'
import {
  shopCode,
  loadStore, saveConfigToD1, saveSnapshotToD1, deleteSnapshotFromD1,
  loadHistoryFromD1, loadConfigFromD1, updateActiveRoomInD1,
  saveInventoryToD1, loadInventoryFromD1, saveState,
  saveOrderToD1, loadOrdersFromD1,
  loadMovementsFromD1, resumePendingSaves, pendingCount, rejectedSaves,
  noteAuthInvalidated, clearAuthBlock, queuePendingSave,
} from './composables/useStore.js'
import { buildCompletionRequest, completionErrorMessage, COMPLETION_STOCK } from './services/sessionCompletion.js'
import { resumeAfterLogin } from './services/authResume.js'
import { isSnapshotComplete } from './utils/snapshotSync.js'
import { missingSnapshots } from './services/historyBackfill.js'
import { useOrders } from './composables/useOrders.js'
import { useMovements } from './composables/useMovements.js'
import { useDayNotes } from './composables/useDayNotes.js'
import { parLevel as calcParLevel, weekdayOf } from './services/orderLearning.js'
import { weekdayOrderHistory } from './services/orderItemHistory.js'
import { theoreticalStock } from './services/theoreticalStock.js'
import { effectiveLot } from './services/lot.js'
import { mergeOrderSnapshot, applyOrderLine, orderDraftToPayload } from './services/orderSync.js'
import { isAuthenticated, clearAuthLocal, setAccountResetHandler, getSessionLines } from './composables/useAuth.js'
import { buildSnapshotFromLines } from './services/snapshotFromLines.js'
import { clearLocalAccountData } from './composables/accountData.js'
import { setAuthInvalidatedHandler } from './utils/api.js'
import { useSession } from './composables/useSession.js'
import VoiceButton from './components/VoiceButton.vue'
import ConfirmModal from './components/ConfirmModal.vue'
import CandidateModal from './components/CandidateModal.vue'
import InventoryTable from './components/InventoryTable.vue'
import SettingsModal from './components/SettingsModal.vue'
import DeleteAccountModal from './components/DeleteAccountModal.vue'
import DeleteAccountPage from './components/DeleteAccountPage.vue'
import { isDeleteAccountRoute } from './utils/startupRoute.js'
import SyncModal from './components/SyncModal.vue'
import ChatModal from './components/ChatModal.vue'
import LandingPage from './components/LandingPage.vue'
import AuthPage from './components/AuthPage.vue'
import SessionListPage, { _persistedTab as sessionsTab, _showDashboard as dashboardOpen, _showOrders as ordersOpen } from './components/SessionListPage.vue'
import AppMenu from './components/AppMenu.vue'
import AxisAssignFocus from './components/AxisAssignFocus.vue'
import MasterManagePage from './components/MasterManagePage.vue'
import MovementPage from './components/MovementPage.vue'
import ConnectionBanner from './components/ConnectionBanner.vue'
import { initConnectivity, isOnline } from './composables/useConnectivity.js'
import { settingsSection, showAxisAssign, axisAssignInitial, showOrderSchedule, showDeleteAccount, consumeDeleteAccountBack } from './composables/appMenuState.js'
import SessionDetailPage from './components/SessionDetailPage.vue'
import GuestResultView from './components/GuestResultView.vue'
import { findCandidates as matcherFind, findSimilarNames } from './utils/itemMatcher.js'
import UpgradeModal from './components/UpgradeModal.vue'
import BarcodeScanner from './components/BarcodeScanner.vue'
import MemberHistoryModal from './components/MemberHistoryModal.vue'
import DesktopNav from './components/DesktopNav.vue'
import { useMediaQuery, DESKTOP_QUERY } from './composables/useMediaQuery.js'
import { track } from './utils/analytics.js'
import { canJoinRoom, FREE_DEVICE_LIMIT, canAddItem, FREE_ITEM_LIMIT, isProReviewEnvironment } from './utils/planLimits.js'
import { isTwaApp } from './utils/appMode.js'

// ── PWA 更新検知 ───────────────────────────────────────────────────────────────
const { needRefresh, updateServiceWorker } = useRegisterSW({ immediate: true })
const proReviewBuild = isProReviewEnvironment()

// ── Config（動的品目リスト）────────────────────────────────────────────────────
const { config, dictionary, masterDict, registerAlias, clearConfig, loadSampleData, setEmptyList, snapshotConfig, restoreConfigSnapshot, addItem, updateConfigItem, removeConfigItem, setItemCategory, setItemExtras, setItemTag, hideItem, unhideItem, serializeConfigData } = useConfig()

// ── Inventory ──────────────────────────────────────────────────────────────────
const {
  inventory, recountFlags, filledCount, totalValue,
  isCompleted, completedAt,
  entryLog,
  setItem, updateQty, removeItem, setRecountFlag, reset, exportCSV,
  completeSession,
} = useInventory()

// ── History ────────────────────────────────────────────────────────────────────
const { buildSnapshot, commitSnapshot, applyRemoteHistory, markSnapshotSynced, deleteSnapshotLocal, getSnapshots, getSnapshotBySessionId, lockOtherSnapshots } = useHistory()

// ── Orders（発注支援）────────────────────────────────────────────────────────────
const { upsertOrder, getOrders, getLearningEvents, applyRemoteOrders } = useOrders()
// 進行中発注の下書き（品目→行）。セッション単位で 1 発注レコードに集約して D1 へ。
const orderDraft = ref({})
function _orderId() { return pendingSession.value?.id ? `ord_${pendingSession.value.id}` : `ord_${shopCode.value || 'local'}` }
function _todayStr() { return new Date().toISOString().slice(0, 10) }

// この品目・今日の曜日の適正在庫（学習不足なら null）。
// 日別メモで「学習から除外」した異常日（貸切・イベント等）は par 学習から外す。
const { isExcluded: _isDateExcluded } = useDayNotes()
function _parLevelFor(item) {
  const events = getLearningEvents().filter(e => !_isDateExcluded(e.date))
  return calcParLevel(events, item, weekdayOf(_todayStr()))
}
// 理論在庫（直近棚卸＋入出庫の導出値）。発注時の在庫入力の参考・ズレ検出用。
const { getMovements, applyRemoteMovements } = useMovements()
function _theoStockFor(item) {
  return theoreticalStock(item, getSnapshots(), getMovements())
}
// 前週同曜日の発注数（参考表示用）。同曜日で最も新しい発注行の qty。
function _lastWeekQtyFor(item) {
  const wd = weekdayOf(_todayStr())
  let best = null
  for (const o of getOrders()) {
    if (weekdayOf(o.date) !== wd) continue
    const line = (o.lines || []).find(l => l.item === item)
    if (line && (!best || o.date > best.date)) best = { date: o.date, qty: line.qty }
  }
  return best ? best.qty : null
}
// 品目×同曜の発注履歴（前週・先月・直近中央値・推移）。当日分は除外。
function _weekdayHistoryFor(item) {
  return weekdayOrderHistory(getOrders(), item, weekdayOf(_todayStr()), { window: 6, before: _todayStr() })
}

// 直近N回の履歴で各品目が「入力された(数量!=null／0含む)」回数。よく使う品目の絞り込み・並べ替えに使う。
const USAGE_SESSIONS = 3
const itemUsageMap = computed(() => {
  const map = {}
  for (const snap of getSnapshots().slice(0, USAGE_SESSIONS)) {
    for (const it of (snap.items ?? [])) {
      if (it.qty !== null && it.qty !== undefined) map[it.item] = (map[it.item] ?? 0) + 1
    }
  }
  return map
})

// ── 稼働時間タイマー（アイドル5分で一時停止し、棚卸の実働時間のみ計測）──────────
const activeTimer = useActiveTimer()
function markActivity() { if (currentView.value === 'session') activeTimer.mark() }

// ── 画面管理 ───────────────────────────────────────────────────────────────────
// 'landing' | 'auth' | 'sessions' | 'session' | 'session-detail' | 'guest-result'
const currentView   = ref('landing')
const detailSnapshot = ref(null)
// 完了後ゲスト閲覧（読み取り専用結果ビュー）
const guestResult      = ref(null)   // 結果スナップショット（null = エラー表示）
const guestResultError = ref('')
// セッションライフサイクル（D1 状態遷移はすべて useSession 経由）
const {
  pendingSession, isCompleting: completing, completionUnknown, completionBusy,
  begin: beginSession, resume: resumeSession, restore: restorePendingSession,
  touch: touchSession, markActive: markSessionActive, complete: completeSessionD1,
  verifyCompletion, pendingCompletionIntent, ackCompletionFinalized,
  captureLifecycle, isLifecycleStale, clear: clearSession,
} = useSession()

// ── 完了セッションの NEW バッジ ───────────────────────────────────────────────
const newSessionId = ref(null)
let _newSessionTimer = null
function _setNewSession(id) {
  newSessionId.value = id
  clearTimeout(_newSessionTimer)
  _newSessionTimer = setTimeout(() => { newSessionId.value = null }, 60000)
}

// ── ルーム参加前の名前設定 ────────────────────────────────────────────────────
const pendingJoinCode      = ref(null)
const pendingJoinSessionId = ref(null)  // 招待リンクのセッションID（鍵）
const pendingJoinType      = ref('stock') // 参加先ルームの種類（棚卸/発注）
const showNameModal    = ref(false)
const pendingName      = ref('')
const pendingNameError = ref(false)

function _askNameAndJoin(code, joinSessionId = null, type = 'stock') {
  pendingJoinCode.value      = code
  pendingJoinSessionId.value = joinSessionId
  pendingJoinType.value      = type === 'order' ? 'order' : 'stock'
  pendingName.value      = deviceName.value || ''
  pendingNameError.value = false
  showNameModal.value    = true
}

// セッションID付きリンク（?store=CODE&s=SID）の入口
// まずライブ参加を試み、対象セッションが非アクティブなら完了結果を読み取り専用で表示する。
async function _enterStoreLink(code, sessionId, type = 'stock') {
  const status = await fetchRoomStatus(code, type).catch(() => null)
  if (status?.isActive && status.sessionId === sessionId) {
    _askNameAndJoin(code, sessionId, type)   // ライブ中: ルームに参加（鍵を渡す）
    return
  }
  // 完了後: D1 スナップショットから金額抜きの結果を取得
  const result = await fetchRoomResult(code, sessionId)
  guestResult.value      = result
  guestResultError.value = result ? '' : 'この棚卸の閲覧期間が終了したか、まだ完了していません。'
  currentView.value      = 'guest-result'
}

async function onConfirmName() {
  const name = pendingName.value.trim()
  if (!name) {
    pendingNameError.value = true
    return
  }
  pendingNameError.value = false
  setDeviceName(name)
  showNameModal.value   = false
  const code            = pendingJoinCode.value
  const joinSid         = pendingJoinSessionId.value
  const joinType        = pendingJoinType.value
  pendingJoinCode.value = null
  pendingJoinSessionId.value = null

  // Free プラン: 2台制限チェック（ルーム参加前に参加者数を確認）
  if (!canJoinRoom(participantList.value.length)) {
    openUpgrade(`現在${participantList.value.length}台接続中です。無料プランは${FREE_DEVICE_LIMIT}台まで接続できます。`)
    currentView.value = 'landing'
    return
  }

  sessionMode.value     = joinType === 'order' ? 'order' : 'stock'
  currentView.value     = 'session'
  try {
    await joinRoom(code, joinSid, joinType)
    const isRejoined = syncState.mode === 'hosting'
    showToast(
      isRejoined ? `ルーム ${code} にホストとして再接続しました` : `ルーム ${code} に参加しました`,
      3000, 'join'
    )
  } catch {
    // state.error に具体的なエラーメッセージがあれば使用する
    showToast(syncState.error || 'ルームへの参加に失敗しました', 5000, 'error')
    currentView.value = 'landing'
  }
}

function onCancelNameModal() {
  showNameModal.value   = false
  pendingJoinCode.value = null
}

async function onLandingStarted(payload) {
  if (payload?.joinRoom) {
    // ゲスト参加（認証不要）
    _askNameAndJoin(payload.joinRoom, payload.joinSessionId ?? null)
  } else if (payload?.hostMode) {
    // ホスト開始 → 認証済みならセッション一覧へ、未認証なら認証ページへ
    if (isAuthenticated.value) {
      currentView.value = 'sessions'
    } else {
      currentView.value = 'auth'
    }
  } else {
    // 直接セッション開始（認証なし）
    await _startSessionView()
  }
}

// D1 の履歴を端末へ反映し、端末にしか無いスナップショットを送り直す（DATA-002 Phase 2）。
// 完了時の保存が片方だけ失敗すると「一覧には出るが詳細が開けない」状態が残るため、
// 履歴を読むタイミング（起動・ログイン・セッション開始）ごとに片落ちを埋める。
// 差分の判定は applyRemoteHistory より前に行う（後だとローカルがリモートで潰れて差分が消える）。
//
// 進行中セッションは対象外。まだ完了していない棚卸のスナップショットを送ると、
// サーバー側で「active なのに完了履歴だけある」状態が生まれ、一覧と詳細が食い違う。
async function _syncHistoryFromD1(remoteHistory) {
  const activeSessionIds = pendingSession.value?.id && !isCompleted.value
    ? [pendingSession.value.id]
    : []
  const toBackfill = missingSnapshots(getSnapshots(), remoteHistory, { activeSessionIds })
  if (remoteHistory?.length) applyRemoteHistory(remoteHistory)
  for (const snap of toBackfill) await _pushSnapshot(snap)
  return toBackfill.length
}

// スナップショットを D1 へ送り、成功したらサーバーの revision を端末へ書き戻す。
// dirty（端末でだけ訂正した状態）を下ろすのはサーバーが受け付けた後だけ。
// dirty / synced / localRev は端末側の同期状態なのでサーバーへは送らない（保存内容に混ぜない）。
//
// ack は**送った版にだけ**効かせる（localRev）。送信中に同じセッションの新しい訂正が
// 作られていた場合、この応答でそれを「サーバー確認済み」にすると、一度も送っていない
// 版が未送信キューとバックフィルの対象から外れて黙って消える。
async function _pushSnapshot(snap) {
  const { dirty, synced, localRev, ...payload } = snap
  const { ok, result } = await saveSnapshotToD1(payload)
  if (ok) markSnapshotSynced(snap.sessionId ?? snap.date, result, localRev ?? null)
  return ok
}

async function _startSessionView({ loadConfig = true } = {}) {
  currentView.value = 'session'
  try {
    const [remoteConfig, remoteHistory] = await Promise.all([
      loadConfig ? loadConfigFromD1() : Promise.resolve(null),
      loadHistoryFromD1(),
    ])
    if (loadConfig && remoteConfig?.order?.length && (!pendingSession.value?.id || config.isCustom)) {
      applyRemoteConfig(remoteConfig)
    }
    await _syncHistoryFromD1(remoteHistory)
  } catch (_) {
    // ネットワークエラーは無視してローカルデータで継続
  }
}

// アカウント設定（品目・並び替え・履歴）を D1 から取得してこの端末へ反映する。
// 別端末でログインした直後など、mount 時点で shopCode が無かった経路の取りこぼしを防ぐ。
async function _pullAccountConfig() {
  if (!shopCode.value) return
  try {
    const [remoteConfig, remoteHistory] = await Promise.all([
      loadConfigFromD1(),
      loadHistoryFromD1(),
    ])
    if (remoteConfig?.order?.length && (!pendingSession.value?.id || config.isCustom)) {
      applyRemoteConfig(remoteConfig)
    }
    await _syncHistoryFromD1(remoteHistory)
  } catch (_) {
    // ネットワークエラーは無視してローカルデータで継続
  }
  await _pullMovements()  // 入出庫（ホームの未反映バッジ・カレンダー表示で使用）
}

// 認証後にセッション一覧へ
async function onAuthDone() {
  currentView.value = 'sessions'
  // 401 で止めていた再送を解除する（DATA-001 §2）。送るのは現在の店舗ぶんだけなので、
  // 別店舗へログインした場合に旧店舗の未送信データは送られない。
  // 別アカウントなら useAuth の accountReset が先に旧店舗ぶんを破棄している。
  //
  // **drain の完了を待ってから pull する**（第2セッション §6）。同じ店舗へ再ログインした
  // 直後は、端末側にサーバーより新しい未送信の版が残っている。先にリモートを読むと
  // 古い内容でローカルを上書きし、送るべき差分ごと消える。順序は services/authResume.js。
  await resumeAfterLogin({
    drain: clearAuthBlock,
    pull:  _pullAccountConfig,
    // 送り切れていない。リモートは反映しない（未送信の変更が消えるため）。
    // キューは残り、指数バックオフの再送とバナーの導線がそのまま効く。
    onPendingLeft: (n) => showToast(
      `未送信の変更が${n}件残っています。送信できるまでこの端末の内容を表示します`, 6000, 'warning',
    ),
  })
}

// セッション一覧から「セッション開始」（棚卸=stock / 発注=order の型付きセッション）
async function onSessionStart(session, mode = 'stock') {
  // 完了処理の最中に別セッションへ移ると、完了要求の対象と端末の状態がずれる
  if (_blockedByCompletion()) return
  const isOrder = mode === 'order'
  sessionMode.value = isOrder ? 'order' : 'stock'
  // 残存ルームの解散は通信を待つ。**待機中にアカウントが切り替わりうる**ので、
  // 切替前に選んだセッションをそのまま開始しない（別店舗の session を
  // beginSession してしまうと、reset() で現在の在庫まで消える）。
  const origin = captureLifecycle()
  // 棚卸: 残存ルームを解散。発注: 棚卸ルームは壊さず、この端末は現在のルームから離脱のみ。
  if (!isOrder && hasHostToken('stock')) await dissolveRoomRemote('stock')
  if (isLifecycleStale(origin)) {
    console.warn('[App] account/session changed while dissolving; not starting the selected session:', session?.id)
    return
  }
  if (isOrder && syncActive.value) leaveRoom()
  practiceMode.value = false
  beginSession(session)
  reset()
  clearAuditLog()
  activeTimer.start()
  // 空リストで開始しても自動でモーダルは開かない（検索→その場登録が主動線）。
  const startedEmpty = config.order.length === 0
  showAddItemForm.value = false
  if (startedEmpty) _persistConfigToD1()
  track('session_started')
  await _startSessionView({ loadConfig: false })
  if (isOrder) { await _loadOrderData(); _restoreOrderDraft(); showToast('発注確認を開始しました', 2600, 'default') }
}

// 発注セッション用: D1 の過去発注を取り込み（学習データ）、下書きを復元する。
async function _loadOrderData() {
  try {
    const remote = await loadOrdersFromD1()
    if (Array.isArray(remote) && remote.length) applyRemoteOrders(remote)
  } catch (_) {}
}

// 入出庫を D1 から取り込む（端末間共有・キャッシュ削除からの復旧）。id重複排除で冪等。
async function _pullMovements() {
  if (!shopCode.value) return
  try {
    const remote = await loadMovementsFromD1()
    if (Array.isArray(remote) && remote.length) applyRemoteMovements(remote)
  } catch (_) {}
}

// 入出庫ページを開く。最新の入出庫を D1 から取り込んでから表示する。
function openMovement() {
  currentView.value = 'movement'
  _pullMovements()
}

// セッション一覧から「練習モードで開始」（テスト用リスト・履歴に残さない・D1非永続）
let _prepracticeConfig = null
async function onStartPractice() {
  if (_blockedByCompletion()) return
  sessionMode.value = 'stock'
  // 残存ルームの解散待ちの間にアカウントが切り替わりうる。そのまま進むと
  // 現在の在庫・セッションを消して練習モードへ入ってしまう（onSessionStart と同じ）。
  const origin = captureLifecycle()
  if (hasHostToken('stock')) await dissolveRoomRemote('stock')
  if (isLifecycleStale(origin)) {
    console.warn('[App] account/session changed while dissolving; not entering practice mode')
    return
  }
  if (syncActive.value) leaveRoom()
  practiceMode.value = true
  reset()
  clearAuditLog()
  clearSession()                            // D1 セッションを持たない（履歴に残さない）
  activeTimer.start()
  _prepracticeConfig = snapshotConfig()     // 本来の品目リストを退避（練習で上書きするため）
  loadSampleData()                          // 初期からあるテスト用リスト
  showAddItemForm.value = false
  showToast('練習モードを開始しました（履歴には残りません）', 3500, 'default')
  currentView.value = 'session'
}

// 練習モードを抜けるときに本来の品目リストを復元する
function _exitPractice() {
  practiceMode.value = false
  if (_prepracticeConfig) { restoreConfigSnapshot(_prepracticeConfig); _prepracticeConfig = null }
  reset()
  clearAuditLog()
}

// セッション一覧から「完了済みセッション詳細」
//
// 端末にスナップショットが無ければ D1 の明細（inventory_lines）から組み立てて表示する
// （DATA-002 Phase 1 / R-001）。端末を変えると詳細が開けなくなっていた実害への対処で、
// 端末の localStorage にも D1 にも書き戻さない。読むだけ。
const viewSessionLoading = ref(false)
async function onViewSession(session) {
  if (viewSessionLoading.value) return
  if (session?.id && session.id === pendingSession.value?.id && _blockedByCompletion()) return
  // sessionId で一致するものだけを端末の記録として採用する。
  // 以前は「日付が同じスナップショット」へfallbackしていたが、同じ日に2回棚卸すると
  // 別セッションの中身を出してしまう。取り違えて見せるより、サーバーから取り直す（fail-closed）。
  //
  // 中身の揃わないスナップショット（明細が空・書きかけ）は「端末に記録がある」と
  // 扱わない。サーバーには正しい明細があるのに空の詳細を見せてしまうため、
  // sessionId で明細を取り直す。
  let snap = getSnapshotBySessionId(session.id)
  if (snap && !isSnapshotComplete(snap)) snap = null

  if (!snap && session.id) {
    viewSessionLoading.value = true
    try {
      snap = buildSnapshotFromLines(await getSessionLines(session.id))
    } catch (err) {
      // 404 = この店舗に無いセッション。それ以外（通信・認証）は原因を分けて伝える
      if (err?.status && err.status !== 404) {
        console.error('[App] session lines fetch failed:', session.id, err?.message ?? err)
        showToast('棚卸データを取得できませんでした。通信状況を確認してください', 3500, 'warning')
        viewSessionLoading.value = false
        return
      }
    } finally {
      viewSessionLoading.value = false
    }
  }

  if (!snap) {
    showToast('この棚卸の明細が見つかりません', 3000, 'warning')
    return
  }
  if (snap.truncated) {
    showToast('明細が多いため一部のみ表示しています', 3500, 'warning')
  }
  detailSnapshot.value = snap
  currentView.value = 'session-detail'
}

/**
 * 履歴詳細で数量を訂正したとき（SessionDetailPage の patched）。
 *
 * 訂正は端末で dirty として保持され、ここでサーバーへ送る。以前は送る経路が無く、
 * バックフィルが端末時計（updatedAt）でリモートと比較して拾うのを待っていた。
 * 時計を戻した端末では「リモートの方が新しい」と判定され、訂正が黙って消えていた。
 * 送信に失敗しても dirty のまま残り、未送信キューと次回のバックフィルが再送する。
 */
async function onSnapshotPatched(snap) {
  detailSnapshot.value = snap
  const saved = await _pushSnapshot(snap)
  if (!saved) showToast('訂正はこの端末に保存しました。接続が戻ると自動で送信します', 4000, 'warning')
}

// セッション一覧から「再開」
async function onSessionResume(session) {
  if (_blockedByCompletion()) return
  sessionMode.value = session?.type === 'order' ? 'order' : 'stock'
  // 前セッションのメモリ残留を完全に断つ（共有ルーム由来の在庫汚染を防止）
  reset()
  clearAuditLog()
  practiceMode.value = false
  activeTimer.start()   // 下書きに保存済み稼働時間があれば _restoreDraft が resume() で継続する
  resumeSession(session)
  await _startSessionView()
  if (sessionMode.value === 'order') { await _loadOrderData(); _restoreOrderDraft() }
  if (shopCode.value && !syncActive.value) {
    // このセッションがライブなルームを持つ時だけ復帰判定する
    await _reconnectToRoom(session)
  } else {
    // 店舗コードなし: 下書きから在庫を復元
    _restoreDraft(session.id)
  }
}

// ルーム自動復帰（再開時）
// 店舗ルームは shopCode 単位の共有シングルトンのため、DO のアクティブセッションが
// このセッションと一致する時だけ復帰する。不一致なら乗っ取らず退出しオフライン継続。
async function _reconnectToRoom(session) {
  const rtype = session?.type === 'order' ? 'order' : 'stock'
  try {
    // まず GET /status で確認（ルームを作らない）。ライブで同一セッションの時だけ復帰接続する。
    // ここで createRoom で確認すると、ライブでなくても hostToken を発行＝幽霊ルームが残る。
    const status = await fetchRoomStatus(shopCode.value, rtype).catch(() => null)
    if (!(status?.isActive && status.sessionId === session.id)) {
      _restoreDraft(session.id)   // ライブルーム無し → 作らずオフライン継続
      return
    }
    // 期待セッションIDを設定: joined ハンドラが同一セッション時のみ DO 在庫を適用
    setExpectedSessionId(session.id)
    await createRoom(rtype)
    if (syncState.isSessionActive && syncState.sessionId === session.id) {
      // 本物の再接続: このセッションのライブルームに復帰（ゲスト入力含む在庫を適用済み）
      showToast(`ルーム ${syncState.roomCode} に復帰しました`, 2500, 'join')
    } else {
      // 別セッションのルーム or 非アクティブ: 乗っ取らず即退出し、下書きでオフライン継続
      setExpectedSessionId(null)
      leaveRoom()
      _restoreDraft(session.id)
    }
  } catch (_) {
    setExpectedSessionId(null)
    // 接続失敗（オフライン等）: 下書きから在庫を復元してオフライン継続
    _restoreDraft(session.id)
  }
}

// ── Settings / History / Sync modal ────────────────────────────────────────────
const showSync          = ref(false)
const showUpgrade       = ref(false)
const upgradeReason     = ref('')
const showBarcode       = ref(false)
const barcodeAddCode    = ref('')  // バーコード未登録時の自動入力コード
const lastBarcode       = ref('')  // 直前に読み取ったコード（連続スキャン時の同一商品無視用）
const pendingGuestRequest = ref(null)  // ゲスト: ホスト承認待ち中の申請 { requestId, name }
const showMenu          = ref(false)  // ヘッダーのハンバーガーメニュー
const memberHistoryTarget = ref(null)  // タップした参加者のリアルタイム変更履歴 { id, name, isMe }
function openMemberHistory(p) { if (p) memberHistoryTarget.value = p }
// メンバー履歴の品目タップ → その品目の数量編集モーダルを開く
function onMemberHistoryEdit(ingredient) {
  if (inputLocked.value || !ingredient) return
  memberHistoryTarget.value = null
  openConfirm(ingredient, null, config.units?.[ingredient] || '', 'search')
}
const showAddItemForm   = ref(false)  // 品目追加フォームの表示/非表示
const practiceMode      = ref(false)  // 練習モード（履歴に残さない）
const inventoryTableRef = ref(null)

function openUpgrade(reason = '') {
  upgradeReason.value = reason
  showUpgrade.value   = true
}

// バーコードスキャン: 品目コードと照合して確認モーダルを開く
function onBarcodeScanned(text) {
  showBarcode.value = false
  lastBarcode.value = text            // 連続スキャンでカメラに戻った直後の同一商品を無視するため記録
  const item = Object.entries(config.codes ?? {}).find(([, code]) => code === text)?.[0]
  if (item) {
    showToast(`バーコード認識: ${item}`, 2000, 'success')
    // source='barcode' にすると、数量入力完了後すぐカメラに戻る（連続スキャン）
    openConfirm(item, null, config.units?.[item] || '', 'barcode')
  } else {
    // 未登録バーコード → 品目追加フォームをバーコードコード付きで開く
    barcodeAddCode.value  = text
    newItemName.value     = ''
    newItemQty.value      = ''
    newItemPrice.value    = ''
    newItemCategory.value = ''
    newItemError.value    = ''
    showToast(`バーコード「${text}」が未登録です。品目名を入力して追加してください`, 4000, 'warning')
    nextTick(() => newItemNameRef.value?.focus())
  }
}

// 棚卸結果CSVから入力（数量）を復元する。
// 同名品目があればその数量を復元、無ければ新規追加して数量を入れる（数量のみ・単価は現リスト優先）。
function onRestoreInventory(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return
  if (currentView.value !== 'session') {
    showToast('棚卸セッションを開始してから復元してください', 4000, 'warning')
    return
  }
  if (inputLocked.value) { showToast('完了済みのため復元できません', 3000, 'warning'); return }

  let restored = 0, added = 0
  for (const r of rows) {
    if (!r?.name || typeof r.qty !== 'number') continue
    // 単価は parser（共通の数値契約）が数値か null にして渡す。ここで parseFloat し直すと
    // 前方一致で `12abc` → 12 を作り直してしまうので、値をそのまま使う。
    const price = typeof r.price === 'number' && r.price > 0 ? r.price : null
    if (!config.order.includes(r.name)) {
      // CSVの情報（単価・ジャンル・単位・コード）をまとめて復元
      addItem(r.name, price, r.category || null, r.unit || null, r.code || null)
      added++
    }
    // 入数・前月実績も復元
    if (r.lotSize || r.prevMonth) setItemExtras(r.name, { lotSize: r.lotSize, prevMonth: r.prevMonth })
    const unit = r.unit || config.units?.[r.name] || ''
    updateQty(r.name, r.qty, unit, deviceName.value || '名前未設定')
    if (syncActive.value) broadcastUpdate(r.name, r.qty, unit, deviceName.value || '名前未設定')
    restored++
  }
  if (restored) markActivity()
  showToast(`${restored}件の数量を復元しました${added ? `（新規${added}件）` : ''}`, 4500, 'success')
}

const hasBarcodedItems = computed(() => Object.keys(config.codes ?? {}).length > 0)

// ── Sync ───────────────────────────────────────────────────────────────────────
const { state: syncState, isActive: syncActive, isHost: syncIsHost, participantList, createRoom, joinRoom, leaveRoom, dissolveRoom, unreadCount, auditLog } = useSync()

// ── デスクトップシェル（サイドナビ + 広い本文）────────────────────────────────
// 1024px 以上かつログイン済みの「アプリ内」画面でのみサイドナビを出す。
// ランディング・認証・削除申請・ゲスト結果はナビを持たない単独画面のまま残す。
// matchMedia 非対応環境（jsdom）では isDesktop が常に false になり、モバイル表示になる。
const isDesktop = useMediaQuery(DESKTOP_QUERY)
const DESKTOP_NAV_VIEWS = ['sessions', 'session', 'master', 'movement', 'session-detail']
const showDesktopNav = computed(() =>
  isDesktop.value && isAuthenticated.value && DESKTOP_NAV_VIEWS.includes(currentView.value)
)

// サイドナビは position:fixed のため、本文の逃げ幅は body の padding で確保する。
// #app 自身の max-width / margin:auto を壊さずに済む。
// data-view はサイドナビを持たない単独画面（ランディング等）をCSSから識別するために出す。
watchEffect(() => {
  if (typeof document === 'undefined') return
  document.body.classList.toggle('dt-shell', showDesktopNav.value)
  document.body.dataset.view = currentView.value
})
onUnmounted(() => {
  if (typeof document === 'undefined') return
  document.body.classList.remove('dt-shell')
  delete document.body.dataset.view
})

// サイドナビからの画面遷移。棚卸画面からの離脱は保存・確認を伴うため onGoHome を通す。
async function onDesktopNavigate(view) {
  if (view === currentView.value) return

  if (currentView.value === 'session') {
    await onGoHome()
    // 確認ダイアログをキャンセルした場合は遷移しない
    if (currentView.value !== 'sessions') return
    if (view === 'sessions') return
  }

  if (view === 'session') {
    if (pendingSession.value) await onSessionResume(pendingSession.value)
    return
  }
  if (view === 'movement') { openMovement(); return }
  currentView.value = view
}

// メイン画面の目立つ「ルームを作成」CTA から呼ぶ。
// SyncModal の作成フロー（セッション開始＝isActive 設定・QR生成・再接続判定）を
// そのまま再利用するため、autoCreate フラグを立ててモーダルを開く。
// ※ createRoom() を直接呼ぶと session_start が走らず、ゲストが
//   「セッションが開始されていません」で弾かれるため必ずこの経路を通す。
const syncAutoCreate = ref(false)
function onCreateRoomFromMain() {
  if (syncActive.value) { showSync.value = true; return }
  if (!shopCode.value) { showToast('ルーム作成には店舗の登録が必要です', 3500, 'warning'); return }
  syncAutoCreate.value = true
  showSync.value = true
}

// 履歴を確認できるメンバー = 在室中の参加者 ＋ 退室済みでも履歴を1件以上持つ人
const historyMembers = computed(() => {
  const map = new Map()
  for (const p of participantList.value) {
    map.set(p.id, { id: p.id, name: p.name, isMe: p.isMe, isDone: p.isDone, present: true })
  }
  for (const e of auditLog) {
    if (!e.enteredById || map.has(e.enteredById)) continue
    map.set(e.enteredById, { id: e.enteredById, name: e.enteredBy || '名前未設定', isMe: false, isDone: false, present: false })
  }
  return [...map.values()]
})


// ── あとで数える 一覧 ──────────────────────────────────────────────────────────
const recountItems = computed(() => Object.keys(recountFlags))
const recountOpen  = ref(false)

// ── オフライン時のローカル auditLog 追記 ───────────────────────────────────────
function _localAudit(ingredient, action, delta, totalQty, unit) {
  addLocalAuditEntry({
    id:          `local-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    ingredient,
    action,
    delta,
    totalQty,
    unit,
    enteredBy:   deviceName.value || '名前未設定',
    enteredById: deviceId,
    timestamp:   Date.now(),
  })
}

// ── あとで数える フラグの切替（ソロ=ローカル監査 / 同期中=ブロードキャスト）──
function onToggleRecountFlag(item, on) {
  if (isCompleted.value) return
  markActivity()
  setRecountFlag(item, on, deviceName.value || '名前未設定')
  if (syncActive.value) {
    broadcastRecountFlag(item, on)
  } else {
    const cur = inventory[item]
    _localAudit(item, on ? 'flag_recount' : 'unflag_recount', 0, cur?.qty ?? 0, cur?.unit ?? '')
  }
  showToast(on ? `「${item}」を“あとで数える”に追加 🔖` : `「${item}」の“あとで数える”を解除`, 2400, on ? 'warning' : 'default')
}

// 受信ハンドラを登録（useInventory ↔ useSync を循環なしで接続）
setInventoryCallbacks(applyRemoteUpdate, applyRemoteRemove)
setRecountFlagCallback(applyRemoteRecountFlag)
setClearInventoryCallback(() => reset())
registerInventoryGetter(() => ({ ...inventory }))
registerRecountFlagsGetter(() => ({ ...recountFlags }))
registerConfigGetter(() => ({ ...serializeConfigData(), isCustom: config.isCustom }))
setOrderCallbacks(applyRemoteOrderUpdate, applyRemoteOrderRemove)
setOrdersSnapshotCallback(applyOrdersSnapshot)
registerOrdersGetter(_ordersPayload)
setConfigCallback((cfg) => {
  applyRemoteConfig(cfg)
  if (syncActive.value && !syncIsHost.value) {
    showToast('品目一覧が更新されました', 3000, 'update')
  }
})
// ホストに品目リストが無いルームへ参加した場合はローカルを空に揃える
setResetConfigCallback(() => clearConfig())

function _configPayload() {
  return serializeConfigData()
}

// 即時に現在の config を D1 へ保存（空リスト開始の確定など、デバウンスを待てない場面用）
function _persistConfigToD1() {
  clearTimeout(_configSaveTimer)
  _configSaveTimer = null
  saveConfigToD1(_configPayload())
}

let _configSaveTimer = null
setConfigChangedCallback(() => {
  clearTimeout(_configSaveTimer)
  _configSaveTimer = setTimeout(() => {
    _configSaveTimer = null
    saveConfigToD1(_configPayload())
  }, 2000)
})
setDoneCallback((name, isFinal) => {
  const msg = isFinal
    ? `棚卸が締められました。入力を終了してください。`
    : `${name} が棚卸完了を報告しました ✓`
  showChatNotif(msg)
})
setMessageCallback((msgObj) => {
  if (!showChat.value) showChatNotif(msgObj.text, msgObj.senderName)
})
// 解散の片付けはトーストを読ませてから行うため 3.5 秒遅らせる。
// **その間に別セッション開始・アカウント切替が起きうる。** 無条件に実行すると、
// 旧ルームのタイマーが現在の作業（session・入力・画面）を消す（再レビュー2 §3）。
let _dissolvedTimer = null
setDissolvedCallback(() => {
  showChat.value = false
  showSync.value = false
  const selfDissolved = _hostInitiatedDissolve
  _hostInitiatedDissolve = false
  if (!selfDissolved) {
    showToast('セッションが破棄されました', 4000, 'error')
    // セッション世代だけでは足りない。**同じ pendingSession のまま新しいルームを作る**
    // 経路（SyncModal は `begin()` を呼ばない）では世代が変わらず、旧ルームのタイマーが
    // 新ルームで使用中のセッション・在庫を消せる。同期接続の世代も併せて確認する。
    const origin     = captureLifecycle()
    const connection = captureSyncConnection()
    clearTimeout(_dissolvedTimer)
    _dissolvedTimer = setTimeout(() => {
      _dissolvedTimer = null
      if (isLifecycleStale(origin) || isSyncConnectionStale(connection)) {
        console.warn('[App] dissolved cleanup skipped; the session or connection changed while waiting')
        return
      }
      clearSession()
      reset()
      clearAuditLog()
      currentView.value = 'landing'
    }, 3500)
  } else {
    showToast('ルームが閉鎖されました', 2500)
  }
})
setParticipantJoinCallback((name) => showToast(`${name} が参加しました`, 3000, 'join'))
setParticipantLeaveCallback((name) => showToast(`${name} が退出しました`, 3000, 'leave'))
let _hostCompletedLeave = false
let _hostInitiatedDissolve = false

setGuestLeaveCallback(() => {
  showSync.value = false
  showChat.value = false
  clearSession()
  reset()
  clearConfig()
  clearAuditLog()
  guestReported.value = false
  if (!_hostCompletedLeave) {
    showToast('ルームを退出しました', 2500, 'leave')
  }
  _hostCompletedLeave = false
  currentView.value = 'landing'
})
setConflictCallback((ingredient, remoteQty, remoteUnit, remoteBy, local) => {
  const who = remoteBy || '他のメンバー'
  showToast(`${who}: 「${ingredient}」${remoteQty}${remoteUnit}に更新（あなた: ${local.qty}${local.unit}）`, 5000, 'warning')
})

// 同時入力（3秒以内）競合: キューをリアクティブに保持し解決モーダルへ
const conflictQueue = ref([])
setConflictQueueCallback((q) => { conflictQueue.value = q })

// ホスト側: ゲストからの競合通知をポップアップ＋チャットで通知
setConflictNotifyCallback((ingredient) => {
  _postConflictToChat(ingredient)
})

function approveItemAdd(req) {
  addItem(req.name, null, null, req.unit || null, req.code || null)
  broadcastConfig(_configPayload())
  broadcastItemAddResponse(req.requestId, true, req.name)
  dismissItemAddRequest(req.requestId)
  showToast(`「${req.name}」を品目リストに追加しました`, 2500, 'success')
}

function rejectItemAdd(req) {
  broadcastItemAddResponse(req.requestId, false, req.name)
  dismissItemAddRequest(req.requestId)
  showToast(`「${req.name}」の追加を拒否しました`, 2000, 'default')
}

function onResolveConflict(c, resolution) {
  const qty  = resolution === 'sum'    ? Math.round((c.local.qty + c.remoteQty) * 10000) / 10000
             : resolution === 'mine'   ? c.local.qty
             :                          c.remoteQty
  const unit = resolution === 'theirs' ? c.remoteUnit : c.local.unit
  setItem(c.ingredient, qty, unit, false, deviceName.value || '名前未設定')
  markActivity()
  if (!syncActive.value) {
    _localAudit(c.ingredient, 'overwrite', qty, qty, unit)
  } else {
    broadcastUpdate(c.ingredient, qty, unit, deviceName.value || '名前未設定', false)
  }
  dismissConflict(c.ingredient)
  showToast(`「${c.ingredient}」を ${qty}${unit} に確定しました`, 2400, 'success')
  if (syncActive.value) {
    const label = resolution === 'sum' ? '合計' : resolution === 'mine' ? '自分の値' : '相手の値'
    broadcastMessage(`✅ 「${c.ingredient}」: ${label}（${qty}${unit}）で確定 — ${deviceName.value || '名前未設定'}`)
  }
}
setNameTakenCallback((prevName) => {
  setDeviceName(prevName)
  showToast('この端末名は既に使用されています', 4000, 'warning')
})
setRemoteUpdateCallback((ingredient, qty, unit, by) => {
  markActivity()   // 他端末の操作もルームの稼働とみなす（誰かが動いていれば一時停止しない）
  const who = by || '他のメンバー'
  const msg  = qty === null
    ? `${who}: 「${ingredient}」を削除`
    : `${who}: 「${ingredient}」${qty}${unit}`
  showToast(msg, 2800, 'update')
})
setSessionEndedCallback(async (status, sessionId, itemCount) => {
  // ホスト自身の完了処理が走っている最中に自分の session_ended を受けても、
  // useSession が実行中の1本へ合流させるので完了要求は増えない。
  //
  // 完了要求は本番経路すべてで同じ helper から作る（第2セッション §2）。
  // 以前はここだけ snapshot 無しで呼んでおり、snapshot 必須化した現行 Worker では
  // 400 snapshot_required になる＝ホストの完了がこの経路から壊れていた。
  //
  // **どのセッションの通知かを必ず確かめる。** 古いルームから遅れて届いた session_ended で
  // いま開いている別のセッションを完了させない。sessionId を持たない通知（sessionId を
  // 保存していないルーム）は、対象を特定できないので完了させない（fail-closed）。
  // ホスト自身の完了は `_finishSession` が主経路で、ここはそれへ合流するだけの保険。
  //
  // **await をまたぐので、通知を受けた時点の状態を捕まえておく。** 完了APIを待っている
  // 間にアカウント・セッション・ルームが切り替わると、この続きが「いま参加している
  // ルーム」を leaveRoom() し、現在の作業を閉じてしまう。
  const origin = captureLifecycle()
  const wasHost = syncIsHost.value

  if (status === 'completed' && sessionId && sessionId === pendingSession.value?.id) {
    const req = _buildCompletionRequest()
    if (req.ok) {
      const completed = await completeSessionD1(req)
      if (completed?.stale || isLifecycleStale(origin)) {
        console.warn('[App] session_ended: account/session changed while completing; ignoring:', sessionId)
        return
      }
    } else {
      console.error('[App] session_ended: completion payload unavailable:', req.reason)
    }
  } else if (status === 'completed' && (!sessionId || pendingSession.value?.id)) {
    // 対象を特定できない通知（sessionId 欠落）と、**自分の進行中セッションとは別の**
    // セッションの通知は fail-closed。完了させないだけでなく、退出も通知もしない。
    // 古いルームから遅れて届いた通知で、いま参加しているルームを閉じてしまうため。
    console.warn('[App] session_ended: not for the current session; ignoring:', sessionId)
    return
  }
  // 自分のセッションを持たないゲストは、ホストの完了通知で従来どおり退出する
  // （このルームについての通知であり、取り違える対象が無い）。

  // 退出も通知も、通知を受けた時点のホスト/ゲストで判断する（await 中の変化に従わない）
  if (!wasHost && status === 'completed') {
    // ゲスト: ホストが完了 → 即座にホームへ遷移
    showToast('ホストが棚卸を完了したため、ルームを閉鎖します', 4000, 'warning')
    _hostCompletedLeave = true
    leaveRoom()
  } else {
    const msg = status === 'completed' ? '棚卸セッションが完了しました ✓' : 'セッションが中断されました'
    showToast(msg, 4000, status === 'completed' ? 'join' : 'warning')
  }
})

setNewSessionStartedCallback(() => {
  showToast('ホストが新しい棚卸を開始したため退室します', 4000, 'warning')
  _hostCompletedLeave = true
  leaveRoom()
})

// 別アカウントでログイン/登録したとき、前アカウントのローカルデータを全消去する
// （品目マスタ・棚卸・発注・入出庫・履歴等がアカウント境界を越えて見える漏洩を防ぐ）
setAccountResetHandler(() => {
  clearLocalAccountData()
  clearSession()
  reset()
  clearAuditLog()
})

/**
 * 別端末で同じ店舗にログインされ、この端末のトークンが失効したとき。
 *
 * **消す前に残す。** 以前はここで clearSession()（＝進行中セッションの参照）と
 * reset()（＝当日の入力）を無条件に捨てていた。失効は入力中でも起きるため、
 * 数十品目の入力が確認も再送手段もないまま消えていた。
 *
 * いまは
 *   1. 未送信キューを失効時点の shopCode へ紐付けて端末へ書く（noteAuthInvalidated）
 *   2. 作業中の入力を同じセッションの下書きとして書く（_saveDraft）
 *   3. その後でローカルの認証状態を捨てる
 * とし、同じ店舗へ再ログインしたときだけ 1 の再送と 2 の復元が走る。
 * 別店舗へログインした場合は useAuth の accountReset が旧店舗ぶんをまとめて捨てる。
 */
setAuthInvalidatedHandler(() => {
  const lostShop = noteAuthInvalidated(shopCode.value)
  _flushDebouncedSavesToQueue(lostShop)
  _saveDraft(pendingSession.value?.id)
  if (syncActive.value) { _hostCompletedLeave = true; leaveRoom() }
  clearAuthLocal()
  // pendingSession / 入力値は残す。同じ店舗へ戻れば同じセッションを完了し直せる。
  showToast('別の端末でログインされたため、この端末からはログアウトしました。入力内容はこの端末に残しています', 7000, 'warning')
  currentView.value = 'landing'
  console.warn('[App] auth invalidated; work preserved for shop:', lostShop)
})

// ゲスト→ホスト 品目追加申請フロー
setItemAddRequestCallback((req) => {
  // ホスト側: ゲストからの申請を受信（pendingItemRequests に自動追加済み）
  showToast(`${req.fromDeviceName} が「${req.name}」の追加を申請`, 5000, 'info')
})
setItemAddResponseCallback((requestId, approved, name, reason) => {
  // ゲスト側: ホストの承認/拒否を受信
  if (pendingGuestRequest.value?.requestId === requestId) {
    pendingGuestRequest.value = null
  }
  if (reason === 'host_offline') {
    showToast(`ホストがオフラインのため「${name}」の申請が失敗しました`, 4000, 'warning')
  } else if (approved) {
    showToast(`「${name}」がホストに承認されました ✓`, 3000, 'success')
  } else {
    showToast(`「${name}」の追加がホストに拒否されました`, 3000, 'warning')
  }
})

// URL パラメータ ?room=CODE / ?store=CODE があれば自動参加（ホーム画面をスキップ）
// ConnectionBanner の表示条件と対で保つ（本文をバナー分だけ下げるため）。
const _bannerActive = computed(() =>
  !isOnline.value || saveState.value === 'pending' || pendingCount.value > 0 || rejectedSaves.value.length > 0
)

// セッションの種類。'stock' = 棚卸（青） / 'order' = 発注確認（オレンジ）
const sessionMode = ref('stock')
// セッション種別に応じた主語（棚卸/発注）。UI文言・確認・トーストで共用。
const actNoun = computed(() => sessionMode.value === 'order' ? '発注' : '棚卸')

onMounted(async () => {
  initConnectivity()
  const params = new URLSearchParams(window.location.search)
  const roomCode   = params.get('room')
  const storeParam = params.get('store')
  const joinSid    = params.get('s')   // 招待リンクのセッションID（鍵）
  const joinType   = params.get('type') === 'order' ? 'order' : 'stock'

  // 公開Web削除申請（Play Console の Data deletion URL）。認証・ルーム・セッション復元より
  // 優先し、未ログインでもブラウザから削除申請できる専用ページを表示する。
  if (isDeleteAccountRoute(window.location.search)) {
    currentView.value = 'delete-account'
    return
  }

  if (roomCode) {
    const url = new URL(window.location.href)
    url.searchParams.delete('room'); url.searchParams.delete('s'); url.searchParams.delete('type')
    history.replaceState({}, '', url.pathname + (url.search !== '?' ? url.search : ''))
    _askNameAndJoin(roomCode, joinSid, joinType)
  } else if (storeParam) {
    // 店舗コード = ルームコード（統一済み）なので D1 経由不要で直接参加
    const url = new URL(window.location.href)
    url.searchParams.delete('store'); url.searchParams.delete('s'); url.searchParams.delete('type')
    history.replaceState({}, '', url.pathname + (url.search !== '?' ? url.search : ''))
    // セッションID付きリンク: ライブ中なら参加、完了後なら読み取り専用の結果ビューへ
    if (joinSid) _enterStoreLink(storeParam, joinSid, joinType)
    else         _askNameAndJoin(storeParam, joinSid, joinType)
  } else {
    const guestSession = getSavedGuestSession()
    if (guestSession) {
      // ゲスト参加中だったセッションを優先復帰（ホスト登録があっても関係なく戻す）
      discardSavedSession()
      const rejoinType = guestSession.roomType === 'order' ? 'order' : 'stock'
      sessionMode.value = rejoinType
      currentView.value = 'session'
      const rejoinCode = guestSession.roomCode
      const rejoinSid  = guestSession.sessionId ?? null
      if (deviceName.value) {
        joinRoom(rejoinCode, rejoinSid, rejoinType)
          .then(() => showToast(`ルーム ${rejoinCode} に再参加しました`, 3000, 'join'))
          .catch(() => {
            showToast(syncState.error || 'ルームへの参加に失敗しました', 5000, 'error')
            currentView.value = isAuthenticated.value ? 'sessions' : 'landing'
          })
      } else {
        _askNameAndJoin(rejoinCode, rejoinSid, rejoinType)
      }
    } else {
      // ゲストセッションなし: ホストセッションを自動復元
      restoreSession()

      // 認証済み: 進行中のセッションがあれば直接復帰、なければ一覧へ
      if (isAuthenticated.value) {
        if (!isCompleted.value) restorePendingSession()
        currentView.value = (pendingSession.value?.id && !isCompleted.value)
          ? 'session'
          : 'sessions'
        // リロード時もセッションの種類でテーマ（青=棚卸 / 橙=発注）を復元する
        sessionMode.value = pendingSession.value?.type === 'order' ? 'order' : 'stock'
        // 進行中セッションがあれば D1 から在庫を復旧（端末紛失・キャッシュ消去対策）
        if (pendingSession.value?.id && !isCompleted.value) {
          _restoreInventoryFromD1().catch(() => {})
          if (sessionMode.value === 'order') _loadOrderData().then(_restoreOrderDraft)
        }
      }
    }
  }

  // 既存の店舗コードがある場合は D1 からデータを読み込む
  if (shopCode.value) {
    try {
      await loadStore(shopCode.value)
      const [remoteConfig, remoteHistory] = await Promise.all([
        loadConfigFromD1(),
        loadHistoryFromD1(),
      ])
      if (remoteConfig?.order?.length && (!pendingSession.value?.id || config.isCustom)) {
        applyRemoteConfig(remoteConfig)
      }
      await _syncHistoryFromD1(remoteHistory)
    } catch (_) {
      // ネットワークエラーは無視してローカルデータで継続
    }
  }

  // 前回のアプリ終了時に残っていた未送信分を送り直す（DATA-002 Phase 2）。
  // バックフィルの後に置く: 履歴の差分送信で増えた分もまとめて片付く。
  resumePendingSaves()
})

// ── Android/PWAの戻るボタン制御 ──────────────────────────────────────────────
// 画面遷移ではなく「現在開いている最上位レイヤーを閉じる」動作にマップする。
// 起動時に sentinel を1つプッシュし、何かを閉じたら再プッシュして次の戻るも捕捉。
function _pushBackSentinel() {
  history.pushState({ pwaLayer: true }, '')
}

function _closeTopLayer() {
  if (showMenu.value)        { showMenu.value = false;      return true }
  if (memberHistoryTarget.value) { memberHistoryTarget.value = null; return true }
  if (confirmState.value)    { onCancelConfirm();           return true }
  if (candidateState.value)  { onCancelCandidate();         return true }
  if (chatNotif.value)       { chatNotif.value = null;      return true }
  if (showBarcode.value)      { showBarcode.value = false;      return true }
  if (showUpgrade.value)      { showUpgrade.value = false;      return true }
  if (showOnboarding.value)  { dismissOnboarding();         return true }
  if (showReview.value)      { dismissReview();             return true }
  if (showFeedback.value)    { showFeedback.value = false;  return true }
  if (showNameModal.value)   { showNameModal.value = false; return true }
  if (recountOpen.value)     { recountOpen.value = false; return true }
  if (conflictOpen.value)    { conflictOpen.value = false; return true }
  if (showChat.value)        { showChat.value = false;    return true }
  if (showSync.value)        { showSync.value = false;    return true }
  if (showAxisAssign.value)  { showAxisAssign.value = false;  return true }
  if (showOrderSchedule.value) { showOrderSchedule.value = false; return true }
  if (consumeDeleteAccountBack()) return true
  if (showDeleteAccount.value) { showDeleteAccount.value = false; return true }
  if (settingsSection.value) { settingsSection.value = null;  return true }
  if (currentView.value === 'master') { currentView.value = 'sessions'; return true }
  if (currentView.value === 'movement') { currentView.value = 'sessions'; return true }
  if (dashboardOpen.value)   { dashboardOpen.value = false; return true }
  if (ordersOpen.value)      { ordersOpen.value = false;    return true }
  if (currentView.value === 'session-detail') { currentView.value = 'sessions'; return true }
  if (currentView.value === 'guest-result') { currentView.value = isAuthenticated.value ? 'sessions' : 'landing'; return true }
  if (currentView.value === 'auth')    { currentView.value = 'landing'; return true }
  if (currentView.value === 'session') { onGoHome();                    return true }
  if (currentView.value === 'sessions') { currentView.value = 'landing'; return true }
  return false
}

// アカウント削除の完了（DeleteAccountModal が既に token/ローカルデータを破棄済み）。
// ログイン状態は解除されているため、ランディングへ戻す。
function onAccountDeleted() {
  showDeleteAccount.value = false
  currentView.value = 'landing'
}

function _onBrowserBack() {
  const closed = _closeTopLayer()
  if (closed) _pushBackSentinel()
}

onMounted(() => { _pushBackSentinel(); window.addEventListener('popstate', _onBrowserBack) })
onUnmounted(() => {
  window.removeEventListener('popstate', _onBrowserBack)
  clearTimeout(_dissolvedTimer)
  _dissolvedTimer = null
})

// ── Modal state ────────────────────────────────────────────────────────────────
const confirmState      = ref(null) // { ingredient, qty, unit, unitLocked, source, lotSize }
const candidateState    = ref(null) // { candidates, qty, unit }
const pendingCandidates = ref(null) // { matched, searchTerm, qty, unit } — 候補リスト残り

// モーダルが開いている間も inventory のライブ値を参照（リモート更新を即時反映）
const confirmExisting = computed(() =>
  confirmState.value ? (inventory[confirmState.value.ingredient] ?? null) : null
)

// ── Transcript / テキスト検索 ──────────────────────────────────────────────────
const searchText     = ref('')
const searchStatus   = ref('') // '' | 'active'
const searchInputRef = ref(null)

// ── ゲスト担当完了の報告済み状態 ──────────────────────────────────────────────
// 報告後は入力ロック状態になる。棚卸再開で解除される。
const guestReported = ref(false)
watch(syncActive, (v) => { if (!v) guestReported.value = false })

// ゲストが棚卸完了を報告している間は入力を完全ロック
const guestLocked = computed(() => syncActive.value && !syncIsHost.value && guestReported.value)
// 完了中・結果不明中も入力を止める。組み立て済みの完了要求は固定されているので、
// ここで編集できると「画面の内容」と「サーバーへ送る（送った）内容」がずれる
// （再送は同じ body でしか通らない＝編集分は保存されない）。
const inputLocked = computed(() => isCompleted.value || guestLocked.value || completionBusy.value)

// ── セッション単位の在庫下書き保存（セッション切り替え時のデータ消失防止）────────
const _DRAFT_PREFIX = 'inv_draft_'
const _ORDER_DRAFT_PREFIX = 'order_draft_'

// 発注下書きを localStorage から復元（発注セッション再開時）
function _restoreOrderDraft() {
  try {
    const raw = localStorage.getItem(_ORDER_DRAFT_PREFIX + _orderId())
    orderDraft.value = raw ? (JSON.parse(raw) || {}) : {}
  } catch (_) { orderDraft.value = {} }
}

function _saveDraft(sessionId) {
  if (!sessionId || Object.keys(inventory).length === 0) return
  try {
    localStorage.setItem(_DRAFT_PREFIX + sessionId, JSON.stringify({
      inv:      { ...inventory },
      activeMs: activeTimer.activeMs.value,
    }))
  } catch (_) {}
}

function _restoreDraft(sessionId) {
  if (!sessionId) return
  try {
    const raw = localStorage.getItem(_DRAFT_PREFIX + sessionId)
    if (!raw) return
    const saved = JSON.parse(raw)
    // 新形式 { inv, activeMs } と旧形式（フラットな inventory）の両対応
    const inv = saved.inv ?? saved
    if (typeof saved.activeMs === 'number') activeTimer.resume(saved.activeMs)
    for (const [ingredient, entry] of Object.entries(inv)) {
      if (!entry || typeof entry.qty === 'undefined') continue
      applyRemoteUpdate(ingredient, entry.qty, entry.unit ?? '', entry.enteredBy ?? '', entry.updatedAt)
    }
  } catch (_) {}
}

function _clearDraft(sessionId) {
  if (!sessionId) return
  try { localStorage.removeItem(_DRAFT_PREFIX + sessionId) } catch (_) {}
}

// セッション削除時は対応するスナップショット（分析データ）も削除する。
// 残しておくと在庫分析の対象として選べてしまうため、履歴からも消す。
function onDeleteSession(sessionId) {
  // 完了要求の対象を、結果が出る前に破棄させない
  if (sessionId && sessionId === pendingSession.value?.id && _blockedByCompletion()) return
  _clearDraft(sessionId)
  if (!sessionId) return
  // sessionId をキーに消す。日付で消すと同じ日の別セッションまで巻き込む（F-001）。
  const snap = getSnapshotBySessionId(sessionId)
  if (snap) {
    deleteSnapshotLocal(sessionId)
    deleteSnapshotFromD1(sessionId).catch(() => {})
  }
}

// 入力中の品目数を D1 に保存（active）。直列化・確定後の無視は useSession が担当
let _draftSaveTimer = null
watch(filledCount, (count) => {
  if (currentView.value !== 'session' || isCompleted.value) return
  touchSession(count)
  // 在庫変更のたびに下書きをローカル保存（ブラウザクラッシュ時の保護）
  clearTimeout(_draftSaveTimer)
  _draftSaveTimer = setTimeout(() => {
    if (pendingSession.value?.id) _saveDraft(pendingSession.value.id)
  }, 2000)
})

// ── 進行中在庫の D1 永続化（端末紛失・キャッシュ消去からの復旧用）─────────────────
// デバウンス保存。同期中はホストのみ書き込み（競合回避）、ソロは本人が書き込む。
// 数量編集（品目数が変わらない更新）も捕捉するため inventory/recountFlags を deep watch。
let _invD1Timer    = null
let _invD1LastSave = 0
function _inventoryPayload() {
  return {
    inventory:    { ...inventory },
    recountFlags: { ...recountFlags },
    sessionId:    pendingSession.value?.id ?? null,
    savedAt:      Date.now(),
  }
}
function _flushInventoryToD1() {
  _invD1Timer    = null
  _invD1LastSave = Date.now()
  saveInventoryToD1(_inventoryPayload())
}
function _persistInventoryToD1() {
  if (!shopCode.value || isCompleted.value) return
  if (currentView.value !== 'session') return
  if (syncActive.value && !syncIsHost.value) return
  clearTimeout(_invD1Timer)
  // 連続入力で3秒デバウンスが永遠にリセットされても、最大30秒で必ず保存
  if (Date.now() - _invD1LastSave > 30000) { _flushInventoryToD1(); return }
  _invD1Timer = setTimeout(_flushInventoryToD1, 3000)
}
watch([inventory, recountFlags], _persistInventoryToD1, { deep: true })

/**
 * 認証失効の瞬間に、まだ送っていないデバウンス中の変更を未送信キューへ確定する
 * （第2セッション §6）。
 *
 * 失効ハンドラは shopCode と token を消す。デバウンスの timer はそのまま残っており、
 * 発火しても `_save` が「店舗未設定」で何も送らずに捨てていた。数十秒ぶんの入力と
 * 品目リストの変更が、キューにも端末にも残らないまま消える経路だった。
 *
 * 無効なトークンで送らず、**送信せずにキューへ入れるだけ**にする。同じ店舗へ
 * 再ログインしたときの drain が改めて送る。
 */
function _flushDebouncedSavesToQueue(code) {
  if (!code) return
  if (_configSaveTimer) {
    clearTimeout(_configSaveTimer)
    _configSaveTimer = null
    queuePendingSave('config', _configPayload(), { shopCode: code })
  }
  if (_invD1Timer) {
    clearTimeout(_invD1Timer)
    _invD1Timer = null
    queuePendingSave('inventory', _inventoryPayload(), { shopCode: code })
  }
}

// 起動・セッション再開時に D1 から進行中在庫を復旧（ローカルが空 or D1 が新しい場合のみ）
async function _restoreInventoryFromD1() {
  if (!shopCode.value || isCompleted.value) return
  const remote = await loadInventoryFromD1()
  if (!remote?.inventory) return
  // 別セッションのデータは無視（新規セッション開始後に旧データを読み込まない）
  if (remote.sessionId && pendingSession.value?.id && remote.sessionId !== pendingSession.value.id) return
  const localNewest = Object.values(inventory).reduce((m, e) => Math.max(m, e.updatedAt ?? 0), 0)
  if (Object.keys(inventory).length === 0 || (remote.savedAt ?? 0) > localNewest) {
    applyPersistedInventory(remote.inventory, remote.recountFlags)
  }
}

// ── セッション管理 ─────────────────────────────────────────────────────────────
const completedAtDisplay = computed(() => {
  if (!completedAt.value) return ''
  const d = new Date(completedAt.value)
  return d.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
})

async function onComplete() {
  // 練習モード: 履歴に残さず終了
  if (practiceMode.value) {
    if (!confirm('練習を終了しますか？\n（結果は履歴に保存されません）')) return
    if (continuousMode.value) onForceStop()
    _exitPractice()
    showToast('練習を終了しました', 3000, 'success')
    currentView.value = isAuthenticated.value ? 'sessions' : 'landing'
    return
  }

  // 完了に必要な件数: 発注モードは「発注数」の件数、棚卸は在庫入力件数。
  // 発注では在庫入力は任意なので、在庫0でも発注数が1件以上あれば完了できる。
  const isOrderMode = sessionMode.value === 'order'
  const completionCount = isOrderMode ? Object.keys(orderDraft.value).length : filledCount.value
  if (completionCount === 0) {
    showToast(isOrderMode ? '発注数を1件以上入力してから完了してください' : '1件以上入力してから完了してください', 2600, 'warning')
    return
  }

  // ゲスト（ルーム参加中）: 完了報告のみ。画面ロック・スナップショット保存は行わない
  if (syncActive.value && !syncIsHost.value) {
    if (!confirm('担当分の入力完了をホストに報告しますか？\n報告後も再開できます。')) return
    broadcastDone()
    guestReported.value = true
    if (continuousMode.value) onForceStop()
    showToast('入力完了をホストに報告しました ✓', 3000, 'success')
    return
  }

  // ホスト or ソロ: 棚卸を締める
  const isHostInRoom = syncActive.value && syncIsHost.value
  const confirmMsg = isHostInRoom
    ? `${actNoun.value}を完了しますか？\nゲストへ完了通知を送り、ルームを閉鎖します。`
    : `${actNoun.value}を完了しますか？\n完了後は読み取り専用になります。`
  if (!confirm(confirmMsg)) return

  // 完了要求そのものは useSession が1本に束ねるが、後片付け（解散・draft削除・遷移）は
  // ここにしかない。合流した2本目が同じ後片付けを走らせないよう、入口でも締める。
  if (_finishing) return
  _finishing = true
  try {
    await _finishSession(completionCount, isHostInRoom)
  } finally {
    _finishing = false
  }
}
let _finishing = false

/**
 * 完了要求の組み立て（本番の完了経路はすべてここを通る・第2セッション §2）。
 *
 * 種別ごとの契約は services/sessionCompletion.js に置き、組み立てられない場合は
 * API を呼ばずに理由を返す。発注セッションへ架空の snapshot を付けない。
 *
 * **結果不明のあいだは同じ body を保持して再送する（第2セッション §7）。**
 * server は canonical snapshot 全体から fingerprint を作り、内容が違う再送を
 * `409 completion_intent_conflict` で拒否する。応答を取りこぼした要求がサーバー側で
 * 確定していた場合、組み立て直した body（`auditLog` が1件増えているだけでも）では
 * 二度と確定できない。サーバーが受け付けていないと断定できた失敗のときだけ捨て、
 * 最新の入力で作り直す。
 */
function _buildCompletionRequest() {
  const sessionId = pendingSession.value?.id ?? null
  // 結果不明のまま残っている要求があれば、それをそのまま使う。
  // useSession が端末へ永続化しているので、**再読込をまたいでも同じ body で再送できる**。
  const kept = pendingCompletionIntent()
  if (kept) return kept

  const type = pendingSession.value?.type ?? sessionMode.value
  // 端末へは書かない。完了APIと同じ要求で送るためだけの組み立て（DATA-001 / 第2セッション）。
  // 発注セッションでは snapshot 自体を作らない（送れないので作る意味が無い）。
  const snapshot = type === 'order' ? null
    : buildSnapshot(inventory, config.prices, config.order, config.codes, entryLog, auditLog, recountFlags, config.categories, sessionId, activeTimer.elapsedMs(), config.lotSizes, config.prevMonths, config.tagsA, config.tagsB, config.axisNames)

  const request = buildCompletionRequest({
    sessionType: type,
    snapshot,
    inventory,
    prices:     config.prices ?? {},
    orderCount: Object.keys(orderDraft.value).length,
  })
  return request
}

/**
 * 棚卸／発注を締める本体（ホスト・ソロ共通）。
 *
 * **サーバーが完了を受け付けるまで、端末側の状態を一切変えない。**
 * 以前は completeSession()（＝読み取り専用マーク）と saveSnapshot()（＝履歴への
 * 書き込み）を完了APIより先に実行していた。そのため
 *
 *   - 通信中にタブを閉じると、端末は「完了済み」で復帰し、進行中セッションが
 *     復元されない＝同じ棚卸を完了し直す導線が消える
 *   - サーバーには active なセッションしか無いのに、端末には完了履歴が残る
 *   - その履歴をバックフィルが送り、一覧と詳細が食い違う
 *
 * という消失経路ができていた。送信用スナップショットはメモリ上で組み立て、
 * サーバー成功後に commitSnapshot() で端末へ確定する。
 *
 * 二重押し・ホーム・session_ended が重なっても、完了要求は useSession 側で
 * 1本に束ねられる（同じ sessionId・同じ内容で冪等に再試行できる）。
 */
async function _finishSession(completionCount, isHostInRoom) {
  const completedId = pendingSession.value?.id

  const req = _buildCompletionRequest()
  if (!req.ok) {
    // 通らないと分かっている要求はサーバーへ投げない。理由をそのまま伝える。
    console.error('[App] completion payload unavailable:', req.reason)
    showToast(completionErrorMessage(req.reason), 6000, 'error')
    return
  }
  // stock はサーバーが sessions・inventory_lines・store_history を1トランザクションで書く。
  // 成功条件には snapshotSaved を含める（useSession）。明細が入らない完了は完了ではない。
  // order は sessions だけを更新し、明細の正本は orders / order_lines に残る。
  const completed = await completeSessionD1(req)
  // 応答が返るまでにアカウント・セッションが切り替わっていた。旧アカウントの結果で
  // いまの履歴を確定したり、いまの draft・セッションを消したりしない（useSession が検出）。
  if (completed?.stale) return
  if (!completed?.ok) {
    // 入力値・draft・pendingSession・ルーム・参加者はすべて保持したまま。
    // 読み取り専用にもしていないので、同じ画面の同じボタンからそのまま再試行できる。
    _warnCompleteUnsaved(completed)
    return
  }

  // ── ここから下は完了が成立した場合だけ ──
  completeSession()                              // 端末を読み取り専用へ
  // 履歴へ確定（サーバー確認済みとして）。order は store_history を持たない。
  if (req.type === COMPLETION_STOCK) commitSnapshot(req.snapshot, completed.result)

  // 前回までの棚卸を恒久ロック（新しい方を後で削除してもロックは外れない）。
  // 完了が成立した後なので、失敗しても今回の記録は失われない。
  for (const prev of lockOtherSnapshots(completedId)) _pushSnapshot(prev)

  if (continuousMode.value) onForceStop()

  if (isHostInRoom) {
    broadcastSessionEnd('completed')
    _hostInitiatedDissolve = true
    // ルーム解散も await をまたぐ。ここで待っている間にアカウント・セッションが
    // 変わると、以降の後片付け（draft削除・intent破棄・clearSession・遷移）が
    // **現在のセッション**に対して走る。
    //
    // 同期側は「解散できたか」を返す。接続が張り替わって解散を中止した場合、
    // 旧ルーム前提の後片付けを続けると、いま使っているセッション・intent・draft を消す。
    // セッション世代と接続世代の両方を確認する。
    const beforeDissolve = captureLifecycle()
    const beforeConnection = captureSyncConnection()
    const dissolved = await dissolveRoom()
    if (dissolved?.ok === false || isLifecycleStale(beforeDissolve) || isSyncConnectionStale(beforeConnection)) {
      console.warn('[App] session or connection changed while dissolving the room; skipping cleanup:', completedId)
      return
    }
  } else {
    track('session_completed', { item_count: completionCount, mode: 'solo' })
    _checkReviewPrompt()
  }

  _clearDraft(completedId)
  // **端末側の確定がすべて終わってから**、保存してある完了要求を捨てる（再レビュー §1）。
  // API 成功だけで消すと、履歴 commit の前に端末が落ちたときに送った内容を復元できない。
  ackCompletionFinalized(completedId)
  clearSession()
  showToast(`${actNoun.value}を完了しました ✓`, 3000, 'success')
  sessionsTab.value  = 'dashboard'
  _setNewSession(completedId)
  currentView.value  = 'sessions'
}


// 完了をサーバーへ書けなかったときの通知（DATA-001）。
// 明細・完了状態・スナップショットは1トランザクションなので、拒否された＝サーバー側には
// 何も入っていない。端末側の入力・下書き・セッションはそのまま残っており、
// 同じ画面の同じボタンから同じ内容で再試行できる。
//
// 応答が返らなかった場合（result 不明）は「入っていない」と断定できない。
// この状態では active も書かないので、案内は再送またはサーバー状態の確認へ寄せる。
function _warnCompleteUnsaved(result = null) {
  // 別内容で既に確定済み（409 completion_intent_conflict）。再試行では解消せず、
  // サーバーの記録は無傷。この session へ後からの変更を足す手段は無い。
  if (result?.conflict) {
    showToast(
      `この${actNoun.value}はサーバー上で別の内容として確定済みです。確定後にこの端末で変えた内容は保存できません。一覧から確定済みの内容を確認してください`,
      9000, 'error',
    )
    return
  }
  // 端末へ再送用データを保存できず、**そもそも送信していない**。
  // サーバー起因のように読める文言だと、ユーザーは通信を疑って同じ操作を繰り返す。
  if (result?.reason === 'intent_not_persisted') {
    showToast(
      `この端末に再送用のデータを保存できないため、${actNoun.value}を送信していません。入力内容はこの端末に残っています。ブラウザの空き容量を空けてからもう一度お試しください`,
      9000, 'error',
    )
    return
  }
  const msg = result?.unknown
    ? `${actNoun.value}の完了結果を確認できませんでした。入力内容はこの端末に残っています。接続が戻ってからもう一度「完了」を押すと、送信時と同じ内容で確定できます（それ以降の変更は含まれません）`
    : 'サーバーへ完了を記録できませんでした。入力内容はこの端末に残っています。接続が戻ってからもう一度完了してください'
  showToast(msg, 8000, 'error')
}

/**
 * 完了処理が競合する操作（ホーム・戻る・セッション切替・破棄）を止める。
 * @returns {boolean} true = 進行中なので呼び出し側は処理を中断する
 */
function _blockedByCompletion() {
  if (completing.value) {
    showToast(`${actNoun.value}の完了処理中です。結果が出るまでお待ちください`, 3000, 'warning')
    return true
  }
  if (completionUnknown.value) {
    showToast(`${actNoun.value}の完了結果が未確定です。もう一度「完了」を押して確定してください`, 4000, 'warning')
    return true
  }
  return false
}


function onUndone() {
  broadcastUndone()
  guestReported.value = false
  showToast('棚卸を再開しました', 2500, 'default')
}

// メイン画面のホームアイコン → セッション一覧へ戻る
async function onGoHome() {
  // 練習モード: 保存せず破棄して戻る
  if (practiceMode.value) {
    if (filledCount.value > 0 && !confirm('練習を終了して一覧に戻りますか？\n（結果は保存されません）')) return
    if (continuousMode.value) onForceStop()
    _exitPractice()
    clearSession()
    currentView.value = isAuthenticated.value ? 'sessions' : 'landing'
    sessionMode.value = 'stock'
    return
  }

  // 完了要求が走っている間は画面を離れない。以前はここで isCompleted がまだ false のため
  // markSessionActive() が走り、直後に確定するサーバー側の completed を active へ
  // 巻き戻していた（明細と履歴はあるのに進行中に見えるセッションができる）。
  if (completing.value) {
    showToast(`${actNoun.value}の完了処理中です。結果が出るまでお待ちください`, 3000, 'warning')
    return
  }
  // 結果不明: active は書かず、まずサーバーの状態を確認してから同じ完了要求を送り直す。
  if (completionUnknown.value) {
    await _resolveUnknownCompletion()
    return
  }

  const hasData = filledCount.value > 0

  // ホスト中のみ確認（ホストは退出するがルームは残り、ゲストは継続できる）
  if (!isCompleted.value && syncIsHost.value && syncActive.value) {
    if (!confirm('セッション一覧に戻ります。\nゲストはそのまま棚卸を続けられます。\nよろしいですか？')) return
  }

  // ホストでも解散せず退出するだけ（ルームは残りゲストは継続できる）
  if (syncActive.value) leaveRoom()

  // 状態を書き込んでから遷移（完了は completed、未完了は進行中=active のまま品目数を確定保存）
  const completedId = pendingSession.value?.id
  if (isCompleted.value) {
    // 完了済みセッションを離れる経路でも、サーバーへ書けなければ画面を離れない。
    // ここで抜けると draft と session 参照が消え、完了を記録し直す手段が無くなる。
    // 完了ボタンの要求が走っている最中なら、useSession がそれへ合流させる（要求は1本）。
    //
    // 送るのは完了ボタンと同じ helper の payload（第2セッション §2）。
    // 以前はここだけ snapshot 無しで呼んでおり、現行 Worker では 400 になる。
    const req = _buildCompletionRequest()
    if (!req.ok) {
      console.error('[App] completion payload unavailable (go home):', req.reason)
      showToast(completionErrorMessage(req.reason), 6000, 'error')
      return
    }
    const completed = await completeSessionD1(req)
    if (completed?.stale) return
    if (!completed?.ok) {
      // reopenSession() は呼ばない。完了済みを端末側で「進行中」へ戻すと、
      // 次のホームで active がサーバーへ飛び、確定済みの completed を巻き戻す。
      _warnCompleteUnsaved(completed)
      // 別内容で確定済み（409）なら、この画面から確定し直す手段は無い。
      // サーバーの記録を正として離脱させる（次の履歴取得で正しい内容が入る）。
      if (!completed?.conflict) return
      // 409 のときは useSession が保持していた要求を捨てている（再送しても解消しない）
    } else {
      if (req.type === COMPLETION_STOCK) commitSnapshot(req.snapshot, completed.result)
      ackCompletionFinalized(completedId)
    }
  } else {
    _saveDraft(pendingSession.value?.id)
    const marked = await markSessionActive(filledCount.value)
    // 応答を待つ間にアカウント・セッションが切り替わった。いまの画面を閉じない
    // （旧店舗の結果で現在のセッションを clear すると入力が行き場を失う）。
    if (marked?.stale) return
  }

  if (continuousMode.value) onForceStop()
  clearSession()
  showSync.value = false
  showChat.value = false
  currentView.value = 'sessions'
  sessionMode.value = 'stock'   // 画面遷移後にテーマを戻す（発注→ホームで一瞬青くなるのを防ぐ）
}

/**
 * 完了結果が不明なまま離脱しようとしたときの収束処理（第2セッション §1）。
 *
 * 1. サーバーの状態を読み直す。まだ active なら、同じ完了要求をそのまま送り直す
 *    （sessionId も内容も同じなのでサーバー側は冪等）。
 * 2. 既に completed なら、端末側の確定（読み取り専用・履歴・後片付け）を進める。
 * 3. どちらも確認できなければ、active を書かずに画面へ留まる。
 */
async function _resolveUnknownCompletion() {
  if (_finishing) return
  _finishing = true
  try {
    const before = pendingSession.value?.id
    const state = await verifyCompletion()
    // 確認中にアカウント・セッションが切り替わった。いまの画面へは何も適用しない
    if (state.stale || pendingSession.value?.id !== before) return
    if (!state.ok) {
      showToast(`${actNoun.value}の完了結果を確認できませんでした。接続が戻ってからもう一度「完了」を押してください`, 6000, 'warning')
      return
    }
    // active でも completed でも、**保存してある同じ body** を送り直せば端末とサーバーが揃う
    // （server は同じ intent の再送を replay として受ける）。現在の在庫からは作り直さない。
    await _finishSession(filledCount.value, syncActive.value && syncIsHost.value)
  } finally {
    _finishing = false
  }
}

// 完了後に新規棚卸を開始
async function onStartNew() {
  if (_blockedByCompletion()) return
  // ホスト中はルームを解散してから開始（ゲストと在庫が乖離するのを防ぐ）
  if (syncIsHost.value && syncActive.value) {
    if (!confirm('新規棚卸を開始するにはルームを解散します。よろしいですか？')) return
    _hostInitiatedDissolve = true
    const origin     = captureLifecycle()
    const connection = captureSyncConnection()
    const dissolved  = await dissolveRoom()
    // 解散が中止された／待機中に切り替わったなら、reset() で現在の在庫を消さない
    if (dissolved?.ok === false || isLifecycleStale(origin) || isSyncConnectionStale(connection)) {
      console.warn('[App] session or connection changed while dissolving; not starting a new session')
      return
    }
  }
  reset()
  clearAuditLog()
  if (continuousMode.value) onForceStop()
}

// SyncModal からの新規セッション開始（在庫をDOへ送信）
// ホストがルーム作成前に入力した在庫はそのまま引き継ぐ（joined ハンドラでスキップ済み）
function onSyncNewSession({ sessionId }) {
  broadcastSessionStart(sessionId)
}


// ── セッション経過タイマー ──────────────────────────────────────────────────────
const sessionNow = ref(Date.now())
let _sessionTimer = null
watch(() => currentView.value, (v) => {
  clearInterval(_sessionTimer)
  if (v === 'session') _sessionTimer = setInterval(() => { sessionNow.value = Date.now() }, 15_000)
}, { immediate: true })
onUnmounted(() => clearInterval(_sessionTimer))

// 稼働時間（アイドル除外）と一時停止状態
const _activeState = computed(() =>
  computeActive(
    { activeMs: activeTimer.activeMs.value, lastActivityAt: activeTimer.lastActivityAt.value },
    sessionNow.value,
  )
)
const sessionPaused = computed(() =>
  currentView.value === 'session' && !isCompleted.value && !!activeTimer.lastActivityAt.value && _activeState.value.paused
)

const sessionElapsed = computed(() => {
  if (currentView.value !== 'session' || isCompleted.value || !activeTimer.lastActivityAt.value) return null
  const min = Math.floor(_activeState.value.elapsedMs / 60000)
  if (min < 1) return null
  if (min < 60) return `${min}分`
  const h = Math.floor(min / 60), m = min % 60
  return m > 0 ? `${h}時間${m}分` : `${h}時間`
})

// ── Toast ──────────────────────────────────────────────────────────────────────
// type: 'default' | 'success' | 'error' | 'warning' | 'join' | 'leave' | 'update'
const toastMsg  = ref('')
const toastType = ref('default')
const toastShow = ref(false)
let   toastTimer = null

function showToast(msg, duration = 2600, type = 'default') {
  clearTimeout(toastTimer)
  toastMsg.value  = msg
  toastType.value = type
  toastShow.value = true
  toastTimer = setTimeout(() => (toastShow.value = false), duration)
}

// ── チャットモーダル ───────────────────────────────────────────────────────────
const showChat = ref(false)
watch(showChat, (val) => { if (val) markMessagesRead() })

// ゲストのモーダルが開いている最中に競合ロックが届いたら自動で閉じる
watch(
  () => !syncIsHost.value && confirmState.value ? lockedIngredients.has(confirmState.value.ingredient) : false,
  (isLocked) => {
    if (isLocked && confirmState.value) {
      const ing = confirmState.value.ingredient
      onCancelConfirm()
      showToast(`「${ing}」で競合が発生しました。ホストが解決します`, 3000, 'warning')
    }
  }
)

// ── LINE風チャット通知バナー（上部フェードイン）────────────────────────────────
const chatNotif = ref(null)  // { text, senderName }
let chatNotifTimer = null
function showChatNotif(text, senderName = '') {
  clearTimeout(chatNotifTimer)
  chatNotif.value = { text, senderName }
  chatNotifTimer  = setTimeout(() => { chatNotif.value = null }, 3500)
}

// 競合チャット投稿: ホストのみ・同一品目5秒以内は重複投稿しない
const _conflictPostedAt = new Map()
function _postConflictToChat(ingredient) {
  if (!syncIsHost.value) return
  const last = _conflictPostedAt.get(ingredient) ?? 0
  if (Date.now() - last < 5000) return
  _conflictPostedAt.set(ingredient, Date.now())
  broadcastMessage(`⚡ 「${ingredient}」で同時入力が発生しました`)
}

// ── 複数人編集品目（同期中のみ）──────────────────────────────────────────────
const conflictOpen = ref(false)
const conflictItems = computed(() => {
  if (!syncActive.value || auditLog.length === 0) return []
  const byIngredient = new Map()
  for (const entry of auditLog) {
    // フラグ操作は数量編集ではないため複数人編集判定から除外
    if (entry.action === 'flag_recount' || entry.action === 'unflag_recount') continue
    if (!byIngredient.has(entry.ingredient)) {
      byIngredient.set(entry.ingredient, { entries: [], editors: new Set() })
    }
    const g = byIngredient.get(entry.ingredient)
    g.entries.push(entry)
    if (entry.enteredBy) g.editors.add(entry.enteredBy)
  }
  const result = []
  for (const [ingredient, { entries, editors }] of byIngredient) {
    if (editors.size >= 2) {
      result.push({ ingredient, editors: [...editors], recentQty: entries[entries.length - 1]?.totalQty, recentUnit: entries[entries.length - 1]?.unit })
    }
  }
  return result
})

// ── ホスト: 品目リスト変更をルーム全員に同期（debounce 300ms）─────────────────
let _configBroadcastTimer = null
watch(config, () => {
  if (!syncIsHost.value || !syncActive.value) return
  clearTimeout(_configBroadcastTimer)
  _configBroadcastTimer = setTimeout(() => {
    broadcastConfig(_configPayload())
  }, 300)
}, { deep: true })

// ── ルームコード変更を D1 に反映（ルーム作成・解散の追跡）──────────────────────
watch(() => syncState.roomCode, (code) => {
  if (shopCode.value) updateActiveRoomInD1(code ?? null)
})

// ── Dictionary matching（実体は utils/itemMatcher.js・テスト付き）──────────────
function findCandidates(name) {
  return matcherFind(name, {
    dictionary: dictionary.value,
    order:      config.order,
    categories: config.categories,
    masterDict,
  })
}

// ── 検索共通処理（音声・テキスト兼用）────────────────────────────────────────
function runSearch(raw) {
  const { name, qty, unit } = parseText(raw)

  // 商品コード完全一致: parseText は数字を qty に抜き取るため
  // "A001" → name="A" のように壊れる。raw をそのまま照合する
  const rawTrimmed = raw.trim()
  if (rawTrimmed && config.codes) {
    for (const [item, code] of Object.entries(config.codes)) {
      if (code && code.trim() === rawTrimmed) {
        openConfirm(item, null, config.units?.[item] || '', 'search')
        return
      }
    }
  }

  const matched = name ? findCandidates(name) : []
  // 候補ゼロ = 新規とみなし、その場で登録 → 数量モーダル（歩きながら積み上げ登録）
  if (name && matched.length === 0) {
    _walkRegister(name, qty, unit)
    return
  }
  candidateState.value = { searchTerm: name ?? raw, matched, qty, unit }
}

// 積み上げ登録: 新しい品目名を登録し、そのまま数量・単位モーダルへ。
// 既存ならそのまま数量モーダル。ゲストはホスト承認、Free 上限も考慮。
function _walkRegister(name, qty = null, unit = '') {
  const n = (name ?? '').trim()
  if (!n) return

  if (config.order.includes(n)) {
    openConfirm(n, qty, unit || config.units?.[n] || '', 'search')
    return
  }
  if (!canAddItem(config.order.length)) {
    openUpgrade(`無料プランの上限（${FREE_ITEM_LIMIT}品目）に達しました。上限の緩和は将来提供予定です。`)
    return
  }
  // ゲスト: 品目追加はホスト承認が必要
  if (syncActive.value && !syncIsHost.value) {
    if (pendingGuestRequest.value) {
      showToast('前の申請がホストの承認待ちです。しばらくお待ちください。', 3000, 'warning')
      return
    }
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
    pendingGuestRequest.value = { requestId, name: n }
    broadcastItemAddRequest(n, unit || '', '', requestId)
    showToast(`「${n}」の追加をホストに申請しました`, 3000, 'info')
    searchText.value = ''
    nextTick(() => searchInputRef.value?.focus())
    return
  }
  // ホスト/ソロ: まだ登録しない。数量モーダルを「新規登録」モードで開き、
  // 「新規登録」ボタンが押されたときだけ登録する（部分一致のつもりの誤登録を防ぐ）
  openConfirm(n, qty, unit || '', 'search', { isNew: true })
}

// CandidateModal から「新規登録」を選んだとき
function onCandidateCreate() {
  const c = candidateState.value
  if (!c) return
  candidateState.value = null
  pendingCandidates.value = null
  _walkRegister(c.searchTerm, c.qty, c.unit)
}

// ── タップ連続入力（品目タップで確定→自動で次の品目を開く。音声/文字検索は対象外）──
const tapContinuous = ref(localStorage.getItem('inv_tap_continuous') === '1')
watch(tapContinuous, v => {
  try { localStorage.setItem('inv_tap_continuous', v ? '1' : '0') } catch (_) {}
})

// ── Voice（連続入力がデフォルト動作）─────────────────────────────────────────
const continuousMode = ref(false)

function onVoiceResult(raw) {
  searchText.value   = raw
  searchStatus.value = ''
  track('voice_used')
  runSearch(raw)
}

const { isListening, liveText, start: startVoice, stop: stopVoice } = useVoice(onVoiceResult)

watch(liveText, v => {
  if (isListening.value) {
    searchText.value   = v
    searchStatus.value = 'active'
  }
})

/** ボタンタップの挙動（タップ・トゥ・トーク＝一言だけの短時間バースト）:
 *  - 認識中  → 即停止
 *  - 停止中  → 1回だけ認識開始（約2秒で自動終了。常時オンにはしない）
 */
function onVoiceButtonTap() {
  if (isListening.value) stopVoice()
  else startVoice()
}

/** バナーの停止ボタン用（どの状態でも即停止） */
function onForceStop() {
  continuousMode.value = false
  stopVoice()
}

/** 確定 or キャンセル後に自動で次の音声認識を開始 */
function _restartIfContinuous() {
  if (!continuousMode.value) return
  setTimeout(() => {
    if (continuousMode.value && !isListening.value) startVoice()
  }, 400)
}

// ── テキスト検索 ───────────────────────────────────────────────────────────────
function onSearchFocus() {
  searchStatus.value = ''
  // 「話してください…」が残っている場合はフォーカス時に消す
  if (searchText.value === '話してください…') searchText.value = ''
  // テキスト入力に切り替えたら音声を止める（continuousMode は維持し次の確定後に再開）
  if (isListening.value) stopVoice()
}

function onTextSearch() {
  const raw = searchText.value.trim()
  if (!raw) return
  searchStatus.value = ''
  runSearch(raw)
}

// ── Confirm modal ──────────────────────────────────────────────────────────────
// source: 'search'（テキスト/音声）| 'table'（棚卸表タップ）
function openConfirm(ingredient, qty, unit, source = 'search', opts = {}) {
  // TR行がfocusを持ったままだとEnterキーがTRの@keydownとModalのhandleKeydown
  // 両方に発火し、確定と同時に openConfirm(A) が再度呼ばれるバグを防ぐ
  document.activeElement?.blur()
  // 数値入力モーダル中は音声認識を止める（確定/キャンセル後に _restartIfContinuous が再開する）
  if (isListening.value) stopVoice()

  if (syncActive.value && typingMap[ingredient]) {
    const who = typingMap[ingredient].name || '他のメンバー'
    showToast(`「${ingredient}」は${who}が入力中です`, 2500, 'warning')
    return
  }
  if (conflictQueue.value.some(c => c.ingredient === ingredient) || lockedIngredients.has(ingredient)) {
    showToast(`「${ingredient}」の競合を先に解決してください`, 2500, 'warning')
    return
  }

  // PDF登録済みの単位・ジャンルを優先し、ロック状態にする
  const configUnit     = config.units?.[ingredient]
  const configCategory = config.categories?.[ingredient]
  const isOrder = sessionMode.value === 'order'
  const draft   = orderDraft.value[ingredient]
  confirmState.value = {
    ingredient,
    qty:            isOrder ? (draft?.stock ?? qty ?? inventory[ingredient]?.qty ?? null) : qty,
    unit:           configUnit || unit || '',
    unitLocked:     !!configUnit,
    category:       configCategory || '',
    categoryLocked: !!configCategory,
    source,
    lotSize:        config.lotSizes?.[ingredient] ?? '',
    isNew:          !!opts.isNew,
    orderMode:      isOrder,
    orderLot:       isOrder ? effectiveLot(config.lotSizes?.[ingredient]) : 1,
    parLevel:       isOrder ? _parLevelFor(ingredient) : null,
    lastWeekQty:    isOrder ? _lastWeekQtyFor(ingredient) : null,
    weekdayHistory: isOrder ? _weekdayHistoryFor(ingredient) : null,
    initialOrderQty: isOrder ? (draft?.orderQty ?? null) : null,
    theoStock:      isOrder ? _theoStockFor(ingredient) : null,
  }
  if (syncActive.value) {
    broadcastTyping(ingredient, true)
    _startTypingKeepalive(ingredient)
  }
}

let _typingKeepaliveTimer = null
function _startTypingKeepalive(ingredient) {
  clearInterval(_typingKeepaliveTimer)
  _typingKeepaliveTimer = setInterval(() => {
    if (syncActive.value && confirmState.value?.ingredient === ingredient) {
      broadcastTyping(ingredient, true)
    } else {
      clearInterval(_typingKeepaliveTimer)
      _typingKeepaliveTimer = null
    }
  }, 7000)
}
function _stopTypingKeepalive() {
  clearInterval(_typingKeepaliveTimer)
  _typingKeepaliveTimer = null
}

// 確定後の画面遷移（検索欄クリア/フォーカス・バーコード再開・候補の続き）
function _finishConfirmNav(source) {
  searchText.value   = ''
  searchStatus.value = ''
  if (source === 'table') {
    _stopTypingKeepalive()
    confirmState.value = null
    const next = _tapNextItem
    _tapNextItem = null
    if (tapContinuous.value && next && !inputLocked.value) {
      nextTick(() => _openTableConfirm(next))
      return
    }
    _restartIfContinuous()
    return
  } else if (pendingCandidates.value) {
    _stopTypingKeepalive()
    candidateState.value = { ...pendingCandidates.value }
    pendingCandidates.value = null
    confirmState.value = null
  } else if (source === 'barcode') {
    _stopTypingKeepalive()
    confirmState.value = null
    showBarcode.value = true
    return
  } else {
    _stopTypingKeepalive()
    confirmState.value = null
    nextTick(() => searchInputRef.value?.focus())
  }
  _restartIfContinuous()
}

// 数量入力の保存本体。次遷移/ナビゲーションは呼び出し側で行う。
// 戻り値: 'blocked'（競合/上限で保存せず）/ 'skipped'（数量未入力で名前のみ）/ 'saved'
function _applyConfirm({ ingredient, qty, unit, category, isAdd, isNew }) {
  _stopTypingKeepalive()
  if (syncActive.value) broadcastTyping(ingredient, false)

  if (syncActive.value && (lockedIngredients.has(ingredient) || conflictQueue.value.some(c => c.ingredient === ingredient))) {
    showToast(`「${ingredient}」の競合を先に解決してください`, 2500, 'warning')
    return 'blocked'
  }

  // 新規品目: 「新規登録」ボタンが押されて初めてマスタへ追加する（誤登録を防ぐ）
  if (isNew && !config.order.includes(ingredient)) {
    if (!canAddItem(config.order.length)) {
      openUpgrade(`無料プランの上限（${FREE_ITEM_LIMIT}品目）に達しました。上限の緩和は将来提供予定です。`)
      return 'blocked'
    }
    addItem(ingredient, null, category || null, unit || null, null)
    track('item_added_walk')
  }

  // モーダルで選んだジャンルを品目マスタへ反映（ロック中＝設定済みは触らない）
  if (!confirmState.value.categoryLocked && category) setItemCategory(ingredient, category)

  const existing = confirmExisting.value

  // 数量が未入力なら記録はせず、名前だけ登録
  if (qty === null || qty === undefined) {
    if (isNew) showToast(`「${ingredient}」を登録しました`)
    return 'skipped'
  }

  const rawFinal  = isAdd && existing ? existing.qty + qty : qty
  const finalQty  = Math.round(rawFinal * 10000) / 10000
  setItem(ingredient, qty, unit, isAdd, deviceName.value || '名前未設定')
  markActivity()
  if (!syncActive.value) {
    const action = !existing ? 'new' : isAdd ? 'add' : 'overwrite'
    _localAudit(ingredient, action, isAdd ? qty : finalQty, finalQty, unit)
  }
  if (syncActive.value) broadcastUpdate(ingredient, finalQty, unit, deviceName.value || '名前未設定', isAdd && !!existing)
  showToast(isAdd ? `${ingredient} に追加しました` : `${ingredient} を更新しました`)
  return 'saved'
}

// 発注確定: 在庫を（入力があれば）反映し、発注下書きへ集約して D1 に保存する。
function _applyOrderConfirm({ ingredient, stock, orderQty, unit, lot }) {
  // 在庫入力があれば棚卸同様に反映（表に表示・同期）
  if (stock != null && Number.isFinite(stock)) {
    setItem(ingredient, stock, unit, false, deviceName.value || '名前未設定')
    markActivity()
    if (syncActive.value) broadcastUpdate(ingredient, stock, unit, deviceName.value || '名前未設定', false)
    else _localAudit(ingredient, inventory[ingredient] ? 'overwrite' : 'new', stock, stock, unit)
  }
  // 発注下書きを更新（発注数 0 は下書きから外す＝発注なし）
  const draft = { ...orderDraft.value }
  if (orderQty > 0) draft[ingredient] = { orderQty, stock: stock ?? null, unit, lot, by: deviceName.value || '' }
  else delete draft[ingredient]
  orderDraft.value = draft
  // ルーム接続中は発注数を全端末へ同期（在庫とは別チャネル）。
  if (syncActive.value) {
    if (orderQty > 0) broadcastOrderUpdate(ingredient, orderQty, unit, lot, deviceName.value || '名前未設定')
    else              broadcastOrderRemove(ingredient)
  }
  _persistOrderDraft()
  return 'saved'
}

// ── 発注数の同期（受信・スナップショット・送信ペイロード）─────────────────────
// リモートからの発注数更新: 下書きへ反映（localStorage のみ保存。D1 は発信元が書く）。
function applyRemoteOrderUpdate(ingredient, orderQty, unit, lot, by) {
  orderDraft.value = applyOrderLine(orderDraft.value, ingredient, { orderQty, unit, lot, by })
  _persistOrderDraftLocal()
}

function applyRemoteOrderRemove(ingredient) {
  if (!orderDraft.value[ingredient]) return
  orderDraft.value = applyOrderLine(orderDraft.value, ingredient, { orderQty: 0 })
  _persistOrderDraftLocal()
}

// 参加/新セッション時の一括同期: DO の発注数を正として揃える（在庫は別ルートで保持）。
function applyOrdersSnapshot(orders) {
  if (!orders || typeof orders !== 'object') return
  orderDraft.value = mergeOrderSnapshot(orderDraft.value, orders)
  _persistOrderDraftLocal()
}

// session_start でホストが送る発注数ペイロード。
function _ordersPayload() {
  return orderDraftToPayload(orderDraft.value, deviceName.value || '')
}

// 発注下書きを localStorage にのみ保存（リモート反映時の軽量保存・D1 書き込みなし）。
function _persistOrderDraftLocal() {
  try { localStorage.setItem(_ORDER_DRAFT_PREFIX + _orderId(), JSON.stringify(orderDraft.value)) } catch (_) {}
}

// 発注下書きをセッション単位で 1 レコードに集約し、localStorage + useOrders + D1 へ保存する。
function _persistOrderDraft() {
  _persistOrderDraftLocal()
  const lines = Object.entries(orderDraft.value).map(([item, d]) => ({
    item, qty: d.orderQty, unit: d.unit || '', stock: d.stock, lot: d.lot,
  }))
  const rec = upsertOrder({ id: _orderId(), date: _todayStr(), sessionId: pendingSession.value?.id ?? null, lines })
  if (rec) saveOrderToD1(rec)
}

function onConfirm(payload) {
  const source = confirmState.value?.source
  const r = payload.orderMode ? _applyOrderConfirm(payload) : _applyConfirm(payload)
  if (r === 'blocked') {
    confirmState.value = null
    pendingCandidates.value = null
    _restartIfContinuous()
    return
  }
  _finishConfirmNav(source)
}

// 入力モーダルの左右矢印: 現在値を保存してから前/次の品目のモーダルへ移動する
function onConfirmNavigate({ dir, ...payload }) {
  const current = confirmState.value?.ingredient
  const table   = inventoryTableRef.value
  if (!current || !table) return
  const target = dir === 'prev' ? table.getPrevVisibleItem(current) : table.getNextVisibleItem(current)
  if (!target) return   // 端: 移動しない
  const apply = payload.orderMode ? _applyOrderConfirm(payload) : _applyConfirm(payload)
  if (apply === 'blocked') return   // 競合等: 現在のモーダルを維持
  _openTableConfirm(target)
}

const confirmCanPrev = computed(() => {
  const i = confirmState.value?.ingredient
  return !!(i && inventoryTableRef.value?.getPrevVisibleItem?.(i))
})
const confirmCanNext = computed(() => {
  const i = confirmState.value?.ingredient
  return !!(i && inventoryTableRef.value?.getNextVisibleItem?.(i))
})

function onCancelConfirm() {
  _stopTypingKeepalive()
  _tapNextItem = null
  const wasBarcode = confirmState.value?.source === 'barcode'
  if (syncActive.value && confirmState.value) broadcastTyping(confirmState.value.ingredient, false)
  confirmState.value = null
  pendingCandidates.value = null
  if (wasBarcode) {
    // 連続スキャン: キャンセルでもカメラに戻す（カメラを閉じればループ終了）
    showBarcode.value = true
    return
  }
  _restartIfContinuous()
}

// 入力済みを未入力に戻す（1個前の値に戻す機能は廃止・「未入力に戻す」に統一）
function onConfirmRevert() {
  _stopTypingKeepalive()
  _tapNextItem = null
  const ingredient = confirmState.value.ingredient
  const wasBarcode = confirmState.value?.source === 'barcode'
  if (syncActive.value) broadcastTyping(ingredient, false)
  const cur = confirmExisting.value
  removeItem(ingredient)
  if (syncActive.value) broadcastRemove(ingredient)
  else _localAudit(ingredient, 'remove', -(cur?.qty ?? 0), 0, cur?.unit ?? '')
  showToast(`「${ingredient}」を未入力に戻しました`)
  confirmState.value = null
  if (wasBarcode) { showBarcode.value = true; return }
  _restartIfContinuous()
}

// 品目編集モーダルの保存（品目名・数量・単位・ジャンル・単価をまとめて更新）
function onEditSave({ originalName, name, qty, unit, category, price, tagA, tagB }) {
  const n = (name || '').trim()
  if (!n) return
  const oldEntry = inventory[originalName] ? { ...inventory[originalName] } : null
  const priceNum = parseFloat(price)
  const p = (!isNaN(priceNum) && priceNum > 0) ? priceNum : null

  const result = updateConfigItem(originalName, n, p, category || null, unit || '')
  if (!result) {
    showToast('その品目名は既に使われています', 3000, 'warning')
    return
  }

  // 汎用軸の値を反映（軸が未使用でも空文字で安全）
  if (tagA !== undefined) setItemTag(n, 0, tagA)
  if (tagB !== undefined) setItemTag(n, 1, tagB)

  // リネーム時は旧在庫エントリを削除（新名で入れ直す）
  if (n !== originalName && oldEntry) {
    removeItem(originalName)
    if (syncActive.value) broadcastRemove(originalName)
  }

  // 反映する数量: 入力があればそれ、無ければ元の数量。未入力品目はそのまま未入力
  const finalQty  = (qty !== null && qty !== undefined && !isNaN(qty)) ? qty : (oldEntry ? oldEntry.qty : null)
  const finalUnit = unit || oldEntry?.unit || ''
  if (finalQty !== null && finalQty !== undefined) {
    updateQty(n, finalQty, finalUnit, deviceName.value || '名前未設定')
    if (syncActive.value) broadcastUpdate(n, finalQty, finalUnit, deviceName.value || '名前未設定')
  }

  confirmState.value = null
  markActivity()
  showToast(`「${n}」を更新しました`, 2500, 'success')
}

// ── Candidate modal ────────────────────────────────────────────────────────────
function onCandidateSelect(canonical) {
  const { qty, unit, searchTerm, matched } = candidateState.value
  const remaining = matched.filter(c => c !== canonical)
  pendingCandidates.value = remaining.length > 0
    ? { matched: remaining, searchTerm, qty, unit }
    : null
  candidateState.value = null
  registerAlias(searchTerm, canonical)
  openConfirm(canonical, qty, unit)
}

function onCancelCandidate() {
  candidateState.value = null
  pendingCandidates.value = null
  _restartIfContinuous()
}

// マイクなしで棚卸表から直接タップした場合（qty=null → 数量未入力で確認画面へ）
// 連続入力用に「次の品目」を開いた時点で確保する（確定後は絞り込みで消える可能性があるため）
let _tapNextItem = null
function _openTableConfirm(item) {
  _tapNextItem = inventoryTableRef.value?.getNextVisibleItem(item) || null
  openConfirm(item, null, config.units?.[item] || '', 'table')
}
function onTableTap(item) {
  if (inputLocked.value) return
  _openTableConfirm(item)
}

// ── Table handlers ─────────────────────────────────────────────────────────────
function onTableUpdate({ item, qty, unit }) {
  updateQty(item, qty, unit, deviceName.value || '名前未設定')
  markActivity()
  if (syncActive.value) broadcastUpdate(item, qty, unit, deviceName.value || '名前未設定')
}

// ── 品目追加・編集フォーム（音声検索下） ──────────────────────────────────────
const newItemName     = ref('')
const newItemQty      = ref('')
const newItemPrice    = ref('')
const newItemCategory = ref('')
const newItemError    = ref('')
const newItemNameRef  = ref(null)
const newItemQtyRef   = ref(null)
const editingItem     = ref(null)   // null=追加モード、文字列=編集中の品目名

const existingCategories = computed(() =>
  [...new Set(Object.values(config.categories ?? {}))].sort((a, b) => a.localeCompare(b, 'ja'))
)
const existingTagsA = computed(() =>
  [...new Set(Object.values(config.tagsA ?? {}).flat())].sort((a, b) => a.localeCompare(b, 'ja'))
)
const existingTagsB = computed(() =>
  [...new Set(Object.values(config.tagsB ?? {}).flat())].sort((a, b) => a.localeCompare(b, 'ja'))
)

// ファジー類似品目: 部分文字列一致で既存品目を検索
function _findSimilar(name) {
  return findSimilarNames(name, config.order)
}

const _pendingItemSubmit = ref(null)  // 類似警告後に保留中の確定コールバック

function submitNewItem() {
  const name = newItemName.value.trim()
  if (!name) { newItemError.value = '品目名を入力してください'; return }
  const price    = parseFloat(newItemPrice.value)
  const category = newItemCategory.value.trim()

  if (editingItem.value) {
    const oldName = editingItem.value
    const result  = updateConfigItem(oldName, name, (!isNaN(price) && price > 0) ? price : null, category || null)
    if (!result) { newItemError.value = 'その品目名はすでに使われています'; return }
    if (name !== oldName) {
      const entry = inventory[oldName]
      if (entry) {
        updateQty(name, entry.qty, entry.unit || '', entry.enteredBy || '')
        if (syncActive.value) broadcastUpdate(name, entry.qty, entry.unit || '', entry.enteredBy || '')
      }
      removeItem(oldName)
      if (syncActive.value) broadcastRemove(oldName)
    }
    cancelEditItem()
    return
  }

  const qty = parseFloat(newItemQty.value)
  if (isNaN(qty) || qty < 0) { newItemError.value = '数量を入力してください'; return }
  if (config.order.includes(name)) { newItemError.value = 'すでに登録されている品目名です'; return }

  // Free プラン: 品目数上限チェック
  if (!canAddItem(config.order.length)) {
    newItemError.value = ''
    openUpgrade(`無料プランの上限（${FREE_ITEM_LIMIT}品目）に達しました。上限の緩和は将来提供予定です。`)
    return
  }

  // ファジー類似警告（保留済みなら警告スキップ）
  if (!_pendingItemSubmit.value) {
    const similar = _findSimilar(name)
    if (similar.length) {
      _pendingItemSubmit.value = () => submitNewItem()
      newItemError.value = `類似品目「${similar[0]}」が既にあります。別品目として追加しますか？ [もう一度タップで確定]`
      return
    }
  }
  _pendingItemSubmit.value = null

  // ゲスト接続中: 品目追加はホスト承認が必要
  if (syncActive.value && !syncIsHost.value) {
    if (pendingGuestRequest.value) {
      newItemError.value = '前の申請がホストの承認待ちです。しばらくお待ちください。'
      return
    }
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
    pendingGuestRequest.value = { requestId, name }
    broadcastItemAddRequest(name, '', barcodeAddCode.value || '', requestId)
    showToast(`「${name}」の追加をホストに申請しました`, 3000, 'info')
    newItemName.value     = ''
    newItemQty.value      = ''
    newItemPrice.value    = ''
    newItemCategory.value = ''
    newItemError.value    = ''
    barcodeAddCode.value  = ''
    nextTick(() => newItemNameRef.value?.focus())
    return
  }

  addItem(name, (!isNaN(price) && price > 0) ? price : null, category || null,
    null, barcodeAddCode.value || null)
  barcodeAddCode.value = ''
  updateQty(name, qty, '', deviceName.value || '名前未設定')
  markActivity()
  if (syncActive.value) broadcastUpdate(name, qty, '', deviceName.value || '名前未設定')
  track('item_added_manual')
  newItemName.value     = ''
  newItemQty.value      = ''
  newItemPrice.value    = ''
  newItemCategory.value = ''
  newItemError.value    = ''
  nextTick(() => newItemNameRef.value?.focus())
}

// 品目編集: 新規登録と同じ入力モーダルを編集モードで開く
function startEditItem(name) {
  if (!config.order.includes(name)) return
  const entry = inventory[name] ?? null
  confirmState.value = {
    ingredient:     name,
    qty:            entry?.qty ?? null,
    unit:           entry?.unit || config.units?.[name] || '',
    unitLocked:     false,
    category:       config.categories?.[name] || '',
    categoryLocked: false,
    price:          config.prices?.[name] ?? '',
    source:         'edit',
    lotSize:        config.lotSizes?.[name] ?? '',
    tagA:           (config.tagsA?.[name] ?? [])[0] ?? '',
    tagB:           (config.tagsB?.[name] ?? [])[0] ?? '',
    isNew:          false,
    isEdit:         true,
  }
}

function cancelEditItem() {
  editingItem.value        = null
  newItemName.value        = ''
  newItemQty.value         = ''
  newItemPrice.value       = ''
  newItemCategory.value    = ''
  newItemError.value       = ''
  _pendingItemSubmit.value = null
  barcodeAddCode.value     = ''
}

function onDeleteConfigItem(name) {
  removeConfigItem(name)
  removeItem(name)
  if (syncActive.value) broadcastRemove(name)
  if (editingItem.value === name) cancelEditItem()
}

// 手動非表示（一覧から隠す・進捗の分母から除外）。config 変更で D1 保存＋同期は自動。
function onHideItem(name) {
  hideItem(name)
  if (syncActive.value) broadcastConfig(_configPayload())
  showToast(`「${name}」を一覧から非表示にしました`, 2600, 'default')
}
function onUnhideItem(name) {
  unhideItem(name)
  if (syncActive.value) broadcastConfig(_configPayload())
}

// 品目マスタの一括削除（店舗コードゲートはページ側で確認済み）。軸は残す。
function onClearMaster(opts = {}) {
  setEmptyList({ resetAssignments: opts.resetAssignments === true })
  _persistConfigToD1()
  if (syncActive.value) broadcastConfig(_configPayload())
  showToast(opts.resetAssignments ? '品目マスタと振り分けを削除しました' : '品目マスタを削除しました', 2600, 'default')
}

// ── CSV export ─────────────────────────────────────────────────────────────────
const zeroItems     = ref([])  // 数量0品目
const unfilledItems = ref([])  // 未入力品目

function onExport() {
  const zeros    = Object.entries(inventory)
    .filter(([, e]) => e.qty === 0)
    .map(([item]) => item)
  const unfilled = config.order
    .filter(item => !(item in inventory))

  if (zeros.length > 0 || unfilled.length > 0) {
    zeroItems.value     = zeros
    unfilledItems.value = unfilled
    return
  }
  doExport()
}

function doExport() {
  zeroItems.value     = []
  unfilledItems.value = []
  const csv  = exportCSV()
  const date = new Date().toISOString().slice(0, 10)
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `棚卸_${date}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  showToast('CSVを保存しました', 2600, 'success')
}

// ── Date ───────────────────────────────────────────────────────────────────────
const dateStr = new Date().toLocaleDateString('ja-JP', {
  year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
})

// ── 初回オンボーディング ────────────────────────────────────────────────────────
const _ONBOARD_KEY   = 'tanaoro_onboarded'
const showOnboarding = ref(false)

watch(() => currentView.value, (v) => {
  if (v === 'session' && !localStorage.getItem(_ONBOARD_KEY)) {
    showOnboarding.value = true
  }
})

function dismissOnboarding() {
  showOnboarding.value = false
  localStorage.setItem(_ONBOARD_KEY, '1')
}

// ── フィードバック ─────────────────────────────────────────────────────────────
const showFeedback      = ref(false)
const feedbackText      = ref('')
const feedbackSent      = ref(false)

function openFeedback() {
  feedbackText.value = ''
  feedbackSent.value = false
  showFeedback.value = true
  track('feedback_opened')
}

function submitFeedback() {
  const text = feedbackText.value.trim()
  if (!text) return
  track('feedback_submitted', { text })
  feedbackSent.value = true
  setTimeout(() => { showFeedback.value = false }, 2000)
}

// ── レビュー促進（3回目完了後） ────────────────────────────────────────────────
const _COMPLETED_KEY = 'tanaoro_completed_count'
const _REVIEW_KEY    = 'tanaoro_review_prompted'
const showReview     = ref(false)
const reviewRating   = ref(0)
const reviewStep     = ref('rating') // 'rating' | 'thanks' | 'feedback'
const reviewFeedback = ref('')

function _checkReviewPrompt() {
  if (localStorage.getItem(_REVIEW_KEY)) return
  const count = parseInt(localStorage.getItem(_COMPLETED_KEY) || '0', 10) + 1
  localStorage.setItem(_COMPLETED_KEY, String(count))
  if (count >= 3) {
    reviewRating.value   = 0
    reviewStep.value     = 'rating'
    reviewFeedback.value = ''
    showReview.value     = true
    track('review_prompt_shown', { completed_count: count })
  }
}

function onReviewRate(star) {
  reviewRating.value = star
  if (star >= 4) {
    reviewStep.value = 'thanks'
    track('review_rated', { stars: star, positive: true })
    localStorage.setItem(_REVIEW_KEY, '1')
  } else {
    reviewStep.value = 'feedback'
    track('review_rated', { stars: star, positive: false })
  }
}

function submitReviewFeedback() {
  const text = reviewFeedback.value.trim()
  if (text) track('review_feedback_submitted', { stars: reviewRating.value, text })
  localStorage.setItem(_REVIEW_KEY, '1')
  showReview.value = false
}

function dismissReview() {
  localStorage.setItem(_REVIEW_KEY, '1')
  showReview.value = false
  track('review_dismissed')
}
</script>

<template>
  <div id="app" :class="{ 'has-banner': _bannerActive, 'theme-order': sessionMode === 'order' && currentView === 'session' }">

    <ConnectionBanner />

    <!-- ── デスクトップ用サイドナビ（1024px 以上・ログイン済みのアプリ内画面のみ）── -->
    <DesktopNav
      v-if="showDesktopNav"
      :current-view="currentView"
      :has-live-session="!!pendingSession"
      :practice-mode="practiceMode"
      :session-mode="sessionMode"
      :sync-active="syncActive"
      :sync-connected="!!syncState.isConnected"
      :sync-room-code="syncState.roomCode ?? ''"
      :participant-count="participantList.length"
      :is-guest="syncActive && !syncIsHost"
      @navigate="onDesktopNavigate"
      @open-sync="showSync = true"
      @open-feedback="openFeedback"
    />

    <div v-if="proReviewBuild" class="pro-review-badge" role="status">
      PRO REVIEW · テストデータ
    </div>

    <!-- ── 認証ページ ── -->
    <AuthPage
      v-if="currentView === 'auth'"
      @done="onAuthDone"
      @skip="currentView = 'landing'"
    />

    <!-- ── セッション一覧 ── -->
    <SessionListPage
      v-else-if="currentView === 'sessions'"
      :live-item-count="filledCount"
      :live-session-id="pendingSession?.id ?? null"
      :new-session-id="newSessionId"
      @start-session="onSessionStart"
      @start-practice="onStartPractice"
      @resume-session="onSessionResume"
      @view-session="onViewSession"
      @delete-session="onDeleteSession"
      @back="currentView = 'landing'"
      @open-settings="settingsSection = 'import'"
      @open-master="currentView = 'master'"
      @open-movement="openMovement"
      @open-upgrade="reason => openUpgrade(reason)"
    />

    <!-- ── 品目マスタ管理（専用ページ） ── -->
    <MasterManagePage
      v-else-if="currentView === 'master'"
      @back="currentView = 'sessions'"
      @clear-master="onClearMaster"
    />

    <!-- ── 入出庫（専用ページ・品目ごとに増減） ── -->
    <MovementPage
      v-else-if="currentView === 'movement'"
      @back="currentView = 'sessions'"
    />

    <!-- ── セッション詳細（完了済み） ── -->
    <SessionDetailPage
      v-else-if="currentView === 'session-detail' && detailSnapshot"
      :snapshot="detailSnapshot"
      :is-host="!syncActive || syncIsHost"
      @back="currentView = 'sessions'"
      @patched="onSnapshotPatched"
    />

    <!-- ── 完了後ゲスト閲覧（読み取り専用・金額なし） ── -->
    <GuestResultView
      v-else-if="currentView === 'guest-result'"
      :result="guestResult"
      :error-message="guestResultError"
      @home="currentView = isAuthenticated ? 'sessions' : 'landing'"
    />

    <!-- ── 公開Web アカウント削除申請（?delete-account） ── -->
    <DeleteAccountPage v-else-if="currentView === 'delete-account'" />

    <!-- ── ランディング ── -->
    <LandingPage v-else-if="currentView === 'landing'" @started="onLandingStarted" />

    <!-- ── セッション ── -->
    <template v-if="currentView === 'session'">

      <!-- ヘッダー -->
      <header class="app-header">
        <div class="header-left">
          <button v-if="isAuthenticated" class="settings-btn home-btn" :disabled="completing" @click="onGoHome" :title="practiceMode ? '練習を終了して戻る' : 'セッション一覧に戻る'">🏠</button>
          <span v-if="practiceMode" class="practice-chip">🎯 練習モード</span>
        </div>
        <div class="header-right">
          <div v-if="sessionPaused" class="session-elapsed paused" title="5分間操作が無いため計測を一時停止しています。操作すると自動で再開します">⏸ 一時停止中</div>
          <div v-else-if="sessionElapsed" class="session-elapsed" title="棚卸の実働時間（離席時間は除外）">⏱ {{ sessionElapsed }}</div>
          <div class="date">{{ dateStr }}</div>
          <!-- 同期中はステータス表示（タップで詳細）。未同期時はメニューから開く -->
          <button
            v-if="syncActive"
            class="settings-btn sync-btn active"
            @click="showSync = true"
            :title="`ルーム ${syncState.roomCode}（${participantList.length}名）`"
          >
            <span class="sync-badge">🔗<span class="sync-count">{{ participantList.length }}</span></span>
          </button>
          <!-- ハンバーガーメニュー（ルーム参加中のゲストには表示しない）-->
          <div v-if="!(syncActive && !syncIsHost)" class="menu-wrap">
            <AppMenu context="session">
              <template #default="{ close }">
                <button v-if="isAuthenticated" class="am-item" :disabled="completing" @click="close(); onGoHome()">
                  <span class="am-ico">🏠</span> {{ practiceMode ? '練習を終了して戻る' : 'セッション一覧に戻る' }}
                </button>
                <button v-if="hasBarcodedItems && !inputLocked" class="am-item" @click="close(); showBarcode = true">
                  <span class="am-ico">📷</span> バーコードスキャン
                </button>
              </template>
            </AppMenu>
          </div>
        </div>
      </header>

      <!-- 同期中バナー -->
      <div v-if="syncActive" class="sync-banner" :class="{ offline: !syncState.isConnected }">
        <div class="sync-banner-top">
          <span class="sync-banner-dot"></span>
          <span class="sync-banner-text">
            <strong>{{ syncIsHost ? 'ホスト中' : '参加中' }}</strong>
            ・{{ syncState.isConnected ? 'ルーム ' + syncState.roomCode : '再接続中…' }}
          </span>
          <button class="sync-banner-btn sync-msg-btn" @click="showChat = true" title="チャット">
            💬<span v-if="unreadCount > 0" class="unread-badge">!</span>
          </button>
          <button class="sync-banner-btn" @click="showSync = true">詳細</button>
        </div>
        <div class="sync-banner-participants">
          <button
            v-for="p in historyMembers"
            :key="p.id"
            class="sync-participant-chip"
            :class="{ done: p.isDone, me: p.isMe, left: !p.present }"
            @click="openMemberHistory(p)"
            :title="p.present ? 'タップでこのメンバーの変更履歴を見る' : '退室済み — タップで履歴を見る'"
          >{{ p.name }}<span v-if="p.isDone" class="chip-check"> ✓</span><span v-else-if="!p.present" class="chip-left"> ·退室</span></button>
        </div>
      </div>

      <!-- ルーム作成 CTA（目玉機能・未同期時のみ）-->
      <button
        v-if="!syncActive && !isCompleted && shopCode && !practiceMode"
        class="room-cta"
        @click="onCreateRoomFromMain"
      >
        <span class="room-cta-icon">👥</span>
        <span class="room-cta-body">
          <span class="room-cta-title">みんなで一緒に{{ actNoun }}する</span>
          <span class="room-cta-sub">ルームを作成して、スタッフのスマホをつなぐ</span>
        </span>
        <span class="room-cta-action">ルームを作成 ＋</span>
      </button>

      <!-- 棚卸完了バナー -->
      <div v-if="isCompleted" class="complete-banner">
        <span class="complete-icon">✓</span>
        <span class="complete-text">{{ actNoun }}完了 — {{ completedAtDisplay }}</span>
      </div>

      <!-- 音声入力 / テキスト検索（完了時・ゲスト棚卸完了後は非表示） -->
      <section v-if="!inputLocked" class="voice-section">
        <div v-if="continuousMode" class="continuous-banner">
          <span class="continuous-pulse"></span>
          <span class="continuous-status">{{ isListening ? '聞いています…' : '認識停止中' }}</span>
          <button class="continuous-stop-btn" @click="onForceStop">■ 停止</button>
        </div>

        <VoiceButton
          :is-listening="isListening"
          :continuous-mode="continuousMode"
          @toggle="onVoiceButtonTap"
        />

        <div class="search-row">
          <input
            ref="searchInputRef"
            type="text"
            v-model="searchText"
            :class="['search-input', searchStatus]"
            placeholder="例：コーヒー　（音声 or 入力）"
            @keyup.enter="onTextSearch"
            @focus="onSearchFocus"
          />
          <button class="search-btn" @click="onTextSearch" title="検索">🔍</button>
        </div>

        <!-- 品目編集フォーム（編集時のみ表示。追加は検索欄からの積み上げ登録が主動線） -->
        <div v-if="showAddItemForm || editingItem" class="add-item-form">
          <div v-if="barcodeAddCode" class="barcode-add-hint">
            <span class="barcode-add-icon">📷</span>
            <span>バーコード <code>{{ barcodeAddCode }}</code> を品目名と紐付けて登録します</span>
            <button class="barcode-add-clear" @click="barcodeAddCode = ''; newItemError = ''; _pendingItemSubmit = null">✕</button>
          </div>
          <p v-if="syncActive && !syncIsHost && !editingItem" class="guest-add-hint">
            ✋ 追加する品目はホストの承認が必要です
          </p>
          <p class="add-item-label">{{ editingItem ? `✏️ 品目を編集` : '＋ 品目を追加' }}</p>
          <div class="add-item-row">
            <input
              ref="newItemNameRef"
              v-model="newItemName"
              class="add-input add-input-name"
              placeholder="品目名"
              inputmode="text"
              @keydown.enter.prevent="editingItem ? submitNewItem() : newItemQtyRef?.focus()"
            />
            <input
              v-if="!editingItem"
              ref="newItemQtyRef"
              v-model="newItemQty"
              type="number"
              min="0"
              step="any"
              class="add-input add-input-sm"
              placeholder="数量"
              inputmode="decimal"
              @keydown.enter.prevent="submitNewItem"
            />
            <input
              v-model="newItemPrice"
              type="number"
              min="0"
              step="1"
              class="add-input add-input-sm"
              placeholder="金額（任意）"
              inputmode="numeric"
              @keydown.enter.prevent="submitNewItem"
            />
          </div>
          <div class="add-item-row add-item-row2">
            <input
              v-model="newItemCategory"
              list="category-list"
              class="add-input add-input-cat"
              placeholder="ジャンル（任意）"
              inputmode="text"
              @keydown.enter.prevent="submitNewItem"
            />
            <datalist id="category-list">
              <option v-for="cat in existingCategories" :key="cat" :value="cat" />
            </datalist>
            <button v-if="editingItem" class="add-item-btn-cancel" @click="cancelEditItem">キャンセル</button>
            <button class="add-item-btn" @click="submitNewItem">{{ editingItem ? '保存' : '追加' }}</button>
          </div>
          <p v-if="newItemError" class="add-item-error">{{ newItemError }}</p>
        </div>

      </section>

      <!-- 同時入力 競合解決バナー（入力欄直下） -->
      <div v-if="conflictQueue.length > 0" class="conflict-resolve-wrap">
        <div v-for="c in conflictQueue" :key="c.ingredient" class="conflict-resolve-card">
          <div class="conflict-resolve-title">⚡ 「{{ c.ingredient }}」の同時入力</div>
          <div class="conflict-resolve-vals">
            <span class="crv-mine">あなた: {{ c.local.qty }}{{ c.local.unit }}</span>
            <span class="crv-sep">｜</span>
            <span class="crv-theirs">{{ c.remoteBy }}: {{ c.remoteQty }}{{ c.remoteUnit }}</span>
          </div>
          <div class="conflict-resolve-actions">
            <button class="crv-btn crv-sum"    @click="onResolveConflict(c, 'sum')">
              合計 {{ Math.round((c.local.qty + c.remoteQty) * 10000) / 10000 }}{{ c.local.unit }}
            </button>
            <button class="crv-btn crv-mine"   @click="onResolveConflict(c, 'mine')">
              自分 ({{ c.local.qty }}{{ c.local.unit }})
            </button>
            <button class="crv-btn crv-theirs" @click="onResolveConflict(c, 'theirs')">
              相手 ({{ c.remoteQty }}{{ c.remoteUnit }})
            </button>
          </div>
        </div>
      </div>

      <!-- ホスト: ゲストからの品目追加申請 -->
      <div v-if="syncIsHost && pendingItemRequests.length > 0" class="item-req-wrap">
        <div v-for="req in pendingItemRequests" :key="req.requestId" class="item-req-card">
          <div class="item-req-info">
            <span class="item-req-icon">📋</span>
            <span class="item-req-text">
              <strong>{{ req.fromDeviceName }}</strong> が
              「<strong>{{ req.name }}</strong>」の追加を申請
            </span>
          </div>
          <div class="item-req-actions">
            <button class="item-req-btn item-req-approve" @click="approveItemAdd(req)">承認</button>
            <button class="item-req-btn item-req-reject"  @click="rejectItemAdd(req)">拒否</button>
          </div>
        </div>
      </div>

      <!-- ゲスト: ホスト承認待ち状態 -->
      <div v-if="pendingGuestRequest" class="item-req-pending-guest">
        <span class="item-req-pending-icon">⏳</span>
        「<strong>{{ pendingGuestRequest.name }}</strong>」の追加をホストに申請中…
        <button class="item-req-pending-cancel" @click="pendingGuestRequest = null">取消</button>
      </div>

      <!-- あとで数える 一覧バナー（ソロ・複数人 共通）-->
      <div v-if="recountItems.length > 0" class="recount-notice">
        <button class="recount-notice-toggle" @click="recountOpen = !recountOpen" type="button">
          <span class="recount-notice-icon">🔖</span>
          <span class="recount-notice-label">あとで数える品目が {{ recountItems.length }}件あります</span>
          <span class="recount-notice-arrow">{{ recountOpen ? '▲' : '▼' }}</span>
        </button>
        <div v-if="recountOpen" class="recount-notice-body">
          <div
            v-for="item in recountItems"
            :key="item"
            class="recount-notice-item"
          >
            <span class="recount-notice-name" @click="onTableTap(item)">
              {{ item }}
              <span v-if="inventory[item]" class="recount-notice-qty">{{ inventory[item].qty }}{{ inventory[item].unit }}</span>
              <span v-else class="recount-notice-empty">未入力</span>
            </span>
            <button
              v-if="!inputLocked"
              class="recount-notice-clear"
              @click="onToggleRecountFlag(item, false)"
              type="button"
            >解除</button>
          </div>
        </div>
      </div>

      <!-- 複数人編集品目バナー -->
      <div v-if="conflictItems.length > 0" class="conflict-notice">
        <button class="conflict-notice-toggle" @click="conflictOpen = !conflictOpen" type="button">
          <span class="conflict-notice-icon">⚡</span>
          <span class="conflict-notice-label">複数人が入力した品目が {{ conflictItems.length }}件あります</span>
          <span class="conflict-notice-arrow">{{ conflictOpen ? '▲' : '▼' }}</span>
        </button>
        <div v-if="conflictOpen" class="conflict-notice-body">
          <div
            v-for="ci in conflictItems"
            :key="ci.ingredient"
            class="conflict-notice-item"
            @click="onTableTap(ci.ingredient)"
          >
            <span class="conflict-notice-name">{{ ci.ingredient }}</span>
            <span class="conflict-notice-meta">{{ ci.editors.join('・') }} / 現在 {{ ci.recentQty }}{{ ci.recentUnit }}</span>
          </div>
        </div>
      </div>

      <InventoryTable
        ref="inventoryTableRef"
        :inventory="inventory"
        :filled-count="filledCount"
        :read-only="inputLocked"
        :recount-flags="recountFlags"
        :typing-map="syncActive ? typingMap : null"
        :conflict-locked="syncActive ? lockedIngredients : null"
        :manual-items="config.manualItems"
        :usage-map="itemUsageMap"
        :hidden-items="config.hiddenItems"
        :order-map="sessionMode === 'order' ? orderDraft : null"
        :order-mode="sessionMode === 'order'"
        :can-manage-list="!syncActive || syncIsHost"
        v-model:tap-continuous="tapContinuous"
        @update="onTableUpdate"
        @remove="item => { removeItem(item); if (syncActive) broadcastRemove(item) }"
        @tap="onTableTap"
        @edit-item="startEditItem"
        @delete-item="onDeleteConfigItem"
        @hide-item="onHideItem"
        @unhide-item="onUnhideItem"
      />

      <!-- 確認モーダル -->
      <ConfirmModal
        v-if="confirmState"
        :key="confirmState.ingredient"
        :ingredient="confirmState.ingredient"
        :initial-qty="confirmState.qty"
        :initial-unit="confirmState.unit"
        :unit-locked="confirmState.unitLocked"
        :initial-category="confirmState.category"
        :category-locked="confirmState.categoryLocked"
        :is-new="!!confirmState.isNew"
        :is-edit="!!confirmState.isEdit"
        :initial-price="confirmState.price ?? ''"
        :existing-categories="existingCategories"
        :axis-names="config.axisNames"
        :initial-tag-a="confirmState.tagA ?? ''"
        :initial-tag-b="confirmState.tagB ?? ''"
        :existing-tags-a="existingTagsA"
        :existing-tags-b="existingTagsB"
        :existing="confirmExisting"
        :prev-month="config.prevMonths?.[confirmState.ingredient] ?? ''"
        :lot-size="confirmState.lotSize"
        :audit-log="auditLog"
        :is-flagged="!!recountFlags[confirmState.ingredient]"
        :typing-user="syncActive ? (typingMap[confirmState.ingredient]?.name ?? null) : null"
        :can-prev="confirmCanPrev"
        :can-next="confirmCanNext"
        :order-mode="!!confirmState.orderMode"
        :par-level="confirmState.parLevel"
        :order-lot="confirmState.orderLot ?? 1"
        :last-week-qty="confirmState.lastWeekQty"
        :weekday-history="confirmState.weekdayHistory"
        :initial-order-qty="confirmState.initialOrderQty"
        :theo-stock="confirmState.theoStock"
        @confirm="onConfirm"
        @navigate="onConfirmNavigate"
        @cancel="onCancelConfirm"
        @revert="onConfirmRevert"
        @edit-save="onEditSave"
        @toggle-flag="on => onToggleRecountFlag(confirmState.ingredient, on)"
      />

      <!-- 候補選択モーダル -->
      <CandidateModal
        v-if="candidateState"
        :search-term="candidateState.searchTerm"
        :matched="candidateState.matched"
        :qty="candidateState.qty"
        :unit="candidateState.unit"
        :can-create="!(syncActive && !syncIsHost) || !pendingGuestRequest"
        @select="onCandidateSelect"
        @create="onCandidateCreate"
        @cancel="onCancelCandidate"
      />

      <!-- フッター -->
      <div class="app-footer">
        <div v-if="totalValue != null" class="footer-total">
          在庫合計　<strong>¥{{ totalValue.toLocaleString('ja-JP') }}</strong>
        </div>
        <div class="footer-actions">
          <template v-if="!isCompleted">
            <button
              class="btn-complete"
              :class="{ reported: guestReported }"
              :disabled="completing"
              @click="guestReported ? onUndone() : onComplete()"
            >{{ guestReported
                ? (syncActive && !syncIsHost ? '↩ 入力再開' : `↩ ${actNoun}再開`)
                : (syncActive && !syncIsHost ? '✓ 入力完了' : `✓ ${actNoun}完了`)
              }}</button>
            <button v-if="!syncActive || syncIsHost" class="btn-export" @click="onExport">💾 CSV</button>
          </template>
          <template v-else>
            <button class="btn-new-session" @click="onStartNew">＋ 新規棚卸</button>
            <button v-if="!syncActive || syncIsHost" class="btn-export" @click="onExport">💾 CSV</button>
          </template>
        </div>
      </div>

      <!-- 未入力・数量0品目の確認モーダル -->
      <div v-if="zeroItems.length || unfilledItems.length" class="modal-overlay" @click.self="zeroItems = []; unfilledItems = []">
        <div class="modal-sheet">
          <div class="sheet-handle"></div>
          <div class="sheet-title">確認してください</div>
          <template v-if="unfilledItems.length">
            <div class="zero-confirm-msg">以下の品目が<strong>未入力</strong>のため数量空欄でCSVに含まれます。</div>
            <ul class="zero-list">
              <li v-for="item in unfilledItems" :key="item" class="unfilled-item">{{ item }}</li>
            </ul>
          </template>
          <template v-if="zeroItems.length">
            <div class="zero-confirm-msg" :style="unfilledItems.length ? 'margin-top:12px' : ''">以下の品目が<strong>在庫0</strong>として記録されます。</div>
            <ul class="zero-list">
              <li v-for="item in zeroItems" :key="item">{{ item }}</li>
            </ul>
          </template>
          <div class="actions">
            <button class="btn btn-secondary" @click="zeroItems = []; unfilledItems = []">戻る</button>
            <button class="btn btn-success" @click="doExport">このまま保存</button>
          </div>
        </div>
      </div>

    </template>

    <!-- ── 名前設定モーダル（ルーム参加前） ── -->
    <div v-if="showNameModal" class="name-modal-overlay" @click.self="onCancelNameModal">
      <div class="name-modal-sheet">
        <div class="sheet-handle"></div>
        <div class="name-modal-title">参加者の名前を入力してください</div>
        <div v-if="deviceName" class="name-modal-prev">前回: {{ deviceName }}</div>
        <input
          class="name-modal-input"
          :class="{ error: pendingNameError }"
          type="text"
          v-model="pendingName"
          placeholder="名前（例: Aさん、田中）"
          maxlength="20"
          autocomplete="off"
          spellcheck="false"
          @input="pendingNameError = false"
          @keyup.enter="onConfirmName"
        />
        <div v-if="pendingNameError" class="name-modal-error">名前を入力してください</div>
        <div class="name-modal-actions">
          <button class="btn btn-secondary" @click="onCancelNameModal">キャンセル</button>
          <button class="btn btn-primary" @click="onConfirmName">参加する</button>
        </div>
      </div>
    </div>

    <!-- ── グローバルモーダル（どの画面からでも開ける） ── -->
    <SettingsModal  v-if="settingsSection" :section="settingsSection" :is-guest="syncActive && !syncIsHost" :can-restore="currentView === 'session'" @close="settingsSection = null" @open-upgrade="reason => openUpgrade(reason)" @restore-inventory="onRestoreInventory" />
    <DeleteAccountModal v-if="showDeleteAccount" @close="showDeleteAccount = false" @deleted="onAccountDeleted" />
    <AxisAssignFocus v-if="showAxisAssign" :initial-axis="axisAssignInitial" @close="showAxisAssign = false" />
    <SyncModal      v-if="showSync"     :is-inventory-completed="isCompleted" :auto-create="syncAutoCreate" :room-type="sessionMode === 'order' ? 'order' : 'stock'" @close="showSync = false; syncAutoCreate = false" @newSession="onSyncNewSession" @view-member="openMemberHistory" />
    <MemberHistoryModal v-if="memberHistoryTarget" :participant="memberHistoryTarget" :audit-log="auditLog" :editable="!inputLocked" @edit-item="onMemberHistoryEdit" @close="memberHistoryTarget = null" />
    <ChatModal      v-if="showChat"     @close="showChat = false" />
    <UpgradeModal         v-if="showUpgrade"    :reason="upgradeReason" :twa-mode="isTwaApp()" @close="showUpgrade = false" />
    <BarcodeScanner       v-if="showBarcode"    :recent-code="lastBarcode" @scanned="onBarcodeScanned" @close="showBarcode = false; lastBarcode = ''" />

    <!-- LINE風チャット通知バナー（上部スライドイン） -->
    <Transition name="chat-notif">
      <div v-if="chatNotif" class="chat-notif-banner" @click="chatNotif = null">
        <div class="chat-notif-sender">{{ chatNotif.senderName }}</div>
        <div class="chat-notif-text">{{ chatNotif.text }}</div>
      </div>
    </Transition>

    <!-- PWA 更新バナー -->
    <Transition name="pwa-banner">
      <div v-if="needRefresh" class="pwa-update-banner">
        <span class="pwa-banner-text">🔄 新しいバージョンがあります</span>
        <button class="pwa-banner-btn" @click="updateServiceWorker()">今すぐ更新</button>
      </div>
    </Transition>

    <!-- トースト -->
    <Transition name="toast">
      <div v-if="toastShow" class="toast" :data-type="toastType">{{ toastMsg }}</div>
    </Transition>

    <!-- 初回オンボーディング -->
    <Transition name="onboard">
      <div v-if="showOnboarding" class="onboard-overlay" @click.self="dismissOnboarding">
        <div class="onboard-card">
          <div class="onboard-title">タナオロの使い方</div>
          <ol class="onboard-steps">
            <li class="onboard-step">
              <span class="onboard-icon">🎤</span>
              <div>
                <strong>音声ボタンをタップ</strong>
                <p>「豚バラ 3キロ」「卵 2パック」と話すだけ</p>
              </div>
            </li>
            <li class="onboard-step">
              <span class="onboard-icon">✓</span>
              <div>
                <strong>数量を確認して登録</strong>
                <p>品目が自動で認識されます。数値を確認してタップ</p>
              </div>
            </li>
            <li class="onboard-step">
              <span class="onboard-icon">📋</span>
              <div>
                <strong>品目がない場合は追加</strong>
                <p>「＋ 品目を追加」フォームからその場で登録できます</p>
              </div>
            </li>
            <li class="onboard-step">
              <span class="onboard-icon">🔗</span>
              <div>
                <strong>複数端末で同時入力</strong>
                <p>🔗ボタンからルームを作成、QRコードで仲間を招待</p>
              </div>
            </li>
          </ol>
          <button class="onboard-btn" @click="dismissOnboarding">はじめる</button>
        </div>
      </div>
    </Transition>

    <!-- フィードバックボタン（セッション・一覧画面で表示） -->
    <button
      v-if="currentView === 'session' || currentView === 'sessions'"
      class="feedback-fab"
      @click="openFeedback"
      title="フィードバックを送る"
    >💬</button>

    <!-- フィードバックモーダル -->
    <div v-if="showFeedback" class="feedback-overlay" @click.self="showFeedback = false">
      <div class="feedback-sheet">
        <div class="sheet-handle"></div>
        <div class="feedback-title">フィードバック</div>
        <template v-if="!feedbackSent">
          <p class="feedback-desc">ご意見・ご要望・不具合などをお聞かせください</p>
          <textarea
            v-model="feedbackText"
            class="feedback-textarea"
            placeholder="例：〇〇の操作がわかりにくかった、△△の機能が欲しい"
            rows="5"
            autofocus
          ></textarea>
          <div class="feedback-actions">
            <button class="btn btn-secondary" @click="showFeedback = false">キャンセル</button>
            <button class="btn btn-primary" :disabled="!feedbackText.trim()" @click="submitFeedback">送信</button>
          </div>
        </template>
        <div v-else class="feedback-thanks">
          <div class="feedback-thanks-icon">✓</div>
          <div class="feedback-thanks-text">ありがとうございます！</div>
        </div>
      </div>
    </div>

    <!-- レビュー促進モーダル -->
    <div v-if="showReview" class="feedback-overlay" @click.self="dismissReview">
      <div class="feedback-sheet">
        <div class="sheet-handle"></div>

        <!-- 評価ステップ -->
        <template v-if="reviewStep === 'rating'">
          <div class="feedback-title">タナオロはいかがですか？</div>
          <p class="feedback-desc">3回目の棚卸が完了しました。使い心地を教えてください。</p>
          <div class="review-stars">
            <button
              v-for="s in 5"
              :key="s"
              class="review-star"
              :class="{ filled: s <= reviewRating }"
              @click="onReviewRate(s)"
            >★</button>
          </div>
          <button class="feedback-skip" @click="dismissReview">あとで</button>
        </template>

        <!-- 高評価 ありがとう -->
        <template v-else-if="reviewStep === 'thanks'">
          <div class="feedback-title">ありがとうございます！</div>
          <div class="review-thanks-stars">
            <span v-for="s in reviewRating" :key="s" class="review-star-filled">★</span>
          </div>
          <p class="feedback-desc">ご愛用いただき、誠にありがとうございます。</p>
          <div class="feedback-actions">
            <button class="btn btn-primary" @click="showReview = false">閉じる</button>
          </div>
        </template>

        <!-- 低評価 → フィードバック -->
        <template v-else>
          <div class="feedback-title">改善点を教えてください</div>
          <p class="feedback-desc">より良いアプリにするために、ご意見をお聞かせください。</p>
          <textarea
            v-model="reviewFeedback"
            class="feedback-textarea"
            placeholder="使いにくかった点、欲しい機能など"
            rows="4"
          ></textarea>
          <div class="feedback-actions">
            <button class="btn btn-secondary" @click="dismissReview">スキップ</button>
            <button class="btn btn-primary" @click="submitReviewFeedback">送信</button>
          </div>
        </template>
      </div>
    </div>

  </div>
</template>

<style scoped>
.pro-review-badge {
  position: fixed;
  top: 8px;
  left: 50%;
  z-index: 10020;
  transform: translateX(-50%);
  padding: 5px 10px;
  border: 1px solid #f59e0b;
  border-radius: 999px;
  background: #fffbeb;
  color: #92400e;
  box-shadow: 0 2px 8px rgb(15 23 42 / 18%);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .04em;
  pointer-events: none;
}

/* ── バーコード未登録ヒント ── */
.barcode-add-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #fff7ed;
  border: 1.5px solid #fcd34d;
  border-radius: 10px;
  margin-bottom: 8px;
  font-size: 12px;
  color: #92400e;
  font-weight: 600;
}

.guest-add-hint {
  margin: 0 0 8px;
  padding: 7px 11px;
  background: var(--primary-weak);
  border: 1px solid var(--primary-border);
  border-radius: 9px;
  font-size: 12px;
  font-weight: 600;
  color: var(--primary-deep);
}
.barcode-add-hint code {
  font-family: monospace;
  font-weight: 700;
  color: var(--primary);
  background: var(--primary-weak);
  padding: 1px 5px;
  border-radius: 4px;
}
.barcode-add-icon { flex-shrink: 0; }
.barcode-add-clear {
  margin-left: auto;
  background: none;
  border: none;
  font-size: 14px;
  cursor: pointer;
  color: #92400e;
  padding: 2px 6px;
  flex-shrink: 0;
}

/* ── あとで数える 一覧バナー ── */
.recount-notice {
  margin: 0 16px 8px;
  border: 1.5px solid #fdba74;
  border-radius: 12px;
  overflow: hidden;
}

.recount-notice-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: #fff7ed;
  border: none;
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
  color: #9a3412;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}

.recount-notice-toggle:active { background: #ffedd5; }
.recount-notice-icon  { flex-shrink: 0; }
.recount-notice-label { flex: 1; }
.recount-notice-arrow { font-size: 10px; flex-shrink: 0; }

.recount-notice-body {
  background: #fff;
  border-top: 1px solid #fed7aa;
}

.recount-notice-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 14px;
  border-bottom: 1px solid #f1f5f9;
  gap: 8px;
}

.recount-notice-item:last-child { border-bottom: none; }

.recount-notice-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.recount-notice-qty {
  font-size: 11px;
  font-weight: 700;
  color: var(--primary);
  margin-left: 6px;
}

.recount-notice-empty {
  font-size: 11px;
  color: var(--text-muted);
  margin-left: 6px;
}

.recount-notice-clear {
  flex-shrink: 0;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 700;
  color: #9a3412;
  background: #fff7ed;
  border: 1.5px solid #fdba74;
  border-radius: 8px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.recount-notice-clear:active { background: #ffedd5; }

/* ── 複数人編集品目バナー ── */
.conflict-notice {
  margin: 0 16px 8px;
  border: 1.5px solid #fcd34d;
  border-radius: 12px;
  overflow: hidden;
}

.conflict-notice-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: #fffbeb;
  border: none;
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
  color: #92400e;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}

.conflict-notice-toggle:active { background: #fef3c7; }
.conflict-notice-icon { flex-shrink: 0; }
.conflict-notice-label { flex: 1; }
.conflict-notice-arrow { font-size: 10px; flex-shrink: 0; }

.conflict-notice-body {
  background: #fff;
  border-top: 1px solid #fde68a;
}

.conflict-notice-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 14px;
  border-bottom: 1px solid #f1f5f9;
  cursor: pointer;
  gap: 8px;
  -webkit-tap-highlight-color: transparent;
}

.conflict-notice-item:last-child { border-bottom: none; }
.conflict-notice-item:active { background: #fffbeb; }

.conflict-notice-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conflict-notice-meta {
  font-size: 11px;
  color: #b45309;
  white-space: nowrap;
  flex-shrink: 0;
}

/* ── 進行中ルーム案内 ── */
.active-room-notice {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1500;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 24px;
}

.active-room-notice-body {
  background: #fff;
  border-radius: 20px 20px 16px 16px;
  padding: 24px 20px 20px;
  width: 100%;
  max-width: 480px;
  margin: 0 12px;
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.15);
}

.active-room-notice-title {
  font-size: 16px;
  font-weight: 800;
  color: var(--text);
  margin-bottom: 6px;
}

.active-room-notice-code {
  font-size: 13px;
  color: var(--text-muted);
  font-family: 'SF Mono', 'Menlo', monospace;
  margin-bottom: 18px;
}

.active-room-notice-actions {
  display: flex;
  gap: 10px;
}

/* ── バナー内メッセージボタン ── */
.sync-msg-btn {
  position: relative;
  font-size: 16px;
  padding: 4px 8px;
}

.unread-badge {
  position: absolute;
  top: -3px;
  right: -3px;
  background: var(--danger);
  color: #fff;
  font-size: 9px;
  font-weight: 800;
  border-radius: 50%;
  width: 15px;
  height: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  pointer-events: none;
}

/* ── LINE風チャット通知バナー ── */
.chat-notif-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 4000;
  background: rgba(15, 23, 42, 0.93);
  backdrop-filter: blur(6px);
  color: #f8fafc;
  padding: 14px 18px calc(14px + env(safe-area-inset-top, 0px));
  padding-top: calc(14px + env(safe-area-inset-top, 0px));
  display: flex;
  flex-direction: column;
  gap: 3px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.chat-notif-sender {
  font-size: 11px;
  font-weight: 700;
  color: var(--primary-mid);
  letter-spacing: 0.04em;
}

.chat-notif-text {
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
}

.chat-notif-enter-active { transition: transform 0.25s ease, opacity 0.2s ease; }
.chat-notif-leave-active  { transition: transform 0.3s ease,  opacity 0.25s ease; }
.chat-notif-enter-from,
.chat-notif-leave-to      { transform: translateY(-100%); opacity: 0; }

/* ── 名前設定モーダル ── */
.name-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 3000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.name-modal-sheet {
  background: #fff;
  border-radius: 20px 20px 0 0;
  padding: 20px 20px 40px;
  width: 100%;
  max-width: 480px;
  box-shadow: 0 -4px 24px rgba(0,0,0,0.15);
  animation: slideUp 0.25s ease;
}

@keyframes slideUp {
  from { transform: translateY(100%); }
  to   { transform: translateY(0); }
}

.name-modal-title {
  font-size: 16px;
  font-weight: 800;
  color: var(--text);
  margin-bottom: 14px;
  text-align: center;
}

.name-modal-prev {
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
  margin-bottom: 10px;
}

.name-modal-input {
  width: 100%;
  padding: 14px 16px;
  font-size: 16px;
  font-weight: 600;
  border: 2px solid var(--border);
  border-radius: 12px;
  outline: none;
  box-sizing: border-box;
  margin-bottom: 16px;
  color: var(--text);
  background: var(--bg);
  -webkit-appearance: none;
}
.name-modal-input:focus { border-color: var(--primary); }
.name-modal-input.error { border-color: var(--danger); }

.name-modal-error {
  font-size: 12px;
  font-weight: 600;
  color: var(--danger);
  margin: -10px 0 12px;
}

.name-modal-actions {
  display: flex;
  gap: 10px;
}
.name-modal-actions .btn {
  flex: 1;
  padding: 14px;
  font-size: 15px;
}

/* ── 担当完了 報告済みボタン ── */
.btn-complete.reported {
  background: #6b7280;
  cursor: default;
  opacity: 0.75;
}
.btn-complete:disabled {
  pointer-events: none;
}

/* ── 同時入力 競合解決 ── */
.conflict-resolve-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 16px 8px;
}

.conflict-resolve-card {
  background: #fff;
  border: 2px solid #f59e0b;
  border-radius: 14px;
  padding: 14px 16px 12px;
  box-shadow: 0 2px 12px rgba(245,158,11,0.15);
}

.conflict-resolve-title {
  font-size: 13px;
  font-weight: 800;
  color: #92400e;
  margin-bottom: 8px;
}

.conflict-resolve-vals {
  font-size: 13px;
  color: var(--text);
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.conflict-resolve-vals .crv-mine   { font-weight: 700; color: var(--primary); }
.conflict-resolve-vals .crv-sep    { color: var(--text-muted); }
.conflict-resolve-vals .crv-theirs { font-weight: 700; color: #dc2626; }

.conflict-resolve-actions {
  display: flex;
  gap: 8px;
}

.crv-btn {
  flex: 1;
  padding: 9px 4px;
  font-size: 12px;
  font-weight: 700;
  border-radius: 9px;
  border: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: opacity 0.15s;
}
.crv-btn:active { opacity: 0.75; }

.crv-btn.crv-sum    { background: #d1fae5; color: #065f46; }
.crv-btn.crv-mine   { background: var(--primary-soft); color: var(--primary-deep); }
.crv-btn.crv-theirs { background: #fee2e2; color: #991b1b; }

/* ── ゲスト品目追加申請 ── */
.item-req-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 16px 8px;
}

.item-req-card {
  background: #fff;
  border: 2px solid var(--primary);
  border-radius: 14px;
  padding: 12px 14px 10px;
  box-shadow: 0 2px 10px rgba(99,102,241,0.12);
  display: flex;
  align-items: center;
  gap: 10px;
}

.item-req-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.item-req-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.item-req-text {
  font-size: 13px;
  color: var(--text);
  line-height: 1.4;
}

.item-req-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.item-req-btn {
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 700;
  border-radius: 9px;
  border: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: opacity 0.15s;
}
.item-req-btn:active { opacity: 0.75; }
.item-req-approve { background: #d1fae5; color: #065f46; }
.item-req-reject  { background: #fee2e2; color: #991b1b; }

.item-req-pending-guest {
  margin: 0 16px 8px;
  background: var(--primary-weak);
  border: 1.5px solid var(--primary-mid);
  border-radius: 12px;
  padding: 10px 14px;
  font-size: 13px;
  color: var(--primary-deep);
  display: flex;
  align-items: center;
  gap: 8px;
}

.item-req-pending-icon { font-size: 16px; }

.item-req-pending-cancel {
  margin-left: auto;
  background: none;
  border: 1px solid var(--primary-mid);
  border-radius: 7px;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--primary-bright);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* ── 初回オンボーディング ── */
.onboard-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.72);
  backdrop-filter: blur(4px);
  z-index: 5000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.onboard-card {
  background: #fff;
  border-radius: 20px;
  padding: 28px 24px 24px;
  width: 100%;
  max-width: 400px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  animation: onboardIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes onboardIn {
  from { transform: scale(0.88) translateY(20px); opacity: 0; }
  to   { transform: scale(1)    translateY(0);    opacity: 1; }
}

.onboard-title {
  font-size: 18px;
  font-weight: 800;
  color: var(--text);
  text-align: center;
  margin-bottom: 22px;
  letter-spacing: -0.02em;
}

.onboard-steps {
  list-style: none;
  padding: 0;
  margin: 0 0 22px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.onboard-step {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.onboard-icon {
  font-size: 22px;
  width: 38px;
  height: 38px;
  background: #f0f6ff;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  line-height: 1;
}

.onboard-step strong {
  display: block;
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 2px;
}

.onboard-step p {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
  line-height: 1.5;
}

.onboard-btn {
  width: 100%;
  padding: 15px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 14px;
  font-size: 16px;
  font-weight: 800;
  cursor: pointer;
  letter-spacing: 0.02em;
  -webkit-tap-highlight-color: transparent;
  transition: opacity 0.15s;
}
.onboard-btn:active { opacity: 0.85; }

.onboard-enter-active { transition: opacity 0.2s ease; }
.onboard-leave-active { transition: opacity 0.25s ease; }
.onboard-enter-from,
.onboard-leave-to     { opacity: 0; }

/* ── フィードバック FAB ── */
.feedback-fab {
  position: fixed;
  bottom: calc(80px + env(safe-area-inset-bottom, 0px));
  right: 16px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  border: none;
  font-size: 18px;
  cursor: pointer;
  box-shadow: 0 3px 12px rgba(37, 99, 235, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 800;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.15s, box-shadow 0.15s;
}
.feedback-fab:active {
  transform: scale(0.92);
  box-shadow: 0 1px 6px rgba(37, 99, 235, 0.25);
}

/* ── フィードバック / レビュー モーダル ── */
.feedback-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 3500;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.feedback-sheet {
  background: #fff;
  border-radius: 20px 20px 0 0;
  padding: 20px 20px calc(32px + env(safe-area-inset-bottom, 0px));
  width: 100%;
  max-width: 480px;
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.15);
  animation: slideUp 0.25s ease;
}

.feedback-title {
  font-size: 17px;
  font-weight: 800;
  color: var(--text);
  margin-bottom: 6px;
  text-align: center;
}

.feedback-desc {
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
  margin: 0 0 16px;
  line-height: 1.5;
}

.feedback-textarea {
  width: 100%;
  padding: 12px 14px;
  font-size: 15px;
  border: 2px solid var(--border);
  border-radius: 12px;
  outline: none;
  resize: none;
  font-family: inherit;
  color: var(--text);
  background: var(--bg);
  box-sizing: border-box;
  margin-bottom: 14px;
  -webkit-appearance: none;
  line-height: 1.5;
}
.feedback-textarea:focus { border-color: var(--primary); }

.feedback-actions {
  display: flex;
  gap: 10px;
}
.feedback-actions .btn { flex: 1; padding: 14px; font-size: 15px; }

.feedback-skip {
  display: block;
  margin: 12px auto 0;
  background: none;
  border: none;
  font-size: 13px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 6px 12px;
  -webkit-tap-highlight-color: transparent;
}

.feedback-thanks {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 0 8px;
  gap: 10px;
}
.feedback-thanks-icon {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #d1fae5;
  color: #065f46;
  font-size: 26px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
}
.feedback-thanks-text {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}

/* ── レビュー星 ── */
.review-stars {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin: 8px 0 20px;
}
.review-star {
  font-size: 38px;
  background: none;
  border: none;
  cursor: pointer;
  color: #d1d5db;
  transition: color 0.15s, transform 0.1s;
  -webkit-tap-highlight-color: transparent;
  line-height: 1;
  padding: 4px;
}
.review-star.filled { color: #f59e0b; }
.review-star:active  { transform: scale(1.2); }

.review-thanks-stars {
  display: flex;
  justify-content: center;
  gap: 4px;
  margin: 8px 0 12px;
}
.review-star-filled {
  font-size: 28px;
  color: #f59e0b;
}
</style>
