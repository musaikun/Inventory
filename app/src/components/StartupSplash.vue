<script setup>
/**
 * 起動時の読み込み画面（User決定 2026-10-03・モック https://claude.ai/artifact/FUmXS6Grgs54siZREaqw7f）。
 * 2026-11-24 User: 中央の箱に収まって見えるので、画面全体を舞台にする（モック https://claude.ai/artifact/HxojCHULoV2qhuuzJRmuvk）。
 *
 * 画面の四隅の4人と画面の外からカードが中央へ飛んで集まり、輪がつながったら完成。
 * 光の波が画面の端まで広がり、輪をくぐるように拡大してホームへ抜ける。
 * - 人・輪・カードの位置は画面に対する割合で決める（どの縦横比でも端まで使う）
 * - 背景の粒は画面全体を漂い、読み込みが進むほど輪へ寄る
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
const LEAVE_AT = 520     // 完成（光の波）から、くぐって抜け始めるまで
const DONE_AT = 1160     // 完成からホームを出すまで
// 人は画面の四隅寄り、カードは人と画面の外から（割合）
const PEOPLE = [{ x: .16, y: .12 }, { x: .84, y: .17 }, { x: .14, y: .80 }, { x: .86, y: .75 }]
const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const root = ref(null)
const layer = ref(null)
const canvas = ref(null)
const glow = ref(null)
const named = ref(false)
const leaving = ref(false)
const closing = ref(false)
// 画面の大きさ（mount 時に測る。測れない環境では一般的なスマホの値）
const W = ref(typeof window !== 'undefined' && window.innerWidth || 375)
const H = ref(typeof window !== 'undefined' && window.innerHeight || 780)
const C = computed(() => ({ x: W.value / 2, y: H.value * .44 }))
const R = computed(() => ({ rx: W.value * .38, ry: W.value * .24 }))
// 輪の長さ＝読み込みの進み具合。伸び方は CSS の transition でなめらかにする（閉じるときは必ず1周）
const shownProgress = computed(() => (closing.value ? 1 : Math.max(0, Math.min(1, props.progress))))

let minPassed = false
let closed = false
let raf = 0
let wave = 0
const timers = []
const later = (fn, ms) => timers.push(setTimeout(fn, ms))

function animate(el, frames, opts) { return typeof el?.animate === 'function' ? el.animate(frames, opts) : null }

function flyCards(host, from, perPerson, slow, bend) {
  const total = MIN_MS
  const flyStart = total * .12, flyEnd = flyStart + total * .62
  const c0 = C.value
  for (let n = 0; n < perPerson; n++) {
    from.forEach((p, i) => {
      const order = n * from.length + i
      const frac = order / (perPerson * from.length)
      const at = flyStart + (flyEnd - flyStart) * (1 - Math.pow(1 - frac, 1.6)) * .85
      const dur = Math.max(260, total * .22 * (1 - frac * .5)) * slow
      const c = document.createElement('span')
      c.className = 'ss-card' + (order % 3 === 1 ? ' g' : order % 3 === 2 ? ' b' : '')
      host.appendChild(c)
      const dx = 14 - (order % 5) * 7, dy = -6 + (order % 5) * 3
      const mid = { x: (p.x + c0.x) / 2 + (p.y < c0.y ? bend : -bend), y: (p.y + c0.y) / 2 + (p.x < c0.x ? -bend * .8 : bend * .8) }
      animate(c, [
        { transform: `translate(${p.x}px, ${p.y}px) skewY(-14deg) scale(.4)`, opacity: 0 },
        { transform: `translate(${mid.x}px, ${mid.y}px) skewY(-14deg) rotate(10deg) scale(.85)`, opacity: 1, offset: .55 },
        { transform: `translate(${c0.x + dx}px, ${c0.y + dy}px) skewY(-14deg) rotate(-8deg) scale(1)`, opacity: 1 },
      ], { duration: dur, delay: at, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'both' })
    })
  }
}

function build() {
  const st = layer.value
  if (!st) return
  const w = W.value, h = H.value, total = MIN_MS
  const flyEnd = total * .12 + total * .62
  const pts = PEOPLE.map(p => ({ x: p.x * w, y: p.y * h }))
  const people = pts.map((p, i) => {
    const el = document.createElement('div')
    el.className = 'ss-person'
    el.innerHTML = '<svg viewBox="0 0 46 52" fill="currentColor"><circle cx="23" cy="13" r="10"/><path d="M3 52c0-12 9-21 20-21s20 9 20 21z"/></svg>'
    el.style.left = p.x + 'px'; el.style.top = p.y + 'px'
    st.appendChild(el)
    animate(el, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: .95, transform: 'scale(1)' }],
      { duration: total * .12, delay: i * 40, easing: 'cubic-bezier(.2,1.4,.4,1)', fill: 'forwards' })
    return el
  })
  flyCards(st, pts, 4, 1.35, 70)
  // 画面の外（左・右・上・下）からも
  const edges = [{ x: -40, y: h * .35 }, { x: w + 40, y: h * .55 }, { x: w * .3, y: -50 }, { x: w * .7, y: h + 50 }]
  flyCards(st, edges, 2, 1.5, 70)
  people.forEach(el => animate(el, [{ opacity: .95 }, { opacity: 0 }], { duration: total * .15, delay: flyEnd, fill: 'forwards' }))
  startDots()
}

// 背景の粒と、完成時に画面の端まで広がる光の波
function startDots() {
  const cv = canvas.value
  const w = W.value, h = H.value
  if (!cv || !root.value?.clientWidth || typeof requestAnimationFrame !== 'function') return
  const g = cv.getContext?.('2d')
  if (!g) return
  const dpr = window.devicePixelRatio || 1
  cv.width = w * dpr; cv.height = h * dpr
  g.scale(dpr, dpr)
  const c0 = C.value, rx = R.value.rx, far = Math.hypot(w, h)
  const dots = Array.from({ length: 70 }, () => ({
    x: Math.random() * w, y: Math.random() * h, r: .6 + Math.random() * 1.8, vy: -(.1 + Math.random() * .35), a: .2 + Math.random() * .5,
  }))
  const paint = (now) => {
    g.clearRect(0, 0, w, h)
    const pull = shownProgress.value * .012 * (wave ? -3 : 1)
    for (const d of dots) {
      d.x += (c0.x - d.x) * pull
      d.y += d.vy + (c0.y - d.y) * pull
      if (d.y < -5) { d.y = h + 5; d.x = Math.random() * w }
      g.beginPath(); g.arc(d.x, d.y, d.r, 0, 7); g.fillStyle = `rgba(160,245,255,${d.a})`; g.fill()
    }
    if (wave) {
      const k = Math.min(1, (now - wave) / 700)
      const r = rx + (far - rx) * (1 - Math.pow(1 - k, 3))
      g.beginPath(); g.arc(c0.x, c0.y, r, 0, 7)
      g.lineWidth = 10 * (1 - k) + 1; g.strokeStyle = `rgba(110,231,183,${.8 * (1 - k)})`; g.stroke()
    }
    raf = requestAnimationFrame(paint)
  }
  raf = requestAnimationFrame(paint)
}

function close() {
  if (closed) return
  closed = true
  closing.value = true
  named.value = true
  if (!reduce) {
    wave = typeof performance !== 'undefined' ? performance.now() : 0
    animate(glow.value, [{ opacity: 0 }, { opacity: 1, offset: .3 }, { opacity: .5 }], { duration: 700, fill: 'forwards' })
  }
  later(() => { leaving.value = true }, reduce ? 0 : LEAVE_AT)
  later(() => emit('done'), reduce ? 50 : DONE_AT)
}
function tryClose() { if (minPassed && props.ready) close() }

onMounted(() => {
  if (root.value?.clientWidth) { W.value = root.value.clientWidth; H.value = root.value.clientHeight }
  if (!reduce) build()
  later(() => { minPassed = true; tryClose() }, reduce ? 300 : MIN_MS)
  later(close, MAX_MS)
})
watch(() => props.ready, tryClose)
onBeforeUnmount(() => {
  timers.forEach(clearTimeout)
  if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
})
</script>

<template>
  <div ref="root" :class="['ss', { named, leaving }]" role="status" :aria-label="`${APP_NAME}を起動しています`">
    <div ref="layer" class="ss-layer" aria-hidden="true" :style="{ transformOrigin: `${C.x}px ${C.y}px` }">
      <canvas ref="canvas" class="ss-dots" />
      <div ref="glow" class="ss-glow"
        :style="{ background: `radial-gradient(circle at ${C.x}px ${C.y}px, rgba(52,211,153,.55), rgba(34,211,238,.18) 40%, transparent 75%)` }" />
      <svg class="ss-ringsvg" :viewBox="`0 0 ${W} ${H}`">
        <defs>
          <linearGradient id="ssRingGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#0e7490" /><stop offset=".55" stop-color="#22d3ee" /><stop offset="1" stop-color="#34d399" />
          </linearGradient>
          <filter id="ssGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <ellipse class="ss-ring" :cx="C.x" :cy="C.y" :rx="R.rx" :ry="R.ry" :transform="`rotate(-18 ${C.x} ${C.y})`" pathLength="520"
          :style="{ strokeDashoffset: 520 * (1 - shownProgress) }" />
      </svg>
    </div>
    <div class="ss-name">{{ APP_NAME }}<small v-if="APP_TAGLINE">{{ APP_TAGLINE }}</small></div>
  </div>
</template>

<style scoped>
.ss {
  position: fixed; inset: 0; z-index: 10000; overflow: hidden;
  background: radial-gradient(120% 80% at 50% 40%, #0c2a33 0%, #061317 70%); color: #e6fbff;
  transition: opacity .62s ease-in;
}
.ss.leaving { opacity: 0; pointer-events: none; }
.ss-layer { position: absolute; inset: 0; transition: transform .62s cubic-bezier(.6,0,.8,.4), opacity .62s ease-in; }
/* 輪をくぐってホームへ抜ける */
.ss.leaving .ss-layer { transform: scale(3.2); opacity: 0; }
/* named と同時に付くので詳しさを上げる */
.ss.named.leaving .ss-name { opacity: 0; transform: translateY(12px); transition: opacity .3s ease, transform .3s ease; }
.ss-dots { position: absolute; inset: 0; width: 100%; height: 100%; }
.ss-glow { position: absolute; inset: 0; opacity: 0; pointer-events: none; }
.ss-ringsvg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.ss-ring { fill: none; stroke: url(#ssRingGrad); stroke-width: 12; stroke-linecap: round; filter: url(#ssGlow); stroke-dasharray: 520; stroke-dashoffset: 520;
  transition: stroke-dashoffset .45s cubic-bezier(.3,.7,.2,1); }
@media (prefers-reduced-motion: reduce) {
  .ss-ring, .ss-layer, .ss { transition: none; }
  .ss.leaving .ss-layer { transform: none; }
}
.ss.named .ss-ring { animation: ss-flash .5s ease; }
@keyframes ss-flash { 50% { stroke-width: 18; } }
.ss-name {
  position: absolute; left: 0; right: 0; bottom: calc(18% + env(safe-area-inset-bottom, 0px)); text-align: center;
  letter-spacing: .3em; font-weight: 800; font-size: 24px; opacity: 0; transform: translateY(8px); transition: opacity .4s ease, transform .4s ease;
}
.ss-name small { display: block; font-size: 11px; letter-spacing: .12em; font-weight: 600; color: #7fa3ad; margin-top: 6px; }
.ss.named .ss-name { opacity: 1; transform: none; }
.ss-layer :deep(.ss-person) { position: absolute; width: 46px; height: 52px; margin: -26px 0 0 -23px; opacity: 0; color: #5eead4; filter: drop-shadow(0 0 8px rgba(94, 234, 212, .55)); }
.ss-layer :deep(.ss-person svg) { width: 100%; height: 100%; }
.ss-layer :deep(.ss-card) {
  position: absolute; left: 0; top: 0; width: 40px; height: 54px; margin: -27px 0 0 -20px; border-radius: 8px;
  background: rgba(186, 240, 255, .22); border: 1.5px solid rgba(210, 250, 255, .8);
  box-shadow: 0 0 14px rgba(52, 211, 153, .45), inset 0 0 10px rgba(255,255,255,.25); will-change: transform, opacity;
}
.ss-layer :deep(.ss-card.g) { background: rgba(110, 231, 183, .24); }
.ss-layer :deep(.ss-card.b) { background: rgba(96, 165, 250, .26); }
</style>
