<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import NumPad from './NumPad.vue'
import { suggestOrder } from '../services/orderSuggestion.js'
import { useHorizontalSwipe } from '../composables/useSwipe.js'

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
  axisNames:       { type: Array,  default: () => ['', ''] }, // 汎用2軸の名前
  initialTagA:     { type: String, default: '' },   // 軸1の現在値
  initialTagB:     { type: String, default: '' },   // 軸2の現在値
  existingTagsA:   { type: Array,  default: () => [] }, // 軸1の既存値（候補）
  existingTagsB:   { type: Array,  default: () => [] }, // 軸2の既存値（候補）
  canPrev:         { type: Boolean, default: false }, // 前の品目へ移動可能
  canNext:         { type: Boolean, default: false }, // 次の品目へ移動可能
  orderMode:       { type: Boolean, default: false }, // 発注セッション: qty=現在在庫 + 発注数入力
  parLevel:        { type: Number,  default: null },  // 適正在庫（null=学習不足）
  // 補充目標（発注してここまで戻す）と根拠。{ value, source, basis } | null
  replenish:       { type: Object,  default: null },
  // 発注数の決め方（店舗の既定）。'auto'=不足分に追従 / 'manual'=自分で入力
  orderInputMode:  { type: String,  default: 'auto' },
  orderLot:        { type: Number,  default: 1 },     // 入数（数値）
  lastWeekQty:     { type: Number,  default: null },  // 前週同曜日の発注数
  weekdayHistory:  { type: Object,  default: null },  // 品目×同曜の発注履歴 { lastWeek, lastMonth, median, values, samples, count }
  initialOrderQty: { type: Number,  default: null },  // 発注数の初期値（再開時）
  theoStock:       { type: Object,  default: null },  // 理論在庫 { qty, baseQty, baseDate, inQty, outQty }
})

const emit = defineEmits(['confirm', 'cancel', 'revert', 'toggle-flag', 'edit-save', 'navigate'])

// 編集モードでは単位のロックを解除して編集できる（編集が唯一の変更手段）。
// ジャンルは取込元由来のみ＝常に読み取り専用（ユーザー分類はユーザー軸で行う）。
const unitEditable = computed(() => props.isEdit || !props.unitLocked)

// 編集モード: 品目名・単価
const editName = ref(props.ingredient)
const price    = ref(props.initialPrice !== '' && props.initialPrice != null ? String(props.initialPrice) : '')

// 編集モード: 汎用2軸の値
const tagA = ref(props.initialTagA ?? '')
const tagB = ref(props.initialTagB ?? '')

// 単位ドロップダウンの選択肢（p・ヶ を追加）
const UNIT_OPTIONS = ['袋', '本', '個', 'パック', '缶', 'ケース', '枚', '玉', 'kg', 'L', 'p', 'ヶ']
const CUSTOM = '__custom__'

const qty      = ref(props.initialQty != null ? String(props.initialQty) : '')
const unit     = ref(props.initialUnit ?? '')
const hasError = ref(false)

// ── 発注モード（qty = 現在在庫 / 別に発注数を持つ）─────────────────────────────
const orderQty     = ref(props.initialOrderQty)   // null=未編集（推奨に追従）
const orderTouched = ref(props.initialOrderQty != null)

// 現在在庫から算出した推奨発注数。
// 目標は補充目標（replenish）＝ 手動 > 学習値 > 発注点＋推定消費 > 発注点×2 の順で決まる。
// 発注点そのものを目標にすると補充直後にまた発注点を割るため、目標は別に受け取る。
const targetLevel = computed(() => props.replenish?.value ?? props.parLevel ?? null)
const suggested = computed(() => {
  if (!props.orderMode || targetLevel.value == null) return null
  const stock = qty.value === '' ? null : parseFloat(qty.value)
  if (stock == null || isNaN(stock)) return null
  return suggestOrder(targetLevel.value, stock, props.orderLot)
})

// 「不足分に追従」モードか。manual では推奨を出すだけで発注数へは自動で入れない
// （どちらでも人が最後に直せる。学習は直した後の値で回る）。
const autoFollow = computed(() => props.orderInputMode !== 'manual')

// 実際に確定される発注数（ユーザーが触っていれば手入力値、未編集なら追従モードのみ推奨）
const effectiveOrderQty = computed(() => {
  if (orderTouched.value && orderQty.value != null) return Math.max(0, orderQty.value)
  return autoFollow.value ? (suggested.value ?? 0) : 0
})

