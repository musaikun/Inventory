<script setup>
import { ref, computed } from 'vue'
import { useConfig } from '../composables/useConfig.js'

const { config } = useConfig()

const props = defineProps({
  inventory:   { type: Object, required: true },
  filledCount: { type: Number, required: true },
})

const emit = defineEmits(['update', 'remove', 'reset'])

// ── 並べ替え / フィルター ─────────────────────────────────────────────────────
const sortMode   = ref('default')  // 'default' | 'alpha' | 'category'
const filterMode = ref('all')      // 'all' | 'filled' | 'empty'

const sortOpts = [
  { value: 'default',  label: 'デフォルト' },
  { value: 'alpha',    label: '五十音' },
  { value: 'category', label: 'ジャンル' },
]

const filterOpts = [
  { value: 'all',    label: 'すべて' },
  { value: 'filled', label: '入力済み' },
  { value: 'empty',  label: '未入力' },
]

// ── 行データ生成 ──────────────────────────────────────────────────────────────
const rows = computed(() => {
  // 1. config.order 順の行（すべて、entry=null もあり）
  const ordered = config.order.map((item, i) => ({
    type:      'item',
    item,
    index:     i + 1,
    entry:     props.inventory[item] ?? null,
    custom:    false,
    unitPrice: config.prices?.[item]     ?? null,
    category:  config.categories?.[item] ?? null,
    code:      config.codes?.[item]      ?? null,
  }))

  // 2. config.order に含まれないカスタム品目
  const customs = Object.keys(props.inventory)
    .filter(k => !config.order.includes(k))
    .map(item => ({
      type:      'item',
      item,
      index:     '*',
      entry:     props.inventory[item],
      custom:    true,
      unitPrice: config.prices?.[item]     ?? null,
      category:  config.categories?.[item] ?? null,
      code:      config.codes?.[item]      ?? null,
    }))

  // 3. フィルター適用
  let items
  if (filterMode.value === 'filled') {
    items = [...ordered, ...customs].filter(r => r.entry !== null)
  } else if (filterMode.value === 'empty') {
    // 未入力は config.order 内のみ（カスタム品目は常に入力済みなので対象外）
    items = ordered.filter(r => r.entry === null)
  } else {
    items = [...ordered, ...customs]
  }

  // 4. 並べ替え適用
  if (sortMode.value === 'alpha') {
    return [...items].sort((a, b) => a.item.localeCompare(b.item, 'ja'))
  }

  if (sortMode.value === 'category') {
    // カテゴリ別グループ化
    const groupMap = new Map()
    for (const row of items) {
      const cat = row.category ?? 'その他'
      if (!groupMap.has(cat)) groupMap.set(cat, [])
      groupMap.get(cat).push(row)
    }
    // カテゴリ名で五十音順ソート（その他は末尾）
    const sorted = [...groupMap.entries()].sort(([a], [b]) => {
      if (a === 'その他') return 1
      if (b === 'その他') return -1
      return a.localeCompare(b, 'ja')
    })
    // グループヘッダー行を挿入してフラット化
    const result = []
    for (const [cat, groupRows] of sorted) {
      result.push({ type: 'group-header', label: cat })
      result.push(...groupRows)
    }
    return result
  }

  // デフォルト: config.order 順のまま
  return items
})

// フィルター後の実際の品目数（グループヘッダーを除く）
const visibleItemCount = computed(() =>
  rows.value.filter(r => r.type === 'item').length
)

// ── 価格・金額 ────────────────────────────────────────────────────────────────
const hasPrices = computed(() =>
  config.prices && Object.keys(config.prices).length > 0
)

const hasCodes = computed(() =>
  config.codes && Object.keys(config.codes).length > 0
)

// 列数（商品コード列 + 品目列 + 数量列 [+ 金額列]）
const totalCols = computed(() => {
  let n = 2 // 品目 + 数量
  if (hasCodes.value)  n++
  if (hasPrices.value) n++
  return n
})

