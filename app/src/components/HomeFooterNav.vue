<script setup>
/**
 * 下部ナビ（全画面共通・User決定 2026-10-01）。在庫／カレンダー／レポート／管理。
 * カレンダーは履歴カレンダーをタブにしたもの（User決定 2026-10-04）。日ごとに予定・やること・記録を並べる。
 * バッジ: 他の端末が追加したやることがあれば「新着」、無ければ今日の未完了のやることの数。
 *
 * ホームではタブを切り替え、入出庫・棚卸の詳細などからはホームの該当タブへ移る。
 * 選んでいるタブは、アイコンそのものを光らせる（後ろにやわらかい光・線に光の縁。User決定 2026-10-26。以前はアイコンの上に線）。
 * 光はナビに1つだけ置き、タブが変わるとそのタブへ流れて移る（移る間は横に伸びる・User決定 2026-10-26）。
 * 棚卸中・発注中の画面には出さない（下の「完了」と並び、押し間違えて途中で離れやすい）。
 * モーダル（取込の途中を含む）が出ているあいだも隠す。
 */
import { canSeeReport } from '../composables/useAuth.js'
import { computed, ref, watch, onUnmounted } from 'vue'
import { modalLayerCount } from '../composables/appMenuState.js'
import { newTasks, todayOpenCount } from '../composables/useTasks.js'

const props = defineProps({ active: { type: String, default: null } })   // 'sessions' | 'report' | 'dashboard' | null
const emit = defineEmits(['go'])

// アイコンは線画（アプリのアイコンの雰囲気に揃える・User決定 2026-10-03）
const ALL_ITEMS = [
  { tab: 'home',      label: 'ホーム',   d: ['M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'] },
  { tab: 'sessions',  label: '在庫',     d: ['M3 8l9-5 9 5v8l-9 5-9-5z', 'M3 8l9 5 9-5M12 13v8'] },
  // 日誌（やること・予定・記録。以前のカレンダー・User決定 2026-10-09）
  { tab: 'calendar',  label: '日誌',     d: ['M9 6h11M9 12h11M9 18h11', 'M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2'] },
  { tab: 'report',    label: 'レポート', d: ['M5 20V10M12 20V4M19 20v-7'] },
  // 以前の「管理」。取り込み・スタッフをホームへ移し、設定の置き場にした（User決定 2026-10-14）
  { tab: 'dashboard', label: '設定',     d: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'] },
]
// アルバイトには金額を見せないので、レポートのタブも出さない（段 2-3）
const ITEMS = computed(() => ALL_ITEMS.filter(it => it.tab !== 'report' || canSeeReport.value))   // レポートは「レポート・分析・証跡」の人だけ
// 1つの光をタブの位置へ動かす。動いている間だけ横に伸ばして「流れた」感じを出す
const activeIdx = computed(() => ITEMS.value.findIndex(it => it.tab === props.active))
const orbStyle = computed(() => ({ left: `${((activeIdx.value + 0.5) / ITEMS.value.length) * 100}%` }))
const moving = ref(false)
let _mt = null
watch(activeIdx, (v, o) => {
  if (v < 0 || o < 0) return
  moving.value = true
  clearTimeout(_mt); _mt = setTimeout(() => { moving.value = false }, 420)
})
onUnmounted(() => clearTimeout(_mt))
const badge = computed(() => (newTasks.value.length ? { text: '新着', fresh: true } : todayOpenCount.value ? { text: String(todayOpenCount.value), fresh: false } : null))
</script>

<template>
  <nav v-show="modalLayerCount === 0" class="bnav" aria-label="メニュー">
    <i v-if="activeIdx >= 0" :class="['bnav-orb', { moving }]" :style="orbStyle" aria-hidden="true"></i>
    <button
      v-for="it in ITEMS" :key="it.tab"
      :class="{ on: active === it.tab }" type="button"
      :aria-current="active === it.tab ? 'page' : undefined"
      @click="emit('go', it.tab)"
    ><span class="bnav-ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path v-for="d in it.d" :key="d" :d="d" /></svg></span>{{ it.label }}<span v-if="it.tab === 'home' && badge" :class="['bnav-badge', { fresh: badge.fresh }]">{{ badge.text }}</span></button>
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
/* 選んでいるタブは、アイコンそのものを光らせる（アプリのアイコンの光る輪の色） */
.bnav-ic { position: relative; display: grid; place-items: center; width: 40px; height: 26px; }
.bnav-ic svg { position: relative; transition: filter .3s, transform .3s, color .3s; }
.bnav button.on .bnav-ic svg { color: #0891b2; transform: scale(1.12);
  filter: drop-shadow(0 0 1.5px #a5f3fc) drop-shadow(0 0 5px rgba(34, 211, 238, 1)) drop-shadow(0 0 12px rgba(34, 211, 238, .7)); }
/* ナビに1つだけの光。選んだタブの下へ流れて移る */
.bnav-orb { position: absolute; top: 2px; width: 66px; height: 40px; margin-left: -33px; border-radius: 50%; pointer-events: none;
  background: radial-gradient(closest-side, rgba(34, 211, 238, .6), rgba(52, 211, 153, .28) 55%, transparent);
  filter: blur(2px); animation: bnav-breathe 2.6s ease-in-out infinite;
  transition: left .42s cubic-bezier(.5, 0, .2, 1), transform .42s cubic-bezier(.5, 0, .2, 1); }
.bnav-orb.moving { animation: none; transform: scaleX(1.8) scaleY(.75); }
@keyframes bnav-breathe { 0%, 100% { opacity: .8; transform: scale(1); } 50% { opacity: 1; transform: scale(1.1); } }
@media (prefers-reduced-motion: reduce) { .bnav-ic svg, .bnav-orb { transition: none; animation: none; } .bnav-orb.moving { transform: none; } }
.bnav-badge { position: absolute; top: 0; left: calc(50% + 6px); min-width: 18px; font-size: 10px; font-weight: 800; line-height: 16px; padding: 0 5px; border-radius: 999px; background: #c2410c; color: #fff; }
.bnav-badge.fresh { background: var(--grad-btn); color: var(--on-grad); }
</style>
