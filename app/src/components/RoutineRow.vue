<script setup>
/**
 * 日誌のリストのルーティン1件（○。やること□と時刻の順に並べる・User決定 2026-10-25）。
 * 項目なしの1件は○を押せばその場で済む・取り消し。ほかは押すと✓の画面（今やる回）
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { markChecklistItem, canMarkChecklist, canUnmark } from '../composables/useChecklists.js'
import { isSimple, currentSlot, WHOLE } from '../services/checklistSchedule.js'
import { localDateKey } from '../utils/localDate.js'

const props = defineProps({
  day: { type: Object, required: true },   // dayChecklist の結果
  date: { type: String, required: true },
})
const emit = defineEmits(['open-run'])
const r = computed(() => props.day)
const nowHm = ref('')
let timer = null
const _tick = () => { const d = new Date(); nowHm.value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
onMounted(() => { _tick(); timer = setInterval(_tick, 60000) })
onUnmounted(() => clearInterval(timer))

const simple = computed(() => isSimple(r.value.cl) && r.value.totalSlots === 1)
const time = computed(() => r.value.slots.find(s => s.slot)?.slot || '')
const count = computed(() => (r.value.totalSlots > 1 ? `${r.value.doneSlots}/${r.value.totalSlots}` : simple.value ? '' : `${r.value.filled}/${r.value.total}`))
const who = computed(() => (r.value.cl.assign === 'person' ? r.value.cl.assigneeName || '' : ''))
const err = ref('')
function open() {
  const s = props.date === localDateKey() ? currentSlot(r.value, nowHm.value)?.slot : null
  emit('open-run', { cl: r.value.cl, date: props.date, slot: s ?? r.value.slots[0].slot })
}
async function tap() {
  if (!simple.value) { open(); return }
  err.value = ''
  const s = r.value.slots[0]
  const m = s.marks[WHOLE]
  if (!canMarkChecklist(r.value.cl) || (m && !canUnmark(m)) || props.date > localDateKey()) { open(); return }   // 押せないときは画面で理由を見せる
  try { await markChecklistItem(r.value.cl, props.date, s.slot, WHOLE, m ? null : 'done') } catch (e) { err.value = e?.message || '保存できませんでした' }
}
</script>

<template>
  <div :class="['rw', { done: r.complete, part: !r.complete && r.started }]">
    <button type="button" class="rw-ck" :aria-pressed="r.complete" :aria-label="`${r.cl.name}${r.complete ? ' 済み' : ''}`" @click="tap">{{ r.complete ? '✓' : '' }}</button>
    <span class="rw-t">{{ time }}</span>
    <button type="button" class="rw-tx" @click="open"><b>{{ r.cl.name }}</b><small v-if="err" class="rw-err">{{ err }}</small></button>
    <span v-if="count" class="rw-n">{{ count }}</span>
    <span v-if="who" class="rw-av" :title="who">{{ who.slice(0, 1) }}</span>
  </div>
</template>

<style scoped>
.rw { display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-top: 1px solid var(--border); }
.rw-ck { flex: none; width: 28px; height: 28px; border-radius: 50%; border: 2px solid #a5b4fc; background: #fff; color: #fff; font-weight: 900; font-size: 13px; cursor: pointer; display: grid; place-items: center; padding: 0; }
.rw.part .rw-ck { border-color: #f59e0b; }
.rw.done .rw-ck { background: #22c55e; border-color: #22c55e; }
.rw-tx { flex: 1; min-width: 0; border: none; background: none; font: inherit; text-align: left; cursor: pointer; padding: 0; display: grid; gap: 2px; color: var(--text); }
.rw-tx b { font-size: 14px; font-weight: 400; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rw.done .rw-tx b { color: #94a3b8; text-decoration: line-through; }
.rw-err { font-size: 11px; color: #b91c1c; font-weight: 700; }
.rw-t { flex: none; width: 40px; font-size: 12px; font-weight: 800; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.rw-n { font-size: 12px; font-weight: 900; color: #3730a3; }
.rw-av { flex: none; width: 22px; height: 22px; border-radius: 50%; background: #0e7490; color: #fff; font-size: 10.5px; font-weight: 900; display: grid; place-items: center; }
</style>
