<script setup>
/**
 * 在庫タブ上部の「並び替え」カード（User決定 2026-10-10・モック docs/mocks/stock-sort.html）。
 * 棚卸・発注の開始はホームだけにし、ここは並び替えの入口だけにする。
 * - まだ振り分けていない店: おすすめとして光り、「ばらばらの点が3列にそろう」小さな動きを見せる
 *   （以前のおすすめカードとタイルをまとめた）
 * - 振り分けてある店: 並び替えごとのボタン（進み具合つき）。押すとその並び替えの振り分けの画面へ直行
 * - 2つ目の枠が空いていれば「＋ 分け方を追加」
 * 一覧のタブ（見え方の切り替え）と見分けるため、ボタンは進み具合つきの「作業の入口」に見せる。
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useSortSetup } from '../composables/useSortSetup.js'

defineProps({ disabled: { type: Boolean, default: false } })
const { sortStage, axesProgress, freeSlot, openSortAxis, addSortAxis } = useSortSetup()

const hot = computed(() => sortStage.value === 'none')
// まだ振り分けていない店の主ボタン。名前だけ付けてある並び替えがあればそれを開く
const firstAxis = computed(() => axesProgress.value[0] ?? null)
const ctaLabel = computed(() => `${firstAxis.value?.name || '保管場所'}で分ける`)
function onCta() {
  if (firstAxis.value) openSortAxis(firstAxis.value.idx)
  else addSortAxis('保管場所')
}

// カードの中の小さな実演。c = 0/1/2 の3列へそろう
const DOTS = [0, 1, 2, 0, 1, 2, 0, 1, 2]
const SCATTER = [[8, 6], [26, 26], [44, 8], [60, 30], [78, 14], [14, 32], [52, 2], [70, 22], [88, 4]]   // % / px
const sorted = ref(false)
const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
let timer = null
function _start() {
  clearInterval(timer)
  if (!hot.value) return
  if (reduced) { sorted.value = true; return }
  timer = setInterval(() => { sorted.value = !sorted.value }, 1800)
}
onMounted(_start)
watch(hot, _start)
onUnmounted(() => clearInterval(timer))
const dots = computed(() => {
  const n = [0, 0, 0]
  return DOTS.map((c, i) => {
    const [x, y] = sorted.value ? [c * 30 + 12, 4 + (n[c]++) * 12] : SCATTER[i]
    return { c, style: { left: `${x}%`, top: `${y}px` } }
  })
})
const pct = a => (a.total ? Math.round(a.assigned / a.total * 100) : 0)
</script>

<template>
  <section :class="['sc', { hot }]" aria-label="並び替え">
    <span v-if="hot" class="sc-badge">おすすめ</span>
    <div class="sc-h"><b>⇅ 並び替え</b><small>{{ hot ? 'まだ分けていません' : '押すとその分け方を並べ直せます' }}</small></div>

    <template v-if="hot">
      <div class="sc-demo" aria-hidden="true"><i v-for="(d, i) in dots" :key="i" :class="`c${d.c}`" :style="d.style"></i></div>
      <p class="sc-p">保管場所ごとに分けると、棚卸の一覧が<b>歩く順</b>に並びます。</p>
      <button type="button" class="sc-go" :disabled="disabled" @click="onCta">{{ ctaLabel }}</button>
      <button v-if="!firstAxis" type="button" class="sc-alt" :disabled="disabled" @click="addSortAxis()">ほかの名前で作る</button>
    </template>

    <div v-else class="sc-row">
      <button
        v-for="a in axesProgress" :key="a.idx" type="button" :class="['sc-ax', { done: a.assigned >= a.total }]"
        :disabled="disabled" :aria-label="`${a.name}の並び替えを開く`" @click="openSortAxis(a.idx)"
      >
        <b><i aria-hidden="true">⇅</i>{{ a.name }}</b>
        <span class="sc-bar" aria-hidden="true"><span :style="{ width: pct(a) + '%' }"></span></span>
        <small>{{ a.assigned >= a.total ? '✓ 振り分け済み' : `${a.assigned} / ${a.total} 品目` }}</small>
      </button>
      <button v-if="freeSlot >= 0" type="button" class="sc-ax add" :disabled="disabled" @click="addSortAxis()">
        <b>＋ 分け方を追加</b><small>例：仕入先</small>
      </button>
    </div>
  </section>
</template>

<style scoped>
.sc { position: relative; display: grid; gap: 9px; padding: 12px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border); }
.sc.hot { border: 2px solid #22d3ee; animation: sc-glow 2.6s ease-in-out infinite; }
@keyframes sc-glow { 0%, 100% { box-shadow: 0 0 0 0 rgba(34, 211, 238, 0); } 50% { box-shadow: 0 0 0 4px rgba(34, 211, 238, .2), 0 0 18px rgba(34, 211, 238, .25); } }
.sc-badge { position: absolute; top: -9px; right: 12px; font-size: 10.5px; font-weight: 900; padding: 2px 8px; border-radius: 999px; background: #f97316; color: #fff; }
.sc-h { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.sc-h b { font-size: 14px; font-weight: 900; color: var(--text); }
.sc-h small { font-size: 11px; color: var(--text-muted); }
.sc-demo { position: relative; height: 46px; border-radius: 10px; background: var(--primary-weak, #ecfeff); overflow: hidden; }
.sc-demo i { position: absolute; width: 16px; height: 7px; border-radius: 3px; transition: left .7s cubic-bezier(.3, .7, .2, 1), top .7s cubic-bezier(.3, .7, .2, 1); }
.sc-demo .c0 { background: #22d3ee; } .sc-demo .c1 { background: #34d399; } .sc-demo .c2 { background: #818cf8; }
.sc-p { margin: 0; font-size: 12px; line-height: 1.55; color: var(--text-muted); }
.sc-go { min-height: 42px; border: none; border-radius: 11px; background: var(--grad-btn); color: var(--on-grad); font-size: 14px; font-weight: 900; cursor: pointer; }
.sc-alt { justify-self: end; border: none; background: none; color: var(--text-muted); font-size: 12px; font-weight: 700; padding: 2px 4px; cursor: pointer; text-decoration: underline; }
.sc-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.sc-ax {
  display: grid; gap: 5px; text-align: left; padding: 9px 10px; border-radius: 12px; cursor: pointer; font: inherit;
  border: 1.5px solid var(--border); background: var(--primary-weak, #ecfeff); color: var(--text);
}
.sc-ax b { display: flex; align-items: center; gap: 5px; font-size: 13.5px; font-weight: 800; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-ax b i { font-style: normal; color: var(--primary); }
.sc-ax small { font-size: 11px; color: var(--text-muted); }
.sc-ax.done small { color: #047857; font-weight: 700; }
.sc-bar { height: 5px; border-radius: 9px; background: var(--border); overflow: hidden; }
.sc-bar span { display: block; height: 100%; background: var(--grad-btn); }
.sc-ax.add { border-style: dashed; background: var(--surface); place-items: center; text-align: center; }
.sc-ax.add b { color: var(--primary); }
.sc-ax:disabled, .sc-go:disabled { opacity: .5; cursor: default; }
@media (prefers-reduced-motion: reduce) { .sc.hot { animation: none; } .sc-demo i { transition: none; } }
</style>
