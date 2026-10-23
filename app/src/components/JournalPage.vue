<script>
import { ref, watch } from 'vue'
// 日誌の見え方（リスト／月／1日）。タブ内で覚える。トップの「今日のやること」からはリストで開く
const _VIEW_KEY = 'tanaoro_journal_view'
function _readView() {
  try { const v = sessionStorage.getItem(_VIEW_KEY); return ['list', 'month', 'day'].includes(v) ? v : 'list' } catch (_) { return 'list' }
}
export const journalView = ref(_readView())
watch(journalView, v => { try { sessionStorage.setItem(_VIEW_KEY, v) } catch (_) {} })
// 「1日」で見ている日。外（履歴の画面の月）からもこの日を指定して開く
export const journalDate = ref('')
</script>

<script setup>
/**
 * 日誌（業務日誌）。やること・予定・記録をひとつに（User決定 2026-10-09・モック docs/mocks/journal.html）。
 * 以前の「カレンダー」タブと「やること」画面をまとめた。
 * - リスト: 「やること」（期限切れ → 今日 → これから）・「済み」（直近30日に終えたやること。終えた日ごと）・
 *   「記録」（実行した棚卸・発注・入出庫。日ごと・新しい日から）を別の枠に
 * - 月: 今までのカレンダー（日ごとの印）。日付を押すとその日の「1日」へ（日の詳細のモーダルは廃止・2026-10-13）
 * - 1日: 時間別（JournalDay）
 * - リスト／月／1日の切り替えは下のナビのすぐ上の帯（親指が届く・User決定 2026-10-13。以前は上のタブ）。
 *   左右のスワイプでも切り替える（下のタブのスワイプをやめて空いた・User決定 2026-10-14。月の月送りは縦のまま）
 * - いつか（日付なし）はリストの「やること」の一番下にたたんで置く（月・1日・残りの数には出さない）
 * - 「今日」（2026-10-23・モック docs/mocks/journal-today-modern.html）: 上に今日ぜんぶの進み具合のリング。種類ごとに形を変える
 *   （ルーティン＝リングの丸を横に1段・進行中＝今日見るものを横に流れるカード・1回きりのやること＝リスト）。重なっても長くならない
 * - 進行中（2026-10-23・モック docs/mocks/journal-inprogress.html）: 「進行中」タブに縦のカード（止まり → 待ち → 進行中）。押すと ProgressSheet
 * - 記録タブの上に「ルーティンの記録」（色で抜けた日を見る・RoutineRecords）
 * - ルーティン（2026-10-19・2026-10-22 改名）: リストの一番上（DailyChecks）。設定・記録は ChecklistsPage。「＋」の「🔁 繰り返す」からも作れる（管理者）
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import TaskRow from './TaskRow.vue'
import DoneTaskRow from './DoneTaskRow.vue'
import RecordRow from './RecordRow.vue'
import JournalDay from './JournalDay.vue'
import HistoryCalendarPage from './HistoryCalendarPage.vue'
import TaskNews from './TaskNews.vue'
import ChecklistsPage from './ChecklistsPage.vue'
import DailyChecks from './DailyChecks.vue'
import ProgressCard from './ProgressCard.vue'
import ProgressSheet from './ProgressSheet.vue'
import RoutineRecords from './RoutineRecords.vue'
import ChecklistRunSheet from './ChecklistRunSheet.vue'
import { pullChecklists, checklistsForDay, saveChecklist, canEditChecklists, checklists } from '../composables/useChecklists.js'
import { monthDaysLabel } from '../services/checklistSchedule.js'
import { tasksOn, overdueTasks, aliveTasks, doneTaskGroups, somedayTasks, addTask, isForMe, pullTasks, TASK_TEXT_MAX, progressTasks, dueProgress, isStale } from '../composables/useTasks.js'
import { can, staffNames, loadStaffNames, getSessions, isAdmin } from '../composables/useAuth.js'
import { useHistory } from '../composables/useHistory.js'
import { useOrders } from '../composables/useOrders.js'
import { useMovements } from '../composables/useMovements.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'
import { stockRecords, mergeOrders, mergeMovements, sortRecords, stockDateKey } from '../services/journalRecords.js'
import { localDateKey } from '../utils/localDate.js'
import { isMeId } from '../composables/useDeviceId.js'
import { useHorizontalSwipe } from '../composables/useSwipe.js'

const emit = defineEmits(['viewSession', 'openUpgrade'])

const today = localDateKey()
const view = journalView
// 左へ払う＝次（リスト → 月 → 1日）、右へ払う＝前
const VIEWS = ['list', 'month', 'day']
const viewSlide = ref('')
function stepView(n) {
  const i = VIEWS.indexOf(view.value) + n
  if (i < 0 || i >= VIEWS.length) return
  viewSlide.value = n > 0 ? 'l' : 'r'
  view.value = VIEWS[i]
}
const viewSwipe = useHorizontalSwipe({ onLeft: () => stepView(1), onRight: () => stepView(-1), threshold: 60 })
const dayDate = journalDate
if (!dayDate.value) dayDate.value = today

// ── 材料 ──
const sessions = ref([])
onMounted(async () => {
  pullTasks(); pullChecklists(); loadStaffNames()
  try { sessions.value = await getSessions() } catch (_) { sessions.value = [] }
})
const { getSnapshotBySessionId } = useHistory()
const { getOrders } = useOrders()
const { getMovements } = useMovements()
const completedStock = computed(() => sessions.value.filter(s => s.status === 'completed' && (s.type ?? 'stock') !== 'order'))
/** その日の記録（棚卸・発注・入出庫）を時刻の順に */
function recordsOn(date) {
  const ss = completedStock.value.filter(s => stockDateKey(s, getSnapshotBySessionId(s.id)) === date)
  return sortRecords([
    ...stockRecords(ss, getSnapshotBySessionId),
    ...mergeOrders(getOrders().filter(o => o.date === date)),
    ...mergeMovements(getMovements().filter(m => m.date === date)),
  ])
}

