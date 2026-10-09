<script>
import { ref, watch } from 'vue'
// 日誌の見え方（リスト／月／1日）。タブ内で覚える。トップの「今日のやること」からはリストで開く
const _VIEW_KEY = 'tanaoro_journal_view'
function _readView() {
  try { const v = sessionStorage.getItem(_VIEW_KEY); return ['list', 'month', 'day'].includes(v) ? v : 'list' } catch (_) { return 'list' }
}
export const journalView = ref(_readView())
watch(journalView, v => { try { sessionStorage.setItem(_VIEW_KEY, v) } catch (_) {} })
</script>

<script setup>
/**
 * 日誌（業務日誌）。やること・予定・記録をひとつに（User決定 2026-10-09・モック docs/mocks/journal.html）。
 * 以前の「カレンダー」タブと「やること」画面をまとめた。
 * - リスト: 「やること」（期限切れ → 今日 → これから）と「記録」（実行した棚卸・発注・入出庫。日ごと・新しい日から）を別の枠に
 * - 月: 今までのカレンダー（日ごとの印・その日の詳細）
 * - 1日: 時間別（JournalDay）
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import TaskRow from './TaskRow.vue'
import RecordRow from './RecordRow.vue'
import JournalDay from './JournalDay.vue'
import HistoryCalendarPage from './HistoryCalendarPage.vue'
import TaskNews from './TaskNews.vue'
import { tasksOn, overdueTasks, aliveTasks, addTask, isForMe, pullTasks, TASK_TEXT_MAX } from '../composables/useTasks.js'
import { can, staffNames, loadStaffNames, getSessions } from '../composables/useAuth.js'
import { useHistory } from '../composables/useHistory.js'
import { useOrders } from '../composables/useOrders.js'
import { useMovements } from '../composables/useMovements.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'
import { stockRecords, mergeOrders, mergeMovements, sortRecords, stockDateKey } from '../services/journalRecords.js'
import { localDateKey } from '../utils/localDate.js'

const emit = defineEmits(['viewSession', 'openUpgrade'])

const today = localDateKey()
const view = journalView
const dayDate = ref(today)

// ── 材料 ──
const sessions = ref([])
onMounted(async () => {
  pullTasks(); loadStaffNames()
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
const listMode = ref('todo')     // todo | records
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
const todays = computed(() => _mine(tasksOn(today)))
const todayDone = computed(() => todays.value.filter(t => t.doneAt).length)
const laterGroups = computed(() => {
  const until = localDateKey(new Date(Date.now() + 60 * 86400_000))
  const m = new Map()
  for (const t of _mine(aliveTasks.value.filter(t => t.date > today && t.date <= until))) (m.get(t.date) ?? m.set(t.date, []).get(t.date)).push(t)
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, items]) => ({ date, items: items.sort(_time) }))
})
const remaining = computed(() => late.value.length + todays.value.filter(t => !t.doneAt).length)
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
const fText = ref(''), fDate = ref(today), fTime = ref(''), fWho = ref('anyone')
const people = computed(() => staffNames.value)
function openAdd() {
  fText.value = ''; fDate.value = view.value === 'day' ? dayDate.value : today; fTime.value = ''; fWho.value = 'anyone'; adding.value = true
}
function submitAdd() {
  const v = fWho.value
  const assign = v.startsWith('p:') ? { mode: 'person', id: v.slice(2), name: people.value.find(p => p.id === v.slice(2))?.name || '' } : { mode: v }
  if (addTask(fDate.value, fText.value, assign, fTime.value || null)) adding.value = false
}
onUnmounted(registerInnerLayerCloser(() => { if (!adding.value) return false; adding.value = false; return true }))
</script>

<template>
  <div class="jp">
    <div class="jp-top">
      <div class="jp-title"><b>業務日誌</b><small>残り {{ remaining }}</small></div>
      <div class="jp-views" role="tablist" aria-label="見え方">
        <button v-for="v in [['list', 'リスト'], ['month', '月'], ['day', '1日']]" :key="v[0]" type="button" role="tab"
          :aria-selected="view === v[0]" :class="{ on: view === v[0] }" @click="view = v[0]">{{ v[1] }}</button>
      </div>
      <div v-if="view === 'list'" class="jp-flt">
        <button type="button" :class="{ on: listMode === 'todo' }" :aria-pressed="listMode === 'todo'" @click="listMode = 'todo'">やること</button>
        <button type="button" :class="{ on: listMode === 'records' }" :aria-pressed="listMode === 'records'" @click="listMode = 'records'">
          記録<template v-if="todayRecordCount"> {{ todayRecordCount }}</template>
        </button>
        <button v-if="listMode === 'todo'" type="button" :class="['mine', { on: mineOnly }]" :aria-pressed="mineOnly" @click="mineOnly = !mineOnly">自分の担当</button>
      </div>
    </div>

    <!-- リスト: やること -->
    <div v-if="view === 'list' && listMode === 'todo'" class="jp-list">
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
    </div>

    <!-- リスト: 記録（別の枠） -->
    <div v-else-if="view === 'list'" class="jp-list">
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
    />

    <!-- 1日（時間別） -->
    <JournalDay v-else v-model:date="dayDate" :records="recordsOn(dayDate)" @view-session="s => emit('viewSession', s)" />

    <button v-if="canCreate && view !== 'month'" type="button" class="jp-fab" aria-label="やることを追加" @click="openAdd">＋</button>

    <Teleport to="body">
      <div v-if="adding" class="jp-sheet-bg" @click.self="adding = false">
        <form class="jp-sheet" role="dialog" aria-label="やることを追加" @submit.prevent="submitAdd">
          <b class="jp-sheet-t">やることを追加</b>
          <input v-model="fText" type="text" :maxlength="TASK_TEXT_MAX" placeholder="例：製氷機のフィルター交換" aria-label="やること" class="jp-in" />
          <div class="jp-row">
            <label>日付<input v-model="fDate" type="date" class="jp-in" /></label>
            <label>時刻<input v-model="fTime" type="time" class="jp-in" /></label>
          </div>
          <label v-if="people.length">担当
            <select v-model="fWho" class="jp-in">
              <option value="anyone">誰でも</option>
              <option value="all">全員</option>
              <option value="none">未定</option>
              <option v-for="p in people" :key="p.id" :value="`p:${p.id}`">{{ p.name }}</option>
            </select>
          </label>
          <div class="jp-row end">
            <button type="button" class="jp-mini" @click="adding = false">やめる</button>
            <button type="submit" class="jp-save" :disabled="!fText.trim() || !fDate">追加</button>
          </div>
        </form>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.jp { position: relative; display: flex; flex-direction: column; min-height: 100%; background: var(--bg); }
.jp-top { position: sticky; top: 0; z-index: 3; background: var(--surface); padding: 12px 14px 10px; border-bottom: 1px solid var(--border); display: grid; gap: 10px; }
.jp-title { display: flex; align-items: baseline; gap: 8px; }
.jp-title b { font-size: 17px; letter-spacing: .04em; }
.jp-title small { margin-left: auto; font-size: 12px; color: var(--text-muted); font-weight: 700; }
.jp-views { display: grid; grid-template-columns: repeat(3, 1fr); background: #e9f2f4; border-radius: 12px; padding: 3px; }
.jp-views button { border: none; background: none; font: inherit; font-size: 12.5px; font-weight: 800; padding: 7px; border-radius: 10px; color: var(--text-muted); cursor: pointer; }
.jp-views button.on { background: var(--surface); color: var(--primary-deep); box-shadow: 0 1px 3px rgba(0,0,0,.1); }
.jp-flt { display: flex; gap: 6px; }
.jp-flt button { border: none; font: inherit; font-size: 12px; font-weight: 800; padding: 6px 11px; border-radius: 999px; background: #f1f7f9; color: var(--text-muted); cursor: pointer; }
.jp-flt button.on { background: var(--primary-deep); color: #fff; }
.jp-flt button.mine { margin-left: auto; background: var(--primary-weak, #ecfeff); color: var(--primary); border: 1px solid #a5f3fc; }
.jp-flt button.mine.on { background: var(--primary); color: #fff; border-color: transparent; }
.jp-list { padding: 4px 12px 96px; }
.jp-lh { font-size: 11px; font-weight: 800; letter-spacing: .06em; color: var(--text-muted); padding: 12px 4px 6px; display: flex; justify-content: space-between; }
.jp-lh.late { color: #b91c1c; }
.jp-box { background: var(--surface); border-radius: 16px; padding: 0 10px; box-shadow: 0 1px 4px rgba(0,0,0,.05); overflow: hidden; }
.jp-box > :first-child { border-top: none; }
.jp-empty { margin: 0; padding: 12px 4px; font-size: 13px; color: var(--text-muted); }
.jp-empty.solo { padding: 28px 8px; text-align: center; line-height: 1.6; }
.jp-month { flex: 1; }
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
