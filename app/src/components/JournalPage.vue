<script>
import { ref } from 'vue'
// 日誌で見ている日（外＝ホームや棚卸の詳細からもこの日を指定して開く）。'' は今日
export const journalDate = ref('')
// 日誌を開いたときは月のカレンダー（User決定 2026-11-05）。外から「この日を開いて」と頼まれたときだけ、その日を開いて始める
let _openOnMount = false, _viewOnMount = '', _itemOnMount = null
/** その日を開く。view を渡すとその日の見せ方（'board' 予定ボード / 'list' 一覧）で始める（好みとしては残さない） */
export function openJournalDay(d, { view = '' } = {}) { journalDate.value = d; _openOnMount = true; _viewOnMount = view }
/** その日を開いて、さらに中身のシートも開く（ホームの「店の今」から・User 2026-11-08）
 *  item: { type: 'task'|'progress', id } | { type: 'list', clId, slot } */
export function openJournalItem(d, item) { openJournalDay(d); _itemOnMount = item }
</script>

<script setup>
/**
 * 日誌（業務日誌）＝お店のカレンダー（User決定 2026-10-26・モック キャンバス「日誌カレンダー」①）。
 * 何をやったか・これから何をするかを見る（申し送り・連絡は日誌に出さない。ホームの「連絡」へ）。
 * - 開くと月のカレンダーを画面いっぱいに（JournalMonth）。マスは日付・札2つまで・済み具合の帯1本
 * - 日を押すと、そのマスが広がってその日の中身をタイムラインで（DayTimeline・行は services/dayTimeline.js）
 *   丸を押すと済む、行を押すと中身。＋でその日に追加。前後の日へも送れる
 * 以前の「週の帯・担当者で絞る・伝票・申し送りの欄」（2026-10-25）はやめた
 */
import LineIcon from './LineIcon.vue'
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import TaskRow from './TaskRow.vue'
import JournalMonth from './JournalMonth.vue'
import DayTimeline from './DayTimeline.vue'
import ChecklistsPage from './ChecklistsPage.vue'
import ProgressSheet from './ProgressSheet.vue'
import RoutineRecords from './RoutineRecords.vue'
import ChecklistRunSheet from './ChecklistRunSheet.vue'
import TaskAddSheet from './TaskAddSheet.vue'
import ChecklistTemplatesPage from './ChecklistTemplatesPage.vue'
import TaskSteps from './TaskSteps.vue'
import CopyDatesSheet from './CopyDatesSheet.vue'
import { addTemplate, canAddTemplate, pullTemplates } from '../composables/useTemplates.js'
import { pullChecklists, checklists, checklistsForDay, saveChecklist, newItemId, markChecklistItem, canMarkChecklist, canUnmark } from '../composables/useChecklists.js'
import { monthDaysLabel, isSimple, WHOLE } from '../services/checklistSchedule.js'
import { tasksOn, overdueTasks, carriedTasks, somedayTasks, addTask, pullTasks, editTask, setTaskAssign, TASK_TEXT_MAX, TASK_NOTE_MAX, dueProgress, toggleTask, canToggleTask, canEditTask, canNoteTask, setTaskNote, startTask, canProgress, canRemoveTask, removeTask, aliveTasks, progressTasks, isStale } from '../composables/useTasks.js'
import { can, staffNames, loadStaffNames, getSessions, isAdmin } from '../composables/useAuth.js'
import { useHistory } from '../composables/useHistory.js'
import { useOrders } from '../composables/useOrders.js'
import { useMovements } from '../composables/useMovements.js'
import { useDayNotes } from '../composables/useDayNotes.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'
import { stockRecords, mergeOrders, mergeMovements, sortRecords, stockDateKey, stockWorkDays } from '../services/journalRecords.js'
import { buildDayTimeline } from '../services/dayTimeline.js'
import { localDateKey } from '../utils/localDate.js'
import { isMeId } from '../composables/useDeviceId.js'

const props = defineProps({
  // 棚卸・発注の途中（今日のタイムラインに「途中」で出す）
  activeSession: { type: Object, default: null },
  activeOrderSession: { type: Object, default: null },
  stockCount: { type: Number, default: 0 },
  orderCount: { type: Number, default: 0 },
})
const emit = defineEmits(['viewSession', 'openUpgrade', 'resume'])

