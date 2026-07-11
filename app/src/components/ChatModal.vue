<script setup>
import { ref, computed, nextTick, onMounted, watch } from 'vue'
import { useSync, broadcastMessage, broadcastMessageDelete } from '../composables/useSync.js'
import { deviceId } from '../composables/useDeviceId.js'
import { useEscapeKey } from '../composables/useEscapeKey.js'

const emit = defineEmits(['close'])
useEscapeKey(() => emit('close'))

const { state, participantList, messages } = useSync()

const inputText    = ref('')
const replyTo      = ref(null)  // { id, text, senderName }
const inputRef     = ref(null)
const listRef      = ref(null)
const showMentions = ref(false)
const mentionQuery = ref('')
const mentionStart = ref(0)

// ── スクロール制御 ─────────────────────────────────────────────────────────────
function isNearBottom() {
  if (!listRef.value) return true
  const el = listRef.value
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80
}

function scrollToBottom(force = false) {
  if (!listRef.value) return
  if (force || isNearBottom()) {
    listRef.value.scrollTop = listRef.value.scrollHeight
  }
}

watch(() => messages.length, async () => {
  await nextTick()
  scrollToBottom()
})

onMounted(() => {
  nextTick(() => {
    scrollToBottom(true)
    inputRef.value?.focus()
  })
})

// ── 送信 ──────────────────────────────────────────────────────────────────────
function onSend() {
  const text = inputText.value.trim()
  if (!text) return
  broadcastMessage(text, replyTo.value)
  inputText.value = ''
  replyTo.value   = null
  showMentions.value = false
  nextTick(() => {
    if (inputRef.value) inputRef.value.value = ''
    inputRef.value?.focus()
  })
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    onSend()
  }
}

// ── 返信 ──────────────────────────────────────────────────────────────────────
function setReply(msg) {
  replyTo.value = { id: msg.id, text: msg.text, senderName: msg.senderName }
  inputRef.value?.focus()
}

function cancelReply() {
  replyTo.value = null
}

// ── 長押しメニュー（LINE風: 返信 / 送信取り消し）───────────────────────────────
const actionMsg = ref(null)   // 操作対象メッセージ
let _pressTimer = null

function onPressStart(msg) {
  clearTimeout(_pressTimer)
  _pressTimer = setTimeout(() => { actionMsg.value = msg }, 450)
}
function onPressEnd() {
  clearTimeout(_pressTimer)
  _pressTimer = null
}
function closeActions() {
  actionMsg.value = null
}
function actionReply() {
  if (actionMsg.value) setReply(actionMsg.value)
  closeActions()
}
function actionUnsend() {
  const m = actionMsg.value
  closeActions()
  if (!m || m.senderId !== deviceId) return   // 自分のメッセージのみ
  if (!confirm('このメッセージの送信を取り消しますか？\n全員の画面から消え、記録にも残りません。')) return
  broadcastMessageDelete(m.id)
}

// ── 元メッセージへスクロール ────────────────────────────────────────────────────
function scrollToMsg(id) {
  const el = document.getElementById(`msg-${id}`)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

// ── @メンション ────────────────────────────────────────────────────────────────
function onInput() {
  const el = inputRef.value
  if (!el) return
  inputText.value = el.value

  // カーソル手前の最後の @ を検出
  const before   = el.value.slice(0, el.selectionStart)
  const atMatch  = before.match(/@(\w*)$/)
  if (atMatch) {
    mentionQuery.value = atMatch[1]
    mentionStart.value = el.selectionStart - atMatch[0].length
    showMentions.value = true
  } else {
    showMentions.value = false
  }
}

const mentionCandidates = computed(() => {
  const q = mentionQuery.value.toLowerCase()
  return participantList.value.filter(p => !p.isMe && p.name.toLowerCase().includes(q))
})

function insertMention(name) {
  const el      = inputRef.value
  const cur     = el.value
  const after   = cur.slice(el.selectionStart)
  const newText = cur.slice(0, mentionStart.value) + '@' + name + ' ' + after
  inputText.value = newText
  el.value = newText
  showMentions.value = false
  nextTick(() => {
    const pos = mentionStart.value + name.length + 2
    el.setSelectionRange(pos, pos)
    el.focus()
  })
}

// ── テキストレンダリング（XSS対策 + @メンション強調） ─────────────────────────
function escHtml(str) {
  return str
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// escHtml でユーザー入力を先にエスケープするため、
// 出力に含まれるタグは自分たちが挿入した <br> / <span class="mention"> のみ
function renderText(text) {
  return escHtml(text)
    .replace(/@(\S+)/g, '<span class="mention">@$1</span>')
    .replace(/\n/g, '<br>')
}

// ── 時刻フォーマット ─────────────────────────────────────────────────────────
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
}

// ── 日付区切り ───────────────────────────────────────────────────────────────
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('ja-JP', {
    month: 'long', day: 'numeric', weekday: 'short',
  })
}

