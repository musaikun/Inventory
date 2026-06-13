<script>
import { ref } from 'vue'
const _persistedTab = ref('sessions')
</script>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { getSessions, createSession, updateSession, deleteSession, isAuthenticated, storeName, logout } from '../composables/useAuth.js'
import { shopCode } from '../composables/useStore.js'
import { fetchRoomStatus } from '../composables/useSync.js'
import { useHorizontalSwipe } from '../composables/useSwipe.js'

const props = defineProps({
  liveItemCount: { type: Number, default: null },
  liveSessionId: { type: String, default: null },
})
const emit = defineEmits(['startSession', 'resumeSession', 'viewSession', 'back', 'deleteSession', 'openSettings'])

const sessions   = ref([])
const loading    = ref(true)
const error      = ref('')
const starting   = ref(false)
const deletingId = ref(null)
const dragOffset = ref(0)

const activeTab = _persistedTab

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
    _initYearAccordion()
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

// 完了済みを年ごとにグループ化（新しい年が上）
const completedByYear = computed(() => {
  const map = new Map()
  for (const s of completedSessions.value) {
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

const expandedYears = ref([])

function _initYearAccordion() {
  if (expandedYears.value.length) return
  const groups = completedByYear.value
  if (groups.length) expandedYears.value = [groups[0].year]
}

function toggleYear(year) {
  const idx = expandedYears.value.indexOf(year)
  if (idx >= 0) expandedYears.value.splice(idx, 1)
  else          expandedYears.value.push(year)
}

async function onStartNew() {
  if (!confirm('新しい棚卸セッションを開始しますか？')) return
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
        <span v-if="completedSessions.length > 0" class="tab-badge tab-badge-gray">{{ completedSessions.length }}</span>
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

          <div class="section-title">📋 完了済み（{{ completedSessions.length }}件）</div>
          <template v-if="completedSessions.length > 0">
            <div v-for="grp in completedByYear" :key="grp.year" class="year-group">
              <button class="year-header" @click="toggleYear(grp.year)">
                <span class="year-arrow">{{ expandedYears.includes(grp.year) ? '▼' : '▶' }}</span>
                <span class="year-name">{{ grp.year }}年</span>
                <span class="year-count">{{ grp.items.length }}件</span>
              </button>
              <div v-if="expandedYears.includes(grp.year)" class="year-body">
                <div
                  v-for="s in grp.items"
                  :key="s.id"
                  class="session-card session-card-completed"
                  @click="emit('viewSession', s)"
                >
                  <div class="session-main">
                    <span class="session-status status-done">完了</span>
                    <span class="session-date">{{ _formatDate(s.startedAt) }}</span>
                    <button class="btn-delete" :disabled="deletingId === s.id" @click.stop="onDelete(s)" title="削除">🗑</button>
                  </div>
                  <div class="session-sub">
                    <span class="session-count">{{ _itemCount(s) }}品目</span>
                    <span v-if="s.endedAt" class="session-ended">終了: {{ _formatDate(s.endedAt) }}</span>
                    <span class="session-detail-arrow">詳細 ›</span>
                  </div>
                </div>
              </div>
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

        </div>

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
  display: flex;
  width: 200%;
  height: 100%;
  will-change: transform;
}

.tab-panel {
  width: 50%;
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

/* 年グループ（完了済みアコーディオン） */
.year-group {
  background: white;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  margin-bottom: 4px;
}

.year-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  background: white;
  border: none;
  cursor: pointer;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.12s;
}
.year-header:active { background: #f0f9ff; }

.year-arrow {
  font-size: 10px;
  color: var(--text-muted, #64748b);
  width: 12px;
  flex-shrink: 0;
}

.year-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
  flex: 1;
}

.year-count {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted, #64748b);
  background: #f1f5f9;
  padding: 2px 9px;
  border-radius: 10px;
  flex-shrink: 0;
}

.year-body {
  border-top: 1px solid #f1f5f9;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #f8fafc;
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

.session-detail-arrow {
  margin-left: auto;
  font-size: 12px;
  color: var(--primary, #3b82f6);
  font-weight: 600;
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
</style>
