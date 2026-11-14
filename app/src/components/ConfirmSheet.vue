<script setup>
/**
 * アプリの中で訊く確認の画面（`composables/askConfirm.js`）。App に1つだけ置き、
 * **訊いている間だけ mount する**（v-if）。useEscapeKey は mount 中ずっと「戻る」で閉じる層を
 * 積むので、出しっぱなしにすると何も出ていないのに戻るを1回食う。
 */
import { onUnmounted } from 'vue'
import { confirmState, answerConfirm } from '../composables/askConfirm.js'
import { useEscapeKey } from '../composables/useEscapeKey.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

useEscapeKey(() => answerConfirm(false))
// 端末の戻るは「取りやめ」
onUnmounted(registerInnerLayerCloser(() => { answerConfirm(false); return true }))
</script>

<template>
  <Teleport to="body">
    <div v-if="confirmState" class="modal-overlay cf-bg" @click.self="answerConfirm(false)">
      <div class="modal-sheet cf" role="alertdialog" aria-modal="true" :aria-label="confirmState.title">
        <div class="cf-title">{{ confirmState.title }}</div>
        <p v-if="confirmState.body" class="cf-body">{{ confirmState.body }}</p>
        <div class="cf-acts">
          <button type="button" class="cf-btn sec" @click="answerConfirm(false)">{{ confirmState.cancel }}</button>
          <button type="button" :class="['cf-btn', confirmState.danger ? 'danger' : 'pri']" @click="answerConfirm(true)">{{ confirmState.ok }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ほかのシートの上に出ることがある（ルームの共有シートなど） */
.cf-bg { z-index: 9500; }
.cf { display: grid; gap: 12px; }
.cf-title { font-size: 17px; font-weight: 800; color: var(--text, #12303a); line-height: 1.5; }
.cf-body { margin: 0; font-size: 14px; line-height: 1.7; color: var(--text-muted, #4c6a72); white-space: pre-line; }
.cf-acts { display: flex; gap: 8px; margin-top: 4px; }
.cf-btn { flex: 1; min-height: 50px; border-radius: 12px; font-size: 15px; font-weight: 800; cursor: pointer; }
.cf-btn.pri { border: none; background: var(--grad-btn); color: var(--on-grad); }
.cf-btn.danger { border: none; background: #dc2626; color: #fff; }
.cf-btn.sec { border: 1px solid var(--border, #d6e6ea); background: var(--surface, #fff); color: var(--text, #12303a); }
</style>