const today = localDateKey()
// 外（ホーム・履歴の画面）からこの日を指定して開く。'' は月だけ
const date = journalDate
const open = ref(_openOnMount && !!date.value)
_openOnMount = false
const viewOnce = ref(_viewOnMount)   // 外から頼まれた見せ方（最初の1日だけ）
_viewOnMount = ''
const _item0 = _itemOnMount
_itemOnMount = null
const origin = ref(null)
watch(date, v => { if (v) open.value = true })
function pick(d, o) { origin.value = o; date.value = d; open.value = true }
function closeDay() { open.value = false; viewOnce.value = '' }
function stepDay(n) {
  viewOnce.value = ''
  const d = new Date((date.value || today) + 'T00:00:00'); d.setDate(d.getDate() + n)
  origin.value = null; date.value = localDateKey(d)
}

// ── 材料 ──
const sessions = ref([])
onMounted(async () => {
  pullTasks(); pullChecklists(); pullTemplates(); loadStaffNames()
  try { sessions.value = await getSessions() } catch (_) { sessions.value = [] }
})
const { getSnapshotBySessionId } = useHistory()
const { getOrders } = useOrders()
const { getMovements } = useMovements()
const { getNote, setNote } = useDayNotes()
const completedStock = computed(() => sessions.value.filter(s => s.status === 'completed' && (s.type ?? 'stock') !== 'order'))
/** その日の記録（棚卸・発注・入出庫）を時刻の順に */
function recordsOn(d) {
  // 日をまたいだ棚卸は、始めた日にも終えた日にも出す（その日の分だけ・services/dayTimeline.js）
  const ss = completedStock.value.filter(s => { const w = stockWorkDays(s, getSnapshotBySessionId(s.id)); return w.from <= d && d <= w.to })
  return sortRecords([
    ...stockRecords(ss, getSnapshotBySessionId),
    ...mergeOrders(getOrders().filter(o => o.date === d)),
    ...mergeMovements(getMovements().filter(m => m.date === d)),
  ])
}
const stockDays = computed(() => new Set(completedStock.value.map(s => stockDateKey(s, getSnapshotBySessionId(s.id)))))
const orderDays = computed(() => new Set(getOrders().map(o => o.date)))
const _plain = d => tasksOn(d).filter(t => !t.progress)

/** 月のマス: 済み具合の帯と札（棚卸・発注・メモ。先の日は予定を点線） */
// 帯: 過ぎた日は 全部済み／一部／やり残し。今日から先で登録した業務があれば青の「予定あり」（User決定 2026-11-07）。
// 毎日・毎週のルーティンだけでは青にしない（どの日も青くなって見分けられない）。1回きりのやること・チェック表で数える
function dayInfo(d) {
  const ts = _plain(d)
  const ls = checklistsForDay(d)
  const total = ts.length + ls.length
  const done = ts.filter(t => t.doneAt).length + ls.filter(r => r.complete).length
  // 予定: まだのやること・チェック表。繰り返しも入れる（毎日のものは全部の日が青くなるので入れない・User 2026-11-08）
  const plans = d < today ? [] : [
    ...ts.filter(t => !t.doneAt).map(t => t.text),
    ...ls.filter(r => !r.complete && r.cl.repeat !== 'daily').map(r => r.cl.name),
  ]
  const planned = plans.length
  const st = d < today ? (!total ? '' : done === total ? 'y' : done ? 'p' : 'x')
    : total && done === total ? 'y' : planned ? 'f' : ''
  const fut = d > today
  const tags = []
  if (stockDays.value.has(d) || (d === today && props.activeSession)) tags.push({ label: '棚卸', kind: 'stock' })
  // 発注スケジュール（発注日の予定）はカレンダーに出さない（User決定 2026-10-26）。実際にした発注だけ
  if (orderDays.value.has(d) || (d === today && props.activeOrderSession)) tags.push({ label: '発注', kind: 'order' })
  const note = getNote(d)?.text
  if (note) tags.push({ label: note.slice(0, 8), kind: 'plan', future: fut })
  // 先の予定は名前も出す（カレンダーだけで何があるか分かるように・User 2026-11-08）
  for (const p of plans) tags.push({ label: p.slice(0, 8), kind: 'plan', future: fut })
  return { st, tags }
}

