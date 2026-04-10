<script setup>
import { computed } from 'vue'
import { useConfig } from '../composables/useConfig.js'

const { config } = useConfig()

const props = defineProps({
  inventory:  { type: Object, required: true },
  filledCount: { type: Number, required: true },
})

const emit = defineEmits(['update', 'remove', 'reset'])

// 定義順の行 + カスタム品目（末尾）
const rows = computed(() => {
  const ordered = config.order.map((item, i) => ({
    item,
    index:     i + 1,
    entry:     props.inventory[item] ?? null,
    custom:    false,
    unitPrice: config.prices?.[item] ?? null,
  }))

  const customs = Object.keys(props.inventory)
    .filter(k => !config.order.includes(k))
    .map(item => ({
      item,
      index:     '*',
      entry:     props.inventory[item],
      custom:    true,
      unitPrice: config.prices?.[item] ?? null,
    }))

  return [...ordered, ...customs]
})

// 価格が1件でも設定されていれば金額列を表示
const hasPrices = computed(() =>
  config.prices && Object.keys(config.prices).length > 0
)

const grandTotal = computed(() => {
  if (!hasPrices.value) return null
  let total = 0
  let has   = false
  for (const row of rows.value) {
    if (!row.entry || row.unitPrice == null) continue
    total += row.entry.qty * row.unitPrice
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

function onQtyChange(item, event) {
  const val = event.target.value
  if (val === '') {
    emit('remove', item)
  } else {
    const q = parseFloat(val)
    if (!isNaN(q) && q >= 0) {
      const existing = props.inventory[item]
      emit('update', { item, qty: q, unit: existing?.unit ?? '' })
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

    <!-- テーブル -->
    <table class="inv-table">
      <thead>
        <tr>
          <th>品目</th>
          <th class="th-qty">数量</th>
          <th v-if="hasPrices" class="th-amount">金額</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.item"
          :class="{ filled: row.entry !== null }"
        >
          <td class="td-name">
            <span class="row-num">{{ row.index }}.</span>
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
      </tbody>
      <tfoot v-if="grandTotal != null">
        <tr class="total-row">
          <td colspan="2" class="td-total-label">合計</td>
          <td class="td-total-value">{{ fmtYen(grandTotal) }}</td>
        </tr>
      </tfoot>
    </table>
  </section>
</template>

<style scoped>
.inventory-section { padding: 0 16px; }

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

.th-qty    { text-align: center; width: 86px; }
.th-amount { text-align: right;  width: 76px; padding-right: 12px; }

.inv-table tbody tr {
  border-bottom: 1px solid var(--border);
  transition: background 0.15s;
}

.inv-table tbody tr:last-child { border-bottom: none; }
.inv-table tbody tr.filled     { background: #f0fdf4; }

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

/* 金額列 */
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

/* 合計行 */
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
