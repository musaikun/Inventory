<script setup>
defineProps({
  candidates: { type: Array, required: true },
})
defineEmits(['select', 'cancel'])
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('cancel')">
    <div class="modal-sheet">
      <div class="sheet-handle"></div>
      <div class="sheet-title">どれですか？</div>

      <div class="list">
        <button
          v-for="c in candidates.slice(0, 6)"
          :key="c"
          class="item"
          @click="$emit('select', c)"
        >
          {{ c }}
        </button>
      </div>

      <button class="btn btn-secondary cancel-btn" @click="$emit('cancel')">
        キャンセル
      </button>
    </div>
  </div>
</template>

<style scoped>
.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 55vh;
  overflow-y: auto;
}

.item {
  padding: 14px 16px;
  border: 2px solid var(--border);
  border-radius: 12px;
  background: white;
  font-size: 14px;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  color: var(--text);
}

.item:active {
  background: #eff6ff;
  border-color: var(--primary);
}

.cancel-btn {
  width: 100%;
  margin-top: 14px;
}
</style>
