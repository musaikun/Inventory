<script setup>
/**
 * ルーティンの記録（全画面・User決定 2026-10-23・モック docs/mocks/routine-records.html）。
 * 文字の行だと抜けた日を探すのが大変なので、色で見る。
 * - 一覧: 1行＝1つのルーティン、4週間をマスで。緑＝やった・赤＝抜け・黄＝途中で終わり・薄い＝予定なし。右にやった率（85%未満は赤）
 * - 1つを押すと月のカレンダー（月を送れる）。日を押すとその日の中身（誰がいつ・抜けた項目）
 * - 毎週・毎月のものは予定の日だけ色。今日と先の日は率に数えない
 */
import { ref, computed, onUnmounted } from 'vue'
import { checklists, checklistRuns } from '../composables/useChecklists.js'
import { dayStatus, statusStats, lastDays, monthDays, dayChecklist, whenLabel, isSimple } from '../services/checklistSchedule.js'
import { localDateKey } from '../utils/localDate.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

const props = defineProps({ focus: { type: Object, default: null } })
const emit = defineEmits(['close', 'open-run'])
const RED_BELOW = 85
const today = localDateKey()
const WEEK = ['日', '月', '火', '水', '木', '金', '土']

const lists = computed(() => checklists.value.filter(cl => !cl.paused))
const days28 = lastDays(28, today)
const rows = computed(() => lists.value.map(cl => ({
  cl, marks: days28.map(d => dayStatus(cl, checklistRuns.value, d, today)), stats: statusStats(cl, checklistRuns.value, days28, today),
})))
const total = computed(() => {
  const s = rows.value.reduce((a, r) => ({ y: a.y + r.stats.y, p: a.p + r.stats.p, n: a.n + r.stats.n }), { y: 0, p: 0, n: 0 })
  const t = s.y + s.p + s.n
  return { ...s, rate: t ? Math.round(s.y / t * 100) : null }
})
const md = k => { const d = new Date(k + 'T00:00:00'); return `${d.getMonth() + 1}/${d.getDate()}` }