// ── その日の中身 ──
const timeline = computed(() => {
  const d = date.value || today
  const isToday = d === today
  const live = isToday ? [
    ...(props.activeSession ? [{ kind: 'stock', session: props.activeSession, count: props.stockCount }] : []),
    ...(props.activeOrderSession ? [{ kind: 'order', session: props.activeOrderSession, count: props.orderCount }] : []),
  ] : []
  return buildDayTimeline({
    date: d, today, tasks: _plain(d), lists: checklistsForDay(d), records: recordsOn(d), live,
    late: isToday ? overdueTasks(today) : [], carry: isToday ? carriedTasks(today) : [], progress: isToday ? dueProgress(today) : progressOn(d),
    note: getNote(d)?.text || '', someday: isToday ? somedayTasks.value : [],
  })
})
const picked = ref(null)     // 直す: やること1件（TaskRow を出す）
// 備考: 直せない担当の人も書き足せる（直せる人は TaskRow の「直す」で）
const pNote = ref('')
watch(picked, t => { pNote.value = t?.note || '' })
// 消す（作った人と管理者・未完了の間。User決定 2026-11-07）
function deletePicked() {
  const t = picked.value
  if (!t || !window.confirm(`「${t.text}」を消しますか？`)) return
  if (removeTask(t.id)) { picked.value = null; say(`「${t.text}」を消しました`) }
}
// いつかのものを始める（今日から進行中・User決定 2026-11-07）
function startPicked() {
  const t = picked.value
  if (!t || !startTask(t.id)) return
  picked.value = null
  say(`「${t.text}」を始めました`)
}
function savePickedNote() { if (picked.value) setTaskNote(picked.value.id, pNote.value); picked.value = null }
const progOpen = ref(null)
const recOpen = ref(null)    // { focus } ルーティンの記録
const memoOpen = ref(false), memoText = ref(''), memoExcluded = ref(false)
function openMemo() { const n = getNote(date.value) || {}; memoText.value = n.text || ''; memoExcluded.value = !!n.excluded; memoOpen.value = true }
function saveMemo() { setNote(date.value, { text: memoText.value, tags: getNote(date.value)?.tags || [], excluded: memoExcluded.value }); memoOpen.value = false }
const err = ref('')
/** 丸: その場で済む・取り消す（押せないものは中身を開いて理由を見せる） */
async function check(x) {
  err.value = ''
  if (x.ref.type === 'task') { if (canToggleTask(x.ref.task)) toggleTask(x.ref.task.id); else picked.value = x.ref.task; return }
  if (x.ref.type === 'list') {
    const s = x.ref.run
    if (!isSimple(s.cl)) { clRun.value = { cl: s.cl, date: s.date, slot: s.slot }; return }
    const m = s.marks[WHOLE]
    if (!canMarkChecklist(s.cl) || (m && !canUnmark(m)) || s.date > today) { clRun.value = { cl: s.cl, date: s.date, slot: s.slot }; return }
    try { await markChecklistItem(s.cl, s.date, s.slot, WHOLE, m ? null : 'done') } catch (e) { err.value = e?.message || '保存できませんでした' }
  }
}
/** 行: 中身を開く */
// 進行中をカレンダーに帯で（実施日〜締め切り。締め切りが無ければ今日まで・User決定 2026-11-08）
const progSpans = computed(() => progressTasks.value.map(t => {
  const start = t.date || today
  const end = t.deadline ? (t.deadline < start ? start : t.deadline) : (start > today ? start : today)
  const state = t.deadline && t.deadline < today ? 'over' : isStale(t) ? 'stale' : t.progress === 'waiting' ? 'wait' : 'doing'
  return { id: t.id, text: t.text, start, end, state, future: start > today }
}))
// その日に帯がかかっている進行中（日を押したときにも出す・User 2026-11-08）
function progressOn(d) {
  const ids = new Set(progSpans.value.filter(s => s.start <= d && d <= s.end).map(s => s.id))
  return progressTasks.value.filter(t => ids.has(t.id))
}
function openSpan(id) { progOpen.value = progressTasks.value.find(t => t.id === id) ?? null }
// 外から頼まれた中身を開く（無くなっていれば日だけ）
function _openOutside(it) {
  if (!it) return
  if (it.type === 'task') picked.value = aliveTasks.value.find(t => t.id === it.id) ?? null
  else if (it.type === 'progress') progOpen.value = progressTasks.value.find(t => t.id === it.id) ?? null
  else if (it.type === 'list') {
    const cl = checklists.value.find(c => c.id === it.clId)
    if (cl) clRun.value = { cl, date: date.value || today, slot: it.slot || '' }
  }
}
onMounted(() => _openOutside(_item0))
function openItem(x) {
  const r = x.ref
  if (r.type === 'task') picked.value = r.task
  else if (r.type === 'progress') progOpen.value = r.task
  else if (r.type === 'list') clRun.value = { cl: r.run.cl, date: r.run.date, slot: r.run.slot }
  else if (r.type === 'record' && r.rec.kind === 'stock') emit('viewSession', r.rec.session)
  else if (r.type === 'live') emit('resume', r.session)
  else if (r.type === 'note') openMemo()
}

