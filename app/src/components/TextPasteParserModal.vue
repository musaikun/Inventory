<script setup>
import { ref, computed } from 'vue'
import { parseInventoryText } from '../utils/textParser.js'

const props = defineProps({
  // 'session': 在庫に記録（新規品目は追加も行う）
  // 'import':  品目リストに追加のみ
  mode:         { type: String, default: 'session' },
  configOrder:  { type: Array,  default: () => [] },
})
const emit = defineEmits(['apply', 'close'])

// ── 状態 ─────────────────────────────────────────────────────────────────────
const rawText = ref('')
const rows    = ref([])
const parsed  = ref(false)
const error   = ref('')

function parse() {
  error.value = ''
  const result = parseInventoryText(rawText.value)
  if (!result.length) {
    error.value = '品目が見つかりませんでした。テキストの形式を確認してください。'
    return
  }
  rows.value  = result
  parsed.value = true
}

function reset() {
  parsed.value = false
  rows.value   = []
  error.value  = ''
}

const selectedRows = computed(() => rows.value.filter(r => r.selected))

const existingNames = computed(() => new Set(props.configOrder))

function isKnown(name) {
  return existingNames.value.has(name)
}

function apply() {
  if (!selectedRows.value.length) return
  emit('apply', selectedRows.value.map(r => ({ name: r.name, qty: r.qty, unit: r.unit })))
}
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-sheet parser-sheet">
      <div class="sheet-handle"></div>

      <!-- ── 入力フェーズ ── -->
      <template v-if="!parsed">
        <div class="sheet-title">テキストから{{ mode === 'import' ? '品目リストを作成' : '棚卸を記録' }}</div>
        <p class="parser-desc">
          納品書・発注書・メモなどのテキストを貼り付けてください。<br>
          <span class="parser-hint-ex">例：「豚バラ　3kg」「ビール　24本」「牛乳 500ml」</span>
        </p>
        <textarea
          v-model="rawText"
          class="parser-textarea"
          placeholder="ここにテキストを貼り付け..."
          rows="10"
          autofocus
        ></textarea>
        <div v-if="error" class="parser-error">{{ error }}</div>
        <div class="parser-actions">
          <button class="btn btn-secondary" @click="$emit('close')">キャンセル</button>
          <button class="btn btn-primary" :disabled="!rawText.trim()" @click="parse">解析する →</button>
        </div>
      </template>

      <!-- ── 結果フェーズ ── -->
      <template v-else>
        <div class="sheet-title">解析結果（{{ rows.length }}件）</div>
        <p class="parser-desc">内容を確認・編集し、登録する品目にチェックを入れてください。</p>

        <div class="result-table">
          <!-- 全選択 -->
          <div class="result-header">
            <label class="check-cell">
              <input
                type="checkbox"
                :checked="selectedRows.length === rows.length"
                :indeterminate="selectedRows.length > 0 && selectedRows.length < rows.length"
                @change="e => rows.forEach(r => r.selected = e.target.checked)"
              />
            </label>
            <span class="col-name">品目名</span>
            <span class="col-qty">数量</span>
            <span class="col-unit">単位</span>
            <span class="col-status"></span>
          </div>

          <div
            v-for="(row, idx) in rows"
            :key="idx"
            class="result-row"
            :class="{ unchecked: !row.selected }"
          >
            <label class="check-cell">
              <input v-model="row.selected" type="checkbox" />
            </label>
            <input v-model="row.name" class="col-name editable" type="text" />
            <input
              v-model.number="row.qty"
              class="col-qty editable"
              type="number"
              min="0"
              step="any"
              placeholder="—"
            />
            <input v-model="row.unit" class="col-unit editable" type="text" placeholder="—" />
            <span class="col-status">
              <span v-if="isKnown(row.name)" class="badge-known" title="登録済み品目">既存</span>
              <span v-else class="badge-new" title="新規追加">新規</span>
            </span>
          </div>
        </div>

        <div class="result-summary">
          <span>チェック済み <strong>{{ selectedRows.length }}</strong>件</span>
          <span v-if="selectedRows.filter(r => !isKnown(r.name)).length">
            ／ 新規 <strong>{{ selectedRows.filter(r => !isKnown(r.name)).length }}</strong>件
          </span>
          <span v-if="selectedRows.filter(r => r.qty != null).length">
            ／ 数量入力 <strong>{{ selectedRows.filter(r => r.qty != null).length }}</strong>件
          </span>
        </div>

        <div class="parser-actions">
          <button class="btn btn-secondary" @click="reset">← やり直す</button>
          <button
            class="btn btn-primary"
            :disabled="!selectedRows.length"
            @click="apply"
          >
            <template v-if="mode === 'import'">品目リストに追加</template>
            <template v-else>棚卸に記録＋登録</template>
          </button>
        </div>
      </template>

    </div>
  </div>
</template>

<style scoped>
.parser-sheet {
  max-height: 92vh;
  overflow-y: auto;
}

.parser-desc {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 0 0 12px;
}

.parser-hint-ex {
  font-size: 12px;
  color: var(--primary);
}

.parser-textarea {
  width: 100%;
  padding: 12px;
  border: 1.5px solid var(--border);
  border-radius: 12px;
  font-size: 14px;
  font-family: 'SF Mono', 'Menlo', monospace;
  color: var(--text);
  background: #f8fafc;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
  line-height: 1.6;
  margin-bottom: 12px;
}
.parser-textarea:focus { border-color: var(--primary); background: white; }

.parser-error {
  font-size: 13px;
  color: #ef4444;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 10px;
}

.parser-actions {
  display: flex;
  gap: 10px;
}
.parser-actions .btn { flex: 1; }

/* 結果テーブル */
.result-table {
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 10px;
  font-size: 13px;
}

.result-header {
  display: flex;
  align-items: center;
  background: #f1f5f9;
  padding: 6px 8px;
  font-weight: 700;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
  gap: 6px;
}

.result-row {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  border-bottom: 1px solid #f1f5f9;
  gap: 6px;
  transition: background 0.1s;
}
.result-row:last-child { border-bottom: none; }
.result-row.unchecked { opacity: 0.45; }

.check-cell {
  width: 22px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.check-cell input { margin: 0; cursor: pointer; width: 16px; height: 16px; }

.col-name   { flex: 1; min-width: 0; }
.col-qty    { width: 52px; flex-shrink: 0; }
.col-unit   { width: 44px; flex-shrink: 0; }
.col-status { width: 36px; flex-shrink: 0; text-align: center; }

.editable {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 3px 5px;
  font-size: 13px;
  font-family: inherit;
  color: var(--text);
  width: 100%;
  box-sizing: border-box;
  outline: none;
}
.editable:focus { background: white; border-color: var(--primary); }

.col-qty.editable   { text-align: right; }
.col-unit.editable  { text-align: center; }

.badge-known {
  display: inline-block;
  font-size: 9px;
  font-weight: 700;
  background: #dcfce7;
  color: #166534;
  border-radius: 4px;
  padding: 1px 5px;
}
.badge-new {
  display: inline-block;
  font-size: 9px;
  font-weight: 700;
  background: #dbeafe;
  color: #1d4ed8;
  border-radius: 4px;
  padding: 1px 5px;
}

.result-summary {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 12px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.result-summary strong { color: var(--text); }
</style>
