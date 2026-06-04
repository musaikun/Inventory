<script setup>
import { ref, onMounted, nextTick } from 'vue'
import QRCode from 'qrcode'
import { useSync } from '../composables/useSync.js'
import { deviceName, setDeviceName } from '../composables/useDeviceId.js'
import { useEscapeKey } from '../composables/useEscapeKey.js'
import { isAuthenticated, createSession } from '../composables/useAuth.js'
import { useSession } from '../composables/useSession.js'

const emit = defineEmits(['close', 'complete', 'newSession'])

const props = defineProps({
  isInventoryCompleted: { type: Boolean, default: false },
})

const { pendingSession, markActive, begin } = useSession()
useEscapeKey(() => emit('close'))
const {
  state, participantList, isHost, isGuest,
  createRoom, joinRoom, leaveRoom, dissolveRoom, getShareUrl,
} = useSync()

// ── セッション管理 ──────────────────────────────────────────────────────────────
const sessionEnding = ref(false)

// 棚卸を完了（スナップショット保存・ゲスト退室は App.vue 側で実行）
function onComplete() {
  if (!confirm('棚卸を完了しますか？\n履歴に保存され、参加者は退室します。')) return
  sessionEnding.value = true
  emit('complete')
}

// 受付終了（保存せずルームを閉じる・ゲスト全員退室）
async function onCloseRoom() {
  const guestCount = participantList.value.length - 1
  const msg = guestCount > 0
    ? 'ゲストは全員退室します。ルームを閉じますか？'
    : 'ルームを閉じますか？'
  if (!confirm(msg)) return
  await dissolveRoom()
  view.value = 'home'
  emit('close')
}

// ── UI state ─────────────────────────────────────────────────────────────────
// 'home' | 'host' | 'guest' | 'namePrompt'
const view = ref('home')
const copied = ref(false)

// ── 端末名未設定時のプロンプト ─────────────────────────────────────────────────
const pendingAction = ref(null) // 'create'
const nameInput     = ref('')
const nameError     = ref('')

const qrDataUrl = ref('')
const showQR    = ref(false)

// ── ルーム状態が既にアクティブなら該当ビューへ ─────────────────────────────
onMounted(() => {
  if (isHost.value) view.value = 'host'
  else if (isGuest.value) view.value = 'guest'
})

// ── ホスト作成 ────────────────────────────────────────────────────────────────
const createError = ref('')

async function onCreateRoom() {
  if (!deviceName.value) {
    pendingAction.value = 'create'
    nameInput.value = ''
    nameError.value = ''
    view.value = 'namePrompt'
    return
  }
  createError.value = ''
  try {
    await createRoom()

    // DO のセッション ID と D1 の pendingSession.id が一致する場合のみ「再接続」扱い。
    // isSessionActive だけで判断すると、ホストが一覧へ戻って新しいセッションを開始した後も
    // 旧セッションが非 session_end のまま残っているケースで session_start がスキップされ
    // 在庫汚染が発生するため、セッション ID での一致確認が必要。
    const doSessionId = state.sessionId           // joined 処理後に更新済み
    const d1SessionId = pendingSession.value?.id ?? ''
    const isReconnect = state.isSessionActive && !!doSessionId && doSessionId === d1SessionId

    if (!isReconnect) {
      let sessionId = ''
      const useExisting = isAuthenticated.value
        && pendingSession.value?.id
        && !props.isInventoryCompleted

      if (useExisting) {
        sessionId = pendingSession.value.id
        if (pendingSession.value?.status === 'incomplete') {
          await markActive(pendingSession.value.itemCount ?? 0)
        }
      } else if (isAuthenticated.value) {
        try {
          const sess = await createSession()
          begin(sess)
          sessionId = sess.id
        } catch (e) {
          console.warn('[SyncModal] D1 session create failed:', e.message)
        }
      }

      emit('newSession', { sessionId, isResume: useExisting })
    }

    view.value = 'host'
    await nextTick()
    await _generateQR()
    showQR.value = true
  } catch (e) {
    createError.value = state.error || 'ルームを作成できませんでした'
  }
}

