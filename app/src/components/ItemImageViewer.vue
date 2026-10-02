<script setup>
// 品目の写真を大きく見る。タップ・戻る・Escape で閉じる（モーダルの層に積む）
import { useEscapeKey } from '../composables/useEscapeKey.js'
import { itemImageUrl } from '../services/itemImages.js'

const props = defineProps({
  item:     { type: String, required: true },
  imageRef: { type: String, required: true },
})
const emit = defineEmits(['close'])
useEscapeKey(() => emit('close'))
</script>

<template>
  <div class="img-view" role="dialog" aria-modal="true" :aria-label="`${props.item}の写真`" @click="emit('close')">
    <img :src="itemImageUrl(props.imageRef, 'f')" :alt="props.item" />
    <div class="img-view-name">{{ props.item }}</div>
  </div>
</template>

<style scoped>
.img-view {
  position: fixed; inset: 0; z-index: 3000; background: rgba(15, 23, 42, .88);
  display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 16px;
}
.img-view img { max-width: 100%; max-height: 80vh; border-radius: 12px; object-fit: contain; }
.img-view-name { margin-top: 10px; color: #fff; font-weight: 800; font-size: 15px; }
</style>
