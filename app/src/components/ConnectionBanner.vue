<script setup>
import { computed } from 'vue'
import { isOnline } from '../composables/useConnectivity.js'
import { saveState, retryPendingSaves, saveFailures, pendingCount, pendingPersisted, pendingTruncated } from '../composables/useStore.js'

// オンラインなのに再送が続けて失敗している＝一時的な瞬断ではない。
// 「再送しています…」のままだと保存できていないことが伝わらないため、表示を強める。
const FAILED_THRESHOLD = 2

// 表示優先度：offline → failed → pending → idle
// offline/failed/pending は いずれもUIに通知が必要な状態。
// 未送信が無ければ空の文字列を返して非表示。
const mode = computed(() => {
  if (!isOnline.value) return 'offline'
  if (saveState.value !== 'pending') return ''
  return saveFailures.value >= FAILED_THRESHOLD ? 'failed' : 'pending'
})

const countLabel = computed(() => (pendingCount.value > 0 ? `未送信 ${pendingCount.value}件` : '未送信'))

// 容量制限で失われたデータがあるか
const hasTruncation = computed(() =>
  pendingTruncated.value.snapshots > 0 ||
  pendingTruncated.value.orders > 0 ||
  pendingTruncated.value.movements > 0
)
</script>

<template>
  <transition name="cb-slide">
    <div v-if="mode" :class="['cb', mode]" role="status" aria-live="polite" aria-atomic="true">
      <template v-if="mode === 'offline'">
        <span class="cb-dot">📴</span>
        <span class="cb-text">オフライン — 変更は端末に保存済み。接続が戻ると自動で同期します。</span>
      </template>
      <template v-else-if="mode === 'failed'">
        <span class="cb-dot">⚠️</span>
        <span class="cb-text">
          <template v-if="hasTruncation">
            サーバーへ保存できていません（{{ countLabel }}、一部は容量不足で失われた可能性があります）。
          </template>
          <template v-else>
            サーバーへ保存できていません（{{ countLabel }}）。
          </template>
          <template v-if="pendingPersisted">端末には保存済み。今すぐ再送してください。</template>
          <template v-else>この端末では未送信分を保持できません。今すぐ再送してください。</template>
        </span>
        <button class="cb-retry" @click="retryPendingSaves">今すぐ再送</button>
      </template>
      <template v-else>
        <span class="cb-dot spin">🔄</span>
        <span class="cb-text">
          <template v-if="hasTruncation">
            未送信の変更があります（{{ countLabel }}、一部は容量不足で失われた可能性があります）。再送しています…
          </template>
          <template v-else>
            未送信の変更があります（{{ countLabel }}）。再送しています…
          </template>
        </span>
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
.cb.failed  { background: #7f1d1d; color: #fecaca; }
.cb-dot { flex-shrink: 0; }
.cb-text { flex: 1; min-width: 0; line-height: 1.4; }
.cb-retry { flex-shrink: 0; border: 1px solid currentColor; background: transparent; color: inherit; border-radius: 8px; padding: 3px 8px; font-size: 11px; font-weight: 700; cursor: pointer; }
.spin { display: inline-block; animation: cb-spin 1.1s linear infinite; }
@keyframes cb-spin { to { transform: rotate(360deg); } }
.cb-slide-enter-active, .cb-slide-leave-active { transition: transform 0.25s ease, opacity 0.25s ease; }
.cb-slide-enter-from, .cb-slide-leave-to { transform: translateY(-100%); opacity: 0; }
</style>
