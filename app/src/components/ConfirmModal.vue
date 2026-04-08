<script setup>
import { ref, computed, onMounted } from 'vue'

const props = defineProps({
  ingredient: { type: String, required: true },
  initialQty: { type: Number, default: null },
  initialUnit: { type: String, default: '' },
  existing: { type: Object, default: null }, // { qty, unit } | null
})

const emit = defineEmits(['confirm', 'cancel'])

const qty     = ref(props.initialQty ?? '')
const unit    = ref(props.initialUnit ?? '')
const hasError = ref(false)
const qtyInput = ref(null)

const hasDuplicate = computed(() => props.existing !== null)

const addLabel = computed(() => {
  if (!hasDuplicate.value) return ''
  const q = parseFloat(qty.value)
  if (isNaN(q)) return `追加`
  return `追加 (→${props.existing.qty + q}${unit.value})`
})

onMounted(() => setTimeout(() => qtyInput.value?.focus(), 80))

function submit(isAdd) {
  const q = parseFloat(qty.value)
  if (isNaN(q) || q < 0) {
    hasError.value = true
    qtyInput.value?.focus()
    return
  }
  hasError.value = false
  emit('confirm', { ingredient: props.ingredient, qty: q, unit: unit.value.trim(), isAdd })
}
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('cancel')">
    <div class="modal-sheet">
      <div class="sheet-handle"></div>
      <div class="sheet-title">内容を確認</div>

      <div class="name-box">{{ ingredient }}</div>

      <div v-if="hasDuplicate" class="dup-warn">
        ⚠️ 入力済み：{{ existing.qty }}{{ existing.unit }}
      </div>

      <div class="qty-row">
        <label>数量</label>
        <input
          ref="qtyInput"
          type="number"
          v-model="qty"
          min="0"
          step="0.5"
          inputmode="decimal"
          :class="['qty-input', { error: hasError }]"
        />
        <input
          type="text"
          v-model="unit"
          maxlength="6"
          placeholder="単位"
          class="unit-input"
        />
      </div>

      <div class="actions" :class="{ 'three-col': hasDuplicate }">
        <button class="btn btn-secondary" @click="$emit('cancel')">キャンセル</button>
        <button v-if="hasDuplicate" class="btn btn-primary" @click="submit(true)">
          {{ addLabel }}
        </button>
        <button class="btn btn-success" @click="submit(false)">
          {{ hasDuplicate ? '上書き' : '確定' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.name-box {
  font-size: 16px;
  font-weight: 700;
  text-align: center;
  padding: 14px 16px;
  background: #eff6ff;
  border-radius: 10px;
  color: var(--primary);
  margin-bottom: 14px;
  line-height: 1.5;
}

.dup-warn {
  background: #fefce8;
  border: 1.5px solid #fde047;
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 13px;
  color: #713f12;
  margin-bottom: 14px;
}

.qty-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
}

.qty-row label {
  font-weight: 600;
  color: var(--text-muted);
  font-size: 14px;
  white-space: nowrap;
}

.qty-input {
  flex: 1;
  border: 2px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  font-size: 28px;
  font-weight: 700;
  text-align: center;
  outline: none;
  color: var(--text);
  -moz-appearance: textfield;
}

.qty-input::-webkit-inner-spin-button,
.qty-input::-webkit-outer-spin-button { opacity: 1; }

.qty-input:focus { border-color: var(--primary); }
.qty-input.error { border-color: var(--danger); }

.unit-input {
  width: 76px;
  border: 2px solid var(--border);
  border-radius: 10px;
  padding: 12px 8px;
  font-size: 16px;
  font-weight: 600;
  text-align: center;
  outline: none;
}

.unit-input:focus { border-color: var(--primary); }

.actions {
  display: flex;
  gap: 10px;
}

.actions.three-col {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
}
</style>
