<script setup>
/**
 * 列指定インポートのマッピング画面（IMPORT-001）。
 *
 * 字句解析は utils/csvParse.js の共通トークナイザを使う。独自の1行パーサは
 *   ・`""`（エスケープされた引用符）を落とす
 *   ・引用符の中の改行でレコードを割る
 *   ・閉じていない引用符を黙って受理する
 * ので廃止した。
 *
 * 先頭行が見出しかデータかは**ユーザーに明示的に選ばせる**。自動判定だけに任せると、
 * 見出しの無いファイルで1行目の品目が黙って消える。
 *
 * 推測を**既定値としても使わない**。`商品A` `品目セット` のような品目名は
 * 「商品」「品目」を含むので見出しと推測されるが、実際はデータ行で、
 * そのまま取り込むと1品目目が消える。推測は参考として出すだけにして、
 * 選択されるまで取込を実行させない。
 */
import { ref, computed, reactive, watch } from 'vue'
import { tokenizeCSV } from '../utils/csvParse.js'
import { headerMatches } from '../utils/importText.js'

const props = defineProps({
  csvText:  { type: String, required: true },
  filename: { type: String, default: '' },
  axisNames: { type: Array, default: () => ['', ''] },
})
const emit = defineEmits(['imported', 'close'])

// 共通トークナイザ。未閉じ引用符などの構造エラーはここで出し、マッピングさせない。
const { rows: records, error: parseError } = tokenizeCSV(props.csvText)

const firstCols = records[0]?.cols.map(c => c.trim()) ?? []
const colCount  = records.reduce((n, r) => Math.max(n, r.cols.length), 0)

// 1行目が見出しらしいか（列名候補にあたる語を含み、かつ数値だけの行ではない）。
// **参考表示にだけ使う。選択値へは一切反映しない。**
const HEADER_WORDS = [
  '品目', '商品', '品名', '名称', '単位', '単価', '価格', '金額', '原価', 'カテゴリ', '分類',
  'コード', '入数', '前月', 'name', 'item', 'unit', 'price', 'code', 'category',
]
function _looksLikeHeader(cols) {
  if (!cols.length) return false
  const filled = cols.filter(c => c !== '')
  if (!filled.length) return false
  // 全部が数値のような行は見出しではない
  if (filled.every(c => /^[-0-9.,¥￥]+$/.test(c))) return false
  return filled.some(c => headerMatches(c, HEADER_WORDS))
}

// null = 未選択。ユーザーが選ぶまでどちらでもない（推測で埋めない）。
const hasHeader    = ref(null)
const headerChosen = computed(() => hasHeader.value !== null)

const headerGuess = _looksLikeHeader(firstCols)
const guessHint = headerGuess
  ? '参考: 1行目は列名のように見えます（自動では決めません）'
  : '参考: 1行目に列名らしい語は見つかりませんでした（自動では決めません）'

// 列見出しの表示名。見出し行として使わないあいだは「列1」…にする（マッピングの選択肢もこれ）。
const headers = computed(() =>
  Array.from({ length: colCount }, (_, i) =>
    (hasHeader.value === true ? (firstCols[i] ?? '') : '') || `列${i + 1}`),
)
// 見出し行を「データ」と宣言したら、1行目もプレビューとインポートの対象に含める。
// 未選択のあいだはファイルの全行をそのまま見せる（取込は canImport で塞ぐ）。
const dataRecords = computed(() => (hasHeader.value === true ? records.slice(1) : records))
const previewRows = computed(() => dataRecords.value.slice(0, 5).map(r => r.cols))
const totalRows   = computed(() => dataRecords.value.length)

const mapping = reactive({
  name:      null,
  unit:      null,
  price:     null,
  category:  null,
  code:      null,
  lotSize:   null,
  prevMonth: null,
  axisA:     null,
  axisB:     null,
})

const HINTS = {
  name:      ['品目名', '商品名', '品名', '名称', 'name', 'item', 'product'],
  unit:      ['単位', 'unit'],
  price:     ['単価', '価格', '金額', '原価', 'price', 'cost'],
  category:  ['カテゴリ', '分類', '種別', 'ジャンル', 'category', 'type'],
  code:      ['商品コード', 'コード', 'jan', 'ean', 'barcode', 'code'],
  lotSize:   ['入数', '入り数', 'ロット', 'lot', 'pack'],
  prevMonth: ['前月実績', '前月', '先月', 'prev', 'last'],
  axisA:     [props.axisNames?.[0], '場所', 'ロケーション', '棚', 'location', 'place'].filter(Boolean),
  axisB:     [props.axisNames?.[1], '仕入先', '業者', '取引先', 'supplier', 'vendor'].filter(Boolean),
}

// 自動検出は「見出し行がある」と選んだときだけ意味がある。
// 見出しが無い／未選択のあいだは全て未選択にし、品目名だけ1列目を既定にする。
function _detect(hints) {
  if (hasHeader.value !== true) return null
  // 半角カナの見出し（`商品ｺｰﾄﾞ`）も当てる。字形をそろえずに比べると、
  // 読めている列が「無い列」になって手作業へ落ちる。
  for (let i = 0; i < firstCols.length; i++) {
    if (headerMatches(firstCols[i], hints)) return i
  }
  return null
}

