<script setup>
import { computed } from 'vue'
import { isOnline } from '../composables/useConnectivity.js'
import {
  saveState, retryPendingSaves, saveFailures, pendingCount,
  pendingPersisted, unpersistedCount, rejectedSaves, dismissRejectedSaves,
} from '../composables/useStore.js'

// オンラインなのに再送が続けて失敗している＝一時的な瞬断ではない。
// 「再送しています…」のままだと保存できていないことが伝わらないため、表示を強める。
const FAILED_THRESHOLD = 2

/**
 * 表示の優先順位。**失われうる変更を、待てば直るものより上に置く**。
 *
 *  'unpersisted' … 端末にも保持できていない（アプリを閉じると失われる）
 *  'failed'      … 送信が続けて失敗している
 *  'pending'     … 未送信あり・再送中
 *  'rejected'    … サーバーに拒否された。再送しても直らず、入力し直しが要る
 *  'offline'     … 未送信は無いがオフライン
 *
 * **オフラインより拒否を先に出す。** オフラインは「そのうち直る」と読めるが、
 * 拒否された保存は放っておいても入らない。オフライン中に拒否の事実が隠れると、
 * ユーザーは接続が戻れば送られると誤解したまま、入力し直す機会を失う。
 */
const mode = computed(() => {
  if (pendingCount.value > 0 || saveState.value === 'pending') {
    if (!pendingPersisted.value) return 'unpersisted'
    if (!isOnline.value)         return 'pending'
    return saveFailures.value >= FAILED_THRESHOLD ? 'failed' : 'pending'
  }
  if (rejectedSaves.value.length) return 'rejected'
  if (!isOnline.value)            return 'offline'
  return ''
})

const countLabel = computed(() => (pendingCount.value > 0 ? `未送信 ${pendingCount.value}件` : '未送信'))

// 失われうる変更が出ている間だけ割り込みで読み上げる。再送中の通常状態は polite。
const liveness = computed(() => (mode.value === 'unpersisted' || mode.value === 'failed' ? 'assertive' : 'polite'))

const rejectedLabel = computed(() => {
  const kinds = [...new Set(rejectedSaves.value.map(r => r.label))]
  return kinds.join('・')
})
</script>

<template>
  <!-- role/aria-live は中身の入れ替えを支援技術へ伝えるため、v-if の外側に常設する -->
  <div class="cb-live" role="status" :aria-live="liveness" aria-atomic="true">
    <transition name="cb-slide">
      <div v-if="mode" :class="['cb', mode]">
        <template v-if="mode === 'unpersisted'">
          <span class="cb-dot">🛑</span>
          <span class="cb-text">
            保存できていない変更が {{ pendingCount }}件あり、うち {{ unpersistedCount }}件はこの端末にも保持できていません。<b>アプリを閉じると失われます。</b>接続を確認して再送してください。
          </span>
          <button class="cb-retry" @click="retryPendingSaves">今すぐ再送</button>
        </template>

        <template v-else-if="mode === 'failed'">
          <span class="cb-dot">⚠️</span>
          <span class="cb-text">
            サーバーへ保存できていません（{{ countLabel }}）。端末には保存済みで、再送を続けます。
          </span>
          <button class="cb-retry" @click="retryPendingSaves">今すぐ再送</button>
        </template>

        <template v-else-if="mode === 'pending'">
          <span class="cb-dot spin">🔄</span>
          <span class="cb-text">
            <template v-if="!isOnline">オフラインです。{{ countLabel }}の変更は端末に保存済みで、接続が戻ると自動で送信します。</template>
            <template v-else>未送信の変更があります（{{ countLabel }}）。再送しています…</template>
          </span>
          <button class="cb-retry" @click="retryPendingSaves">今すぐ再送</button>
        </template>

        <template v-else-if="mode === 'offline'">
          <span class="cb-dot">📴</span>
          <span class="cb-text">オフライン — 変更は端末に保存済み。接続が戻ると自動で同期します。</span>
        </template>

        <template v-else>
          <span class="cb-dot">🛑</span>
          <span class="cb-text">
            {{ rejectedLabel }}の保存がサーバーに拒否されました（{{ rejectedSaves.length }}件）。内容を確認して入力し直してください。
          </span>
          <button class="cb-retry" @click="dismissRejectedSaves">閉じる</button>
        </template>
      </div>
    </transition>
  </div>
</template>

<style scoped>
/* 読み上げ用のラッパ自体は場所を取らない。中の .cb が fixed で被さる */
.cb-live { position: relative; }

.cb {
  position: fixed; top: 0; left: 0; right: 0; z-index: 1900;
  display: flex; align-items: center; gap: 8px;
  padding: 7px 12px; font-size: 12px; font-weight: 700;
  box-shadow: 0 1px 4px rgba(0,0,0,0.12);
}
.cb.offline     { background: #78350f; color: #fde68a; }
.cb.pending     { background: #1e3a8a; color: var(--primary-soft); }
.cb.failed      { background: #7f1d1d; color: #fecaca; }
.cb.unpersisted { background: #450a0a; color: #fecaca; }
.cb.rejected    { background: #7f1d1d; color: #fecaca; }
.cb-dot { flex-shrink: 0; }
.cb-text { flex: 1; min-width: 0; line-height: 1.4; }
.cb-retry { flex-shrink: 0; border: 1px solid currentColor; background: transparent; color: inherit; border-radius: 8px; padding: 3px 8px; font-size: 11px; font-weight: 700; cursor: pointer; }
.spin { display: inline-block; animation: cb-spin 1.1s linear infinite; }
@keyframes cb-spin { to { transform: rotate(360deg); } }
.cb-slide-enter-active, .cb-slide-leave-active { transition: transform 0.25s ease, opacity 0.25s ease; }
.cb-slide-enter-from, .cb-slide-leave-to { transform: translateY(-100%); opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .spin { animation: none; }
  .cb-slide-enter-active, .cb-slide-leave-active { transition: none; }
}
</style>
