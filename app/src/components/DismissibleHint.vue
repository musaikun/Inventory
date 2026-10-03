<script setup>
/**
 * ✕ で消せる操作の説明。消したことは端末ごとに覚え、各種設定から戻せる（composables/useHints）。
 * 見た目（文字の大きさ・色・余白）は置き場所の class に任せ、ここは ✕ を足すだけ。
 */
import { isHintShown, dismissHint } from '../composables/useHints.js'

defineProps({
  id: { type: String, required: true },
  tag: { type: String, default: 'div' },
})
</script>

<template>
  <component :is="tag" v-if="isHintShown(id)" class="dh">
    <span class="dh-body"><slot /></span>
    <button type="button" class="dh-x" aria-label="この説明を消す" title="この説明を消す（各種設定から戻せます）" @click.stop="dismissHint(id)">✕</button>
  </component>
</template>

<style scoped>
.dh { display: flex; align-items: flex-start; gap: 6px; }
.dh-body { flex: 1; min-width: 0; }
.dh-x {
  flex: none; border: none; background: none; color: inherit; opacity: .6; cursor: pointer;
  font-size: 12px; line-height: 1; padding: 4px 6px; margin: -3px -4px -3px 0; border-radius: 6px;
}
.dh-x:hover, .dh-x:focus-visible { opacity: 1; }
</style>
