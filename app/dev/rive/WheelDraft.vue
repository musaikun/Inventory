<template>
  <section class="wheel-draft" aria-labelledby="draft-title">
    <h2 id="draft-title">既存UIからの素材案</h2>
    <p>ホイールの展開・収納を試せます。これはSVGで作った動きの試作です。Riveでの再生・性能評価は、.rivへ仕上げてから行います。</p>
    <div class="controls">
      <button @click="animate(1)">展開する</button>
      <button @click="animate(0)">収納する</button>
      <label>動きの時間
        <select v-model.number="duration">
          <option :value="400">400ms</option>
          <option :value="700">700ms（現在のUI）</option>
          <option :value="1000">1000ms</option>
        </select>
      </label>
    </div>
    <label class="draft-scrub">開き具合 {{ Math.round(progress * 100) }}%
      <input :value="progress" type="range" min="0" max="1" step="0.01" @input="scrub" />
    </label>
    <div class="draft-phone">
      <div class="draft-heading">保管場所へ振り分ける <span>サンプル</span></div>
      <div class="draft-art" role="img" aria-label="青い中央カードを残して開閉するホイールの素材案" v-html="artwork" />
      <div class="draft-items">
        <p>品目一覧</p>
        <div v-for="item in ['牛乳', 'バター', '生クリーム']" :key="item">{{ item }}<span>＋</span></div>
      </div>
    </div>
    <p class="draft-note">分類名・件数は仮の表示です。素材のSVGは枠・バッジ・操作部を編集できるグループに分け、文字は含めていません。</p>
    <div class="draft-downloads">
      <a href="./assets/wheel-open.svg" download>展開時のSVG</a>
      <a href="./assets/wheel-closed.svg" download>収納時のSVG</a>
      <a href="./assets/wheel-rive-guide.md" download>Riveでの制作手順</a>
    </div>
  </section>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { wheelSvg, REFERENCE_DURATION } from './wheelDraft.mjs'

const progress = ref(1)
const duration = ref(REFERENCE_DURATION)
const artwork = computed(() => wheelSvg(progress.value, true))
let raf = 0
let target = 1
let motion = null
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

function animate(to) {
  cancelAnimationFrame(raf)
  target = to
  if (motion?.matches) { progress.value = to; return }
  const from = progress.value
  const start = performance.now()
  const ms = duration.value
  function step(now) {
    const t = Math.min(1, (now - start) / ms)
    progress.value = from + (to - from) * ease(t)
    if (t < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
}
function scrub(event) {
  cancelAnimationFrame(raf)
  progress.value = Number(event.target.value)
  target = progress.value
}
function settleMotion() {
  if (motion?.matches || document.hidden) {
    cancelAnimationFrame(raf)
    progress.value = target
  }
}
onMounted(() => {
  motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  motion.addEventListener('change', settleMotion)
  document.addEventListener('visibilitychange', settleMotion)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  motion?.removeEventListener('change', settleMotion)
  document.removeEventListener('visibilitychange', settleMotion)
})
</script>

<style scoped>
.wheel-draft { padding-bottom: 28px; margin-bottom: 28px; border-bottom: 1px solid #cbd5e1; }
h2 { margin: 0 0 8px; font-size: 20px; }
.draft-scrub { width: 375px; max-width: 100%; margin-bottom: 16px; }
.draft-phone { width: 375px; max-width: 100%; overflow: hidden; border: 1px solid #cbd5e1; border-radius: 14px; background: #fff; }
.draft-heading { padding: 14px; font-weight: 700; border-bottom: 1px solid #e2e8f0; }
.draft-heading span { float: right; font-size: 13px; color: #64748b; font-weight: 400; }
.draft-art { line-height: 0; }
.draft-art :deep(svg) { width: 100%; height: auto; font-family: system-ui, sans-serif; }
.draft-items { border-top: 1px solid #e2e8f0; padding: 12px; background: #f8fafc; }
.draft-items p { margin: 0 0 8px; color: #64748b; font-size: 13px; }
.draft-items div { display: flex; justify-content: space-between; padding: 12px; margin-top: 6px; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; }
.draft-items span { color: #2563eb; }
.draft-note { max-width: 650px; color: #475569; }
.draft-downloads { display: flex; flex-wrap: wrap; gap: 12px; }
a { color: #1d4ed8; min-height: 44px; display: inline-flex; align-items: center; }
</style>
