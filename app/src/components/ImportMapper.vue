<script setup>
/**
 * 取込の列指定。**取込元のファイルを見せたまま**、どの列が何かを決める画面。
 *
 * 前の形（CsvMapperModal）は、1画面に「1行目の扱い」「プレビュー表」「9項目の
 * select 一覧」を同時に置いていた。初めて使う人は、どこから手を付けるのかも、
 * いま何が起きたのかも分からない。ここでは
 *
 *   ① 必要な問いを **1つずつ・順番を固定して** 訊く（ファイルの形で画面が変わらない）
 *   ② 決めたら、見ていた元データの上に **色で対応を書く**（別の抽象に置き換えない）
 *
 * の2段にする。①の順番を固定するのは、使うたびに「今回はどの画面だっけ」から
 * 始めさせないため。ファイルの形で問いの形が変わると、学習が積み上がらない。
 */
import { ref, computed, reactive, watch } from 'vue'
import { tokenizeCSV } from '../utils/csvParse.js'
import { headerMatches, isMetaName } from '../utils/importText.js'
import { useEscapeKey } from '../composables/useEscapeKey.js'
import {
  fingerprintTable, matchRecipe, applyRecipeColumns,
} from '../composables/importRecipes.js'
import ImportBuildPreview from './ImportBuildPreview.vue'

const props = defineProps({
  csvText:   { type: String, required: true },
  filename:  { type: String, default: '' },
  axisNames: { type: Array,  default: () => ['', ''] },
})
const emit = defineEmits(['imported', 'close'])
useEscapeKey(() => emit('close'))

const { rows: records, error: parseError } = tokenizeCSV(props.csvText)

const FIELDS = computed(() => [
  { key: 'name',      label: '品目名',   required: true, color: '#2563eb', weak: '#eff6ff',
    hints: ['品目名', '商品名', '品名', '名称', 'name', 'item', 'product'] },
  { key: 'unit',      label: '単位',     color: '#7c3aed', weak: '#f5f3ff', hints: ['単位', 'unit'] },
  { key: 'price',     label: '単価',     color: '#059669', weak: '#ecfdf5',
    hints: ['単価', '価格', '金額', '原価', 'price', 'cost'] },
  { key: 'category',  label: 'カテゴリ', color: '#d97706', weak: '#fffbeb',
    hints: ['カテゴリ', '分類', '種別', 'ジャンル', 'category'] },
  { key: 'code',      label: '商品コード', color: '#0891b2', weak: '#ecfeff',
    hints: ['商品コード', 'コード', 'jan', 'ean', '品番', 'code'] },
  { key: 'lotSize',   label: '入数',     color: '#4b5563', weak: '#f8fafc',
    hints: ['入数', '入り数', 'ロット', 'lot', 'pack'] },
  { key: 'prevMonth', label: '前月実績', color: '#9333ea', weak: '#faf5ff',
    hints: ['前月実績', '前月', '先月', 'prev'] },
  { key: 'axisA',     label: props.axisNames?.[0] || '並び替え①（場所など）', color: '#db2777', weak: '#fdf2f8',
    hints: [props.axisNames?.[0], '保管場所', '場所', 'ロケーション', '棚', 'location'].filter(Boolean) },
  { key: 'axisB',     label: props.axisNames?.[1] || '並び替え②（仕入先など）', color: '#0d9488', weak: '#f0fdfa',
    hints: [props.axisNames?.[1], '仕入先', '業者', '取引先', 'supplier', 'vendor'].filter(Boolean) },
])
const fieldOf = (k) => FIELDS.value.find(f => f.key === k)