function orderStep(delta) {
  orderQty.value     = Math.max(0, (effectiveOrderQty.value ?? 0) + delta)
  orderTouched.value = true
  orderFocus.value   = 'order'
}

// 発注モードで NumPad/プリセットが編集する対象。初期は発注数（主役）。
// 'order' = 発注数（整数）／'stock' = 現在在庫（小数OK・従来どおり）
const orderFocus = ref('order')

// 学習値（推奨・前週）をタップして発注数にセット（そこから微調整できる）
function setOrderQty(v) {
  if (v == null || isNaN(v)) return
  orderQty.value     = Math.max(0, Math.round(v))
  orderTouched.value = true
  orderFocus.value   = 'order'
}

// 品目×同曜の発注履歴（前週・先月・中央値・ミニ推移）
const WD = ['日', '月', '火', '水', '木', '金', '土']
const orderWeekdayLabel = computed(() => {
  const s = props.weekdayHistory?.lastWeek?.date || props.weekdayHistory?.samples?.[0]?.date
  return s ? WD[new Date(s + 'T12:00:00').getDay()] : WD[new Date().getDay()]
})
// スパークライン: 値を 8..100% の高さへ正規化
const spark = computed(() => {
  const vals = props.weekdayHistory?.values ?? []
  if (!vals.length) return []
  const max = Math.max(...vals, 1)
  return vals.map(v => Math.max(8, Math.round((v / max) * 100)))
})

// ── 理論在庫（直近棚卸＋入出庫の導出値）──────────────────────────────────────
// タップでプリフィルできるが、自動入力はしない（在庫入力は独立した観測値として
// ズレ検出・学習品質に使うため、意図した採用だけを許す）。
function _md(dateStr) {
  const [, m, d] = String(dateStr || '').split('-').map(Number)
  return m && d ? `${m}/${d}` : ''
}
const theoBasis = computed(() => {
  const t = props.theoStock
  if (!t) return ''
  const parts = [t.baseDate ? `${_md(t.baseDate)}棚卸 ${t.baseQty}` : '棚卸実績なし']
  if (t.inQty)  parts.push(`＋入庫${t.inQty}`)
  if (t.outQty) parts.push(`−出庫${t.outQty}`)
  return parts.join(' ')
})
function useTheoStock() {
  qty.value = String(props.theoStock.qty)
  hasError.value = false
}
// 入力値と理論在庫のズレ（0 は「一致」表示に使うため null と区別する）
const stockDrift = computed(() => {
  if (!props.orderMode || !props.theoStock || qty.value === '') return null
  const v = parseFloat(qty.value)
  if (isNaN(v)) return null
  return Math.round((v - props.theoStock.qty) * 1000) / 1000
})

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

// ── ジャンル（取込元由来・表示のみ）─────────────────────────────────────────
const category = ref(props.initialCategory ?? '')

// ── テンキー入力 ───────────────────────────────────────────────────────────────
// 発注数フォーカス中か（NumPad/プリセットの編集対象が発注数）
const editingOrder = computed(() => props.orderMode && orderFocus.value === 'order')

function numpadDigit(d) {
  if (editingOrder.value) {
    const cur  = orderTouched.value && orderQty.value != null ? String(orderQty.value) : ''
    const next = cur === '0' ? d : cur + d
    orderQty.value     = Math.min(999999, parseInt(next, 10) || 0)  // 発注は整数
    orderTouched.value = true
    return
  }
  const s = String(qty.value)
  if (s === '0') qty.value = d
  else           qty.value = s + d
  hasError.value = false
}

function numpadDot() {
  if (editingOrder.value) return   // 発注は整数のみ（小数点なし）
  const s = String(qty.value)
  if (!s.includes('.')) qty.value = (s || '0') + '.'
}

function numpadBack() {
  if (editingOrder.value) {
    const cur  = orderTouched.value && orderQty.value != null ? String(orderQty.value) : ''
    const next = cur.length <= 1 ? '' : cur.slice(0, -1)
    orderQty.value     = next === '' ? 0 : parseInt(next, 10)
    orderTouched.value = true
    return
  }
  const s = String(qty.value)
  qty.value = s.length <= 1 ? '' : s.slice(0, -1)
}

function numpadClear() {
  if (editingOrder.value) {
    orderQty.value     = 0
    orderTouched.value = true
    return
  }
  qty.value      = ''
  hasError.value = false
}

