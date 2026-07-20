<script>
import { ref } from 'vue'
export const _persistedTab  = ref('sessions')
export const _showDashboard = ref(false)
export const _showOrders    = ref(false)
</script>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { getSessions, createSession, updateSession, deleteSession, isAuthenticated, storeName, logout } from '../composables/useAuth.js'
import { shopCode } from '../composables/useStore.js'
import { fetchRoomStatus } from '../composables/useSync.js'
import { useHorizontalSwipe } from '../composables/useSwipe.js'
import { isPro, FREE_HISTORY_COUNT } from '../utils/planLimits.js'
import { useConfig } from '../composables/useConfig.js'
import { useHistory } from '../composables/useHistory.js'
import { useMovementDraft } from '../composables/useMovementDraft.js'
import { useMovements, unreflectedOrders } from '../composables/useMovements.js'
import { useOrders } from '../composables/useOrders.js'
import { hasSchedule, scheduleSummary, todayOrderContext, deadlineStatus } from '../services/orderScheduleUtil.js'
import OrderScheduleModal from './OrderScheduleModal.vue'
import ManagerDashboard from './ManagerDashboard.vue'
import HistoryCalendar from './HistoryCalendar.vue'
import { useWeather, requestGeolocation } from '../composables/useWeather.js'
import { settingsSection } from '../composables/appMenuState.js'

const props = defineProps({
  liveItemCount:  { type: Number, default: null },
  liveSessionId:  { type: String, default: null },
  newSessionId:   { type: String, default: null },
})
const emit = defineEmits(['startSession', 'resumeSession', 'viewSession', 'back', 'deleteSession', 'openSettings', 'openMaster', 'openUpgrade', 'startPractice', 'openMovement'])

const { config, itemCount, activeItemCount, setEmptyList } = useConfig()
const { getSnapshotBySessionId, getSnapshots } = useHistory()
const { hasDraft: hasMovementDraft, draftCount: movementDraftCount, discardAll: discardMovementDraft } = useMovementDraft()
const { getMovements } = useMovements()
const { getOrders } = useOrders()

// 天気（Open-Meteo・任意）。位置情報許可でカレンダーに気温・降水・天気を表示。
const { state: weatherState } = useWeather()
const weatherBusy = ref(false)
async function onEnableWeather() {
  weatherBusy.value = true
  try { await requestGeolocation() } catch (_) { /* 拒否/失敗は state.error に反映 */ }
  finally { weatherBusy.value = false }
}
// 入庫として未反映の発注件数（直近30日で入庫が未記録のもの）。ホームカードのバッジ用。
const unreflectedInboundCount = computed(() => unreflectedOrders(getOrders(), getMovements(), 30).length)

// ── 発注スケジュール（頻度・締切）─────────────────────────────
const showScheduleModal = ref(false)
const orderSchedule   = computed(() => config.orderSchedule ?? { days: [], deadline: '' })
const hasSched        = computed(() => hasSchedule(orderSchedule.value))
const schedSummary    = computed(() => scheduleSummary(orderSchedule.value))
const schedTodayCtx   = computed(() => todayOrderContext(orderSchedule.value, new Date(now.value)))
const schedDeadline   = computed(() => deadlineStatus(orderSchedule.value, new Date(now.value)))
// 入出庫カードのサブ文言（未記録ドラフト＞未反映の入庫＞既定の順で表示）。
const moveCardSub = computed(() => {
  if (hasMovementDraft.value) return '記録していない入力があります（タップで再開）'
  if (unreflectedInboundCount.value > 0) return `発注 ${unreflectedInboundCount.value}件が入庫として未反映です（タップで反映）`
  return '現在の在庫を確認／入庫・出庫を品目ごとに記録'
})
function onDiscardMovementDraft() {
  if (!confirm('未記録の入出庫の入力を破棄しますか？')) return
  discardMovementDraft()
}
const showDashboard = _showDashboard
const dashboardSnapshots = computed(() => getSnapshots())

const sessions       = ref([])
const loading        = ref(true)
const error          = ref('')
// どのカードを開始処理中か（null | 'stock' | 'order'）。棚卸・発注は独立したセッション
// なので、開始中の「開始中…」表示も disabled も自カードの種別のときだけに閉じる
// （もう一方のカードを薄く/無効化しない＝互いに影響しないことを見た目でも保証）。
const startingKind   = ref(null)
const deletingId     = ref(null)
const dragOffset     = ref(0)
const showStartModal = ref(false)

const listSavedLabel = computed(() => {
  if (!config.savedAt) return ''
  const d = new Date(config.savedAt)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
})
const hiddenCount   = computed(() => Math.max(0, itemCount.value - activeItemCount.value))
const axisNamesSet  = computed(() => (config.axisNames || []).filter(Boolean))
// 分類は最大2枠。登録済み＝チップ、未登録＝破線の丸で「あと何枠か」を可視化。
const axisSlots     = computed(() => [0, 1].map(i => (config.axisNames?.[i] || '').trim()))

const activeTab    = _persistedTab

const swipe = useHorizontalSwipe({
  onLeft:  () => { if (activeTab.value === 'sessions')  activeTab.value = 'dashboard' },
  onRight: () => { if (activeTab.value === 'dashboard') activeTab.value = 'sessions' },
  onDrag: (dx) => {
    if (dx === 0) { dragOffset.value = 0; return }
    if (activeTab.value === 'sessions'  && dx > 0) return
    if (activeTab.value === 'dashboard' && dx < 0) return
    dragOffset.value = dx
  },
})

const trackStyle = computed(() => {
  const base = activeTab.value === 'sessions' ? 0 : -50
  if (dragOffset.value === 0) {
    return { transform: `translateX(${base}%)`, transition: 'transform 0.32s cubic-bezier(0.4, 0, 0.2, 1)' }
  }
  return { transform: `translateX(calc(${base}% + ${dragOffset.value}px))`, transition: 'none' }
})

const liveRoom      = ref(null)   // 棚卸ルーム /status
const liveOrderRoom = ref(null)   // 発注ルーム /status（type=order）
const now      = ref(Date.now())
let _statusTimer = null

