<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { getSessions, createSession, updateSession, deleteSession, isAuthenticated, storeName, logout } from '../composables/useAuth.js'
import { shopCode } from '../composables/useStore.js'
import { fetchRoomStatus } from '../composables/useSync.js'

const props = defineProps({
  liveItemCount: { type: Number, default: null },
  liveSessionId: { type: String, default: null },
})
const emit = defineEmits(['startSession', 'resumeSession', 'viewSession', 'back', 'deleteSession'])

const sessions   = ref([])
const loading    = ref(true)
const error      = ref('')
const starting   = ref(false)
const deletingId = ref(null)

// 退室中ホスト向け: DO のアクティブルーム状態をポーリングしてライブ品目数を表示
const liveRoom = ref(null)   // { sessionId, isActive, itemCount }
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
    // トークン無効・期限切れ → 自動ログアウトしてランディングへ
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

// 完了以外はすべて「進行中」扱い（旧 incomplete レコードも含む）
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
  // 退室中でもゲストが入力中ならDOのライブ品目数を表示
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

    <div class="sessions-body">

      <!-- エラー -->
      <div v-if="error" class="msg-error">{{ error }}</div>

      <!-- ローディング -->
      <div v-if="loading" class="loading-msg">読み込み中...</div>

      <template v-else>
        <!-- 進行中セッション（複数表示可） -->
        <template v-if="inProgressSessions.length > 0">
          <div class="section-title">🔄 進行中のセッション</div>
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

        <!-- 新規セッション開始 -->
        <button
          class="btn-new-session"
          :disabled="starting"
          @click="onStartNew"
        >
          <span class="btn-new-icon">＋</span>
          {{ starting ? '開始中...' : inProgressSessions.length > 0 ? '別の新規セッションを開始' : '新しい棚卸セッションを開始' }}
        </button>

        <!-- 完了済みセッション -->
        <template v-if="completedSessions.length > 0">
          <div class="section-title" style="margin-top:24px">📋 完了済みのセッション</div>
          <div
            v-for="s in completedSessions"
            :key="s.id"
            class="session-card session-card-completed"
            @click="emit('viewSession', s)"
          >
            <div class="session-main">
              <span class="session-status" :class="_statusClass(s.status)">{{ _statusLabel(s.status) }}</span>
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

        <div v-if="sessions.length === 0 && !loading" class="no-sessions">
          まだセッションがありません。<br>上のボタンで最初のセッションを開始しましょう。
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.sessions-page {
  min-height: 100dvh;
  background: var(--bg-secondary, #f8fafc);
  display: flex;
  flex-direction: column;
}

.sessions-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px 12px;
  background: white;
  border-bottom: 1px solid #e2e8f0;
  position: sticky;
  top: 0;
  z-index: 10;
}

.btn-back {
  background: none;
  border: none;
  font-size: 18px;
  color: var(--primary, #3b82f6);
  cursor: pointer;
  padding: 4px 8px;
}

.sessions-title {
  text-align: center;
}

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
}

.sessions-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
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

.session-card {
  background: white;
  border-radius: 14px;
  padding: 14px 16px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  border: 1.5px solid transparent;
}

.session-card.active {
  border-color: #3b82f6;
}

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
}
.btn-delete:hover { opacity: 0.8; }
.btn-delete:disabled { opacity: 0.2; cursor: not-allowed; }

.session-status {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 20px;
}

.status-active   { background: #dbeafe; color: #1d4ed8; }
.status-done     { background: #dcfce7; color: #15803d; }

.session-date {
  font-size: 12px;
  color: var(--text-muted, #64748b);
}

.session-sub {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--text-muted, #64748b);
}

.session-resume-btn {
  width: 100%;
  margin-top: 10px;
  padding: 10px;
  font-size: 14px;
}

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
  margin-top: 8px;
}

.btn-new-session:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-new-icon {
  font-size: 20px;
  font-weight: 300;
}

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

.session-card-completed {
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.12s;
}
.session-card-completed:active { background: #f0f9ff; }

.session-detail-arrow {
  margin-left: auto;
  font-size: 12px;
  color: var(--primary, #3b82f6);
  font-weight: 600;
}

.loading-msg {
  text-align: center;
  color: var(--text-muted, #64748b);
  padding: 32px;
  font-size: 13px;
}
</style>
