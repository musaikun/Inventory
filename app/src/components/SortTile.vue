<script setup>
/**
 * ホームの「並び替え」タイル（棚卸・発注と並ぶ。User決定 2026-10-04）。
 * 振り分けると棚卸の一覧が歩く順に並び、効き目が大きいので、まだ振り分けていない店では
 * 「おすすめ」の印つきで光り、タイルの中で「ばらばらの点が3列にそろう」小さな動きを繰り返す。
 * はじめて使うときだけは在庫の一覧の上に大きなおすすめ（SortRecoCard）も出る。
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useSortSetup } from '../composables/useSortSetup.js'

defineProps({ disabled: { type: Boolean, default: false } })
const { sortProgress, sortStage, openSort } = useSortSetup()

const hot = computed(() => sortStage.value === 'none')
const sub = computed(() => {
  const { best, total } = sortProgress.value
  if (sortStage.value === 'half') return `${best.name} ${best.assigned}/${total}`
  if (sortStage.value === 'done') return best.name
  return '保管場所で並べる'
})

// タイルの中の小さな実演。c = 0/1/2 の3列へそろう
const DOTS = [0, 1, 2, 0, 1, 2, 0, 1, 2]
const SCATTER = [[30, 2], [4, 14], [50, 6], [18, 4], [56, 18], [8, 0], [40, 16], [24, 18], [46, 0]]
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
    const [x, y] = sorted.value ? [c * 24 + 2, (n[c]++) * 9] : SCATTER[i]
    return { c, style: { left: `${x}px`, top: `${y}px` } }
  })
})
</script>

<template>
  <button :class="['st', { hot }]" type="button" :disabled="disabled" @click="openSort">
    <span v-if="hot" class="st-badge">おすすめ</span>
    <span v-if="hot" class="st-mini" aria-hidden="true">
      <i v-for="(d, i) in dots" :key="i" :class="`c${d.c}`" :style="d.style"></i>
    </span>
    <b v-else class="st-ico" aria-hidden="true">⇅</b>
    <span class="st-label">並び替え</span>
    <small class="st-sub">{{ sub }}</small>
  </button>
</template>

<style scoped>
.st {
  position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  background: var(--surface); border: 1.5px solid var(--border); border-radius: 14px; padding: 8px 4px 7px;
  font-family: inherit; cursor: pointer; color: var(--text);
}
.st:disabled { opacity: .6; cursor: default; }
.st.hot { border-color: #22d3ee; animation: st-glow 2.4s ease-in-out infinite; }
@keyframes st-glow { 0%, 100% { box-shadow: 0 0 0 0 rgba(34, 211, 238, 0); } 50% { box-shadow: 0 0 0 3px rgba(34, 211, 238, .22), 0 0 18px rgba(34, 211, 238, .3); } }
.st-badge {
  position: absolute; top: -8px; right: 6px; font-size: 9.5px; font-weight: 800; padding: 1px 6px; border-radius: 999px;
  background: var(--grad-btn); color: var(--on-grad);
}
.st-ico { display: block; font-size: 22px; line-height: 1.2; color: var(--primary); }
.st-mini { position: relative; width: 64px; height: 27px; }
.st-mini i { position: absolute; width: 8px; height: 8px; border-radius: 3px; transition: left .7s cubic-bezier(.3, .7, .2, 1), top .7s cubic-bezier(.3, .7, .2, 1); }
.st-mini i.c0 { background: #60a5fa; }
.st-mini i.c1 { background: #22d3ee; }
.st-mini i.c2 { background: #34d399; }
.st-label { font-size: 12.5px; font-weight: 800; }
.st-sub { font-size: 10px; font-weight: 700; color: var(--text-muted); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 4px; }
.st.hot .st-sub { color: var(--primary); }
@media (prefers-reduced-motion: reduce) {
  .st.hot { animation: none; }
  .st-mini i { transition: none; }
}
</style>