async function _pollRoomStatus() {
  now.value = Date.now()
  if (!shopCode.value) { liveRoom.value = null; liveOrderRoom.value = null; return }
  liveRoom.value = await fetchRoomStatus(shopCode.value, 'stock')
  liveOrderRoom.value = activeOrderSession.value ? await fetchRoomStatus(shopCode.value, 'order') : null
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

const liveStatus       = computed(() => _normStatus(liveRoom.value, activeSession.value))
const orderLiveStatus  = computed(() => _normStatus(liveOrderRoom.value, activeOrderSession.value))
const isRoomConnected      = computed(() => (liveStatus.value?.clientCount ?? 0) > 0)
const isOrderRoomConnected = computed(() => (orderLiveStatus.value?.clientCount ?? 0) > 0)
// 進捗率（入力済み / 総品目）。総品目はルーム状態が無ければローカルの品目数で補完し、
// ルームの有無に依らず 0/100 品目・ゲージを表示できるようにする。
function _pct(count, total) {
  if (!total) return null
  return Math.min(100, Math.round((count / total) * 100))
}

// 進捗の分母は手動非表示を除いた実効品目数（ローカル）。ルームの totalItems は
// 非表示を反映しないため、ホームの進捗はローカルの activeItemCount を優先する。
// 発注は「発注数が決まった品目数」を数える（在庫入力数ではない）。ルームがあれば
// DO の orderItemCount を正とし、オフライン時のみ保存済みセッションの件数で補完する。
const orderItemCount = computed(() => {
  const s = orderLiveStatus.value
  if (s && typeof s.orderItemCount === 'number' && (s.clientCount > 0 || s.roomExists)) return s.orderItemCount
  return activeOrderSession.value ? _itemCount(activeOrderSession.value) : 0
})
const orderTotalItems = computed(() => (activeItemCount.value || orderLiveStatus.value?.totalItems || null))
const orderProgressPct = computed(() => _pct(orderItemCount.value, orderTotalItems.value))

const liveItemCount = computed(() => (activeSession.value ? _itemCount(activeSession.value) : 0))
const liveTotalItems = computed(() => (activeItemCount.value || liveStatus.value?.totalItems || null))
const liveProgressPct = computed(() => _pct(liveItemCount.value, liveTotalItems.value))

function _formatElapsed(iso) {
  if (!iso) return ''
  const ms = now.value - new Date(iso).getTime()
  if (ms < 0) return ''
  const min = Math.floor(ms / 60000)
  if (min < 1)  return 'まもなく'
  if (min < 60) return `${min}分`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h}時間${m}分` : `${h}時間`
}

onMounted(async () => {
  await _loadSessions()
  _pollRoomStatus()
  _statusTimer = setInterval(_pollRoomStatus, 5000)
})

onUnmounted(() => {
  if (_statusTimer) clearInterval(_statusTimer)
})

async function _loadSessions() {
  loading.value = true
  error.value   = ''
  try {
    sessions.value = await getSessions()
  } catch (e) {
    if (e.message.includes('401') || e.message.toLowerCase().includes('unauthorized')) {
      await logout()
      emit('back')
      return
    }
    error.value = e.message
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

// 棚卸: 1店舗=同時に1棚卸。最新の進行中をヒーローに、残りはレガシー整理用に下へ
const activeSession = computed(() => stockInProgress.value[0] || null)
const otherActiveSessions = computed(() => stockInProgress.value.slice(1))
// 発注: 進行中の発注セッション（あれば発注カードをヒーロー表示）
const activeOrderSession = computed(() => orderInProgress.value[0] || null)

const completedSessions = computed(() =>
  sessions.value.filter(s => s.status === 'completed' && (s.type ?? 'stock') !== 'order')
)

// Free プラン: 直近 FREE_HISTORY_COUNT 件のみ表示（新しい順）
const visibleCompletedSessions = computed(() => {
  if (isPro()) return completedSessions.value
  return [...completedSessions.value]
    .sort((a, b) => new Date(b.endedAt ?? b.startedAt) - new Date(a.endedAt ?? a.startedAt))
    .slice(0, FREE_HISTORY_COUNT)
})

const hiddenByPlanCount = computed(() =>
  completedSessions.value.length - visibleCompletedSessions.value.length
)

const CORRECTION_DAYS = 3

function _isSessionLocked(session) {
  // 恒久ロック（新しい棚卸の完了で確定済み）。新しい方を削除しても外れない。
  if (getSnapshotBySessionId(session.id)?.locked) return true
  if (!session.endedAt) return false
  if (Date.now() - new Date(session.endedAt).getTime() > CORRECTION_DAYS * 86400_000) return true
  return completedSessions.value.some(s =>
    s.id !== session.id && new Date(s.startedAt) > new Date(session.endedAt)
  )
}

function onStartNew() {
  // マスタが正なので、実データがあれば確認を挟まず即開始。
  // 開始バナーは「空マスタ / サンプル」の誘導だけに縮小。
  if (config.isCustom && itemCount.value > 0) { confirmStart(); return }
  showStartModal.value = true
}

async function confirmStart() {
  showStartModal.value = false
  startingKind.value = 'stock'
  try {
    const session = await createSession()
    emit('startSession', session)
  } catch (e) {
    error.value = e.message
  } finally {
    startingKind.value = null
  }
}

function onImportList() {
  // 進行中セッションがあるまま品目リストを一括変更すると、その対象リストが変わる。
  if (activeSession.value || activeOrderSession.value) {
    if (!confirm('進行中のセッションがあります。\n品目リストを変更すると、進行中の棚卸／発注の対象リストも変わります。\n続けますか？')) return
  }
  showStartModal.value = false
  emit('openSettings')
}

// 発注確認を開始（type=order の型付きセッションを作成。棚卸カードは type=stock で振り分けるため汚さない）
async function onStartOrder() {
  if (itemCount.value === 0) { error.value = '先に品目マスタを登録してください（取込む、または棚卸で追加）'; return }
  startingKind.value = 'order'
  try {
    const session = await createSession('order')
    emit('startSession', session, 'order')
  } catch (e) {
    error.value = e.message
  } finally {
    startingKind.value = null
  }
}

// 空のリストで開始（棚卸しながら品目を追加）
async function onStartEmpty() {
  setEmptyList()
  await confirmStart()
}

// 練習モードで開始（テスト用リスト・履歴に残さない）
function onStartPractice() {
  showStartModal.value = false
  emit('startPractice')
}

function onResume(session) {
  emit('resumeSession', session)
}

async function onDelete(session) {
  const isActive = session.status === 'active'
  const locked   = session.status === 'completed' && _isSessionLocked(session)
  const msg = isActive
    ? `進行中のセッションを削除します。\n入力中のデータも失われます。\n\nこの操作は取り消せません。本当に削除しますか？`
    : locked
      ? `確定済み（編集ロック）の棚卸です。\n削除すると復元できません。\n\n本当に削除しますか？`
      : `このセッションを削除します。\n\nこの操作は取り消せません。本当に削除しますか？`
  if (!confirm(msg)) return
  deletingId.value = session.id
  try {
    await deleteSession(session.id)
    sessions.value = sessions.value.filter(s => s.id !== session.id)
    emit('deleteSession', session.id)
  } catch (e) {
    error.value = e.message
  } finally {
    deletingId.value = null
  }
}

async function onLogout() {
  if (!confirm('ログアウトしますか？')) return
  await logout()
  emit('back')
}

function _formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function _statusLabel(status) {
  return status === 'completed' ? '完了' : '進行中'
}

function _statusClass(status) {
  return status === 'completed' ? 'status-done' : 'status-active'
}

function _itemCount(session) {
  if (session.id === props.liveSessionId && props.liveItemCount > 0) return props.liveItemCount
  if (liveRoom.value?.isActive && session.id === liveRoom.value.sessionId && liveRoom.value.itemCount > 0) {
    return liveRoom.value.itemCount
  }
  return session.itemCount
}
</script>

<template>
  <div class="sessions-page">

    <!-- ヘッダー -->
    <div class="sessions-header">
      <button class="btn-back" @click="emit('back')">‹ 戻る</button>
      <div class="sessions-title">
        <div class="store-name">{{ storeName || '店舗' }}</div>
        <div class="shop-code-badge">{{ shopCode }}</div>
      </div>
      <button class="btn-logout" @click="onLogout">ログアウト</button>
    </div>

    <!-- タブバー -->
    <div class="tab-bar">
      <button :class="['tab-btn', { active: activeTab === 'sessions' }]" @click="activeTab = 'sessions'">
        セッション
        <span v-if="inProgressSessions.length > 0" class="tab-badge">{{ inProgressSessions.length }}</span>
      </button>
      <button :class="['tab-btn', { active: activeTab === 'dashboard' }]" @click="activeTab = 'dashboard'">
        ダッシュボード
      </button>
    </div>

    <!-- スライドパネル -->
    <div
      class="tab-panels-wrapper"
      @touchstart.passive="swipe.onTouchStart"
      @touchmove.passive="swipe.onTouchMove"
      @touchend.passive="swipe.onTouchEnd"
    >
      <div v-if="loading" class="loading-msg">読み込み中...</div>
      <div v-else class="tab-panels-track" :style="trackStyle">

        <!-- セッションパネル -->
        <div class="tab-panel">
          <div v-if="error" class="msg-error">{{ error }}</div>

          <!-- 品目マスタ管理（店舗の品目リスト＝棚卸・発注が共有する正）。カード全体タップで管理へ -->
          <div class="master-card pulse" @click="emit('openMaster')">
            <div class="master-head">
              <span class="master-title">📦 品目マスタ管理</span>
              <span v-if="itemCount > 0 && !config.isCustom" class="master-sample">サンプル</span>
              <span class="master-open">管理 →</span>
            </div>
            <template v-if="itemCount > 0">
              <div class="master-detail">
                <div class="md-row">
                  <span class="md-k">最終更新</span>
                  <span class="md-v">{{ listSavedLabel || '—' }}</span>
                </div>
                <div class="md-row">
                  <span class="md-k">品目数</span>
                  <span class="md-v">全 <b>{{ itemCount }}</b> ・ 表示中 <b>{{ activeItemCount }}</b><span v-if="hiddenCount > 0" class="md-sub">（非表示 {{ hiddenCount }}）</span></span>
                </div>
                <div class="md-row">
                  <span class="md-k">分類</span>
                  <span class="md-v md-axes">
                    <template v-for="(name, i) in axisSlots" :key="i">
                      <span v-if="name" class="md-chip">{{ name }}</span>
                      <span v-else class="md-slot" title="未登録の分類枠"></span>
                    </template>
                  </span>
                </div>
              </div>
            </template>
            <template v-else>
              <div class="master-empty">まだ品目がありません。タップして取込むか、下の「棚卸を開始」で数えながら追加できます。</div>
            </template>
          </div>

          <!-- ヒーロー: 進行中があれば LIVE 再開、なければ開始 -->
          <div v-if="activeSession" class="hero-live">
            <div class="hero-live-head">
              <span class="hero-live-title">進行中の棚卸</span>
              <button class="hero-live-discard" :disabled="deletingId === activeSession.id" @click="onDelete(activeSession)">破棄</button>
            </div>

            <!-- 開始時刻・経過 -->
            <div class="hl-row hl-times">
              <span class="hl-label">開始</span>
              <span class="hl-value">{{ _formatDate(activeSession.startedAt) }}</span>
              <span class="hl-elapsed">経過 {{ _formatElapsed(activeSession.startedAt) }}</span>
            </div>

            <!-- ルーム状態 -->
            <div class="hl-row hl-room">
              <template v-if="isRoomConnected">
                <span class="room-badge online">🟢 ルーム接続中</span>
                <span class="room-people">{{ liveStatus.clientCount }}人が参加中</span>
              </template>
              <template v-else-if="liveStatus && liveStatus.roomExists">
                <span class="room-badge idle">🟡 ルーム保持中</span>
                <span class="room-people">接続中の端末はありません</span>
              </template>
              <template v-else>
                <span class="room-badge off">⚪ ルーム未接続</span>
                <span class="room-people">オフライン（端末内に保存済み）</span>
              </template>
            </div>

            <!-- 参加者 -->
            <div v-if="liveStatus?.participants?.length" class="hl-people">
              <span
                v-for="(p, i) in liveStatus.participants"
                :key="i"
                class="person-chip"
                :class="{ host: p.isHost, done: p.isDone }"
              >
                <span v-if="p.isHost" class="person-crown">👑</span>{{ p.name }}<span v-if="p.isDone" class="person-check">✓</span>
              </span>
            </div>

            <!-- 品目進捗 -->
            <div class="hl-progress">
              <div class="hl-prog-text">
                <span class="hl-prog-count">{{ liveItemCount }}</span><span
                  v-if="liveTotalItems" class="hl-prog-total"> / {{ liveTotalItems }} 品目</span><span
                  v-else class="hl-prog-total"> 品目入力済み</span>
                <span v-if="liveProgressPct != null" class="hl-prog-pct">{{ liveProgressPct }}%</span>
              </div>
              <div v-if="liveProgressPct != null" class="hl-prog-bar">
                <div class="hl-prog-fill" :style="{ width: liveProgressPct + '%' }"></div>
              </div>
            </div>

            <button class="hero-live-resume" @click="onResume(activeSession)">再開する →</button>
          </div>

          <button v-else class="hero-start" :disabled="startingKind === 'stock'" @click="onStartNew">
            <div class="hero-start-icon">👥</div>
            <div class="hero-start-text">
              <div class="hero-start-title">{{ startingKind === 'stock' ? '開始中...' : '棚卸を開始' }}</div>
              <div class="hero-start-sub">みんなで一緒に、その場で記録</div>
            </div>
            <div class="hero-start-arrow">→</div>
          </button>

          <!-- 在庫確認・入出庫の記録（専用ページ：在庫/入庫/出庫の3タブ） -->
          <div class="move-wrap">
            <button class="move-start" :class="{ 'has-draft': hasMovementDraft }" @click="emit('openMovement')">
              <div class="move-start-icon">📥</div>
              <div class="move-start-text">
                <div class="move-start-title">
                  在庫・入出庫
                  <span v-if="hasMovementDraft" class="move-draft-badge">未記録 {{ movementDraftCount }}</span>
                  <span v-if="unreflectedInboundCount > 0" class="move-inbound-badge">🧾 未反映の入庫 {{ unreflectedInboundCount }}</span>
                </div>
                <div class="move-start-sub">
                  {{ moveCardSub }}
                </div>
              </div>
              <div class="move-start-arrow">→</div>
            </button>
            <button
              v-if="hasMovementDraft"
              class="move-discard"
              @click.stop="onDiscardMovementDraft"
              title="未記録の入力を破棄"
            >破棄</button>
          </div>

          <!-- 発注確認（淡いオレンジ）── 棚卸とは別のセッション -->
          <div v-if="activeOrderSession" class="order-live">
            <div class="order-live-top">
              <span class="order-live-badge">🧾 進行中の発注</span>
              <button class="order-live-discard" :disabled="deletingId === activeOrderSession.id" @click="onDelete(activeOrderSession)">破棄</button>
            </div>
            <div class="order-live-row">
              <span class="hl-label">開始</span>
              <span class="hl-value">{{ _formatDate(activeOrderSession.startedAt) }}</span>
              <span class="hl-elapsed">経過 {{ _formatElapsed(activeOrderSession.startedAt) }}</span>
            </div>

            <!-- ルーム状態（棚卸カードと同じ） -->
            <div class="order-live-row hl-room">
              <template v-if="isOrderRoomConnected">
                <span class="room-badge online">🟢 ルーム接続中</span>
                <span class="room-people">{{ orderLiveStatus.clientCount }}人が参加中</span>
              </template>
              <template v-else-if="orderLiveStatus && orderLiveStatus.roomExists">
                <span class="room-badge idle">🟡 ルーム保持中</span>
                <span class="room-people">接続中の端末はありません</span>
              </template>
              <template v-else>
                <span class="room-badge off">⚪ ルーム未接続</span>
                <span class="room-people">オフライン（端末内に保存済み）</span>
              </template>
            </div>

            <!-- 参加者 -->
            <div v-if="orderLiveStatus?.participants?.length" class="hl-people">
              <span
                v-for="(p, i) in orderLiveStatus.participants" :key="i"
                class="person-chip" :class="{ host: p.isHost, done: p.isDone }"
              >
                <span v-if="p.isHost" class="person-crown">👑</span>{{ p.name }}<span v-if="p.isDone" class="person-check">✓</span>
              </span>
            </div>

            <!-- 品目進捗（棚卸カードと統一）-->
            <div class="hl-progress">
              <div class="hl-prog-text">
                <span class="hl-prog-count">{{ orderItemCount }}</span><span
                  v-if="orderTotalItems" class="hl-prog-total"> / {{ orderTotalItems }} 品目</span><span
                  v-else class="hl-prog-total"> 品目入力済み</span>
                <span v-if="orderProgressPct != null" class="hl-prog-pct">{{ orderProgressPct }}%</span>
              </div>
              <div v-if="orderProgressPct != null" class="hl-prog-bar">
                <div class="hl-prog-fill" :style="{ width: orderProgressPct + '%' }"></div>
              </div>
            </div>

            <button class="order-live-resume" @click="onResume(activeOrderSession)">発注を再開する →</button>
          </div>
          <button v-else class="order-start" :class="{ disabled: itemCount === 0 }" :disabled="startingKind === 'order' || itemCount === 0" @click="onStartOrder">
            <div class="order-start-icon">🧾</div>
            <div class="order-start-text">
              <div class="order-start-title">{{ startingKind === 'order' ? '開始中...' : '発注確認を開始' }}</div>
              <div class="order-start-sub">{{ itemCount === 0 ? '先に品目マスタを登録してください' : '仕入先ごとに、発注をまとめて記録' }}</div>
            </div>
            <div class="order-start-arrow">→</div>
          </button>

          <!-- 発注スケジュール（頻度・締切）。未設定なら設定を促す -->
          <button v-if="!activeOrderSession && itemCount > 0" class="order-sched" type="button" @click="showScheduleModal = true">
            <span class="order-sched-ico">🗓</span>
            <span class="order-sched-text">
              <template v-if="hasSched">
                <span class="order-sched-summary">
                  {{ schedSummary }}
                  <span v-if="schedDeadline.has" :class="['order-sched-dl', { past: schedDeadline.past }]">・{{ schedDeadline.label }}</span>
                </span>
                <span v-if="schedTodayCtx" class="order-sched-ctx">{{ schedTodayCtx }}</span>
              </template>
              <template v-else>
                <span class="order-sched-summary">発注スケジュールを設定</span>
                <span class="order-sched-ctx">発注する曜日・締切を登録（任意）</span>
              </template>
            </span>
            <span class="order-sched-edit">{{ hasSched ? '変更' : '設定' }}</span>
          </button>

          <!-- レガシー: 古い未完了セッション（整理用） -->
          <template v-if="otherActiveSessions.length > 0">
            <div class="section-title">その他の未完了（古い）</div>
            <div
              v-for="s in otherActiveSessions"
              :key="s.id"
              class="session-card"
            >
              <div class="session-main">
                <span class="session-status status-active">進行中</span>
                <span class="session-date">開始: {{ _formatDate(s.startedAt) }}</span>
                <button class="btn-delete" :disabled="deletingId === s.id" @click.stop="onDelete(s)" title="削除">🗑</button>
              </div>
              <div class="session-sub">
                <span class="session-count">{{ _itemCount(s) }}品目入力済み</span>
              </div>
              <button class="btn btn-primary session-resume-btn" @click="onResume(s)">再開する</button>
            </div>
          </template>

        </div>

        <!-- ダッシュボードパネル -->
        <div class="tab-panel">

          <!-- 履歴カレンダー（日付を選ぶ → その日の棚卸/発注を見る） -->
          <div class="section-title">📅 履歴</div>
          <div class="wx-bar">
            <template v-if="weatherState.loc">
              <span class="wx-loc">🌤 天気表示中</span>
              <span class="wx-coord">📍 {{ weatherState.loc.lat }}, {{ weatherState.loc.lon }}{{ weatherState.loading ? '（更新中…）' : '' }}</span>
              <button class="wx-btn" :disabled="weatherBusy || weatherState.loading" @click="onEnableWeather">現在地で更新</button>
            </template>
            <template v-else>
              <span class="wx-hint">天気・気温・降水をカレンダーに表示できます</span>
              <button class="wx-btn primary" :disabled="weatherBusy" @click="onEnableWeather">{{ weatherBusy ? '取得中…' : '📍 現在地で天気を表示' }}</button>
            </template>
            <span v-if="weatherState.error" class="wx-err">{{ weatherState.error }}</span>
          </div>
          <HistoryCalendar
            :sessions="visibleCompletedSessions"
            :weather="weatherState.weather"
            @view-session="s => emit('viewSession', s)"
            @delete-session="onDelete"
          />
          <div v-if="!isPro() && hiddenByPlanCount > 0" class="plan-limit-notice">
            <span class="plan-limit-icon">🔒</span>
            <span class="plan-limit-text">過去 {{ hiddenByPlanCount }}件の履歴はPROプランで閲覧できます</span>
            <button class="plan-limit-link" @click="emit('openUpgrade', `無料プランで閲覧できるのは直近${FREE_HISTORY_COUNT}回の棚卸のみです`)">アップグレード</button>
          </div>

          <div class="section-title" style="margin-top:24px">📊 分析</div>
          <div class="dashboard-card" @click="showDashboard = true">
            <div class="dashboard-card-icon">📊</div>
            <div class="dashboard-card-body">
              <div class="dashboard-card-title">在庫分析</div>
              <div class="dashboard-card-desc">在庫金額・前回差・ABC分析・棚卸メタ</div>
            </div>
            <span class="dashboard-card-arrow">›</span>
          </div>

          <div class="section-title" style="margin-top:16px">⚙️ 設定</div>
          <div class="dashboard-card" @click="settingsSection = 'general'">
            <div class="dashboard-card-icon">⚙️</div>
            <div class="dashboard-card-body">
              <div class="dashboard-card-title">各種設定</div>
              <div class="dashboard-card-desc">端末名・プッシュ通知・並べ替え</div>
            </div>
            <span class="dashboard-card-arrow">›</span>
          </div>

          <div class="section-title" style="margin-top:16px">❓ ヘルプ</div>
          <div class="dashboard-card dashboard-card-disabled">
            <div class="dashboard-card-icon">📖</div>
            <div class="dashboard-card-body">
              <div class="dashboard-card-title">使い方ガイド</div>
              <div class="dashboard-card-desc">操作マニュアルを準備中</div>
            </div>
            <span class="coming-badge">準備中</span>
          </div>

        </div>

      </div>
    </div>

    <ManagerDashboard v-if="showDashboard" :snapshots="dashboardSnapshots" @close="showDashboard = false" />

    <OrderScheduleModal v-if="showScheduleModal" @close="showScheduleModal = false" />

    <!-- 開始バナー: 使用する品目リストを確認 -->
    <div v-if="showStartModal" class="start-overlay" @click.self="showStartModal = false">
      <div class="start-sheet">
        <div class="start-handle"></div>

        <!-- カスタムリスト -->
        <template v-if="config.isCustom">
          <div class="start-icon ok">✓</div>
          <div class="start-title">この品目リストで開始します</div>
          <div class="start-listbox">
            <span class="start-count">{{ itemCount }}件</span>
            <span v-if="listSavedLabel" class="start-date">最終更新：{{ listSavedLabel }}</span>
          </div>
          <button class="start-btn primary" :disabled="startingKind === 'stock'" @click="confirmStart">このまま開始</button>
          <button class="start-btn ghost" @click="onImportList">最新リストに更新</button>
        </template>

        <!-- 未設定（品目ゼロ） -->
        <template v-else-if="itemCount === 0">
          <div class="start-icon warn">📋</div>
          <div class="start-title">品目リストが未設定です</div>
          <div class="start-desc">
            実際の棚卸を始める前に、お店の品目リストをインポートしてください。<br>
            まず動作を確認したい場合は、下の「サンプルで試す（練習）」で試せます。
          </div>
          <button class="start-btn primary" @click="onImportList">品目リストをインポート</button>
        </template>

        <!-- サンプルデータ読み込み済み -->
        <template v-else>
          <div class="start-icon warn">⚠️</div>
          <div class="start-title">サンプルデータで試します</div>
          <div class="start-desc">
            品目名に【テスト】が付いた仮データです。<br>
            実際の棚卸ではお店の品目リストをインポートしてください。
          </div>
          <div class="start-listbox warn">
            <span class="start-count">{{ itemCount }}件</span>
            <span class="start-date">サンプル</span>
          </div>
          <button class="start-btn primary" @click="onImportList">品目リストをインポート</button>
          <button class="start-btn ghost-weak" :disabled="startingKind === 'stock'" @click="confirmStart">このままサンプルで開始</button>
        </template>

        <!-- その他の開始方法（常時） -->
        <div class="start-alt">
          <div class="start-alt-divider"><span>その他の開始方法</span></div>
          <button class="start-alt-btn" :disabled="startingKind === 'stock'" @click="onStartEmpty">
            <span class="start-alt-ico">➕</span>
            <span class="start-alt-body">
              <span class="start-alt-title">空のリストで開始</span>
              <span class="start-alt-sub">棚卸しながら品目を追加していく</span>
            </span>
          </button>
          <button class="start-alt-btn" @click="onStartPractice">
            <span class="start-alt-ico">🎯</span>
            <span class="start-alt-body">
              <span class="start-alt-title">サンプルで試す（練習モード）</span>
              <span class="start-alt-sub">テスト用リストで操作を試す・履歴には残りません</span>
            </span>
          </button>
        </div>

        <button class="start-cancel" @click="showStartModal = false">キャンセル</button>
      </div>
    </div>

  </div>
</template>

<style scoped>
.sessions-page {
  height: 100dvh;
  background: var(--bg-secondary, #f8fafc);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sessions-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px 12px;
  background: white;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}

.btn-back {
  background: none;
  border: none;
  font-size: 18px;
  color: var(--primary, var(--primary-bright));
  cursor: pointer;
  padding: 4px 8px;
  transition: opacity 0.12s;
  -webkit-tap-highlight-color: transparent;
}
.btn-back:active { opacity: 0.5; }

.sessions-title { text-align: center; }

.store-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
}

.shop-code-badge {
  font-size: 11px;
  color: var(--text-muted, #64748b);
  font-family: monospace;
  letter-spacing: 0.1em;
}

.btn-logout {
  background: none;
  border: none;
  font-size: 12px;
  color: #ef4444;
  cursor: pointer;
  padding: 4px 6px;
  transition: opacity 0.12s;
  -webkit-tap-highlight-color: transparent;
}
.btn-logout:active { opacity: 0.5; }

/* タブバー */
.tab-bar {
  display: flex;
  background: white;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}

.tab-btn {
  flex: 1;
  padding: 12px 8px;
  background: none;
  border: none;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-muted, #64748b);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color 0.2s, border-color 0.2s, transform 0.1s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  -webkit-tap-highlight-color: transparent;
}

.tab-btn.active {
  color: var(--primary, var(--primary-bright));
  border-bottom-color: var(--primary, var(--primary-bright));
  font-weight: 600;
}

.tab-btn:active { transform: scale(0.95); }

.tab-badge {
  background: var(--primary-bright);
  color: white;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 10px;
  line-height: 1.6;
}

.tab-badge-gray { background: #94a3b8; }

/* スライドパネル */
.tab-panels-wrapper {
  flex: 1;
  overflow: hidden;
  min-height: 0;
  position: relative;
}

.tab-panels-track {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  width: 200%;
  height: 100%;
  will-change: transform;
}

.tab-panel {
  width: 50%;
  height: 100%;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  touch-action: pan-y;
  box-sizing: border-box;
  -webkit-overflow-scrolling: touch;
}

.wx-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.wx-hint, .wx-loc { font-size: 12px; color: #64748b; font-weight: 600; }
.wx-coord { font-size: 11px; color: #0369a1; font-weight: 700; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 2px 8px; }
.wx-btn { border: 1.5px solid #d1d5db; background: #fff; border-radius: 16px; padding: 5px 12px; font-size: 12px; font-weight: 700; color: #4b5563; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.wx-btn.primary { border-color: #38bdf8; background: #f0f9ff; color: #0369a1; }
.wx-btn:disabled { opacity: 0.5; cursor: default; }
.wx-err { font-size: 11px; color: #dc2626; }

.section-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted, #64748b);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 8px;
  margin-bottom: 4px;
}

/* 品目マスタ カード */
.master-card {
  background: #fff;
  border: 1.5px solid var(--border, #e2e8f0);
  border-radius: 14px;
  padding: 12px 14px;
  margin-bottom: 10px;
  cursor: pointer;
  transition: transform 0.12s;
}
.master-card:active { transform: scale(0.99); }
.master-card.pulse { animation: master-pulse 3s ease-in-out infinite; }
@keyframes master-pulse {
  0%, 100% { border-color: var(--border, #e2e8f0); box-shadow: 0 1px 4px rgba(37,99,235,0.05); }
  50%      { border-color: var(--primary-bright, #60a5fa); box-shadow: 0 3px 16px rgba(37,99,235,0.22); }
}
@media (prefers-reduced-motion: reduce) { .master-card.pulse { animation: none; } }
.master-head { display: flex; align-items: center; gap: 8px; }
.master-title { font-size: 14px; font-weight: 800; color: #334155; }
.master-open { margin-left: auto; font-size: 12px; font-weight: 800; color: var(--primary, #2563eb); }
.master-count { font-size: 13px; font-weight: 800; color: var(--primary, #2563eb); }
.master-sample { font-size: 11px; font-weight: 700; color: #b45309; background: #fffbeb; border: 1px solid #fde68a; border-radius: 20px; padding: 1px 9px; }
.master-empty { font-size: 12px; color: #64748b; margin-top: 6px; line-height: 1.5; }

.master-detail { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.md-row { display: flex; gap: 8px; font-size: 12px; align-items: baseline; }
.md-k { flex-shrink: 0; width: 56px; color: #94a3b8; font-weight: 700; }
.md-v { color: #334155; }
.md-v b { color: #1e293b; }
.md-sub { color: #94a3b8; margin-left: 4px; }
.md-none { color: #b45309; }
.md-axes { display: inline-flex; align-items: center; gap: 6px; }
.md-chip { display: inline-block; font-size: 11px; font-weight: 700; color: var(--primary, #2563eb); background: var(--primary-weak, #eff6ff); border-radius: 12px; padding: 1px 9px; }
.md-slot { display: inline-block; width: 20px; height: 20px; border-radius: 50%; border: 1.5px dashed #cbd5e1; flex-shrink: 0; }
.master-actions { display: flex; gap: 8px; margin-top: 10px; }
.master-btn {
  border: 1px solid var(--primary-border, #bfdbfe);
  background: #fff;
  color: var(--primary, #2563eb);
  border-radius: 9px;
  font-size: 13px;
  font-weight: 700;
  padding: 8px 14px;
  cursor: pointer;
}
.master-btn.primary { background: var(--primary, #2563eb); color: #fff; border-color: var(--primary, #2563eb); }
.master-btn:active { transform: scale(0.98); }

.order-start.disabled {
  background: #f1f5f9;
  color: #94a3b8;
  border-color: #e2e8f0;
  box-shadow: none;
  cursor: not-allowed;
}
.order-start.disabled .order-start-title { color: #64748b; }
.order-start.disabled .order-start-sub,
.order-start.disabled .order-start-arrow { color: #94a3b8; }
.order-start.disabled .order-start-icon { filter: grayscale(1); opacity: 0.6; }

/* ヒーロー: 開始カード（枠は標準カードと統一・中身は青テーマ） */
.hero-start {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 18px;
  background: #fff;
  color: var(--primary, #2563eb);
  border: 1.5px solid var(--border, #e2e8f0);
  border-radius: 14px;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  margin-bottom: 4px;
  text-align: left;
  transition: transform 0.14s ease;
  -webkit-tap-highlight-color: transparent;
}
.hero-start:active { transform: scale(0.98); }
.hero-start:disabled { opacity: 0.7; cursor: not-allowed; }

.hero-start-icon {
  font-size: 26px;
  width: 50px;
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-weak, #eff6ff);
  border-radius: 14px;
  flex-shrink: 0;
}

.hero-start-text { flex: 1; min-width: 0; }

.hero-start-title {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--primary, #2563eb);
}

.hero-start-sub {
  font-size: 12px;
  color: var(--primary-bright, #3b82f6);
  margin-top: 2px;
}

.hero-start-arrow {
  font-size: 22px;
  font-weight: 300;
  color: var(--primary-mid, #93c5fd);
  flex-shrink: 0;
}

/* 入出庫カード（枠は標準カードと統一・中身はグリーンテーマ） */
.move-start {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 18px;
  background: #fff;
  border: 1.5px solid var(--border, #e2e8f0);
  border-radius: 14px;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  margin-bottom: 4px;
  text-align: left;
  transition: transform 0.14s ease;
  -webkit-tap-highlight-color: transparent;
}
.move-start:active { transform: scale(0.98); }
.move-start-icon {
  font-size: 26px;
  width: 50px;
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #d1fae5;
  border-radius: 14px;
  flex-shrink: 0;
}
.move-start-text { flex: 1; min-width: 0; }
.move-start-title { font-size: 17px; font-weight: 700; letter-spacing: 0.02em; color: #047857; display: flex; align-items: center; gap: 8px; }
.move-start-sub { font-size: 12px; color: #059669; margin-top: 2px; }
.move-start-arrow { font-size: 22px; font-weight: 300; color: #10b981; flex-shrink: 0; }
.move-wrap { position: relative; }
.move-start.has-draft { border-color: #fbbf24; box-shadow: 0 1px 4px rgba(217,119,6,0.16); }
.move-draft-badge { font-size: 11px; font-weight: 800; color: #fff; background: #f59e0b; border-radius: 10px; padding: 1px 8px; letter-spacing: 0; }
.move-inbound-badge { font-size: 11px; font-weight: 800; color: #fff; background: #ea580c; border-radius: 10px; padding: 1px 8px; letter-spacing: 0; }
.move-start.has-draft .move-start-sub { color: #b45309; }
.move-discard {
  position: absolute; top: 8px; right: 10px; z-index: 1;
  border: 1px solid #fecaca; background: #fff; color: #dc2626;
  border-radius: 8px; font-size: 11px; font-weight: 700; padding: 3px 9px;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.move-discard:active { color: #ef4444; }

/* 発注確認カード（枠は標準カードと統一・中身はオレンジテーマのまま） */
/* 発注スケジュール行（発注カードの直下・頻度/締切/位置づけ） */
.order-sched {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 14px;
  margin: -2px 0 6px;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 12px;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.order-sched:active { background: #ffedd5; }
.order-sched-ico { font-size: 16px; flex-shrink: 0; }
.order-sched-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.order-sched-summary { font-size: 13px; font-weight: 800; color: #c2410c; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.order-sched-dl { font-weight: 700; color: #b45309; }
.order-sched-dl.past { color: #dc2626; }
.order-sched-ctx { font-size: 11px; color: #b45309; }
.order-sched-edit { flex-shrink: 0; font-size: 12px; font-weight: 800; color: #ea580c; border: 1px solid #fed7aa; border-radius: 8px; padding: 3px 10px; background: #fff; }

.order-start {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 18px;
  background: #fff;
  color: #9a3412;
  border: 1.5px solid var(--border, #e2e8f0);
  border-radius: 14px;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  margin-bottom: 4px;
  text-align: left;
  transition: transform 0.14s ease, box-shadow 0.14s ease, opacity 0.12s;
  -webkit-tap-highlight-color: transparent;
}
.order-start:active { transform: scale(0.98); }
.order-start:disabled { opacity: 0.7; cursor: not-allowed; }
.order-start-icon {
  font-size: 26px;
  width: 50px;
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffe4c4;
  border-radius: 14px;
  flex-shrink: 0;
}
.order-start-text { flex: 1; min-width: 0; }
.order-start-title { font-size: 17px; font-weight: 700; letter-spacing: 0.02em; color: #c2410c; }
.order-start-sub { font-size: 12px; color: #b45309; margin-top: 2px; }
.order-start-arrow { font-size: 22px; font-weight: 300; color: #ea580c; flex-shrink: 0; }

/* 進行中の発注（淡いオレンジのヒーロー） */
.order-live {
  background: linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%);
  border: 1.5px solid #fed7aa;
  border-radius: 18px;
  padding: 16px 18px;
  margin-bottom: 4px;
  box-shadow: 0 3px 12px rgba(234,88,12,0.14);
  animation: order-breathe 3.2s ease-in-out infinite;
}
@keyframes order-breathe {
  0%, 100% { border-color: #fed7aa; box-shadow: 0 3px 12px rgba(234,88,12,0.14); }
  50%      { border-color: #fb923c; box-shadow: 0 6px 24px rgba(234,88,12,0.40); }
}

/* アクセシビリティ: モーション低減設定では点滅を止める */
@media (prefers-reduced-motion: reduce) {
  .hero-live, .order-live { animation: none; }
}
.order-live-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.order-live-badge { font-size: 15px; font-weight: 800; color: #c2410c; }
.order-live-discard { border: 1px solid #fecaca; background: #fff; color: #dc2626; border-radius: 8px; font-size: 12px; font-weight: 700; padding: 4px 10px; cursor: pointer; }
.order-live-discard:disabled { opacity: 0.4; cursor: default; }
.order-live-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #b45309; margin-bottom: 12px; }
.order-live-row .hl-label { font-weight: 700; }
.order-live-row .hl-elapsed { margin-left: auto; }
.order-live-resume {
  width: 100%; border: none; border-radius: 12px; padding: 12px;
  background: linear-gradient(135deg, #fb923c 0%, #ea580c 100%);
  color: #fff; font-size: 15px; font-weight: 800; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.order-live-resume:active { transform: scale(0.98); }

/* ヒーロー: LIVE 再開カード */
.hero-live {
  width: 100%;
  padding: 16px 18px;
  background: white;
  border: 2px solid var(--primary-bright);
  border-radius: 18px;
  box-shadow: 0 4px 16px rgba(37,99,235,0.16);
  margin-bottom: 4px;
  transition: border-color 0.3s;
  animation: hero-breathe 3.2s ease-in-out infinite;
}
@keyframes hero-breathe {
  0%, 100% { border-color: var(--primary-bright); box-shadow: 0 4px 16px rgba(37,99,235,0.16); }
  50%      { border-color: var(--primary);        box-shadow: 0 6px 26px rgba(37,99,235,0.42); }
}
.hero-live-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.hero-live-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
}

.hero-live-discard {
  margin-left: auto;
  border: 1px solid #fecaca;
  background: #fff;
  color: #dc2626;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  padding: 4px 10px;
  cursor: pointer;
  transition: color 0.12s;
  -webkit-tap-highlight-color: transparent;
}
.hero-live-discard:active { color: #ef4444; }
.hero-live-discard:disabled { opacity: 0.4; cursor: default; }

/* 情報行 */
.hl-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
}

.hl-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted, #94a3b8);
  background: #f1f5f9;
  padding: 1px 7px;
  border-radius: 6px;
  flex-shrink: 0;
}

.hl-value {
  font-weight: 600;
  color: var(--text-primary, #1e293b);
}

.hl-elapsed {
  margin-left: auto;
  color: var(--text-muted, #64748b);
  font-variant-numeric: tabular-nums;
}

.room-badge {
  font-size: 12px;
  font-weight: 700;
}
.room-badge.online { color: #15803d; }
.room-badge.idle   { color: #b45309; }
.room-badge.off    { color: #94a3b8; }

.room-people {
  margin-left: auto;
  color: var(--text-muted, #64748b);
  font-size: 11px;
}

/* 参加者チップ */
.hl-people {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.person-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  font-weight: 600;
  color: var(--primary-deep);
  background: var(--primary-weak);
  border: 1px solid var(--primary-soft);
  padding: 3px 9px;
  border-radius: 14px;
}
.person-chip.host {
  color: #92400e;
  background: #fffbeb;
  border-color: #fde68a;
}
.person-chip.done {
  color: #15803d;
  background: #f0fdf4;
  border-color: #bbf7d0;
}

.person-crown { font-size: 11px; }
.person-check { font-size: 11px; font-weight: 800; }

/* 品目進捗 */
.hl-progress { margin-bottom: 14px; }

.hl-prog-text {
  display: flex;
  align-items: baseline;
  margin-bottom: 6px;
}

.hl-prog-count {
  font-size: 22px;
  font-weight: 800;
  color: var(--text-primary, #1e293b);
  line-height: 1;
}

.hl-prog-total {
  font-size: 13px;
  color: var(--text-muted, #64748b);
  margin-left: 2px;
}

.hl-prog-pct {
  margin-left: auto;
  font-size: 13px;
  font-weight: 700;
  color: var(--primary, var(--primary-bright));
}

.hl-prog-bar {
  height: 7px;
  background: #eef2f7;
  border-radius: 4px;
  overflow: hidden;
}

.hl-prog-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary-bright), var(--primary));
  border-radius: 4px;
  transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}

.hero-live-resume {
  width: 100%;
  padding: 13px;
  background: var(--primary, var(--primary-bright));
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(59,130,246,0.3);
  transition: transform 0.12s ease, opacity 0.12s;
  -webkit-tap-highlight-color: transparent;
}
.hero-live-resume:active { transform: scale(0.97); opacity: 0.9; }

.hero-hint {
  text-align: center;
  color: var(--text-muted, #94a3b8);
  font-size: 12px;
  line-height: 1.7;
  padding: 24px 16px;
}

/* セットアップバナー */
.setup-banner {
  background: white;
  border: 1.5px solid var(--primary-border);
  border-radius: 18px;
  padding: 16px;
  box-shadow: 0 2px 12px rgba(37,99,235,0.10);
}

.setup-banner-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.setup-banner-icon { font-size: 28px; flex-shrink: 0; }

.setup-banner-title {
  font-size: 15px;
  font-weight: 800;
  color: var(--primary, var(--primary));
  margin-bottom: 2px;
}

.setup-banner-sub {
  font-size: 12px;
  color: var(--text-muted, #64748b);
  line-height: 1.4;
}

.setup-paths {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.setup-path {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: #f8fafc;
  border: 1.5px solid #e2e8f0;
  border-radius: 12px;
  cursor: pointer;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.12s, border-color 0.12s;
}
.setup-path.primary {
  background: linear-gradient(135deg, var(--primary-weak) 0%, var(--primary-soft) 100%);
  border-color: var(--primary-mid);
}
.setup-path.weak {
  background: #fafafa;
  border-color: #e5e7eb;
}
.setup-path:active { opacity: 0.8; }

.sp-icon { font-size: 20px; flex-shrink: 0; }

.sp-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sp-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
}

.setup-path.primary .sp-title { color: var(--primary, var(--primary)); }
.setup-path.weak .sp-title    { color: var(--text-muted, #64748b); }

.sp-sub {
  font-size: 11px;
  color: var(--text-muted, #64748b);
}
.setup-path.primary .sp-sub { color: var(--primary-bright); }

.sp-arr {
  font-size: 18px;
  color: var(--text-muted, #94a3b8);
  flex-shrink: 0;
}

/* 年カード（完了済み一覧） */
.year-card {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: white;
  border: 1.5px solid transparent;
  border-radius: 14px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  cursor: pointer;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.12s ease;
}
.year-card:active { transform: scale(0.98); background: #f0f9ff; border-color: var(--primary-soft); }

.year-card-info { flex: 1; min-width: 0; }

.year-card-year {
  display: block;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
}

.year-card-range {
  font-size: 12px;
  color: var(--text-muted, #64748b);
}

.year-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted, #64748b);
  background: #f1f5f9;
  padding: 3px 10px;
  border-radius: 10px;
  white-space: nowrap;
  flex-shrink: 0;
}

.year-card-arrow {
  font-size: 18px;
  color: var(--primary, var(--primary-bright));
  font-weight: 600;
  flex-shrink: 0;
}

/* 年詳細ビュー */
.year-back-btn {
  background: none;
  border: none;
  font-size: 15px;
  color: var(--primary, var(--primary-bright));
  cursor: pointer;
  padding: 4px 0;
  text-align: left;
  font-weight: 600;
  -webkit-tap-highlight-color: transparent;
  align-self: flex-start;
}
.year-back-btn:active { opacity: 0.6; }

.year-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 4px 0 4px;
}

.year-detail-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
}

/* 月ごとの見出し */
.month-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 16px 2px 8px;
}
.month-header:first-of-type { margin-top: 8px; }
.month-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
}
.month-count {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted, #64748b);
  background: #f1f5f9;
  padding: 1px 8px;
  border-radius: 10px;
}

/* NEW バッジ */
.badge-new {
  font-size: 10px;
  font-weight: 800;
  color: white;
  background: #ef4444;
  padding: 2px 7px;
  border-radius: 10px;
  letter-spacing: 0.04em;
  flex-shrink: 0;
  animation: badge-pulse 2s infinite;
}

@keyframes badge-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.65; }
}

/* セッションカード */
.session-card {
  background: white;
  border-radius: 14px;
  padding: 14px 16px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  border: 1.5px solid transparent;
  transition: transform 0.12s ease;
  -webkit-tap-highlight-color: transparent;
}
.session-card.active { border-color: var(--primary-bright); }

.session-main {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.btn-delete {
  margin-left: auto;
  background: none;
  border: none;
  font-size: 15px;
  cursor: pointer;
  opacity: 0.4;
  padding: 2px 4px;
  line-height: 1;
  transition: opacity 0.15s;
  min-width: 28px;
  min-height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.btn-delete:hover  { opacity: 0.8; }
.btn-delete:disabled { opacity: 0.2; cursor: not-allowed; }

.session-status {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 20px;
  white-space: nowrap;
}

.status-active { background: var(--primary-soft); color: var(--primary-deep); }
.status-done   { background: #dcfce7; color: #15803d; }

.session-date {
  font-size: 12px;
  color: var(--text-muted, #64748b);
}

.session-sub {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--text-muted, #64748b);
  align-items: center;
}

.session-resume-btn {
  width: 100%;
  margin-top: 10px;
  padding: 10px;
  font-size: 14px;
}

.session-card-completed {
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.session-card-completed:active { transform: scale(0.99); background: #f0f9ff; }

.badge-correction {
  font-size: 10px;
  font-weight: 700;
  color: #d97706;
  background: #fffbeb;
  border: 1px solid #fde68a;
  padding: 2px 7px;
  border-radius: 10px;
  white-space: nowrap;
  flex-shrink: 0;
}

.badge-locked {
  font-size: 10px;
  font-weight: 700;
  color: #64748b;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  padding: 2px 7px;
  border-radius: 10px;
  white-space: nowrap;
  flex-shrink: 0;
}

.session-detail-arrow {
  margin-left: auto;
  font-size: 12px;
  color: var(--primary, var(--primary-bright));
  font-weight: 600;
}

.session-stats-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  flex-wrap: wrap;
}

.sstat {
  font-size: 12px;
  color: var(--text-muted, #64748b);
  font-weight: 500;
}

.session-parts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 7px;
}

.part-chip {
  font-size: 11px;
  font-weight: 600;
  color: var(--primary-deep);
  background: var(--primary-weak);
  border: 1px solid var(--primary-soft);
  padding: 3px 10px;
  border-radius: 14px;
  white-space: nowrap;
}

/* ダッシュボードカード */
.dashboard-card {
  background: white;
  border-radius: 14px;
  padding: 14px 16px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  border: 1.5px solid transparent;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.12s ease;
}
.dashboard-card:active { transform: scale(0.98); background: #f0f9ff; }

.dashboard-card-disabled {
  cursor: default;
  opacity: 0.55;
}
.dashboard-card-disabled:active { transform: none; background: white; }

.dashboard-card-icon {
  font-size: 24px;
  width: 36px;
  text-align: center;
  flex-shrink: 0;
}

.dashboard-card-body { flex: 1; min-width: 0; }

.dashboard-card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
}

.dashboard-card-desc {
  font-size: 12px;
  color: var(--text-muted, #64748b);
  margin-top: 2px;
}

.dashboard-card-arrow {
  font-size: 18px;
  color: var(--primary, var(--primary-bright));
  font-weight: 600;
}

.coming-badge {
  font-size: 10px;
  font-weight: 700;
  background: #f1f5f9;
  color: #64748b;
  padding: 3px 8px;
  border-radius: 10px;
  white-space: nowrap;
}

/* その他 */
.no-sessions {
  text-align: center;
  color: var(--text-muted, #64748b);
  font-size: 13px;
  line-height: 1.7;
  padding: 32px 16px;
}

.plan-limit-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  margin-top: 6px;
  background: #fefce8;
  border: 1.5px solid #fde047;
  border-radius: 10px;
  font-size: 12px;
}
.plan-limit-icon { flex-shrink: 0; }
.plan-limit-text { flex: 1; color: #854d0e; font-weight: 600; }
.plan-limit-link {
  flex-shrink: 0;
  color: var(--primary);
  font-weight: 700;
  font-size: 12px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}
.plan-limit-link:active { opacity: 0.7; }

.msg-error {
  padding: 10px 14px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 10px;
  color: #ef4444;
  font-size: 13px;
}

.loading-msg {
  text-align: center;
  color: var(--text-muted, #64748b);
  padding: 32px;
  font-size: 13px;
}

/* 開始バナー */
.start-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 100;
  animation: start-fade 0.18s ease;
}
@keyframes start-fade { from { opacity: 0; } to { opacity: 1; } }

.start-sheet {
  width: 100%;
  max-width: 480px;
  background: white;
  border-radius: 20px 20px 0 0;
  padding: 10px 20px calc(20px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  animation: start-up 0.26s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes start-up { from { transform: translateY(100%); } to { transform: translateY(0); } }

.start-handle {
  width: 40px;
  height: 4px;
  border-radius: 2px;
  background: #cbd5e1;
  margin-bottom: 6px;
}

.start-icon {
  font-size: 30px;
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}
.start-icon.ok   { background: #ecfdf5; }
.start-icon.warn { background: #fffbeb; }

.start-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
  text-align: center;
}

.start-desc {
  font-size: 13px;
  color: var(--text-muted, #64748b);
  text-align: center;
  line-height: 1.7;
}

.start-listbox {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #f1f5f9;
  border-radius: 12px;
  padding: 10px 16px;
  margin: 2px 0 4px;
}
.start-listbox.warn { background: #fef3c7; }

.start-count {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
}

.start-date {
  font-size: 12px;
  color: var(--text-muted, #64748b);
}

.start-btn {
  width: 100%;
  padding: 14px;
  border: none;
  border-radius: 14px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.12s, opacity 0.12s;
}
.start-btn:active { transform: scale(0.97); }
.start-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.start-btn.primary {
  background: linear-gradient(135deg, var(--primary-bright) 0%, var(--primary) 100%);
  color: white;
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.3);
}
.start-btn.ghost {
  background: var(--primary-weak);
  color: var(--primary);
}
.start-btn.ghost-weak {
  background: none;
  color: var(--text-muted, #64748b);
  font-weight: 600;
  padding: 10px;
}

.start-cancel {
  background: none;
  border: none;
  color: var(--text-muted, #94a3b8);
  font-size: 13px;
  padding: 8px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* ── その他の開始方法 ── */
.start-alt {
  width: 100%;
  margin-top: 8px;
}
.start-alt-divider {
  display: flex;
  align-items: center;
  text-align: center;
  color: var(--text-muted, #94a3b8);
  font-size: 11px;
  font-weight: 700;
  margin: 4px 0 10px;
}
.start-alt-divider::before,
.start-alt-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border, #e2e8f0);
}
.start-alt-divider span { padding: 0 10px; }

.start-alt-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  margin-bottom: 8px;
  background: #f8fafc;
  border: 1.5px solid var(--border, #e2e8f0);
  border-radius: 12px;
  cursor: pointer;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s;
}
.start-alt-btn:active { background: #f1f5f9; }
.start-alt-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.start-alt-ico { font-size: 20px; flex-shrink: 0; }
.start-alt-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.start-alt-title { font-size: 14px; font-weight: 700; color: var(--text, #0f172a); }
.start-alt-sub { font-size: 11px; color: var(--text-muted, #64748b); }
</style>
