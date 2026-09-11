<script setup>
/**
 * PDFを「表」に均してから、CSV・Excel と同じ列指定画面（`ImportMapper`）へ渡す。
 *
 * **一度で正しく組み上がる前提を置かない。** 専用の解析を持つ帳票（棚卸記入表）は
 * ごく一部で、普通は初めて見る紙が来る。座標だけで組んだ表は、行が割れたり
 * 列がずれたりする。だからここでは組み上がった表をそのまま見せて、
 * その場で直せるようにする。
 *
 * 直せるのは**値ではなく読み方**（段の数・行の高さ・列の境界）。値を書き換える
 * 直し方はその場しか直らないが、読み方なら**同じ紙なら翌月も同じように効く**ので、
 * そのままレシピとして残せる（`ImportMapper` の列の対応づけと1本にまとまる）。
 */
import { ref, computed } from 'vue'
import { detectSectionCount } from '../utils/pdfTableParser.js'
import { pdfPagesToTable, rowsToCsv, suggestEdge } from '../utils/pdfGrid.js'
import { useEscapeKey } from '../composables/useEscapeKey.js'
import PdfPageViewer from './PdfPageViewer.vue'

const props = defineProps({
  file:    { type: Object, default: null },      // File（PDF本体・実物の表示用）
  pages:   { type: Array,  default: () => [] },  // parsePdfFile が返すページ（生座標＋rotate）
  initial: { type: Object, default: null },      // 当たったレシピの作り方（あれば問いを飛ばす）
})
const emit = defineEmits(['close', 'ready', 'manual'])

// 行の高さの段階。文字の高さに対する倍率で持つので、紙が変わっても同じ手応えになる
const ROW_STEPS = [0.25, 0.35, 0.5, 0.7, 1.0, 1.4]
const PREVIEW_ROWS = 30

const sections  = ref(props.initial?.sections ?? null)
const rowStep   = ref(Math.max(0, ROW_STEPS.indexOf(props.initial?.rowFactor ?? 0.5)))
const edges     = ref(props.initial?.edges ?? null)   // null = 自動のまま
const guess     = ref(0)
const pdfOpen   = ref(false)

useEscapeKey(() => {
  if (pdfOpen.value) pdfOpen.value = false
  else if (sections.value !== null && !props.initial) sections.value = null
  else emit('close')
})

function onLoaded({ readingPages }) {
  guess.value = detectSectionCount(readingPages?.[0]?.tokens ?? [])
}

const rowFactor = computed(() => ROW_STEPS[rowStep.value] ?? 0.5)
const build = computed(() => sections.value === null
  ? { rows: [], edges: [] }
  : pdfPagesToTable(props.pages, { sections: sections.value, rowFactor: rowFactor.value, edges: edges.value }))

const rows     = computed(() => build.value.rows)
const colCount = computed(() => rows.value.reduce((n, r) => Math.max(n, r.length), 0))
const preview  = computed(() => rows.value.slice(0, PREVIEW_ROWS))
const cell     = (r, i) => r[i] ?? ''

// 直した内容は「自動で決まった境界」から始める。触るまでは自動のまま任せる
function currentEdges() { return edges.value ?? [...build.value.edges] }

/** 左の列と合わせる（境界を1本消す） */
function mergeLeft(i) {
  if (i <= 0) return
  const next = currentEdges()
  next.splice(i - 1, 1)
  edges.value = next
  picked.value = null
}
/** この列を分ける（紙の上でいちばん広く空いているところに境界を足す） */
function splitCol(i) {
  const cur = currentEdges()
  const at = suggestEdge(props.pages, { sections: sections.value, rowFactor: rowFactor.value, edges: cur }, i)
  if (at === null) return
  edges.value = [...cur, at].sort((a, b) => a - b)
  picked.value = null
}
const canSplit = (i) => sections.value !== null &&
  suggestEdge(props.pages, { sections: sections.value, rowFactor: rowFactor.value, edges: currentEdges() }, i) !== null

function resetEdges() { edges.value = null; picked.value = null }

const picked = ref(null)      // いま操作している列
function tapCol(i) { picked.value = picked.value === i ? null : i }

function chooseSections(n) {
  sections.value = n
  edges.value = null
  picked.value = null
}

const canGo = computed(() => rows.value.length >= 2 && colCount.value >= 2)

