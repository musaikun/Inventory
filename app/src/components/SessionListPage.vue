<script>
import { ref } from 'vue'
export const _persistedTab  = ref('sessions')
export const _selectedYear  = ref(null)
</script>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { getSessions, createSession, updateSession, deleteSession, isAuthenticated, storeName, logout } from '../composables/useAuth.js'
import { shopCode } from '../composables/useStore.js'
import { fetchRoomStatus } from '../composables/useSync.js'
import { useHorizontalSwipe } from '../composables/useSwipe.js'
import { isHistoryVisible, isPro, FREE_HISTORY_DAYS } from '../utils/planLimits.js'
import { useConfig } from '../composables/useConfig.js'
import { useHistory } from '../composables/useHistory.js'

const props = defineProps({
  liveItemCount:  { type: Number, default: null },
  liveSessionId:  { type: String, default: null },
  newSessionId:   { type: String, default: null },
})
const emit = defineEmits(['startSession', 'resumeSession', 'viewSession', 'back', 'deleteSession', 'openSettings'])

const { config, itemCount, loadSampleData } = useConfig()
const { getSnapshotBySessionId } = useHistory()

const sessions       = ref([])
const loading        = ref(true)
const error          = ref('')
const starting       = ref(false)
const deletingId     = ref(null)
const dragOffset     = ref(0)
const showStartModal = ref(false)

const listSavedLabel = computed(() => {
  if (!config.savedAt) return ''
  const d = new Date(config.savedAt)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' })
})

const activeTab    = _persistedTab
const selectedYear = _selectedYear

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

const liveRoom = ref(null)   // /status の生レスポンス
const now      = ref(Date.now())
let _statusTimer = null

async function _pollRoomStatus() {
  now.value = Date.now()
  if (!shopCode.value) { liveRoom.value = null; return }
  liveRoom.value = await fetchRoomStatus(shopCode.value)
}

// アクティブセッションに対応するライブルーム状態（別セッションのルームは無視）
// 旧 Worker（participants 未対応）でも壊れないよう正規化する
const liveStatus = computed(() => {
  const r = liveRoom.value
  if (!r || !activeSession.value) return null
  if (r.sessionId && r.sessionId !== activeSession.value.id) return null
  return {
    ...r,
    participants: Array.isArray(r.participants) ? r.participants : [],
    clientCount:  typeof r.clientCount === 'number' ? r.clientCount : 0,
    roomExists:   r.roomExists ?? r.isActive ?? false,
    totalItems:   typeof r.totalItems === 'number' ? r.totalItems : null,
  }
})

const isRoomConnected = computed(() => (liveStatus.value?.clientCount ?? 0) > 0)

const liveItemCount = computed(() => (activeSession.value ? _itemCount(activeSession.value) : 0))
const liveTotalItems = computed(() => liveStatus.value?.totalItems ?? null)
const liveProgressPct = computed(() => {
  const total = liveTotalItems.value
  if (!total) return null
  return Math.min(100, Math.round((liveItemCount.value / total) * 100))
})

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

// 1店舗 = 同時に1棚卸。最新の進行中をヒーローに、残りはレガシー整理用に下へ
const activeSession = computed(() => inProgressSessions.value[0] || null)
const otherActiveSessions = computed(() => inProgressSessions.value.slice(1))

const completedSessions = computed(() =>
  sessions.value.filter(s => s.status === 'completed')
)

// Free プラン: 30日以内のみ表示
const visibleCompletedSessions = computed(() =>
  completedSessions.value.filter(s => isHistoryVisible(s.endedAt ?? s.startedAt))
)

const hiddenByPlanCount = computed(() =>
  completedSessions.value.length - visibleCompletedSessions.value.length
)

// 完了済みを年ごとにグループ化（新しい年が上）
const completedByYear = computed(() => {
  const map = new Map()
  for (const s of visibleCompletedSessions.value) {
    const year = new Date(s.startedAt).getFullYear()
    if (!map.has(year)) map.set(year, [])
    map.get(year).push(s)
  }
  return [...map.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, items]) => ({
      year,
      items: items.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)),
    }))
})

const selectedYearSessions = computed(() => {
  if (!selectedYear.value) return []
  return completedByYear.value.find(g => g.year === selectedYear.value)?.items ?? []
})

const CORRECTION_DAYS = 3

function _isSessionLocked(session) {
  if (!session.endedAt) return false
  if (Date.now() - new Date(session.endedAt).getTime() > CORRECTION_DAYS * 86400_000) return true
  return completedSessions.value.some(s =>
    s.id !== session.id && new Date(s.startedAt) > new Date(session.endedAt)
  )
}

