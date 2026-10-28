<script setup>
/**
 * 進行中のやること1件のカード（User決定 2026-10-23・モック docs/mocks/journal-today-modern.html）。
 * 左の色の帯で状態（黄＝進行中・紫＝待ち・赤＝止まり＝5日動きなし）。手順のリング（横長はバー）・最後の経過・担当
 * wide: 「進行中」タブの縦に積むカード（手順はバー）。ふだんは「今日」の横に流れるカード
 */
import { computed } from 'vue'
import { isStale, idleDays } from '../composables/useTasks.js'

const props = defineProps({
  task: { type: Object, required: true },
  wide: { type: Boolean, default: false },
})
const emit = defineEmits(['open'])
const t = computed(() => props.task)
const stale = computed(() => isStale(t.value))
const kind = computed(() => (stale.value ? 'stale' : t.value.progress === 'waiting' ? 'wait' : 'go'))
const steps = computed(() => t.value.steps ?? [])
const done = computed(() => steps.value.filter(s => s.done).length)
const pct = computed(() => (steps.value.length ? Math.round(done.value / steps.value.length * 100) : 0))
const md = k => { const [, m, d] = String(k).split('-').map(Number); return m ? `${m}/${d}` : '' }
const pill = computed(() => {
  if (stale.value) return `${idleDays(t.value)}日 止まり`
  if (t.value.progress === 'waiting') return `待ち${t.value.waitNote ? `・${t.value.waitNote}` : ''}`
  return `進行中${t.value.deadline ? `・期限 ${md(t.value.deadline)}` : ''}`
})
const who = computed(() => (t.value.assign === 'person' ? t.value.assigneeName || '' : ''))
const ago = iso => { const n = Math.floor((Date.now() - Date.parse(iso)) / 86400_000); return n <= 0 ? '今日' : `${n}日前` }
</script>

<template>
  <button type="button" :class="['pc', kind, { wide }]" :aria-label="`${t.text} ${pill}`" @click="emit('open', t)">
    <span class="pc-h">
      <b>{{ t.text }}</b>
      <span v-if="steps.length && !wide" class="pc-ring" :style="{ background: `conic-gradient(var(--pc-c) 0 ${pct}%, #e2e8f0 0)` }"><i>{{ done }}/{{ steps.length }}</i></span>
    </span>
    <span v-if="wide && steps.length" class="pc-bar"><i v-for="s in steps" :key="s.id" :class="{ ok: s.done }"></i></span>
    <span class="pc-pill">{{ pill }}</span>
    <span v-if="t.lastNote" class="pc-last">{{ t.lastNote.body }}</span>
    <span class="pc-f">
      <i v-if="who" class="pc-av">{{ who.slice(0, 1) }}</i>
      <template v-if="t.lastNote">{{ ago(t.lastNote.at) }}</template>
    </span>
  </button>
</template>

<style scoped>
.pc { --pc-c: #f59e0b; flex: none; width: 220px; position: relative; overflow: hidden; display: grid; gap: 6px; align-content: start; text-align: left;
  border: none; border-radius: 18px; padding: 12px 12px 12px 16px; background: var(--surface); box-shadow: 0 6px 16px rgba(15,23,42,.08); font: inherit; color: var(--text); cursor: pointer; }
.pc::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: var(--pc-c); }
.pc.wait { --pc-c: #4f46e5; } .pc.stale { --pc-c: #ef4444; }
.pc.wide { width: auto; }
.pc-h { display: flex; align-items: center; gap: 8px; }
.pc-h b { flex: 1; font-size: 14.5px; line-height: 1.3; }
.pc-ring { flex: none; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; }
.pc-ring i { width: 26px; height: 26px; border-radius: 50%; background: var(--surface); display: grid; place-items: center; font-style: normal; font-size: 9.5px; font-weight: 900; }
.pc-bar { display: flex; gap: 4px; } .pc-bar i { flex: 1; height: 5px; border-radius: 3px; background: #e2e8f0; } .pc-bar i.ok { background: var(--pc-c); }
.pc-pill { justify-self: start; font-size: 11px; font-weight: 900; padding: 2px 8px; border-radius: 999px; background: #fef3c7; color: #92400e; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pc.wait .pc-pill { background: #e0e7ff; color: #3730a3; } .pc.stale .pc-pill { background: #fee2e2; color: #b91c1c; }
.pc-last { font-size: 12px; color: #475569; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pc-f { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-muted); font-weight: 700; }
.pc-av { width: 18px; height: 18px; border-radius: 50%; background: #cbd5e1; color: #fff; font-style: normal; font-size: 10px; font-weight: 900; display: grid; place-items: center; }
</style>
