<script setup>
/**
 * 下部ナビ（全画面共通・User決定 2026-10-01）。在庫／レポート／管理。
 * 履歴カレンダーはナビから外した（タブ送りのスワイプとカレンダーの月送りが重なる）。レポートの一番上から開く。
 *
 * ホームではタブを切り替え、入出庫・棚卸の詳細などからはホームの該当タブへ移る。
 * 棚卸中・発注中の画面には出さない（下の「完了」と並び、押し間違えて途中で離れやすい）。
 * モーダル（取込の途中を含む）が出ているあいだも隠す。
 */
import { modalLayerCount } from '../composables/appMenuState.js'

defineProps({ active: { type: String, default: null } })   // 'sessions' | 'report' | 'dashboard' | null
const emit = defineEmits(['go'])

// アイコンは線画（アプリのアイコンの雰囲気に揃える・User決定 2026-10-03）
const ITEMS = [
  { tab: 'sessions',  label: '在庫',     d: ['M3 8l9-5 9 5v8l-9 5-9-5z', 'M3 8l9 5 9-5M12 13v8'] },
  { tab: 'report',    label: 'レポート', d: ['M5 20V10M12 20V4M19 20v-7'] },
  { tab: 'dashboard', label: '管理',     d: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'] },
]
</script>

<template>
  <nav v-show="modalLayerCount === 0" class="bnav" aria-label="メニュー">
    <button
      v-for="it in ITEMS" :key="it.tab"
      :class="{ on: active === it.tab }" type="button"
      :aria-current="active === it.tab ? 'page' : undefined"
      @click="emit('go', it.tab)"
    ><i class="bnav-bar" aria-hidden="true"></i><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path v-for="d in it.d" :key="d" :d="d" /></svg>{{ it.label }}</button>
  </nav>
</template>

<style scoped>
.bnav {
  position: fixed; left: 50%; transform: translateX(-50%); bottom: 0; z-index: 6;
  width: 100%; max-width: 600px; display: flex; background: #fff; border-top: 1px solid #d6e6ea;
  padding: 6px 0 calc(8px + env(safe-area-inset-bottom));
}
.bnav button {
  position: relative; flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding-top: 4px;
  border: none; background: none; font-size: 11px; font-weight: 700; color: #7d969c; cursor: pointer; font-family: inherit;
}
.bnav button.on { color: var(--primary, #0e7490); font-weight: 800; }
/* 選んでいるタブの上に、アイコンの光る輪の色の線 */
.bnav-bar { position: absolute; top: -7px; width: 36px; height: 3px; border-radius: 3px; background: transparent; }
.bnav button.on .bnav-bar { background: var(--grad-ring); box-shadow: 0 0 10px rgba(34, 211, 238, .55); }
</style>