// 合計は常に全在庫ベース（フィルターに関係なく表示）
const grandTotal = computed(() => {
  if (!hasPrices.value) return null
  let total = 0
  let has   = false
  for (const [item, entry] of Object.entries(props.inventory)) {
    const price = config.prices?.[item]
    if (price == null) continue
    total += entry.qty * price
    has = true
  }
  return has ? Math.round(total) : null
})

function subtotal(row) {
  if (!row.entry || row.unitPrice == null) return null
  return Math.round(row.entry.qty * row.unitPrice)
}

function fmtYen(n) {
  return '¥' + Math.round(n).toLocaleString('ja-JP')
}

// ── 数量変更 ──────────────────────────────────────────────────────────────────
function onQtyChange(item, event) {
  const val = event.target.value
  if (val === '') {
    emit('remove', item)
  } else {
    const q = parseFloat(val)
    if (!isNaN(q) && q >= 0) {
      const existing = props.inventory[item]
      // 既存エントリの単位 → config のデフォルト単位 → 空文字 の順にフォールバック
      const unit = existing?.unit || config.units?.[item] || ''
      emit('update', { item, qty: q, unit })
    }
  }
}
</script>

<template>
  <section class="inventory-section">
    <!-- ヘッダー行 -->
    <div class="section-header">
      <h2>棚卸一覧</h2>
      <div class="header-right">
        <span class="progress">
          <strong>{{ filledCount }}</strong> / {{ config.order.length }} 件入力済み
        </span>
        <button class="btn-danger-sm" @click="$emit('reset')">リセット</button>
      </div>
    </div>

    <!-- 並べ替え / フィルター ツールバー -->
    <div class="toolbar">
      <div class="seg-group">
        <button
          v-for="opt in sortOpts"
          :key="opt.value"
          :class="['seg-btn', { active: sortMode === opt.value }]"
          @click="sortMode = opt.value"
        >{{ opt.label }}</button>
      </div>
      <div class="seg-group">
        <button
          v-for="opt in filterOpts"
          :key="opt.value"
          :class="['seg-btn', { active: filterMode === opt.value }]"
          @click="filterMode = opt.value"
        >{{ opt.label }}</button>
      </div>
    </div>

    <!-- テーブル -->
    <table class="inv-table">
      <thead>
        <tr>
          <th v-if="hasCodes" class="th-code">商品コード</th>
          <th>品目</th>
          <th class="th-qty">数量</th>
          <th v-if="hasPrices" class="th-amount">金額</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="(row, rowIdx) in rows" :key="row.type === 'group-header' ? `__g__${row.label}` : `${rowIdx}_${row.item}`">

          <!-- ジャンルヘッダー行 -->
          <tr v-if="row.type === 'group-header'" class="group-header-row">
            <td :colspan="totalCols" class="group-header-cell">
              {{ row.label }}
            </td>
          </tr>

          <!-- 品目行 -->
          <tr v-else :class="{ filled: row.entry !== null }">
            <td v-if="hasCodes" class="td-code">{{ row.code ?? '' }}</td>
            <td class="td-name">
              {{ row.item }}
              <span v-if="row.custom" class="badge">追加</span>
            </td>
            <td class="td-qty">
              <input
                type="number"
                min="0"
                step="0.1"
                placeholder="—"
                :value="row.entry?.qty ?? ''"
                :class="['qty-input', { filled: row.entry !== null }]"
                @change="onQtyChange(row.item, $event)"
              />
            </td>
            <td v-if="hasPrices" class="td-amount">
              <span v-if="subtotal(row) != null" class="amount-value">
                {{ fmtYen(subtotal(row)) }}
              </span>
              <span v-else class="amount-na">—</span>
            </td>
          </tr>

        </template>

        <!-- フィルター結果が0件のとき -->
        <tr v-if="visibleItemCount === 0" class="empty-row">
          <td :colspan="totalCols" class="empty-cell">
            {{ filterMode === 'filled' ? '入力済みの品目がありません' : 'すべての品目が入力済みです 🎉' }}
          </td>
        </tr>
      </tbody>

      <!-- 合計行（価格設定済みかつ在庫あり） -->
      <tfoot v-if="grandTotal != null">
        <tr class="total-row">
          <td :colspan="totalCols - 1" class="td-total-label">在庫合計</td>
          <td class="td-total-value">{{ fmtYen(grandTotal) }}</td>
        </tr>
      </tfoot>
    </table>
  </section>
