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
  lotSize:     { type: String,  default: '' },   // 入数ヒント e.g. "24本"
  unitLocked:  { type: Boolean, default: false }, // PDF登録済み単位は変更不可
  auditLog:    { type: Array,   default: () => [] },
  isFlagged:   { type: Boolean, default: false }, // 「あとで数える」フラグ状態
})

const emit = defineEmits(['confirm', 'cancel', 'revert', 'toggle-flag'])

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

function numpadClear() {
  qty.value      = ''
  hasError.value = false
}

// ── PCキーボード対応 ───────────────────────────────────────────────────────────
function handleKeydown(e) {
  // 単位入力欄にフォーカス中は Enter / Escape のみ処理して他は通常通り
  if (e.target.tagName === 'INPUT') {
    if (e.key === 'Enter')  { e.preventDefault(); submit(false) }
    if (e.key === 'Escape') { e.preventDefault(); emit('cancel') }
    return
  }
  if (e.key === 'Enter')     { e.preventDefault(); submit(false) }
  else if (e.key === 'Escape')    { e.preventDefault(); emit('cancel') }
  else if (e.key === 'Backspace') { e.preventDefault(); numpadBack() }
  else if (e.key === 'Delete')    { e.preventDefault(); numpadClear() }
  else if (/^[0-9]$/.test(e.key)) numpadDigit(e.key)
  else if (e.key === '.')         numpadDot()
}

onMounted(()   => document.addEventListener('keydown', handleKeydown))
onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  if (qtyListening.value) toggleQtyVoice()
})

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

// ── 変更履歴 ───────────────────────────────────────────────────────────────────
const historyOpen = ref(false)

const itemHistory = computed(() =>
  props.auditLog.filter(e => e.ingredient === props.ingredient)
)

function formatHistoryTime(ts) {
  const d = new Date(ts)
  return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
}

function formatAction(action) {
  if (action === 'new')       return '登録'
  if (action === 'add')       return '追加'
  if (action === 'overwrite') return '上書'
  if (action === 'remove')    return '削除'
  if (action === 'flag_recount')   return '🔖付'
  if (action === 'unflag_recount') return '🔖解'
  return action
}

// ひとつ前の状態（auditLog の2番目から最後のエントリ）
const prevState = computed(() => {
  const h = itemHistory.value
  if (h.length < 2) return null
  const prev = h[h.length - 2]
  return { qty: prev.totalQty, unit: prev.unit }
})

const undoLabel = computed(() => {
  if (!hasDuplicate.value) return ''
  if (!prevState.value) return '↩ 未入力に戻す'
  return `↩ ${prevState.value.qty}${prevState.value.unit} に戻す`
})

function handleRevert() {
  emit('revert', prevState.value)
}

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
  // 空入力のままEnter → スキップ（未入力のまま次へ / モーダルを閉じる）
  if (qty.value === '' || qty.value == null) {
    emit('cancel')
    return
  }
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
        <div class="name-hints">
          <span v-if="lotSize"   class="hint-chip hint-lot">入数: {{ lotSize }}</span>
          <span v-if="prevMonth" class="hint-chip hint-prev">前月: {{ prevMonth }}</span>
        </div>
      </div>

      <!-- あとで数えるフラグ -->
      <button
        class="recount-toggle"
        :class="{ on: isFlagged }"
        @click="$emit('toggle-flag', !isFlagged)"
        type="button"
      >🔖 {{ isFlagged ? 'あとで数える：ON（タップで解除）' : 'あとで数える' }}</button>

      <!-- 重複警告 -->
      <div v-if="hasDuplicate" class="dup-warn">
        ⚠️ 入力済み：{{ existing.qty }}{{ existing.unit }}
        <span v-if="existing.enteredBy" class="dup-entered-by">（{{ existing.enteredBy }}）</span>
      </div>

      <!-- 変更履歴アコーディオン -->
      <div v-if="itemHistory.length > 0" class="history-accordion">
        <button class="history-toggle" @click="historyOpen = !historyOpen" type="button">
          <span class="history-toggle-label">変更履歴 ({{ itemHistory.length }}件)</span>
          <span class="history-toggle-arrow">{{ historyOpen ? '▲' : '▼' }}</span>
        </button>
        <div v-if="historyOpen" class="history-list">
          <div
            v-for="entry in [...itemHistory].reverse()"
            :key="entry.id"
            class="history-row"
          >
            <span class="h-name">{{ entry.enteredBy || '—' }}</span>
            <span class="h-time">{{ formatHistoryTime(entry.timestamp) }}</span>
            <span class="h-qty">{{ entry.action === 'remove' ? '—' : `${entry.delta}${entry.unit}` }}</span>
            <span class="h-action" :class="`action-${entry.action}`">{{ formatAction(entry.action) }}</span>
            <span class="h-total">計{{ entry.totalQty }}{{ entry.unit }}</span>
          </div>
        </div>
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
      <NumPad @digit="numpadDigit" @dot="numpadDot" @backspace="numpadBack" @clear="numpadClear" />

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

      <!-- ひとつ前の状態に戻す（入力済みの場合のみ） -->
      <button
        v-if="hasDuplicate"
        class="btn-undo-entry"
        @click="handleRevert"
        type="button"
      >{{ undoLabel }}</button>
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

