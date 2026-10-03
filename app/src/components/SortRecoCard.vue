<script setup>
/**
 * 並び替え（保管場所での振り分け）のおすすめ（User決定 2026-10-03）。
 * 振り分けると棚卸の一覧が歩く順に並び、効き目が大きいので在庫タブで目立たせる。
 * - 1つも振り分けていない店：カードの中で「ばらばらの品目が保管場所ごとにそろう」様子を繰り返し見せ、
 *   カードはゆっくり光り、ボタンは小さく脈打つ（動きを控える設定の端末では、そろった絵だけ）
 * - 途中まで振り分けた店：進み具合を出して続きへ誘う
 * - ✕ は二度と出さない／「あとで」は数日後にまた出す（composables/useHints・各種設定から戻せる）
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  // 'none' = まだ1つも振り分けていない / 'half' = 途中まで
  stage: { type: String, required: true },
  axisName: { type: String, default: '' },
  assigned: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
})
const emit = defineEmits(['start', 'later', 'dismiss'])

// カードの中の小さな実演（品目名は例）。c = 0 冷蔵庫 / 1 冷凍庫 / 2 棚
const DEMO = [['牛乳', 0], ['冷凍エビ', 1], ['パスタ', 2], ['生クリーム', 0], ['アイス', 1], ['トマト缶', 2], ['チーズ', 0], ['冷凍ポテト', 1], ['オリーブ油', 2]]
const SCATTER = [[52, 64], [6, 30], [70, 26], [30, 48], [78, 72], [12, 78], [62, 46], [38, 84], [2, 54]]   // % / px
const COLS = ['冷蔵庫', '冷凍庫', '棚']
const sorted = ref(false)
const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
let timer = null
onMounted(() => {
  if (props.stage !== 'none') return
  if (reduced) { sorted.value = true; return }
  timer = setInterval(() => { sorted.value = !sorted.value }, 1800)
})
onUnmounted(() => clearInterval(timer))

const demoItems = computed(() => {
  const counts = [0, 0, 0]
  return DEMO.map(([name, c], i) => {
    const [x, y] = sorted.value ? [c * 34 + 2, 22 + (counts[c]++) * 24] : SCATTER[i]
    return { name, c, style: { left: `${x}%`, top: `${y}px` } }
  })
})
const pct = computed(() => (props.total ? Math.round((props.assigned / props.total) * 100) : 0))
</script>

<template>
  <section :class="['sr', { anim: stage === 'none' }]" aria-label="並び替えのおすすめ">
    <button type="button" class="sr-x" aria-label="このおすすめを消す" title="消す（各種設定から戻せます）" @click="emit('dismiss')">✕</button>
    <template v-if="stage === 'none'">
      <div class="sr-t"><span class="sr-badge">おすすめ</span>保管場所で並べると、棚卸がぐっと速くなります</div>
      <div :class="['sr-demo', { sorted }]" aria-hidden="true">
        <span v-for="(c, i) in COLS" :key="c" class="sr-col" :style="{ left: `${i * 34 + 2}%` }">{{ c }}</span>
        <span v-for="it in demoItems" :key="it.name" :class="['sr-it', `c${it.c}`]" :style="it.style">{{ it.name }}</span>
        <span class="sr-cap">{{ sorted ? '歩く順にそろった ✓' : 'ばらばら…' }}</span>
      </div>
      <p class="sr-p">冷蔵庫・冷凍庫・棚など、実際に歩く順に品目を並べておくと、棚卸の一覧がその順に並び、探す時間がなくなります。</p>
      <div class="sr-a">
        <button type="button" class="sr-go pulse" @click="emit('start')">並び替えを始める</button>
        <button type="button" class="sr-later" @click="emit('later')">あとで</button>
      </div>
    </template>
    <template v-else>
      <div class="sr-t">⇅ {{ axisName }}の振り分け {{ assigned }} / {{ total }}</div>
      <div class="sr-bar" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100"><i :style="{ width: `${pct}%` }"></i></div>
      <p class="sr-p">残り{{ total - assigned }}品目を振り分けると、棚卸の一覧が歩く順に並びます。</p>
      <div class="sr-a">
        <button type="button" class="sr-go" @click="emit('start')">続きを振り分ける</button>
        <button type="button" class="sr-later" @click="emit('later')">あとで</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.sr {
  position: relative; margin: 0 12px 10px; padding: 12px 14px; border-radius: 16px; display: grid; gap: 8px;
  border: 1.5px solid var(--primary); background: linear-gradient(150deg, var(--primary-weak), var(--surface) 65%);
}
.sr.anim { overflow: hidden; animation: sr-glow 2.6s ease-in-out infinite; }
.sr.anim::after {
  content: ''; position: absolute; top: 0; bottom: 0; width: 40%; left: -50%; pointer-events: none;
  background: linear-gradient(100deg, transparent, rgba(255, 255, 255, .45), transparent); animation: sr-sheen 3.4s ease-in-out infinite;
}
@keyframes sr-glow { 0%, 100% { box-shadow: 0 0 0 0 rgba(34, 211, 238, 0); } 50% { box-shadow: 0 0 0 4px rgba(34, 211, 238, .22), 0 0 22px rgba(34, 211, 238, .28); } }
@keyframes sr-sheen { 0% { left: -50%; } 60%, 100% { left: 130%; } }
.sr-x {
  position: absolute; top: 6px; right: 6px; z-index: 2; width: 32px; height: 32px; border-radius: 50%;
  border: none; background: transparent; color: var(--text-muted); font-size: 14px; cursor: pointer;
}
.sr-t { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-right: 30px; font-size: 15px; font-weight: 800; color: var(--text); line-height: 1.4; }
.sr-badge { flex: none; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 999px; background: var(--grad-btn); color: var(--on-grad); }
.sr-p { margin: 0; font-size: 12.5px; line-height: 1.6; color: var(--text-muted); }
.sr-demo { position: relative; height: 132px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); overflow: hidden; }
.sr-col { position: absolute; top: 4px; font-size: 10.5px; font-weight: 800; color: var(--primary); opacity: 0; transition: opacity .4s ease; }
.sr-demo.sorted .sr-col { opacity: 1; }
.sr-it {
  position: absolute; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; white-space: nowrap;
  background: var(--bg); color: var(--text); border: 1px solid var(--border);
  transition: left .7s cubic-bezier(.3, .7, .2, 1), top .7s cubic-bezier(.3, .7, .2, 1), background .4s ease;
}
.sr-demo.sorted .sr-it.c0 { background: #cffafe; }
.sr-demo.sorted .sr-it.c1 { background: #cffafe; }
.sr-demo.sorted .sr-it.c2 { background: #d1fae5; }
.sr-cap { position: absolute; right: 8px; bottom: 5px; font-size: 10.5px; font-weight: 700; color: var(--text-muted); }
.sr-bar { height: 6px; border-radius: 6px; background: var(--border); overflow: hidden; }
.sr-bar i { display: block; height: 100%; background: var(--grad-ring); }
.sr-a { display: flex; align-items: center; gap: 10px; }
.sr-go {
  min-height: 44px; padding: 0 18px; border: none; border-radius: 12px; cursor: pointer;
  background: var(--grad-btn); color: var(--on-grad); font-size: 14px; font-weight: 800;
}
.sr-go.pulse { animation: sr-pulse 1.6s ease-in-out infinite; }
@keyframes sr-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }
.sr-later { min-height: 44px; padding: 0 8px; border: none; background: none; color: var(--text-muted); font-size: 12.5px; cursor: pointer; }
@media (prefers-reduced-motion: reduce) {
  .sr.anim, .sr.anim::after, .sr-go.pulse { animation: none; }
  .sr-it { transition: none; }
}
</style>
