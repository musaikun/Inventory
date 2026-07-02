<script setup>
import { ref, computed, reactive } from 'vue'

const props = defineProps({
  csvText:  { type: String, required: true },
  filename: { type: String, default: '' },
})
const emit = defineEmits(['imported', 'close'])

function _parseLine(line) {
  const result = []
  let cur = '', inQ = false
  for (const ch of line) {
    if (ch === '"')              { inQ = !inQ }
    else if (ch === ',' && !inQ) { result.push(cur); cur = '' }
    else                         { cur += ch }
  }
  result.push(cur)
  return result
}

const allLines   = props.csvText.replace(/^﻿/, '').trim().split(/\r?\n/).filter(l => l.trim())
const headers    = allLines[0] ? _parseLine(allLines[0]).map(h => h.trim()) : []
const previewRows = allLines.slice(1, 6).map(l => _parseLine(l))

const mapping = reactive({
  name:      null,
  unit:      null,
  price:     null,
  category:  null,
  code:      null,
  lotSize:   null,
  prevMonth: null,
})

const HINTS = {
  name:      ['品目名', '商品名', '品名', '名称', 'name', 'item', 'product'],
  unit:      ['単位', 'unit'],
  price:     ['単価', '価格', '金額', '原価', 'price', 'cost'],
  category:  ['カテゴリ', '分類', '種別', 'ジャンル', 'category', 'type'],
  code:      ['商品コード', 'コード', 'jan', 'ean', 'barcode', 'code'],
  lotSize:   ['入数', '入り数', 'ロット', 'lot', 'pack'],
  prevMonth: ['前月実績', '前月', '先月', 'prev', 'last'],
}

function _detect(hints) {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase()
    if (hints.some(hint => h.includes(hint.toLowerCase()))) return i
  }
  return null
}

mapping.name      = _detect(HINTS.name)     ?? 0
mapping.unit      = _detect(HINTS.unit)
mapping.price     = _detect(HINTS.price)
mapping.category  = _detect(HINTS.category)
mapping.code      = _detect(HINTS.code)
mapping.lotSize   = _detect(HINTS.lotSize)
mapping.prevMonth = _detect(HINTS.prevMonth)

const FIELD_DEFS = [
  { key: 'name',      label: '品目名',         required: true },
  { key: 'unit',      label: '単位',           required: false },
  { key: 'price',     label: '単価',           required: false },
  { key: 'category',  label: 'カテゴリ',       required: false },
  { key: 'code',      label: '商品コード（バーコード）', required: false },
  { key: 'lotSize',   label: '入数',           required: false },
  { key: 'prevMonth', label: '前月実績',       required: false },
]

const canImport = computed(() => mapping.name !== null)

const totalRows = allLines.length - 1

function preview(colIdx, rowIdx) {
  if (colIdx === null || colIdx === undefined) return ''
  const row = previewRows[rowIdx]
  return row?.[colIdx]?.trim() ?? ''
}

function onImport() {
  if (!canImport.value) return
  emit('imported', { mapping: { ...mapping }, csvText: props.csvText })
}
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-sheet mapper-sheet">
      <div class="sheet-handle"></div>
      <div class="sheet-title">CSVの列をマッピング</div>

      <div class="mapper-hint">
        アップロードされたCSVの各列を品目リストのフィールドに対応付けてください。
        <span v-if="filename" class="mapper-filename">{{ filename }}</span>
        （{{ totalRows }}行）
      </div>

      <!-- プレビューテーブル -->
      <div class="preview-wrap">
        <div class="preview-label">プレビュー（先頭{{ previewRows.length }}行）</div>
        <div class="preview-scroll">
          <table class="preview-table">
            <thead>
              <tr>
                <th class="col-num">#</th>
                <th v-for="(h, i) in headers" :key="i" class="col-head">{{ h || `列${i+1}` }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, ri) in previewRows" :key="ri">
                <td class="col-num">{{ ri + 1 }}</td>
                <td v-for="(_, ci) in headers" :key="ci" class="col-cell">{{ row[ci]?.trim() }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- マッピング設定 -->
      <div class="mapping-section">
        <div class="mapping-label">列の対応設定</div>
        <div class="mapping-rows">
          <div
            v-for="def in FIELD_DEFS"
            :key="def.key"
            class="mapping-row"
          >
            <div class="mapping-field">
              <span class="mapping-field-name">{{ def.label }}</span>
              <span v-if="def.required" class="mapping-required">必須</span>
            </div>
            <select
              v-model="mapping[def.key]"
              class="mapping-select"
              :class="{ error: def.required && mapping[def.key] === null }"
            >
              <option :value="null">（使用しない）</option>
              <option v-for="(h, i) in headers" :key="i" :value="i">
                {{ i + 1 }}列: {{ h || `列${i+1}` }}
              </option>
            </select>
            <div v-if="mapping[def.key] !== null" class="mapping-preview">
              <span
                v-for="(_, ri) in previewRows"
                :key="ri"
                class="preview-chip"
              >{{ preview(mapping[def.key], ri) || '…' }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="mapper-actions">
        <button class="btn btn-secondary" @click="$emit('close')">キャンセル</button>
        <button
          class="btn btn-primary"
          :disabled="!canImport"
          @click="onImport"
        >このマッピングでインポート</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mapper-sheet {
  max-height: 92vh;
  overflow-y: auto;
}

.mapper-hint {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.5;
  margin-bottom: 12px;
}

.mapper-filename {
  display: inline-block;
  font-weight: 700;
  color: var(--primary);
  margin-left: 4px;
}

.preview-wrap {
  margin-bottom: 16px;
}

.preview-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 6px;
}

.preview-scroll {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.preview-table {
  border-collapse: collapse;
  font-size: 11px;
  white-space: nowrap;
  width: 100%;
}

.col-num {
  width: 28px;
  text-align: center;
  color: var(--text-muted);
  background: #f8fafc;
  border-right: 1px solid var(--border);
  padding: 4px 6px;
}

.col-head {
  background: #f1f5f9;
  font-weight: 700;
  color: var(--text);
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  border-right: 1px solid #e2e8f0;
}

.col-cell {
  padding: 4px 10px;
  color: var(--text);
  border-bottom: 1px solid #f1f5f9;
  border-right: 1px solid #f1f5f9;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mapping-section {
  margin-bottom: 16px;
}

.mapping-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 10px;
}

.mapping-rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mapping-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mapping-field {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mapping-field-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}

.mapping-required {
  font-size: 10px;
  font-weight: 700;
  color: white;
  background: #ef4444;
  padding: 1px 6px;
  border-radius: 4px;
}

.mapping-select {
  width: 100%;
  padding: 8px 10px;
  border: 1.5px solid var(--border);
  border-radius: 8px;
  font-size: 13px;
  color: var(--text);
  background: white;
  outline: none;
  font-family: inherit;
  cursor: pointer;
}

.mapping-select:focus { border-color: var(--primary); }
.mapping-select.error { border-color: #ef4444; background: #fef2f2; }

.mapping-preview {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.preview-chip {
  font-size: 11px;
  background: #eff6ff;
  color: var(--primary);
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid #bfdbfe;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mapper-actions {
  display: flex;
  gap: 10px;
}

.mapper-actions .btn {
  flex: 1;
}
</style>