// ── ルーティン ──
const clPage = ref(null)     // { historyOf?, create? } で開いている
const clRun = ref(null)      // { cl, date, slot } の✓の画面
function openClHistory(cl) { clRun.value = null; recOpen.value = { focus: cl } }

const people = computed(() => staffNames.value)
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
onUnmounted(registerInnerLayerCloser(() => {
  if (picked.value) { picked.value = null; return true }
  if (memoOpen.value) { memoOpen.value = false; return true }
  return false
}))

// ── 追加（＋）: ただ1つの入口（TaskAddSheet・種類は入れた中身で決まる・User決定 2026-11-07）──
const canCreate = computed(() => can('task.create'))
const addSheet = ref(null)   // null | { startKind?, template?, checklist? }
function openAdd(progress = false) { if (canCreate.value) addSheet.value = { startKind: progress === true ? 'progress' : '' } }
const ctOpen = ref(false)    // チェック表（ひな形）の画面
// 追加の途中でチェック表を作りに行ったら、戻るときに打った中身ごと追加へ戻す（User 2026-11-10）
let _ctBack = null
function toTemplates(draft) { _ctBack = draft ? { ...addSheet.value, draft } : null; addSheet.value = null; ctOpen.value = true }
function fromTemplates(extra = null) {
  ctOpen.value = false
  const back = _ctBack; _ctBack = null
  if (extra?.template) { addSheet.value = { template: extra.template }; return }   // お気に入りは中身をまるごと使う
  if (back || extra) addSheet.value = { ...(back || {}), ...(extra || {}) }
}
const okMsg = ref('')
let _okT = null
function say(m) { okMsg.value = m; clearTimeout(_okT); _okT = setTimeout(() => { okMsg.value = '' }, 2600) }
onUnmounted(() => clearTimeout(_okT))
function onAdded({ name, edited }) { say(edited ? `「${name}」を直しました` : `「${name}」を足しました`) }

// ── 予定ボード（予約台帳の形・2026-11-05）──
// 空いているマス → その時間・その人で「やること」を足す
function addAt({ row, start }) {
  if (!canCreate.value || (date.value || today) < today) return   // 過ぎた日には足さない（User決定 2026-11-07）
  addSheet.value = { startKind: 'task', date: date.value || today, time: start, who: row === 'all' ? 'all' : `p:${row}` }
}
const _assignOfRow = row => (row === 'all'
  ? { mode: people.value.some(p => !p.owner) ? 'all' : 'anyone' }
  : { mode: 'person', id: row, name: people.value.find(p => p.id === row)?.name || '' })
