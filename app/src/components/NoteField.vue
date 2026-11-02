<script setup>
// 品目の備考（User決定 2026-11-02）。棚卸・発注の入力画面で共通。
// 閉じた状態では1行で出し、押すと文字を打てる。書き終わって離れたとき（change）に save を出す。
// 入力画面はテンキーのために document の keydown を拾っているので、ここで打った文字は外へ漏らさない。
import { ref, nextTick } from 'vue'
import { NOTE_MAX } from '../composables/useInventory.js'

const props = defineProps({
  note:     { type: String,  default: '' },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['save'])

const editing = ref(false)
const draft   = ref('')
const input   = ref(null)

function open() {
  if (props.disabled) return
  draft.value = props.note
  editing.value = true
  nextTick(() => input.value?.focus())
}
function commit() {
  editing.value = false
  if (draft.value.trim() !== props.note.trim()) emit('save', draft.value.trim())
}
</script>

<template>
  <div class="nf">
    <input
      v-if="editing"
      ref="input"
      v-model="draft"
      class="nf-input"
      type="text"
      :maxlength="NOTE_MAX"
      placeholder="例：期限が近いので多めに／奥にもう1箱"
      enterkeyhint="done"
      @keydown.stop
      @keydown.enter.prevent="$event.target.blur()"
      @blur="commit"
    />
    <button v-else type="button" :class="['nf-btn', { has: !!note }]" :disabled="disabled" @click="open">
      <span class="nf-icon" aria-hidden="true">📝</span>
      <span class="nf-text">{{ note || '備考を書く' }}</span>
    </button>
  </div>
</template>

<style scoped>
.nf { margin: 8px 0 10px; }
.nf-btn {
  width: 100%; display: flex; align-items: center; gap: 6px; text-align: left;
  border: 1.5px dashed var(--border); background: transparent; border-radius: 10px;
  padding: 7px 10px; font-size: 13px; color: var(--text-muted); cursor: pointer; font-family: inherit;
}
.nf-btn.has { border-color: #f59e0b; background: #fffbeb; color: #92400e; font-weight: 600; }
.nf-btn:disabled { opacity: 0.5; cursor: default; }
.nf-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nf-input {
  width: 100%; box-sizing: border-box; border: 1.5px solid #f59e0b; border-radius: 10px;
  padding: 8px 10px; font-size: 16px; background: #fffbeb; color: var(--text); outline: none;
}
</style>
