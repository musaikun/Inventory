<script setup>
/**
 * 日誌の上の「週の帯」。下に引く（か ▾ を押す）と月に広がる（User決定 2026-10-25・モック docs/mocks/journal-calendar-v4.html）。
 * - 日ごとに済み具合の線（緑＝全部済み・黄＝一部・赤＝やり残し・灰＝まだ）と、大きな業務の印1つ（📦棚卸・🧾発注）
 * - 先の日は予定（発注日など）を薄く。日を押すとその日へ
 * - 週は左右に払って送る。月は ‹ › で送る
 * info(date) → { st: 'y'|'p'|'x'|'t'|'', icon: '', plan: '' }
 */
import { ref, computed, watch } from 'vue'
import { localDateKey } from '../utils/localDate.js'
import { isHoliday } from '../services/jpHolidays.js'
import { useHorizontalSwipe } from '../composables/useSwipe.js'

const props = defineProps({
  modelValue: { type: String, required: true },
  today: { type: String, required: true },
  info: { type: Function, required: true },
})
const emit = defineEmits(['update:modelValue'])
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const _d = k => new Date(k + 'T00:00:00')
const _add = (k, n) => { const d = _d(k); d.setDate(d.getDate() + n); return localDateKey(d) }

const expanded = ref(false)
// 週: 選んだ日を含む週（日曜はじまり）
const weekStart = computed(() => _add(props.modelValue, -_d(props.modelValue).getDay()))
const weekDays = computed(() => Array.from({ length: 7 }, (_, i) => _add(weekStart.value, i)))
// 月: 選んだ日の月から ‹ › で送る
const ym = ref({ y: 0, m: 0 })
function _syncMonth() { const d = _d(props.modelValue); ym.value = { y: d.getFullYear(), m: d.getMonth() } }
_syncMonth()
watch(() => props.modelValue, _syncMonth)
const monthCells = computed(() => {
  const { y, m } = ym.value
  const first = new Date(y, m, 1).getDay()
  const last = new Date(y, m + 1, 0).getDate()
  return [...Array(first).fill(null), ...Array.from({ length: last }, (_, i) => localDateKey(new Date(y, m, i + 1)))]
})
function stepMonth(n) { const d = new Date(ym.value.y, ym.value.m + n, 1); ym.value = { y: d.getFullYear(), m: d.getMonth() } }
function pick(k) { emit('update:modelValue', k) }
function stepWeek(n) { pick(_add(props.modelValue, n * 7)) }

const cls = k => {
  const dow = _d(k).getDay()
  return { on: k === props.modelValue, today: k === props.today, sun: dow === 0 || isHoliday(_d(k)), sat: dow === 6, fut: k > props.today }
}
const swipe = useHorizontalSwipe({ onLeft: () => (expanded.value ? stepMonth(1) : stepWeek(1)), onRight: () => (expanded.value ? stepMonth(-1) : stepWeek(-1)), threshold: 50 })
// 下に引くと月・上に引くと週
let _y0 = null
function onTouchStart(e) { _y0 = e.touches?.[0]?.clientY ?? null; swipe.onTouchStart(e) }
function onTouchEnd(e) {
  const y = e.changedTouches?.[0]?.clientY
  if (_y0 != null && y != null) {
    if (y - _y0 > 40 && !expanded.value) expanded.value = true
    else if (_y0 - y > 40 && expanded.value) expanded.value = false
  }
  _y0 = null
  swipe.onTouchEnd(e)
}
const monthLabel = computed(() => `${ym.value.y}年${ym.value.m + 1}月`)
</script>

