<script setup>
/**
 * その日の「伝票」（日誌のその日のまとめ・User決定 2026-10-25・モック docs/mocks/journal-calendar-v4.html）。
 * 済みのリング・やり残し（赤）・ルーティン・記録（棚卸・発注・入出庫）・メモ。
 * 下に「🕒 時間で見る」（今の「1日」）と「📤 日報で送る」（文字を共有・できなければコピー）
 */
import { ref, computed, onUnmounted } from 'vue'
import RecordRow from './RecordRow.vue'
import { dailyReportText } from '../services/dailyReport.js'
import { useDayNotes } from '../composables/useDayNotes.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

const props = defineProps({
  date: { type: String, required: true },
  tasks: { type: Array, default: () => [] },
  lists: { type: Array, default: () => [] },
  records: { type: Array, default: () => [] },
  store: { type: String, default: '' },
})
const emit = defineEmits(['close', 'time', 'view-session', 'open-run'])
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const d = computed(() => new Date(props.date + 'T00:00:00'))
const label = computed(() => `${d.value.getMonth() + 1}/${d.value.getDate()}（${WEEK[d.value.getDay()]}）`)
const total = computed(() => props.tasks.length + props.lists.length)
const done = computed(() => props.tasks.filter(t => t.doneAt).length + props.lists.filter(r => r.complete).length)
const pct = computed(() => (total.value ? Math.round(done.value / total.value * 100) : 0))
const leftLists = computed(() => props.lists.filter(r => !r.complete))
const leftTasks = computed(() => props.tasks.filter(t => !t.doneAt))
const { getNote } = useDayNotes()
const note = computed(() => getNote(props.date)?.text || '')

const sent = ref('')
async function share() {
  const text = dailyReportText({ date: props.date, store: props.store, tasks: props.tasks, lists: props.lists, records: props.records, note: note.value })
  try {
    if (navigator.share) { await navigator.share({ text }); return }
  } catch (e) { if (e?.name === 'AbortError') return }
  try { await navigator.clipboard.writeText(text); sent.value = 'コピーしました' } catch (_) { sent.value = 'コピーできませんでした' }
  setTimeout(() => { sent.value = '' }, 2200)
}
onUnmounted(registerInnerLayerCloser(() => { emit('close'); return true }))
</script>

<template>
  <Teleport to="body">
    <div class="ds-bg" @click.self="emit('close')">
      <div class="ds" role="dialog" :aria-label="`${label}の伝票`">
        <div class="ds-h">
          <b>{{ label }}</b>
          <span v-if="total" class="ds-ring" :style="{ background: `conic-gradient(${done === total ? '#22c55e' : '#f59e0b'} 0 ${pct}%, #e7e5dc 0)` }"><i>{{ done }}/{{ total }}</i></span>
          <button type="button" class="ds-x" aria-label="閉じる" @click="emit('close')">✕</button>
        </div>
        <div class="ds-b">
          <template v-if="leftLists.length || leftTasks.length">
            <div class="ds-lh"><span>やり残し</span><span>{{ leftLists.length + leftTasks.length }}</span></div>
            <button v-for="r in leftLists" :key="r.cl.id" type="button" class="ds-ln ng" @click="emit('open-run', { cl: r.cl, date, slot: r.slots[0].slot })">
              <i>!</i>{{ r.cl.name }}<small v-if="r.total > 1">{{ r.filled }}/{{ r.total }}</small>
            </button>
            <div v-for="t in leftTasks" :key="t.id" class="ds-ln ng"><i>!</i>{{ t.text }}<small v-if="t.assigneeName">{{ t.assigneeName }}</small></div>
          </template>
          <template v-if="lists.some(r => r.complete) || tasks.some(t => t.doneAt)">
            <div class="ds-lh"><span>済み</span><span>{{ done }}</span></div>
            <div class="ds-chips">
              <span v-for="r in lists.filter(x => x.complete)" :key="r.cl.id">{{ r.cl.name }} ✓</span>
              <span v-for="t in tasks.filter(x => x.doneAt)" :key="t.id">{{ t.text }} ✓</span>
            </div>
          </template>
          <template v-if="records.length">
            <div class="ds-lh"><span>記録</span><span>{{ records.length }}</span></div>
            <div class="ds-recs"><RecordRow v-for="r in records" :key="r.key" :rec="r" @view-session="s => emit('view-session', s)" /></div>
          </template>
          <p v-if="note" class="ds-note">📝 {{ note }}</p>
          <p v-if="!total && !records.length && !note" class="ds-empty">☕ この日はなし</p>
        </div>
        <div class="ds-f">
          <button type="button" @click="emit('time')">🕒 時間で見る</button>
          <button type="button" class="p" @click="share">{{ sent || '📤 日報で送る' }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ds-bg { position: fixed; inset: 0; z-index: 116; background: rgba(15,23,42,.35); display: flex; align-items: flex-end; justify-content: center; }
.ds { width: 100%; max-width: 600px; max-height: 88vh; background: #fffdf7; border-radius: 18px 18px 0 0; display: flex; flex-direction: column; overflow: hidden; }
.ds-h { display: flex; align-items: center; gap: 10px; padding: 14px 16px 10px; border-bottom: 1.5px dashed #d6d3c4; }
.ds-h b { font-size: 18px; flex: 1; }
.ds-ring { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; }
.ds-ring i { width: 34px; height: 34px; border-radius: 50%; background: #fffdf7; display: grid; place-items: center; font-style: normal; font-size: 11px; font-weight: 900; }
.ds-x { border: none; background: none; font-size: 16px; color: var(--text-muted); cursor: pointer; padding: 6px; }
.ds-b { flex: 1; overflow-y: auto; padding: 8px 16px 12px; display: grid; gap: 8px; align-content: start; }
.ds-lh { display: flex; justify-content: space-between; font-size: 11px; font-weight: 900; letter-spacing: .08em; color: #8a8270; padding-top: 4px; }
.ds-ln { display: flex; align-items: center; gap: 8px; font: inherit; font-size: 14px; font-weight: 700; border: none; background: none; text-align: left; padding: 2px 0; color: var(--text); cursor: default; }
button.ds-ln { cursor: pointer; }
.ds-ln.ng { color: #b91c1c; }
.ds-ln i { font-style: normal; width: 18px; height: 18px; border-radius: 6px; border: 1.5px solid #ef4444; color: #ef4444; display: grid; place-items: center; font-size: 11px; flex: none; }
.ds-ln small { margin-left: auto; font-size: 11.5px; color: var(--text-muted); font-weight: 700; }
.ds-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.ds-chips span { font-size: 12px; font-weight: 800; border-radius: 999px; padding: 3px 9px; background: #ecfdf5; color: #166534; }
.ds-recs { background: #fff; border-radius: 12px; padding: 0 8px; }
.ds-note { margin: 0; background: #f5f3ff; border-radius: 10px; padding: 8px 10px; font-size: 13px; font-weight: 700; color: #5b21b6; white-space: pre-wrap; }
.ds-empty { margin: 0; padding: 18px 0; text-align: center; font-weight: 800; color: var(--text-muted); }
.ds-f { display: flex; gap: 8px; padding: 10px 14px calc(14px + env(safe-area-inset-bottom)); border-top: 1.5px dashed #d6d3c4; }
.ds-f button { flex: 1; min-height: 44px; border-radius: 12px; border: 1px solid var(--border); background: #fff; font: inherit; font-weight: 900; color: #334155; cursor: pointer; }
.ds-f button.p { border: none; background: linear-gradient(90deg, #22d3ee, #34d399); color: #06323c; }
</style>
