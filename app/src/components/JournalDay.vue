<script setup>
/**
 * 日誌の「1日」（時間別。User決定 2026-10-09・モック docs/mocks/journal.html）。
 * - 時刻のあるやること・予定（発注の締切）・記録を時間の帯に
 * - 時刻の無いやることは「今日中」。帯の左に灰色の列を全時間に通し、残りの数を上に貼りつける（押すと一覧。
 *   以前は上に小さく並べただけで「やることが無い」ように見えた・User 2026-10-13）
 * - 上は「‹ 日付 ›」と要約。日付を押すと月カレンダー（DayPickerSheet）で過去の日もすぐ選べる
 * - 天気・祝日・日別メモ（発注学習の除外）もここで（月の日の詳細のモーダルを廃止して移した・2026-10-13）
 * - 棚卸は始め〜終わりの長さで左の列に。操作が5分以上なかった区間は「中断」として薄く
 * - 表示する時間帯は端末ごとに変えられる（営業時間に合わせる）。帯の外の出来事があれば広げて見せる
 * - 押すと: やること → その場で完了・直す（TaskRow）、棚卸 → 詳細、発注・入出庫 → 品目と数
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import TaskRow from './TaskRow.vue'
import RecordRow from './RecordRow.vue'
import DayPickerSheet from './DayPickerSheet.vue'
import { tasksOn, isMarkedByMe } from '../composables/useTasks.js'
import { can } from '../composables/useAuth.js'
import { useWeather } from '../composables/useWeather.js'
import { useDayNotes } from '../composables/useDayNotes.js'
import { dayFactors, consecutiveOffLength } from '../services/demandFactors.js'
import { useConfig } from '../composables/useConfig.js'
import { isOrderDay, scheduleName } from '../services/orderScheduleUtil.js'
import { fmtHm, fmtDuration } from '../services/journalRecords.js'
import { localDateKey } from '../utils/localDate.js'
import { STORAGE_KEYS } from '../utils/storageKeys.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

const props = defineProps({
  date:    { type: String, required: true },      // YYYY-MM-DD
  records: { type: Array, default: () => [] },     // その日の記録（journalRecords）
  marks:   { type: Function, default: () => ({}) }, // 日 → { stock, order, in, out, task }（日付選びのドット）
})
const emit = defineEmits(['update:date', 'view-session', 'add'])

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
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEK[d.getDay()]}）`
})
// 固定した上の段の高さ（「今日中」の数をその下に貼りつけるため）
const headEl = ref(null)
const headH = ref(0)
let _ro = null
onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !headEl.value) return
  _ro = new ResizeObserver(() => { headH.value = headEl.value?.offsetHeight || 0 })
  _ro.observe(headEl.value)
})
onUnmounted(() => _ro?.disconnect())
const untimedRecords = computed(() => props.records.filter(r => r.at == null))
const isToday = computed(() => props.date === localDateKey())
const picking = ref(false)
function pickDate(k) { picking.value = false; emit('update:date', k) }
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
const _checked = t => (t.assign === 'all' ? isMarkedByMe(t) || !!t.doneAt : !!t.doneAt)
const untimedLeft = computed(() => untimed.value.filter(t => !_checked(t)).length)
const tasksDone = computed(() => tasks.value.filter(_checked).length)
const untimedOpen = ref(false)

// この日のこと（天気・祝日・連休・日別メモ）
const { state: weatherState } = useWeather()
const wx = computed(() => weatherState.weather?.[props.date] || null)
const dayChips = computed(() => {
  const f = dayFactors(props.date)
  const out = []
  if (f.holidayName) out.push(`🎌 ${f.holidayName}`)
  if (f.span) out.push(f.span)
  else if (f.seasonBreak) out.push(f.seasonBreak)
  else { const n = consecutiveOffLength(props.date); if (n >= 3) out.push(`${n}連休`) }
  return out
})
const { getNote, setNote } = useDayNotes()
const note = computed(() => getNote(props.date))
const memoOpen = ref(false)
const memoText = ref(''), memoExcluded = ref(false)
function openMemo() {
  memoText.value = note.value?.text || ''; memoExcluded.value = !!note.value?.excluded; memoOpen.value = true
}
function saveMemo() {
  setNote(props.date, { text: memoText.value, tags: note.value?.tags ? [...note.value.tags] : [], excluded: memoExcluded.value })
  memoOpen.value = false
}
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
  if (untimedOpen.value) { untimedOpen.value = false; return true }
  if (memoOpen.value) { memoOpen.value = false; return true }
  if (picking.value) { picking.value = false; return true }
  return false
}))
function pick(x) {
  if (x.type === 'task') picked.value = { task: x.task }
  else if (x.rec?.kind === 'stock') emit('view-session', x.rec.session)
  else if (x.rec) picked.value = { rec: x.rec }
}
const fromOpts = Array.from({ length: 24 }, (_, i) => i)
const hf = ref(hours.value.from), ht = ref(hours.value.to)
function closeSheet() { picked.value = null; editHours.value = false; untimedOpen.value = false; memoOpen.value = false }
function addUntimed() { untimedOpen.value = false; emit('add') }
function openHours() { hf.value = hours.value.from; ht.value = hours.value.to; editHours.value = true }
</script>

<template>
  <div class="jd" :style="{ '--jd-head-h': headH + 'px' }">
    <!-- 日付と要約は上に固定（スクロールしても今どの日かが分かる・User 2026-10-13） -->
    <div ref="headEl" class="jd-head">
    <div class="jd-nav">
      <button type="button" class="jd-step" aria-label="前の日" @click="shift(-1)">‹</button>
      <button type="button" class="jd-date" aria-label="日付を選ぶ" @click="picking = true">{{ dateLabel }}<small v-if="isToday">今日</small></button>
      <button type="button" class="jd-step" aria-label="次の日" @click="shift(1)">›</button>
      <button v-if="!isToday" type="button" class="jd-today" @click="emit('update:date', localDateKey())">今日へ</button>
    </div>
    <div class="jd-sum">
      <span class="t">やること <b>{{ tasksDone }}/{{ tasks.length }}</b></span>
      <span>記録 <b>{{ records.length }}</b></span>
      <span v-if="plans.length">締切 <b>{{ plans.length }}</b></span>
      <span v-if="wx" class="wx">{{ wx.icon }}<template v-if="wx.tempHi != null"> {{ wx.tempHi }}°/{{ wx.tempLo }}°</template></span>
      <span v-for="c in dayChips" :key="c" class="fc">{{ c }}</span>
      <button type="button" :class="['memo', { has: note?.text || note?.excluded }]" @click="openMemo">📝 {{ note?.text ? note.text : (note?.excluded ? '学習から除外' : 'メモ') }}</button>
    </div>
    </div>

    <!-- 時刻の無い記録（取込など）は帯に置けないので上にまとめる -->
    <div v-if="untimedRecords.length" class="jd-box">
      <RecordRow v-for="r in untimedRecords" :key="r.key" :rec="r" @view-session="s => emit('view-session', s)" />
    </div>

    <div :class="['jd-tl', { lane: untimed.length }]" :style="{ height: height + 16 + 'px' }">
      <!-- button だと中身が縦の中央に寄り、数を上に貼りつけられない（sticky が効かない）ので div で押せるようにする -->
      <div
        v-if="untimed.length" class="jd-lane" role="button" tabindex="0"
        :aria-label="`今日中のやること ${untimed.length}件（残り${untimedLeft}）`"
        @click="untimedOpen = true" @keydown.enter.prevent="untimedOpen = true" @keydown.space.prevent="untimedOpen = true"
      >
        <span class="jd-lane-n">今日中<b>{{ untimedLeft }}</b>/{{ untimed.length }}</span>
      </div>
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
      <DayPickerSheet v-if="picking" :date="date" :marks="marks" @pick="pickDate" @close="picking = false" />
      <div v-if="picked || editHours || untimedOpen || memoOpen" class="jd-sheet-bg" @click.self="closeSheet">
        <div class="jd-sheet" role="dialog">
          <template v-if="untimedOpen">
            <div class="jd-sheet-h"><b>今日中のやること</b><small>残り {{ untimedLeft }} / {{ untimed.length }}</small></div>
            <div class="jd-list"><TaskRow v-for="t in untimed" :key="t.id" :task="t" /></div>
            <button v-if="can('task.create')" type="button" class="jd-add" @click="addUntimed">＋ 今日中のやることを追加</button>
          </template>
          <template v-else-if="memoOpen">
            <b>{{ dateLabel }}のメモ</b>
            <textarea v-model="memoText" class="jd-memo" rows="3" placeholder="この日のメモ（貸切・近隣イベント・メニュー変更 など）"></textarea>
            <label class="jd-excl"><input v-model="memoExcluded" type="checkbox" /> この日を発注学習から除外（貸切・イベント等の異常日）</label>
            <div class="jd-row end">
              <button type="button" class="jd-mini" @click="memoOpen = false">やめる</button>
              <button type="button" class="jd-save" @click="saveMemo">保存</button>
            </div>
          </template>
          <template v-else-if="editHours">
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
          <RecordRow v-else-if="picked.rec" :rec="picked.rec" @view-session="s => { picked = null; emit('view-session', s) }" />
          <button v-if="picked || untimedOpen" type="button" class="jd-mini wide" @click="closeSheet">閉じる</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.jd { display: grid; gap: 10px; padding: 8px 12px 150px; }
.jd-head { position: sticky; top: var(--jp-top-h, 0px); z-index: 2; display: grid; gap: 8px; margin: -8px -12px 0; padding: 8px 12px 8px; background: var(--bg); }
.jd-box { background: var(--surface); border-radius: 16px; padding: 0 10px; box-shadow: 0 1px 4px rgba(0,0,0,.05); }
.jd-nav { display: flex; align-items: center; gap: 6px; }
.jd-step { flex: none; width: 40px; height: 38px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); font-size: 18px; font-weight: 900; color: var(--text-muted); cursor: pointer; }
.jd-date { flex: 1; min-width: 0; height: 38px; border: none; border-radius: 10px; background: #e9f2f4; font: inherit; font-size: 15px; font-weight: 900; color: var(--text); display: flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; }
.jd-date::after { content: '▾'; font-size: 10px; color: var(--text-muted); }
.jd-date small { font-size: 10.5px; color: var(--primary); background: #cffafe; padding: 1px 7px; border-radius: 999px; }
.jd-today { flex: none; border: none; background: none; font: inherit; font-size: 12px; font-weight: 800; color: var(--primary); padding: 0 4px; cursor: pointer; }
.jd-sum { display: flex; gap: 6px; flex-wrap: wrap; font-size: 11.5px; font-weight: 800; }
.jd-sum > * { padding: 4px 9px; border-radius: 999px; background: var(--surface); color: var(--text-muted); border: 1px solid var(--border); }
.jd-sum b { color: var(--text); }
.jd-sum .t { background: #fff7ed; color: #9a3412; border-color: #fed7aa; } .jd-sum .t b { color: #9a3412; }
.jd-sum .fc { background: #fef2f2; color: #b91c1c; border-color: #fecaca; }
.jd-sum .memo { font: inherit; font-size: 11.5px; font-weight: 800; cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jd-sum .memo.has { background: #fffbeb; color: #92400e; border-color: #fde68a; }
/* 今日中の列: 全時間をまたぐ灰色の縞。残りの数は上に貼りつき、スクロールしても見える */
.jd-lane { position: absolute; left: 48px; width: 34px; top: 4px; bottom: 4px; padding: 0; border: 1px solid #cbd5e1; border-radius: 9px; cursor: pointer;
  background: repeating-linear-gradient(180deg, #e2e8f0, #e2e8f0 10px, #e9eef3 10px, #e9eef3 20px); z-index: 1; }
.jd-lane-n { position: sticky; top: calc(var(--jp-top-h, 0px) + var(--jd-head-h, 0px) + 6px); display: block; margin: 3px 2px 0; background: #475569; color: #fff; border-radius: 6px;
  font-size: 8.5px; font-weight: 900; line-height: 1.2; padding: 4px 0; text-align: center; letter-spacing: -.04em; }
.jd-lane-n b { display: block; font-size: 15px; letter-spacing: 0; }
.jd-tl.lane .jd-lanes { left: 88px; }
.jd-sheet-h { display: flex; justify-content: space-between; align-items: baseline; }
.jd-sheet-h small { font-size: 12px; color: var(--text-muted); font-weight: 700; }
.jd-list { max-height: 50vh; overflow-y: auto; }
.jd-add { border: 1px dashed var(--border); border-radius: 10px; background: none; padding: 10px; font: inherit; font-size: 13px; font-weight: 800; color: var(--primary); cursor: pointer; }
.jd-memo { width: 100%; box-sizing: border-box; border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; font: inherit; font-size: 14px; resize: vertical; }
.jd-excl { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-muted); }
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