// ── 状態 ────────────────────────────────────────────────────
// headerRow  … データが始まる直前の行（records の位置）。-1 = 1行目からデータ
// headerNamed… その行を列名として使うか
const headerRow   = ref(null)      // null = まだ答えていない（推測で埋めない）
const headerNamed = ref(false)
const mapping     = reactive({})
const manual      = reactive({})   // 手で置いた対応（見出しの解釈が変わっても残す）
const pickCol     = ref(null)      // いま項目を選ばせている列
const replacing   = ref(null)      // 「この項目に入れ直す」で待っている項目
const recipe      = ref(null)      // 当たった保存済みレシピ
const previewOpen = ref(false)
const previewMode = ref('build')   // 'build' 組み上がり（自動で閉じる）/ 'stay' 居座る

const colCount = computed(() => records.reduce((n, r) => Math.max(n, r.cols.length), 0))
const headerCols = computed(() =>
  headerNamed.value && headerRow.value >= 0 ? (records[headerRow.value]?.cols ?? []) : [])
const headerName = (i) => (headerCols.value[i] ?? '').trim() || `列${i + 1}`
const dataRows = computed(() => records.slice((headerRow.value ?? -1) + 1))
const has = (k) => mapping[k] !== null && mapping[k] !== undefined

/** 見出しの名前から列を当てる。**見出しがあると分かっているときだけ**使う。 */
function autoDetect() {
  for (const f of FIELDS.value) {
    if (manual[f.key]) continue          // 手で置いたものは上書きしない
    let hit = null
    headerCols.value.forEach((h, i) => {
      if (hit === null && headerMatches(h, f.hints)) hit = i
    })
    mapping[f.key] = hit
  }
}

// ── レシピ（保存した読み方）─────────────────────────────────
// 同じ帳票は毎月同じ形で来る。2回目以降に答えることは本来1つも無い。
const fpNoHead = computed(() => fingerprintTable(records, -1))
function tryRecipe() {
  if (parseError || !records.length) return
  // 見出しのある形／無い形の両方で照合する（どちらで保存したかは人が覚えていない）
  for (let r = 0; r < Math.min(records.length, 12); r++) {
    const hit = matchRecipe(fingerprintTable(records, r))
    if (hit) { applyRecipe(hit, r); return }
  }
  const hit = matchRecipe(fpNoHead.value)
  if (hit) applyRecipe(hit, -1)
}
function applyRecipe(rec, row) {
  recipe.value       = rec
  headerRow.value    = rec.headerRow ?? row
  headerNamed.value  = rec.headerNamed ?? (row >= 0)
  const cols = applyRecipeColumns(rec, headerCols.value)
  for (const f of FIELDS.value) { mapping[f.key] = null; manual[f.key] = false }
  for (const [k, i] of Object.entries(cols)) { mapping[k] = i; manual[k] = true }
  openBuild()
}
/** 当たったレシピが違ったとき、その場で外していつもの問いに戻る */
function dropRecipe() {
  recipe.value = null
  headerRow.value = null
  headerNamed.value = false
  for (const f of FIELDS.value) { mapping[f.key] = null; manual[f.key] = false }
  previewOpen.value = false
}

// ── 問いの機械 ──────────────────────────────────────────────
// 順番は固定。ファイルの形で問いの形を変えない。
const question = computed(() => {
  if (parseError) return null
  if (headerRow.value === null) return { kind: 'headerRow' }
  if (headerRow.value === -1 && !has('name')) return { kind: 'firstItem' }
  const miss = FIELDS.value.find(f => f.required && !has(f.key))
  return miss ? { kind: 'field', field: miss } : null
})

const SCAN_ROWS = 14
/** 見出しらしい行の見当。**印を付けるためだけに使い、選択値にはしない。** */
const headerGuess = computed(() => {
  const WORDS = ['品目', '商品', '品名', '名称', '単位', '単価', '価格', '金額', '分類',
                 'カテゴリ', 'コード', '入数', '前月', 'name', 'item', 'unit', 'price', 'code']
  for (let i = 0; i < Math.min(SCAN_ROWS, records.length); i++) {
    const filled = records[i].cols.map(c => String(c ?? '').trim()).filter(Boolean)
    if (filled.length < 2) continue
    if (filled.every(c => /^[-0-9.,¥￥]+$/.test(c))) continue
    if (filled.filter(c => headerMatches(c, WORDS)).length >= 2) return i
  }
  return -1
})

