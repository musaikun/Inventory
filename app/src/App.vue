<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { saveLearningSession, computeLearnedOrder, getLateRecountItems } from './composables/useLearning.js'
import { useVoice, parseText } from './composables/useVoice.js'
import { useInventory, applyRemoteUpdate, applyRemoteRemove, applyRemoteRecountFlag } from './composables/useInventory.js'
import { useConfig, applyRemoteConfig, setConfigChangedCallback } from './composables/useConfig.js'
import { useHistory } from './composables/useHistory.js'
import {
  useSync,
  setInventoryCallbacks, registerInventoryGetter,
  setRecountFlagCallback, registerRecountFlagsGetter,
  registerConfigGetter, setConfigCallback,
  setDoneCallback, setMessageCallback, setDissolvedCallback, setConflictCallback,
  setNameTakenCallback, setParticipantJoinCallback, setParticipantLeaveCallback,
  setGuestLeaveCallback, setRemoteUpdateCallback, setClearInventoryCallback,
  setScopeCallback, setSessionEndedCallback, setNewSessionStartedCallback, setResetConfigCallback,
  broadcastUpdate, broadcastRemove, broadcastDone, broadcastUndone, broadcastConfig, broadcastScope,
  broadcastSessionEnd, broadcastSessionStart, broadcastRecountFlag,
  markMessagesRead, addLocalAuditEntry, clearAuditLog, restoreSession,
  getSavedGuestSession, discardSavedSession,
} from './composables/useSync.js'
import { deviceId, deviceName, setDeviceName } from './composables/useDeviceId.js'
import {
  shopCode,
  loadStore, saveConfigToD1, saveSnapshotToD1, deleteSnapshotFromD1,
  loadHistoryFromD1, loadConfigFromD1, updateActiveRoomInD1,
} from './composables/useStore.js'
import { isAuthenticated } from './composables/useAuth.js'
import { useSession } from './composables/useSession.js'
import VoiceButton from './components/VoiceButton.vue'
import ConfirmModal from './components/ConfirmModal.vue'
import CandidateModal from './components/CandidateModal.vue'
import InventoryTable from './components/InventoryTable.vue'
import SettingsModal from './components/SettingsModal.vue'
import HistoryModal from './components/HistoryModal.vue'
import SyncModal from './components/SyncModal.vue'
import ChatModal from './components/ChatModal.vue'
import LandingPage from './components/LandingPage.vue'
import AuthPage from './components/AuthPage.vue'
import SessionListPage from './components/SessionListPage.vue'
import SessionDetailPage from './components/SessionDetailPage.vue'

// ── Config（動的品目リスト）────────────────────────────────────────────────────
const { config, dictionary, masterDict, registerAlias, resetToDefault } = useConfig()

// ── Inventory ──────────────────────────────────────────────────────────────────
const {
  inventory, recountFlags, filledCount, totalValue,
  isCompleted, completedAt,
  entryLog,
  setItem, updateQty, removeItem, setRecountFlag, reset, exportCSV,
  completeSession,
} = useInventory()

// ── History ────────────────────────────────────────────────────────────────────
const { saveSnapshot, applyRemoteHistory, deleteSnapshotLocal, getSnapshots, getSnapshotBySessionId } = useHistory()

// ── 画面管理 ───────────────────────────────────────────────────────────────────
// 'landing' | 'auth' | 'sessions' | 'session' | 'session-detail'
const currentView   = ref('landing')
const detailSnapshot = ref(null)
// セッションライフサイクル（D1 状態遷移はすべて useSession 経由）
const {
  pendingSession,
  begin: beginSession, resume: resumeSession, restore: restorePendingSession,
  touch: touchSession, markActive: markSessionActive, complete: completeSessionD1,
  clear: clearSession,
} = useSession()

// ── ルーム参加前の名前設定 ────────────────────────────────────────────────────
const pendingJoinCode  = ref(null)
const showNameModal    = ref(false)
const pendingName      = ref('')
const pendingNameError = ref(false)

