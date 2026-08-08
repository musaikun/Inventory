<script setup>
import { computed } from 'vue'
import { shopCode } from '../composables/useStore.js'
import { settingsSection } from '../composables/appMenuState.js'

const props = defineProps({
  // App.vue の currentView。'session' | 'sessions' | 'master' | 'movement' | 'session-detail'
  currentView:      { type: String, required: true },
  // 進行中セッションがある（= 棚卸へ戻れる）
  hasLiveSession:   { type: Boolean, default: false },
  practiceMode:     { type: Boolean, default: false },
  // 発注モードのセッションでは呼称を「発注」に変える
  sessionMode:      { type: String, default: 'stock' },
  syncActive:       { type: Boolean, default: false },
  syncConnected:    { type: Boolean, default: false },
  syncRoomCode:     { type: String, default: '' },
  participantCount: { type: Number, default: 0 },
  // ルーム参加中のゲストは他画面へ移動させない（モバイルのメニュー非表示と同じ制限）
  isGuest:          { type: Boolean, default: false },
})

const emit = defineEmits(['navigate', 'open-sync', 'open-feedback'])

const actNoun = computed(() => (props.sessionMode === 'order' ? '発注' : '棚卸'))

const items = computed(() => {
  const list = []
  if (props.hasLiveSession || props.currentView === 'session') {
    list.push({
      view: 'session',
      icon: '📝',
      label: props.practiceMode ? '練習中の棚卸' : `${actNoun.value}中`,
      sub: props.practiceMode ? '履歴に残りません' : '入力を続ける',
    })
  }
  // 並びは棚卸の順路に合わせる（棚卸 → 準備 → β機能）。
  // 入出庫は初回公開の主導線ではないので最後・β表記にする。
  list.push({ view: 'sessions', icon: '🏠', label: '棚卸',       sub: '開始・履歴' })
  list.push({ view: 'master',   icon: '📚', label: '品目マスタ', sub: '棚卸の準備・リスト管理' })
  list.push({ view: 'movement', icon: '🔄', label: '在庫・入庫', sub: '確認と記録（β）' })
  return list
})

// セッション詳細は一覧から辿る画面なので、一覧をハイライトしておく
const activeView = computed(() =>
  props.currentView === 'session-detail' ? 'sessions' : props.currentView
)
</script>

<template>
  <nav class="dt-nav" aria-label="メインナビゲーション">
    <div class="dt-nav-brand">
      <span class="dt-nav-logo" aria-hidden="true">📋</span>
      <span class="dt-nav-brand-text">
        <span class="dt-nav-name">タナオロ</span>
        <span v-if="shopCode" class="dt-nav-shop">店舗 {{ shopCode }}</span>
      </span>
    </div>

    <ul class="dt-nav-list">
      <li v-for="item in items" :key="item.view">
        <button
          class="dt-nav-item"
          :class="{ active: activeView === item.view }"
          :aria-current="activeView === item.view ? 'page' : undefined"
          :disabled="isGuest && item.view !== 'session'"
          @click="emit('navigate', item.view)"
        >
          <span class="dt-nav-ico" aria-hidden="true">{{ item.icon }}</span>
          <span class="dt-nav-body">
            <span class="dt-nav-label">{{ item.label }}</span>
            <span class="dt-nav-sub">{{ item.sub }}</span>
          </span>
        </button>
      </li>
    </ul>

    <div class="dt-nav-foot">
      <button
        v-if="syncActive"
        class="dt-nav-sync"
        :class="{ offline: !syncConnected }"
        @click="emit('open-sync')"
      >
        <span class="dt-nav-sync-dot" aria-hidden="true"></span>
        <span class="dt-nav-sync-body">
          <span class="dt-nav-sync-title">
            {{ syncConnected ? `ルーム ${syncRoomCode}` : '再接続中…' }}
          </span>
          <span class="dt-nav-sync-sub">{{ participantCount }}名が参加中</span>
        </span>
      </button>

      <button class="dt-nav-mini" :disabled="isGuest" @click="settingsSection = 'all'">
        <span aria-hidden="true">⚙️</span> 設定
      </button>
      <button class="dt-nav-mini" @click="emit('open-feedback')">
        <span aria-hidden="true">💬</span> フィードバック
      </button>
    </div>
  </nav>