// ── PCキーボード対応 ───────────────────────────────────────────────────────────
function handleKeydown(e) {
  // 単位入力欄にフォーカス中は Enter / Escape のみ処理して他は通常通り
  if (e.target.tagName === 'INPUT') {
    if (e.key === 'Enter')  { e.preventDefault(); onPrimary() }
    if (e.key === 'Escape') { e.preventDefault(); emit('cancel') }
    return
  }
  if (e.key === 'Enter')     { e.preventDefault(); onPrimary() }
  else if (e.key === 'Escape')    { e.preventDefault(); emit('cancel') }
  else if (e.key === 'Backspace') { e.preventDefault(); numpadBack() }
  else if (e.key === 'Delete')    { e.preventDefault(); numpadClear() }
  else if (/^[0-9]$/.test(e.key)) numpadDigit(e.key)
  else if (e.key === '.')         numpadDot()
}

onMounted(()   => document.addEventListener('keydown', handleKeydown))
onUnmounted(() => document.removeEventListener('keydown', handleKeydown))

// ── プリセット数量ボタン ───────────────────────────────────────────────────────
const PRESETS       = [0.1, 0.5, 1, 5, 10]  // 在庫: 小数を含む加算
const ORDER_PRESETS = [-1, 1, 5, 10]        // 発注: 整数の増減（微調整）

// 発注数フォーカス時は整数プリセット、在庫入力時は従来のプリセット。
const activePresets = computed(() => (editingOrder.value ? ORDER_PRESETS : PRESETS))
function presetLabel(n) { return n < 0 ? `−${Math.abs(n)}` : `+${n}` }

