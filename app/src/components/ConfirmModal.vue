<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useVoice, parseText } from '../composables/useVoice.js'
import NumPad from './NumPad.vue'

const props = defineProps({
  ingredient:  { type: String,  required: true },
  initialQty:  { type: Number,  default: null },
  initialUnit: { type: String,  default: '' },
  existing:    { type: Object,  default: null }, // { qty, unit } | null
  prevMonth:   { type: String,  default: '' },   // 前月実績ヒント
  unitLocked:  { type: Boolean, default: false }, // PDF登録済み単位は変更不可
})

const emit = defineEmits(['confirm', 'cancel'])

const qty      = ref(props.initialQty != null ? String(props.initialQty) : '')
const unit     = ref(props.initialUnit ?? '')
const hasError = ref(false)
const voiceMsg = ref('')

// ── テンキー入力 ───────────────────────────────────────────────────────────────
function numpadDigit(d) {
  const s = String(qty.value)
  if (s === '0') qty.value = d
  else           qty.value = s + d
  hasError.value = false
}

function numpadDot() {
  const s = String(qty.value)
  if (!s.includes('.')) qty.value = (s || '0') + '.'
}

function numpadBack() {
  const s = String(qty.value)
  qty.value = s.length <= 1 ? '' : s.slice(0, -1)
}

// ── プリセット数量ボタン ───────────────────────────────────────────────────────
const PRESETS = [0.1, 0.5, 1, 5, 10]

function addPreset(n) {
  const current  = parseFloat(qty.value) || 0
  const result   = Math.round((current + n) * 10000) / 10000
  qty.value      = String(result)
  hasError.value = false
}

// ── 単位クイック選択 ───────────────────────────────────────────────────────────
const COMMON_UNITS = ['袋', '本', '個', 'パック', '缶', 'ケース', '枚', '玉', 'kg', 'L']

const unitSuggestions = computed(() => {
  const configured = props.initialUnit?.trim()
  if (!configured) return COMMON_UNITS.slice(0, 8)
  return [configured, ...COMMON_UNITS.filter(u => u !== configured)].slice(0, 8)
})

// ── 音声入力 ───────────────────────────────────────────────────────────────────
function onQtyVoiceResult(raw) {
  const { qty: q, unit: u } = parseText(raw)
  if (q !== null) {
    qty.value      = String(q)
    unit.value     = u || unit.value
    voiceMsg.value = `「${raw}」→ ${q}${u || unit.value}`
    hasError.value = false
  } else {
    voiceMsg.value = '数量を認識できませんでした'
  }
}

const { isListening: qtyListening, toggle: toggleQtyVoice } = useVoice(onQtyVoiceResult)

onUnmounted(() => { if (qtyListening.value) toggleQtyVoice() })

// ── 単位警告 ───────────────────────────────────────────────────────────────────
const unitWarning = computed(() => {
  const u = unit.value.trim().toLowerCase()
  const q = parseFloat(qty.value)
  if (isNaN(q) || q <= 0) return null
  if (u === 'ml' && q < 10)  return `${q}ml は少なすぎませんか？`
  if (u === 'g'  && q < 10)  return `${q}g は少なすぎませんか？`
  if (u === 'l'  && q > 50)  return `${q}L は多すぎませんか？`
  if (u === 'kg' && q > 300) return `${q}kg は多すぎませんか？`
  return null
})

// ── 重複 ───────────────────────────────────────────────────────────────────────
const hasDuplicate = computed(() => props.existing !== null)

const addLabel = computed(() => {
  if (!hasDuplicate.value) return ''
  const q = parseFloat(qty.value)
  if (isNaN(q)) return '追加'
  const sum = Math.round((props.existing.qty + q) * 10000) / 10000
  return `追加 (→${sum}${unit.value})`
})

