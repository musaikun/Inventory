<script setup>
/**
 * 過去データ取込（納品・棚卸）の列指定画面。
 *
 * 品目マスタの列指定（`ImportMapper`）と同じ規約に従う:
 *   ・字句解析は `utils/csvParse.js` の共通トークナイザ
 *   ・**1行目が見出しかデータかはユーザーに明示的に選ばせる**（推測を既定値にしない）
 *   ・列名からの自動検出は「見出しがある」と選んだときだけ
 *
 * 違いは出力で、こちらは選んだ列を**正規のヘッダ名を持つ中間CSV**へ組み直して返す。
 * 検証・日付正規化・重複判定・確認画面は既存の取込経路をそのまま通す。
 */
import { ref, reactive, computed, watch } from 'vue'
import { tokenizeCSV } from '../utils/csvParse.js'
import { buildMappedCSV, detectColumn } from '../utils/rowMapping.js'
import { useEscapeKey } from '../composables/useEscapeKey.js'

const props = defineProps({
  csvText:  { type: String, required: true },
  filename: { type: String, default: '' },
  title:    { type: String, default: '列を指定して取り込む' },
  // なぜこの画面に来たのか（自動で読めなかった理由）
  message:  { type: String, default: '' },
  fields:   { type: Array, required: true },
})
const emit = defineEmits(['apply', 'close'])
useEscapeKey(() => emit('close'))

const { rows: records, error: parseError } = tokenizeCSV(props.csvText)

const firstCols = records[0]?.cols.map(c => c.trim()) ?? []
const colCount  = records.reduce((n, r) => Math.max(n, r.cols.length), 0)

// null = 未選択。選ばれるまで取り込ませない（片方の解釈で黙って1行失わせない）。
const hasHeader    = ref(null)
const headerChosen = computed(() => hasHeader.value !== null)

const headers = computed(() =>
  Array.from({ length: colCount }, (_, i) =>
    (hasHeader.value === true ? (firstCols[i] ?? '') : '') || `列${i + 1}`))

const dataRecords = computed(() => (hasHeader.value === true ? records.slice(1) : records))
const previewRows = computed(() => dataRecords.value.slice(0, 5).map(r => r.cols))
const totalRows   = computed(() => dataRecords.value.length)

const mapping = reactive({})
for (const f of props.fields) mapping[f.key] = null

// 見出し／データの選択を切り替えたら自動検出もやり直す
// （「1行目はデータ」に変えた瞬間、見出し語で当てた対応が残ると誤対応になる）。
function autoDetect() {
  for (const f of props.fields) {
    mapping[f.key] = hasHeader.value === true ? detectColumn(firstCols, f.hints ?? []) : null
  }
}
autoDetect()
watch(hasHeader, autoDetect)

const requiredFields = computed(() => props.fields.filter(f => f.required))
const missingRequired = computed(() =>
  requiredFields.value.filter(f => mapping[f.key] === null || mapping[f.key] === undefined))

const canApply = computed(() =>
  !parseError && headerChosen.value && missingRequired.value.length === 0 && totalRows.value > 0)

function preview(colIdx, rowIdx) {
  if (colIdx === null || colIdx === undefined) return ''
  return previewRows.value[rowIdx]?.[colIdx]?.trim() ?? ''
}