// ── リスト ──
const listMode = ref('todo')     // todo（今日）| progress（進行中）| done | records
const mineOnly = ref(false)
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
function dayLabel(d) {
  const dt = new Date(d + 'T00:00:00')
  const tomorrow = localDateKey(new Date(Date.now() + 86400_000))
  const yesterday = localDateKey(new Date(Date.now() - 86400_000))
  const head = d === today ? '今日' : d === tomorrow ? '明日' : d === yesterday ? '昨日' : ''
  return `${head ? `${head} ・ ` : ''}${dt.getMonth() + 1}月${dt.getDate()}日（${WEEK[dt.getDay()]}）`
}
const _mine = list => (mineOnly.value ? list.filter(isForMe) : list)
const _time = (a, b) => (a.dueTime || '99').localeCompare(b.dueTime || '99') || (a.createdAt || '').localeCompare(b.createdAt || '')
const late = computed(() => _mine(overdueTasks(today)))
const todays = computed(() => _mine(tasksOn(today).filter(t => !t.progress)))   // 進行中は横のカードへ
const todayDone = computed(() => todays.value.filter(t => t.doneAt).length)
const laterGroups = computed(() => {
  const until = localDateKey(new Date(Date.now() + 60 * 86400_000))
  const m = new Map()
  for (const t of _mine(aliveTasks.value.filter(t => t.date > today && t.date <= until && !t.progress))) (m.get(t.date) ?? m.set(t.date, []).get(t.date)).push(t)
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, items]) => ({ date, items: items.sort(_time) }))
})
// 済み: 直近30日に終えたものを終えた日ごと（新しい日から）
const doneGroups = computed(() => {
  const since = localDateKey(new Date(Date.now() - 29 * 86400_000))
  return doneTaskGroups(since).map(g => ({ date: g.date, items: _mine(g.items) })).filter(g => g.items.length)
})
// 日付選びのドット: 日 → その日にあったこと（月のカレンダーと同じ色）
const markMap = computed(() => {
  const m = new Map()
  const on = (d, k) => { if (!d) return; (m.get(d) ?? m.set(d, {}).get(d))[k] = true }
  for (const s of completedStock.value) on(stockDateKey(s, getSnapshotBySessionId(s.id)), 'stock')
  for (const o of getOrders()) on(o.date, 'order')
  for (const mv of getMovements()) if (!mv.deletedAt) on(mv.date, mv.type === 'out' ? 'out' : 'in')
  for (const t of aliveTasks.value) on(t.date, 'task')
  return m
})
const marksOf = d => markMap.value.get(d) || {}
function openDay(d) { dayDate.value = d; view.value = 'day' }