function needsDateSep(idx) {
  if (idx === 0) return true
  const prev = new Date(messages[idx - 1].timestamp)
  const cur  = new Date(messages[idx].timestamp)
  return prev.toDateString() !== cur.toDateString()
}
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="chat-sheet">
      <!-- ヘッダー -->
      <div class="chat-header">
        <span class="chat-title">💬 チャット</span>
        <span class="chat-room">ルーム {{ state.roomCode }}</span>
        <button class="chat-close-btn" @click="$emit('close')">×</button>
      </div>

      <!-- メッセージリスト -->
      <div ref="listRef" class="chat-messages">
        <div v-if="messages.length === 0" class="chat-empty">
          <div class="chat-empty-icon">💬</div>
          <div>まだメッセージはありません</div>
          <div class="chat-empty-hint">「牛乳の数あってますか？」など<br>気軽に送りましょう</div>
        </div>

        <template v-for="(msg, idx) in messages" :key="msg.id">
          <!-- 日付区切り -->
          <div v-if="needsDateSep(idx)" class="date-sep">
            <span>{{ fmtDate(msg.timestamp) }}</span>
          </div>

          <!-- システムメッセージ -->
          <div v-if="msg.isSystem" class="msg-system">{{ msg.text }}</div>

          <!-- 通常メッセージ行 -->
          <div
            v-else
            :id="`msg-${msg.id}`"
            class="msg-row"
            :class="{ mine: msg.senderId === deviceId }"
          >
            <!-- 他者: 送信者名 -->
            <div v-if="msg.senderId !== deviceId" class="msg-sender-name">
              {{ msg.senderName }}
            </div>

            <div class="msg-body">
              <div
                class="msg-bubble"
                @touchstart.passive="onPressStart(msg)"
                @touchend.passive="onPressEnd"
                @touchmove.passive="onPressEnd"
                @mousedown="onPressStart(msg)"
                @mouseup="onPressEnd"
                @mouseleave="onPressEnd"
                @contextmenu.prevent="actionMsg = msg"
              >
                <!-- 返信引用 -->
                <div
                  v-if="msg.replyTo"
                  class="msg-quote"
                  @click="scrollToMsg(msg.replyTo.id)"
                >
                  <span class="msg-quote-sender">{{ msg.replyTo.senderName }}</span>
                  <span class="msg-quote-text">{{ msg.replyTo.text }}</span>
                </div>

                <!-- 本文 -->
                <div class="msg-text" v-html="renderText(msg.text)"></div>
              </div>
            </div>

            <!-- 時刻 -->
            <div class="msg-time">{{ fmtTime(msg.timestamp) }}</div>
          </div>
        </template>
      </div>

      <!-- 長押しメニュー（返信 / 送信取り消し） -->
      <div v-if="actionMsg" class="action-overlay" @click.self="closeActions">
        <div class="action-sheet">
          <div class="action-preview">{{ actionMsg.text }}</div>
          <button class="action-item" @click="actionReply">↩ 返信</button>
          <button
            v-if="actionMsg.senderId === deviceId"
            class="action-item danger"
            @click="actionUnsend"
          >🗑 送信を取り消す</button>
          <button class="action-item cancel" @click="closeActions">キャンセル</button>
        </div>
      </div>

      <!-- 返信インジケータ -->
      <div v-if="replyTo" class="reply-indicator">
        <span class="reply-ind-icon">↩</span>
        <div class="reply-ind-content">
          <span class="reply-ind-sender">{{ replyTo.senderName }} への返信</span>
          <span class="reply-ind-text">{{ replyTo.text }}</span>
        </div>
        <button class="reply-ind-cancel" @click="cancelReply">×</button>
      </div>

      <!-- @メンション候補 -->
      <div v-if="showMentions && mentionCandidates.length" class="mention-popup">
        <button
          v-for="p in mentionCandidates"
          :key="p.id"
          class="mention-item"
          @mousedown.prevent="insertMention(p.name)"
        >
          @{{ p.name }}
        </button>
      </div>

      <!-- 入力エリア -->
      <div class="chat-input-area">
        <textarea
          ref="inputRef"
          class="chat-input"
          v-model="inputText"
          placeholder="メッセージ… Shift+Enterで改行"
          rows="1"
          maxlength="500"
          @keydown="onKeydown"
          @input="onInput"
        ></textarea>
        <button
          class="chat-send-btn"
          :disabled="!inputText.trim()"
          @click="onSend"
        >送信</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── シート全体 ── */
