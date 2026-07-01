<script setup>
import { ref } from 'vue'
import { useEscapeKey } from '../composables/useEscapeKey.js'

const props = defineProps({
  existingCategories: { type: Array, default: () => [] },
  // 品目リスト設定（マスタ作成）から開くときは数量列を隠す
  showQty:            { type: Boolean, default: true },
})
const emit = defineEmits(['apply', 'close'])
useEscapeKey(() => emit('close'))

// 列の並び（ペースト時のタブ区切りマッピングにも使う）
const COLS = ['name', 'qty', 'unit', 'price', 'category']

function emptyRow() {
  return { name: '', qty: '', unit: '', price: '', category: '' }
}

const rows = ref(Array.from({ length: 5 }, emptyRow))
const error = ref('')

function addRow() {
  rows.value.push(emptyRow())
}

function removeRow(i) {
  rows.value.splice(i, 1)
  if (rows.value.length === 0) rows.value.push(emptyRow())
}

// Excel/スプレッドシートからのペースト: タブ＝列・改行＝行で流し込む。
// スペースは区切りにせず、そのままセルの値（品目名の一部）として扱う。
function onPaste(e, rowIdx, colKey) {
  const text = e.clipboardData?.getData('text') ?? ''
  if (!/[\t\n]/.test(text)) return   // 単一セルの貼り付けは通常動作に任せる
  e.preventDefault()

  const startCol = COLS.indexOf(colKey)
  const lines = text.replace(/\r/g, '').split('\n')
  // 末尾の空行を除去
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()

  lines.forEach((line, li) => {
    const r = rowIdx + li
    while (rows.value.length <= r) rows.value.push(emptyRow())
    line.split('\t').forEach((cell, ci) => {
      const key = COLS[startCol + ci]
      if (key) rows.value[r][key] = cell.trim()
    })
  })
}

function onApply() {
  const cleaned = rows.value
    .map(r => ({
      name:     (r.name ?? '').trim(),
      qty:      (r.qty ?? '').toString().trim(),
      unit:     (r.unit ?? '').trim(),
      price:    (r.price ?? '').toString().trim(),
      category: (r.category ?? '').trim(),
    }))
    .filter(r => r.name)

  if (cleaned.length === 0) {
    error.value = '品目名を1つ以上入力してください'
    return
  }
  emit('apply', cleaned)
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-sheet grid-sheet">
      <div class="grid-header">
        <span class="sheet-title">品目を一括入力</span>
        <button class="grid-close" @click="emit('close')">✕</button>
      </div>

      <p class="grid-desc">
        1行＝1品目。手打ちも、Excel・スプレッドシートからの<strong>コピペ</strong>もできます
        （タブ区切りで各列に振り分け）。数量を入れると在庫にも記録されます。
      </p>

      <div class="grid-scroll">
        <table class="bulk-grid">
          <thead>
            <tr>
              <th class="c-name">品目名</th>
              <th v-if="showQty" class="c-num">数量</th>
              <th class="c-unit">単位</th>
              <th class="c-num">金額</th>
              <th class="c-cat">ジャンル</th>
              <th class="c-del"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in rows" :key="i">
              <td>
                <input v-model="row.name" class="cell" placeholder="コーヒー"
                  @paste="onPaste($event, i, 'name')" />
              </td>
              <td v-if="showQty">
                <input v-model="row.qty" class="cell cell-num" inputmode="decimal" placeholder="—"
                  @paste="onPaste($event, i, 'qty')" />
              </td>
              <td>
                <input v-model="row.unit" class="cell cell-unit" placeholder="—"
                  @paste="onPaste($event, i, 'unit')" />
              </td>
              <td>
                <input v-model="row.price" class="cell cell-num" inputmode="numeric" placeholder="—"
                  @paste="onPaste($event, i, 'price')" />
              </td>
              <td>
                <input v-model="row.category" list="bulk-cat-list" class="cell" placeholder="—"
                  @paste="onPaste($event, i, 'category')" />
              </td>
              <td>
                <button class="row-del" @click="removeRow(i)" title="行を削除">✕</button>
              </td>
            </tr>
          </tbody>
        </table>
        <datalist id="bulk-cat-list">
          <option v-for="cat in existingCategories" :key="cat" :value="cat" />
        </datalist>
      </div>

      <button class="add-row-btn" @click="addRow">＋ 行を追加</button>

      <p v-if="error" class="grid-error">{{ error }}</p>

      <div class="grid-actions">
        <button class="btn btn-secondary" @click="emit('close')">キャンセル</button>
        <button class="btn btn-primary" @click="onApply">登録する</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 9000;
  display: flex;
  align-items: flex-end;
}
.grid-sheet {
  width: 100%;
  background: var(--surface, white);
  border-radius: 20px 20px 0 0;
  padding: 16px 14px 28px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}
.grid-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.sheet-title { font-size: 16px; font-weight: 800; color: var(--text); }
.grid-close {
  width: 32px; height: 32px; border: none; background: #f1f5f9;
  border-radius: 50%; font-size: 14px; cursor: pointer; color: var(--text-muted);
  -webkit-tap-highlight-color: transparent;
}
.grid-desc {
  font-size: 12px; color: var(--text-muted); line-height: 1.6; margin: 0 2px 10px;
}
.grid-desc strong { color: var(--primary); }

.grid-scroll {
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  flex: 1;
  min-height: 0;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
}
.bulk-grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.bulk-grid th {
  position: sticky;
  top: 0;
  background: #f8fafc;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  padding: 8px 6px;
  text-align: left;
  border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
}
.bulk-grid td {
  padding: 0;
  border-bottom: 1px solid #f1f5f9;
}
.c-name { min-width: 120px; }
.c-num  { width: 64px; }
.c-unit { width: 56px; }
.c-cat  { min-width: 84px; }
.c-del  { width: 32px; }

.cell {
  width: 100%;
  border: none;
  background: transparent;
  padding: 10px 6px;
  font-size: 13px;
  color: var(--text);
  box-sizing: border-box;
}
.cell:focus {
  outline: none;
  background: #eff6ff;
}
.cell-num, .cell-unit { text-align: right; }

.row-del {
  width: 26px; height: 26px; border: none; background: none;
  color: #cbd5e1; font-size: 13px; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.row-del:active { color: #ef4444; }

.add-row-btn {
  margin-top: 10px;
  width: 100%;
  padding: 10px;
  border: 1.5px dashed #cbd5e1;
  background: none;
  border-radius: 10px;
  color: var(--primary);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.grid-error {
  color: #ef4444;
  font-size: 12px;
  margin: 8px 2px 0;
}

.grid-actions {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}
.grid-actions .btn { flex: 1; }
</style>