// ── 1つのカレンダー ──
const target = ref(props.focus)
const ym = ref((() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })())
const month = computed(() => monthDays(ym.value.y, ym.value.m))
const cells = computed(() => month.value.days.map(k => ({ k, d: Number(k.slice(8)), s: dayStatus(target.value, checklistRuns.value, k, today) })))
const mStats = computed(() => statusStats(target.value, checklistRuns.value, month.value.days, today))
function shift(n) { const d = new Date(ym.value.y, ym.value.m + n, 1); ym.value = { y: d.getFullYear(), m: d.getMonth() }; picked.value = null }
const picked = ref(null)
const pickedDay = computed(() => (picked.value ? dayChecklist(target.value, checklistRuns.value, picked.value) : null))
const hm = iso => { const d = new Date(iso); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` }
const missing = r => r.slots.flatMap(s => s.items.filter(it => !s.marks[it.id]).map(it => (r.totalSlots > 1 ? `${s.slot}の回：${it.text}` : it.text)))
const names = r => [...new Set(r.slots.flatMap(s => Object.values(s.marks).map(m => m?.by)).filter(Boolean))].join('・')
const span = r => { const a = r.slots.flatMap(s => Object.values(s.marks).map(m => m?.at)).filter(Boolean).sort(); return a.length ? `${hm(a[0])}${a.length > 1 ? `〜${hm(a[a.length - 1])}` : ''}` : '' }
const STATUS_TEXT = { y: 'やった', p: '途中で終わり', n: '抜け', t: '今日（まだ）', f: '先の日' }

function open(cl) { target.value = cl; picked.value = null }
function back() { if (target.value && !props.focus) { target.value = null; return } emit('close') }
onUnmounted(registerInnerLayerCloser(() => { back(); return true }))
const rateCls = r => (r == null ? '' : r < RED_BELOW ? 'bad' : 'good')
</script>

<template>
  <Teleport to="body">
    <div class="rtr" role="dialog" :aria-label="target ? `${target.name}の記録` : 'ルーティンの記録'">
      <div class="rtr-top">
        <button type="button" class="rtr-back" @click="back">‹ 戻る</button>
        <div class="rtr-t"><b>{{ target ? target.name : 'ルーティンの記録' }}</b><small>{{ target ? whenLabel(target) : `この4週間 ・ ${md(days28[0])}〜${md(today)}` }}</small></div>
      </div>

      <!-- 一覧 -->
      <div v-if="!target" class="rtr-body">
        <div class="rtr-stats">
          <div><b :class="rateCls(total.rate)">{{ total.rate == null ? '—' : `${total.rate}%` }}</b><small>やった率</small></div>
          <div><b class="bad">{{ total.n }}</b><small>抜け</small></div>
          <div><b class="mid">{{ total.p }}</b><small>途中で終わり</small></div>
        </div>
        <div class="rtr-list">
          <button v-for="r in rows" :key="r.cl.id" type="button" class="rtr-row" :aria-label="`${r.cl.name}の記録`" @click="open(r.cl)">
            <span class="rtr-nm">{{ r.cl.name }}<small>{{ whenLabel(r.cl) }}</small></span>
            <span class="rtr-sq" aria-hidden="true"><i v-for="(m, i) in r.marks" :key="i" :class="m"></i></span>
            <span :class="['rtr-pc', rateCls(r.stats.rate)]">{{ r.stats.rate == null ? '—' : `${r.stats.rate}%` }}</span>
          </button>
          <p v-if="!rows.length" class="rtr-empty">ルーティンがまだありません</p>
        </div>
        <div class="rtr-leg"><span><i class="y"></i>やった</span><span><i class="n"></i>抜け</span><span><i class="p"></i>途中</span><span><i class="o"></i>予定なし</span></div>
      </div>

      <!-- 1つのカレンダー -->
      <div v-else class="rtr-body">
        <div class="rtr-stats">
          <div><b :class="rateCls(mStats.rate)">{{ mStats.rate == null ? '—' : `${mStats.rate}%` }}</b><small>{{ ym.m + 1 }}月 やった率</small></div>
          <div><b class="bad">{{ mStats.n }}</b><small>抜け</small></div>
          <div><b class="mid">{{ mStats.p }}</b><small>途中</small></div>
        </div>
        <div class="rtr-mh">
          <button type="button" aria-label="前の月" @click="shift(-1)">‹</button>
          <b>{{ ym.y }}年{{ ym.m + 1 }}月</b>
          <button type="button" aria-label="次の月" @click="shift(1)">›</button>
        </div>
        <div class="rtr-cal">
          <span v-for="w in WEEK" :key="w" class="w">{{ w }}</span>
          <span v-for="i in month.firstDow" :key="`b${i}`" class="blank"></span>
          <button v-for="c in cells" :key="c.k" type="button" :class="['d', c.s, { pick: picked === c.k }]" :disabled="c.s === 'o' || c.s === 'f'"
            :aria-label="`${c.d}日 ${STATUS_TEXT[c.s] || '予定なし'}`" @click="picked = c.k">{{ c.d }}</button>
        </div>
        <div class="rtr-leg"><span><i class="y"></i>やった</span><span><i class="n"></i>抜け</span><span><i class="p"></i>途中</span></div>
        <div v-if="pickedDay" class="rtr-day">
          <b>{{ md(picked) }}（{{ WEEK[new Date(picked + 'T00:00:00').getDay()] }}） {{ STATUS_TEXT[dayStatus(target, checklistRuns, picked, today)] }}<template v-if="!isSimple(target) || pickedDay.totalSlots > 1"> {{ pickedDay.totalSlots > 1 ? `${pickedDay.doneSlots}/${pickedDay.totalSlots}回` : `${pickedDay.filled}/${pickedDay.total}` }}</template></b>
          <span v-if="names(pickedDay)" class="rtr-who">{{ names(pickedDay) }} {{ span(pickedDay) }}</span>
          <span v-if="missing(pickedDay).length && !pickedDay.complete" class="rtr-miss">抜け：{{ missing(pickedDay).join('・') }}</span>
          <button type="button" class="rtr-open" @click="emit('open-run', { cl: target, date: picked, slot: (pickedDay.slots.find(s => !s.complete) ?? pickedDay.slots[0]).slot })">この日の✓を見る ›</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.rtr { position: fixed; inset: 0; z-index: 118; background: #f4f6fb; display: flex; flex-direction: column; }
.rtr-top { flex: none; display: flex; align-items: center; gap: 10px; padding: calc(12px + env(safe-area-inset-top)) 14px 10px; background: var(--surface); border-bottom: 1px solid var(--border); }
.rtr-back { border: none; background: none; font: inherit; font-size: 14px; font-weight: 800; color: var(--primary); cursor: pointer; padding: 4px 0; }
.rtr-t { display: grid; } .rtr-t b { font-size: 17px; } .rtr-t small { font-size: 11.5px; color: var(--text-muted); font-weight: 700; }
.rtr-body { flex: 1; overflow-y: auto; padding: 12px 14px calc(30px + env(safe-area-inset-bottom)); display: grid; gap: 12px; align-content: start; max-width: 600px; width: 100%; margin: 0 auto; box-sizing: border-box; }
.rtr-stats { display: flex; gap: 8px; }
.rtr-stats div { flex: 1; background: var(--surface); border-radius: 14px; padding: 8px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,.05); }
.rtr-stats b { display: block; font-size: 20px; } .rtr-stats small { font-size: 10.5px; color: var(--text-muted); font-weight: 700; }
.good { color: #166534; } .bad { color: #b91c1c; } .mid { color: #92400e; }
.rtr-list { background: var(--surface); border-radius: 16px; padding: 4px 12px; box-shadow: 0 1px 3px rgba(0,0,0,.05); }
.rtr-row { width: 100%; display: flex; align-items: center; gap: 8px; padding: 9px 0; border: none; border-top: 1px solid #f1f5f9; background: none; font: inherit; color: var(--text); text-align: left; cursor: pointer; }
.rtr-row:first-child { border-top: none; }
.rtr-nm { width: 92px; flex: none; font-size: 12.5px; font-weight: 800; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.rtr-nm small { display: block; font-size: 10px; color: var(--text-muted); font-weight: 700; overflow: hidden; text-overflow: ellipsis; }
.rtr-sq { flex: 1; display: grid; grid-template-columns: repeat(14, 1fr); grid-auto-rows: 14px; gap: 2px; }
.rtr-sq i, .rtr-leg i { border-radius: 3px; background: #eef2f6; }
.rtr-sq i.y, .rtr-leg i.y { background: #22c55e; } .rtr-sq i.n, .rtr-leg i.n { background: #f87171; } .rtr-sq i.p, .rtr-leg i.p { background: #fbbf24; }
.rtr-sq i.t { background: #fff; outline: 2px solid #a5b4fc; outline-offset: -2px; }
.rtr-pc { width: 40px; flex: none; text-align: right; font-size: 12px; font-weight: 900; }
.rtr-leg { display: flex; gap: 12px; font-size: 11px; color: var(--text-muted); font-weight: 700; }
.rtr-leg i { display: inline-block; width: 11px; height: 11px; margin-right: 4px; vertical-align: -1px; }
.rtr-empty { margin: 0; padding: 14px; text-align: center; font-size: 13px; color: var(--text-muted); }
.rtr-mh { display: flex; align-items: center; justify-content: center; gap: 16px; }
.rtr-mh button { width: 40px; height: 36px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); font-size: 18px; font-weight: 900; color: var(--text-muted); cursor: pointer; }
.rtr-cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.rtr-cal .w { font-size: 10.5px; font-weight: 800; color: var(--text-muted); text-align: center; }
.rtr-cal .d { aspect-ratio: 1; border: none; border-radius: 10px; background: var(--surface); font: inherit; font-size: 12.5px; font-weight: 800; color: #334155; position: relative; cursor: pointer; padding: 0; }
.rtr-cal .d.y { background: #dcfce7; color: #166534; } .rtr-cal .d.n { background: #fee2e2; color: #b91c1c; } .rtr-cal .d.p { background: #fef3c7; color: #92400e; }
.rtr-cal .d.t { outline: 2px solid #4f46e5; outline-offset: -2px; }
.rtr-cal .d.o, .rtr-cal .d.f { background: transparent; color: #cbd5e1; cursor: default; }
.rtr-cal .d.f { background: var(--surface); }
.rtr-cal .d.n::after { content: '✕'; position: absolute; left: 0; right: 0; bottom: 2px; font-size: 8px; }
.rtr-cal .d.y::after { content: '●'; position: absolute; left: 0; right: 0; bottom: 1px; font-size: 7px; color: #16a34a; }
.rtr-cal .d.pick { box-shadow: 0 0 0 3px #4f46e5; }
.rtr-day { background: var(--surface); border-radius: 16px; padding: 12px; display: grid; gap: 4px; font-size: 13px; }
.rtr-who { color: var(--text-muted); font-weight: 700; }
.rtr-miss { color: #b91c1c; font-weight: 800; }
.rtr-open { justify-self: end; border: none; background: none; font: inherit; font-size: 12.5px; font-weight: 800; color: var(--primary); cursor: pointer; }
</style>
