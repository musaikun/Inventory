<script setup>
/**
 * PDFを「表」に均してから、CSV・Excel と同じ列指定画面（`ImportMapper`）へ渡す。
 *
 * **一度で正しく組み上がる前提を置かない。** 専用の解析を持つ帳票（棚卸記入表）は
 * ごく一部で、普通は初めて見る紙が来る。座標だけで組んだ表は、行が割れたり
 * 列がずれたりする。だからここでは組み上がった表をそのまま見せて、
 * その場で直せるようにする。
 *
 * 直せるのは**値ではなく読み方**（枚数・割り方・行の高さ・列の境界）。値を書き換える
 * 直し方はその場しか直らないが、読み方なら**同じ紙なら翌月も同じように効く**ので、
 * そのままレシピとして残せる（`ImportMapper` の列の対応づけと1本にまとまる）。
 *
 * ## 進み方
 *
 * 下の **戻る / 次へ** だけで進む。以前は枚数のボタンを押すこと自体が「次へ」だったが、
 * 自動判定が選択済みに見えるため、**すでに選ばれているものをもう一度押さないと進めない**
 * という状態になっていた。押す＝選ぶ、進む＝次へ、に分ける。
 */
import { ref, computed, watch, nextTick } from 'vue'
import { pdfPagesToTable, rowsToCsv, suggestEdge, planLayout, detectLayout, pageHeads,
         oddRowIndexes, GRID_MAX } from '../utils/pdfGrid.js'
import { useEscapeKey } from '../composables/useEscapeKey.js'
import PdfPageViewer from './PdfPageViewer.vue'

const props = defineProps({
  file:    { type: Object, default: null },      // File（PDF本体・実物の表示用）
  pages:   { type: Array,  default: () => [] },  // parsePdfFile が返すページ（生座標＋rotate）
  initial: { type: Object, default: null },      // 当たったレシピの作り方（あれば問いを飛ばす）
})
const emit = defineEmits(['close', 'ready'])

// 行の高さの段階。文字の高さに対する倍率で持つので、紙が変わっても同じ手応えになる
const ROW_STEPS = [0.25, 0.35, 0.5, 0.7, 1.0, 1.4]

// 段階。1 = 枚数と割り方 / 2 = 組み上がった表の直し
const step = ref(props.initial ? 2 : 1)

const count   = ref(sizeOf(layoutOf(props.initial)))
const pickIdx = ref(0)        // 候補のどれを使っているか（図をタップで次へ）
const rowStep = ref(Math.max(0, ROW_STEPS.indexOf(props.initial?.rowFactor ?? 0.5)))
const edges   = ref(props.initial?.edges ?? null)   // null = 自動のまま
const heads   = ref((props.initial?.heads ?? []).map(h => ({ x: h.x, y: h.y })))
const byPos   = ref(!!props.initial?.byPosition)   // セルを紙の上の位置で列へ入れる
const oddOnly = ref(false)                          // そろっていない行だけを見る
const detected = ref(null)    // 紙から見当てた割り方（当たれば人は数えなくていい）
const pdfOpen  = ref(false)
const countEl  = ref(null)

function layoutOf(grid) {
  if (!grid) return null
  if (grid.layout?.cols) return { cols: grid.layout.cols, rows: grid.layout.rows ?? 1 }
  if (grid.sections) return { cols: grid.sections, rows: 1 }
  return null
}
function sizeOf(l) { return Math.max(1, (l?.cols ?? 1) * (l?.rows ?? 1)) }

useEscapeKey(() => {
  if (pdfOpen.value) pdfOpen.value = false
  else if (step.value > 1 && !props.initial) back()
  else emit('close')
})

// 枚数に対する割り方の候補。並びは「紙に合っていそうな順」
const plan = computed(() => planLayout(props.pages, count.value))
const cands = computed(() => plan.value.candidates)
const layout = computed(() => {
  // レシピの割り方は、候補の順番より優先する（覚えた読み方をこちらで上書きしない）
  const fromRecipe = props.initial && pickIdx.value === 0 ? layoutOf(props.initial) : null
  if (fromRecipe && sizeOf(fromRecipe) === count.value) return fromRecipe
  const c = cands.value[pickIdx.value % Math.max(1, cands.value.length)]
  return c ? { cols: c.cols, rows: c.rows } : { cols: 1, rows: 1 }
})

