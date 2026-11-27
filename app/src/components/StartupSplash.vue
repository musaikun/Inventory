<script setup>
/**
 * 起動時の読み込み画面（User決定 2026-10-03・モック https://claude.ai/artifact/FUmXS6Grgs54siZREaqw7f）。
 * 2026-11-24 User: 中央の箱に収まって見えるので、画面全体を舞台にする（モック https://claude.ai/artifact/HxojCHULoV2qhuuzJRmuvk）。
 * 2026-11-27 User: もう少し控えめに、上品に。人・飛んでくるカード・背景の粒・光の波・輪をくぐる拡大をやめ、
 *   アプリのマークの輪が読み込みに合わせて静かに描かれ、名前がふわっと出て、そのまま溶けるように消える形にした。
 *
 * - 輪は実際の読み込みの進み具合（progress 0〜1）に合わせて伸びる（User 2026-10-03）。細い線と、うすい下書きの輪
 * - 最低 MIN_MS は見せる。読み込み（ready）がそれより遅ければ、輪が伸びきるのを待つ
 * - 同じタブの再読み込みでは出さない（App が sessionStorage で判断する）
 * - 読み込みが終わらなくても MAX_MS で閉じる（オフラインで固まらない）
 * - 動きを控える設定の端末では動かさず、輪だけを出してすぐ閉じる
 * - 動きは CSS の transition / opacity と SVG の線の長さだけ（毎フレームの描画処理を持たない）
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { APP_NAME, APP_TAGLINE } from '../appInfo.js'

const props = defineProps({
  ready:    { type: Boolean, default: false },
  progress: { type: Number, default: 0 },   // 読み込みの進み具合 0〜1
})
const emit = defineEmits(['done'])

const MIN_MS = 1600
const MAX_MS = 6000
const LEAVE_AT = 620     // 完成（名前が出る）から、溶けて消え始めるまで
const DONE_AT = 1160     // 完成からホームを出すまで
const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const named = ref(false)
const leaving = ref(false)
const closing = ref(false)
// 最初の1枚は空の輪で描き、次のフレームから伸ばす（読み込みが早く終わっていても、描き上がった輪からは始めない）
const started = ref(false)
// 輪の長さ＝読み込みの進み具合。伸び方は CSS の transition でなめらかにする（閉じるときは必ず1周）
const shownProgress = computed(() => (!started.value ? 0 : closing.value ? 1 : Math.max(0, Math.min(1, props.progress))))

let minPassed = false
let closed = false
const timers = []
const later = (fn, ms) => timers.push(setTimeout(fn, ms))

function close() {
  if (closed) return
  closed = true
  closing.value = true
  named.value = true
  later(() => { leaving.value = true }, reduce ? 0 : LEAVE_AT)
  later(() => emit('done'), reduce ? 50 : DONE_AT)
}
function tryClose() { if (minPassed && props.ready) close() }

onMounted(() => {
  const go = () => { started.value = true }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(go))
  else later(go, 30)
  later(() => { minPassed = true; tryClose() }, reduce ? 300 : MIN_MS)
  later(close, MAX_MS)
})
watch(() => props.ready, tryClose)
onBeforeUnmount(() => timers.forEach(clearTimeout))
</script>

<template>
  <div :class="['ss', { named, leaving }]" role="status" :aria-label="`${APP_NAME}を起動しています`">
    <div class="ss-stage" aria-hidden="true">
      <div class="ss-glow" />
      <!-- アプリのマークと同じ、少し傾けた楕円の輪 -->
      <svg class="ss-ringsvg" viewBox="0 0 240 140">
        <defs>
          <linearGradient id="ssRingGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#2563eb" /><stop offset=".55" stop-color="#22d3ee" /><stop offset="1" stop-color="#34d399" />
          </linearGradient>
          <filter id="ssGlow" x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="2.2" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <ellipse class="ss-track" cx="120" cy="70" rx="104" ry="50" transform="rotate(-18 120 70)" />
        <ellipse class="ss-ring" cx="120" cy="70" rx="104" ry="50" transform="rotate(-18 120 70)" pathLength="520"
          :style="{ strokeDashoffset: 520 * (1 - shownProgress) }" />
      </svg>
    </div>
    <div class="ss-name">{{ APP_NAME }}<small v-if="APP_TAGLINE">{{ APP_TAGLINE }}</small></div>
  </div>
</template>

<style scoped>
.ss {
  position: fixed; inset: 0; z-index: 10000; overflow: hidden;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px;
  padding-bottom: 6vh;
  background: radial-gradient(120% 80% at 50% 42%, #0c2a33 0%, #061317 72%); color: #e6fbff;
  transition: opacity .54s ease;
}
/* 溶けるように消える（ほんの少しだけ前へ） */
.ss.leaving { opacity: 0; pointer-events: none; }
.ss-stage { position: relative; width: min(64vw, 280px); transition: transform .54s cubic-bezier(.4, 0, .2, 1); }
.ss.leaving .ss-stage { transform: scale(1.04); }
/* 輪の後ろのやわらかい光。最初にゆっくり灯る */
.ss-glow {
  position: absolute; inset: -30% -20%; pointer-events: none;
  background: radial-gradient(closest-side, rgba(34, 211, 238, .16), rgba(52, 211, 153, .06) 55%, transparent);
  animation: ss-in 1.2s ease both;
}
.ss-ringsvg { position: relative; display: block; width: 100%; height: auto; overflow: visible; }
.ss-track { fill: none; stroke: rgba(230, 251, 255, .07); stroke-width: 2; }
.ss-ring { fill: none; stroke: url(#ssRingGrad); stroke-width: 2.6; stroke-linecap: round; filter: url(#ssGlow);
  stroke-dasharray: 520; stroke-dashoffset: 520; transition: stroke-dashoffset 1.1s cubic-bezier(.45, 0, .2, 1); }
.ss-name {
  text-align: center; letter-spacing: .34em; font-weight: 600; font-size: 21px; padding-left: .34em;
  opacity: 0; transform: translateY(6px); transition: opacity .6s ease, transform .6s ease;
}
.ss-name small { display: block; font-size: 10.5px; letter-spacing: .16em; font-weight: 500; color: #7fa3ad; margin-top: 8px; }
.ss.named .ss-name { opacity: 1; transform: none; }
@keyframes ss-in { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .ss, .ss-stage, .ss-ring, .ss-name { transition: none; }
  .ss-glow { animation: none; }
  .ss.leaving .ss-stage { transform: none; }
}
</style>
