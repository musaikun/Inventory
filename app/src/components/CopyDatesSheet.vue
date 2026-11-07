<script setup>
/**
 * やること・チェック表を別の日にコピーする（User決定 2026-11-05・モック docs/mocks/task-create.html 2-2）。
 * 日は何日でも選べる（押すたびに選ぶ・外す）。今日より前は選べない。元の日は枠。中身（項目・時刻・担当）はそのまま、担当だけ替えられる。
 * 実際に作るのは親（コピーする中身の種類で作り方が違う）。ここは日と担当を決めて返すだけ
 */
import LineIcon from './LineIcon.vue'
import { ref, computed, onUnmounted } from 'vue'
import { useHorizontalSwipe } from '../composables/useSwipe.js'
import { localDateKey } from '../utils/localDate.js'
import { staffNames } from '../composables/useAuth.js'
import { isMeId } from '../composables/useDeviceId.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

const props = defineProps({
  title: { type: String, required: true },
  sub: { type: String, default: '' },
  source: { type: String, default: '' },   // 元の日（枠で示す）
  who: { type: String, default: 'all' },   // 'all' | 'p:<id>'
})
const emit = defineEmits(['close', 'copy'])
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const today = localDateKey()
const _m = d => { const [y, m] = d.split('-').map(Number); return { y, m } }
const month = ref(_m(props.source && props.source > today ? props.source : today))
// 左右に払っても月が変わる（User決定 2026-11-07）
const swipe = useHorizontalSwipe({ onLeft: () => step(1), onRight: () => step(-1), threshold: 40 })
function step(d) { let { y, m } = month.value; m += d; if (m < 1) { m = 12; y-- } else if (m > 12) { m = 1; y++ } month.value = { y, m } }
const cells = computed(() => {
  const { y, m } = month.value
  const first = new Date(y, m - 1, 1).getDay(), days = new Date(y, m, 0).getDate()
  const out = []
  for (let i = 0; i < first; i++) out.push({ blank: true, key: `b${i}` })
  for (let d = 1; d <= days; d++) {
    const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    out.push({ key, d, past: key < today, src: key === props.source })
  }
  return out
})
const picked = ref([])
function toggle(c) {
  if (c.blank || c.past) return
  picked.value = picked.value.includes(c.key) ? picked.value.filter(x => x !== c.key) : [...picked.value, c.key].sort()
}
const people = computed(() => staffNames.value)
const hasStaff = computed(() => people.value.some(p => !p.owner))
const whoSel = ref(props.who)
const md = k => { const [, m, d] = k.split('-').map(Number); return `${m}/${d}` }
const label = computed(() => (picked.value.length ? `${picked.value.length}日にコピー（${picked.value.slice(0, 4).map(md).join('・')}${picked.value.length > 4 ? '…' : ''}）` : '日を選んでください'))
function copy() {
  if (!picked.value.length) return
  const v = whoSel.value
  emit('copy', { dates: picked.value, who: v === 'keep' ? props.who : v })
}
onUnmounted(registerInnerLayerCloser(() => { emit('close'); return true }))
</script>

<template>
  <Teleport to="body">
    <div class="cd-bg" @click.self="emit('close')">
      <section class="cd" role="dialog" aria-label="別の日にコピー">
        <div class="cd-h"><b><LineIcon name="file" /> 別の日にコピー</b><button type="button" class="cd-x" @click="emit('close')">やめる</button></div>
        <div class="cd-src"><b>{{ title }}</b><small v-if="sub">{{ sub }}</small></div>
        <div class="cd-bar">
          <button type="button" aria-label="前の月" @click="step(-1)">‹</button>
          <b>{{ month.y }}年{{ month.m }}月</b>
          <button type="button" aria-label="次の月" @click="step(1)">›</button>
        </div>
        <div class="cd-cal" @touchstart.passive="swipe.onTouchStart" @touchmove.passive="swipe.onTouchMove" @touchend.passive="swipe.onTouchEnd" @touchcancel.passive="swipe.onTouchCancel">
          <span v-for="w in WEEK" :key="w" class="cd-wd">{{ w }}</span>
          <template v-for="c in cells" :key="c.key">
            <span v-if="c.blank"></span>
            <button v-else type="button" :class="['cd-d', { on: picked.includes(c.key), src: c.src, past: c.past }]" :disabled="c.past"
              :aria-pressed="picked.includes(c.key)" :aria-label="`${md(c.key)}${c.src ? '（元の日）' : ''}`" :data-day="c.key" @click="toggle(c)">{{ c.d }}</button>
          </template>
        </div>
        <label v-if="hasStaff" class="cd-lb">担当
          <select v-model="whoSel" class="cd-in">
            <option :value="who">そのまま</option>
            <option v-if="who !== 'all'" value="all">全員</option>
            <option v-for="p in people" :key="p.id" :value="`p:${p.id}`" :disabled="`p:${p.id}` === who">{{ p.name }}{{ isMeId(p.id) ? '（自分）' : '' }}</option>
          </select>
        </label>
        <button type="button" class="cd-go" :disabled="!picked.length" @click="copy">{{ label }}</button>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.cd-bg { position: fixed; inset: 0; z-index: 140; background: rgba(6,34,43,.4); display: flex; align-items: flex-end; justify-content: center; }
.cd { width: 100%; max-width: 600px; max-height: 92dvh; overflow-y: auto; background: var(--surface, #fff); border-radius: 20px 20px 0 0; padding: 16px 16px calc(18px + env(safe-area-inset-bottom)); display: grid; gap: 10px; box-sizing: border-box; }
.cd-h { display: flex; align-items: center; } .cd-h b { flex: 1; font-size: 16px; }
.cd-x { border: none; background: none; color: var(--text-muted); font-weight: 700; cursor: pointer; min-height: 40px; }
.cd-src { background: var(--bg, #f3f6f8); border-radius: 12px; padding: 9px 12px; display: grid; gap: 2px; }
.cd-src b { font-size: 14px; } .cd-src small { font-size: 11.5px; color: var(--text-muted); font-weight: 700; }
.cd-bar { display: flex; justify-content: space-between; align-items: center; }
.cd-bar button { border: none; background: var(--bg, #f3f6f8); border-radius: 8px; width: 36px; height: 32px; font-size: 15px; cursor: pointer; }
.cd-cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.cd-wd { text-align: center; font-size: 10.5px; color: var(--text-muted); font-weight: 700; }
.cd-d { aspect-ratio: 1; border: none; border-radius: 9px; background: var(--bg, #f3f6f8); font: inherit; font-size: 13px; font-weight: 800; color: var(--text); cursor: pointer; }
.cd-d.on { background: var(--primary, #0e7490); color: #fff; }
.cd-d.src { box-shadow: inset 0 0 0 2px var(--primary, #0e7490); }
.cd-d.past { background: none; color: #cbd5e1; cursor: default; }
.cd-lb { display: grid; gap: 3px; font-size: 11.5px; font-weight: 800; color: var(--text-muted); }
.cd-in { min-height: 42px; border: 1px solid var(--border); border-radius: 10px; padding: 0 10px; font: inherit; font-size: 15px; background: var(--surface); color: var(--text); }
.cd-go { min-height: 46px; border: none; border-radius: 12px; background: var(--grad-btn); color: #08323c; font-weight: 800; font-size: 14.5px; cursor: pointer; }
.cd-go:disabled { opacity: .5; }
</style>