const _rowOfTask = t => (t.assign === 'person' && people.value.some(p => p.id === t.assigneeId) ? t.assigneeId : 'all')
// 掴んでずらした（時間・終わり・担当）
function moveTask(t, { start, end, row }) {
  if (!canEditTask(t)) return
  editTask(t.id, { dueTime: start, endTime: end })
  if (row !== _rowOfTask(t)) setTaskAssign(t.id, _assignOfRow(row))
  const who = row === 'all' ? '全員' : (people.value.find(p => p.id === row)?.name || '')
  say(`「${t.text}」を ${start.replace(/^0/, '')}${end ? `〜${end.replace(/^0/, '')}` : ''}${row !== _rowOfTask(t) ? `・${who}` : ''} にしました`)
}
// いつかの箱から、押したマスへ（その日・その時間から30分・その人）
function placeSomeday(x, { row, start }) {
  const t = x.ref?.task
  if (!t || !canEditTask(t)) { err.value = 'このやることを動かせるのは、作った人と管理者だけです'; return }
  const [h, m] = start.split(':').map(Number)
  const e = h * 60 + m + 30
  const end = e < 24 * 60 ? `${String(Math.floor(e / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}` : null
  editTask(t.id, { date: date.value || today, dueTime: start, endTime: end })
  setTaskAssign(t.id, _assignOfRow(row))
  say(`「${t.text}」を ${start.replace(/^0/, '')} に入れました`)
}

// ── 別の日にコピー・★ お気に入りに入れる（やること・チェック表）──
const copyOf = ref(null)     // { kind: 'task'|'checklist', src, title, sub, source, who, slot? }
const _whoOfTask = t => (t.assign === 'person' && t.assigneeId ? `p:${t.assigneeId}` : 'all')
const _whoOfCl = cl => (cl.assign === 'person' && cl.assigneeId ? `p:${cl.assigneeId}` : 'all')
const _personName = id => people.value.find(p => p.id === id)?.name || ''
function copyTask(t) {
  picked.value = null
  copyOf.value = { kind: 'task', src: t, title: t.text, sub: [t.dueTime, t.assign === 'person' ? t.assigneeName : ''].filter(Boolean).join(' ・ '), source: t.date, who: _whoOfTask(t) }
}
function copyChecklist(cl, d, slot) {
  clRun.value = null
  copyOf.value = { kind: 'checklist', src: cl, slot, title: cl.name, sub: [cl.items?.length ? `${cl.items.length}項目` : '', slot, cl.assign === 'person' ? cl.assigneeName : ''].filter(Boolean).join(' ・ '), source: d, who: _whoOfCl(cl) }
}
async function doCopy({ dates, who }) {
  const c = copyOf.value
  copyOf.value = null
  if (!c) return
  const pid = who.startsWith('p:') ? who.slice(2) : null
  try {
    if (c.kind === 'task') {
      const t = c.src
      const assign = pid ? { mode: 'person', id: pid, name: _personName(pid) || t.assigneeName || '' } : { mode: people.value.some(p => !p.owner) ? 'all' : 'anyone' }
      for (const d of dates) addTask(d, t.text, assign, t.dueTime || null, { visibility: t.visibility || null, note: t.note || '' })
    } else {
      const cl = c.src
      for (const d of dates) {
        await saveChecklist({
          name: cl.name, items: (cl.items ?? []).map(x => ({ id: newItemId(), text: x.text })), repeat: 'none', repeatDays: null, startDate: d,
          dueTimes: c.slot ? [c.slot] : (cl.repeat === 'none' ? (cl.dueTimes ?? []) : []),
          assign: pid ? 'person' : 'anyone', assigneeId: pid, assigneeName: pid ? (_personName(pid) || cl.assigneeName || '') : null,
        })
      }
    }
    say(`${dates.length}日にコピーしました`)
  } catch (e) { err.value = e?.message || 'コピーできませんでした' }
}
async function favTask(t) {
  const kind = t.progress ? 'progress' : t.date === '' ? 'someday' : 'task'
  const assign = t.assign === 'person' ? { mode: 'person', id: t.assigneeId, name: t.assigneeName || '' } : { mode: 'all' }
  try { await addTemplate(kind, t.text, { dueTime: t.dueTime || undefined, note: t.note || undefined, assign }); say(`「${t.text}」をお気に入りに入れました`) }
  catch (e) { err.value = e?.message || 'お気に入りに入れられませんでした' }
}
async function favChecklist(cl) {
  const assign = cl.assign === 'person' ? { mode: 'person', id: cl.assigneeId, name: cl.assigneeName || '' } : { mode: 'all' }
  try {
    await addTemplate(cl.items?.length ? 'checklist' : 'routine', cl.name, { items: cl.items ?? [], repeat: cl.repeat, repeatDays: cl.repeatDays ?? null, dueTimes: cl.dueTimes ?? [], assign })
    say(`「${cl.name}」をお気に入りに入れました`)
  } catch (e) { err.value = e?.message || 'お気に入りに入れられませんでした' }
}
</script>

