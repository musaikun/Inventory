<script setup>
/**
 * 時刻を押して選ぶ（User決定 2026-11-07: 端末の時計の画面を重ねない）。
 * 時（0〜23）と分（5分ごと）のボタン。時を押すと分はそのまま（無ければ 00）、分を押すと @done。
 * min を渡すと、それより前の時は薄くする（終わりの時刻）
 */
import { computed } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  min:        { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'done'])

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))
const hh = computed(() => props.modelValue.slice(0, 2))
const mm = computed(() => props.modelValue.slice(3, 5))
function pickHour(h) { emit('update:modelValue', `${h}:${mm.value || '00'}`) }
function pickMin(m) { const v = `${hh.value || '09'}:${m}`; emit('update:modelValue', v); emit('done', v) }
const dim = h => !!props.min && h < props.min.slice(0, 2)
</script>

<template>
  <div class="tg">
    <span class="tg-s">時</span>
    <div class="tg-h">
      <button v-for="h in HOURS" :key="h" type="button" :class="{ on: h === hh, dim: dim(h) }" :data-hour="h" @click="pickHour(h)">{{ Number(h) }}</button>
    </div>
    <span class="tg-s">分</span>
    <div class="tg-m">
      <button v-for="m in MINS" :key="m" type="button" :class="{ on: m === mm }" :data-min="m" @click="pickMin(m)">{{ m }}</button>
    </div>
  </div>
</template>

<style scoped>
.tg { display: grid; gap: 6px; }
.tg-s { font-size: 11px; font-weight: 800; color: var(--text-muted); }
.tg-h { display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; }
.tg-m { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; }
.tg button { border: 1px solid var(--border, #dbe5e8); background: var(--surface, #fff); border-radius: 8px; min-height: 38px; font: inherit; font-size: 14px; font-weight: 800; color: var(--text); cursor: pointer; font-variant-numeric: tabular-nums; }
.tg button.dim { opacity: .4; }
.tg button.on { background: var(--primary, #0e7490); border-color: var(--primary, #0e7490); color: #fff; }
</style>
