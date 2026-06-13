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

const liveRoom = ref(null)
let _statusTimer = null

async function _pollRoomStatus() {
  if (!shopCode.value) return
  const status = await fetchRoomStatus(shopCode.value)
  liveRoom.value = status?.isActive ? status : null
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
  sessions.value.filter(s => s.status !== 'completed')
)

const completedSessions = computed(() =>
  sessions.value.filter(s => s.status === 'completed')
)

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
  if (liveRoom.value && session.id === liveRoom.value.sessionId && liveRoom.value.itemCount > 0) {
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

          <button class="btn-new-session" :disabled="starting" @click="onStartNew">
            <span class="btn-new-icon">＋</span>
            {{ starting ? '開始中...' : '新しい棚卸を開始' }}
          </button>

          <template v-if="inProgressSessions.length > 0">
            <div class="section-title">🔄 進行中</div>
            <div
              v-for="s in inProgressSessions"
              :key="s.id"
              class="session-card active"
            >
              <div class="session-main">
                <span class="session-status" :class="_statusClass(s.status)">{{ _statusLabel(s.status) }}</span>
                <span class="session-date">開始: {{ _formatDate(s.startedAt) }}</span>
                <button class="btn-delete" :disabled="deletingId === s.id" @click.stop="onDelete(s)" title="削除">🗑</button>
              </div>
              <div class="session-sub">
                <span class="session-count">{{ _itemCount(s) }}品目入力済み</span>
              </div>
              <button class="btn btn-primary session-resume-btn" @click="onResume(s)">再開する</button>
            </div>
          </template>

          <div v-if="inProgressSessions.length === 0" class="no-sessions">
            進行中のセッションはありません。<br>上のボタンで棚卸を開始しましょう。
          </div>
        </div>

        <!-- ダッシュボードパネル -->
        <div class="tab-panel">

          <div class="section-title">📋 完了済み（{{ completedSessions.length }}件）</div>
          <template v-if="completedSessions.length > 0">
            <div
              v-for="s in completedSessions"
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

/* 新規開始ボタン */
.btn-new-session {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 16px;
  background: var(--primary, #3b82f6);
  color: white;
  border: none;
  border-radius: 14px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(59,130,246,0.3);
  margin-bottom: 4px;
  min-height: 56px;
  transition: transform 0.12s ease, opacity 0.12s;
  -webkit-tap-highlight-color: transparent;
}
.btn-new-session:active { transform: scale(0.97); opacity: 0.88; }
.btn-new-session:disabled { opacity: 0.6; cursor: not-allowed; }

.btn-new-icon {
  font-size: 20px;
  font-weight: 300;
  line-height: 1;
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