// 上の帯（sticky）の高さ。1日の「今日中」の数をその下に貼りつけるため
const topEl = ref(null)
const topH = ref(0)
let _ro = null
onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !topEl.value) return
  _ro = new ResizeObserver(() => { topH.value = topEl.value?.offsetHeight || 0 })
  _ro.observe(topEl.value)
})
onUnmounted(() => _ro?.disconnect())

const someday = computed(() => _mine(somedayTasks.value))
const somedayOpen = ref(false)
const todayLists = computed(() => (mineOnly.value ? [] : checklistsForDay(today)))
// 進行中: 今日見るもの（次に見る日が今日か過ぎた）は「今日」の横のカード、全部は「進行中」タブ（止まり → 待ち → 進行中）
const progDue = computed(() => _mine(dueProgress(today)))
const _rank = t => (isStale(t) ? 0 : t.progress === 'waiting' ? 1 : 2)
const progFilter = ref('all')   // all | mine | waiting
const progList = computed(() => progressTasks.value
  .filter(t => progFilter.value === 'mine' ? isForMe(t) : progFilter.value === 'waiting' ? t.progress === 'waiting' : true)
  .sort((a, b) => _rank(a) - _rank(b) || (a.date || '').localeCompare(b.date || '')))
const progOpen = ref(null)   // 開いている進行中のやること
const recOpen = ref(null)    // { focus } ルーティンの記録
// 今日ぜんぶの進み具合（ルーティン・今日見る進行中・今日と期限切れのやること）
const todayTotal = computed(() => todayLists.value.length + progDue.value.length + todays.value.length + late.value.length)
const todayDoneAll = computed(() => todayLists.value.filter(r => r.complete).length + todays.value.filter(t => t.doneAt).length)
const todayPct = computed(() => (todayTotal.value ? Math.round(todayDoneAll.value / todayTotal.value * 100) : 0))
const remaining = computed(() => todayTotal.value - todayDoneAll.value)

// ── ルーティン ──
const clPage = ref(null)     // { historyOf?, create? } で開いている
const clRun = ref(null)      // { cl, date, slot } の✓の画面
function openClHistory(cl) { clRun.value = null; recOpen.value = { focus: cl } }
// 記録: 直近30日を新しい日から（その日の中は時刻の順）
const recordGroups = computed(() => {
  const out = []
  for (let i = 0; i < 30; i++) {
    const d = localDateKey(new Date(Date.now() - i * 86400_000))
    const recs = recordsOn(d)
    if (recs.length) out.push({ date: d, recs })
  }
  return out
})
const todayRecordCount = computed(() => recordsOn(today).length)

