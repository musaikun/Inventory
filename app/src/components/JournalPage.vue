<script>
import { ref } from 'vue'
// 日誌で見ている日（外＝ホームや棚卸の詳細からもこの日を指定して開く）。'' は今日
export const journalDate = ref('')
</script>

<script setup>
/**
 * 日誌（業務日誌）＝お店のカレンダー（User決定 2026-10-25・モック docs/mocks/journal-calendar-v4.html）。
 * - 上に週の帯（下に引くと月・JournalWeek）。日を押すとその日の中身
 * - 担当者で絞る（すべて・自分・その日に担当がある人・未定。数は残り）
 * - 中身: 棚卸・発注の途中（今日だけ）→ その日のまとめ（済みのリング・伝票 ›）→ ルーティン○とやること□を時刻の順に1本 → 進行中（今日だけ）
 * - 何もない店は3つのボタンだけ、何もない日は「☕ 今日はなし」と「これから」（7日先まで・4件）
 * - 伝票（DaySlip）: その日のやり残し・済み・記録・メモ。🕒 時間で見る（JournalDay）・📤 日報で送る
 * - 画面の中の説明文は置かない（ボタンと絵で伝える・User 2026-10-25）
 * 以前の「リスト／月／1日」の切り替えと「今日／進行中／済み／記録」のタブはやめた
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import TaskRow from './TaskRow.vue'
import JournalDay from './JournalDay.vue'
import JournalWeek from './JournalWeek.vue'
import RoutineRow from './RoutineRow.vue'
import DaySlip from './DaySlip.vue'
import HandoffBlock from './HandoffBlock.vue'
import HandoffSheet from './HandoffSheet.vue'
import LiveSessionCard from './LiveSessionCard.vue'
import TaskNews from './TaskNews.vue'
import ChecklistsPage from './ChecklistsPage.vue'
import ProgressCard from './ProgressCard.vue'
import ProgressSheet from './ProgressSheet.vue'
import RoutineRecords from './RoutineRecords.vue'
import ChecklistRunSheet from './ChecklistRunSheet.vue'
import { pullChecklists, checklistsForDay, saveChecklist, canEditChecklists, checklists } from '../composables/useChecklists.js'
import { monthDaysLabel, upcoming } from '../services/checklistSchedule.js'
import { tasksOn, overdueTasks, aliveTasks, somedayTasks, addTask, isForMe, pullTasks, TASK_TEXT_MAX, progressTasks, dueProgress, isStale } from '../composables/useTasks.js'
import { can, staffNames, loadStaffNames, getSessions, isAdmin } from '../composables/useAuth.js'
import { useHistory } from '../composables/useHistory.js'
import { useOrders } from '../composables/useOrders.js'
import { useMovements } from '../composables/useMovements.js'
import { useConfig } from '../composables/useConfig.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'
import { stockRecords, mergeOrders, mergeMovements, sortRecords, stockDateKey } from '../services/journalRecords.js'
import { isOrderDay, scheduleName } from '../services/orderScheduleUtil.js'
import { pullHandoffs, handoffs, handoffOfTask } from '../composables/useHandoffs.js'
import { localDateKey } from '../utils/localDate.js'
import { isMeId } from '../composables/useDeviceId.js'

const props = defineProps({
  // 棚卸・発注の途中（ホームと同じ。今日を見ているときだけカードを出す）
  activeSession: { type: Object, default: null },
  activeOrderSession: { type: Object, default: null },
  live: { type: Object, default: null },
  liveOrder: { type: Object, default: null },
  stockCount: { type: Number, default: 0 },
  orderCount: { type: Number, default: 0 },
})
const emit = defineEmits(['viewSession', 'openUpgrade', 'resume'])

const today = localDateKey()
const date = journalDate
if (!date.value) date.value = today
watch(date, v => { if (!v) date.value = today })
const isToday = computed(() => date.value === today)
// 時間で見る（JournalDay）
const timeOpen = ref(false)
const slipOpen = ref(false)
const hs = ref(null)   // 申し送りを書く { convert }

// ── 材料 ──
const sessions = ref([])
onMounted(async () => {
  pullTasks(); pullChecklists(); pullHandoffs(); loadStaffNames()
  try { sessions.value = await getSessions() } catch (_) { sessions.value = [] }
})
const { getSnapshotBySessionId } = useHistory()
const { getOrders } = useOrders()
const { getMovements } = useMovements()
const { config } = useConfig()
const completedStock = computed(() => sessions.value.filter(s => s.status === 'completed' && (s.type ?? 'stock') !== 'order'))
/** その日の記録（棚卸・発注・入出庫）を時刻の順に */
function recordsOn(d) {
  const ss = completedStock.value.filter(s => stockDateKey(s, getSnapshotBySessionId(s.id)) === d)
  return sortRecords([
    ...stockRecords(ss, getSnapshotBySessionId),
    ...mergeOrders(getOrders().filter(o => o.date === d)),
    ...mergeMovements(getMovements().filter(m => m.date === d)),
  ])
}
const stockDays = computed(() => new Set(completedStock.value.map(s => stockDateKey(s, getSnapshotBySessionId(s.id)))))
const orderDays = computed(() => new Set(getOrders().map(o => o.date)))
const _orderPlans = d => (config.orderSchedules || []).map((s, i) => (isOrderDay(s, new Date(d + 'T12:00:00')) ? scheduleName(s, i) : null)).filter(Boolean)