// 見出し／データの選択を切り替えたら、列名からの自動検出もやり直す
// （「先頭行はデータ」に変えた瞬間、見出し語で当てた対応が残っていると誤対応になる）。
function autoDetect() {
  mapping.name      = _detect(HINTS.name)     ?? 0
  mapping.unit      = _detect(HINTS.unit)
  mapping.price     = _detect(HINTS.price)
  mapping.category  = _detect(HINTS.category)
  mapping.code      = _detect(HINTS.code)
  mapping.lotSize   = _detect(HINTS.lotSize)
  mapping.prevMonth = _detect(HINTS.prevMonth)
  mapping.axisA     = _detect(HINTS.axisA)
  mapping.axisB     = _detect(HINTS.axisB)
}
autoDetect()
watch(hasHeader, autoDetect)

const FIELD_DEFS = computed(() => [
  { key: 'name',      label: '品目名',         required: true },
  { key: 'unit',      label: '単位',           required: false },
  { key: 'price',     label: '単価',           required: false },
  { key: 'category',  label: 'カテゴリ',       required: false },
  { key: 'code',      label: '商品コード（バーコード）', required: false },
  { key: 'lotSize',   label: '入数',           required: false },
  { key: 'prevMonth', label: '前月実績',       required: false },
  { key: 'axisA',     label: props.axisNames?.[0] || '並び替え①（場所など）', required: false },
  { key: 'axisB',     label: props.axisNames?.[1] || '並び替え②（仕入先など）', required: false },
])

// 1行目の扱いが未選択のあいだは取り込ませない。
// （どちらとも決まっていない状態で実行すると、片方の解釈で黙って1行失う）
const canImport = computed(() =>
  !parseError && headerChosen.value && mapping.name !== null && totalRows.value > 0)

function preview(colIdx, rowIdx) {
  if (colIdx === null || colIdx === undefined) return ''
  const row = previewRows.value[rowIdx]
  return row?.[colIdx]?.trim() ?? ''
}

function onImport() {
  if (!canImport.value) return
  // hasHeader は確認画面と確定処理まで同じ値で伝える（画面の説明と取込結果を一致させる）
  emit('imported', { mapping: { ...mapping }, csvText: props.csvText, hasHeader: hasHeader.value })
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
        （データ{{ totalRows }}行）
      </div>

      <!-- 構造エラー（未閉じ引用符など）。ここから先へ進ませない -->
      <div v-if="parseError" class="mapper-error" role="alert">
        ✗ {{ parseError.message }}
      </div>

      <!-- 先頭行の扱い。推測で確定させず、必ず明示的に選ばせる -->
      <div class="header-block">
        <div class="mapping-label">1行目の扱い（選択してください）</div>
        <label class="header-opt" :class="{ on: hasHeader === true }">
          <input type="radio" :value="true" v-model="hasHeader" />
          <span class="header-body">
            <span class="header-name">1行目は見出し（列名）</span>
            <span class="header-desc">1行目は取り込まず、列名として使います。</span>
          </span>
        </label>
        <label class="header-opt" :class="{ on: hasHeader === false }">
          <input type="radio" :value="false" v-model="hasHeader" />
          <span class="header-body">
            <span class="header-name">1行目からデータ</span>
            <span class="header-desc">見出しの無いファイル。<b>1行目の品目も取り込みます。</b></span>
          </span>
        </label>
        <p class="header-guess">{{ guessHint }}</p>
        <p v-if="!headerChosen" class="header-blocked" role="status">
          どちらかを選ぶまで取り込めません。
        </p>
      </div>

      <!-- プレビューテーブル -->
      <div class="preview-wrap">
        <div class="preview-label">
          プレビュー（{{ headerChosen ? 'データの' : 'ファイルの' }}先頭{{ previewRows.length }}行）
        </div>
        <div class="preview-scroll">
          <table class="preview-table">
            <thead>
              <tr>
                <th class="col-num">#</th>
                <th v-for="(h, i) in headers" :key="i" class="col-head">{{ h }}</th>
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
                {{ i + 1 }}列: {{ h }}
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

.mapper-error {
  background: #fef2f2;
  color: var(--danger, #dc2626);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 12px;
}

.header-block { margin-bottom: 14px; }
.header-opt {
  display: flex; align-items: flex-start; gap: 10px;
  border: 1.5px solid var(--border); border-radius: 10px;
  padding: 9px 12px; margin-bottom: 6px; cursor: pointer;
}
.header-opt.on { border-color: var(--primary); background: var(--primary-weak); }
.header-opt input { margin-top: 3px; width: 16px; height: 16px; flex-shrink: 0; }
.header-body { display: flex; flex-direction: column; gap: 2px; }
.header-name { font-size: 13px; font-weight: 800; color: var(--text); }
.header-desc { font-size: 12px; color: var(--text-muted); line-height: 1.5; }
.header-guess { font-size: 12px; color: var(--text-muted); line-height: 1.5; margin: 4px 0 0; }
.header-blocked { font-size: 12px; font-weight: 700; color: #b45309; margin: 4px 0 0; }

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
  background: var(--primary-weak);
  color: var(--primary);
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid var(--primary-border);
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
