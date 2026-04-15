<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import QRCode from 'qrcode'
import { useSync } from '../composables/useSync.js'
import { deviceName } from '../composables/useDeviceId.js'
import { useEscapeKey } from '../composables/useEscapeKey.js'

const emit = defineEmits(['close'])
useEscapeKey(() => emit('close'))
const {
  state, participantList, isHost, isGuest,
  createRoom, joinRoom, leaveRoom, getShareUrl,
} = useSync()

// ── UI state ─────────────────────────────────────────────────────────────────
// 'home' | 'host' | 'joinForm' | 'guest'
const view = ref('home')
const joinCode = ref('')
const joinError = ref('')
const copied = ref(false)

const qrDataUrl = ref('')
const qrCanvas = ref(null)

// ── ルーム状態が既にアクティブなら該当ビューへ ─────────────────────────────
onMounted(() => {
  if (isHost.value) view.value = 'host'
  else if (isGuest.value) view.value = 'guest'
})

// ── ホスト作成 ────────────────────────────────────────────────────────────────
const createError = ref('')

async function onCreateRoom() {
  createError.value = ''
  try {
    await createRoom()
    view.value = 'host'
    await nextTick()
    await _generateQR()
  } catch (e) {
    createError.value = state.error || 'ルームを作成できませんでした'
  }
}

// ── ゲスト参加 ────────────────────────────────────────────────────────────────
async function onJoin() {
  joinError.value = ''
  try {
    await joinRoom(joinCode.value)
    view.value = 'guest'
  } catch (e) {
    joinError.value = state.error || '参加できませんでした'
  }
}

// ── ルーム退出 ────────────────────────────────────────────────────────────────
function onLeave() {
  if (isHost.value) {
    if (!confirm('ルームを解散しますか？\n他のメンバーは切断されます。')) return
  }
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

// ── コード入力欄の自動整形 ────────────────────────────────────────────────────
function onCodeInput(e) {
  joinError.value = ''
  const filtered = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
  joinCode.value = filtered
  e.target.value = filtered
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
          🔗 新しいルームを作成
        </button>

        <div v-if="createError" class="msg error" style="margin-top:10px">
          ✗ {{ createError }}
        </div>

        <div class="sync-divider"><span>または</span></div>

        <button class="btn btn-secondary sync-main-btn" @click="view = 'joinForm'">
          🔑 コードを入力して参加
        </button>

        <div class="sync-note">
          ※ 完全オフラインで一人で使う場合は、このまま閉じてください。
        </div>
      </template>

      <!-- ==== ホスト画面 ==== -->
      <template v-else-if="view === 'host'">
        <div class="sheet-title">ルームを共有</div>

        <div class="room-code-card">
          <div class="room-code-label">ルームコード</div>
          <div class="room-code-value" @click="onCopyCode">
            {{ state.roomCode }}
            <span class="copy-hint">{{ copied ? '✓ コピー済み' : '📋 タップでコピー' }}</span>
          </div>
        </div>

        <div v-if="qrDataUrl" class="qr-wrap">
          <img :src="qrDataUrl" alt="ルーム参加QR" class="qr-img" />
          <div class="qr-hint">同じWi-Fi内の他の端末でQRを読み取るとすぐに参加できます</div>
        </div>

        <div class="participants-section">
          <div class="participants-title">参加者（{{ participantList.length }}名）</div>
          <div class="participants-list">
            <div v-for="p in participantList" :key="p.id" class="participant-item">
              <span class="participant-dot" :class="{ me: p.isMe }"></span>
              <span class="participant-name">{{ p.name }}</span>
              <span v-if="p.isMe" class="participant-me">あなた</span>
            </div>
          </div>
        </div>

        <div class="actions">
          <button class="btn btn-secondary" @click="$emit('close')">棚卸に戻る</button>
          <button class="btn btn-danger-block" @click="onLeave">ルームを解散</button>
        </div>
      </template>

      <!-- ==== 参加コード入力 ==== -->
      <template v-else-if="view === 'joinForm'">
        <div class="sheet-title">ルームに参加</div>

        <div class="sync-intro">
          ホストの端末に表示されている4文字のコードを入力してください。
        </div>

        <input
          type="text"
          class="code-input"
          placeholder="例: AB12"
          :value="joinCode"
          @input="onCodeInput"
          @keyup.enter="onJoin"
          autofocus
        />

        <div v-if="joinError" class="msg error">
          ✗ {{ joinError }}
        </div>

        <div class="actions">
          <button class="btn btn-secondary" @click="view = 'home'">戻る</button>
          <button class="btn btn-primary" :disabled="joinCode.length < 4" @click="onJoin">
            参加する
          </button>
        </div>
      </template>

      <!-- ==== ゲスト画面（参加中）==== -->
      <template v-else-if="view === 'guest'">
        <div class="sheet-title">ルーム参加中</div>

        <div class="room-code-card">
          <div class="room-code-label">接続中のルーム</div>
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
              <span class="participant-dot" :class="{ me: p.isMe }"></span>
              <span class="participant-name">{{ p.name }}</span>
              <span v-if="p.isMe" class="participant-me">あなた</span>
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
.sync-main-btn + .sync-main-btn { margin-top: 10px; }

.sync-divider {
  text-align: center;
  margin: 16px 0;
  position: relative;
  color: var(--text-muted);
  font-size: 12px;
}
.sync-divider::before,
.sync-divider::after {
  content: '';
  position: absolute;
  top: 50%;
  width: calc(50% - 30px);
  height: 1px;
  background: var(--border);
}
.sync-divider::before { left: 0; }
.sync-divider::after  { right: 0; }

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
.participant-name { flex: 1; font-weight: 600; }
.participant-me {
  font-size: 11px;
  font-weight: 700;
  color: var(--primary);
  background: #eff6ff;
  padding: 2px 8px;
  border-radius: 6px;
}

/* ── コード入力 ── */
.code-input {
  width: 100%;
  padding: 18px;
  font-size: 28px;
  font-weight: 800;
  text-align: center;
  letter-spacing: 0.3em;
  border: 2px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  font-family: 'SF Mono', 'Menlo', monospace;
  outline: none;
  text-transform: uppercase;
  margin-bottom: 14px;
}
.code-input:focus { border-color: var(--primary); }

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
</style>
