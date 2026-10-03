<script setup>
/**
 * 起動時の読み込み画面（User決定 2026-10-03・モック https://claude.ai/artifact/FUmXS6Grgs54siZREaqw7f）。
 *
 * 周りの4人からカードが中央へ飛んで集まり、輪がつながったら完成してホームへ。
 * - 輪は実際の読み込みの進み具合（progress 0〜1）に合わせて伸びる（User 2026-10-03）
 * - 最低 MIN_MS は見せる。読み込み（ready）がそれより遅ければ、輪が伸びきるのを待つ
 * - 同じタブの再読み込みでは出さない（App が sessionStorage で判断する）
 * - 読み込みが終わらなくても MAX_MS で閉じる（オフラインで固まらない）
 * - 動きを控える設定の端末では動かさず、輪だけを出してすぐ閉じる
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
const PEOPLE = [{ x: 34, y: 40 }, { x: 290, y: 52 }, { x: 22, y: 268 }, { x: 296, y: 280 }]
const C = { x: 160, y: 160 }
const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const stage = ref(null)
const ring = ref(null)
const named = ref(false)
const leaving = ref(false)
let minPassed = false
// 輪の長さ＝読み込みの進み具合。伸び方は CSS の transition でなめらかにする（閉じるときは必ず1周）
const shownProgress = computed(() => (closing.value ? 1 : Math.max(0, Math.min(1, props.progress))))
const closing = ref(false)
let closed = false
const timers = []
const later = (fn, ms) => timers.push(setTimeout(fn, ms))

function animate(el, frames, opts) { return typeof el?.animate === 'function' ? el.animate(frames, opts) : null }

function build() {
  const st = stage.value
  if (!st) return
  const total = MIN_MS
  const T = { people: .12, fly: .62 }
  const people = PEOPLE.map((p, i) => {
    const el = document.createElement('div')
    el.className = 'ss-person'
    el.innerHTML = '<svg viewBox="0 0 46 52" fill="currentColor"><circle cx="23" cy="13" r="10"/><path d="M3 52c0-12 9-21 20-21s20 9 20 21z"/></svg>'
    el.style.left = p.x + 'px'; el.style.top = p.y + 'px'
    st.appendChild(el)
    animate(el, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: .95, transform: 'scale(1)' }],
      { duration: total * T.people, delay: i * 40, easing: 'cubic-bezier(.2,1.4,.4,1)', fill: 'forwards' })
    return el
  })
  const flyStart = total * T.people
  const flyEnd = flyStart + total * T.fly
  const perPerson = 4
  for (let n = 0; n < perPerson; n++) {
    PEOPLE.forEach((p, i) => {
      const order = n * PEOPLE.length + i
      const frac = order / (perPerson * PEOPLE.length)
      const at = flyStart + (flyEnd - flyStart) * (1 - Math.pow(1 - frac, 1.6)) * 0.85
      const dur = Math.max(260, total * .22 * (1 - frac * .5))
      const c = document.createElement('span')
      c.className = 'ss-card' + (order % 3 === 1 ? ' g' : order % 3 === 2 ? ' b' : '')
      st.appendChild(c)
      const dx = 14 - (order % 5) * 7, dy = -6 + (order % 5) * 3
      const mid = { x: (p.x + C.x) / 2 + (p.y < C.y ? 30 : -30), y: (p.y + C.y) / 2 + (p.x < C.x ? -24 : 24) }
      animate(c, [
        { transform: `translate(${p.x}px, ${p.y}px) skewY(-14deg) scale(.4)`, opacity: 0 },
        { transform: `translate(${mid.x}px, ${mid.y}px) skewY(-14deg) rotate(10deg) scale(.8)`, opacity: 1, offset: .55 },
        { transform: `translate(${C.x + dx}px, ${C.y + dy}px) skewY(-14deg) rotate(-8deg) scale(1)`, opacity: 1 },
      ], { duration: dur, delay: at, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'both' })
    })
  }
  people.forEach(el => animate(el, [{ opacity: .95 }, { opacity: 0 }], { duration: total * .15, delay: flyEnd, fill: 'forwards' }))
}

function close() {
  if (closed) return
  closed = true
  closing.value = true
  named.value = true
  later(() => { leaving.value = true }, reduce ? 0 : 380)
  later(() => emit('done'), reduce ? 50 : 760)
}
function tryClose() { if (minPassed && props.ready) close() }

onMounted(() => {
  if (!reduce) build()
  later(() => { minPassed = true; tryClose() }, reduce ? 300 : MIN_MS)
  later(close, MAX_MS)
})
watch(() => props.ready, tryClose)
onBeforeUnmount(() => { timers.forEach(clearTimeout) })
</script>

<template>
  <div :class="['ss', { named, leaving }]" role="status" :aria-label="`${APP_NAME}を起動しています`">
    <div ref="stage" class="ss-stage" aria-hidden="true">
      <svg class="ss-ringsvg" viewBox="0 0 320 320">
        <defs>
          <linearGradient id="ssRingGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#0e7490" /><stop offset=".55" stop-color="#22d3ee" /><stop offset="1" stop-color="#34d399" />
          </linearGradient>
          <filter id="ssGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <ellipse ref="ring" class="ss-ring" cx="160" cy="160" rx="104" ry="66" transform="rotate(-18 160 160)" pathLength="520"
          :style="{ strokeDashoffset: 520 * (1 - shownProgress) }" />
      </svg>
    </div>
    <div class="ss-name">{{ APP_NAME }}<small>{{ APP_TAGLINE }}</small></div>
  </div>
</template>

<style scoped>
.ss {
  position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center;
  background: radial-gradient(120% 80% at 50% 40%, #0c2a33 0%, #061317 70%); color: #e6fbff;
  transition: opacity .35s ease;
}
.ss.leaving { opacity: 0; pointer-events: none; }
.ss.leaving .ss-stage, .ss.leaving .ss-name { transform: scale(.92); transition: transform .35s ease; }
.ss-stage { position: relative; width: 320px; height: 320px; margin-top: -80px; }
.ss-ringsvg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.ss-ring { fill: none; stroke: url(#ssRingGrad); stroke-width: 12; stroke-linecap: round; filter: url(#ssGlow); stroke-dasharray: 520; stroke-dashoffset: 520;
  transition: stroke-dashoffset .45s cubic-bezier(.3,.7,.2,1); }
@media (prefers-reduced-motion: reduce) { .ss-ring { transition: none; } }
.ss.named .ss-ring { animation: ss-flash .5s ease; }
@keyframes ss-flash { 50% { stroke-width: 18; } }
.ss-name {
  position: absolute; left: 0; right: 0; bottom: calc(18% + env(safe-area-inset-bottom, 0px)); text-align: center;
  letter-spacing: .3em; font-weight: 800; font-size: 24px; opacity: 0; transform: translateY(8px); transition: opacity .4s ease, transform .4s ease;
}
.ss-name small { display: block; font-size: 11px; letter-spacing: .12em; font-weight: 600; color: #7fa3ad; margin-top: 6px; }
.ss.named .ss-name { opacity: 1; transform: none; }
.ss-stage :deep(.ss-person) { position: absolute; width: 46px; height: 52px; margin: -26px 0 0 -23px; opacity: 0; color: #5eead4; filter: drop-shadow(0 0 8px rgba(94, 234, 212, .55)); }
.ss-stage :deep(.ss-person svg) { width: 100%; height: 100%; }
.ss-stage :deep(.ss-card) {
  position: absolute; left: 0; top: 0; width: 40px; height: 54px; margin: -27px 0 0 -20px; border-radius: 8px;
  background: rgba(186, 240, 255, .22); border: 1.5px solid rgba(210, 250, 255, .8);
  box-shadow: 0 0 14px rgba(52, 211, 153, .45), inset 0 0 10px rgba(255,255,255,.25); will-change: transform, opacity;
}
.ss-stage :deep(.ss-card.g) { background: rgba(110, 231, 183, .24); }
.ss-stage :deep(.ss-card.b) { background: rgba(96, 165, 250, .26); }
</style>
