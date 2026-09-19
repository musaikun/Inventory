<script setup>
// 時間のかかる処理のあいだ、画面全体を覆って「待っていればいい」と伝える。
// 覆うのは、待っている最中に別の操作を始められると取込が二重になるため。
// App.vue に1つだけ置き、どの画面からでも useBusy 経由で出す。
import { busyLabel } from '../composables/useBusy.js'
import LoadingSpinner from './LoadingSpinner.vue'
</script>

<template>
  <transition name="busy-fade">
    <div v-if="busyLabel" class="busy-back" role="alertdialog" aria-modal="true" :aria-label="busyLabel">
      <div class="busy-card">
        <LoadingSpinner :label="busyLabel" />
        <p class="busy-note">そのままお待ちください</p>
      </div>
    </div>
  </transition>
</template>

<style scoped>
/* いちばん上。モーダルやシートの上にも出す必要がある（取込は modal の中から始まる） */
.busy-back {
  position: fixed; inset: 0; z-index: 9000;
  background: rgba(15, 23, 42, 0.42);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
}
.busy-card {
  min-width: 200px; max-width: 320px;
  background: #fff; border-radius: 16px;
  padding: 22px 24px 16px;
  box-shadow: 0 16px 44px rgba(15, 23, 42, 0.3);
  text-align: center;
}
.busy-note { margin: 2px 0 0; font-size: 11px; color: #94a3b8; }

.busy-fade-enter-active, .busy-fade-leave-active { transition: opacity 0.16s linear; }
.busy-fade-enter-from, .busy-fade-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .busy-fade-enter-active, .busy-fade-leave-active { transition: none; }
}
</style>