.name-hints {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.hint-chip {
  font-size: 11px;
  font-weight: 600;
  border-radius: 20px;
  padding: 2px 10px;
}

.hint-lot  { background: #ede9fe; color: #6d28d9; }  /* 紫: 入数 */
.hint-prev { background: #f1f5f9; color: #64748b; }  /* グレー: 前月 */

.dup-warn {
  background: #fefce8;
  border: 1.5px solid #fde047;
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 13px;
  color: #713f12;
  margin-bottom: 10px;
}

.dup-entered-by {
  font-weight: 700;
  color: var(--primary);
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

.btn-undo-entry {
  display: block;
  width: 100%;
  margin-top: 8px;
  padding: 9px;
  font-size: 12px;
  font-weight: 600;
  color: var(--danger);
  background: transparent;
  border: none;
  cursor: pointer;
  opacity: 0.75;
  -webkit-tap-highlight-color: transparent;
}
.btn-undo-entry:active { opacity: 1; }

/* 変更履歴アコーディオン */
.history-accordion {
  margin-bottom: 10px;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}

.history-toggle {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #f8fafc;
  border: none;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  -webkit-tap-highlight-color: transparent;
}

.history-toggle:active { background: #f1f5f9; }

.history-toggle-label { flex: 1; text-align: left; }
.history-toggle-arrow { font-size: 10px; }

.history-list {
  background: #fff;
  max-height: 160px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.history-row {
  display: grid;
  grid-template-columns: 4em 3em 4em 2em 4em;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  font-size: 12px;
  border-top: 1px solid #f1f5f9;
}

.history-row:first-child { border-top: none; }

.h-name  { font-weight: 700; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.h-time  { color: var(--text-muted); }
.h-qty   { text-align: right; font-weight: 600; color: var(--text); }
.h-action { text-align: center; font-size: 11px; font-weight: 700; border-radius: 4px; padding: 1px 4px; }
.h-total { color: var(--text-muted); font-size: 11px; }

.action-new       { background: #d1fae5; color: #065f46; }
.action-add       { background: #dbeafe; color: #1e40af; }
.action-overwrite { background: #fef9c3; color: #854d0e; }
.action-remove    { background: #fee2e2; color: #991b1b; }
.action-flag_recount   { background: #ffedd5; color: #9a3412; }
.action-unflag_recount { background: #f1f5f9; color: #475569; }

/* あとで数える トグル */
.recount-toggle {
  width: 100%;
  padding: 9px 12px;
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 700;
  color: #9a3412;
  background: #fff7ed;
  border: 1.5px solid #fdba74;
  border-radius: 10px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.recount-toggle.on {
  color: #fff;
  background: #f97316;
  border-color: #f97316;
}
.recount-toggle:active { opacity: 0.8; }
</style>
