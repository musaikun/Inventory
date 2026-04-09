<script setup>
import { computed } from 'vue'
import { useConfig } from '../composables/useConfig.js'

const { config } = useConfig()

const props = defineProps({
  inventory: { type: Object, required: true },
  filledCount: { type: Number, required: true },
})

const emit = defineEmits(['update', 'remove', 'reset'])

// 定義順の行 + カスタム品目（末尾）
const rows = computed(() => {
  const ordered = config.order.map((item, i) => ({
    item,
    index: i + 1,
    entry: props.inventory[item] ?? null,
    custom: false,
  }))

  const customs = Object.keys(props.inventory)
    .filter(k => !config.order.includes(k))
    .map(item => ({ item, index: '*', entry: props.inventory[item], custom: true }))

  return [...ordered, ...customs]
})

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
              step="0.5"
              placeholder="—"
              :value="row.entry?.qty ?? ''"
              :class="['qty-input', { filled: row.entry !== null }]"
              @change="onQtyChange(row.item, $event)"
            />
          </td>
        </tr>
      </tbody>
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

.th-qty { text-align: center; width: 86px; }

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
</style>