function _askNameAndJoin(code) {
  pendingJoinCode.value  = code
  pendingName.value      = deviceName.value || ''
  pendingNameError.value = false
  showNameModal.value    = true
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
  pendingJoinCode.value = null
  currentView.value     = 'session'
  try {
    await joinRoom(code)
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
    _askNameAndJoin(payload.joinRoom)
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

async function _startSessionView({ loadConfig = true } = {}) {
  currentView.value = 'session'
  try {
    const [remoteConfig, remoteHistory] = await Promise.all([
      loadConfig ? loadConfigFromD1() : Promise.resolve(null),
      loadHistoryFromD1(),
    ])
    if (loadConfig && remoteConfig?.order?.length) applyRemoteConfig(remoteConfig)
    if (remoteHistory?.length) applyRemoteHistory(remoteHistory)
  } catch (_) {
    // ネットワークエラーは無視してローカルデータで継続
  }
}

// 認証後にセッション一覧へ
function onAuthDone() {
  currentView.value = 'sessions'
}

// セッション一覧から「セッション開始」
async function onSessionStart(session) {
  beginSession(session)
  reset()
  clearAuditLog()
  resetToDefault()   // 新規セッションは毎回 PDF/CSV/Excel からインポートさせる
  await _startSessionView({ loadConfig: false })
}

// セッション一覧から「完了済みセッション詳細」
function onViewSession(session) {
  let snap = getSnapshotBySessionId(session.id)
  if (!snap) {
    const dateKey = (session.endedAt ?? session.startedAt ?? '').slice(0, 10)
    if (dateKey) snap = getSnapshots().find(s => s.date === dateKey) ?? null
  }
  if (!snap) {
    showToast('この端末での棚卸データが見つかりません', 3000, 'warning')
    return
  }
  detailSnapshot.value = snap
  currentView.value = 'session-detail'
}

// セッション一覧から「再開」
async function onSessionResume(session) {
  resumeSession(session)
  await _startSessionView()
  // 未完了セッションは自動でルームに復帰（ゲストが接続中の場合も含む）
  if (!isCompleted.value && shopCode.value && !syncActive.value) {
    _reconnectToRoom(session)
  }
}

// ルーム自動復帰（再開時・非同期・失敗は無視）
async function _reconnectToRoom(session) {
  try {
    await createRoom()
    // joined 処理後に DO のセッション ID と一致するか確認
    const doSessionId = syncState.sessionId
    if (syncState.isSessionActive && doSessionId === session.id) {
      // 同一セッションが有効: ルームに復帰完了、session_start 不要
      showToast(`ルーム ${syncState.roomCode} に復帰しました`, 2500, 'join')
    } else {
      // セッション不一致 or 非アクティブ: セッションを再アクティブ化
      onSyncNewSession({ sessionId: session.id, isResume: true })
    }
  } catch (_) {
    // 接続失敗は無視（オフライン動作継続）
  }
}

// ── Settings / History / Sync modal ────────────────────────────────────────────
const showSettings     = ref(false)
const showHistory      = ref(false)
const showSync         = ref(false)
const inventoryTableRef = ref(null)

// ── Sync ───────────────────────────────────────────────────────────────────────
const { state: syncState, isActive: syncActive, isHost: syncIsHost, participantList, createRoom, joinRoom, leaveRoom, dissolveRoom, unreadCount, auditLog } = useSync()

// ── 学習順 ────────────────────────────────────────────────────────────────────
const learnedOrderVersion = ref(0) // saveLearningSession 後にインクリメント
const learnedOrder = computed(() => {
  learnedOrderVersion.value // reactive dependency
  return computeLearnedOrder(config.order)
})
const lateRecountItems = computed(() => getLateRecountItems(auditLog))

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
registerConfigGetter(() => ({
  order:         config.order,
  units:         config.units,
  prices:        config.prices,
  categories:    config.categories,
  codes:         config.codes,
  categoryCodes: config.categoryCodes,
  prevMonths:    config.prevMonths,
  lotSizes:      config.lotSizes,
  dictionary:    config.dictionary,
  isCustom:      config.isCustom,
}))
setConfigCallback((cfg) => {
  applyRemoteConfig(cfg)
  if (syncActive.value && !syncIsHost.value) {
    showToast('品目一覧が更新されました', 3000, 'update')
  }
})
// ホストに品目リストが無いルームへ参加した場合はデフォルトへ復帰
setResetConfigCallback(() => resetToDefault())

let _configSaveTimer = null
setConfigChangedCallback(() => {
  clearTimeout(_configSaveTimer)
  _configSaveTimer = setTimeout(() => {
    saveConfigToD1({
      order:         config.order,
      units:         config.units,
      prices:        config.prices,
      categories:    config.categories,
      codes:         config.codes,
      categoryCodes: config.categoryCodes,
      prevMonths:    config.prevMonths,
      lotSizes:      config.lotSizes,
      dictionary:    config.dictionary,
    })
  }, 2000)
})
setDoneCallback((name, isFinal) => {
  const msg = isFinal
    ? `棚卸が締められました。入力を終了してください。`
    : `${name} が棚卸完了を報告しました ✓`
  showNotification('done', msg)
})
setMessageCallback((msgObj) => {
  // チャット画面が開いていないときだけポップアップ通知
  if (!showChat.value) showNotification('message', msgObj.text, msgObj.senderName)
})
setDissolvedCallback(() => {
  showChat.value = false
  showSync.value = false
  showToast('ルームが閉鎖されました', 4000, 'error')
  const selfDissolved = _hostInitiatedDissolve
  _hostInitiatedDissolve = false
  if (!selfDissolved) {
    setTimeout(() => {
      clearSession()
      reset()
      resetToDefault()
      clearAuditLog()
      currentView.value = 'landing'
    }, 3500)
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
  resetToDefault()
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
setNameTakenCallback((prevName) => {
  setDeviceName(prevName)
  showToast('この端末名は既に使用されています', 4000, 'warning')
})
setRemoteUpdateCallback((ingredient, qty, unit, by) => {
  const who = by || '他のメンバー'
  const msg  = qty === null
    ? `${who}: 「${ingredient}」を削除`
    : `${who}: 「${ingredient}」${qty}${unit}`
  showToast(msg, 2800, 'update')
})
setScopeCallback((scope) => {
  if (!syncIsHost.value) categoryScope.value = scope
})
setSessionEndedCallback(async (status, sessionId, itemCount) => {
  const count = itemCount ?? filledCount.value ?? 0
  if (status === 'completed') await completeSessionD1(count)

  if (!syncIsHost.value && status === 'completed') {
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

// URL パラメータ ?room=CODE / ?store=CODE があれば自動参加（ホーム画面をスキップ）
onMounted(async () => {
  const params = new URLSearchParams(window.location.search)
  const roomCode   = params.get('room')
  const storeParam = params.get('store')

  if (roomCode) {
    const url = new URL(window.location.href)
    url.searchParams.delete('room')
    history.replaceState({}, '', url.pathname + (url.search !== '?' ? url.search : ''))
    _askNameAndJoin(roomCode)
  } else if (storeParam) {
    // 店舗コード = ルームコード（統一済み）なので D1 経由不要で直接参加
    const url = new URL(window.location.href)
    url.searchParams.delete('store')
    history.replaceState({}, '', url.pathname + (url.search !== '?' ? url.search : ''))
    _askNameAndJoin(storeParam)
  } else {
    // ホストセッションのみ自動復元（ゲストは再参加バナーで確認）
    restoreSession()
    const guestSession = getSavedGuestSession()
    if (guestSession) savedGuestRoomCode.value = guestSession.roomCode

    // 認証済み: 進行中の棚卸があれば棚卸画面へ直接復帰、なければ一覧へ
    if (isAuthenticated.value) {
      if (!isCompleted.value) restorePendingSession()
      currentView.value = (pendingSession.value?.id && !isCompleted.value)
        ? 'session'
        : 'sessions'
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
      if (remoteConfig?.order?.length) applyRemoteConfig(remoteConfig)
      if (remoteHistory?.length)       applyRemoteHistory(remoteHistory)
    } catch (_) {
      // ネットワークエラーは無視してローカルデータで継続
    }
  }
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
const guestLocked  = computed(() => syncActive.value && !syncIsHost.value && guestReported.value)
const inputLocked  = computed(() => isCompleted.value || guestLocked.value)

// 入力中の品目数を D1 に保存（active）。直列化・確定後の無視は useSession が担当
watch(filledCount, (count) => {
  if (currentView.value !== 'session' || isCompleted.value) return
  touchSession(count)
})

// ── ゲスト再参加バナー ──────────────────────────────────────────────────────────
const savedGuestRoomCode = ref(null)

function onRejoinSaved() {
  const code = savedGuestRoomCode.value
  savedGuestRoomCode.value = null
  discardSavedSession()
  _askNameAndJoin(code)
}

function onSkipRejoin() {
  savedGuestRoomCode.value = null
  discardSavedSession()
}

// ── セッション管理 ─────────────────────────────────────────────────────────────
const completedAtDisplay = computed(() => {
  if (!completedAt.value) return ''
  const d = new Date(completedAt.value)
  return d.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
})

async function onComplete() {
  if (filledCount.value === 0) {
    showToast('1件以上入力してから完了してください', 2600, 'warning')
    return
  }

  // ゲスト（ルーム参加中）: 完了報告のみ。画面ロック・スナップショット保存は行わない
  if (syncActive.value && !syncIsHost.value) {
    if (!confirm('棚卸完了をルームに報告しますか？\n完了後は入力がロックされますが、ホストが棚卸を締めるまで再開できます。')) return
    broadcastDone()
    guestReported.value = true
    if (continuousMode.value) onForceStop()
    showToast('棚卸完了を報告しました ✓', 3000, 'success')
    return
  }

  // ホスト or ソロ: 棚卸を締める
  const isHostInRoom = syncActive.value && syncIsHost.value
  const confirmMsg = isHostInRoom
    ? '棚卸を完了しますか？\nゲストへ完了通知を送り、ルームを閉鎖します。'
    : '棚卸を完了しますか？\n完了後は読み取り専用になります。'
  if (!confirm(confirmMsg)) return

  completeSession()
  const snapshot = saveSnapshot(inventory, config.prices, config.order, config.codes, entryLog, auditLog, recountFlags, config.categories, pendingSession.value?.id)
  if (snapshot) saveSnapshotToD1(snapshot)
  completeSessionD1(filledCount.value)
  saveLearningSession(auditLog, config.order, syncActive.value ? participantList.length : 1)
  learnedOrderVersion.value++
  if (continuousMode.value) onForceStop()

  if (isHostInRoom) {
    broadcastSessionEnd('completed')
    _hostInitiatedDissolve = true
    await dissolveRoom()
    clearSession()
    currentView.value = 'sessions'
    return
  }

  showToast('棚卸を完了しました ✓', 3000, 'success')
}


function onUndone() {
  broadcastUndone()
  guestReported.value = false
  showToast('棚卸を再開しました', 2500, 'default')
}

// メイン画面のホームアイコン → セッション一覧へ戻る
async function onGoHome() {
  const hasData = filledCount.value > 0

  // ホスト中のみ確認（ホストは退出するがルームは残り、ゲストは継続できる）
  if (!isCompleted.value && syncIsHost.value && syncActive.value) {
    if (!confirm('セッション一覧に戻ります。\nゲストはそのまま棚卸を続けられます。\nよろしいですか？')) return
  }

  // ホストでも解散せず退出するだけ（ルームは残りゲストは継続できる）
  if (syncActive.value) leaveRoom()

  // 状態を書き込んでから遷移（完了は completed、未完了は進行中=active のまま品目数を確定保存）
  if (isCompleted.value)  await completeSessionD1(filledCount.value)
  else                    await markSessionActive(filledCount.value)

  if (continuousMode.value) onForceStop()
  clearSession()
  showSync.value = false
  showChat.value = false
  currentView.value = 'sessions'
}

// 完了後に新規棚卸を開始
async function onStartNew() {
  // ホスト中はルームを解散してから開始（ゲストと在庫が乖離するのを防ぐ）
  if (syncIsHost.value && syncActive.value) {
    if (!confirm('新規棚卸を開始するにはルームを解散します。よろしいですか？')) return
    _hostInitiatedDissolve = true
    await dissolveRoom()
  }
  reset()
  clearAuditLog()
  if (continuousMode.value) onForceStop()
}

// SyncModal からの「✓ 棚卸を完了」
// ホスト: スナップショット保存 + D1完了 + ゲストへ完了通知 + ルーム解散 → セッション一覧へ
async function onSyncComplete() {
  completeSession()
  const snapshot = saveSnapshot(inventory, config.prices, config.order, config.codes, entryLog, auditLog, recountFlags, config.categories, pendingSession.value?.id)
  if (snapshot) saveSnapshotToD1(snapshot)
  await completeSessionD1(filledCount.value)
  saveLearningSession(auditLog, config.order, participantList.length || 1)
  learnedOrderVersion.value++
  broadcastSessionEnd('completed')
  if (continuousMode.value) onForceStop()
  showSync.value = false
  _hostInitiatedDissolve = true
  await dissolveRoom()
  clearSession()
  currentView.value = 'sessions'
}

// SyncModal からの新規セッション開始（在庫をDOへ送信）
function onSyncNewSession({ sessionId, isResume }) {
  if (!isResume) {
    // 新規セッションは必ずリセット。
    // joined 受信時に DO の古い在庫がローカルに流れ込む場合があるため、
    // isResume=false では無条件にリセットして汚染を防ぐ。
    reset()
    clearAuditLog()
  }
  broadcastSessionStart(sessionId)
}

// ── ログアウト（店舗切り替え）────────────────────────────────────────────────────
async function onLogout() {
  // ルーム接続中は適切に切断してからログアウト
  if (syncIsHost.value) {
    _hostInitiatedDissolve = true
    await dissolveRoom()            // ホスト → ルーム解散（ゲストに通知）
  } else if (syncActive.value) {
    leaveRoom()                     // ゲスト → 退出（_onGuestLeave が reset/navigate を担当）
    return                          // コールバック側でランディングへ遷移するため終了
  }
  reset()
  resetToDefault()
  clearAuditLog()
  currentView.value = 'landing'
}

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

// ── 通知ポップアップ（完了通知・メッセージ・解散通知）──────────────────────────
const notification     = ref(null)  // { type, text, senderName }
let   notificationTimer = null

function showNotification(type, text, senderName = '') {
  clearTimeout(notificationTimer)
  notification.value = { type, text, senderName }
  notificationTimer = setTimeout(() => { notification.value = null }, 6000)
}

// ── チャットモーダル ───────────────────────────────────────────────────────────
const showChat = ref(false)
watch(showChat, (val) => { if (val) markMessagesRead() })

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
    broadcastConfig({
      order:         config.order,
      units:         config.units,
      prices:        config.prices,
      categories:    config.categories,
      codes:         config.codes,
      categoryCodes: config.categoryCodes,
      prevMonths:    config.prevMonths,
      lotSizes:      config.lotSizes,
      dictionary:    config.dictionary,
      isCustom:      config.isCustom,
    })
  }, 300)
}, { deep: true })

// ── ルームコード変更を D1 に反映（ルーム作成・解散の追跡）──────────────────────
watch(() => syncState.roomCode, (code) => {
  if (shopCode.value) updateActiveRoomInD1(code ?? null)
})

// ── Dictionary matching ────────────────────────────────────────────────────────
function normalize(str) {
  return str
    .normalize('NFKC')  // 半角カタカナ→全角カタカナ、全角英数→半角英数
    .toLowerCase()
    .replace(/\s/g, '')
    .replace(/[\u30A1-\u30F6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))  // カタカナ→ひらがな
}

function scoreMatch(nTarget, nInput) {
  if (nTarget === nInput)              return 1000
  if (nTarget.startsWith(nInput))     return 500 + nInput.length
  if (nInput.startsWith(nTarget))     return 400 + nTarget.length
  if (nTarget.includes(nInput))       return 300 + nInput.length
  if (nInput.includes(nTarget))       return 200 + nTarget.length
  return 0
}

// 資材・備品系品目が存在する場合のみ除外チップを表示
function isSupplyItem(canonical) {
  const cat = config.categories?.[canonical]
  if (!cat) return false
  return cat.includes('資材') || cat.includes('備品') || cat.includes('その他')
}

const hasSupplyItems = computed(() => config.order.some(item => isSupplyItem(item)))
// 棚卸対象スコープ: 'all' | 'food'（食材のみ） | 'supply'（資材・備品のみ）
// 検索・棚卸一覧の両方を絞り込む
const categoryScope = ref('all')

// ホストの絞り込みスコープをゲストに同期（宣言後に配置しないと TDZ エラーになる）
watch(categoryScope, (scope) => {
  if (syncIsHost.value && syncActive.value) broadcastScope(scope)
})

function findCandidates(name) {
  if (!name) return []
  const nInput = normalize(name)
  const seen   = new Map()

  // ① 辞書エイリアスとのマッチ（CSV定義 + 自動学習済み）
  for (const [alias, canonical] of Object.entries(dictionary.value)) {
    const score = scoreMatch(normalize(alias), nInput)
    if (score > 0 && score > (seen.get(canonical) ?? 0)) seen.set(canonical, score)
  }

  // ② 正式品目名そのものともマッチ（"コーヒー豆" → "コーヒー豆 ブラジル..." を拾う）
  for (const canonical of config.order) {
    const score = scoreMatch(normalize(canonical), nInput)
    // エイリアス経由より若干低いスコアで登録（エイリアスを優先）
    const adjusted = score > 0 ? Math.max(score - 50, 1) : 0
    if (adjusted > 0 && adjusted > (seen.get(canonical) ?? 0)) seen.set(canonical, adjusted)
  }

  // ③ マスター辞書（1キーワード→複数品目）
  for (const [keyword, canonicals] of Object.entries(masterDict)) {
    const score = scoreMatch(normalize(keyword), nInput)
    if (score > 0) {
      for (const canonical of canonicals) {
        if (!config.order.includes(canonical)) continue
        if (score > (seen.get(canonical) ?? 0)) seen.set(canonical, score)
      }
    }
  }

  let results = [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)

  if (categoryScope.value === 'food') {
    results = results.filter(c => !isSupplyItem(c))
  } else if (categoryScope.value === 'supply') {
    results = results.filter(c => isSupplyItem(c))
  }

  return results
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
  candidateState.value = { searchTerm: name ?? raw, matched, qty, unit }
}

// ── Voice（連続入力がデフォルト動作）─────────────────────────────────────────
const continuousMode = ref(false)

function onVoiceResult(raw) {
  searchText.value   = raw
  searchStatus.value = ''
  runSearch(raw)
}

const { isListening, liveText, start: startVoice, stop: stopVoice } = useVoice(onVoiceResult)

watch(liveText, v => {
  if (isListening.value) {
    searchText.value   = v
    searchStatus.value = 'active'
  }
})

/** ボタンタップの挙動:
 *  - 停止中（非連続）     → 連続モード開始＋認識開始
 *  - 連続モード＋認識中   → 連続モード停止＋認識停止
 *  - 連続モード＋待機中   → 認識を再開（連続モードは継続）
 */
function onVoiceButtonTap() {
  if (!continuousMode.value) {
    continuousMode.value = true
    startVoice()
  } else if (isListening.value) {
    continuousMode.value = false
    stopVoice()
  } else {
    // 待機中 → 再開
    startVoice()
  }
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
function openConfirm(ingredient, qty, unit, source = 'search') {
  // TR行がfocusを持ったままだとEnterキーがTRの@keydownとModalのhandleKeydown
  // 両方に発火し、確定と同時に openConfirm(A) が再度呼ばれるバグを防ぐ
  document.activeElement?.blur()
  // 数値入力モーダル中は音声認識を止める（確定/キャンセル後に _restartIfContinuous が再開する）
  if (isListening.value) stopVoice()
  // PDF登録済みの単位を優先し、ロック状態にする
  const configUnit = config.units?.[ingredient]
  confirmState.value = {
    ingredient,
    qty,
    unit:       configUnit || unit || '',
    unitLocked: !!configUnit,
    source,
    lotSize:    config.lotSizes?.[ingredient] ?? '',
  }
}

function onConfirm({ ingredient, qty, unit, isAdd }) {
  const existing  = confirmExisting.value
  const source    = confirmState.value.source
  const rawFinal  = isAdd && existing ? existing.qty + qty : qty
  const finalQty  = Math.round(rawFinal * 10000) / 10000
  setItem(ingredient, qty, unit, isAdd, deviceName.value || '名前未設定')
  if (!syncActive.value) {
    const action = !existing ? 'new' : isAdd ? 'add' : 'overwrite'
    _localAudit(ingredient, action, isAdd ? qty : finalQty, finalQty, unit)
  }
  if (syncActive.value) broadcastUpdate(ingredient, finalQty, unit, deviceName.value || '名前未設定', isAdd && !!existing)
  showToast(isAdd ? `${ingredient} に追加しました` : `${ingredient} を更新しました`)
  searchText.value   = ''
  searchStatus.value = ''

  if (source === 'table') {
    // テーブルタップ確定後 → 次の品目を自動オープン
    const nextItem = inventoryTableRef.value?.getNextVisibleItem(ingredient)
    if (nextItem) {
      openConfirm(nextItem, null, config.units?.[nextItem] || '', 'table')
    } else {
      confirmState.value = null
    }
  } else if (pendingCandidates.value) {
    // 検索候補から選んで確定 → 残りの候補を再表示
    candidateState.value = { ...pendingCandidates.value }
    pendingCandidates.value = null
    confirmState.value = null
  } else {
    confirmState.value = null
    nextTick(() => searchInputRef.value?.focus())
  }
  _restartIfContinuous()
}

function onCancelConfirm() {
  confirmState.value = null
  pendingCandidates.value = null
  _restartIfContinuous()
}

function onConfirmRevert(prevState) {
  const ingredient = confirmState.value.ingredient
  const cur = confirmExisting.value
  if (!prevState) {
    removeItem(ingredient)
    if (syncActive.value) broadcastRemove(ingredient)
    else _localAudit(ingredient, 'remove', -(cur?.qty ?? 0), 0, cur?.unit ?? '')
    showToast(`「${ingredient}」を未入力に戻しました`)
  } else {
    setItem(ingredient, prevState.qty, prevState.unit, false, deviceName.value || '名前未設定')
    if (syncActive.value) broadcastUpdate(ingredient, prevState.qty, prevState.unit, deviceName.value || '名前未設定', false)
    else _localAudit(ingredient, 'overwrite', prevState.qty, prevState.qty, prevState.unit)
    showToast(`「${ingredient}」を ${prevState.qty}${prevState.unit} に戻しました`)
  }
  confirmState.value = null
  _restartIfContinuous()
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
function onTableTap(item) {
  if (inputLocked.value) return
  openConfirm(item, null, config.units?.[item] || '', 'table')
}

// ── Table handlers ─────────────────────────────────────────────────────────────
function onTableUpdate({ item, qty, unit }) {
  updateQty(item, qty, unit, deviceName.value || '名前未設定')
  if (syncActive.value) broadcastUpdate(item, qty, unit, deviceName.value || '名前未設定')
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
</script>

<template>
  <div id="app">

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
      @start-session="onSessionStart"
      @resume-session="onSessionResume"
      @view-session="onViewSession"
      @back="currentView = 'landing'"
    />

    <!-- ── セッション詳細（完了済み） ── -->
    <SessionDetailPage
      v-else-if="currentView === 'session-detail' && detailSnapshot"
      :snapshot="detailSnapshot"
      @back="currentView = 'sessions'"
    />

    <!-- ── ランディング ── -->
    <LandingPage v-else-if="currentView === 'landing'" @started="onLandingStarted" />

    <!-- 前回のゲストセッション再参加バナー -->
    <Transition name="rejoin-slide">
      <div v-if="currentView === 'landing' && savedGuestRoomCode" class="rejoin-banner">
        <div class="rejoin-text">
          前回ルーム <strong>{{ savedGuestRoomCode }}</strong> に参加していました
        </div>
        <div class="rejoin-actions">
          <button class="rejoin-btn rejoin-skip" @click="onSkipRejoin">スキップ</button>
          <button class="rejoin-btn rejoin-join" @click="onRejoinSaved">再参加</button>
        </div>
      </div>
    </Transition>

    <!-- ── セッション ── -->
    <template v-if="currentView === 'session'">

      <!-- ヘッダー -->
      <header class="app-header">
        <div class="header-left">
          <button v-if="isAuthenticated" class="settings-btn home-btn" @click="onGoHome" title="セッション一覧に戻る">🏠</button>
        </div>
        <div class="header-right">
          <div v-if="deviceName" class="device-badge">{{ deviceName }}</div>
          <div class="date">{{ dateStr }}</div>
          <button
            class="settings-btn sync-btn"
            :class="{ active: syncActive }"
            @click="showSync = true"
            :title="syncActive ? `ルーム ${syncState.roomCode}（${participantList.length}名）` : '複数デバイス同期'"
          >
            <span v-if="syncActive" class="sync-badge">
              🔗<span class="sync-count">{{ participantList.length }}</span>
            </span>
            <span v-else>🔗</span>
          </button>
          <button class="settings-btn" @click="showHistory = true" title="棚卸履歴">📅</button>
          <button class="settings-btn" @click="showSettings = true" title="品目リスト設定">⚙️</button>
        </div>
      </header>

      <!-- 同期中バナー -->
      <div v-if="syncActive" class="sync-banner">
        <div class="sync-banner-top">
          <span class="sync-banner-dot"></span>
          <span class="sync-banner-text">
            <strong>{{ syncIsHost ? 'ホスト中' : '参加中' }}</strong>
            ・ルーム {{ syncState.roomCode }}
          </span>
          <button class="sync-banner-btn sync-msg-btn" @click="showChat = true" title="チャット">
            💬<span v-if="unreadCount > 0" class="unread-badge">!</span>
          </button>
          <button class="sync-banner-btn" @click="showSync = true">詳細</button>
        </div>
        <div class="sync-banner-participants">
          <span
            v-for="p in participantList"
            :key="p.id"
            class="sync-participant-chip"
            :class="{ done: p.isDone, me: p.isMe }"
          >{{ p.name }}<span v-if="p.isDone" class="chip-check"> ✓</span></span>
        </div>
      </div>

      <!-- 棚卸完了バナー -->
      <div v-if="isCompleted" class="complete-banner">
        <span class="complete-icon">✓</span>
        <span class="complete-text">棚卸完了 — {{ completedAtDisplay }}</span>
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
            placeholder="例：ブラジル 3袋　（音声 or 入力）"
            @keyup.enter="onTextSearch"
            @focus="onSearchFocus"
          />
          <button class="search-btn" @click="onTextSearch" title="検索">🔍</button>
        </div>
      </section>

      <!-- 棚卸対象スコープ切り替え（ゲストはホストに追従するため非表示） -->
      <div v-if="hasSupplyItems && (!syncActive || syncIsHost)" class="scope-bar">
        <button :class="['scope-btn', { active: categoryScope === 'all' }]"    @click="categoryScope = 'all'"    type="button">全品目</button>
        <button :class="['scope-btn', { active: categoryScope === 'food' }]"   @click="categoryScope = 'food'"   type="button">食材</button>
        <button :class="['scope-btn', { active: categoryScope === 'supply' }]" @click="categoryScope = 'supply'" type="button">資材・備品</button>
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
        :learned-order="learnedOrder"
        :late-recount-items="lateRecountItems"
        :recount-flags="recountFlags"
        :category-scope="categoryScope"
        @update="onTableUpdate"
        @remove="item => { removeItem(item); if (syncActive) broadcastRemove(item) }"
        @tap="onTableTap"
      />

      <!-- 確認モーダル -->
      <ConfirmModal
        v-if="confirmState"
        :key="confirmState.ingredient"
        :ingredient="confirmState.ingredient"
        :initial-qty="confirmState.qty"
        :initial-unit="confirmState.unit"
        :unit-locked="confirmState.unitLocked"
        :existing="confirmExisting"
        :prev-month="config.prevMonths?.[confirmState.ingredient] ?? ''"
        :lot-size="confirmState.lotSize"
        :audit-log="auditLog"
        :is-flagged="!!recountFlags[confirmState.ingredient]"
        @confirm="onConfirm"
        @cancel="onCancelConfirm"
        @revert="onConfirmRevert"
        @toggle-flag="on => onToggleRecountFlag(confirmState.ingredient, on)"
      />

      <!-- 候補選択モーダル -->
      <CandidateModal
        v-if="candidateState"
        :search-term="candidateState.searchTerm"
        :matched="candidateState.matched"
        :qty="candidateState.qty"
        :unit="candidateState.unit"
        @select="onCandidateSelect"
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
              @click="guestReported ? onUndone() : onComplete()"
            >{{ guestReported ? '↩ 棚卸再開' : '✓ 棚卸完了' }}</button>
            <button class="btn-export" @click="onExport">💾 CSV</button>
          </template>
          <template v-else>
            <button class="btn-new-session" @click="onStartNew">＋ 新規棚卸</button>
            <button class="btn-export" @click="onExport">💾 CSV</button>
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
    <SettingsModal v-if="showSettings" :is-guest="syncActive && !syncIsHost" @close="showSettings = false" @logout="onLogout" />
    <HistoryModal  v-if="showHistory"  @close="showHistory = false" />
    <SyncModal     v-if="showSync"     :is-inventory-completed="isCompleted" @close="showSync = false" @complete="onSyncComplete" @newSession="onSyncNewSession" />
    <ChatModal     v-if="showChat"     @close="showChat = false" />

    <!-- 通知ポップアップ -->
    <Transition name="notif-popup">
      <div v-if="notification" class="notif-overlay" @click="notification = null">
        <div class="notif-card" :class="notification.type">
          <div v-if="notification.type === 'message'" class="notif-sender">{{ notification.senderName }}</div>
          <div v-else-if="notification.type === 'done'" class="notif-done-icon">✓</div>
          <div v-else class="notif-done-icon">🔔</div>
          <div class="notif-text">{{ notification.text }}</div>
          <div class="notif-dismiss">タップで閉じる</div>
        </div>
      </div>
    </Transition>

    <!-- トースト -->
    <Transition name="toast">
      <div v-if="toastShow" class="toast" :data-type="toastType">{{ toastMsg }}</div>
    </Transition>

  </div>
</template>

<style scoped>
/* ── 通知ポップアップ ── */
.notif-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.notif-card {
  background: #fff;
  border-radius: 24px;
  padding: 32px 28px 24px;
  max-width: 340px;
  width: 100%;
  text-align: center;
  box-shadow: 0 16px 56px rgba(0, 0, 0, 0.28);
}

.notif-sender {
  font-size: 12px;
  font-weight: 700;
  color: var(--primary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 12px;
}

.notif-done-icon {
  font-size: 40px;
  color: var(--success);
  margin-bottom: 10px;
  line-height: 1;
}

.notif-text {
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
  line-height: 1.5;
  margin-bottom: 18px;
  white-space: pre-wrap;
  word-break: break-word;
}

.notif-card.done .notif-text {
  color: var(--success);
}

.notif-dismiss {
  font-size: 12px;
  color: var(--text-muted);
}

.notif-popup-enter-active,
.notif-popup-leave-active {
  transition: opacity 0.2s ease, transform 0.25s ease;
}
.notif-popup-enter-from,
.notif-popup-leave-to {
  opacity: 0;
  transform: scale(0.88);
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

/* ── 前回ゲストセッション再参加バナー ── */
.rejoin-banner {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 1200;
  background: #1e293b;
  color: #f1f5f9;
  padding: 14px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.3);
}

.rejoin-text {
  font-size: 14px;
  text-align: center;
}

.rejoin-text strong {
  font-family: 'SF Mono', 'Menlo', monospace;
  letter-spacing: 0.08em;
  color: #93c5fd;
}

.rejoin-actions {
  display: flex;
  gap: 10px;
}

.rejoin-btn {
  flex: 1;
  padding: 12px;
  border-radius: 10px;
  border: none;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.rejoin-skip {
  background: #374151;
  color: #d1d5db;
}
.rejoin-skip:active { background: #4b5563; }

.rejoin-join {
  background: #2563eb;
  color: #fff;
}
.rejoin-join:active { background: #1d4ed8; }

.rejoin-slide-enter-active,
.rejoin-slide-leave-active {
  transition: transform 0.3s ease, opacity 0.25s ease;
}
.rejoin-slide-enter-from,
.rejoin-slide-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
</style>
