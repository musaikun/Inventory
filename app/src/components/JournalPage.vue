<script>
import { ref } from 'vue'
// 日誌で見ている日（外＝ホームや棚卸の詳細からもこの日を指定して開く）。'' は今日
export const journalDate = ref('')
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
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import TaskRow from './TaskRow.vue'
import JournalMonth from './JournalMonth.vue'
import DayTimeline from './DayTimeline.vue'
import ChecklistsPage from './ChecklistsPage.vue'
import ProgressSheet from './ProgressSheet.vue'
import RoutineRecords from './RoutineRecords.vue'
import ChecklistRunSheet from './ChecklistRunSheet.vue'
import { pullChecklists, checklistsForDay, saveChecklist, canEditChecklists, markChecklistItem, canMarkChecklist, canUnmark } from '../composables/useChecklists.js'
import { monthDaysLabel, isSimple, WHOLE } from '../services/checklistSchedule.js'
import { tasksOn, overdueTasks, carriedTasks, somedayTasks, addTask, pullTasks, TASK_TEXT_MAX, dueProgress, toggleTask, canToggleTask } from '../composables/useTasks.js'
import { can, staffNames, loadStaffNames, getSessions, isAdmin } from '../composables/useAuth.js'
import { useHistory } from '../composables/useHistory.js'
import { useOrders } from '../composables/useOrders.js'
import { useMovements } from '../composables/useMovements.js'
import { useConfig } from '../composables/useConfig.js'
import { useDayNotes } from '../composables/useDayNotes.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'
import { stockRecords, mergeOrders, mergeMovements, sortRecords, stockDateKey } from '../services/journalRecords.js'
import { buildDayTimeline } from '../services/dayTimeline.js'
import { isOrderDay, scheduleName } from '../services/orderScheduleUtil.js'
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
const open = ref(!!date.value)
const origin = ref(null)
watch(date, v => { if (v) open.value = true })
function pick(d, o) { origin.value = o; date.value = d; open.value = true }
function closeDay() { open.value = false }
function stepDay(n) {
  const d = new Date((date.value || today) + 'T00:00:00'); d.setDate(d.getDate() + n)
  origin.value = null; date.value = localDateKey(d)
}

// ── 材料 ──
const sessions = ref([])
onMounted(async () => {
  pullTasks(); pullChecklists(); loadStaffNames()
  try { sessions.value = await getSessions() } catch (_) { sessions.value = [] }
})
const { getSnapshotBySessionId } = useHistory()
const { getOrders } = useOrders()
const { getMovements } = useMovements()
const { config } = useConfig()
const { getNote, setNote } = useDayNotes()
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
const _isOrderPlan = d => (config.orderSchedules || []).some(s => isOrderDay(s, new Date(d + 'T12:00:00')))
const _plain = d => tasksOn(d).filter(t => !t.progress)

/** 月のマス: 済み具合の帯と札（棚卸・発注・メモ。先の日は予定を点線） */
function dayInfo(d) {
  const ts = _plain(d)
  const ls = checklistsForDay(d)
  const total = ts.length + ls.length
  const done = ts.filter(t => t.doneAt).length + ls.filter(r => r.complete).length
  const st = !total || d >= today ? (d === today && total && done === total ? 'y' : '') : done === total ? 'y' : done ? 'p' : 'x'
  const fut = d > today
  const tags = []
  if (stockDays.value.has(d) || (d === today && props.activeSession)) tags.push({ label: '棚卸', kind: 'stock' })
  if (orderDays.value.has(d) || (d === today && props.activeOrderSession)) tags.push({ label: '発注', kind: 'order' })
  else if (fut && _isOrderPlan(d)) tags.push({ label: '発注', kind: 'order', future: true })
  const note = getNote(d)?.text
  if (note) tags.push({ label: note.slice(0, 8), kind: 'plan', future: fut })
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
    late: isToday ? overdueTasks(today) : [], carry: isToday ? carriedTasks(today) : [], progress: isToday ? dueProgress(today) : [],
    note: getNote(d)?.text || '', someday: isToday ? somedayTasks.value : [],
    plans: (config.orderSchedules || []).map((s, i) => (isOrderDay(s, new Date(d + 'T12:00:00')) && s.deadline ? { name: scheduleName(s, i), time: s.deadline } : null)).filter(Boolean),
  })
})
const picked = ref(null)     // 直す: やること1件（TaskRow を出す）
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
  fText.value = ''; fDate.value = !date.value || date.value < today ? today : date.value; fTime.value = ''; fWho.value = 'anyone'; fSomeday.value = false
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
    <JournalMonth :today="today" :focus="date" :selected="open ? date : ''" :info="dayInfo" @pick="pick" @settings="clPage = {}" />
    <DayTimeline
      v-if="open && date" :key="date" :date="date" :today="today" :origin="origin" :timeline="timeline" :can-add="canCreate"
      @close="closeDay" @step="stepDay" @add="openAdd()" @check="check" @open="openItem" @memo="openMemo"
    />
    <p v-if="err" class="jp-err jp-toast" role="alert">{{ err }}</p>
    <Teleport to="body">
      <div v-if="picked" class="jp-sheet-bg" @click.self="picked = null">
        <div class="jp-sheet" role="dialog" aria-label="やること">
          <TaskRow :task="picked" :show-date="picked.date < (date || today)" />
          <button type="button" class="jp-mini" @click="picked = null">閉じる</button>
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