async function toggleQR() {
  showQR.value = !showQR.value
  if (showQR.value && !qrDataUrl.value) {
    await _generateQR()
  }
}

// ── 端末名確定後に保留アクションを実行 ──────────────────────────────────────
async function onConfirmName() {
  const trimmed = nameInput.value.trim()
  if (!trimmed) {
    nameError.value = '端末名を入力してください'
    return
  }
  setDeviceName(trimmed)
  if (pendingAction.value === 'create') {
    view.value = 'home'
    await onCreateRoom()
  }
  pendingAction.value = null
}

function onCancelNamePrompt() {
  pendingAction.value = null
  view.value = 'home'
}

// ── ゲスト退出 ────────────────────────────────────────────────────────────────
function onLeave() {
  leaveRoom()
  view.value = 'home'
}

// ── QRコード生成 ──────────────────────────────────────────────────────────────
async function _generateQR() {
  const url = getShareUrl()
  if (!url) return
  try {
    qrDataUrl.value = await QRCode.toDataURL(url, {
      width: 200,
      margin: 1,
      color: { dark: '#1e293b', light: '#ffffff' },
    })
  } catch (_) {}
}

// ── コードをクリップボードにコピー ──────────────────────────────────────────
async function onCopyCode() {
  if (!state.roomCode) return
  try {
    await navigator.clipboard.writeText(state.roomCode)
    copied.value = true
    setTimeout(() => copied.value = false, 1500)
  } catch (_) {}
}

