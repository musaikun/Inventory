<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import NumPad from './NumPad.vue'

const props = defineProps({
  ingredient:      { type: String,  required: true },
  initialQty:      { type: Number,  default: null },
  initialUnit:     { type: String,  default: '' },
  initialCategory: { type: String,  default: '' },  // 現在のジャンル
  existing:        { type: Object,  default: null }, // { qty, unit } | null
  prevMonth:       { type: String,  default: '' },   // 前月実績ヒント
  lotSize:         { type: String,  default: '' },   // 入数ヒント e.g. "24本"
  unitLocked:      { type: Boolean, default: false }, // インポート登録済み単位は変更不可
  categoryLocked:  { type: Boolean, default: false }, // 登録済みジャンルは変更不可
  existingCategories: { type: Array, default: () => [] }, // 既に使われているジャンル
  auditLog:        { type: Array,   default: () => [] },
  isFlagged:       { type: Boolean, default: false }, // 「あとで数える」フラグ状態
  typingUser:      { type: String,  default: null },  // 同一品目を入力中の他ユーザー名
  isNew:           { type: Boolean, default: false }, // リスト未登録＝「新規登録」ボタンで初めて登録
  isEdit:          { type: Boolean, default: false }, // 登録済み品目の編集モード
  initialPrice:    { type: [Number, String], default: '' }, // 編集時の単価
})

const emit = defineEmits(['confirm', 'cancel', 'revert', 'toggle-flag', 'edit-save'])

// 編集モードでは単位・ジャンルのロックを解除して編集できる（編集が唯一の変更手段）
const unitEditable     = computed(() => props.isEdit || !props.unitLocked)
const categoryEditable = computed(() => props.isEdit || !props.categoryLocked)

// 編集モード: 品目名・単価
const editName = ref(props.ingredient)
const price    = ref(props.initialPrice !== '' && props.initialPrice != null ? String(props.initialPrice) : '')

// 単位ドロップダウンの選択肢（p・ヶ を追加）
const UNIT_OPTIONS = ['袋', '本', '個', 'パック', '缶', 'ケース', '枚', '玉', 'kg', 'L', 'p', 'ヶ']
// 初期ジャンル（既存が無いとき用）
const PRESET_GENRES = ['肉類', '野菜', '魚', '冷凍', '冷蔵', '常温', '飲料', '酒類', '調味料', '乾物', '消耗品', 'その他']
const CUSTOM = '__custom__'

const qty      = ref(props.initialQty != null ? String(props.initialQty) : '')
const unit     = ref(props.initialUnit ?? '')
const hasError = ref(false)

// ── 単位ドロップダウン ─────────────────────────────────────────────────────────
const unitCustom    = ref(!!props.initialUnit && !UNIT_OPTIONS.includes(props.initialUnit))
const unitCustomRef = ref(null)
const unitSelectValue = computed(() => unitCustom.value ? CUSTOM : unit.value)
function onUnitChange(v) {
  if (v === CUSTOM) {
    unitCustom.value = true; unit.value = ''
    nextTick(() => unitCustomRef.value?.focus())   // その他選択で即キーボードを開く
  } else {
    unitCustom.value = false; unit.value = v
  }
}

// ── ジャンル（ドロップダウン＋手入力）─────────────────────────────────────────
const category = ref(props.initialCategory ?? '')
const categoryOptions = computed(() =>
  [...new Set([...(props.existingCategories ?? []), ...PRESET_GENRES])]
)
const categoryCustom    = ref(!!props.initialCategory && !categoryOptions.value.includes(props.initialCategory))
const categoryCustomRef = ref(null)
const categorySelectValue = computed(() => categoryCustom.value ? CUSTOM : category.value)
function onCategoryChange(v) {
  if (v === CUSTOM) {
    categoryCustom.value = true; category.value = ''
    nextTick(() => categoryCustomRef.value?.focus())   // その他選択で即キーボードを開く
  } else {
    categoryCustom.value = false; category.value = v
  }
}

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
onUnmounted(() => document.removeEventListener('keydown', handleKeydown))

// ── プリセット数量ボタン ───────────────────────────────────────────────────────
const PRESETS = [0.1, 0.5, 1, 5, 10]

function addPreset(n) {
  const current  = parseFloat(qty.value) || 0
  const result   = Math.round((current + n) * 10000) / 10000
  qty.value      = String(result)
  hasError.value = false
}

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

// 入力済みを未入力に戻す（1個前の値に戻す機能は廃止し「未入力に戻す」に統一）
const undoLabel = computed(() => hasDuplicate.value ? '↩ 未入力に戻す' : '')

function handleRevert() {
  emit('revert', null)   // null = 未入力に戻す
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
  const empty = qty.value === '' || qty.value == null
  // 既存品目で空 → 変更せず閉じる。新規は「新規登録」で名前だけ登録できる（数量は任意）
  if (empty && !props.isNew) {
    emit('cancel')
    return
  }
  const q = empty ? null : parseFloat(qty.value)
  if (q !== null && (isNaN(q) || q < 0)) {
    hasError.value = true
    return
  }
  hasError.value = false
  emit('confirm', {
    ingredient: props.ingredient,
    qty:        q,
    unit:       unit.value.trim(),
    category:   category.value.trim(),
    isAdd,
    isNew:      props.isNew,
  })
}