function chooseHeaderRow(i) {
  headerRow.value = i
  headerNamed.value = true
  autoDetect()
  if (has('name')) openBuild()
}
function chooseNoHeader() {
  headerRow.value = -1
  headerNamed.value = false
  for (const f of FIELDS.value) if (!manual[f.key]) mapping[f.key] = null
}
/** 見出しの無いファイル。1つのセルで「品目名の列」と「データの開始行」が同時に決まる */
function chooseFirstItem(rowIdx, colIdx) {
  headerRow.value = rowIdx - 1
  headerNamed.value = false
  mapping.name = colIdx
  manual.name = true
  openBuild()
}
/**
 * 問いの面でセルを押したとき。
 * 「見出しの行」を訊いているあいだは**セルでは何もしない** ── 行そのものが答えなので、
 * ここで stopPropagation すると行のタップが届かなくなる（セルは行を覆っている）。
 */
function onPeekCell(ri, ci, ev) {
  const q = question.value
  if (!q || q.kind === 'headerRow') return
  ev.stopPropagation()
  if (q.kind === 'firstItem') chooseFirstItem(ri, ci)
  else assign(q.field.key, ci)
}
function backToHeaderRow() {
  headerRow.value = null
  headerNamed.value = false
  for (const f of FIELDS.value) { mapping[f.key] = null; manual[f.key] = false }
}

// ── マッピング面 ────────────────────────────────────────────
const byCol = computed(() => {
  const m = {}
  for (const f of FIELDS.value) if (has(f.key)) m[mapping[f.key]] = f
  return m
})
const openFields = computed(() => FIELDS.value.filter(f => !has(f.key)))
const unusedCount = computed(() =>
  Array.from({ length: colCount.value }, (_, i) => i).filter(i => !byCol.value[i]).length)

function tapColumn(i) {
  // 「この項目に入れ直す」で待っているときは、押した列をそこへ入れる
  if (replacing.value) {
    assign(replacing.value, i)
    replacing.value = null
    return
  }
  pickCol.value = pickCol.value === i ? null : i
}
function assign(fieldKey, colIdx) {
  // 同じ列を2つの項目へ同時に割り当てない（元の select と同じ制約）
  for (const f of FIELDS.value) if (f.key !== fieldKey && mapping[f.key] === colIdx) {
    mapping[f.key] = null; manual[f.key] = false
  }
  mapping[fieldKey] = colIdx
  manual[fieldKey] = true
  pickCol.value = null
  openBuild(fieldKey)
}
function unassign(fieldKey) {
  mapping[fieldKey] = null
  manual[fieldKey] = false
  pickCol.value = null
}
function pickForField(key) {
  replacing.value = replacing.value === key ? null : key
  pickCol.value = null
}

// ── 組み上がるプレビュー ────────────────────────────────────
const filledKey = ref(null)
function openBuild(key = null) {
  filledKey.value = key
  previewMode.value = 'build'
  previewOpen.value = true
}
function openStay() {
  filledKey.value = null
  previewMode.value = 'stay'
  previewOpen.value = true
}

// ── 実行 ────────────────────────────────────────────────────
const canImport = computed(() => !parseError && !question.value && has('name'))
function onImport() {
  if (!canImport.value) return
  emit('imported', {
    mapping: { ...mapping },
    csvText: props.csvText,
    headerRow: headerRow.value,
    headerNamed: headerNamed.value,
    // 保存できる形の「読み方」。取込のあと、名前を付けてレシピにできる
    recipeShape: {
      kind: 'table',
      fp: fingerprintTable(records, headerNamed.value ? headerRow.value : -1),
      headerRow: headerRow.value,
      headerNamed: headerNamed.value,
      columns: FIELDS.value.filter(f => has(f.key)).map(f => ({
        field: f.key, col: mapping[f.key],
        head: headerNamed.value ? (headerCols.value[mapping[f.key]] ?? '') : '',
      })),
    },
    matchedRecipe: recipe.value,
  })
}