.chat-sheet {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 85vh;
  height: 85dvh;
  background: #fff;
  border-radius: 20px 20px 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 -4px 32px rgba(0, 0, 0, 0.18);
  z-index: 500;
}

/* ── ヘッダー ── */
.chat-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 16px 12px;
  border-bottom: 1.5px solid var(--border);
  flex-shrink: 0;
}

.chat-title {
  font-size: 16px;
  font-weight: 800;
  color: var(--text);
}

.chat-room {
  font-size: 12px;
  font-weight: 700;
  color: var(--primary);
  background: var(--primary-weak);
  padding: 2px 10px;
  border-radius: 20px;
  letter-spacing: 0.05em;
}

.chat-close-btn {
  margin-left: auto;
  background: none;
  border: none;
  font-size: 22px;
  line-height: 1;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 8px;
}
.chat-close-btn:active { background: var(--border); }

/* ── メッセージリスト ── */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  -webkit-overflow-scrolling: touch;
}

.chat-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 14px;
  gap: 8px;
  text-align: center;
  padding: 40px 0;
}
.chat-empty-icon { font-size: 40px; }
.chat-empty-hint { font-size: 12px; line-height: 1.7; margin-top: 4px; }

/* ── システムメッセージ ── */
.msg-system {
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
  background: #f1f5f9;
  padding: 4px 14px;
  border-radius: 20px;
  margin: 6px auto;
  max-width: 85%;
  font-weight: 600;
}

/* ── 日付区切り ── */
.date-sep {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 10px 0 6px;
}
.date-sep span {
  font-size: 11px;
  color: var(--text-muted);
  background: #f1f5f9;
  padding: 3px 12px;
  border-radius: 20px;
  font-weight: 600;
}

/* ── メッセージ行 ── */
.msg-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  max-width: 78%;
  margin-bottom: 6px;
}

.msg-row.mine {
  align-items: flex-end;
  align-self: flex-end;
}

.msg-sender-name {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  margin-bottom: 3px;
  padding-left: 4px;
}

/* ── バブルとボディ ── */
.msg-body {
  display: flex;
  align-items: flex-end;
  gap: 6px;
}

.mine .msg-body {
  flex-direction: row-reverse;
}

.msg-bubble {
  background: #f1f5f9;
  border-radius: 18px 18px 18px 4px;
  padding: 10px 14px;
  max-width: 100%;
  word-break: break-word;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;   /* 長押しで iOS 標準メニューを出さない */
}