// ── その日の中身 ──
const _plain = d => tasksOn(d).filter(t => !t.progress)
/** 週の帯・月のマス: 済み具合と大きな業務の印 */
function dayInfo(d) {
  const ts = _plain(d)
  const ls = checklistsForDay(d)
  const total = ts.length + ls.length
  const done = ts.filter(t => t.doneAt).length + ls.filter(r => r.complete).length
  const icon = stockDays.value.has(d) ? '📦' : orderDays.value.has(d) ? '🧾' : (d > today && _orderPlans(d).length ? '🧾' : '')
  const st = !total || d > today ? '' : done === total ? 'y' : d === today ? (done ? 'p' : 't') : (done ? 'p' : 'x')
  return { st, icon, plan: d > today && _orderPlans(d).length ? '発注' : '' }
}
// 担当者で絞る: all | me | none | p:<id>
const who = ref('all')
const _taskOf = (t, w) => (w === 'all' ? true : w === 'me' ? isForMe(t) : w === 'none' ? t.assign === 'none' : t.assign === 'person' && t.assigneeId === w.slice(2))
const _listOf = (r, w) => (w === 'all' ? true : w === 'me' ? r.cl.assign === 'person' && isMeId(r.cl.assigneeId) : w === 'none' ? false : r.cl.assign === 'person' && r.cl.assigneeId === w.slice(2))
const late = computed(() => (isToday.value ? overdueTasks(today) : []))
const dayTasks = computed(() => _plain(date.value))
const dayLists = computed(() => checklistsForDay(date.value))
// 人の並び: すべて・自分・その日に担当がある人・未定（数は残り）
const people = computed(() => staffNames.value)
const chips = computed(() => {
  const ts = [...late.value, ...dayTasks.value]
  const left = (w) => ts.filter(t => !t.doneAt && _taskOf(t, w)).length + dayLists.value.filter(r => !r.complete && _listOf(r, w)).length
  const ids = new Map()
  for (const t of ts) if (t.assign === 'person' && t.assigneeId && !isMeId(t.assigneeId)) ids.set(t.assigneeId, t.assigneeName || '')
  for (const r of dayLists.value) if (r.cl.assign === 'person' && r.cl.assigneeId && !isMeId(r.cl.assigneeId)) ids.set(r.cl.assigneeId, r.cl.assigneeName || '')
  const out = [{ key: 'all', label: 'すべて', n: left('all') }, { key: 'me', label: '自分', n: left('me'), me: true }]
  for (const [id, name] of ids) out.push({ key: `p:${id}`, label: name || '担当', n: left(`p:${id}`), av: (name || '?').slice(0, 1) })
  if (ts.some(t => t.assign === 'none')) out.push({ key: 'none', label: '未定', n: left('none') })
  return out
})
watch(date, () => { if (!chips.value.some(c => c.key === who.value)) who.value = 'all' })
// 1本のリスト: 期限切れ → 時刻の順（時刻なしは後ろ）。ルーティン○とやること□をまぜる
const rows = computed(() => {
  const w = who.value
  const out = [
    ...late.value.filter(t => _taskOf(t, w)).map(t => ({ key: t.id, type: 'task', task: t, late: true, sort: '' })),
    ...dayTasks.value.filter(t => _taskOf(t, w)).map(t => ({ key: t.id, type: 'task', task: t, sort: t.dueTime || '~' })),
    ...dayLists.value.filter(r => _listOf(r, w)).map(r => ({ key: `cl-${r.cl.id}`, type: 'list', day: r, sort: r.slots.find(x => x.slot)?.slot || '~' })),
  ]
  return out.sort((a, b) => (a.late ? 0 : 1) - (b.late ? 0 : 1) || (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0))
})
const dayTotal = computed(() => rows.value.length)
const dayDone = computed(() => rows.value.filter(x => (x.type === 'task' ? x.task.doneAt : x.day.complete)).length)
const remaining = computed(() => late.value.length + dayTasks.value.filter(t => !t.doneAt).length + dayLists.value.filter(r => !r.complete).length)
const someday = computed(() => (isToday.value ? somedayTasks.value.filter(t => _taskOf(t, who.value)) : []))
const somedayOpen = ref(false)
// 進行中（今日だけ）: 次に見る日が来たもの。全部は「›」のシート（止まり → 待ち → 進行中）
const progDue = computed(() => (isToday.value ? dueProgress(today).filter(t => _taskOf(t, who.value)) : []))
const _rank = t => (isStale(t) ? 0 : t.progress === 'waiting' ? 1 : 2)
const progAllOpen = ref(false)
const progList = computed(() => [...progressTasks.value].sort((a, b) => _rank(a) - _rank(b) || (a.date || '').localeCompare(b.date || '')))
const progOpen = ref(null)
const recOpen = ref(null)    // { focus } ルーティンの記録
// 何もない店（はじめて）と、何もない日
const brandNew = computed(() => !aliveTasks.value.length && !checklists.value.length && !handoffs.value.length && !completedStock.value.length && !getOrders().length && !getMovements().length)
// これから（何もない日・7日先まで・4件）: やること・毎週/毎月のルーティン・発注日
const ahead = computed(() => {
  const out = []
  const from = new Date(date.value + 'T00:00:00')
  for (let i = 1; i <= 7; i++) {
    const d = localDateKey(new Date(from.getFullYear(), from.getMonth(), from.getDate() + i))
    for (const t of _plain(d)) out.push({ key: t.id, date: d, icon: '✓', text: t.text })
    for (const n of _orderPlans(d)) out.push({ key: `o-${d}-${n}`, date: d, icon: '🧾', text: n })
  }
  for (const x of upcoming(checklists.value, date.value, { days: 7, limit: 4 })) out.push({ key: `c-${x.cl.id}`, date: x.date, icon: '🔁', text: x.cl.name })
  return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4)
})
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const md = k => { const d = new Date(k + 'T00:00:00'); return `${d.getDate()} ${WEEK[d.getDay()]}` }
const title = computed(() => { const d = new Date(date.value + 'T00:00:00'); return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）` })

// ── ルーティン ──
const clPage = ref(null)     // { historyOf?, create? } で開いている
const clRun = ref(null)      // { cl, date, slot } の✓の画面
function openClHistory(cl) { clRun.value = null; recOpen.value = { focus: cl } }
const marksOf = d => { const i = dayInfo(d); return { task: !!i.st, stock: i.icon === '📦', order: i.icon === '🧾' } }

// ── 追加（＋）──
const canCreate = computed(() => can('task.create'))
const adding = ref(false)
const fText = ref(''), fDate = ref(today), fTime = ref(''), fWho = ref('anyone'), fSomeday = ref(false)
// ⏳ 何日かかかる（進行中・User決定 2026-10-23）: 日付の代わりに「次に見る日」と、任意の期限
const fProg = ref(false), fNext = ref(''), fDeadline = ref('')
const _plus = n => { const d = new Date(today + 'T00:00:00'); d.setDate(d.getDate() + n); return localDateKey(d) }
const NEXT_PICKS = [['明日', 1], ['3日後', 3], ['1週間後', 7]]
function openAdd(progress = false) {
  fProg.value = progress === true; fNext.value = _plus(1); fDeadline.value = ''
  fText.value = ''; fDate.value = date.value < today ? today : date.value; fTime.value = ''; fWho.value = 'anyone'; fSomeday.value = false
  fRepeatOpen.value = false; fRepeat.value = 'none'; fWeekdays.value = []; fMonthDays.value = ['1']; fErr.value = ''; adding.value = true
}
// 管理者は追加のたびに「みんなに見せる／管理者だけ」を選ぶ（User決定 2026-10-19）。
// チェックの付け忘れで全員に見えたり、気にしすぎて見せたいのに隠したりしないように、追加のボタンを2つにする
// 🔁 繰り返す（管理者・User決定 2026-10-22）: 選ぶとルーティンになる。ふだんはボタン1つにたたんで、1回きりの追加を邪魔しない
const fRepeatOpen = ref(false), fRepeat = ref('none'), fWeekdays = ref([]), fMonthDays = ref(['1']), fDayDraft = ref('1'), fErr = ref(''), fBusy = ref(false)
const repeating = computed(() => fRepeat.value !== 'none')
const _mdSort = a => [...new Set(a)].sort((x, y) => (x === 'L' ? 99 : Number(x)) - (y === 'L' ? 99 : Number(y)))
function toggleWeekday(d) { fWeekdays.value = fWeekdays.value.includes(d) ? fWeekdays.value.filter(x => x !== d) : [...fWeekdays.value, d].sort() }
function addMonthDay() { fMonthDays.value = _mdSort([...fMonthDays.value, fDayDraft.value]) }
function toggleMonthEnd() { fMonthDays.value = fMonthDays.value.includes('L') ? fMonthDays.value.filter(x => x !== 'L') : _mdSort([...fMonthDays.value, 'L']) }
const repeatNote = computed(() => {
  const w = fRepeat.value === 'daily' ? '毎日' : fRepeat.value === 'weekly' ? (fWeekdays.value.length ? `毎週 ${fWeekdays.value.map(d => WEEK[d]).join('・')}` : '') : (fMonthDays.value.length ? `毎月${monthDaysLabel(fMonthDays.value.join(','))}` : '')
  return w ? `🔁 ${w}のルーティンになります。中の項目（チェック表）はあとから足せます` : '🔁 曜日・日を選んでください'
})
const canAddRepeat = computed(() => fText.value.trim() && (fRepeat.value === 'daily' || (fRepeat.value === 'weekly' && fWeekdays.value.length) || (fRepeat.value === 'monthly' && fMonthDays.value.length)))
async function submitRoutine() {
  if (!canAddRepeat.value || fBusy.value) return
  const v = fWho.value
  const pid = v.startsWith('p:') ? v.slice(2) : null
  fBusy.value = true; fErr.value = ''
  try {
    await saveChecklist({
      name: fText.value, items: [], repeat: fRepeat.value,
      repeatDays: fRepeat.value === 'weekly' ? fWeekdays.value.join(',') : fRepeat.value === 'monthly' ? fMonthDays.value.join(',') : null,
      dueTimes: fTime.value ? [fTime.value] : [],
      assign: pid ? 'person' : 'anyone', assigneeId: pid, assigneeName: pid ? (people.value.find(p => p.id === pid)?.name || '') : null,
    })
    adding.value = false
  } catch (e) { fErr.value = e?.message || '保存できませんでした' } finally { fBusy.value = false }
}
const canSubmit = computed(() => !!fText.value.trim() && (fProg.value ? !!fNext.value : (fSomeday.value || !!fDate.value)))
function submitAdd(adminsOnly = false) {
  const v = fWho.value
  const assign = v.startsWith('p:') ? { mode: 'person', id: v.slice(2), name: people.value.find(p => p.id === v.slice(2))?.name || '' } : { mode: v }
  const visibility = adminsOnly ? 'admins' : null
  const ok = fProg.value
    ? addTask(fNext.value, fText.value, assign, null, { visibility, progress: 'doing', deadline: fDeadline.value || null })
    : addTask(fSomeday.value ? '' : fDate.value, fText.value, assign, fSomeday.value ? null : (fTime.value || null), { visibility })
  if (ok) adding.value = false
}
onUnmounted(registerInnerLayerCloser(() => { if (!adding.value) return false; adding.value = false; return true }))
</script>

<template>
  <div class="jp">
    <div class="jp-top">
      <div class="jp-title">
        <b>{{ title }}</b>
        <button v-if="!isToday" type="button" class="jp-tb" @click="date = today">今日</button>
        <button v-if="canCreate" type="button" class="jp-tb" aria-label="申し送り" @click="hs = { convert: null }">📣</button>
        <button type="button" :class="['jp-tb', { on: timeOpen }]" :aria-pressed="timeOpen" :aria-label="timeOpen ? 'リストで見る' : '時間で見る'" @click="timeOpen = !timeOpen">{{ timeOpen ? '≡' : '🕒' }}</button>
        <button v-if="checklists.length || canEditChecklists" type="button" class="jp-tb" aria-label="ルーティン" @click="clPage = {}">🔁</button>
      </div>
      <JournalWeek v-model="date" :today="today" :info="dayInfo" />
    </div>

    <!-- 時間で見る（今の「1日」） -->
    <JournalDay v-if="timeOpen" v-model:date="date" :records="recordsOn(date)" :marks="marksOf" @view-session="s => emit('viewSession', s)" @add="openAdd" @checklist-history="openClHistory" />

    <div v-else class="jp-list">
      <!-- 何もない店 -->
      <div v-if="brandNew" class="jp-new">
        <div class="jp-new-ic" aria-hidden="true">🗓</div>
        <b>まだ何もありません</b>
        <div class="jp-new-b">
          <button v-if="canCreate" type="button" class="main" @click="openAdd()"><em>✓</em>やること</button>
          <button v-if="canEditChecklists" type="button" @click="clPage = {}"><em>🔁</em>ルーティン</button>
          <button v-if="canCreate" type="button" @click="hs = { convert: null }"><em>📣</em>申し送り</button>
        </div>
      </div>

      <template v-else>
        <div v-if="chips.length > 2 || who !== 'all'" class="jp-ppl" role="group" aria-label="担当者">
          <button v-for="c in chips" :key="c.key" type="button" :class="{ on: who === c.key }" :aria-pressed="who === c.key" @click="who = c.key">
            <i v-if="c.av" class="jp-av">{{ c.av }}</i>{{ c.label }}<em>{{ c.n }}</em>
          </button>
        </div>

        <HandoffBlock :date="date" :who="who" @convert="h => hs = { convert: h }" />

        <template v-if="isToday">
          <LiveSessionCard v-if="activeSession" kind="stock" :session="activeSession" :live="live" :count="stockCount" @resume="s => emit('resume', s)" />
          <LiveSessionCard v-if="activeOrderSession" kind="order" :session="activeOrderSession" :live="liveOrder" :count="orderCount" @resume="s => emit('resume', s)" />
          <TaskNews />
        </template>

        <template v-if="rows.length">
          <button type="button" class="jp-sumr" @click="slipOpen = true">
            <span class="jp-ring" :style="{ background: `conic-gradient(${dayDone === dayTotal ? '#22c55e' : '#f59e0b'} 0 ${Math.round(dayDone / dayTotal * 100)}%, #e2e8f0 0)` }"><i>{{ dayDone }}/{{ dayTotal }}</i></span>
            <span class="jp-sumt">{{ isToday ? '今日' : title }}</span><em>伝票 ›</em>
          </button>
          <div class="jp-box">
            <template v-for="x in rows" :key="x.key">
              <RoutineRow v-if="x.type === 'list'" :day="x.day" :date="date" @open-run="v => clRun = v" />
              <TaskRow v-else :task="x.task" :show-date="!!x.late" :mark="handoffOfTask.has(x.task.id) ? '🙏' : ''" />
            </template>
          </div>
        </template>
        <template v-else>
          <button type="button" class="jp-quiet" @click="slipOpen = true">☕ {{ isToday ? '今日' : 'この日' }}はなし</button>
          <template v-if="ahead.length && date >= today">
            <div class="jp-lh"><span>これから</span></div>
            <div class="jp-box jp-ahead">
              <button v-for="a in ahead" :key="a.key" type="button" @click="date = a.date"><em>{{ md(a.date) }}</em>{{ a.icon }} {{ a.text }}</button>
            </div>
          </template>
        </template>

        <template v-if="someday.length">
          <button type="button" class="jp-lh jp-someday" :aria-expanded="somedayOpen" @click="somedayOpen = !somedayOpen">
            <span>いつか {{ somedayOpen ? '▲' : '▼' }}</span><span>{{ someday.length }}</span>
          </button>
          <div v-if="somedayOpen" class="jp-box"><TaskRow v-for="t in someday" :key="t.id" :task="t" /></div>
        </template>

        <template v-if="isToday && progressTasks.length">
          <div class="jp-lh"><span>⏳ 進行中</span><button type="button" class="jp-all" @click="progAllOpen = true">{{ progressTasks.length }} ›</button></div>
          <div v-if="progDue.length" class="jp-cards"><ProgressCard v-for="t in progDue" :key="t.id" :task="t" @open="progOpen = t" /></div>
        </template>
      </template>
    </div>

    <button v-if="canCreate && !brandNew" type="button" class="jp-fab" aria-label="やることを追加" @click="openAdd()">＋</button>

    <DaySlip v-if="slipOpen" :date="date" :tasks="[...(isToday ? late : []), ...dayTasks]" :lists="dayLists" :records="recordsOn(date)"
      @close="slipOpen = false" @time="slipOpen = false; timeOpen = true" @view-session="s => emit('viewSession', s)" @open-run="v => { slipOpen = false; clRun = v }" />
    <HandoffSheet v-if="hs" :convert="hs.convert" @close="hs = null" />
    <Teleport to="body">
      <div v-if="progAllOpen" class="jp-sheet-bg" @click.self="progAllOpen = false">
        <div class="jp-sheet jp-progall" role="dialog" aria-label="進行中">
          <div class="jp-ph"><b>⏳ 進行中</b><button type="button" class="jp-mini" @click="progAllOpen = false">閉じる</button></div>
          <div class="jp-vcards"><ProgressCard v-for="t in progList" :key="t.id" :task="t" wide @open="progAllOpen = false; progOpen = t" /></div>
          <button v-if="canCreate" type="button" class="jp-addp" @click="progAllOpen = false; openAdd(true)">＋ ⏳</button>
        </div>
      </div>
    </Teleport>
    <ChecklistsPage v-if="clPage" :key="clPage.historyOf?.id || (clPage.create ? 'new' : 'list')" :history-of="clPage.historyOf" :create="!!clPage.create" @close="clPage = null" @open-run="x => clRun = x" />
    <ProgressSheet v-if="progOpen" :task="progOpen" @close="progOpen = null" />
    <RoutineRecords v-if="recOpen" :focus="recOpen.focus" @close="recOpen = null" @open-run="x => clRun = x" />
    <ChecklistRunSheet v-if="clRun" :cl="clRun.cl" :date="clRun.date" :slot="clRun.slot || ''" @close="clRun = null" @history="openClHistory" />
    <Teleport to="body">
      <div v-if="adding" class="jp-sheet-bg" @click.self="adding = false">
        <form class="jp-sheet" role="dialog" aria-label="やることを追加" @submit.prevent="!isAdmin && submitAdd(false)">
          <b class="jp-sheet-t">やることを追加</b>
          <input v-model="fText" type="text" :maxlength="TASK_TEXT_MAX" placeholder="例：製氷機のフィルター交換" aria-label="やること" class="jp-in" />
          <div v-if="!repeating" class="jp-seg jp-kind" role="group" aria-label="やることの種類">
            <button type="button" :class="{ on: !fProg }" :aria-pressed="!fProg" @click="fProg = false">今日・日付を決める</button>
            <button type="button" :class="{ on: fProg }" :aria-pressed="fProg" @click="fProg = true">⏳ 何日かかかる（進行中）</button>
          </div>
          <div v-if="fProg" class="jp-prog">
            <span class="jp-prog-l">次に見る日</span>
            <div class="jp-seg">
              <button v-for="n in NEXT_PICKS" :key="n[1]" type="button" :class="{ on: fNext === _plus(n[1]) }" :aria-pressed="fNext === _plus(n[1])" @click="fNext = _plus(n[1])">{{ n[0] }}</button>
              <input v-model="fNext" type="date" class="jp-in jp-sm" aria-label="次に見る日" />
            </div>
            <label>期限（任意）<input v-model="fDeadline" type="date" class="jp-in" /></label>
            <p class="jp-rep-note">⏳ 済むまで「進行中」に残ります。次に見る日に「今日」へ出てきます（期限切れにはなりません）</p>
          </div>
          <div v-if="!fProg && (!fSomeday || repeating)" class="jp-row">
            <label v-if="!repeating">日付<input v-model="fDate" type="date" class="jp-in" /></label>
            <label>時刻<input v-model="fTime" type="time" class="jp-in" /></label>
          </div>
          <label v-if="!repeating && !fProg" class="jp-chk"><input v-model="fSomeday" type="checkbox" /> いつか（日付を決めない）</label>
          <button v-if="canEditChecklists && !fRepeatOpen && !fProg" type="button" class="jp-rep-open" @click="fRepeatOpen = true">🔁 繰り返す</button>
          <div v-if="fRepeatOpen" class="jp-rep">
            <div class="jp-seg">
              <button v-for="r in [['none', 'しない'], ['daily', '毎日'], ['weekly', '曜日'], ['monthly', '毎月']]" :key="r[0]" type="button"
                :class="{ on: fRepeat === r[0] }" :aria-pressed="fRepeat === r[0]" @click="fRepeat = r[0]">{{ r[1] }}</button>
            </div>
            <div v-if="fRepeat === 'weekly'" class="jp-seg">
              <button v-for="(w, d) in WEEK" :key="d" type="button" :class="{ on: fWeekdays.includes(d) }" :aria-pressed="fWeekdays.includes(d)" @click="toggleWeekday(d)">{{ w }}</button>
            </div>
            <div v-if="fRepeat === 'monthly'" class="jp-seg">
              <button v-for="d in fMonthDays" :key="d" type="button" class="on" @click="fMonthDays = fMonthDays.filter(x => x !== d)">{{ d === 'L' ? '月末' : `${d}日` }} ✕</button>
              <select v-model="fDayDraft" class="jp-in jp-sm" aria-label="足す日"><option v-for="n in 31" :key="n" :value="String(n)">{{ n }}日</option></select>
              <button type="button" @click="addMonthDay">＋ 日</button>
              <button type="button" :class="{ on: fMonthDays.includes('L') }" @click="toggleMonthEnd">月末</button>
            </div>
            <p v-if="repeating" class="jp-rep-note">{{ repeatNote }}</p>
          </div>
          <label v-if="people.some(p => !p.owner)">担当
            <select v-model="fWho" class="jp-in">
              <option value="anyone">誰でも</option>
              <option value="all">全員</option>
              <option value="none">未定</option>
              <option v-for="p in people" :key="p.id" :value="`p:${p.id}`">{{ p.name }}{{ isMeId(p.id) ? '（自分）' : '' }}</option>
            </select>
          </label>
          <p v-if="fErr" class="jp-err" role="alert">{{ fErr }}</p>
          <div v-if="repeating" class="jp-row end">
            <button type="button" class="jp-mini" @click="adding = false">やめる</button>
            <button type="button" class="jp-save" :disabled="!canAddRepeat || fBusy" @click="submitRoutine">🔁 ルーティンとして追加</button>
          </div>
          <div v-else class="jp-row end">
            <button type="button" class="jp-mini" @click="adding = false">やめる</button>
            <button v-if="!isAdmin" type="submit" class="jp-save" :disabled="!canSubmit">{{ fProg ? '進行中として追加' : '追加' }}</button>
          </div>
          <!-- 管理者: 誰に見せるかを追加のたびに選ぶ（管理者だけ＝面談・給与・クレームなど。ほかのスタッフの端末には届かない） -->
          <div v-if="isAdmin && !repeating" class="jp-add2">
            <button type="button" class="jp-save" :disabled="!canSubmit" @click="submitAdd(false)">みんなに見せて追加</button>
            <button type="button" class="jp-save admins" :disabled="!canSubmit" @click="submitAdd(true)">🔒 管理者だけで追加</button>
          </div>
        </form>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.jp-rep-open { justify-self: start; border: 1px dashed #a5b4fc; background: #eef2ff; color: #3730a3; border-radius: 999px; padding: 6px 12px; font: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer; }
.jp-rep { display: grid; gap: 6px; background: #f5f7ff; border: 1px solid #c7d2fe; border-radius: 12px; padding: 8px; }
.jp-seg { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.jp-seg button { border: 1px solid var(--border); background: var(--surface); border-radius: 9px; padding: 7px 10px; font: inherit; font-size: 12.5px; font-weight: 800; color: var(--text-muted); cursor: pointer; }
.jp-seg button.on { background: #4f46e5; border-color: #4f46e5; color: #fff; }
.jp-sm { width: auto !important; min-height: 36px !important; font-size: 13px !important; }
.jp-rep-note { margin: 0; font-size: 12px; font-weight: 700; color: #3730a3; line-height: 1.5; }
.jp-err { margin: 0; font-size: 12.5px; color: #b91c1c; font-weight: 700; }
.jp-add2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.jp-add2 .jp-save { width: 100%; min-height: 46px; }
.jp-save.admins { background: #475569; color: #fff; }
.jp { position: relative; display: flex; flex-direction: column; min-height: 100%; background: var(--bg); }
.jp-top { position: sticky; top: 0; z-index: 3; background: var(--surface); padding: 10px 12px 2px; border-bottom: 1px solid var(--border); display: grid; gap: 6px; }
.jp-title { display: flex; align-items: center; gap: 8px; }
.jp-title b { font-size: 19px; letter-spacing: .04em; }
.jp-title small { margin-left: auto; font-size: 12px; color: var(--text-muted); font-weight: 700; }
.jp-list { padding: 4px 12px 150px; display: grid; gap: 8px; align-content: start; }
.jp-tb { border: none; background: #f1f5f9; border-radius: 999px; min-width: 36px; height: 32px; padding: 0 12px; font: inherit; font-size: 13px; font-weight: 800; color: var(--primary, #0e7490); cursor: pointer; }
.jp-title b { margin-right: auto; }
.jp-tb.on { background: #0f2a33; color: #fff; }
.jp-ppl { display: flex; gap: 6px; overflow-x: auto; padding: 6px 0 2px; scrollbar-width: none; }
.jp-ppl button { flex: none; display: flex; align-items: center; gap: 5px; border: 1px solid var(--border); background: var(--surface); border-radius: 999px; padding: 4px 11px 4px 5px; font: inherit; font-size: 12.5px; font-weight: 800; color: #475569; cursor: pointer; min-height: 32px; }
.jp-ppl button:not(:has(.jp-av)) { padding-left: 11px; }
.jp-ppl button em { font-style: normal; font-size: 11px; color: var(--text-muted); }
.jp-ppl button.on { background: #0f2a33; color: #fff; border-color: #0f2a33; } .jp-ppl button.on em { color: #a5d8e3; }
.jp-av { width: 22px; height: 22px; border-radius: 50%; background: #0e7490; color: #fff; font-style: normal; font-size: 10.5px; font-weight: 900; display: grid; place-items: center; }
.jp-sumr { display: flex; align-items: center; gap: 8px; border: none; background: none; font: inherit; padding: 6px 2px 0; cursor: pointer; color: var(--text-muted); font-weight: 800; font-size: 13px; }
.jp-sumr em { margin-left: auto; font-style: normal; color: var(--primary, #0e7490); font-size: 12.5px; }
.jp-ring { flex: none; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; }
.jp-ring i { width: 26px; height: 26px; border-radius: 50%; background: var(--bg); display: grid; place-items: center; font-style: normal; font-size: 9px; font-weight: 900; color: var(--text); }
.jp-quiet { border: none; background: var(--surface); border-radius: 16px; padding: 16px; font: inherit; font-size: 15px; font-weight: 800; color: var(--text); cursor: pointer; margin-top: 8px; }
.jp-ahead { display: grid; padding: 4px 10px; }
.jp-ahead button { display: flex; align-items: center; gap: 10px; border: none; background: none; font: inherit; font-size: 13.5px; font-weight: 700; color: var(--text); text-align: left; padding: 8px 0; cursor: pointer; border-top: 1px solid #eef4f6; }
.jp-ahead button:first-child { border-top: none; }
.jp-ahead em { font-style: normal; font-size: 11px; font-weight: 900; color: #c2410c; border: 1px dashed #fdba74; border-radius: 6px; padding: 1px 6px; min-width: 46px; text-align: center; }
.jp-new { background: var(--surface); border-radius: 18px; padding: 22px 16px; display: grid; gap: 12px; justify-items: center; margin-top: 12px; }
.jp-new-ic { font-size: 42px; line-height: 1; } .jp-new b { font-size: 16px; }
.jp-new-b { display: flex; gap: 8px; width: 100%; }
.jp-new-b button { flex: 1; display: grid; gap: 4px; justify-items: center; border: 1px solid var(--border); background: #f8fafc; border-radius: 14px; padding: 14px 4px; font: inherit; font-size: 13px; font-weight: 900; color: var(--text); cursor: pointer; }
.jp-new-b button em { font-style: normal; font-size: 22px; }
.jp-new-b button.main { background: #ecfeff; border-color: #a5f3fc; color: #0e7490; }
.jp-progall { max-height: 86vh; overflow-y: auto; }
.jp-ph { display: flex; align-items: center; justify-content: space-between; }
.jp-someday { width: 100%; border: none; background: none; font: inherit; font-size: 11px; font-weight: 800; letter-spacing: .06em; color: var(--text-muted); cursor: pointer; }
.jp-chk { display: flex !important; grid-template-columns: none; align-items: center; gap: 6px; font-size: 13px !important; color: var(--text) !important; }
.jp-all { border: none; background: none; color: #4f46e5; font: inherit; font-size: 12px; font-weight: 800; cursor: pointer; padding: 2px 0; }
.jp-cards { display: flex; gap: 10px; overflow-x: auto; padding: 2px 2px 12px; scroll-snap-type: x mandatory; scrollbar-width: none; }
.jp-cards > * { scroll-snap-align: start; }
.jp-vcards { display: grid; gap: 10px; padding-top: 10px; }
.jp-addp { width: 100%; margin-top: 12px; min-height: 44px; border: 1.5px dashed #c7d2fe; border-radius: 14px; background: #f5f7ff; color: #3730a3; font: inherit; font-weight: 800; cursor: pointer; }
.jp-kind button { flex: 1; }
.jp-prog { display: grid; gap: 6px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; padding: 8px; }
.jp-prog-l { font-size: 12px; font-weight: 800; color: #92400e; }
.jp-prog .jp-rep-note { color: #92400e; }
.jp-lh { font-size: 11px; font-weight: 800; letter-spacing: .06em; color: var(--text-muted); padding: 12px 4px 6px; display: flex; justify-content: space-between; }
.jp-lh.late { color: #b91c1c; }
.jp-box { background: var(--surface); border-radius: 16px; padding: 0 10px; box-shadow: 0 1px 4px rgba(0,0,0,.05); overflow: hidden; }
.jp-box > :first-child { border-top: none; }
.jp-empty { margin: 0; padding: 12px 4px; font-size: 13px; color: var(--text-muted); }
.jp-empty.solo { padding: 28px 8px; text-align: center; line-height: 1.6; }
.jp-fab { position: fixed; right: max(18px, calc(50% - 300px + 18px)); bottom: calc(76px + env(safe-area-inset-bottom)); width: 56px; height: 56px; border-radius: 50%; border: none; background: var(--grad-btn); color: #08323c; font-size: 28px; display: grid; place-items: center; box-shadow: 0 8px 20px rgba(14,116,144,.35); cursor: pointer; z-index: 20; }
.jp-sheet-bg { position: fixed; inset: 0; z-index: 120; background: rgba(6,34,43,.4); display: flex; align-items: flex-end; justify-content: center; }
.jp-sheet { width: 100%; max-width: 600px; background: var(--surface); border-radius: 20px 20px 0 0; padding: 18px 16px calc(18px + env(safe-area-inset-bottom)); display: grid; gap: 10px; }
.jp-sheet-t { font-size: 16px; }
.jp-sheet label { display: grid; gap: 3px; font-size: 11.5px; font-weight: 800; color: var(--text-muted); }
.jp-in { width: 100%; min-height: 42px; border: 1px solid var(--border); border-radius: 10px; padding: 0 10px; font: inherit; font-size: 15px; background: var(--surface); color: var(--text); box-sizing: border-box; }
.jp-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.jp-row.end { display: flex; justify-content: flex-end; }
.jp-mini { min-height: 42px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text); font-weight: 700; padding: 0 14px; cursor: pointer; }
.jp-save { min-height: 42px; border: none; border-radius: 10px; background: var(--grad-btn); color: #08323c; font-weight: 800; padding: 0 22px; cursor: pointer; }
.jp-save:disabled { opacity: .5; }
</style>