function _correctionLabel(session) {
  if (_isSessionLocked(session)) return null
  const remaining = CORRECTION_DAYS * 86400_000 - (Date.now() - new Date(session.endedAt).getTime())
  const days = Math.max(0, Math.ceil(remaining / 86400_000))
  return days > 0 ? `あと${days}日` : '今日まで'
}

function _yearDateRange(items) {
  if (!items.length) return ''
  const months = items.map(s => new Date(s.startedAt).getMonth() + 1)
  const min = Math.min(...months)
  const max = Math.max(...months)
  return min === max ? `${min}月` : `${min}月〜${max}月`
}

function _fmtDuration(ms) {
  if (ms <= 0) return null
  const min = Math.round(ms / 60000)
  if (min < 1)  return '1分未満'
  if (min < 60) return `${min}分`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h}時間${m}分` : `${h}時間`
}

// 年詳細ビューの全セッション分を一括計算
const selectedYearSessionStats = computed(() => {
  const result = {}
  for (const s of selectedYearSessions.value) {
    const duration = (s.startedAt && s.endedAt)
      ? _fmtDuration(new Date(s.endedAt) - new Date(s.startedAt))
      : null

    const snap = getSnapshotBySessionId(s.id)

    // auditLog から参加者ごとのアクティブ時間（最初〜最後のアクション）
    const timeMap = new Map()
    for (const entry of (snap?.auditLog ?? [])) {
      if (!entry.enteredById || !entry.ts) continue
      const t = new Date(entry.ts).getTime()
      if (!timeMap.has(entry.enteredById)) {
        timeMap.set(entry.enteredById, { name: entry.enteredBy || '?', first: t, last: t })
      } else {
        const cur = timeMap.get(entry.enteredById)
        cur.first = Math.min(cur.first, t)
        cur.last  = Math.max(cur.last, t)
      }
    }

    const participants = (snap?.participants ?? []).map(p => {
      const timeEntry = [...timeMap.values()].find(t => t.name === p.name)
      const activeDur = timeEntry ? _fmtDuration(timeEntry.last - timeEntry.first) : null
      return { name: p.name, itemCount: p.items?.length ?? 0, activeDur }
    })

    result[s.id] = {
      duration,
      participants,
      locked:          _isSessionLocked(s),
      correctionLabel: _correctionLabel(s),
    }
  }
  return result
})

function onStartNew() {
  showStartModal.value = true
}

async function confirmStart() {
  showStartModal.value = false
  starting.value = true
  try {
    const session = await createSession()
    emit('startSession', session)
  } catch (e) {
    error.value = e.message
  } finally {
    starting.value = false
  }
}

function onImportList() {
  showStartModal.value = false
  emit('openSettings')
}

async function onStartWithSample() {
  loadSampleData()
  await confirmStart()
}

function onResume(session) {
  emit('resumeSession', session)
}

async function onDelete(session) {
  const isActive = session.status === 'active'
  const msg = isActive
    ? `進行中のセッションを削除します。\n入力中のデータも失われます。\n\nこの操作は取り消せません。本当に削除しますか？`
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

          <!-- ヒーロー: 進行中があれば LIVE 再開、なければ開始 -->
          <div v-if="activeSession" class="hero-live" :class="{ offline: !isRoomConnected }">
            <div class="hero-live-head">
              <span class="live-dot" :class="{ offline: !isRoomConnected }"></span>
              <span class="live-label" :class="{ offline: !isRoomConnected }">{{ isRoomConnected ? 'LIVE' : 'OFFLINE' }}</span>
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

          <button v-else class="hero-start" :disabled="starting" @click="onStartNew">
            <div class="hero-start-icon">🎙</div>
            <div class="hero-start-text">
              <div class="hero-start-title">{{ starting ? '開始中...' : '棚卸を開始' }}</div>
              <div class="hero-start-sub">音声でサクサク記録</div>
            </div>
            <div class="hero-start-arrow">→</div>
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

          <div v-if="!activeSession" class="hero-hint">
            上のカードから棚卸を始めましょう。<br>複数端末で同時に記録できます。
          </div>
        </div>

        <!-- ダッシュボードパネル -->
        <div class="tab-panel">

          <!-- 年詳細ビュー -->
          <template v-if="selectedYear !== null">
            <button class="year-back-btn" @click="selectedYear = null">‹ 戻る</button>
            <div class="year-detail-header">
              <span class="year-detail-title">{{ selectedYear }}年の棚卸</span>
              <span class="year-count">{{ selectedYearSessions.length }}件</span>
            </div>
            <div
              v-for="s in selectedYearSessions"
              :key="s.id"
              class="session-card session-card-completed"
              @click="emit('viewSession', s)"
            >
              <div class="session-main">
                <span v-if="s.id === newSessionId" class="badge-new">NEW</span>
                <span class="session-status status-done">完了</span>
                <span class="session-date">{{ _formatDate(s.startedAt) }}</span>
                <span v-if="selectedYearSessionStats[s.id]?.correctionLabel" class="badge-correction">
                  ✏️ {{ selectedYearSessionStats[s.id].correctionLabel }}
                </span>
                <span v-else-if="selectedYearSessionStats[s.id]?.locked" class="badge-locked">🔒 確定</span>
                <button class="btn-delete" :disabled="deletingId === s.id" @click.stop="onDelete(s)" title="削除">🗑</button>
              </div>
              <!-- 所要時間・参加者数・品目数 -->
              <div class="session-stats-row">
                <span v-if="selectedYearSessionStats[s.id]?.duration" class="sstat">
                  ⏱ {{ selectedYearSessionStats[s.id].duration }}
                </span>
                <span v-if="selectedYearSessionStats[s.id]?.participants?.length" class="sstat">
                  👥 {{ selectedYearSessionStats[s.id].participants.length }}人
                </span>
                <span class="sstat">📦 {{ _itemCount(s) }}品目</span>
                <span class="session-detail-arrow">詳細 ›</span>
              </div>
              <!-- 参加者別内訳 -->
              <div v-if="selectedYearSessionStats[s.id]?.participants?.length > 0" class="session-parts">
                <span
                  v-for="p in selectedYearSessionStats[s.id].participants"
                  :key="p.name"
                  class="part-chip"
                >{{ p.name }}&nbsp;{{ p.itemCount }}品<template v-if="p.activeDur">・{{ p.activeDur }}</template></span>
              </div>
            </div>
            <div v-if="selectedYearSessions.length === 0" class="no-sessions">この年のデータがありません</div>
          </template>

          <!-- 年一覧ビュー -->
          <template v-else>
            <div class="section-title">📋 完了済み（{{ completedSessions.length }}件）</div>
            <template v-if="completedSessions.length > 0">
              <button
                v-for="grp in completedByYear"
                :key="grp.year"
                class="year-card"
                @click="selectedYear = grp.year"
              >
                <div class="year-card-info">
                  <span class="year-card-year">{{ grp.year }}年</span>
                  <span class="year-card-range">{{ _yearDateRange(grp.items) }}</span>
                </div>
                <span class="year-card-count">{{ grp.items.length }}件</span>
                <span class="year-card-arrow">›</span>
              </button>
              <!-- Free プラン: 30日以前の件数をアップグレード誘導として表示 -->
              <div v-if="!isPro() && hiddenByPlanCount > 0" class="plan-limit-notice">
                <span class="plan-limit-icon">🔒</span>
                <span class="plan-limit-text">{{ hiddenByPlanCount }}件が{{ FREE_HISTORY_DAYS }}日の履歴制限で非表示</span>
                <a class="plan-limit-link" href="/landing/#pricing" target="_blank">アップグレード</a>
              </div>
            </template>
            <div v-else class="no-sessions">完了済みのセッションはまだありません</div>

            <div class="section-title" style="margin-top:24px">📂 データ管理</div>
            <div class="dashboard-card" @click="emit('openSettings')">
              <div class="dashboard-card-icon">⚙️</div>
              <div class="dashboard-card-body">
                <div class="dashboard-card-title">品目リスト・インポート設定</div>
                <div class="dashboard-card-desc">CSV / Excel / PDF から品目を読み込む</div>
              </div>
              <span class="dashboard-card-arrow">›</span>
            </div>

            <div class="section-title" style="margin-top:16px">📊 分析</div>
            <div class="dashboard-card dashboard-card-disabled">
              <div class="dashboard-card-icon">📊</div>
              <div class="dashboard-card-body">
                <div class="dashboard-card-title">棚卸レポート</div>
                <div class="dashboard-card-desc">差異・傾向レポートを準備中</div>
              </div>
              <span class="coming-badge">準備中</span>
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
          </template>

        </div>

      </div>
    </div>

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
          <button class="start-btn primary" :disabled="starting" @click="confirmStart">このまま開始</button>
          <button class="start-btn ghost" @click="onImportList">最新リストに更新</button>
        </template>

        <!-- 未設定（品目ゼロ） -->
        <template v-else-if="itemCount === 0">
          <div class="start-icon warn">📋</div>
          <div class="start-title">品目リストが未設定です</div>
          <div class="start-desc">
            実際の棚卸を始める前に、お店の品目リストをインポートしてください。<br>
            まず動作を確認したい場合はサンプルデータで試せます。
          </div>
          <button class="start-btn primary" @click="onImportList">品目リストをインポート</button>
          <button class="start-btn ghost" :disabled="starting" @click="onStartWithSample">サンプルデータで試す</button>
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
          <button class="start-btn ghost-weak" :disabled="starting" @click="confirmStart">このままサンプルで開始</button>
        </template>

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
  color: var(--primary, #3b82f6);
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
  color: var(--primary, #3b82f6);
  border-bottom-color: var(--primary, #3b82f6);
  font-weight: 600;
}

.tab-btn:active { transform: scale(0.95); }

.tab-badge {
  background: #3b82f6;
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

.section-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted, #64748b);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 8px;
  margin-bottom: 4px;
}

/* ヒーロー: 開始カード */
.hero-start {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 20px 18px;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: white;
  border: none;
  border-radius: 18px;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(37,99,235,0.32);
  margin-bottom: 4px;
  text-align: left;
  transition: transform 0.14s ease, box-shadow 0.14s ease, opacity 0.12s;
  -webkit-tap-highlight-color: transparent;
}
.hero-start:active {
  transform: scale(0.97);
  box-shadow: 0 2px 8px rgba(37,99,235,0.28);
}
.hero-start:disabled { opacity: 0.7; cursor: not-allowed; }

.hero-start-icon {
  font-size: 30px;
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,0.18);
  border-radius: 14px;
  flex-shrink: 0;
}

.hero-start-text { flex: 1; min-width: 0; }

.hero-start-title {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.hero-start-sub {
  font-size: 12px;
  opacity: 0.85;
  margin-top: 2px;
}

.hero-start-arrow {
  font-size: 22px;
  font-weight: 300;
  opacity: 0.9;
  flex-shrink: 0;
}

/* ヒーロー: LIVE 再開カード */
.hero-live {
  width: 100%;
  padding: 16px 18px;
  background: white;
  border: 2px solid #3b82f6;
  border-radius: 18px;
  box-shadow: 0 4px 16px rgba(37,99,235,0.16);
  margin-bottom: 4px;
  transition: border-color 0.3s;
}
.hero-live.offline {
  border-color: #cbd5e1;
  box-shadow: 0 2px 10px rgba(0,0,0,0.06);
}

.hero-live-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.live-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #ef4444;
  flex-shrink: 0;
  box-shadow: 0 0 0 0 rgba(239,68,68,0.55);
  animation: live-pulse 1.8s infinite;
}
.live-dot.offline {
  background: #cbd5e1;
  animation: none;
}

@keyframes live-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(239,68,68,0.5); }
  70%  { box-shadow: 0 0 0 8px rgba(239,68,68,0); }
  100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
}

.live-label {
  font-size: 11px;
  font-weight: 800;
  color: #ef4444;
  letter-spacing: 0.08em;
}
.live-label.offline { color: #94a3b8; }

.hero-live-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
}

.hero-live-discard {
  margin-left: auto;
  background: none;
  border: none;
  font-size: 12px;
  color: var(--text-muted, #94a3b8);
  cursor: pointer;
  padding: 4px 6px;
  transition: color 0.12s;
  -webkit-tap-highlight-color: transparent;
}
.hero-live-discard:active { color: #ef4444; }
.hero-live-discard:disabled { opacity: 0.4; }

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
  color: #1d4ed8;
  background: #eff6ff;
  border: 1px solid #dbeafe;
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
  color: var(--primary, #3b82f6);
}

.hl-prog-bar {
  height: 7px;
  background: #eef2f7;
  border-radius: 4px;
  overflow: hidden;
}

.hl-prog-fill {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #2563eb);
  border-radius: 4px;
  transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}

.hero-live-resume {
  width: 100%;
  padding: 13px;
  background: var(--primary, #3b82f6);
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
.year-card:active { transform: scale(0.98); background: #f0f9ff; border-color: #dbeafe; }

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
  color: var(--primary, #3b82f6);
  font-weight: 600;
  flex-shrink: 0;
}

/* 年詳細ビュー */
.year-back-btn {
  background: none;
  border: none;
  font-size: 15px;
  color: var(--primary, #3b82f6);
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
.session-card.active { border-color: #3b82f6; }

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

.status-active { background: #dbeafe; color: #1d4ed8; }
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
  color: var(--primary, #3b82f6);
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
  color: #1d4ed8;
  background: #eff6ff;
  border: 1px solid #dbeafe;
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
  color: var(--primary, #3b82f6);
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
  text-decoration: none;
  font-size: 12px;
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
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: white;
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.3);
}
.start-btn.ghost {
  background: #eff6ff;
  color: #2563eb;
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
</style>
