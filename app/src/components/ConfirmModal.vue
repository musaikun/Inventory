<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useVoice, parseText } from '../composables/useVoice.js'

const props = defineProps({
  ingredient:  { type: String, required: true },
  initialQty:  { type: Number, default: null },
  initialUnit: { type: String, default: '' },
  existing:    { type: Object, default: null }, // { qty, unit } | null
})

const emit = defineEmits(['confirm', 'cancel'])

const qty      = ref(props.initialQty ?? '')
const unit     = ref(props.initialUnit ?? '')
const hasError = ref(false)
const qtyInput = ref(null)
const voiceMsg = ref('')  // 音声認識のフィードバック

// ── 数量音声入力 ───────────────────────────────────────────────────────────────
function onQtyVoiceResult(raw) {
  const { qty: q, unit: u } = parseText(raw)
  if (q !== null) {
    qty.value  = q
    unit.value = u || unit.value
    voiceMsg.value = `「${raw}」→ ${q}${u || unit.value}`
    hasError.value = false
  } else {
    voiceMsg.value = `数量を認識できませんでした`
  }
}

const { isListening: qtyListening, toggle: toggleQtyVoice } = useVoice(onQtyVoiceResult)

// モーダルを閉じる時に音声停止
onUnmounted(() => { if (qtyListening.value) toggleQtyVoice() })

// ── Duplicate ──────────────────────────────────────────────────────────────────
const hasDuplicate = computed(() => props.existing !== null)

const addLabel = computed(() => {
  if (!hasDuplicate.value) return ''
  const q = parseFloat(qty.value)
  if (isNaN(q)) return '追加'
  return `追加 (→${props.existing.qty + q}${unit.value})`
})

onMounted(() => setTimeout(() => qtyInput.value?.focus(), 80))

// ── Submit ─────────────────────────────────────────────────────────────────────
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
      <div class="sheet-title">数量を入力</div>

      <!-- 品目名 -->
      <div class="name-box">{{ ingredient }}</div>

      <!-- 重複警告 -->
      <div v-if="hasDuplicate" class="dup-warn">
        ⚠️ 入力済み：{{ existing.qty }}{{ existing.unit }}
      </div>

      <!-- 数量入力行 -->
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
        <!-- 音声ボタン -->
        <button
          class="voice-qty-btn"
          :class="{ listening: qtyListening }"
          @click="toggleQtyVoice"
          type="button"
          title="音声で数量入力"
        >🎤</button>
      </div>

      <!-- 音声フィードバック -->
      <div v-if="voiceMsg || qtyListening" class="voice-feedback" :class="{ listening: qtyListening }">
        {{ qtyListening ? '数量を話してください…（例：3袋、ご本）' : voiceMsg }}
      </div>

      <!-- アクションボタン -->
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
  gap: 8px;
  margin-bottom: 10px;
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
  width: 70px;
  border: 2px solid var(--border);
  border-radius: 10px;
  padding: 12px 6px;
  font-size: 16px;
  font-weight: 600;
  text-align: center;
  outline: none;
}

.unit-input:focus { border-color: var(--primary); }

/* 音声ボタン */
.voice-qty-btn {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: var(--primary);
  color: white;
  border: none;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.2s;
}

.voice-qty-btn.listening {
  background: var(--danger);
  animation: pulse-sm 1.2s ease-in-out infinite;
}

@keyframes pulse-sm {
  0%, 100% { box-shadow: 0 0 0 0 rgba(220,38,38,0.4); }
  50%       { box-shadow: 0 0 0 8px rgba(220,38,38,0); }
}

/* 音声フィードバック */
.voice-feedback {
  font-size: 13px;
  color: var(--text-muted);
  background: #f8fafc;
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 14px;
  text-align: center;
}

.voice-feedback.listening {
  color: var(--danger);
  background: #fef2f2;
}

.actions {
  display: flex;
  gap: 10px;
}

.actions.three-col {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
}
</style>