</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-sheet sync-sheet">
      <div class="sheet-handle"></div>

      <!-- ==== ホーム（初期）==== -->
      <template v-if="view === 'home'">
        <div class="sheet-title">複数デバイスで棚卸</div>

        <div class="sync-intro">
          複数人で同時に棚卸を行うと、お互いの入力がリアルタイムで共有されます。
        </div>

        <div v-if="!deviceName" class="sync-warn">
          ⚠️ 端末名が未設定です。設定画面で「Aさん」「厨房」などの名前を付けると、誰が入力したか分かりやすくなります。
        </div>

        <button class="btn btn-primary sync-main-btn" @click="onCreateRoom">
          🔗 棚卸ルームを開始
        </button>

        <div v-if="createError" class="msg error" style="margin-top:10px">
          ✗ {{ createError }}
        </div>

        <div class="sync-note">
          ※ メンバーはトップ画面から店舗コードを入力して参加できます。<br>
          完全オフラインで一人で使う場合は、このまま閉じてください。
        </div>
      </template>

      <!-- ==== ホスト画面 ==== -->
      <template v-else-if="view === 'host'">
        <div class="sheet-title">ルームを共有</div>

        <!-- 参加受付状態 -->
        <div class="accepting-card">
          <div class="accepting-info">
            <span class="accepting-dot"></span>
            <div>
              <div class="accepting-status">参加を受け付け中</div>
              <div class="accepting-sub">店舗コードを知っている人が参加できます</div>
            </div>
          </div>
          <button class="accepting-btn" @click="onCloseRoom">受付終了</button>
        </div>

        <div class="room-code-card">
          <div class="room-code-label">店舗コード（参加用）</div>
          <div class="room-code-value" @click="onCopyCode">
            {{ state.roomCode }}
            <span class="copy-hint">{{ copied ? '✓ コピー済み' : '📋 タップでコピー' }}</span>
          </div>
        </div>

        <button class="btn btn-secondary qr-toggle-btn" @click="toggleQR">
          {{ showQR ? '🔼 QRコードを閉じる' : '📷 QRコードを表示' }}
        </button>

        <div v-if="showQR && qrDataUrl" class="qr-wrap">
          <img :src="qrDataUrl" alt="ルーム参加QR" class="qr-img" />
          <div class="qr-hint">同じWi-Fi内の他の端末でQRを読み取るとすぐに参加できます</div>
        </div>

        <div class="participants-section">
          <div class="participants-title">参加者（{{ participantList.length }}名）</div>
          <div class="participants-list">
            <div v-for="p in participantList" :key="p.id" class="participant-item">
              <span class="participant-dot" :class="{ me: p.isMe, done: p.isDone }"></span>
              <span class="participant-name">{{ p.name }}</span>
              <span v-if="p.isMe" class="participant-me">あなた</span>
              <span v-if="p.isDone" class="participant-status done">✓ 完了</span>
              <span v-else class="participant-status working">作業中</span>
            </div>
          </div>
        </div>

        <div class="actions">
          <button class="btn btn-secondary" @click="$emit('close')">棚卸に戻る</button>
          <button
            class="btn btn-success"
            :disabled="sessionEnding"
            @click="onComplete"
          >✓ 棚卸を完了</button>
        </div>
      </template>

      <!-- ==== 端末名設定プロンプト ==== -->
      <template v-else-if="view === 'namePrompt'">
        <div class="sheet-title">端末名を設定</div>

        <div class="sync-intro">
          ルームに参加するには端末名が必要です。<br>
          他の参加者にはこの名前が表示されます。
        </div>

        <input
          type="text"
          class="name-input"
          placeholder="例：Aさん、厨房、ホール"
          v-model="nameInput"
          @keyup.enter="onConfirmName"
          maxlength="20"
          autofocus
        />

        <div v-if="nameError" class="msg error">{{ nameError }}</div>

        <div class="actions">
          <button class="btn btn-secondary" @click="onCancelNamePrompt">キャンセル</button>
          <button class="btn btn-primary" @click="onConfirmName">設定して続行</button>
        </div>
      </template>

      <!-- ==== ゲスト画面（参加中）==== -->
      <template v-else-if="view === 'guest'">
        <div class="sheet-title">ルーム参加中</div>

        <div class="room-code-card">
          <div class="room-code-label">参加中の店舗コード</div>
          <div class="room-code-value">{{ state.roomCode }}</div>
        </div>

        <div class="connect-status connected">
          <span class="status-dot"></span>
          同期中
        </div>

        <div class="participants-section">
          <div class="participants-title">参加者（{{ participantList.length }}名）</div>
          <div class="participants-list">
            <div v-for="p in participantList" :key="p.id" class="participant-item">
              <span class="participant-dot" :class="{ me: p.isMe, done: p.isDone }"></span>
              <span class="participant-name">{{ p.name }}</span>
              <span v-if="p.isMe" class="participant-me">あなた</span>
              <span v-if="p.isDone" class="participant-status done">✓ 完了</span>
              <span v-else class="participant-status working">作業中</span>
            </div>
          </div>
        </div>

        <div class="actions">
          <button class="btn btn-secondary" @click="$emit('close')">棚卸に戻る</button>
          <button class="btn btn-danger-block" @click="onLeave">退出する</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.sync-sheet {
  max-height: 88vh;
  overflow-y: auto;
  padding-bottom: 32px;
}

.sync-intro {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.6;
  margin-bottom: 16px;
  text-align: center;
}

.sync-warn {
  padding: 10px 14px;
  background: #fefce8;
  border: 1.5px solid #fde047;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.5;
  color: #854d0e;
  margin-bottom: 14px;
}

.sync-note {
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  margin-top: 16px;
  line-height: 1.5;
}

.sync-main-btn {
  width: 100%;
  padding: 16px;
  font-size: 15px;
}