// 編集モードの保存（品目名・数量・単位・ジャンル・単価をまとめて更新）
function saveEdit() {
  const name = editName.value.trim()
  if (!name) { hasError.value = true; return }
  const empty = qty.value === '' || qty.value == null
  const q = empty ? null : parseFloat(qty.value)
  if (q !== null && (isNaN(q) || q < 0)) { hasError.value = true; return }
  hasError.value = false
  emit('edit-save', {
    originalName: props.ingredient,
    name,
    qty:      q,
    unit:     unit.value.trim(),
    category: category.value.trim(),
    price:    price.value.trim(),
  })
}
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('cancel')">
    <div class="modal-sheet">
      <div class="sheet-handle"></div>
      <div class="sheet-title">{{ isEdit ? '品目を編集' : (isNew ? '新しい品目を登録' : '数量を入力') }}</div>

      <!-- 新規登録の注意（誤登録防止・何をしているかの明確化）-->
      <div v-if="isNew" class="new-item-notice">
        🆕 この品目を<strong>新しく追加</strong>します<br>
        <span class="new-item-sub">リストに無い品目です。下の「新規登録」で追加します</span>
      </div>

      <!-- 他メンバーの入力中インジケータ -->
      <div v-if="typingUser" class="typing-user-banner">
        ✏️ {{ typingUser }}が入力中…
      </div>

      <!-- 品目名：編集モードは入力欄、それ以外は表示のみ -->
      <input
        v-if="isEdit"
        type="text"
        v-model="editName"
        maxlength="40"
        placeholder="品目名"
        class="edit-name-input"
      />
      <div v-else class="name-box">
        {{ ingredient }}
        <div class="name-hints">
          <span v-if="lotSize"   class="hint-chip hint-lot">入数: {{ lotSize }}</span>
          <span v-if="prevMonth" class="hint-chip hint-prev">前月: {{ prevMonth }}</span>
        </div>
      </div>

      <!-- あとで数えるフラグ -->
      <button
        v-if="!isEdit"
        class="recount-toggle"
        :class="{ on: isFlagged }"
        @click="$emit('toggle-flag', !isFlagged)"
        type="button"
      >🔖 {{ isFlagged ? 'あとで数える：ON（タップで解除）' : 'あとで数える' }}</button>

      <!-- 重複警告 -->
      <div v-if="hasDuplicate && !isEdit" class="dup-warn">
        ⚠️ 入力済み：{{ existing.qty }}{{ existing.unit }}
        <span v-if="existing.enteredBy" class="dup-entered-by">（{{ existing.enteredBy }}）</span>
      </div>

      <!-- 変更履歴アコーディオン -->
      <div v-if="itemHistory.length > 0 && !isEdit" class="history-accordion">
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

      <!-- 数量表示 + 単位 -->
      <div class="qty-row">
        <div :class="['qty-display', { error: hasError, filled: qty !== '' }]">
          {{ qty !== '' ? qty : '—' }}
        </div>
        <!-- 単位：インポートでロック済みはバッジ、編集モードや未ロックはドロップダウン -->
        <div v-if="!unitEditable" class="unit-locked-badge">
          {{ unit }}<span class="unit-lock-icon">🔒</span>
        </div>
        <div v-else class="select-wrap unit-select-wrap">
          <select class="field-select" :value="unitSelectValue" @change="onUnitChange($event.target.value)">
            <option value="">未設定</option>
            <option v-for="u in UNIT_OPTIONS" :key="u" :value="u">{{ u }}</option>
            <option :value="CUSTOM">その他（手入力）…</option>
          </select>
          <span class="select-arrow">▾</span>
        </div>
      </div>
      <!-- 単位：その他（手入力）-->
      <input
        v-if="unitEditable && unitCustom"
        ref="unitCustomRef"
        type="text"
        v-model="unit"
        maxlength="6"
        placeholder="単位を入力"
        class="custom-input"
      />

      <!-- 単位警告 -->
      <div v-if="unitWarning" class="unit-warning">⚠️ {{ unitWarning }}</div>

      <!-- ジャンル：ロック済みはバッジ、それ以外はドロップダウン＋手入力 -->
      <div class="genre-row">
        <span class="genre-label">ジャンル</span>
        <div v-if="!categoryEditable" class="genre-locked-badge">
          {{ category || '未設定' }}<span class="unit-lock-icon">🔒</span>
        </div>
        <div v-else class="select-wrap genre-select-wrap">
          <select class="field-select" :value="categorySelectValue" @change="onCategoryChange($event.target.value)">
            <option value="">未設定</option>
            <option v-for="g in categoryOptions" :key="g" :value="g">{{ g }}</option>
            <option :value="CUSTOM">その他（手入力）…</option>
          </select>
          <span class="select-arrow">▾</span>
        </div>
      </div>
      <input
        v-if="categoryEditable && categoryCustom"
        ref="categoryCustomRef"
        type="text"
        v-model="category"
        maxlength="20"
        placeholder="ジャンルを入力"
        class="custom-input"
      />

      <!-- 単価（編集モードのみ） -->
      <div v-if="isEdit" class="price-row">
        <span class="price-label">単価</span>
        <input
          type="number"
          v-model="price"
          min="0"
          step="1"
          inputmode="numeric"
          placeholder="金額（任意）"
          class="price-input"
        />
        <span class="price-yen">円</span>
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
      <div v-if="isEdit" class="actions">
        <button class="btn btn-secondary" @click="$emit('cancel')">キャンセル</button>
        <button class="btn btn-success" @click="saveEdit">保存</button>
      </div>
      <div v-else class="actions" :class="{ 'three-col': hasDuplicate }">
        <button class="btn btn-secondary" @click="$emit('cancel')">キャンセル</button>
        <button v-if="hasDuplicate" class="btn btn-primary" @click="submit(true)">
          {{ addLabel }}
        </button>
        <button class="btn btn-success" @click="submit(false)">
          {{ isNew ? '新規登録' : (hasDuplicate ? '上書き' : '確定') }}
        </button>
      </div>

      <!-- ひとつ前の状態に戻す（入力済みの場合のみ） -->
      <button
        v-if="hasDuplicate && !isEdit"
        class="btn-undo-entry"
        @click="handleRevert"
        type="button"
      >{{ undoLabel }}</button>
    </div>
  </div>