<template>
  <div class="jw" @touchstart.passive="onTouchStart" @touchmove.passive="swipe.onTouchMove" @touchend.passive="onTouchEnd" @touchcancel.passive="swipe.onTouchCancel">
    <div v-if="!expanded" class="jw-wk" role="tablist" aria-label="週">
      <button v-for="k in weekDays" :key="k" type="button" role="tab" :aria-selected="k === modelValue" :class="['jw-d', cls(k)]" @click="pick(k)">
        <span class="w">{{ WEEK[_d(k).getDay()] }}</span>
        <b>{{ _d(k).getDate() }}</b>
        <i :class="['st', info(k).st]"></i>
        <em>{{ info(k).icon }}</em>
      </button>
    </div>
    <div v-else class="jw-mo">
      <div class="jw-mh">
        <button type="button" aria-label="前の月" @click="stepMonth(-1)">‹</button>
        <b>{{ monthLabel }}</b>
        <button type="button" aria-label="次の月" @click="stepMonth(1)">›</button>
      </div>
      <div class="jw-grid">
        <span v-for="w in WEEK" :key="w" class="jw-w">{{ w }}</span>
        <template v-for="(k, i) in monthCells" :key="k || `b${i}`">
          <span v-if="!k" class="jw-b"></span>
          <button v-else type="button" :class="['jw-c', cls(k)]" :aria-label="k" @click="pick(k); expanded = false">
            <span class="n">{{ _d(k).getDate() }}</span>
            <span v-if="info(k).icon" class="ic">{{ info(k).icon }}</span>
            <span v-if="info(k).plan" class="pl">{{ info(k).plan }}</span>
            <i :class="['st', info(k).st]"></i>
          </button>
        </template>
      </div>
    </div>
    <button type="button" class="jw-pull" :aria-label="expanded ? '週にもどす' : '月を見る'" :aria-expanded="expanded" @click="expanded = !expanded"><i></i></button>
  </div>
</template>

<style scoped>
.jw { display: grid; gap: 2px; touch-action: pan-y; }
.jw-wk { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
.jw-d { border: none; background: none; font: inherit; cursor: pointer; display: grid; justify-items: center; gap: 2px; padding: 4px 0 5px; border-radius: 12px; color: var(--text-muted); }
.jw-d .w { font-size: 10px; font-weight: 800; }
.jw-d b { font-size: 15px; color: var(--text); }
.jw-d.sun b { color: #dc2626; } .jw-d.sat b { color: #2563eb; }
.jw-d em { font-style: normal; font-size: 10px; line-height: 1; height: 10px; }
.jw-d.fut em { opacity: .5; }
.jw-d.today b { text-decoration: underline; text-underline-offset: 3px; }
.jw-d.on { background: #0f2a33; color: #a5d8e3; } .jw-d.on b { color: #fff; }
.st { display: block; height: 4px; width: 60%; border-radius: 2px; background: #eef2f6; }
.st.y { background: #22c55e; } .st.p { background: #f59e0b; } .st.x { background: #ef4444; } .st.t { background: #cbd5e1; }
.jw-mh { display: flex; align-items: center; justify-content: space-between; padding: 0 4px 4px; }
.jw-mh b { font-size: 15px; }
.jw-mh button { border: none; background: #f1f5f9; border-radius: 10px; width: 36px; height: 30px; font-size: 16px; font-weight: 800; color: var(--text-muted); cursor: pointer; }
.jw-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
.jw-w { text-align: center; font-size: 10px; font-weight: 800; color: var(--text-muted); }
.jw-c { height: 48px; border: none; border-radius: 9px; background: #f8fafc; font: inherit; cursor: pointer; padding: 3px 4px; display: flex; flex-direction: column; align-items: flex-start; position: relative; overflow: hidden; text-align: left; }
.jw-c .n { font-size: 11px; font-weight: 800; color: var(--text); }
.jw-c.sun .n { color: #dc2626; } .jw-c.sat .n { color: #2563eb; }
.jw-c .ic { position: absolute; right: 3px; top: 3px; font-size: 10px; }
.jw-c .pl { font-size: 8.5px; font-weight: 900; color: #c2410c; border: 1px dashed #fdba74; border-radius: 4px; padding: 0 2px; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.jw-c .st { margin-top: auto; width: 100%; }
.jw-c.today { box-shadow: 0 0 0 2px var(--primary, #0e7490); }
.jw-c.on { box-shadow: 0 0 0 2px #0f172a; background: #fff; }
.jw-c.fut .ic { opacity: .5; }
.jw-pull { border: none; background: none; height: 14px; display: grid; place-items: center; cursor: pointer; padding: 0; }
.jw-pull i { width: 36px; height: 4px; border-radius: 2px; background: #cbd5e1; }
</style>