// 表示する行数。縦にもスクロールできるので、足りないより多めに出す
const PEEK_N = 14
const MAP_ROWS = 40
const peekRows = computed(() => records.slice(0, PEEK_N))
const mapRows  = computed(() => dataRows.value.slice(0, MAP_ROWS))
const cellText = (cols, i) => String(cols?.[i] ?? '').trim()

// 取り込める件数の見込み（品目に見えない行は数えない）
const rowGuess = computed(() => {
  if (!has('name')) return 0
  let n = 0
  for (const r of dataRows.value) {
    const nm = cellText(r.cols, mapping.name)
    if (nm && !isMetaName(nm)) n++
  }
  return n
})

watch(headerRow, () => { if (headerNamed.value) autoDetect() })

// 照合は宣言が全部そろってから（組み上がりプレビューまで開くので）
tryRecipe()
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-sheet imp-sheet">
      <div class="sheet-handle"></div>

      <div class="imp-head">
        <div class="imp-file">
          <div class="imp-name">{{ filename || '取り込むファイル' }}</div>
          <div class="imp-sub">{{ records.length.toLocaleString() }}行</div>
        </div>
        <button class="imp-x" @click="emit('close')" aria-label="閉じる">✕</button>
      </div>

      <!-- レシピが当たったときだけ出る1行。問いを飛ばした事実を、飛ばした場所に書く -->
      <div v-if="recipe" class="imp-recipe">
        <span class="imp-recipe-t">レシピ「{{ recipe.name }}」で読みました</span>
        <button class="imp-recipe-off" @click="dropRecipe">使わない</button>
      </div>

      <div v-if="parseError" class="imp-error" role="alert">✗ {{ parseError.message }}</div>

      <!-- ① 問い。ここでは他に何も出さない -->
      <template v-else-if="question">
        <div class="imp-q">
          <template v-if="question.kind === 'headerRow'">見出しの行を選んでください</template>
          <template v-else-if="question.kind === 'firstItem'">最初の品目名を選んでください</template>
          <template v-else>どの列が「{{ question.field.label }}」ですか？</template>
        </div>

        <!-- 読み込み元のファイルそのもの。問いの真横に置く -->
        <div class="peek" :class="question.kind">
          <div class="peek-cap">ファイルの中身</div>
          <div class="peek-body">
            <div v-for="(r, ri) in peekRows" :key="ri" class="peek-row"
                 :class="{ guess: question.kind === 'headerRow' && ri === headerGuess }"
                 @click="question.kind === 'headerRow' ? chooseHeaderRow(ri) : null">
              <span class="peek-no">{{ ri + 1 }}</span>
              <span class="peek-cells">
                <span v-for="ci in colCount" :key="ci" class="peek-c"
                      :class="{ pick: question.kind !== 'headerRow' }"
                      @click="onPeekCell(ri, ci - 1, $event)">
                  {{ cellText(r.cols, ci - 1) || '　' }}
                </span>
              </span>
              <span v-if="question.kind === 'headerRow' && ri === headerGuess" class="peek-flag">これ？</span>
            </div>
          </div>
        </div>

        <p class="imp-note">
          <template v-if="question.kind === 'headerRow'">
            列の名前（品名・単価…）が並んでいる行をタップします。
          </template>
          <template v-else-if="question.kind === 'firstItem'">
            1件目の品目の名前をタップします。その列が品目名になり、そこから下がデータになります。
          </template>
          <template v-else>上の表で、その列のどこかをタップしてください。</template>
        </p>

        <button v-if="question.kind === 'headerRow'" class="imp-back" @click="chooseNoHeader">
          見出しの行はありません
        </button>
        <button v-else class="imp-back" @click="backToHeaderRow">
          {{ headerNamed ? `${headerRow + 1}行目を見出し` : `${headerRow + 2}行目からデータ` }}として読んでいます ・ 変える
        </button>
      </template>

      <!-- ② マッピング面。見ていた元データをそのまま出し続け、その上に色で対応を書く -->
      <template v-else>
        <button class="imp-back small" @click="backToHeaderRow">
          {{ headerNamed ? `${headerRow + 1}行目を見出し` : `${headerRow + 2}行目からデータ` }}として読んでいます ・ 変える
        </button>

        <div class="imp-cap">
          <span>{{ replacing ? `「${fieldOf(replacing).label}」に入れる列をタップ`
                             : pickCol !== null ? '項目を選んでください' : 'どの列が何かを決めます' }}</span>
          <span class="imp-unused">{{ unusedCount ? `使わない列 ${unusedCount}` : '全部の列を使用中' }}</span>
        </div>

        <div class="peek mapped">
          <div class="peek-body">
            <div class="peek-row peek-head">
              <span class="peek-no"></span>
              <span class="peek-cells">
                <span v-for="ci in colCount" :key="ci" class="peek-c mc"
                      :class="{ mapped: byCol[ci - 1], picking: pickCol === ci - 1 }"
                      :style="byCol[ci - 1] ? { '--fc': byCol[ci - 1].color, '--fw': byCol[ci - 1].weak } : null"
                      @click="tapColumn(ci - 1)">
                  <span class="mc-no">{{ ci }}</span>
                  <span class="mc-src">{{ headerName(ci - 1) }}</span>
                  <span class="mc-f">{{ byCol[ci - 1] ? byCol[ci - 1].label : '使わない' }}</span>
                </span>
              </span>
            </div>
            <div v-for="(r, ri) in mapRows" :key="ri" class="peek-row rest">
              <span class="peek-no">{{ ri + 1 }}</span>
              <span class="peek-cells">
                <span v-for="ci in colCount" :key="ci" class="peek-c mc"
                      :class="{ mapped: byCol[ci - 1], picking: pickCol === ci - 1 }"
                      :style="byCol[ci - 1] ? { '--fc': byCol[ci - 1].color, '--fw': byCol[ci - 1].weak } : null"
                      @click="tapColumn(ci - 1)">{{ cellText(r.cols, ci - 1) || '　' }}</span>
              </span>
            </div>
          </div>
        </div>

        <!-- 列を押したら、その場で項目を選ばせる -->
        <div v-if="pickCol !== null" class="fbar">
          <div class="fbar-t">「{{ headerName(pickCol) }}」は何の項目？</div>
          <div class="fbar-chips">
            <button v-for="f in FIELDS" :key="f.key" class="fchip"
                    :class="{ on: byCol[pickCol]?.key === f.key }"
                    :style="{ '--fc': f.color }" @click="assign(f.key, pickCol)">
              {{ f.label }}<span v-if="f.required" class="req">*</span>
            </button>
            <button class="fchip none" @click="byCol[pickCol] ? unassign(byCol[pickCol].key) : (pickCol = null)">
              使わない
            </button>
          </div>
        </div>

        <div class="todo">
          <template v-if="openFields.length">
            <span class="todo-t">まだ決まっていない</span>
            <button v-for="f in openFields" :key="f.key" class="tchip"
                    :class="{ req: f.required, waiting: replacing === f.key }"
                    :style="{ '--fc': f.color }" @click="pickForField(f.key)">{{ f.label }}</button>
          </template>
          <span v-else class="todo-ok">✓ {{ FIELDS.length }}項目ぜんぶ決まりました</span>
        </div>

        <div class="imp-foot">
          <div class="imp-count"><b>{{ rowGuess.toLocaleString() }}</b>件が入ります</div>
          <button class="imp-pv" @click="openStay">プレビュー</button>
          <button class="imp-go" :disabled="!canImport" @click="onImport">取り込む</button>
        </div>
      </template>
    </div>

    <ImportBuildPreview
      v-if="previewOpen"
      :records="records"
      :header-row="headerRow ?? -1"
      :header-named="headerNamed"
      :mapping="mapping"
      :fields="FIELDS"
      :mode="previewMode"
      :filled="filledKey"
      :title="recipe && !filledKey ? `レシピ「${recipe.name}」で読みました` : ''"
      @close="previewOpen = false"
      @stay="previewMode = 'stay'"
    />
  </div>
