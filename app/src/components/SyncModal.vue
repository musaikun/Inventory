<script setup>
import { ref, onMounted, nextTick } from 'vue'
import QRCode from 'qrcode'
import { useSync } from '../composables/useSync.js'
import { deviceName, setDeviceName } from '../composables/useDeviceId.js'
import { useEscapeKey } from '../composables/useEscapeKey.js'
import { isAuthenticated, createSession } from '../composables/useAuth.js'
import { useSession } from '../composables/useSession.js'

const emit = defineEmits(['close', 'newSession', 'viewMember'])

const props = defineProps({
  isInventoryCompleted: { type: Boolean, default: false },
  // メイン画面のCTAから開いたとき、マウント時に自動でルーム作成フローを起動する
  autoCreate:           { type: Boolean, default: false },
})

const { pendingSession, markActive, begin } = useSession()
useEscapeKey(() => emit('close'))
const {
  state, participantList, isHost, isGuest,
  createRoom, joinRoom, leaveRoom, dissolveRoom, getShareUrl,
} = useSync()

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
  // CTA からの自動作成: まだホスト/ゲストでないときだけルーム作成を起動
  else if (props.autoCreate) onCreateRoom()
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

      emit('newSession', { sessionId, isResume: false })
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

// ── 招待リンク共有 ────────────────────────────────────────────────────────────
const urlCopied = ref(false)
const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

function _inviteText() {
  return '棚卸ルームへの招待です。下記リンクから参加してください。'
}

async function onCopyUrl() {
  const url = getShareUrl()
  if (!url) return
  try {
    await navigator.clipboard.writeText(url)
    urlCopied.value = true
    setTimeout(() => urlCopied.value = false, 1500)
  } catch (_) {}
}

async function onNativeShare() {
  const url = getShareUrl()
  if (!url) return
  try {
    await navigator.share({ title: '棚卸ルーム招待', text: _inviteText(), url })
  } catch (_) { /* ユーザーがキャンセル */ }
}

function onShareLine() {
  const url = getShareUrl()
  if (!url) return
  const text = `${_inviteText()}\n${url}`
  window.open(`https://line.me/R/msg/text/?${encodeURIComponent(text)}`, '_blank', 'noopener')
}

function onShareMail() {
  const url = getShareUrl()
  if (!url) return
  const subject = encodeURIComponent('棚卸ルームへの招待')
  const body    = encodeURIComponent(`${_inviteText()}\n\n${url}`)
  window.location.href = `mailto:?subject=${subject}&body=${body}`
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
          ※ メンバーはこの画面で発行される招待リンク／QRから参加します。<br>
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
              <div class="accepting-sub">下の招待リンク／QRを共有して参加してもらいます</div>
            </div>
          </div>
          <button class="accepting-btn" @click="onCloseRoom">受付終了</button>
        </div>

        <!-- 招待リンク共有 -->
        <div class="share-section">
          <div class="share-label">招待リンクを送る</div>
          <button class="share-url-row" @click="onCopyUrl">
            <span class="share-url-text">{{ getShareUrl() }}</span>
            <span class="share-url-copy">{{ urlCopied ? '✓' : '📋' }}</span>
          </button>
          <div class="share-btns">
            <button v-if="canNativeShare" class="share-btn share-btn-native" @click="onNativeShare">
              📤 共有
            </button>
            <button class="share-btn share-btn-line" @click="onShareLine">
              <span class="share-btn-ico">💬</span> LINE
            </button>
            <button class="share-btn share-btn-mail" @click="onShareMail">
              <span class="share-btn-ico">✉️</span> メール
            </button>
          </div>
        </div>

        <button class="btn btn-secondary qr-toggle-btn" @click="toggleQR">
          {{ showQR ? '🔼 QRコードを閉じる' : '📷 QRコードを表示' }}
        </button>

        <div v-if="showQR && qrDataUrl" class="qr-wrap">
          <img :src="qrDataUrl" alt="ルーム参加QR" class="qr-img" />
          <div class="qr-hint">このQRコードを読み取るとルームに参加できます</div>
        </div>

        <div class="participants-section">
          <div class="participants-title">参加者（{{ participantList.length }}名）</div>
          <div class="participants-list">
            <button v-for="p in participantList" :key="p.id" class="participant-item" @click="emit('viewMember', p); emit('close')" title="タップで変更履歴を見る">
              <span class="participant-dot" :class="{ me: p.isMe, done: p.isDone }"></span>
              <span class="participant-name">{{ p.name }}</span>
              <span v-if="p.isMe" class="participant-me">あなた</span>
              <span v-if="p.isDone" class="participant-status done">✓ 完了</span>
              <span v-else class="participant-status working">作業中</span>
              <span class="participant-chevron">›</span>
            </button>
          </div>
        </div>

        <div class="actions">
          <button class="btn btn-secondary" @click="$emit('close')">棚卸に戻る</button>
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

        <div class="connect-status connected">
          <span class="status-dot"></span>
          同期中
        </div>

        <div class="participants-section">
          <div class="participants-title">参加者（{{ participantList.length }}名）</div>
          <div class="participants-list">
            <button v-for="p in participantList" :key="p.id" class="participant-item" @click="emit('viewMember', p); emit('close')" title="タップで変更履歴を見る">
              <span class="participant-dot" :class="{ me: p.isMe, done: p.isDone }"></span>
              <span class="participant-name">{{ p.name }}</span>
              <span v-if="p.isMe" class="participant-me">あなた</span>
              <span v-if="p.isDone" class="participant-status done">✓ 完了</span>
              <span v-else class="participant-status working">作業中</span>
              <span class="participant-chevron">›</span>
            </button>
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

/* ── 招待リンク共有 ── */
.share-section {
  margin-bottom: 16px;
}

.share-label {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 700;
  margin-bottom: 8px;
}

.share-url-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  cursor: pointer;
  margin-bottom: 8px;
  -webkit-tap-highlight-color: transparent;
  text-align: left;
}
.share-url-row:active { background: #f1f5f9; }

.share-url-text {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--text);
  font-family: 'SF Mono', 'Menlo', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.share-url-copy {
  flex-shrink: 0;
  font-size: 14px;
}

.share-btns {
  display: flex;
  gap: 8px;
}

.share-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 11px 8px;
  border: none;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: opacity 0.15s;
}
.share-btn:active { opacity: 0.8; }

.share-btn-native { background: #e0e7ff; color: #3730a3; }
.share-btn-line   { background: #06c755; color: #fff; }
.share-btn-mail   { background: #f1f5f9; color: #334155; }
.share-btn-ico    { font-size: 13px; }

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
  border: none;
  border-bottom: 1px solid var(--border);
  font-size: 14px;
  width: 100%;
  background: none;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.participant-item:last-child { border-bottom: none; }
.participant-item:active { background: #f1f5f9; }
.participant-chevron {
  margin-left: auto;
  color: var(--text-muted, #94a3b8);
  font-size: 18px;
  font-weight: 700;
}
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

</style>
