<script setup>
import { computed } from 'vue'
import { isOnline } from '../composables/useConnectivity.js'
import { saveState, retryPendingSaves } from '../composables/useStore.js'

// 表示するのは「オフライン」か「未送信あり（再送待ち）」のときだけ。
const mode = computed(() => {
  if (!isOnline.value) return 'offline'
  if (saveState.value === 'pending') return 'pending'
  return ''
})
</script>

<template>
  <transition name="cb-slide">
    <div v-if="mode" :class="['cb', mode]">
      <template v-if="mode === 'offline'">
        <span class="cb-dot">📴</span>
        <span class="cb-text">オフライン — 変更は端末に保存済み。接続が戻ると自動で同期します。</span>
      </template>
      <template v-else>
        <span class="cb-dot spin">🔄</span>
        <span class="cb-text">未送信の変更があります。再送しています…</span>
        <button class="cb-retry" @click="retryPendingSaves">今すぐ再送</button>
      </template>
    </div>
  </transition>
</template>

<style scoped>
.cb {
  position: fixed; top: 0; left: 0; right: 0; z-index: 1900;
  display: flex; align-items: center; gap: 8px;
  padding: 7px 12px; font-size: 12px; font-weight: 700;
  box-shadow: 0 1px 4px rgba(0,0,0,0.12);
}
.cb.offline { background: #78350f; color: #fde68a; }
.cb.pending { background: #1e3a8a; color: var(--primary-soft); }
.cb-dot { flex-shrink: 0; }
.cb-text { flex: 1; min-width: 0; line-height: 1.4; }
.cb-retry { flex-shrink: 0; border: 1px solid currentColor; background: transparent; color: inherit; border-radius: 8px; padding: 3px 8px; font-size: 11px; font-weight: 700; cursor: pointer; }
.spin { display: inline-block; animation: cb-spin 1.1s linear infinite; }
@keyframes cb-spin { to { transform: rotate(360deg); } }
.cb-slide-enter-active, .cb-slide-leave-active { transition: transform 0.25s ease, opacity 0.25s ease; }
.cb-slide-enter-from, .cb-slide-leave-to { transform: translateY(-100%); opacity: 0; }
</style>