</template>

<style scoped>
.typing-user-banner {
  background: #fefce8;
  border: 1px solid #fde68a;
  border-radius: 8px;
  margin: 0 16px 8px;
  padding: 7px 12px;
  font-size: 12px;
  color: #92400e;
  font-style: italic;
  text-align: center;
}

.new-item-notice {
  background: #fffbeb;
  border: 1.5px solid #fcd34d;
  border-radius: 10px;
  margin: 0 16px 10px;
  padding: 10px 12px;
  font-size: 14px;
  font-weight: 700;
  color: #92400e;
  text-align: center;
  line-height: 1.6;
}
.new-item-notice strong { color: #b45309; }
.new-item-sub {
  font-size: 11px;
  font-weight: 600;
  color: #a16207;
}

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
  position: sticky;
  top: 0;
  z-index: 2;
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

/* 単位・ジャンルのドロップダウン（選択できると分かる見た目） */
.select-wrap {
  position: relative;
  flex-shrink: 0;
}
.field-select {
  -webkit-appearance: none;
  appearance: none;
  border: 2px solid var(--primary);
  border-radius: 10px;
  padding: 10px 26px 10px 12px;
  font-size: 15px;
  font-weight: 700;
  color: var(--primary);
  background: #eff6ff;
  outline: none;
  cursor: pointer;
  width: 100%;
}
.unit-select-wrap { width: 84px; }
.unit-select-wrap .field-select { text-align: center; text-align-last: center; }
.select-arrow {
  position: absolute;
  right: 9px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 12px;
  color: var(--primary);
  pointer-events: none;
}
.custom-input {
  width: 100%;
  box-sizing: border-box;
  border: 2px solid var(--border);
  border-radius: 10px;
  padding: 9px 12px;
  font-size: 14px;
  font-weight: 600;
  outline: none;
  margin-bottom: 8px;
}
.custom-input:focus { border-color: var(--primary); }

/* 編集モード: 品目名・単価 */
.edit-name-input {
  width: 100%;
  box-sizing: border-box;
  border: 2px solid var(--primary);
  border-radius: 10px;
  padding: 11px 12px;
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  outline: none;
  margin-bottom: 12px;
}
.price-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.price-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-muted);
  flex-shrink: 0;
}
.price-input {
  flex: 1;
  border: 2px solid var(--border);
  border-radius: 10px;
  padding: 9px 12px;
  font-size: 14px;
  font-weight: 600;
  outline: none;
}
.price-input:focus { border-color: var(--primary); }
.price-yen { font-size: 13px; color: var(--text-muted); flex-shrink: 0; }

/* インポート済みロック表示（単位・ジャンル共通） */
.unit-locked-badge {
  min-width: 64px;
  border: 2px solid #d1fae5;
  border-radius: 10px;
  padding: 10px 8px;
  font-size: 14px;
  font-weight: 700;
  text-align: center;
  background: #f0fdf4;
  color: var(--success);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  flex-shrink: 0;
}

.unit-lock-icon {
  font-size: 10px;
  opacity: 0.7;
}

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

/* ジャンル行 */
.genre-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.genre-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-muted);
  flex-shrink: 0;
}
.genre-select-wrap { flex: 1; }
.genre-locked-badge {
  flex: 1;
  border: 2px solid #d1fae5;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 14px;
  font-weight: 700;
  background: #f0fdf4;
  color: var(--success);
  display: flex;
  align-items: center;
  gap: 4px;
}

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