</template>

<style scoped>
.imp-sheet { max-height: 92vh; display: flex; flex-direction: column; padding-bottom: 0; }

.imp-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.imp-file { flex: 1; min-width: 0; }
.imp-name { font-size: 14px; font-weight: 800; color: var(--text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.imp-sub { font-size: 11.5px; color: var(--text-muted); }
.imp-x { border: 1px solid var(--border); background: var(--surface); color: var(--text-muted);
  border-radius: 8px; width: 32px; height: 32px; font-size: 14px; cursor: pointer; flex-shrink: 0; }

.imp-recipe { display: flex; align-items: center; gap: 8px; padding: 8px 10px; margin-bottom: 10px;
  background: var(--primary-weak); border: 1px solid var(--primary-border); border-radius: 10px; }
.imp-recipe-t { flex: 1; min-width: 0; font-size: 12px; font-weight: 800; color: var(--primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.imp-recipe-off { flex-shrink: 0; border: 1px solid var(--primary-border); background: var(--surface);
  color: var(--primary); font-size: 11px; font-weight: 800; border-radius: 7px; padding: 5px 9px; cursor: pointer; }

.imp-error { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c;
  border-radius: 10px; padding: 10px 12px; font-size: 13px; }

.imp-q { font-size: 17px; font-weight: 800; line-height: 1.45; margin-bottom: 10px; color: var(--text); }
.imp-note { font-size: 11.5px; color: var(--text-muted); line-height: 1.6; margin: 8px 0 10px; }
.imp-back { display: block; width: 100%; border: 1.5px solid var(--primary-border);
  background: var(--primary-weak); color: var(--primary); border-radius: 11px;
  padding: 12px; font-size: 12.5px; font-weight: 800; cursor: pointer; margin-bottom: 12px; }
.imp-back:active { transform: scale(.99); }
.imp-back.small { padding: 8px 10px; font-size: 11.5px; margin-bottom: 8px; }

/* 元データの表。列は全部出して横に流す（切り捨てると判断材料が隠れる） */
.peek { border: 1px solid var(--border); border-radius: 10px; overflow: hidden;
  background: var(--surface); flex: 1; min-height: 0; display: flex; flex-direction: column; }
.peek-cap { font-size: 10.5px; font-weight: 700; color: var(--text-muted);
  padding: 5px 9px; border-bottom: 1px solid var(--border); background: var(--bg); flex-shrink: 0; }
.peek-body { overflow: auto; -webkit-overflow-scrolling: touch;
  touch-action: pan-x pan-y; overscroll-behavior-x: contain; }
.peek-row { display: flex; align-items: stretch; border-bottom: 1px solid var(--border);
  font-size: 11.5px; position: relative; }
.peek-row:last-child { border-bottom: none; }
.peek-no { flex-shrink: 0; width: 30px; padding: 6px 4px; text-align: right;
  color: #94a3b8; font-size: 10px; background: var(--bg); position: sticky; left: 0; z-index: 1;
  border-right: 1px solid var(--border); font-variant-numeric: tabular-nums; }
.peek-cells { display: flex; }
.peek-c { flex-shrink: 0; width: 96px; padding: 6px 7px; border-right: 1px solid var(--border);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text); }
.peek-c:last-child { border-right: none; }
.peek-row.rest .peek-c { color: var(--text-muted); }

.peek.headerRow .peek-row { cursor: pointer; }
.peek.headerRow .peek-row:active { background: var(--primary-soft); }
.peek-row.guess { background: var(--primary-weak); }
.peek-flag { position: sticky; right: 4px; align-self: center; margin-left: auto;
  background: var(--primary); color: #fff; font-size: 9.5px; font-weight: 800;
  border-radius: 5px; padding: 2px 6px; flex-shrink: 0; }
.peek-c.pick { cursor: pointer; }
.peek-c.pick:active { background: var(--primary-soft); }

/* マッピング面。元データの上に、どの列が何かを色で書く */
.peek-head { position: sticky; top: 0; z-index: 2; background: var(--surface); }
.peek-c.mc { cursor: pointer; }
.peek-head .peek-c.mc { display: flex; flex-direction: column; gap: 1px; padding: 5px 7px;
  background: var(--bg); border-bottom: 1px solid var(--border); }
.mc-no { font-size: 9px; color: #94a3b8; font-variant-numeric: tabular-nums; }
.mc-src { font-size: 11px; font-weight: 700; color: var(--text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mc-f { font-size: 10px; font-weight: 800; color: #94a3b8;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.peek-c.mc.mapped { background: var(--fw); box-shadow: inset 0 -2px 0 var(--fc); }
.peek-head .peek-c.mc.mapped .mc-f { color: var(--fc); }
.peek-c.mc.picking { outline: 2px solid var(--primary); outline-offset: -2px; }

.imp-cap { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
.imp-cap > span:first-child { font-size: 12.5px; font-weight: 800; color: var(--text); }
.imp-unused { margin-left: auto; font-size: 10.5px; color: var(--text-muted); }

.fbar { border: 1px solid var(--primary-border); background: var(--primary-weak);
  border-radius: 10px; padding: 8px 10px; margin-top: 8px; }
.fbar-t { font-size: 11.5px; font-weight: 800; color: var(--primary); margin-bottom: 6px; }
.fbar-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.fchip { border: 1.5px solid var(--fc); background: var(--surface); color: var(--fc);
  border-radius: 8px; padding: 6px 9px; font-size: 11.5px; font-weight: 800; cursor: pointer; }
.fchip.on { background: var(--fc); color: #fff; }
.fchip .req { color: var(--danger); margin-left: 1px; }
.fchip.none { border-color: var(--border); color: var(--text-muted); }

.todo { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 8px; }
.todo-t { font-size: 10.5px; color: var(--text-muted); }
.tchip { border: 1px dashed var(--fc); background: var(--surface); color: var(--fc);
  border-radius: 7px; padding: 4px 8px; font-size: 11px; font-weight: 700; cursor: pointer; }
.tchip.req { border-style: solid; font-weight: 800; }
.tchip.waiting { background: var(--fc); color: #fff; }
.todo-ok { font-size: 11.5px; font-weight: 800; color: var(--success); }

.imp-foot { display: flex; align-items: center; gap: 8px; padding: 10px 0 calc(10px + env(safe-area-inset-bottom));
  margin-top: 8px; border-top: 1px solid var(--border); flex-shrink: 0; }
.imp-count { flex: 1; font-size: 12px; color: var(--text-muted); }
.imp-count b { font-size: 15px; color: var(--text); font-variant-numeric: tabular-nums; }
.imp-pv { border: 1.5px solid var(--border); background: var(--surface); color: var(--text);
  border-radius: 10px; padding: 10px 12px; font-size: 12.5px; font-weight: 800; cursor: pointer; }
.imp-go { border: none; background: var(--primary); color: #fff; border-radius: 10px;
  padding: 10px 16px; font-size: 13px; font-weight: 800; cursor: pointer; }
.imp-go:disabled { background: #cbd5e1; cursor: not-allowed; }
</style>