/** PDFが開けたら、枚数と割り方を見当てて選択済みにしておく */
function onLoaded({ readingPages }) {
  if (props.initial) return
  const d = detectLayout((readingPages ?? []).map(p => ({ tokens: p.tokens, rotate: 0 })))
  detected.value = d
  if (d) { count.value = d.count; pickIdx.value = 0 }
  scrollCountIntoView()
}

// 9枚の紙で「選択済みの9が画面の外」だと、いま直そうとしている混乱そのものになる
function scrollCountIntoView() {
  nextTick(() => {
    const el = countEl.value?.querySelector('.gs-num.on')
    el?.scrollIntoView?.({ block: 'nearest', inline: 'center' })
  })
}
function pickCount(n) {
  if (count.value === n) return
  count.value = n
  pickIdx.value = 0
  edges.value = null
  picked.value = null
}
/** 自動の割り方が違ったときの逃げ道。候補を順に切り替える */
function cycleLayout() {
  if (cands.value.length < 2) return
  pickIdx.value = (pickIdx.value + 1) % cands.value.length
  edges.value = null
  picked.value = null
}

const rowFactor = computed(() => ROW_STEPS[rowStep.value] ?? 0.5)

/**
 * 紙の見出し帯（表の1行目より上）の語。
 *
 * 「○○店　○月　冷凍」のように、**そのページの品目ぜんぶに効く情報が1ヵ所だけ**
 * 書かれていることがある。品目の行には無いので、表にするだけでは落ちる。
 * ここをタップして列に変えてしまえば、以降はCSVとまったく同じに扱える。
 */
const headCands = computed(() => (pageHeads(props.pages, { rowFactor: rowFactor.value })[0] ?? []))
const headOn = (t) => heads.value.some(h => h.x === t.x && h.y === t.y)
function toggleHead(t) {
  heads.value = headOn(t)
    ? heads.value.filter(h => !(h.x === t.x && h.y === t.y))
    : [...heads.value, { x: t.x, y: t.y }]
  picked.value = null
}

const build = computed(() => (step.value < 2
  ? { rows: [], edges: [] }
  : pdfPagesToTable(props.pages, {
      layout: layout.value, rowFactor: rowFactor.value, edges: edges.value,
      heads: heads.value, byPosition: byPos.value,
    })))

const rows     = computed(() => build.value.rows)
const colCount = computed(() => rows.value.reduce((n, r) => Math.max(n, r.length), 0))
const cell     = (r, i) => r[i] ?? ''

/**
 * そろっていない行。ずれを目で探させないための印。
 *
 * 先頭の数十行だけ見せていたときは、**後ろのページでずれていても気づけなかった**
 * （紙は何ページもあるのに、確かめられるのは1ページ目だけだった）。全行出したうえで、
 * あやしい行に印を付け、そこだけ見られるようにする。
 */
const oddSet = computed(() => new Set(oddRowIndexes(rows.value, { ignoreRight: heads.value.length })))
const isOdd  = (i) => oddSet.value.has(i)

// 表に出す行。番号は「全体の何行目か」を持ったまま絞る（絞ってから探せる）
const shown = computed(() => {
  const all = rows.value.map((r, i) => ({ r, i }))
  return oddOnly.value ? all.filter(x => oddSet.value.has(x.i)) : all
})

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
  const at = suggestEdge(props.pages, { layout: layout.value, rowFactor: rowFactor.value, edges: cur }, i)
  if (at === null) return
  edges.value = [...cur, at].sort((a, b) => a - b)
  picked.value = null
}
const canSplit = (i) => step.value >= 2 &&
  suggestEdge(props.pages, { layout: layout.value, rowFactor: rowFactor.value, edges: currentEdges() }, i) !== null

function resetEdges() { edges.value = null; picked.value = null }

const paperCols = computed(() => Math.max(0, colCount.value - heads.value.length))

const picked = ref(null)      // いま操作している列
function tapCol(i) {
  // 見出しから足した列は紙の上に境界が無いので、合わせる・分けるができない
  if (i >= paperCols.value) return
  picked.value = picked.value === i ? null : i
}

/* ---------------- 下の 戻る / 次へ ---------------- */

const canGo = computed(() => rows.value.length >= 2 && colCount.value >= 2)
// 次へが押せない理由は、押せないボタンの隣に出す（押せないだけだと手が止まる）
const blockedWhy = computed(() => {
  if (step.value < 2 || canGo.value) return ''
  if (!rows.value.length) return 'この紙からは表を組み立てられませんでした'
  return '列が1本しかありません'
})
const nextLabel = computed(() => (step.value < 2 ? '次へ' : 'この表で進む'))
const backLabel = computed(() => (step.value > 1 && !props.initial ? '戻る' : 'やめる'))