</template>

<style scoped>
.inventory-section { padding: 0 16px; }

/* ── セクションヘッダー ── */
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 4px 10px;
}

.section-header h2 {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.progress {
  font-size: 12px;
  color: var(--text-muted);
}

.progress strong {
  color: var(--primary);
  font-weight: 700;
}

/* ── ツールバー ── */
.toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.seg-group {
  display: flex;
  flex: 1;
  background: #f1f5f9;
  border-radius: 10px;
  padding: 3px;
  gap: 2px;
}

.seg-btn {
  flex: 1;
  padding: 6px 2px;
  font-size: 11px;
  font-weight: 600;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  color: var(--text-muted);
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
  line-height: 1.3;
}

.seg-btn.active {
  background: white;
  color: var(--primary);
  box-shadow: 0 1px 3px rgba(0,0,0,0.12);
}

/* ── テーブル ── */
.inv-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--surface);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--shadow);
}

.inv-table thead tr {
  background: #1e3a8a;
  color: white;
}

.inv-table th {
  padding: 11px 14px;
  text-align: left;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.th-code   { width: 76px; white-space: nowrap; }
.th-qty    { text-align: center; width: 86px; }
.th-amount { text-align: right;  width: 76px; padding-right: 12px; }

.inv-table tbody tr {
  border-bottom: 1px solid var(--border);
  transition: background 0.15s;
}

.inv-table tbody tr:last-child { border-bottom: none; }
.inv-table tbody tr.filled     { background: #f0fdf4; }

/* ── ジャンルヘッダー行 ── */
.group-header-row { background: #f8fafc !important; }

.group-header-cell {
  padding: 7px 14px;
  font-size: 11px;
  font-weight: 700;
  color: var(--primary);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border-left: 3px solid var(--primary);
}

/* ── 品目セル ── */
.td-name {
  padding: 11px 14px;
  font-size: 13px;
  line-height: 1.4;
  word-break: keep-all;
  overflow-wrap: break-word;
}

.row-num {
  color: var(--text-muted);
  font-size: 11px;
  margin-right: 3px;
}

.badge {
  font-size: 10px;
  background: #dbeafe;
  color: var(--primary);
  border-radius: 4px;
  padding: 1px 5px;
  margin-left: 4px;
  vertical-align: middle;
}

/* ── 商品コードセル ── */
.td-code {
  padding: 11px 8px 11px 14px;
  font-size: 11px;
  font-family: monospace;
  color: var(--text-muted);
  white-space: nowrap;
  vertical-align: middle;
}


/* ── 数量セル ── */
.td-qty {
  padding: 7px 10px;
  text-align: center;
}

.qty-input {
  width: 66px;
  border: 1.5px solid var(--border);
  border-radius: 8px;
  padding: 7px 4px;
  font-size: 16px;
  font-weight: 700;
  text-align: center;
  background: transparent;
  color: var(--text);
  outline: none;
  -moz-appearance: textfield;
}

.qty-input::-webkit-inner-spin-button,
.qty-input::-webkit-outer-spin-button { opacity: 1; }

.qty-input:focus {
  border-color: var(--primary);
  background: white;
}

.qty-input.filled {
  color: var(--success);
  border-color: #86efac;
  background: #f0fdf4;
}

/* ── 金額セル ── */
.td-amount {
  padding: 7px 12px 7px 4px;
  text-align: right;
  white-space: nowrap;
}

.amount-value {
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}

.amount-na {
  font-size: 12px;
  color: var(--text-muted);
}

/* ── 空メッセージ ── */
.empty-row { background: white !important; }

.empty-cell {
  padding: 28px 20px;
  text-align: center;
  font-size: 14px;
  color: var(--text-muted);
}

/* ── 合計行 ── */
.total-row {
  background: #f0fdf4;
  border-top: 2px solid #86efac;
}

.td-total-label {
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-muted);
}

.td-total-value {
  padding: 10px 12px;
  font-size: 14px;
  font-weight: 700;
  color: var(--success);
  text-align: right;
}
</style>
