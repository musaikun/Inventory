<script setup>
/**
 * 足す画面の中で日付・時刻を選ぶ（User決定 2026-11-07）。
 * 端末の日付・時刻の画面（時計のモーダル）を重ねず、押すとこのシートの中に開く。開くのは1つずつ。
 * - 日付: 月のカレンダー。左右に払うと月が変わる（‹ › でも）。「今日」「明日」は一押し
 * - 時刻: 時（0〜23）と分（5分ごと）を押すだけ（TimeGrid）。分を押したら閉じる。「なし」で外せる
 * 時刻を足す欄（繰り返しのチェック表）は @picked で受け取る（時を押した時点ではまだ足さない）
 * 使い方: <InlinePick v-model="day" mode="date" label="日付" :min="today" />
 */
import { ref, computed, watch } from 'vue'
import { localDateKey } from '../utils/localDate.js'
import { useHorizontalSwipe } from '../composables/useSwipe.js'
import { openPick, nextPickId } from './inlinePickState.js'
import TimeGrid from './TimeGrid.vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  mode:       { type: String, default: 'date' },   // 'date' | 'time'
  label:      { type: String, required: true },
  min:        { type: String, default: '' },       // 日付: これより前は選べない。時刻: これ以前は薄く（終わりの時刻）
  clearable:  { type: Boolean, default: false },
  empty:      { type: String, default: 'なし' },
})
const emit = defineEmits(['update:modelValue', 'picked'])   // picked: 決めて閉じたとき（時刻を足す欄で使う）