// ── 追加（＋）──
const canCreate = computed(() => can('task.create'))
const adding = ref(false)
const fText = ref(''), fDate = ref(today), fTime = ref(''), fWho = ref('anyone'), fSomeday = ref(false)
const people = computed(() => staffNames.value)
// ⏳ 何日かかかる（進行中・User決定 2026-10-23）: 日付の代わりに「次に見る日」と、任意の期限
const fProg = ref(false), fNext = ref(''), fDeadline = ref('')
const _plus = n => { const d = new Date(today + 'T00:00:00'); d.setDate(d.getDate() + n); return localDateKey(d) }
const NEXT_PICKS = [['明日', 1], ['3日後', 3], ['1週間後', 7]]
function openAdd(progress = false) {
  fProg.value = progress === true; fNext.value = _plus(1); fDeadline.value = ''
  fText.value = ''; fDate.value = view.value === 'day' ? dayDate.value : today; fTime.value = ''; fWho.value = 'anyone'; fSomeday.value = false
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
  <div
    :class="['jp', viewSlide && `slide-${viewSlide}`]" :style="{ '--jp-top-h': topH + 'px' }"
    @touchstart.passive="viewSwipe.onTouchStart" @touchmove.passive="viewSwipe.onTouchMove"
    @touchend.passive="viewSwipe.onTouchEnd" @touchcancel.passive="viewSwipe.onTouchCancel"
  >
    <div ref="topEl" class="jp-top">
      <div class="jp-title"><b>業務日誌</b><small>残り {{ remaining }}</small></div>
      <div v-if="view === 'list'" class="jp-flt">
        <button type="button" :class="{ on: listMode === 'todo' }" :aria-pressed="listMode === 'todo'" @click="listMode = 'todo'">今日</button>
        <button type="button" :class="{ on: listMode === 'progress' }" :aria-pressed="listMode === 'progress'" @click="listMode = 'progress'">進行中<b v-if="progressTasks.length" class="jp-tn">{{ progressTasks.length }}</b></button>
        <button type="button" :class="{ on: listMode === 'done' }" :aria-pressed="listMode === 'done'" @click="listMode = 'done'">済み</button>
        <button type="button" :class="{ on: listMode === 'records' }" :aria-pressed="listMode === 'records'" @click="listMode = 'records'">
          記録<template v-if="todayRecordCount"> {{ todayRecordCount }}</template>
        </button>
        <button v-if="listMode === 'todo' || listMode === 'done'" type="button" :class="['mine', { on: mineOnly }]" :aria-pressed="mineOnly" @click="mineOnly = !mineOnly">自分の担当</button>
      </div>
    </div>

    <!-- リスト: やること -->
    <div v-if="view === 'list' && listMode === 'todo'" class="jp-list">
      <div v-if="todayTotal" class="jp-sum">
        <div><b>今日</b><small>{{ dayLabel(today).replace('今日 ・ ', '') }} ・ {{ todayTotal }} のうち {{ todayDoneAll }} 済み</small></div>
        <span class="jp-ring" :style="{ background: `conic-gradient(#4f46e5 0 ${todayPct}%, #e0e7ff 0)` }"><i>{{ todayDoneAll }}/{{ todayTotal }}</i></span>
      </div>
      <DailyChecks @open-run="x => clRun = x" @settings="clPage = {}" @create="clPage = { create: true }" @records="recOpen = { focus: null }" />
      <template v-if="progressTasks.length">
        <div class="jp-lh2"><b>⏳ 進行中</b><em>{{ progDue.length ? `今日見る ${progDue.length}` : `今日見るものはなし ・ ${progressTasks.length}件 進行中` }}</em>
          <button type="button" class="jp-all" @click="listMode = 'progress'">すべて {{ progressTasks.length }} ›</button></div>
        <div v-if="progDue.length" class="jp-cards"><ProgressCard v-for="t in progDue" :key="t.id" :task="t" @open="progOpen = t" /></div>
      </template>
      <TaskNews />
      <template v-if="late.length">
        <div class="jp-lh late"><span>期限切れ</span><span>{{ late.length }}</span></div>
        <div class="jp-box"><TaskRow v-for="t in late" :key="t.id" :task="t" show-date /></div>
      </template>
      <div class="jp-lh"><span>{{ dayLabel(today) }}</span><span>{{ todayDone }}/{{ todays.length }}</span></div>
      <div class="jp-box">
        <TaskRow v-for="t in todays" :key="t.id" :task="t" />
        <p v-if="!todays.length" class="jp-empty">{{ mineOnly ? '今日の自分の担当はありません' : '今日のやることはありません' }}</p>
      </div>
      <template v-for="g in laterGroups" :key="g.date">
        <div class="jp-lh"><span>{{ dayLabel(g.date) }}</span><span>{{ g.items.length }}</span></div>
        <div class="jp-box"><TaskRow v-for="t in g.items" :key="t.id" :task="t" /></div>
      </template>
      <template v-if="someday.length">
        <button type="button" class="jp-lh jp-someday" :aria-expanded="somedayOpen" @click="somedayOpen = !somedayOpen">
          <span>いつか {{ somedayOpen ? '▲' : '▼' }}</span><span>{{ someday.length }}</span>
        </button>
        <div v-if="somedayOpen" class="jp-box"><TaskRow v-for="t in someday" :key="t.id" :task="t" /></div>
      </template>
    </div>

    <!-- リスト: 進行中（縦に積むカード・止まり → 待ち → 進行中） -->
    <div v-else-if="view === 'list' && listMode === 'progress'" class="jp-list">
      <div class="jp-seg" role="group" aria-label="しぼる">
        <button v-for="f in [['all', 'すべて'], ['mine', '自分の'], ['waiting', '待ち']]" :key="f[0]" type="button" :class="{ on: progFilter === f[0] }" :aria-pressed="progFilter === f[0]" @click="progFilter = f[0]">{{ f[1] }}</button>
      </div>
      <div class="jp-vcards"><ProgressCard v-for="t in progList" :key="t.id" :task="t" wide @open="progOpen = t" /></div>
      <p v-if="!progList.length" class="jp-empty solo">進行中のやることはありません。何日もかかる仕事（修理・準備など）は「＋」から「⏳ 何日かかかる」で</p>
      <button v-if="canCreate" type="button" class="jp-addp" @click="openAdd(true)">＋ 進行中のやることを追加</button>
    </div>

    <!-- リスト: 済み（終えた日ごと。✓ を外すと「やること」へ戻る） -->
    <div v-else-if="view === 'list' && listMode === 'done'" class="jp-list">
      <template v-for="g in doneGroups" :key="g.date">
        <div class="jp-lh"><span>{{ dayLabel(g.date) }}</span><span>{{ g.items.length }}件</span></div>
        <div class="jp-box"><DoneTaskRow v-for="t in g.items" :key="t.id" :task="t" /></div>
      </template>
      <p v-if="!doneGroups.length" class="jp-empty solo">{{ mineOnly ? 'この30日に終えた自分の担当はありません' : 'この30日に終えたやることはありません' }}</p>
      <p v-else class="jp-empty solo">表示は直近30日まで（それより前は「月」から）</p>
    </div>

    <!-- リスト: 記録（別の枠） -->
    <div v-else-if="view === 'list'" class="jp-list">
      <button v-if="checklists.length" type="button" class="jp-rec" @click="recOpen = { focus: null }">📅 ルーティンの記録<small>抜けた日・やった日を色で</small><em>›</em></button>
      <template v-for="g in recordGroups" :key="g.date">
        <div class="jp-lh"><span>{{ dayLabel(g.date) }}</span><span>{{ g.recs.length }}件</span></div>
        <div class="jp-box"><RecordRow v-for="r in g.recs" :key="r.key" :rec="r" @view-session="s => emit('viewSession', s)" /></div>
      </template>
      <p v-if="!recordGroups.length" class="jp-empty solo">この30日の記録はありません（棚卸・発注・入出庫をすると、ここに残ります）</p>
    </div>

    <!-- 月（今までのカレンダー） -->
    <HistoryCalendarPage
      v-else-if="view === 'month'"
      class="jp-month" embedded in-journal
      @view-session="s => emit('viewSession', s)"
      @open-upgrade="r => emit('openUpgrade', r)"
      @pick-day="openDay"
    />

    <!-- 1日（時間別） -->
    <JournalDay v-else v-model:date="dayDate" :records="recordsOn(dayDate)" :marks="marksOf" @view-session="s => emit('viewSession', s)" @add="openAdd" @checklist-history="openClHistory" />

    <!-- リスト／月／1日の切り替え。下のナビのすぐ上（親指が届く） -->
    <div class="jp-views" role="tablist" aria-label="見え方">
      <button v-for="v in [['list', 'リスト'], ['month', '月'], ['day', '1日']]" :key="v[0]" type="button" role="tab"
        :aria-selected="view === v[0]" :class="{ on: view === v[0] }" @click="view = v[0]">{{ v[1] }}</button>
    </div>

    <button v-if="canCreate && view !== 'month'" type="button" class="jp-fab" aria-label="やることを追加" @click="openAdd(view === 'list' && listMode === 'progress')">＋</button>

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
.jp-top { position: sticky; top: 0; z-index: 3; background: var(--surface); padding: 12px 14px 10px; border-bottom: 1px solid var(--border); display: grid; gap: 10px; }
.jp-title { display: flex; align-items: baseline; gap: 8px; }
.jp-title b { font-size: 17px; letter-spacing: .04em; }
.jp-title small { margin-left: auto; font-size: 12px; color: var(--text-muted); font-weight: 700; }
.jp-views {
  position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(60px + env(safe-area-inset-bottom)); z-index: 6;
  width: calc(100% - 24px); max-width: 576px; display: grid; grid-template-columns: repeat(3, 1fr);
  background: #e9f2f4; border: 1px solid var(--border); border-radius: 14px; padding: 3px; box-shadow: 0 -2px 10px rgba(6,34,43,.08);
}
.jp-views button { border: none; background: none; font: inherit; font-size: 13.5px; font-weight: 800; min-height: 40px; border-radius: 11px; color: var(--text-muted); cursor: pointer; }
.jp-views button.on { background: var(--surface); color: var(--primary-deep); box-shadow: 0 1px 3px rgba(0,0,0,.12); }
.jp-flt { display: flex; gap: 6px; }
.jp-flt button { border: none; font: inherit; font-size: 12px; font-weight: 800; padding: 6px 11px; border-radius: 999px; background: #f1f7f9; color: var(--text-muted); cursor: pointer; }
.jp-flt button.on { background: var(--primary-deep); color: #fff; }
.jp-flt button.mine { margin-left: auto; background: var(--primary-weak, #ecfeff); color: var(--primary); border: 1px solid #a5f3fc; }
.jp-flt button.mine.on { background: var(--primary); color: #fff; border-color: transparent; }
.jp-list { padding: 4px 12px 150px; }
.jp-someday { width: 100%; border: none; background: none; font: inherit; font-size: 11px; font-weight: 800; letter-spacing: .06em; color: var(--text-muted); cursor: pointer; }
.jp-chk { display: flex !important; grid-template-columns: none; align-items: center; gap: 6px; font-size: 13px !important; color: var(--text) !important; }
.jp-tn { margin-left: 4px; font-size: 11px; background: #fef3c7; color: #92400e; border-radius: 999px; padding: 0 6px; }
.jp-sum { display: flex; align-items: center; gap: 12px; margin: 10px 2px 4px; padding: 12px 14px; border-radius: 18px; background: linear-gradient(135deg, #eef2ff, #f5f3ff); }
.jp-sum > div { flex: 1; display: grid; gap: 2px; } .jp-sum b { font-size: 18px; } .jp-sum small { font-size: 12px; color: var(--text-muted); font-weight: 700; }
.jp-ring { flex: none; width: 54px; height: 54px; border-radius: 50%; display: grid; place-items: center; }
.jp-ring i { width: 42px; height: 42px; border-radius: 50%; background: #fff; display: grid; place-items: center; font-style: normal; font-size: 12px; font-weight: 900; color: #3730a3; }
.jp-lh2 { display: flex; align-items: baseline; gap: 8px; padding: 14px 4px 8px; } .jp-lh2 b { font-size: 14px; }
.jp-lh2 em { flex: 1; font-style: normal; font-size: 11.5px; color: var(--text-muted); font-weight: 700; }
.jp-all { border: none; background: none; color: #4f46e5; font: inherit; font-size: 12px; font-weight: 800; cursor: pointer; padding: 2px 0; }
.jp-cards { display: flex; gap: 10px; overflow-x: auto; padding: 2px 2px 12px; scroll-snap-type: x mandatory; scrollbar-width: none; }
.jp-cards > * { scroll-snap-align: start; }
.jp-vcards { display: grid; gap: 10px; padding-top: 10px; }
.jp-addp { width: 100%; margin-top: 12px; min-height: 44px; border: 1.5px dashed #c7d2fe; border-radius: 14px; background: #f5f7ff; color: #3730a3; font: inherit; font-weight: 800; cursor: pointer; }
.jp-rec { width: 100%; margin-top: 10px; display: flex; align-items: center; gap: 8px; text-align: left; border: none; border-radius: 14px; padding: 12px 14px; background: #ecfdf5; color: #065f46; font: inherit; font-weight: 800; cursor: pointer; }
.jp-rec small { flex: 1; font-size: 11.5px; font-weight: 700; color: #047857; } .jp-rec em { font-style: normal; }
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
.jp-month { flex: 1; padding-bottom: 54px; }
.jp-fab { position: fixed; right: max(18px, calc(50% - 300px + 18px)); bottom: calc(124px + env(safe-area-inset-bottom)); width: 56px; height: 56px; border-radius: 50%; border: none; background: var(--grad-btn); color: #08323c; font-size: 28px; display: grid; place-items: center; box-shadow: 0 8px 20px rgba(14,116,144,.35); cursor: pointer; z-index: 20; }
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
