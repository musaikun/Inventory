<script setup>
/**
 * 下部ナビ（全画面共通・User決定 2026-10-01）。在庫／履歴／レポート／管理。
 *
 * ホームではタブを切り替え、入出庫・棚卸の詳細などからはホームの該当タブへ移る。
 * 棚卸中・発注中の画面には出さない（下の「完了」と並び、押し間違えて途中で離れやすい）。
 * モーダル（取込の途中を含む）が出ているあいだも隠す。
 */
import { modalLayerCount } from '../composables/appMenuState.js'

defineProps({ active: { type: String, default: null } })   // 'sessions' | 'history' | 'report' | 'dashboard' | null
const emit = defineEmits(['go'])

const ITEMS = [
  { tab: 'sessions',  icon: '📦', label: '在庫' },
  { tab: 'history',   icon: '📅', label: '履歴' },
  { tab: 'report',    icon: '📊', label: 'レポート' },
  { tab: 'dashboard', icon: '🗂', label: '管理' },
]
</script>

<template>
  <nav v-show="modalLayerCount === 0" class="bnav" aria-label="メニュー">
    <button
      v-for="it in ITEMS" :key="it.tab"
      :class="{ on: active === it.tab }" type="button"
      :aria-current="active === it.tab ? 'page' : undefined"
      @click="emit('go', it.tab)"
    ><b>{{ it.icon }}</b>{{ it.label }}</button>
  </nav>
</template>

<style scoped>
.bnav {
  position: fixed; left: 50%; transform: translateX(-50%); bottom: 0; z-index: 6;
  width: 100%; max-width: 600px; display: flex; background: #fff; border-top: 1px solid #e2e8f0;
  padding: 6px 0 calc(8px + env(safe-area-inset-bottom));
}
.bnav button { flex: 1; border: none; background: none; font-size: 11px; font-weight: 700; color: #94a3b8; cursor: pointer; font-family: inherit; }
.bnav button b { display: block; font-size: 20px; filter: grayscale(1); opacity: .55; }
.bnav button.on { color: var(--primary, #2563eb); }
.bnav button.on b { filter: none; opacity: 1; }
</style>