function onApply() {
  if (!canApply.value) return
  emit('apply', {
    csvText: buildMappedCSV(records, mapping, props.fields, hasHeader.value === true),
    filename: props.filename,
  })
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-sheet rm-sheet" role="dialog" aria-modal="true">
      <div class="sheet-handle"></div>
      <div class="sheet-title">{{ title }}</div>

      <div v-if="message" class="rm-why">{{ message }}</div>

      <div class="rm-hint">
        ファイルの列を、取込に必要な項目へ対応づけてください。
        <span v-if="filename" class="rm-file">{{ filename }}</span>
        （データ{{ totalRows }}行）
      </div>

      <!-- 構造エラー（未閉じ引用符など）。ここから先へ進ませない -->
      <div v-if="parseError" class="rm-error" role="alert">✗ {{ parseError.message }}</div>

      <!-- 先頭行の扱い。推測で確定させず、必ず明示的に選ばせる -->
      <div class="rm-header-block">
        <div class="rm-label">1行目の扱い（選択してください）</div>
        <label class="rm-opt" :class="{ on: hasHeader === true }">
          <input type="radio" :value="true" v-model="hasHeader" />
          <span class="rm-opt-body">
            <span class="rm-opt-name">1行目は見出し（列名）</span>
            <span class="rm-opt-desc">1行目は取り込まず、列名として使います。</span>
          </span>
        </label>
        <label class="rm-opt" :class="{ on: hasHeader === false }">
          <input type="radio" :value="false" v-model="hasHeader" />
          <span class="rm-opt-body">
            <span class="rm-opt-name">1行目からデータ</span>
            <span class="rm-opt-desc">見出しの無いファイル。<b>1行目も取り込みます。</b></span>
          </span>
        </label>
        <p v-if="!headerChosen" class="rm-blocked" role="status">どちらかを選ぶまで取り込めません。</p>
      </div>

      <!-- プレビュー -->
      <div class="rm-preview-wrap">
        <div class="rm-label">
          プレビュー（{{ headerChosen ? 'データの' : 'ファイルの' }}先頭{{ previewRows.length }}行）
        </div>
        <div class="rm-preview-scroll">
          <table class="rm-table">
            <thead>
              <tr>
                <th class="rm-num">#</th>
                <th v-for="(h, i) in headers" :key="i" class="rm-head">{{ h }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, ri) in previewRows" :key="ri">
                <td class="rm-num">{{ ri + 1 }}</td>
                <td v-for="(_, ci) in headers" :key="ci" class="rm-cell">{{ row[ci]?.trim() }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 列の対応設定 -->
      <div class="rm-map">
        <div class="rm-label">列の対応設定</div>
        <div v-for="def in fields" :key="def.key" class="mapping-row">
          <div class="rm-field">
            <span class="mapping-field-name">{{ def.label }}</span>
            <span v-if="def.required" class="rm-required">必須</span>
          </div>
          <select
            v-model="mapping[def.key]"
            class="rm-select"
            :class="{ error: def.required && mapping[def.key] === null }"
          >
            <option :value="null">（使用しない）</option>
            <option v-for="(h, i) in headers" :key="i" :value="i">{{ i + 1 }}列: {{ h }}</option>
          </select>
          <div v-if="mapping[def.key] !== null" class="rm-chips">
            <span v-for="(_, ri) in previewRows" :key="ri" class="rm-chip">
              {{ preview(mapping[def.key], ri) || '…' }}
            </span>
          </div>
        </div>
      </div>

      <p v-if="headerChosen && missingRequired.length" class="rm-blocked" role="status">
        {{ missingRequired.map(f => f.label).join('・') }} の列を指定してください。
      </p>

      <div class="rm-actions">
        <button class="btn btn-secondary" @click="emit('close')">キャンセル</button>
        <button class="btn btn-primary" :disabled="!canApply" @click="onApply">この指定で取り込む</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rm-sheet { max-height: 92vh; overflow-y: auto; }

.rm-why {
  background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px;
  padding: 10px 12px; font-size: 12.5px; color: #92400e; font-weight: 600;
  line-height: 1.6; margin-bottom: 10px;
}
.rm-hint { font-size: 13px; color: var(--text-muted, #64748b); line-height: 1.5; margin-bottom: 12px; }
.rm-file { display: inline-block; font-weight: 700; color: var(--primary, #2563eb); margin-left: 4px; }
.rm-error {
  background: #fef2f2; color: var(--danger, #dc2626); border-radius: 10px;
  padding: 10px 14px; font-size: 13px; font-weight: 700; margin-bottom: 12px;
}

.rm-label { font-size: 12px; font-weight: 800; color: #94a3b8; margin-bottom: 6px; }
.rm-header-block { margin-bottom: 14px; }
.rm-opt {
  display: flex; align-items: flex-start; gap: 10px;
  border: 1.5px solid #e2e8f0; border-radius: 10px;
  padding: 10px 12px; margin-bottom: 8px; cursor: pointer;
}
.rm-opt.on { border-color: var(--primary, #2563eb); background: #eff6ff; }
.rm-opt-body { display: flex; flex-direction: column; gap: 2px; }
.rm-opt-name { font-size: 13.5px; font-weight: 800; color: #1e293b; }
.rm-opt-desc { font-size: 12px; color: #64748b; line-height: 1.5; }
.rm-blocked { font-size: 12px; color: #b45309; font-weight: 700; margin: 0 0 10px; }

.rm-preview-wrap { margin-bottom: 14px; }
.rm-preview-scroll { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 10px; }
.rm-table { border-collapse: collapse; font-size: 12px; white-space: nowrap; }
.rm-table th, .rm-table td { border-bottom: 1px solid #f1f5f9; padding: 6px 10px; text-align: left; }
.rm-head { background: #f8fafc; color: #475569; font-weight: 800; }
.rm-num { color: #cbd5e1; font-weight: 700; }
.rm-cell { color: #334155; max-width: 160px; overflow: hidden; text-overflow: ellipsis; }

.mapping-row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.rm-field { display: flex; align-items: center; gap: 6px; }
.mapping-field-name { font-size: 13.5px; font-weight: 700; color: #1e293b; }
.rm-required {
  font-size: 10px; font-weight: 800; color: #b91c1c;
  background: #fef2f2; border-radius: 5px; padding: 2px 6px;
}
.rm-select {
  width: 100%; border: 1.5px solid #e2e8f0; border-radius: 10px;
  padding: 9px 10px; font-size: 13.5px; background: #fff; color: #1e293b;
}
.rm-select.error { border-color: #fca5a5; }
.rm-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.rm-chip {
  font-size: 11px; color: #475569; background: #f1f5f9;
  border-radius: 6px; padding: 2px 7px; max-width: 140px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.rm-actions { display: flex; gap: 10px; margin-top: 16px; }
.btn { flex: 1; border: none; border-radius: 10px; padding: 12px; font-size: 14px; font-weight: 800; cursor: pointer; }
.btn-secondary { background: #f1f5f9; color: #475569; }
.btn-primary { background: var(--primary, #2563eb); color: #fff; }
.btn-primary:disabled { background: #cbd5e1; cursor: not-allowed; }
</style>