<template>
  <div class="jp">
    <JournalMonth :today="today" :focus="date" :selected="open ? date : ''" :info="dayInfo" :spans="progSpans" @pick="pick" @span="openSpan" />
    <!-- カレンダーからも＋で追加（日付は追加の画面で選ぶ。既定は今日・User 2026-11-08） -->
    <button v-if="canCreate && !open" type="button" class="app-fab jp-fab" aria-label="業務を追加" @click="addSheet = { date: today }"><LineIcon name="plus" size="28" stroke="2.4" /></button>
    <DayTimeline
      v-if="open && date" :key="date" :date="date" :today="today" :origin="origin" :timeline="timeline" :can-add="canCreate && date >= today" :initial-view="viewOnce"
      @close="closeDay" @step="stepDay" @add="openAdd()" @check="check" @open="openItem" @memo="openMemo"
      @add-at="addAt" @move="moveTask" @place="placeSomeday"
    />
    <p v-if="err" class="jp-err jp-toast" role="alert">{{ err }}</p>
    <Teleport to="body">
      <div v-if="picked" class="jp-sheet-bg" @click.self="picked = null">
        <div class="jp-sheet" role="dialog" aria-label="やること">
          <TaskRow :task="picked" :show-date="picked.date < (date || today)" />
          <TaskSteps v-if="!picked.kind && (picked.steps?.length || canProgress(picked))" :task="picked" />
          <button v-if="!picked.date && !picked.progress && !picked.doneAt && canProgress(picked)" type="button" class="jp-start" @click="startPicked">始める</button>
          <template v-if="canNoteTask(picked) && !canEditTask(picked)">
            <label>備考<textarea v-model="pNote" rows="2" :maxlength="TASK_NOTE_MAX" class="jp-in jp-memo" placeholder="細かいこと・手順・連絡先など"></textarea></label>
            <div class="jp-row end"><button type="button" class="jp-mini" @click="picked = null">閉じる</button><button type="button" class="jp-save" @click="savePickedNote">保存</button></div>
          </template>
          <button v-else type="button" class="jp-mini" @click="picked = null">閉じる</button>
          <div v-if="canCreate && !picked.kind" class="jp-more">
            <button v-if="picked.date && !picked.progress" type="button" @click="copyTask(picked)"><LineIcon name="file" /> 別の日にコピー</button>
            <button v-if="canAddTemplate" type="button" @click="favTask(picked); picked = null"><LineIcon name="star" /> お気に入りに入れる</button>
          </div>
          <button v-if="canRemoveTask(picked)" type="button" class="jp-del" @click="deletePicked">このやることを消す</button>
        </div>
      </div>
      <div v-if="memoOpen" class="jp-sheet-bg" @click.self="memoOpen = false">
        <form class="jp-sheet" role="dialog" aria-label="メモ" @submit.prevent="saveMemo">
          <b class="jp-sheet-t">メモ</b>
          <textarea v-model="memoText" rows="3" class="jp-in jp-memo" aria-label="メモ" placeholder="貸切・近隣イベント・メニュー変更 など"></textarea>
          <label class="jp-chk jp-excl"><input v-model="memoExcluded" type="checkbox" /> 発注の見込みから外す（いつもと違う日）</label>
          <div class="jp-row end"><button type="button" class="jp-mini" @click="memoOpen = false">やめる</button><button type="submit" class="jp-save">保存</button></div>
        </form>
      </div>
    </Teleport>
    <ChecklistsPage v-if="clPage" :key="clPage.historyOf?.id || 'list'" :history-of="clPage.historyOf" @close="clPage = null" @edit="cl => addSheet = { editOf: cl }" @open-run="x => clRun = x" @add="clPage = null; addSheet = { startKind: '' }" />
    <ProgressSheet v-if="progOpen" :task="progOpen" @close="progOpen = null" />
    <RoutineRecords v-if="recOpen" :focus="recOpen.focus" @close="recOpen = null" @open-run="x => clRun = x" />
    <ChecklistRunSheet
      v-if="clRun" :cl="clRun.cl" :date="clRun.date" :slot="clRun.slot || ''" :can-copy="canCreate"
      @close="clRun = null" @history="openClHistory" @edit="cl => { clRun = null; addSheet = { editOf: cl } }" @copy="copyChecklist(clRun.cl, clRun.date, clRun.slot || '')" @fav="favChecklist(clRun.cl)"
    />
    <TaskAddSheet
      v-if="addSheet" :date="addSheet.date || date || today" :start-kind="addSheet.startKind || ''" :template="addSheet.template || null"
      :checklist="addSheet.checklist || null" :draft="addSheet.draft || null" :edit-of="addSheet.editOf || null" :preset-time="addSheet.time || ''" :preset-who="addSheet.who || ''"
      @close="addSheet = null" @added="onAdded" @templates="toTemplates"
    />
    <ChecklistTemplatesPage v-if="ctOpen" @close="fromTemplates()" @use-checklist="t => fromTemplates({ checklist: t })" @use-template="t => fromTemplates({ template: t })" />
    <CopyDatesSheet
      v-if="copyOf" :title="copyOf.title" :sub="copyOf.sub" :source="copyOf.source" :who="copyOf.who"
      @close="copyOf = null" @copy="doCopy"
    />
    <Teleport to="body">
      <Transition name="toast"><div v-if="okMsg" class="toast" data-type="success" role="status">{{ okMsg }}</div></Transition>
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
/* 月の下の凡例は＋の分だけ左へ寄せる（重ならないように） */
.jp :deep(.jm-leg) { padding-right: 76px; justify-content: flex-start; padding-left: 12px; }
.jp { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 480px; overflow: hidden; background: var(--surface); }
.jp-toast { position: absolute; left: 12px; right: 12px; bottom: 12px; z-index: 9; background: #fef2f2; border-radius: 10px; padding: 8px 10px; }
.jp-memo { min-height: 84px; padding: 8px 10px; resize: none; }
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
.jp-sheet-bg { position: fixed; inset: 0; z-index: 120; background: rgba(6,34,43,.4); display: flex; align-items: flex-end; justify-content: center; }
.jp-sheet { width: 100%; max-width: 600px; background: var(--surface); border-radius: 20px 20px 0 0; padding: 18px 16px calc(18px + env(safe-area-inset-bottom)); display: grid; gap: 10px; }
.jp-sheet-t { font-size: 16px; }
.jp-sheet label { display: grid; gap: 3px; font-size: 11.5px; font-weight: 800; color: var(--text-muted); }
.jp-in { width: 100%; min-height: 42px; border: 1px solid var(--border); border-radius: 10px; padding: 0 10px; font: inherit; font-size: 15px; background: var(--surface); color: var(--text); box-sizing: border-box; }
.jp-del { min-height: 44px; border: none; background: none; color: #b91c1c; font: inherit; font-size: 14px; font-weight: 800; cursor: pointer; }
.jp-start { min-height: 50px; border: none; border-radius: 14px; background: linear-gradient(135deg, #ca8a04, #a16207); color: #fff; font: inherit; font-size: 15px; font-weight: 900; cursor: pointer; }
.jp-more { display: flex; flex-wrap: wrap; gap: 6px; border-top: 1px solid var(--border); padding-top: 10px; }
.jp-more button { min-height: 40px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text); font: inherit; font-size: 13px; font-weight: 800; padding: 0 12px; cursor: pointer; }
.jp-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.jp-row.end { display: flex; justify-content: flex-end; }
.jp-mini { min-height: 42px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text); font-weight: 700; padding: 0 14px; cursor: pointer; }
.jp-save { min-height: 42px; border: none; border-radius: 10px; background: var(--grad-btn); color: #08323c; font-weight: 800; padding: 0 22px; cursor: pointer; }
.jp-save:disabled { opacity: .5; }
</style>