/* ── 参加受付カード ── */
.accepting-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  background: #f0fdf4;
  border: 1.5px solid #86efac;
  border-radius: 12px;
  margin-bottom: 16px;
}
.accepting-info {
  display: flex;
  align-items: center;
  gap: 10px;
}
.accepting-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--success, #22c55e);
  flex-shrink: 0;
  animation: pulse 1.5s ease-in-out infinite;
}
.accepting-status {
  font-size: 13px;
  font-weight: 700;
  color: #166534;
}
.accepting-sub {
  font-size: 11px;
  color: #15803d;
  margin-top: 2px;
}
.accepting-btn {
  flex-shrink: 0;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 700;
  color: var(--danger, #ef4444);
  background: #fff;
  border: 1.5px solid var(--danger, #ef4444);
  border-radius: 10px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.accepting-btn:active { background: #fef2f2; }

/* ── ルームコードカード ── */
.room-code-card {
  background: linear-gradient(135deg, #eff6ff, #dbeafe);
  border: 2px solid var(--primary);
  border-radius: 16px;
  padding: 16px 20px;
  text-align: center;
  margin-bottom: 16px;
}

.room-code-label {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-bottom: 8px;
}

.room-code-value {
  font-size: 36px;
  font-weight: 800;
  color: var(--primary);
  letter-spacing: 0.25em;
  font-family: 'SF Mono', 'Menlo', monospace;
  cursor: pointer;
  user-select: all;
  line-height: 1.2;
}

.copy-hint {
  display: block;
  font-size: 11px;
  color: var(--text-muted);
  font-family: inherit;
  letter-spacing: normal;
  font-weight: 600;
  margin-top: 4px;
  cursor: pointer;
}

/* ── QR ── */
.qr-wrap {
  text-align: center;
  margin-bottom: 16px;
  padding: 14px;
  background: white;
  border: 1.5px solid var(--border);
  border-radius: 14px;
}
.qr-img {
  display: inline-block;
  border-radius: 8px;
}
.qr-hint {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
}

/* ── 接続状態 ── */
.connect-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 16px;
}
.connect-status.connected {
  background: #f0fdf4;
  color: var(--success);
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success);
  animation: pulse 1.5s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* ── 参加者リスト ── */
.participants-section {
  margin-bottom: 16px;
}
.participants-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.participants-list {
  border: 1.5px solid var(--border);
  border-radius: 10px;
  background: #f8fafc;
  overflow: hidden;
}
.participant-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  font-size: 14px;
}
.participant-item:last-child { border-bottom: none; }
.participant-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
}
.participant-dot.me { background: var(--primary); }
.participant-dot.done { background: var(--success, #22c55e); }
.participant-name { flex: 1; font-weight: 600; }
.participant-me {
  font-size: 11px;
  font-weight: 700;
  color: var(--primary);
  background: #eff6ff;
  padding: 2px 8px;
  border-radius: 6px;
}
.participant-status {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 6px;
  white-space: nowrap;
}
.participant-status.done {
  color: #166534;
  background: #dcfce7;
}
.participant-status.working {
  color: var(--text-muted);
  background: #f1f5f9;
}

/* ── 名前入力 ── */
.name-input {
  width: 100%;
  padding: 14px 16px;
  font-size: 17px;
  font-weight: 600;
  border: 2px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  outline: none;
  font-family: inherit;
  margin-bottom: 14px;
}
.name-input:focus { border-color: var(--primary); }

.msg {
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 14px;
}
.msg.error { background: #fef2f2; color: var(--danger); }

/* ── アクション ── */
.actions {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}

.btn-danger-block {
  background: transparent;
  color: var(--danger);
  border: 2px solid var(--danger);
  border-radius: 12px;
  padding: 14px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  flex: 1;
}
.btn-danger-block:active { background: #fef2f2; }

.qr-toggle-btn {
  width: 100%;
  margin-bottom: 12px;
  font-size: 14px;
}

.btn-success {
  background: var(--success, #22c55e);
  color: white;
  border: none;
  border-radius: 12px;
  padding: 14px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  flex: 1;
}

</style>
