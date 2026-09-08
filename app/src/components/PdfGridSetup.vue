<script setup>
/**
 * PDFを「表」に均してから、CSV・Excel と同じ列指定画面（`ImportMapper`）へ渡す。
 *
 * ここで人に訊くことは**1つだけ** ── この紙に同じ形の表が何枚並んでいるか。
 * 少なく答えると、その分の品目はまるごと落ちる。読んだ後では「無いこと」に
 * 気づけないので、紙を見せながら先に確かめる。列がどれかは、このあと
 * いつもの画面で決める（PDFだけ違う操作を覚えなくていい）。
 */
import { ref, computed } from 'vue'
import { detectSectionCount } from '../utils/pdfTableParser.js'
import { pdfPagesToRows, rowsToCsv } from '../utils/pdfGrid.js'
import { useEscapeKey } from '../composables/useEscapeKey.js'
import PdfPageViewer from './PdfPageViewer.vue'

const props = defineProps({
  file:  { type: Object, default: null },      // File（PDF本体・実物の表示用）
  pages: { type: Array,  default: () => [] },  // parsePdfFile が返すページ（生座標＋rotate）
})
const emit = defineEmits(['close', 'ready', 'manual'])
useEscapeKey(() => emit('close'))

const guess    = ref(0)     // 紙から見えた段の数。**訊くための材料**で、決める値ではない
const errorMsg = ref('')

function onLoaded({ readingPages }) {
  guess.value = detectSectionCount(readingPages?.[0]?.tokens ?? [])
}

const rows = ref([])
const sections = ref(null)

function choose(n) {
  sections.value = n
  errorMsg.value = ''
  rows.value = pdfPagesToRows(props.pages, { sections: n })
  if (rows.value.length < 2) {
    errorMsg.value = 'この紙からは表を組み立てられませんでした。紙の上で直接指定してください。'
    return
  }
  emit('ready', {
    sections: n,
    rows: rows.value,
    csvText: rowsToCsv(rows.value),
  })
}

const label = computed(() => (n) => (n === 1 ? '1枚' : `${n}枚`))
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-sheet grid-sheet">
      <div class="sheet-handle"></div>
      <div class="sheet-title">PDFを表にして読み取る</div>

      <div class="gs-q">この紙、表は何枚ありますか？</div>
      <p class="gs-note">
        同じ形の表が横に並んでいる数です。下の紙を見て選んでください。
        <template v-if="guess >= 1">読み取りでは<b>{{ guess }}枚</b>と見えています。</template>
        少なく選ぶと、その分の品目は取り込まれません。
      </p>
      <div class="gs-pick">
        <button v-for="n in 4" :key="n" class="gs-btn"
                :class="{ det: n === guess, on: sections === n }" @click="choose(n)">
          <span class="gs-n">{{ n }}</span>
          <span class="gs-l">{{ label(n) }}</span>
          <span v-if="n === guess" class="gs-tag">自動判定</span>
        </button>
      </div>

      <div v-if="errorMsg" class="gs-error" role="alert">✗ {{ errorMsg }}</div>

      <PdfPageViewer :file="file" @loaded="onLoaded" />

      <p class="gs-after">選ぶと、CSV・Excel と同じ画面で「どの列が何か」を決めます。元のPDFはその画面からも見られます。</p>

      <div class="actions">
        <button class="btn btn-secondary" @click="emit('close')">キャンセル</button>
        <button class="btn btn-secondary" @click="emit('manual')">紙の上で直接指定する</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.grid-sheet { max-height: 94vh; overflow-y: auto; }
.gs-q { font-size: 17px; font-weight: 800; line-height: 1.45; color: var(--text); margin-bottom: 6px; }
.gs-note { font-size: 11.5px; line-height: 1.6; color: var(--text-muted); margin: 0 0 10px; }
.gs-note b { color: var(--primary); }
.gs-pick { display: flex; gap: 8px; margin-bottom: 12px; }
.gs-btn { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px;
  border: 1.5px solid var(--border); background: var(--surface); border-radius: 12px;
  padding: 10px 4px; cursor: pointer; position: relative; }
.gs-btn:active { transform: scale(.98); }
.gs-btn.det { border-color: var(--primary); background: var(--primary-weak); }
.gs-btn.on { border-color: var(--primary); box-shadow: 0 0 0 2px var(--primary-border); }
.gs-n { font-size: 20px; font-weight: 800; color: var(--text); font-variant-numeric: tabular-nums; }
.gs-l { font-size: 10.5px; color: var(--text-muted); }
.gs-tag { position: absolute; top: -8px; left: 50%; transform: translateX(-50%);
  background: var(--primary); color: #fff; font-size: 9px; font-weight: 800;
  border-radius: 5px; padding: 1px 6px; white-space: nowrap; }
.gs-error { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c;
  border-radius: 10px; padding: 9px 11px; font-size: 12.5px; margin-bottom: 10px; }
.gs-after { font-size: 11.5px; line-height: 1.6; color: var(--text-muted); margin: 10px 0; }
.actions { display: flex; gap: 10px; }
</style>
