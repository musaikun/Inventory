<script setup>
import { shopCode } from '../composables/useStore.js'

const props = defineProps({
  hasActiveSession: Boolean,
  filledCount:      { type: Number, default: 0 },
  snapshots:        { type: Array,  default: () => [] },
  activeRoomCode:   { type: String, default: null },
})

const emit = defineEmits([
  'new-session', 'continue-session',
  'open-history', 'join-active-room',
  'settings', 'sync',
])

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
}

function filledItems(snap) {
  return snap.items?.filter(i => i.qty !== null).length ?? 0
}
</script>

<template>
  <div class="home-screen">

    <!-- ヘッダー -->
    <header class="home-header">
      <div class="home-title">棚卸管理</div>
      <div class="home-header-right">
        <button class="home-icon-btn" @click="$emit('sync')" title="同期">🔗</button>
        <button class="home-icon-btn" @click="$emit('settings')" title="設定">⚙️</button>
      </div>
    </header>

    <!-- 店舗コードバッジ -->
    <div class="home-store-badge">
      <span class="home-store-label">店舗コード</span>
      <span class="home-store-code">{{ shopCode }}</span>
    </div>

    <!-- 進行中ルーム案内 -->
    <div v-if="activeRoomCode" class="home-room-notice">
      <div class="home-room-notice-text">
        <strong>進行中の棚卸ルームがあります</strong><br>
        <span class="home-room-code">ルーム: {{ activeRoomCode }}</span>
      </div>
      <button class="btn btn-primary home-room-btn" @click="$emit('join-active-room', activeRoomCode)">
        参加する
      </button>
    </div>

    <!-- 進行中セッション再開 -->
    <div v-if="hasActiveSession" class="home-active-card">
      <div class="home-active-info">
        <div class="home-active-title">棚卸を再開しますか？</div>
        <div class="home-active-meta">{{ filledCount }}件 入力済み</div>
      </div>
      <button class="btn btn-primary" @click="$emit('continue-session')">続きから →</button>
    </div>

    <!-- 新規棚卸ボタン -->
    <button class="home-new-btn" @click="$emit('new-session')">
      <span class="home-new-plus">＋</span>
      <span class="home-new-text">新規棚卸を開始</span>
    </button>

    <!-- 履歴一覧 -->
    <div class="home-history">
      <div class="home-history-header">
        <span class="home-history-title">過去の棚卸</span>
        <button class="home-history-all" @click="$emit('open-history')">すべて表示 ›</button>
      </div>

      <div v-if="snapshots.length === 0" class="home-history-empty">
        完了した棚卸はまだありません
      </div>

      <div
        v-for="snap in snapshots.slice(0, 5)"
        :key="snap.date"
        class="home-history-item"
        @click="$emit('open-history')"
      >
        <div class="home-history-date">{{ formatDate(snap.date) }}</div>
        <div class="home-history-right">
          <span class="home-history-count">{{ filledItems(snap) }}件</span>
          <span v-if="snap.totalValue != null" class="home-history-value">
            ¥{{ snap.totalValue.toLocaleString('ja-JP') }}
          </span>
          <span class="home-history-arrow">›</span>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.home-screen {
  min-height: 100vh;
  background: var(--bg);
  display: flex;
  flex-direction: column;
}

.home-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.home-title {
  font-size: 18px;
  font-weight: 800;
  color: var(--text);
}

.home-header-right {
  display: flex;
  gap: 4px;
}

.home-icon-btn {
  width: 40px;
  height: 40px;
  border: none;
  background: transparent;
  font-size: 20px;
  cursor: pointer;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-tap-highlight-color: transparent;
}
.home-icon-btn:active { background: var(--border); }

.home-store-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  background: #eff6ff;
  border-bottom: 1px solid #dbeafe;
}

.home-store-label {
  font-size: 11px;
  font-weight: 700;
  color: #3b82f6;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.home-store-code {
  font-size: 16px;
  font-weight: 800;
  color: var(--primary);
  font-family: 'SF Mono', 'Menlo', monospace;
  letter-spacing: 0.15em;
}

.home-room-notice {
  margin: 12px 16px 0;
  padding: 12px 14px;
  background: #fffbeb;
  border: 1.5px solid #fcd34d;
  border-radius: 14px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.home-room-notice-text {
  flex: 1;
  font-size: 13px;
  color: #92400e;
  line-height: 1.5;
}

.home-room-code {
  font-family: 'SF Mono', 'Menlo', monospace;
  font-weight: 700;
}

.home-room-btn {
  flex-shrink: 0;
  padding: 8px 14px;
  font-size: 13px;
}

.home-active-card {
  margin: 12px 16px 0;
  padding: 14px 16px;
  background: #f0fdf4;
  border: 1.5px solid var(--success);
  border-radius: 14px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.home-active-info { flex: 1; }

.home-active-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--success);
  margin-bottom: 2px;
}

.home-active-meta {
  font-size: 12px;
  color: var(--text-muted);
}

.home-new-btn {
  margin: 16px 16px 0;
  padding: 20px;
  background: var(--primary);
  color: white;
  border: none;
  border-radius: 18px;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  width: calc(100% - 32px);
  -webkit-tap-highlight-color: transparent;
  transition: opacity 0.15s;
}
.home-new-btn:active { opacity: 0.85; }

.home-new-plus {
  font-size: 28px;
  font-weight: 300;
  line-height: 1;
}

.home-new-text {
  font-size: 17px;
  font-weight: 800;
}

.home-history {
  margin: 20px 16px 32px;
  flex: 1;
}

.home-history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.home-history-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.home-history-all {
  font-size: 13px;
  font-weight: 600;
  color: var(--primary);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}

.home-history-empty {
  text-align: center;
  padding: 40px 0;
  font-size: 14px;
  color: var(--text-muted);
}

.home-history-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: var(--surface);
  border-radius: 12px;
  margin-bottom: 8px;
  cursor: pointer;
  border: 1px solid var(--border);
  -webkit-tap-highlight-color: transparent;
}
.home-history-item:active { background: #f1f5f9; }

.home-history-date {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.home-history-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.home-history-count {
  font-size: 12px;
  color: var(--text-muted);
}

.home-history-value {
  font-size: 13px;
  font-weight: 700;
  color: var(--success);
}

.home-history-arrow {
  font-size: 18px;
  color: var(--text-muted);
  font-weight: 300;
}
</style>