.mine .msg-bubble {
  background: var(--primary);
  border-radius: 18px 18px 4px 18px;
}

.msg-text {
  font-size: 15px;
  line-height: 1.55;
  color: var(--text);
}

.mine .msg-text {
  color: #fff;
}

/* @メンション強調 */
:deep(.mention) {
  color: var(--primary);
  font-weight: 700;
}

.mine :deep(.mention) {
  color: var(--primary-border);
  font-weight: 700;
}

/* ── 引用（返信） ── */
.msg-quote {
  background: rgba(0, 0, 0, 0.06);
  border-left: 3px solid rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  padding: 5px 10px;
  margin-bottom: 6px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mine .msg-quote {
  background: rgba(255, 255, 255, 0.2);
  border-left-color: rgba(255, 255, 255, 0.5);
}

.msg-quote-sender {
  font-size: 11px;
  font-weight: 700;
  color: var(--primary);
}

.mine .msg-quote-sender {
  color: var(--primary-border);
}

.msg-quote-text {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

.mine .msg-quote-text {
  color: rgba(255, 255, 255, 0.75);
}

/* ── 長押しメニュー ── */
.action-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 600;
  display: flex;
  align-items: flex-end;
}
.action-sheet {
  width: 100%;
  background: #fff;
  border-radius: 18px 18px 0 0;
  padding: 8px 12px calc(10px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.action-preview {
  font-size: 12px;
  color: var(--text-muted);
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}
.action-item {
  width: 100%;
  padding: 14px 12px;
  background: none;
  border: none;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.action-item:active { background: #f1f5f9; }
.action-item.danger { color: var(--danger, #dc2626); }
.action-item.cancel { color: var(--text-muted); text-align: center; }

/* ── 時刻 ── */
.msg-time {
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 3px;
  padding: 0 4px;
}

/* ── 返信インジケータ ── */
.reply-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: var(--primary-weak);
  border-top: 1.5px solid var(--primary-border);
  flex-shrink: 0;
}

.reply-ind-icon {
  font-size: 16px;
  color: var(--primary);
  flex-shrink: 0;
}

.reply-ind-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.reply-ind-sender {
  font-size: 11px;
  font-weight: 700;
  color: var(--primary);
}

.reply-ind-text {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.reply-ind-cancel {
  background: none;
  border: none;
  font-size: 18px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 6px;
  flex-shrink: 0;
}

/* ── @メンション候補 ── */
.mention-popup {
  background: #fff;
  border: 1.5px solid var(--border);
  border-radius: 12px;
  margin: 0 12px;
  overflow: hidden;
  flex-shrink: 0;
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.1);
}

.mention-item {
  display: block;
  width: 100%;
  padding: 12px 16px;
  background: none;
  border: none;
  border-bottom: 1px solid var(--border);
  text-align: left;
  font-size: 14px;
  font-weight: 700;
  color: var(--primary);
  cursor: pointer;
}
.mention-item:last-child { border-bottom: none; }
.mention-item:active { background: var(--primary-weak); }

/* ── 入力エリア ── */
.chat-input-area {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 12px 14px;
  border-top: 1.5px solid var(--border);
  background: #fff;
  flex-shrink: 0;
  padding-bottom: max(14px, env(safe-area-inset-bottom));
}

.chat-input {
  flex: 1;
  min-height: 42px;
  max-height: 120px;
  padding: 10px 14px;
  font-size: 15px;
  line-height: 1.5;
  border: 2px solid var(--border);
  border-radius: 22px;
  background: var(--surface);
  resize: none;
  outline: none;
  font-family: inherit;
  overflow-y: auto;
}
.chat-input:focus { border-color: var(--primary); }

.chat-send-btn {
  flex-shrink: 0;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 22px;
  padding: 10px 18px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  height: 42px;
  white-space: nowrap;
}
.chat-send-btn:disabled {
  background: var(--border);
  color: var(--text-muted);
  cursor: default;
}
.chat-send-btn:not(:disabled):active {
  background: var(--primary-deep);
}
</style>