function onGo() {
  if (!canGo.value) return
  emit('ready', {
    csvText: rowsToCsv(rows.value),
    // 「この表の作り方」。そのままレシピへ入り、次に同じ紙が来たら問いが出ない
    grid: { sections: sections.value, rowFactor: rowFactor.value, edges: build.value.edges },
  })
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-sheet grid-sheet">
      <div class="sheet-handle"></div>
      <div class="sheet-head">
        <div class="sheet-title">PDFを表にして読み取る</div>
        <button class="gs-x" @click="emit('close')" aria-label="閉じる">✕</button>
      </div>

      <!-- ① 段の数。読んだ後では「右半分が無いこと」に気づけないので、紙を見せながら先に訊く -->
      <template v-if="sections === null">
        <div class="gs-q">この紙、表は何枚ありますか？</div>
        <p class="gs-note">
          同じ形の表が横に並んでいる数です。下の紙を見て選んでください。
          <template v-if="guess >= 1">読み取りでは<b>{{ guess }}枚</b>と見えています。</template>
          少なく選ぶと、その分の品目は取り込まれません。
        </p>
        <div class="gs-pick">
          <button v-for="n in 4" :key="n" class="gs-btn" :class="{ det: n === guess }" @click="chooseSections(n)">
            <span class="gs-n">{{ n }}</span>
            <span class="gs-l">{{ n }}枚</span>
            <span v-if="n === guess" class="gs-tag">自動判定</span>
          </button>
        </div>
        <PdfPageViewer :file="file" @loaded="onLoaded" />
        <p class="gs-after">選んだあと、組み上がった表をこの画面で直せます。</p>
      </template>

      <!-- ② 組み上がった表。ずれていたらここで直す -->
      <template v-else>
        <div class="gs-bar">
          <button class="gs-back" @click="sections = null">{{ sections }}枚の表 ・ 変える</button>
          <button class="gs-back" @click="pdfOpen = true">📄 元のPDF</button>
        </div>

        <p class="gs-guide">
          この表のまま取り込みます。<b>ずれていたら下のボタンで直してください。</b>
          直した内容は「読み方」として次回にも効きます。
        </p>

        <div v-if="!canGo" class="gs-error" role="alert">
          ✗ この紙からは表を組み立てられませんでした。行の高さを変えるか、「紙の上で直接指定する」へ。
        </div>

        <!-- 行の高さ -->
        <div class="gs-tool">
          <span class="gs-tool-t">行</span>
          <button class="gs-tool-b" :disabled="rowStep <= 0" @click="rowStep--">1行が2行に割れている</button>
          <button class="gs-tool-b" :disabled="rowStep >= ROW_STEPS.length - 1" @click="rowStep++">2行が1行にくっついている</button>
        </div>

        <!-- 表 -->
        <div class="gs-table-wrap">
          <table class="gs-table">
            <thead>
              <tr>
                <th class="gs-no"></th>
                <th v-for="i in colCount" :key="i" :class="{ on: picked === i - 1 }" @click="tapCol(i - 1)">
                  <span class="gs-cn">{{ i }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, ri) in preview" :key="ri">
                <td class="gs-no">{{ ri + 1 }}</td>
                <td v-for="i in colCount" :key="i" :class="{ on: picked === i - 1 }" @click="tapCol(i - 1)">
                  {{ cell(r, i - 1) || '　' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="gs-count">
          全 {{ rows.length.toLocaleString() }}行 / {{ colCount }}列
          <span v-if="rows.length > PREVIEW_ROWS">（先頭{{ PREVIEW_ROWS }}行を表示）</span>
          <button v-if="edges" class="gs-reset" @click="resetEdges">列の直しを取り消す</button>
        </div>

        <!-- 列の直し -->
        <div v-if="picked !== null" class="gs-colbar">
          <div class="gs-colbar-t">{{ picked + 1 }}列目</div>
          <button class="gs-colb" :disabled="picked === 0" @click="mergeLeft(picked)">← 左の列と合わせる</button>
          <button class="gs-colb" :disabled="!canSplit(picked)" @click="splitCol(picked)">ここで2つに分ける</button>
        </div>
        <p v-else class="gs-hint">列がずれているときは、その列をタップして「合わせる／分ける」。</p>

        <div class="actions">
          <button class="btn btn-secondary" @click="emit('manual')">紙の上で直接指定する</button>
          <button class="btn btn-primary" :disabled="!canGo" @click="onGo">この表で進む</button>
        </div>
      </template>
    </div>

    <div v-if="pdfOpen" class="gs-pdfview" @click.self="pdfOpen = false">
      <div class="gs-pdfsheet">
        <div class="sheet-head">
          <div class="sheet-title">元のPDF</div>
          <button class="gs-x" @click="pdfOpen = false" aria-label="閉じる">✕</button>
        </div>
        <PdfPageViewer :file="file" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.grid-sheet { max-height: 94vh; overflow-y: auto; }
.sheet-head { display: flex; align-items: center; gap: 8px; }
.sheet-head .sheet-title { flex: 1; min-width: 0; }
.gs-x { border: 1px solid var(--border); background: var(--surface); color: var(--text-muted);
  border-radius: 8px; width: 32px; height: 32px; font-size: 14px; cursor: pointer; flex-shrink: 0; }

.gs-q { font-size: 17px; font-weight: 800; line-height: 1.45; color: var(--text); margin-bottom: 6px; }
.gs-note { font-size: 11.5px; line-height: 1.6; color: var(--text-muted); margin: 0 0 10px; }
.gs-note b { color: var(--primary); }
.gs-pick { display: flex; gap: 8px; margin-bottom: 12px; }
.gs-btn { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px;
  border: 1.5px solid var(--border); background: var(--surface); border-radius: 12px;
  padding: 10px 4px; cursor: pointer; position: relative; }
.gs-btn:active { transform: scale(.98); }
.gs-btn.det { border-color: var(--primary); background: var(--primary-weak); }
.gs-n { font-size: 20px; font-weight: 800; color: var(--text); font-variant-numeric: tabular-nums; }
.gs-l { font-size: 10.5px; color: var(--text-muted); }
.gs-tag { position: absolute; top: -8px; left: 50%; transform: translateX(-50%);
  background: var(--primary); color: #fff; font-size: 9px; font-weight: 800;
  border-radius: 5px; padding: 1px 6px; white-space: nowrap; }
.gs-after { font-size: 11.5px; line-height: 1.6; color: var(--text-muted); margin: 10px 0 0; }

.gs-bar { display: flex; gap: 8px; margin: 8px 0; }
.gs-back { flex: 1; border: 1.5px solid var(--primary-border); background: var(--surface);
  color: var(--primary); border-radius: 10px; padding: 9px; font-size: 11.5px; font-weight: 800; cursor: pointer; }
.gs-guide { font-size: 12.5px; line-height: 1.55; color: var(--text); background: var(--primary-weak);
  border: 1px solid var(--primary-border); border-radius: 9px; padding: 8px 10px; margin: 0 0 8px; }
.gs-guide b { color: var(--primary); }
.gs-error { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c;
  border-radius: 10px; padding: 9px 11px; font-size: 12.5px; margin-bottom: 8px; }

.gs-tool { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.gs-tool-t { font-size: 11.5px; font-weight: 800; color: var(--text-muted); flex-shrink: 0; }
.gs-tool-b { flex: 1; border: 1px solid var(--border); background: var(--surface); color: var(--text);
  border-radius: 9px; padding: 8px 6px; font-size: 11px; font-weight: 700; cursor: pointer; }
.gs-tool-b:disabled { opacity: .35; cursor: not-allowed; }

.gs-table-wrap { border: 1px solid var(--border); border-radius: 10px; overflow: auto;
  max-height: 46vh; -webkit-overflow-scrolling: touch; }
.gs-table { border-collapse: collapse; font-size: 11.5px; white-space: nowrap; }
.gs-table th, .gs-table td { border: 1px solid var(--border); padding: 4px 7px; text-align: left;
  max-width: 190px; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.gs-table th { position: sticky; top: 0; background: var(--surface); z-index: 1; }
.gs-table th.on, .gs-table td.on { background: var(--primary-weak); }
.gs-table th.on { border-color: var(--primary); }
.gs-cn { font-size: 10.5px; font-weight: 800; color: var(--text-muted); }
.gs-no { width: 30px; color: var(--text-muted); text-align: right; background: var(--surface); cursor: default; }

.gs-count { display: flex; align-items: center; gap: 8px; font-size: 11px;
  color: var(--text-muted); margin: 6px 0 8px; }
.gs-reset { margin-left: auto; border: none; background: none; color: var(--danger);
  font-size: 11px; cursor: pointer; }

.gs-colbar { position: sticky; bottom: 0; display: flex; align-items: center; gap: 6px;
  background: var(--surface); border: 1.5px solid var(--primary); border-radius: 10px;
  padding: 8px 10px; margin-bottom: 10px; box-shadow: 0 -4px 14px rgba(0,0,0,0.08); }
.gs-colbar-t { font-size: 11.5px; font-weight: 800; color: var(--primary); flex-shrink: 0; }
.gs-colb { flex: 1; border: 1px solid var(--border); background: #fff; color: var(--text);
  border-radius: 9px; padding: 8px 6px; font-size: 11px; font-weight: 700; cursor: pointer; }
.gs-colb:disabled { opacity: .35; cursor: not-allowed; }
.gs-hint { font-size: 11px; line-height: 1.6; color: var(--text-muted); margin: 0 0 10px; }

.actions { display: flex; gap: 10px; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }

.gs-pdfview { position: fixed; inset: 0; z-index: 60; background: rgba(15, 23, 42, 0.55);
  display: flex; align-items: center; justify-content: center; padding: 12px; }
.gs-pdfsheet { background: var(--surface); border-radius: 14px; padding: 12px;
  width: 100%; max-width: 720px; max-height: 90vh; overflow-y: auto; }
</style>