function addPreset(n) {
  if (editingOrder.value) { orderStep(n); return }  // 発注数の微調整
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

// 発注モードの送信ペイロード（在庫は任意・発注数は推奨/手入力）
function _orderPayload() {
  const stock = qty.value === '' ? null : parseFloat(qty.value)
  return {
    ingredient: props.ingredient,
    orderMode:  true,
    stock:      stock == null || isNaN(stock) ? null : stock,
    orderQty:   effectiveOrderQty.value ?? 0,
    unit:       unit.value.trim(),
    lot:        props.orderLot,
    isNew:      props.isNew,
  }
}

function submitOrder() {
  const stock = qty.value === '' ? null : parseFloat(qty.value)
  if (stock !== null && (isNaN(stock) || stock < 0)) { hasError.value = true; return }
  hasError.value = false
  emit('confirm', _orderPayload())
}

// アクションボタン/Enter の主送信（モードで分岐）
function onPrimary() {
  if (props.orderMode) submitOrder()
  else                 submit(false)
}

// 前後の品目へ移動（現在の入力を保存してから移動先を開く。空欄=変更なしで移動）
function navigate(dir) {
  if (props.orderMode) {
    const stock = qty.value === '' ? null : parseFloat(qty.value)
    if (stock !== null && (isNaN(stock) || stock < 0)) { hasError.value = true; return }
    hasError.value = false
    emit('navigate', { dir, ..._orderPayload() })
    return
  }
  const empty = qty.value === '' || qty.value == null
  const q = empty ? null : parseFloat(qty.value)
  if (q !== null && (isNaN(q) || q < 0)) { hasError.value = true; return }
  hasError.value = false
  emit('navigate', {
    dir,
    ingredient: props.ingredient,
    qty:        q,
    unit:       unit.value.trim(),
    category:   category.value.trim(),
    isAdd:      false,
    isNew:      props.isNew,
  })
}

// ── スワイプで前後の品目へ移動（左=次 / 右=前）─────────────────────────────────
const dragX = ref(0)
const { onTouchStart, onTouchMove, onTouchEnd } = useHorizontalSwipe({
  onLeft:  () => { if (!props.isEdit && props.canNext) navigate('next') },
  onRight: () => { if (!props.isEdit && props.canPrev) navigate('prev') },
  onDrag:  dx => { dragX.value = props.isEdit ? 0 : Math.max(-32, Math.min(32, dx * 0.28)) },
})

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
    tagA:     tagA.value.trim(),
    tagB:     tagB.value.trim(),
  })
}
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('cancel')">
    <div
      class="modal-sheet"
      @touchstart.passive="onTouchStart"
      @touchmove.passive="onTouchMove"
      @touchend="onTouchEnd"
    >
      <div class="sheet-handle"></div>
      <div class="sheet-title">{{ isEdit ? '品目を編集' : (isNew ? '新しい品目を登録' : (orderMode ? '発注数を入力' : '数量を入力')) }}</div>

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
        <div class="name-row" :style="dragX ? { transform: `translateX(${dragX}px)` } : null">
          <button
            class="name-nav prev"
            :disabled="!canPrev"
            @click="navigate('prev')"
            type="button"
            aria-label="前の品目"
          >◀</button>
          <span class="name-text">{{ ingredient }}</span>
          <button
            class="name-nav next"
            :disabled="!canNext"
            @click="navigate('next')"
            type="button"
            aria-label="次の品目"
          >▶</button>
        </div>
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

      <!-- 発注モード: 現在在庫のラベル＋理論在庫 -->
      <div v-if="orderMode" class="stock-label">
        現在在庫（任意）
        <span v-if="orderFocus === 'stock'" class="focus-badge">⌨ 入力中</span>
      </div>
      <div v-if="orderMode && theoStock" class="theo-row">
        <button class="theo-chip" type="button" @click="useTheoStock">理論在庫 {{ theoStock.qty }}{{ unit }} を使う</button>
        <span class="theo-basis">{{ theoBasis }}</span>
      </div>
      <div v-if="stockDrift != null" :class="['theo-drift', stockDrift === 0 ? 'ok' : '']">
        <template v-if="stockDrift === 0">✓ 理論在庫と一致</template>
        <template v-else-if="stockDrift < 0">理論在庫より {{ Math.abs(stockDrift) }} 少ない（未記録の使用・ロスの可能性）</template>
        <template v-else>理論在庫より {{ stockDrift }} 多い（入庫の記録漏れや数え直しの可能性）</template>
      </div>

      <!-- 数量表示 + 単位 -->
      <div class="qty-row">
        <div
          :class="['qty-display', { error: hasError, filled: qty !== '', 'focus-on': orderMode && orderFocus === 'stock' }]"
          @click="orderMode && (orderFocus = 'stock')"
        >
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

      <!-- 発注ブロック: 発注数（推奨プリセット）＋ 適正在庫/前週参考 -->
      <div v-if="orderMode" class="order-block">
        <!-- 学習値チップ: 推奨はタップで発注数にセット（そこから微調整）-->
        <div class="order-refs">
          <span v-if="targetLevel != null" class="ref-chip ref-par">補充目標: {{ targetLevel }}</span>
          <span v-else class="ref-chip ref-par">補充目標: 未設定</span>
          <button v-if="suggested != null" class="ref-chip ref-sug tappable" type="button" @click="setOrderQty(suggested)">推奨: {{ suggested }}</button>
        </div>
        <!-- 推奨の根拠。数字だけ出しても直しようがないので、必ず理由を添える -->
        <div v-if="replenish?.basis" class="order-basis">{{ replenish.basis }}</div>

        <!-- 品目×同曜の発注実績（前週・先月・直近中央値・ミニ推移）。タップで発注数にセット -->
        <div v-if="weekdayHistory && weekdayHistory.count" class="order-hist">
          <div class="oh-title">{{ orderWeekdayLabel }}曜の発注実績（タップで発注数に）</div>
          <div class="oh-row">
            <button v-if="weekdayHistory.lastWeek" class="oh-chip" type="button" @click="setOrderQty(weekdayHistory.lastWeek.qty)">
              前週 {{ _md(weekdayHistory.lastWeek.date) }} <b>{{ weekdayHistory.lastWeek.qty }}</b>
            </button>
            <button v-if="weekdayHistory.lastMonth" class="oh-chip" type="button" @click="setOrderQty(weekdayHistory.lastMonth.qty)">
              先月 {{ _md(weekdayHistory.lastMonth.date) }} <b>{{ weekdayHistory.lastMonth.qty }}</b>
            </button>
            <button v-if="weekdayHistory.median != null" class="oh-chip oh-median" type="button" @click="setOrderQty(weekdayHistory.median)">
              直近中央値 <b>{{ weekdayHistory.median }}</b>
            </button>
          </div>
          <div v-if="spark.length" class="oh-spark">
            <span
              v-for="(h, i) in spark" :key="i"
              class="oh-bar"
              :style="{ height: h + '%' }"
              :title="`${_md(weekdayHistory.samples[i].date)}: ${weekdayHistory.samples[i].qty}`"
            ></span>
          </div>
        </div>

        <div v-if="suggested != null || (weekdayHistory && weekdayHistory.count)" class="order-refs-hint">↑ タップで発注数にセット・下のテンキーで微調整</div>
        <div class="order-qty-block" @click="orderFocus = 'order'">
          <div class="order-qty-head">
            <span class="order-qty-label">発注数</span>
            <span v-if="orderFocus === 'order'" class="focus-badge">⌨ 入力中</span>
          </div>
          <div :class="['order-qty-row', { 'focus-on': orderFocus === 'order' }]">
            <button class="order-step" @click.stop="orderStep(-1)" :disabled="effectiveOrderQty <= 0" type="button">−</button>
            <span :class="['order-qty-value', { auto: !orderTouched }]">{{ effectiveOrderQty }}</span>
            <button class="order-step" @click.stop="orderStep(1)" type="button">＋</button>
            <span class="order-qty-hint">×{{ orderLot }}{{ unit ? unit : '' }}{{ orderLot > 1 ? ' 納品' : '' }}</span>
          </div>
        </div>
        <div v-if="targetLevel == null" class="order-note">
          この品目は補充目標を出せません。<b>在庫タブで発注点を入れる</b>と、そこから推奨を出せます。
        </div>
        <div v-else-if="parLevel == null" class="order-note">まだ学習データがありません。発注を続けると適正在庫を学習します。</div>
      </div>

      <!-- ジャンル：取込元由来のみ・読み取り専用（無ければ表示しない）-->
      <div v-if="!orderMode && category" class="genre-row">
        <span class="genre-label">ジャンル</span>
        <span class="genre-locked-badge">{{ category }}<span class="unit-lock-icon">🔒</span></span>
      </div>

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

      <!-- 汎用軸（編集モード・名前が設定されている軸のみ） -->
      <div v-if="isEdit && axisNames?.[0]" class="genre-row">
        <span class="genre-label">{{ axisNames[0] }}</span>
        <input type="text" v-model="tagA" maxlength="20" list="axisA-list"
               :placeholder="axisNames[0] + 'を入力'" class="price-input" />
        <datalist id="axisA-list">
          <option v-for="v in existingTagsA" :key="v" :value="v" />
        </datalist>
      </div>
      <div v-if="isEdit && axisNames?.[1]" class="genre-row">
        <span class="genre-label">{{ axisNames[1] }}</span>
        <input type="text" v-model="tagB" maxlength="20" list="axisB-list"
               :placeholder="axisNames[1] + 'を入力'" class="price-input" />
        <datalist id="axisB-list">
          <option v-for="v in existingTagsB" :key="v" :value="v" />
        </datalist>
      </div>

      <!-- プリセットボタン（発注数フォーカス時は整数の増減）-->
      <div class="preset-row">
        <button
          v-for="n in activePresets"
          :key="n"
          class="preset-btn"
          @click="addPreset(n)"
          type="button"
        >{{ presetLabel(n) }}</button>
      </div>

      <!-- テンキー（発注数フォーカス時は小数点なし）-->
      <NumPad :integer="editingOrder" @digit="numpadDigit" @dot="numpadDot" @backspace="numpadBack" @clear="numpadClear" />

      <!-- アクションボタン -->
      <div v-if="isEdit" class="actions">
        <button class="btn btn-secondary" @click="$emit('cancel')">キャンセル</button>
        <button class="btn btn-success" @click="saveEdit">保存</button>
      </div>
      <div v-else-if="orderMode" class="actions">
        <button class="btn btn-secondary" @click="$emit('cancel')">キャンセル</button>
        <button class="btn btn-success" @click="submitOrder">
          {{ effectiveOrderQty > 0 ? `発注 ${effectiveOrderQty} を確定` : '発注なしで確定' }}
        </button>
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
  background: var(--primary-weak);
  border-radius: 10px;
  color: var(--primary);
  margin-bottom: 12px;
  line-height: 1.5;
  position: sticky;
  top: 0;
  z-index: 2;
}

