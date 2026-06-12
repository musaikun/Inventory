<script setup>
import { ref } from 'vue'
import { createStore, loadStore } from '../composables/useStore.js'

const emit = defineEmits(['ready'])  // ready(store) — 店舗情報が確定したら

// 'select' | 'create' | 'enter'
const view      = ref('select')
const codeInput = ref('')
const error     = ref('')
const loading   = ref(false)
const newCode   = ref('')

// ── 新規作成 ──────────────────────────────────────────────────────────────────
async function onCreateStore() {
  loading.value = true
  error.value   = ''
  try {
    newCode.value = await createStore()
    view.value    = 'created'
  } catch (e) {
    error.value = `作成できませんでした: ${e.message}`
  } finally {
    loading.value = false
  }
}

// ── 既存コードで入室 ──────────────────────────────────────────────────────────
async function onEnterCode() {
  const code = codeInput.value.trim().toUpperCase()
  if (!/^[A-Z]{4,8}$/.test(code)) {
    error.value = '4〜8文字の英字で入力してください'
    return
  }
  loading.value = true
  error.value   = ''
  try {
    const store = await loadStore(code)
    emit('ready', store)
  } catch (e) {
    if (e.message.includes('見つかりません')) {
      error.value = 'そのコードは存在しません。確認してください。'
    } else {
      error.value = `接続できませんでした: ${e.message}`
    }
  } finally {
    loading.value = false
  }
}

// ── 新規作成完了後に進む ──────────────────────────────────────────────────────
async function onContinueWithNewCode() {
  loading.value = true
  try {
    const store = await loadStore(newCode.value)
    emit('ready', store)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function onCodeInput(e) {
  error.value    = ''
  codeInput.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8)
  e.target.value  = codeInput.value
}
</script>

<template>
  <div class="modal-overlay">
    <div class="modal-sheet setup-sheet">
      <div class="sheet-handle"></div>

      <!-- ── 選択画面 ── -->
      <template v-if="view === 'select'">
        <div class="setup-title">棚卸アプリへようこそ</div>
        <div class="setup-desc">
          店舗コードを使うと、どの端末からでも同じデータにアクセスできます。
        </div>

        <button class="btn btn-primary setup-btn" :disabled="loading" @click="onCreateStore">
          {{ loading ? '作成中...' : '🏪 新しい店舗として始める' }}
        </button>

        <div class="setup-divider"><span>または</span></div>

        <button class="btn btn-secondary setup-btn" @click="view = 'enter'">
          🔑 既存の店舗コードを入力
        </button>

        <div v-if="error" class="setup-error">{{ error }}</div>
      </template>

      <!-- ── コード入力画面 ── -->
      <template v-else-if="view === 'enter'">
        <div class="setup-title">店舗コードを入力</div>
        <div class="setup-desc">以前に発行された店舗コードを入力してください。</div>

        <input
          class="code-input"
          type="text"
          placeholder="例: SAKURA"
          :value="codeInput"
          @input="onCodeInput"
          @keyup.enter="onEnterCode"
          maxlength="8"
          autofocus
        />

        <div v-if="error" class="setup-error">{{ error }}</div>

        <div class="setup-actions">
          <button class="btn btn-secondary" @click="view = 'select'">戻る</button>
          <button class="btn btn-primary" :disabled="loading || codeInput.length < 4" @click="onEnterCode">
            {{ loading ? '確認中...' : '入室する' }}
          </button>
        </div>
      </template>

      <!-- ── 新規作成完了 ── -->
      <template v-else-if="view === 'created'">
        <div class="setup-title">店舗コードが発行されました</div>

        <div class="new-code-card">
          <div class="new-code-label">あなたの店舗コード</div>
          <div class="new-code-value">{{ newCode }}</div>
          <div class="new-code-hint">このコードをメモしておいてください。<br>他の端末でも同じコードでデータにアクセスできます。</div>
        </div>

        <div v-if="error" class="setup-error">{{ error }}</div>

        <button class="btn btn-primary setup-btn" :disabled="loading" @click="onContinueWithNewCode">
          {{ loading ? '準備中...' : '棚卸を始める →' }}
        </button>
      </template>

    </div>
  </div>
</template>

<style scoped>
.setup-sheet {
  padding-bottom: 40px;
}

.setup-title {
  font-size: 18px;
  font-weight: 800;
  color: var(--text);
  text-align: center;
  margin-bottom: 10px;
}

.setup-desc {
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
  line-height: 1.6;
  margin-bottom: 24px;
}

.setup-btn {
  width: 100%;
  padding: 16px;
  font-size: 15px;
  margin-bottom: 4px;
}

.setup-divider {
  text-align: center;
  margin: 14px 0;
  position: relative;
  color: var(--text-muted);
  font-size: 12px;
}
.setup-divider::before,
.setup-divider::after {
  content: '';
  position: absolute;
  top: 50%;
  width: calc(50% - 24px);
  height: 1px;
  background: var(--border);
}
.setup-divider::before { left: 0; }
.setup-divider::after  { right: 0; }

.setup-error {
  margin-top: 10px;
  padding: 10px 14px;
  background: #fef2f2;
  border-radius: 10px;
  font-size: 13px;
  color: var(--danger);
  font-weight: 600;
}

.setup-actions {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}

.code-input {
  width: 100%;
  padding: 16px;
  font-size: 24px;
  font-weight: 800;
  text-align: center;
  letter-spacing: 0.2em;
  border: 2px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  outline: none;
  font-family: 'SF Mono', 'Menlo', monospace;
  text-transform: uppercase;
  margin-bottom: 10px;
}
.code-input:focus { border-color: var(--primary); }

.new-code-card {
  background: linear-gradient(135deg, #eff6ff, #dbeafe);
  border: 2px solid var(--primary);
  border-radius: 16px;
  padding: 20px;
  text-align: center;
  margin-bottom: 20px;
}
.new-code-label {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 10px;
}
.new-code-value {
  font-size: 40px;
  font-weight: 800;
  color: var(--primary);
  letter-spacing: 0.25em;
  font-family: 'SF Mono', 'Menlo', monospace;
  margin-bottom: 12px;
}
.new-code-hint {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.6;
}
</style>