</template>

<style scoped>
.dt-nav {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: var(--dt-nav-w);
  z-index: 20;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-right: 1px solid var(--border);
  box-shadow: 1px 0 3px rgba(15, 23, 42, 0.04);
}

/* ── ブランド ── */
.dt-nav-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 18px;
  background: var(--primary);
  color: #fff;
  flex-shrink: 0;
}
.dt-nav-logo { font-size: 22px; }
.dt-nav-brand-text { display: flex; flex-direction: column; min-width: 0; }
.dt-nav-name { font-size: 16px; font-weight: 800; letter-spacing: 0.02em; }
.dt-nav-shop {
  font-size: 11px;
  opacity: 0.85;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── ナビ本体 ── */
.dt-nav-list {
  list-style: none;
  padding: 12px 10px;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  overflow-y: auto;
}

.dt-nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  padding: 10px 12px;
  background: none;
  border: none;
  border-radius: 10px;
  text-align: left;
  color: var(--text);
  cursor: pointer;
  font-family: inherit;
  transition: background 0.13s, color 0.13s;
}
.dt-nav-item:hover:not(:disabled) { background: #f1f5f9; }
.dt-nav-item:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
.dt-nav-item:disabled { opacity: 0.4; cursor: not-allowed; }

.dt-nav-item.active {
  background: var(--primary-weak);
  color: var(--primary-deep);
}
/* 選択中を示す左端のアクセントバー */
.dt-nav-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--primary);
}

.dt-nav-ico { font-size: 18px; width: 22px; text-align: center; flex-shrink: 0; }
.dt-nav-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.dt-nav-label { font-size: 14px; font-weight: 700; line-height: 1.3; }
.dt-nav-sub {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dt-nav-item.active .dt-nav-sub { color: var(--primary); opacity: 0.85; }

/* ── フッター ── */
.dt-nav-foot {
  padding: 10px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}

.dt-nav-sync {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 9px 11px;
  margin-bottom: 4px;
  border: 1px solid var(--primary-border);
  border-radius: 10px;
  background: var(--primary-weak);
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.13s;
}
.dt-nav-sync:hover { background: var(--primary-soft); }
.dt-nav-sync:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
.dt-nav-sync.offline { background: #f8fafc; border-color: var(--border); }

.dt-nav-sync-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success);
  flex-shrink: 0;
  animation: dt-nav-pulse 1.8s ease-in-out infinite;
}
.dt-nav-sync.offline .dt-nav-sync-dot { background: var(--text-muted); animation: none; }

@keyframes dt-nav-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.35; }
}

.dt-nav-sync-body { display: flex; flex-direction: column; min-width: 0; }
.dt-nav-sync-title {
  font-size: 12.5px;
  font-weight: 800;
  color: var(--primary-deep);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dt-nav-sync.offline .dt-nav-sync-title { color: var(--text-muted); }
.dt-nav-sync-sub { font-size: 11px; color: var(--text-muted); }

.dt-nav-mini {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  background: none;
  border: none;
  border-radius: 8px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  text-align: left;
  cursor: pointer;
  transition: background 0.13s, color 0.13s;
}
.dt-nav-mini:hover:not(:disabled) { background: #f1f5f9; color: var(--text); }
.dt-nav-mini:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
.dt-nav-mini:disabled { opacity: 0.4; cursor: not-allowed; }

@media (prefers-reduced-motion: reduce) {
  .dt-nav-item, .dt-nav-mini, .dt-nav-sync { transition: none; }
  .dt-nav-sync-dot { animation: none; }
}
</style>