const id = nextPickId()
const open = computed(() => openPick.value === id)
function toggle() { openPick.value = open.value ? null : id }
function set(v, close = true) {
  emit('update:modelValue', v)
  if (close) { openPick.value = null; emit('picked', v) }
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const shown = computed(() => {
  const v = props.modelValue
  if (!v) return props.empty
  if (props.mode === 'time') return v
  const d = new Date(`${v}T00:00:00`)
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEK[d.getDay()]}）`
})

// ── 日付 ──
const today = localDateKey()
const tomorrow = localDateKey(new Date(Date.now() + 86400_000))
const _ym = v => { const s = v || today; return { y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)) - 1 } }
const ym = ref(_ym(props.modelValue))
watch(open, o => { if (o && props.mode === 'date') ym.value = _ym(props.modelValue) })
const slide = ref('')
function move(n) {
  const d = new Date(ym.value.y, ym.value.m + n, 1)
  ym.value = { y: d.getFullYear(), m: d.getMonth() }
  slide.value = n > 0 ? 'next' : 'prev'
}
const swipe = useHorizontalSwipe({ onLeft: () => move(1), onRight: () => move(-1), threshold: 40 })
const monthLabel = computed(() => `${ym.value.y}年${ym.value.m + 1}月`)
const cells = computed(() => {
  const { y, m } = ym.value
  const first = new Date(y, m, 1).getDay()
  const out = Array.from({ length: first }, (_, i) => ({ blank: true, k: `b${i}` }))
  const days = new Date(y, m + 1, 0).getDate()
  for (let d = 1; d <= days; d++) {
    const key = localDateKey(new Date(y, m, d))
    out.push({ k: key, d, key, dow: (first + d - 1) % 7, off: !!props.min && key < props.min })
  }
  return out
})

</script>

<template>
  <div :class="['ip', { open }]">
    <button type="button" class="ip-f" :aria-label="label" :aria-expanded="open" :data-value="modelValue" @click="toggle">
      <span class="ip-l">{{ label }}</span>
      <b :class="{ none: !modelValue }">{{ shown }}</b>
      <i aria-hidden="true">{{ open ? '▴' : '▾' }}</i>
    </button>

    <div v-if="open && mode === 'date'" class="ip-p ip-cal" @touchstart.passive="swipe.onTouchStart" @touchmove.passive="swipe.onTouchMove" @touchend.passive="swipe.onTouchEnd" @touchcancel.passive="swipe.onTouchCancel">
      <div class="ip-ch">
        <button type="button" aria-label="前の月" @click="move(-1)">‹</button>
        <b>{{ monthLabel }}</b>
        <button type="button" aria-label="次の月" @click="move(1)">›</button>
      </div>
      <div :key="monthLabel" :class="['ip-g', slide]">
        <span v-for="w in WEEK" :key="w" class="ip-w">{{ w }}</span>
        <template v-for="c in cells" :key="c.k">
          <span v-if="c.blank"></span>
          <button v-else type="button" :class="['ip-d', { on: c.key === modelValue, today: c.key === today, sun: c.dow === 0, sat: c.dow === 6 }]"
            :data-day="c.key" :disabled="c.off" @click="set(c.key)">{{ c.d }}</button>
        </template>
      </div>
      <div class="ip-q">
        <button type="button" :disabled="!!min && today < min" @click="set(today)">今日</button>
        <button type="button" :disabled="!!min && tomorrow < min" @click="set(tomorrow)">明日</button>
        <button v-if="clearable && modelValue" type="button" @click="set('')">{{ empty }}にする</button>
      </div>
    </div>

    <div v-if="open && mode === 'time'" class="ip-p ip-tm">
      <TimeGrid :model-value="modelValue" :min="min" @update:model-value="v => set(v, false)" @done="v => set(v)" />
      <div class="ip-q">
        <button v-if="modelValue" type="button" class="ok" @click="set(modelValue)">{{ modelValue }} で決める</button>
        <button v-if="clearable && modelValue" type="button" @click="set('')">{{ empty }}にする</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ip { display: grid; gap: 6px; min-width: 0; }
.ip-f { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 44px; border: 1.5px solid #b9d3da; border-radius: 10px; background: var(--surface, #fff);
  padding: 4px 10px; font: inherit; color: var(--text); cursor: pointer; text-align: left; box-sizing: border-box; }
.ip.open .ip-f { border-color: var(--primary, #0e7490); box-shadow: 0 0 0 3px rgba(14,116,144,.15); }
.ip-l { font-size: 11px; font-weight: 800; color: var(--text-muted); flex: none; }
.ip-f b { flex: 1; min-width: 0; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ip-f b.none { color: var(--text-muted); font-weight: 700; }
.ip-f i { font-style: normal; font-size: 11px; color: var(--text-muted); }
.ip-p { border: 1.5px solid #d6e6ea; border-radius: 14px; background: #f7fbfc; padding: 10px; display: grid; gap: 8px; }
.ip-cal { touch-action: pan-y; user-select: none; }
.ip-ch { display: flex; align-items: center; justify-content: space-between; }
.ip-ch b { font-size: 14.5px; }
.ip-ch button { border: none; background: none; font-size: 22px; line-height: 1; min-width: 44px; min-height: 36px; color: var(--primary, #0e7490); cursor: pointer; }
.ip-g { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; text-align: center; }
.ip-g.next { animation: ip-in-r .18s ease-out; }
.ip-g.prev { animation: ip-in-l .18s ease-out; }
@keyframes ip-in-r { from { transform: translateX(24px); opacity: .3; } to { transform: none; opacity: 1; } }
@keyframes ip-in-l { from { transform: translateX(-24px); opacity: .3; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .ip-g.next, .ip-g.prev { animation: none; } }
.ip-w { font-size: 10.5px; font-weight: 800; color: var(--text-muted); padding: 2px 0; }
.ip-d { border: none; background: none; border-radius: 10px; min-height: 38px; font: inherit; font-size: 14px; font-weight: 700; color: var(--text); cursor: pointer; }
.ip-d.sun { color: #dc2626; } .ip-d.sat { color: #2563eb; }
.ip-d.today { box-shadow: inset 0 0 0 1.5px var(--primary, #0e7490); }
.ip-d.on { background: var(--primary, #0e7490); color: #fff; }
.ip-d:disabled { opacity: .3; cursor: default; }
.ip-q { display: flex; gap: 6px; flex-wrap: wrap; }
.ip-q button { border: 1px solid var(--border, #dbe5e8); background: var(--surface, #fff); border-radius: 999px; padding: 6px 12px; font: inherit; font-size: 12.5px; font-weight: 800; color: var(--primary, #0e7490); cursor: pointer; }
.ip-q button.ok { background: var(--primary, #0e7490); color: #fff; border-color: var(--primary, #0e7490); }
.ip-q button:disabled { opacity: .4; }
</style>
