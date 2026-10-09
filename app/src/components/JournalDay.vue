<script setup>
/**
 * 日誌の「1日」（時間別。User決定 2026-10-09・モック docs/mocks/journal.html）。
 * - 時刻のあるやること・予定（発注の締切）・記録を時間の帯に。時刻の無いやることは上の「時刻なし」
 * - 棚卸は始め〜終わりの長さで左の列に。操作が5分以上なかった区間は「中断」として薄く
 * - 表示する時間帯は端末ごとに変えられる（営業時間に合わせる）。帯の外の出来事があれば広げて見せる
 * - 押すと: やること → その場で完了・直す（TaskRow）、棚卸 → 詳細、発注・入出庫 → 品目と数
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import TaskRow from './TaskRow.vue'
import RecordRow from './RecordRow.vue'
import { tasksOn, isMarkedByMe } from '../composables/useTasks.js'
import { useConfig } from '../composables/useConfig.js'
import { isOrderDay, scheduleName } from '../services/orderScheduleUtil.js'
import { fmtHm, fmtDuration } from '../services/journalRecords.js'
import { localDateKey } from '../utils/localDate.js'
import { STORAGE_KEYS } from '../utils/storageKeys.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

const props = defineProps({
  date:    { type: String, required: true },      // YYYY-MM-DD
  records: { type: Array, default: () => [] },     // その日の記録（journalRecords）
})
const emit = defineEmits(['update:date', 'view-session'])

// ── 表示する時間帯（端末ごと）──
function _readHours() {
  try { const h = JSON.parse(localStorage.getItem(STORAGE_KEYS.journalHours) || 'null'); if (h && h.from < h.to) return h } catch (_) {}
  return { from: 8, to: 22 }
}
const hours = ref(_readHours())
const editHours = ref(false)
function saveHours(from, to) {
  if (!(from < to)) return
  hours.value = { from, to }
  try { localStorage.setItem(STORAGE_KEYS.journalHours, JSON.stringify(hours.value)) } catch (_) {}
  editHours.value = false
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const dateLabel = computed(() => {
  const d = new Date(props.date + 'T00:00:00')
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEK[d.getDay()]}）${props.date === localDateKey() ? ' 今日' : ''}`
})
function shift(n) {
  const d = new Date(props.date + 'T00:00:00'); d.setDate(d.getDate() + n)
  emit('update:date', localDateKey(d))
}

// ── その日の中身 ──
const { config } = useConfig()
const dayStart = computed(() => new Date(props.date + 'T00:00:00').getTime())
const minOf = ms => (ms - dayStart.value) / 60000
const tasks = computed(() => tasksOn(props.date))
const untimed = computed(() => tasks.value.filter(t => !t.dueTime))
const plans = computed(() => {
  const d = new Date(props.date + 'T00:00:00')
  return (config.orderSchedules || []).map((s, i) => (isOrderDay(s, d) && s.deadline ? { key: `plan-${i}`, name: scheduleName(s, i), time: s.deadline } : null)).filter(Boolean)
})
const toMin = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m }

// 時間帯: 設定の範囲に、帯の外の出来事が入るよう広げる
const range = computed(() => {
  let from = hours.value.from * 60, to = hours.value.to * 60
  const mins = [
    ...tasks.value.filter(t => t.dueTime).map(t => toMin(t.dueTime)),
    ...plans.value.map(p => toMin(p.time)),
    ...props.records.filter(r => r.at != null).flatMap(r => [minOf(r.at), minOf(r.end ?? r.at) + 30]),
  ]
  for (const m of mins) { if (m < from) from = Math.floor(m / 60) * 60; if (m > to) to = Math.min(24 * 60, Math.ceil(m / 60) * 60) }
  return { from, to }
})
const PX = 48 / 60   // 1分 = 0.8px（1時間 48px）
const top = m => (m - range.value.from) * PX
const hourMarks = computed(() => { const a = []; for (let m = range.value.from; m <= range.value.to; m += 60) a.push(m); return a })

// 左の列: 棚卸（作業と中断の区間）
const stockBlocks = computed(() => props.records.filter(r => r.kind === 'stock' && r.at != null).flatMap(r => {
  const segs = []
  let cur = r.at
  for (const p of r.pauses ?? []) {
    if (p.from > cur) segs.push({ kind: 'work', from: cur, to: p.from })
    segs.push({ kind: 'pause', from: p.from, to: p.to })
    cur = p.to
  }
  segs.push({ kind: 'work', from: cur, to: r.end ?? cur })
  return segs.map((s, i) => ({
    key: `${r.key}-${i}`, rec: r, kind: s.kind, top: top(minOf(s.from)), h: Math.max(18, (s.to - s.from) / 60000 * PX),
    label: s.kind === 'pause' ? `中断 ${fmtDuration(s.to - s.from)}` : (i === 0 ? `📦 棚卸 ${fmtHm(r.at)}〜` : '📦 棚卸（続き）'),
  }))
}))

// 右の列: やること・予定・発注・入出庫（重なったら下へずらす）
const rightItems = computed(() => {
  const list = [
    ...tasks.value.filter(t => t.dueTime).map(t => ({ key: t.id, type: 'task', m: toMin(t.dueTime), task: t, label: `${t.dueTime} ${t.text}`, done: t.assign === 'all' ? (isMarkedByMe(t) || !!t.doneAt) : !!t.doneAt })),
    ...plans.value.map(p => ({ key: p.key, type: 'plan', m: toMin(p.time), label: `${p.time} 発注の締切（${p.name}）` })),
    ...props.records.filter(r => r.kind !== 'stock' && r.at != null).map(r => ({ key: r.key, type: r.kind, m: minOf(r.at), rec: r, label: `${fmtHm(r.at)} ${r.title}` })),
  ].sort((a, b) => a.m - b.m)
  let bottom = -Infinity
  return list.map(x => {
    const t = Math.max(top(x.m), bottom + 2)
    bottom = t + 24
    return { ...x, top: t }
  })
})
const height = computed(() => Math.max((range.value.to - range.value.from) * PX, ...rightItems.value.map(x => x.top + 26)))

// 今の線
const nowMin = ref(0)
let timer = null
function _tick() { const d = new Date(); nowMin.value = d.getHours() * 60 + d.getMinutes() }
onMounted(() => { _tick(); timer = setInterval(_tick, 60000) })
onUnmounted(() => clearInterval(timer))
const showNow = computed(() => props.date === localDateKey() && nowMin.value >= range.value.from && nowMin.value <= range.value.to)

// 押したもの（下のシート）
const picked = ref(null)   // { task } | { rec }
onUnmounted(registerInnerLayerCloser(() => {
  if (picked.value) { picked.value = null; return true }
  if (editHours.value) { editHours.value = false; return true }
  return false
}))
function pick(x) {
  if (x.type === 'task') picked.value = { task: x.task }
  else if (x.rec?.kind === 'stock') emit('view-session', x.rec.session)
  else if (x.rec) picked.value = { rec: x.rec }
}
const fromOpts = Array.from({ length: 24 }, (_, i) => i)
const hf = ref(hours.value.from), ht = ref(hours.value.to)
function openHours() { hf.value = hours.value.from; ht.value = hours.value.to; editHours.value = true }
</script>

<template>
  <div class="jd">
    <div class="jd-nav">
      <button type="button" aria-label="前の日" @click="shift(-1)">‹</button>
      <b>{{ dateLabel }}</b>
      <button type="button" aria-label="次の日" @click="shift(1)">›</button>
    </div>

    <div v-if="untimed.length" class="jd-allday">
      <span class="jd-h">時刻なし</span>
      <button v-for="t in untimed" :key="t.id" type="button" :class="['jd-chip', { done: t.doneAt }]" @click="picked = { task: t }">
        {{ t.doneAt ? '✓' : '☐' }} {{ t.text }}
      </button>
    </div>

    <div class="jd-tl" :style="{ height: height + 16 + 'px' }">
      <div v-for="m in hourMarks" :key="m" class="jd-hr" :style="{ top: top(m) + 8 + 'px' }"><span>{{ m / 60 }}:00</span></div>
      <div class="jd-lanes">
        <button
          v-for="b in stockBlocks" :key="b.key" type="button" :class="['jd-ev', 'stock', b.kind]"
          :style="{ top: b.top + 'px', height: b.h + 'px' }" @click="emit('view-session', b.rec.session)"
        >{{ b.label }}</button>
        <button
          v-for="x in rightItems" :key="x.key" type="button" :class="['jd-ev', 'right', x.type, { done: x.done }]"
          :style="{ top: x.top + 'px' }" @click="pick(x)"
        >{{ x.done ? '✓ ' : '' }}{{ x.label }}</button>
      </div>
      <div v-if="showNow" class="jd-now" :style="{ top: top(nowMin) + 'px' }"></div>
      <p v-if="!stockBlocks.length && !rightItems.length" class="jd-empty">この日の予定・記録はありません</p>
    </div>

    <button type="button" class="jd-hours" @click="openHours">表示する時間 {{ hours.from }}:00〜{{ hours.to }}:00 ✎</button>

    <Teleport to="body">
      <div v-if="picked || editHours" class="jd-sheet-bg" @click.self="picked = null; editHours = false">
        <div class="jd-sheet" role="dialog">
          <template v-if="editHours">
            <b>表示する時間（この端末）</b>
            <p class="jd-note">店の営業時間に合わせてください。時間外の予定や記録があれば、その日だけ広げて出します。</p>
            <div class="jd-row">
              <select v-model.number="hf" aria-label="始まり"><option v-for="h in fromOpts" :key="h" :value="h">{{ h }}:00</option></select>
              〜
              <select v-model.number="ht" aria-label="終わり"><option v-for="h in fromOpts.map(x => x + 1)" :key="h" :value="h">{{ h }}:00</option></select>
            </div>
            <div class="jd-row end">
              <button type="button" class="jd-mini" @click="editHours = false">やめる</button>
              <button type="button" class="jd-save" :disabled="!(hf < ht)" @click="saveHours(hf, ht)">保存</button>
            </div>
          </template>
          <TaskRow v-else-if="picked.task" :task="picked.task" />
          <RecordRow v-else-if="picked.rec" :rec="picked.rec" />
          <button v-if="!editHours" type="button" class="jd-mini wide" @click="picked = null">閉じる</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.jd { display: grid; gap: 10px; padding: 8px 12px 96px; }
.jd-nav { display: flex; align-items: center; justify-content: space-between; }
.jd-nav b { font-size: 15px; }
.jd-nav button { width: 40px; height: 36px; border: none; background: none; font-size: 22px; color: var(--text-muted); cursor: pointer; }
.jd-allday { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.jd-h { font-size: 11px; font-weight: 800; color: var(--text-muted); margin-right: 2px; }
.jd-chip { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 5px 9px; font: inherit; font-size: 12px; font-weight: 700; color: var(--text); cursor: pointer; }
.jd-chip.done { color: var(--text-muted); text-decoration: line-through; }
.jd-tl { position: relative; background: var(--surface); border-radius: 16px; box-shadow: 0 1px 4px rgba(0,0,0,.05); margin-top: 6px; }
.jd-hr { position: absolute; left: 44px; right: 8px; border-top: 1px solid #eef4f6; }
.jd-hr span { position: absolute; left: -40px; top: -7px; width: 34px; text-align: right; font-size: 10px; font-weight: 700; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.jd-lanes { position: absolute; left: 50px; right: 8px; top: 8px; bottom: 0; }
.jd-ev { position: absolute; border: none; font: inherit; text-align: left; cursor: pointer; border-radius: 8px; padding: 3px 7px; font-size: 11.5px; font-weight: 800; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.jd-ev.stock { left: 0; width: 36%; white-space: normal; }
.jd-ev.stock.work { background: #cffafe; color: #155e75; border-left: 4px solid #0e7490; }
.jd-ev.stock.pause { background: repeating-linear-gradient(0deg,#f8fafc,#f8fafc 4px,#eef4f6 4px,#eef4f6 8px); color: #64748b; border-left: 4px dotted #94a3b8; font-weight: 700; }
.jd-ev.right { left: calc(36% + 6px); right: 0; height: 22px; }
.jd-ev.task { background: #fff7ed; color: #9a3412; border-left: 4px solid #f97316; }
.jd-ev.task.done { opacity: .55; text-decoration: line-through; }
.jd-ev.plan { background: repeating-linear-gradient(45deg,#fff7ed,#fff7ed 6px,#ffedd5 6px,#ffedd5 12px); color: #c2410c; border-left: 4px dashed #ea580c; }
.jd-ev.order { background: #ffedd5; color: #9a3412; border-left: 4px solid #ea580c; }
.jd-ev.in { background: #dcfce7; color: #166534; border-left: 4px solid #16a34a; }
.jd-ev.out { background: #fee2e2; color: #991b1b; border-left: 4px solid #dc2626; }
.jd-now { position: absolute; left: 44px; right: 8px; height: 2px; background: #ef4444; margin-top: 8px; pointer-events: none; }
.jd-now::before { content: ''; position: absolute; left: -5px; top: -4px; width: 10px; height: 10px; border-radius: 50%; background: #ef4444; }
.jd-empty { position: absolute; left: 0; right: 0; top: 40%; text-align: center; font-size: 13px; color: var(--text-muted); margin: 0; }
.jd-hours { justify-self: center; border: none; background: none; font: inherit; font-size: 12px; color: var(--text-muted); cursor: pointer; padding: 6px; }
.jd-sheet-bg { position: fixed; inset: 0; z-index: 120; background: rgba(6,34,43,.4); display: flex; align-items: flex-end; justify-content: center; }
.jd-sheet { width: 100%; max-width: 600px; background: var(--surface); border-radius: 20px 20px 0 0; padding: 16px 16px calc(16px + env(safe-area-inset-bottom)); display: grid; gap: 10px; }
.jd-note { margin: 0; font-size: 12px; color: var(--text-muted); line-height: 1.6; }
.jd-row { display: flex; align-items: center; gap: 8px; }
.jd-row.end { justify-content: flex-end; }
.jd-row select { min-height: 40px; border: 1px solid var(--border); border-radius: 10px; padding: 0 8px; font: inherit; background: var(--surface); color: var(--text); }
.jd-mini { min-height: 40px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text); font-weight: 700; padding: 0 14px; cursor: pointer; }
.jd-mini.wide { width: 100%; }
.jd-save { min-height: 40px; border: none; border-radius: 10px; background: var(--grad-btn); color: #08323c; font-weight: 800; padding: 0 20px; cursor: pointer; }
.jd-save:disabled { opacity: .5; }
</style>