.name-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: transform 0.12s ease-out;
}

.name-text {
  flex: 1;
  min-width: 0;
}

.name-nav {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 9px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s, opacity 0.12s;
}

.name-nav:active {
  background: var(--primary-border);
}

.name-nav:disabled {
  opacity: 0.28;
  cursor: default;
}

.name-hints {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.stock-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--primary);
  margin: 2px 0 4px;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 18px;   /* 入力中バッジの出入りで高さがガタつかないよう予約 */
}

.theo-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
.theo-chip {
  border: 1px solid #a7f3d0;
  background: #ecfdf5;
  color: #047857;
  border-radius: 16px;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
  -webkit-tap-highlight-color: transparent;
}
.theo-chip:active { background: #d1fae5; }
.theo-basis { font-size: 11px; color: #94a3b8; }
.theo-drift { font-size: 11.5px; font-weight: 600; color: #b45309; margin-bottom: 6px; }
.theo-drift.ok { color: #059669; }

.order-block {
  background: var(--primary-weak);
  border: 1px solid var(--primary-border);
  border-radius: 12px;
  padding: 10px 12px;
  margin-bottom: 12px;
}

.order-refs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.ref-chip {
  font-size: 11px;
  font-weight: 700;
  border-radius: 20px;
  padding: 3px 10px;
  background: #fff;
  color: var(--primary);
  border: 1px solid var(--primary-border);
}
.ref-sug { background: var(--primary); color: #fff; border-color: var(--primary); }
.ref-chip.tappable { cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ref-chip.tappable:active { transform: scale(0.95); }
.ref-last.tappable { background: #fff7ed; color: #c2410c; border-color: #fed7aa; }
.order-refs-hint { font-size: 10.5px; color: var(--primary); opacity: 0.85; margin: -3px 0 8px; }

/* 品目×同曜の発注実績 */
.order-hist { background: #fff; border: 1px solid var(--primary-border); border-radius: 10px; padding: 8px 10px; margin: 8px 0; }
.oh-title { font-size: 11px; font-weight: 800; color: #64748b; margin-bottom: 6px; }
.oh-row { display: flex; flex-wrap: wrap; gap: 6px; }
.oh-chip { border: 1px solid var(--primary-border); background: var(--primary-weak); color: var(--primary); border-radius: 16px; padding: 4px 11px; font-size: 12px; font-weight: 700; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.oh-chip b { font-weight: 800; margin-left: 2px; }
.oh-chip:active { transform: scale(0.96); }
.oh-chip.oh-median { border-color: #a7f3d0; background: #ecfdf5; color: #047857; }
.oh-spark { display: flex; align-items: flex-end; gap: 3px; height: 28px; margin-top: 8px; }
.oh-bar { flex: 1; min-width: 4px; max-width: 16px; background: var(--primary); opacity: 0.55; border-radius: 2px 2px 0 0; }
.oh-bar:last-child { opacity: 0.9; }

/* NumPad が編集中の欄を示すバッジ・枠 */
.focus-badge { font-size: 10px; font-weight: 800; color: #fff; background: var(--primary); border-radius: 8px; padding: 1px 6px; margin-left: 6px; letter-spacing: 0.02em; }
.qty-display { transition: box-shadow 0.12s; }
.qty-display.focus-on { box-shadow: 0 0 0 2px var(--primary); }

.order-qty-block { cursor: pointer; -webkit-tap-highlight-color: transparent; }
.order-qty-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 18px;   /* 入力中バッジの出入りで高さがガタつかないよう予約 */
  margin-bottom: 6px;
}
.order-qty-row {
  display: flex;
  align-items: center;
  gap: 10px;
  border-radius: 10px;
  padding: 4px;
  transition: box-shadow 0.12s;
}
.order-qty-row.focus-on { box-shadow: inset 0 0 0 2px var(--primary); }

.order-qty-label {
  font-size: 13px;
  font-weight: 700;
  color: #374151;
}

.order-step {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 10px;
  background: var(--primary);
  color: #fff;
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
}
.order-step:disabled { opacity: 0.3; cursor: default; }

.order-qty-value {
  min-width: 46px;
  text-align: center;
  font-size: 26px;
  font-weight: 800;
  color: #111827;
}
.order-qty-value.auto { color: var(--primary); }

.order-qty-hint {
  font-size: 12px;
  color: #6b7280;
  margin-left: auto;
}

.order-basis {
  font-size: 11px;
  color: #64748b;
  margin: 4px 0 6px;
  line-height: 1.5;
}

.order-note {
  font-size: 11px;
  color: #6b7280;
  margin-top: 8px;
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
  background: var(--primary-weak);
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
.genre-hint {
  font-size: 11px;
  color: #94a3b8;
  margin: -2px 0 10px;
  line-height: 1.4;
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
  background: var(--primary-weak);
  color: var(--primary);
  cursor: pointer;
  transition: background 0.1s, transform 0.08s;
  -webkit-tap-highlight-color: transparent;
}

.preset-btn:active {
  background: var(--primary-soft);
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
.action-add       { background: var(--primary-soft); color: var(--primary-deep); }
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