// ── 送信 ───────────────────────────────────────────────────────────────────────
function submit(isAdd) {
  const q = parseFloat(qty.value)
  if (isNaN(q) || q < 0) {
    hasError.value = true
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
      <div class="name-box">
        {{ ingredient }}
        <div v-if="prevMonth" class="prev-hint-modal">前月実績: {{ prevMonth }}</div>
      </div>

      <!-- 重複警告 -->
      <div v-if="hasDuplicate" class="dup-warn">
        ⚠️ 入力済み：{{ existing.qty }}{{ existing.unit }}
      </div>

      <!-- 数量表示 + 単位 + 音声 -->
      <div class="qty-row">
        <div :class="['qty-display', { error: hasError, filled: qty !== '' }]">
          {{ qty !== '' ? qty : '—' }}
        </div>
        <!-- 単位：PDFロック時は変更不可バッジ、それ以外は入力欄 -->
        <div v-if="unitLocked" class="unit-locked-badge">
          {{ unit }}<span class="unit-lock-icon">🔒</span>
        </div>
        <input
          v-else
          type="text"
          v-model="unit"
          maxlength="6"
          placeholder="単位"
          class="unit-input"
        />
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
        {{ qtyListening ? '数量を話してください…（例：3袋、5本）' : voiceMsg }}
      </div>

      <!-- 単位警告 -->
      <div v-if="unitWarning" class="unit-warning">⚠️ {{ unitWarning }}</div>

      <!-- 単位クイック選択（ロックされていない場合のみ） -->
      <div v-if="!unitLocked" class="unit-chips">
        <button
          v-for="u in unitSuggestions"
          :key="u"
          :class="['unit-chip', { active: unit === u }]"
          @click="unit = u"
          type="button"
        >{{ u }}</button>
      </div>

      <!-- プリセットボタン -->
      <div class="preset-row">
        <button
          v-for="n in PRESETS"
          :key="n"
          class="preset-btn"
          @click="addPreset(n)"
          type="button"
        >+{{ n }}</button>
      </div>

      <!-- テンキー -->
      <NumPad @digit="numpadDigit" @dot="numpadDot" @backspace="numpadBack" />

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
  font-size: 15px;
  font-weight: 700;
  text-align: center;
  padding: 12px 16px;
  background: #eff6ff;
  border-radius: 10px;
  color: var(--primary);
  margin-bottom: 12px;
  line-height: 1.5;
}

.prev-hint-modal {
  margin-top: 4px;
  font-size: 12px;
  font-weight: 500;
  color: #64748b;
  background: white;
  border-radius: 6px;
  padding: 2px 8px;
  display: inline-block;
}

.dup-warn {
  background: #fefce8;
  border: 1.5px solid #fde047;
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 13px;
  color: #713f12;
  margin-bottom: 10px;
}

/* 数量表示エリア */
.qty-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.qty-display {
  flex: 1;
  border: 2px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 32px;
  font-weight: 700;
  text-align: center;
  color: var(--text-muted);
  background: #f8fafc;
  min-height: 58px;
  display: flex;
  align-items: center;
  justify-content: center;
  letter-spacing: 0.02em;
}

.qty-display.filled {
  color: var(--text);
  border-color: var(--primary);
  background: white;
}

.qty-display.error {
  border-color: var(--danger);
  background: #fef2f2;
}

.unit-input {
  width: 64px;
  border: 2px solid var(--border);
  border-radius: 10px;
  padding: 10px 4px;
  font-size: 15px;
  font-weight: 600;
  text-align: center;
  outline: none;
}

.unit-input:focus { border-color: var(--primary); }

/* PDF単位ロック表示 */
.unit-locked-badge {
  width: 64px;
  border: 2px solid #d1fae5;
  border-radius: 10px;
  padding: 10px 4px;
  font-size: 14px;
  font-weight: 700;
  text-align: center;
  background: #f0fdf4;
  color: var(--success);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.unit-lock-icon {
  font-size: 10px;
  opacity: 0.7;
}

/* 音声ボタン */
.voice-qty-btn {
  width: 44px;
  height: 44px;
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
}

.voice-qty-btn.listening {
  background: var(--danger);
  animation: pulse-sm 1.2s ease-in-out infinite;
}

@keyframes pulse-sm {
  0%, 100% { box-shadow: 0 0 0 0 rgba(220,38,38,0.4); }
  50%       { box-shadow: 0 0 0 8px rgba(220,38,38,0); }
}

.voice-feedback {
  font-size: 12px;
  color: var(--text-muted);
  background: #f8fafc;
  border-radius: 8px;
  padding: 6px 12px;
  margin-bottom: 8px;
  text-align: center;
}

.voice-feedback.listening { color: var(--danger); background: #fef2f2; }

.unit-warning {
  font-size: 12px;
  color: #92400e;
  background: #fefce8;
  border: 1.5px solid #fde047;
  border-radius: 8px;
  padding: 6px 12px;
  margin-bottom: 8px;
  line-height: 1.5;
}

/* 単位クイック選択 */
.unit-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.unit-chip {
  padding: 5px 12px;
  font-size: 13px;
  font-weight: 600;
  border: 1.5px solid var(--border);
  border-radius: 20px;
  background: #f8fafc;
  color: var(--text-muted);
  cursor: pointer;
  transition: border-color 0.1s, background 0.1s, color 0.1s;
  -webkit-tap-highlight-color: transparent;
}

.unit-chip.active {
  border-color: var(--primary);
  background: #eff6ff;
  color: var(--primary);
  font-weight: 700;
}

.unit-chip:active { opacity: 0.7; }

/* プリセットボタン */
.preset-row {
  display: flex;
  gap: 6px;
  margin-bottom: 4px;
}

.preset-btn {
  flex: 1;
  padding: 8px 4px;
  font-size: 14px;
  font-weight: 700;
  border: 1.5px solid var(--primary);
  border-radius: 10px;
  background: #eff6ff;
  color: var(--primary);
  cursor: pointer;
  transition: background 0.1s, transform 0.08s;
  -webkit-tap-highlight-color: transparent;
}

.preset-btn:active {
  background: #dbeafe;
  transform: scale(0.96);
}

/* アクション */
.actions {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}

.actions.three-col {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
}
</style>
