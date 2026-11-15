<script setup>
/**
 * アプリの中で訊く確認の画面（`composables/askConfirm.js`）。App に1つだけ置き、
 * **訊いている間だけ mount する**（v-if）。useEscapeKey は mount 中ずっと「戻る」で閉じる層を
 * 積むので、出しっぱなしにすると何も出ていないのに戻るを1回食う。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { confirmState, answerConfirm } from '../composables/askConfirm.js'
import { useEscapeKey } from '../composables/useEscapeKey.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

useEscapeKey(() => answerConfirm(false))
// 文字を訊くときは、開いたらすぐ打てるように
const inputRef = ref(null)
onMounted(() => { inputRef.value?.focus(); inputRef.value?.select?.() })
// 端末の戻るは「取りやめ」
onUnmounted(registerInnerLayerCloser(() => { answerConfirm(false); return true }))
</script>

<template>
  <Teleport to="body">
    <div v-if="confirmState" class="modal-overlay cf-bg" @click.self="answerConfirm(false)">
      <div class="modal-sheet cf" role="alertdialog" aria-modal="true" :aria-label="confirmState.title">
        <div class="cf-title">{{ confirmState.title }}</div>
        <p v-if="confirmState.body" class="cf-body">{{ confirmState.body }}</p>
        <template v-if="confirmState.input">
          <input
            ref="inputRef" v-model="confirmState.value" class="cf-input" type="text" enterkeyhint="done"
            :placeholder="confirmState.placeholder" :maxlength="confirmState.maxLength" :aria-label="confirmState.title"
            :aria-invalid="confirmState.error ? 'true' : undefined"
            @input="confirmState.error = ''" @keydown.enter.prevent="answerConfirm(true)"
          />
          <p v-if="confirmState.error" class="cf-err" role="alert">{{ confirmState.error }}</p>
        </template>
        <div class="cf-acts">
          <button v-if="confirmState.cancel" type="button" class="cf-btn sec" @click="answerConfirm(false)">{{ confirmState.cancel }}</button>
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
.cf-input { width: 100%; box-sizing: border-box; min-height: 50px; padding: 0 14px; border-radius: 12px; border: 1.5px solid var(--border, #d6e6ea); background: var(--surface, #fff); color: var(--text, #12303a); font-size: 16px; font-weight: 700; }
.cf-input:focus { outline: none; border-color: var(--primary, #0e7490); }
.cf-input[aria-invalid="true"] { border-color: #dc2626; }
.cf-err { margin: 0; font-size: 13px; font-weight: 700; color: #dc2626; }
.cf-acts { display: flex; gap: 8px; margin-top: 4px; }
.cf-btn { flex: 1; min-height: 50px; border-radius: 12px; font-size: 15px; font-weight: 800; cursor: pointer; }
.cf-btn.pri { border: none; background: var(--grad-btn); color: var(--on-grad); }
.cf-btn.danger { border: none; background: #dc2626; color: #fff; }
.cf-btn.sec { border: 1px solid var(--border, #d6e6ea); background: var(--surface, #fff); color: var(--text, #12303a); }
</style>