function back() {
  if (step.value > 1 && !props.initial) { step.value--; picked.value = null; scrollCountIntoView() }
  else emit('close')
}
function next() {
  if (step.value < 2) { step.value = 2; picked.value = null; return }
  if (!canGo.value) return
  emit('ready', {
    csvText: rowsToCsv(rows.value),
    // 「この表の作り方」。そのままレシピへ入り、次に同じ紙が来たら問いが出ない。
    // sections も残すのは、layout を知らない古い読み手のため（横の段の数）
    grid: {
      layout: { ...layout.value }, sections: layout.value.cols,
      rowFactor: rowFactor.value, edges: build.value.edges,
      // 値ではなく**位置**を残す。「○月」は翌月変わるので、毎回そこから読む
      heads: heads.value.map(h => ({ ...h })),
      byPosition: byPos.value,
    },
  })
}

// 枚数や割り方を変えたら、表はその場で組み直る（段階を戻らなくても結果が見える）
watch([count, pickIdx], () => { if (step.value >= 2) picked.value = null })
watch([byPos, rowStep, edges], () => { oddOnly.value = false; picked.value = null })
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-sheet grid-sheet">
      <div class="sheet-handle"></div>
      <div class="sheet-head">
        <div class="sheet-title">PDFを表にして読み取る</div>
        <button class="gs-x" @click="emit('close')" aria-label="閉じる">✕</button>
      </div>

      <div class="gs-body">
        <!-- ① 枚数。読んだ後では「右半分が無いこと」に気づけないので、紙を見せながら先に訊く -->
        <template v-if="step === 1">
          <div class="gs-q">1ページの中に、同じ形の表がいくつありますか？</div>
          <p class="gs-note">
            <b>PDFのページ数ではありません。</b>1枚の紙の中に、同じ形の表が何個刷られているかです。
            縦に並んでいても横に並んでいても、数だけ答えてください。
            少なく選ぶと、その分の品目は取り込まれません。
          </p>

          <div class="gs-nums" ref="countEl">
            <button v-for="n in GRID_MAX" :key="n" class="gs-num" :class="{ on: count === n }"
                    :aria-pressed="count === n" @click="pickCount(n)">
              <span class="gs-num-n">{{ n }}</span>
              <span class="gs-num-l">個</span>
            </button>
          </div>

          <!-- 図は「選択肢」ではなく「こう割った」という返事。違えばタップで次の候補へ -->
          <button class="gs-fig" :class="{ tappable: cands.length > 1 }"
                  :disabled="cands.length < 2" @click="cycleLayout">
            <span class="gs-fig-box"
                  :style="{ gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
                            gridTemplateRows: `repeat(${layout.rows}, 1fr)` }">
              <i v-for="i in layout.cols * layout.rows" :key="i"></i>
            </span>
            <span class="gs-fig-txt">
              <b>横{{ layout.cols }} × 縦{{ layout.rows }}</b> に割って読みます
              <em v-if="detected && detected.count === count">自動判定</em>
              <span v-if="cands.length > 1" class="gs-fig-sw">ちがう並びなら、この図をタップ</span>
            </span>
          </button>

          <PdfPageViewer :file="file" @loaded="onLoaded" />
        </template>

        <!-- ② 組み上がった表。ずれていたらここで直す -->
        <template v-else>
          <div class="gs-bar">
            <span class="gs-bar-t">横{{ layout.cols }} × 縦{{ layout.rows }}（1ページに{{ count }}個）で読んだ表</span>
            <button class="gs-back" @click="pdfOpen = true">📄 元のPDF</button>
          </div>

          <p class="gs-guide">
            この表のまま取り込みます。<b>ずれていたら下のボタンで直してください。</b>
            直した内容は「読み方」として次回にも効きます。
          </p>

          <!-- 紙の見出しにしか書いていない情報を、列に変える -->
          <div v-if="headCands.length" class="gs-heads">
            <div class="gs-heads-t">
              紙の見出しにある言葉を、<b>全行に付けられます</b>
              <span class="gs-heads-n">（分類などが1ヵ所にしか書かれていないとき）</span>
            </div>
            <div class="gs-heads-row">
              <button v-for="(t, i) in headCands" :key="i" class="gs-head"
                      :class="{ on: headOn(t) }" :aria-pressed="headOn(t)" @click="toggleHead(t)">
                {{ t.text }}
              </button>
            </div>
          </div>

          <!-- 行の高さ -->
          <div class="gs-tool">
            <span class="gs-tool-t">行</span>
            <button class="gs-tool-b" :disabled="rowStep <= 0" @click="rowStep--">1行が2行に割れている</button>
            <button class="gs-tool-b" :disabled="rowStep >= ROW_STEPS.length - 1" @click="rowStep++">2行が1行にくっついている</button>
          </div>

          <!-- ずれの直し。行によって1列ずれるのは、セルの数が多数派と違う行が
               並び順で入っているため。位置で入れれば、割れた名前は1つに戻り、
               欠けたところは空のまま残る -->
          <div class="gs-tool">
            <span class="gs-tool-t">ずれ</span>
            <button class="gs-tool-b" :class="{ on: byPos }" :aria-pressed="byPos"
                    @click="byPos = !byPos">
              紙の位置で入れる{{ byPos ? '（いま）' : '' }}
            </button>
            <span class="gs-tool-n">
              <b>行によって1列ずれるとき</b>に押してください。左から順に詰めるのをやめて、
              紙に刷られている位置へ入れます。割れた品目名は別の列に出るので、
              その列をタップして「左の列と合わせる」でまとめられます。
            </span>
          </div>

          <!-- 表 -->
          <div class="gs-table-wrap">
            <table class="gs-table">
              <thead>
                <tr>
                  <th class="gs-no"></th>
                  <th v-for="i in colCount" :key="i"
                      :class="{ on: picked === i - 1, add: i - 1 >= paperCols }" @click="tapCol(i - 1)">
                    <span class="gs-cn">{{ i - 1 >= paperCols ? '見出し' : i }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="x in shown" :key="x.i" :class="{ odd: isOdd(x.i) }">
                  <td class="gs-no">{{ x.i + 1 }}</td>
                  <td v-for="i in colCount" :key="i"
                      :class="{ on: picked === i - 1, add: i - 1 >= paperCols }" @click="tapCol(i - 1)">
                    {{ cell(x.r, i - 1) || '　' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="gs-count">
            全 {{ rows.length.toLocaleString() }}行 / {{ colCount }}列
            <button v-if="oddSet.size" class="gs-odd" :class="{ on: oddOnly }" :aria-pressed="oddOnly"
                    @click="oddOnly = !oddOnly">
              そろっていない行 {{ oddSet.size.toLocaleString() }}件{{ oddOnly ? ' ・ 全部見る' : ' ・ だけ見る' }}
            </button>
            <button v-if="edges" class="gs-reset" @click="resetEdges">列の直しを取り消す</button>
          </div>

          <!-- 列の直し -->
          <div v-if="picked !== null" class="gs-colbar">
            <div class="gs-colbar-t">{{ picked + 1 }}列目</div>
            <button class="gs-colb" :disabled="picked === 0" @click="mergeLeft(picked)">← 左の列と合わせる</button>
            <button class="gs-colb" :disabled="!canSplit(picked)" @click="splitCol(picked)">ここで2つに分ける</button>
          </div>
          <p v-else class="gs-hint">列がずれているときは、その列をタップして「合わせる／分ける」。</p>

          <!-- 行き止まりの答え。以前はここから「紙の上で直接指定する」別の画面へ逃げていたが、
               同じ仕事に考え方が2つあると、片方で覚えたことがもう片方で効かない -->
          <p v-if="!canGo" class="gs-dead">
            この紙は表に組み立てられませんでした。<b>枚数を変える</b>か<b>行の高さを直す</b>と
            読めることがあります。それでも表にならない紙は、自動では読み取れません
            （品目をCSVで用意するか、手で登録してください）。
          </p>
        </template>
      </div>

      <!-- どの段階でも、進むのはここだけ -->
      <div class="gs-foot">
        <button class="btn btn-secondary" @click="back">{{ backLabel }}</button>
        <div class="gs-foot-mid">
          <span v-if="blockedWhy" class="gs-foot-why" role="alert">{{ blockedWhy }}</span>
          <span v-else class="gs-foot-step">{{ step }} / 2</span>
        </div>
        <button class="btn btn-primary" :disabled="step >= 2 && !canGo" @click="next">{{ nextLabel }}</button>
      </div>
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
/* 本文だけがスクロールし、下の 戻る/次へ は常に見えている（進み方を見失わせない） */
.grid-sheet { max-height: 94vh; display: flex; flex-direction: column; }
.gs-body { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; }
.sheet-head { display: flex; align-items: center; gap: 8px; }
.sheet-head .sheet-title { flex: 1; min-width: 0; }
.gs-x { border: 1px solid var(--border); background: var(--surface); color: var(--text-muted);
  border-radius: 8px; width: 32px; height: 32px; font-size: 14px; cursor: pointer; flex-shrink: 0; }

.gs-q { font-size: 17px; font-weight: 800; line-height: 1.45; color: var(--text); margin-bottom: 6px; }
.gs-note { font-size: 11.5px; line-height: 1.6; color: var(--text-muted); margin: 0 0 10px; }
.gs-note b { color: var(--text); }

/* 枚数は横スクロール。4枚できっちり切ると「4までしかない」に見えるので5枚目を覗かせる */
.gs-nums { display: flex; gap: 8px; overflow-x: auto; scroll-snap-type: x proximity;
  padding: 2px 34px 8px 2px; margin-right: -12px; -webkit-overflow-scrolling: touch; }
.gs-num { flex: 0 0 auto; width: 58px; scroll-snap-align: center;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0;
  border: 1.5px solid var(--border); background: var(--surface); border-radius: 12px;
  padding: 9px 4px; cursor: pointer; }
.gs-num:active { transform: scale(.97); }
.gs-num.on { border-color: var(--primary); background: var(--primary-weak); }
.gs-num-n { font-size: 20px; font-weight: 800; color: var(--text); font-variant-numeric: tabular-nums; }
.gs-num-l { font-size: 10px; color: var(--text-muted); }

.gs-fig { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
  border: 1.5px solid var(--primary-border); background: var(--primary-weak);
  border-radius: 12px; padding: 10px 12px; margin-bottom: 12px; }
.gs-fig.tappable { cursor: pointer; }
.gs-fig:disabled { cursor: default; }
.gs-fig-box { display: grid; gap: 2px; width: 52px; height: 62px; flex-shrink: 0; }
.gs-fig-box i { border: 1.5px solid var(--primary); border-radius: 2px; background: #fff; }
.gs-fig-txt { font-size: 12px; line-height: 1.55; color: var(--text); }
.gs-fig-txt b { color: var(--primary); font-size: 13px; }
.gs-fig-txt em { display: inline-block; font-style: normal; background: var(--primary); color: #fff;
  font-size: 9px; font-weight: 800; border-radius: 5px; padding: 1px 5px; margin-left: 5px;
  vertical-align: 1px; }
.gs-fig-sw { display: block; font-size: 10.5px; color: var(--text-muted); margin-top: 2px; }

.gs-bar { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
.gs-bar-t { flex: 1; min-width: 0; font-size: 11.5px; font-weight: 800; color: var(--text-muted); }
.gs-back { border: 1.5px solid var(--primary-border); background: var(--surface);
  color: var(--primary); border-radius: 10px; padding: 8px 10px; font-size: 11.5px;
  font-weight: 800; cursor: pointer; flex-shrink: 0; }
.gs-guide { font-size: 12.5px; line-height: 1.55; color: var(--text); background: var(--primary-weak);
  border: 1px solid var(--primary-border); border-radius: 9px; padding: 8px 10px; margin: 0 0 8px; }
.gs-guide b { color: var(--primary); }

.gs-heads { border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; margin-bottom: 8px; }
.gs-heads-t { font-size: 11.5px; line-height: 1.5; color: var(--text-muted); margin-bottom: 6px; }
.gs-heads-t b { color: var(--text); }
.gs-heads-n { display: block; font-size: 10.5px; }
.gs-heads-row { display: flex; flex-wrap: wrap; gap: 6px; }
.gs-head { border: 1px solid var(--border); background: var(--surface); color: var(--text);
  border-radius: 16px; padding: 5px 11px; font-size: 11.5px; font-weight: 700; cursor: pointer;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gs-head.on { border-color: var(--primary); background: var(--primary); color: #fff; }

.gs-tool { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.gs-tool-t { font-size: 11.5px; font-weight: 800; color: var(--text-muted); flex-shrink: 0; }
.gs-tool-b { flex: 1; border: 1px solid var(--border); background: var(--surface); color: var(--text);
  border-radius: 9px; padding: 8px 6px; font-size: 11px; font-weight: 700; cursor: pointer; }
.gs-tool-b:disabled { opacity: .35; cursor: not-allowed; }
.gs-tool-b.on { border-color: var(--primary); background: var(--primary); color: #fff; }
.gs-tool-n { flex: 1 1 100%; font-size: 10.5px; line-height: 1.55; color: var(--text-muted); }
.gs-tool-n b { color: var(--text); }

.gs-table-wrap { border: 1px solid var(--border); border-radius: 10px; overflow: auto;
  max-height: 42vh; -webkit-overflow-scrolling: touch; }
.gs-table { border-collapse: collapse; font-size: 11.5px; white-space: nowrap; }
.gs-table th, .gs-table td { border: 1px solid var(--border); padding: 4px 7px; text-align: left;
  max-width: 190px; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.gs-table th { position: sticky; top: 0; background: var(--surface); z-index: 1; }
/* 全行出すので、画面の外の行は描かせない（1000行でも重くならない） */
.gs-table tbody tr { content-visibility: auto; contain-intrinsic-size: auto 25px; }
/* そろっていない行。ずれは目で探させない */
.gs-table tbody tr.odd td { background: #fff7ed; }
.gs-table tbody tr.odd td.gs-no { background: #fed7aa; color: #9a3412; font-weight: 800; }
.gs-table th.on, .gs-table td.on { background: var(--primary-weak); }
.gs-table th.on { border-color: var(--primary); }
/* 見出しから足した列。紙の上に境界が無いので、合わせる・分けるの対象にしない */
.gs-table th.add, .gs-table td.add { background: #f8fafc; color: var(--text-muted); cursor: default; }
.gs-cn { font-size: 10.5px; font-weight: 800; color: var(--text-muted); }
.gs-no { width: 30px; color: var(--text-muted); text-align: right; background: var(--surface); cursor: default; }

.gs-count { display: flex; align-items: center; gap: 8px; font-size: 11px;
  color: var(--text-muted); margin: 6px 0 8px; }
.gs-odd { border: 1px solid #fdba74; background: #fff7ed; color: #9a3412;
  border-radius: 14px; padding: 3px 10px; font-size: 10.5px; font-weight: 800; cursor: pointer; }
.gs-odd.on { background: #ea580c; border-color: #ea580c; color: #fff; }
.gs-reset { margin-left: auto; border: none; background: none; color: var(--danger);
  font-size: 11px; cursor: pointer; }

.gs-colbar { display: flex; align-items: center; gap: 6px;
  background: var(--surface); border: 1.5px solid var(--primary); border-radius: 10px;
  padding: 8px 10px; margin-bottom: 10px; }
.gs-colbar-t { font-size: 11.5px; font-weight: 800; color: var(--primary); flex-shrink: 0; }
.gs-colb { flex: 1; border: 1px solid var(--border); background: #fff; color: var(--text);
  border-radius: 9px; padding: 8px 6px; font-size: 11px; font-weight: 700; cursor: pointer; }
.gs-colb:disabled { opacity: .35; cursor: not-allowed; }
.gs-hint { font-size: 11px; line-height: 1.6; color: var(--text-muted); margin: 0 0 10px; }

.gs-dead { font-size: 12px; line-height: 1.6; color: #b91c1c; background: #fef2f2;
  border: 1px solid #fecaca; border-radius: 10px; padding: 9px 11px; margin: 0 0 4px; }
.gs-dead b { color: #b91c1c; }

.gs-foot { display: flex; align-items: center; gap: 10px; padding-top: 10px; margin-top: 8px;
  border-top: 1px solid var(--border); flex-shrink: 0; }
.gs-foot .btn { flex-shrink: 0; }
.gs-foot-mid { flex: 1; min-width: 0; text-align: center; }
.gs-foot-step { font-size: 11px; font-weight: 800; color: var(--text-muted); }
.gs-foot-why { font-size: 11px; line-height: 1.45; color: var(--danger); font-weight: 700; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }

.gs-pdfview { position: fixed; inset: 0; z-index: 60; background: rgba(15, 23, 42, 0.55);
  display: flex; align-items: center; justify-content: center; padding: 12px; }
.gs-pdfsheet { background: var(--surface); border-radius: 14px; padding: 12px;
  width: 100%; max-width: 720px; max-height: 90vh; overflow-y: auto; }
</style>
