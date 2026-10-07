<script setup>
/**
 * やること（TODO 管理）。トップの「今日のやること」から開く（User決定 2026-10-07・モック docs/mocks/home-top.html）。
 * - 今日: 期限切れ（過ぎた日の終わっていないもの）→ 今日（時刻の順）
 * - これから: 明日以降を日ごとに（60日先まで）
 * - 完了: 終わったもの（直近14日）を新しい日から
 * - 「自分の担当」で、自分が担当のものと「全員」のものに絞る
 * - ＋で追加（日付・時刻・担当）。1件の行は TaskRow（チェック・直す・消す）
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'
import TaskRow from './TaskRow.vue'
import { tasksOn, overdueTasks, aliveTasks, addTask, isForMe, pullTasks, TASK_TEXT_MAX } from '../composables/useTasks.js'
import { can, staffNames, loadStaffNames } from '../composables/useAuth.js'
import { localDateKey } from '../utils/localDate.js'

const emit = defineEmits(['close'])
onMounted(() => { pullTasks(); loadStaffNames() })

const today = localDateKey()
const seg = ref('today')          // today | later | done
const mineOnly = ref(false)
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
function dayLabel(d) {
  const dt = new Date(d + 'T00:00:00')
  const tomorrow = localDateKey(new Date(Date.now() + 86400_000))
  const head = d === today ? '今日' : d === tomorrow ? '明日' : ''
  return `${head ? `${head} ・ ` : ''}${dt.getMonth() + 1}月${dt.getDate()}日（${WEEK[dt.getDay()]}）`
}
const _mine = list => (mineOnly.value ? list.filter(isForMe) : list)
const _time = (a, b) => (a.dueTime || '99').localeCompare(b.dueTime || '99') || (a.createdAt || '').localeCompare(b.createdAt || '')

const late = computed(() => _mine(overdueTasks(today)))
const todays = computed(() => _mine(tasksOn(today)))
const todayDone = computed(() => todays.value.filter(t => t.doneAt).length)

function _groupByDate(list, desc = false) {
  const m = new Map()
  for (const t of list) (m.get(t.date) ?? m.set(t.date, []).get(t.date)).push(t)
  return [...m.entries()].sort((a, b) => (desc ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0])))
    .map(([date, items]) => ({ date, items: items.sort(_time) }))
}
const laterGroups = computed(() => {
  const until = localDateKey(new Date(Date.now() + 60 * 86400_000))
  return _groupByDate(_mine(aliveTasks.value.filter(t => t.date > today && t.date <= until)))
})
const doneGroups = computed(() => {
  const since = localDateKey(new Date(Date.now() - 14 * 86400_000))
  return _groupByDate(_mine(aliveTasks.value.filter(t => t.doneAt && t.date >= since)), true)
})
const remaining = computed(() => late.value.length + todays.value.filter(t => !t.doneAt).length)

// ── 追加 ──
const canCreate = computed(() => can('task.create'))
const adding = ref(false)
// 端末の戻るは、追加のシートが出ていればそれから閉じる
onUnmounted(registerInnerLayerCloser(() => { if (!adding.value) return false; adding.value = false; return true }))
const fText = ref(''), fDate = ref(today), fTime = ref(''), fWho = ref('anyone')
const people = computed(() => staffNames.value)
function openAdd() { fText.value = ''; fDate.value = seg.value === 'later' ? localDateKey(new Date(Date.now() + 86400_000)) : today; fTime.value = ''; fWho.value = 'anyone'; adding.value = true }
function submitAdd() {
  const v = fWho.value
  const assign = v.startsWith('p:') ? { mode: 'person', id: v.slice(2), name: people.value.find(p => p.id === v.slice(2))?.name || '' } : { mode: v }
  if (addTask(fDate.value, fText.value, assign, fTime.value || null)) adding.value = false
}
</script>

<template>
  <div class="tp">
    <div class="tp-sticky">
    <header class="tp-hd">
      <button type="button" class="tp-back" @click="emit('close')">‹ ホーム</button>
      <b>やること</b>
      <span class="tp-cnt">残り {{ remaining }}</span>
    </header>
    <div class="tp-seg" role="tablist">
      <button v-for="s in [['today', '今日'], ['later', 'これから'], ['done', '完了']]" :key="s[0]" type="button" role="tab"
        :aria-selected="seg === s[0]" :class="{ on: seg === s[0] }" @click="seg = s[0]">{{ s[1] }}</button>
      <button type="button" :class="['mine', { on: mineOnly }]" :aria-pressed="mineOnly" @click="mineOnly = !mineOnly">自分の担当</button>
    </div>
    </div>

    <div class="tp-list">
      <template v-if="seg === 'today'">
        <template v-if="late.length">
          <div class="tp-lh late"><span>期限切れ</span><span>{{ late.length }}</span></div>
          <div class="tp-box"><TaskRow v-for="t in late" :key="t.id" :task="t" show-date /></div>
        </template>
        <div class="tp-lh"><span>{{ dayLabel(today) }}</span><span>{{ todayDone }}/{{ todays.length }}</span></div>
        <div class="tp-box">
          <TaskRow v-for="t in todays" :key="t.id" :task="t" />
          <p v-if="!todays.length" class="tp-empty">{{ mineOnly ? '今日の自分の担当はありません' : '今日のやることはありません' }}</p>
        </div>
      </template>

      <template v-else-if="seg === 'later'">
        <template v-for="g in laterGroups" :key="g.date">
          <div class="tp-lh"><span>{{ dayLabel(g.date) }}</span><span>{{ g.items.length }}</span></div>
          <div class="tp-box"><TaskRow v-for="t in g.items" :key="t.id" :task="t" /></div>
        </template>
        <p v-if="!laterGroups.length" class="tp-empty solo">これからのやることはありません</p>
      </template>

      <template v-else>
        <template v-for="g in doneGroups" :key="g.date">
          <div class="tp-lh"><span>{{ dayLabel(g.date) }}</span><span>{{ g.items.length }}</span></div>
          <div class="tp-box"><TaskRow v-for="t in g.items" :key="t.id" :task="t" /></div>
        </template>
        <p v-if="!doneGroups.length" class="tp-empty solo">この2週間に終わったものはありません</p>
      </template>
    </div>

    <button v-if="canCreate" type="button" class="tp-fab" aria-label="やることを追加" @click="openAdd">＋</button>

    <Teleport to="body">
      <div v-if="adding" class="tp-sheet-bg" @click.self="adding = false">
        <form class="tp-sheet" role="dialog" aria-label="やることを追加" @submit.prevent="submitAdd">
          <b class="tp-sheet-t">やることを追加</b>
          <input v-model="fText" type="text" :maxlength="TASK_TEXT_MAX" placeholder="例：製氷機のフィルター交換" aria-label="やること" class="tp-in" autofocus />
          <div class="tp-row">
            <label>日付<input v-model="fDate" type="date" class="tp-in" /></label>
            <label>時刻<input v-model="fTime" type="time" class="tp-in" /></label>
          </div>
          <label v-if="people.length">担当
            <select v-model="fWho" class="tp-in">
              <option value="anyone">誰でも</option>
              <option value="all">全員</option>
              <option value="none">未定</option>
              <option v-for="p in people" :key="p.id" :value="`p:${p.id}`">{{ p.name }}</option>
            </select>
          </label>
          <div class="tp-row end">
            <button type="button" class="tp-mini" @click="adding = false">やめる</button>
            <button type="submit" class="tp-save" :disabled="!fText.trim() || !fDate">追加</button>
          </div>
        </form>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.tp { position: relative; display: flex; flex-direction: column; min-height: 100%; background: var(--bg); }
.tp-sticky { position: sticky; top: 0; z-index: 2; }
.tp-hd { flex: none; display: flex; align-items: center; gap: 10px; padding: 14px 16px 10px; background: var(--surface); }
.tp-back { border: none; background: none; color: var(--primary); font-weight: 800; font-size: 14px; cursor: pointer; padding: 6px 0; }
.tp-hd b { font-size: 17px; }
.tp-cnt { margin-left: auto; font-size: 12px; color: var(--text-muted); font-weight: 700; }
.tp-seg { flex: none; display: flex; gap: 6px; padding: 0 14px 10px; background: var(--surface); border-bottom: 1px solid var(--border); }
.tp-seg button { border: none; font: inherit; font-size: 12.5px; font-weight: 800; padding: 7px 12px; border-radius: 999px; background: #f1f7f9; color: var(--text-muted); cursor: pointer; }
.tp-seg button.on { background: var(--primary-deep); color: #fff; }
.tp-seg button.mine { margin-left: auto; background: var(--primary-weak, #ecfeff); color: var(--primary); border: 1px solid #a5f3fc; }
.tp-seg button.mine.on { background: var(--primary); color: #fff; border-color: transparent; }
.tp-list { flex: 1; padding: 6px 12px 96px; }
.tp-lh { font-size: 11px; font-weight: 800; letter-spacing: .06em; color: var(--text-muted); padding: 12px 4px 6px; display: flex; justify-content: space-between; }
.tp-lh.late { color: #b91c1c; }
.tp-box { background: var(--surface); border-radius: 16px; padding: 0 10px; box-shadow: 0 1px 4px rgba(0,0,0,.05); overflow: hidden; }
.tp-box > :first-child { border-top: none; }
.tp-empty { margin: 0; padding: 12px 4px; font-size: 13px; color: var(--text-muted); }
.tp-empty.solo { padding: 28px 4px; text-align: center; }
.tp-fab { position: fixed; right: max(18px, calc(50% - 300px + 18px)); bottom: calc(76px + env(safe-area-inset-bottom)); width: 56px; height: 56px; border-radius: 50%; border: none; background: var(--grad-btn); color: #08323c; font-size: 28px; display: grid; place-items: center; box-shadow: 0 8px 20px rgba(14,116,144,.35); cursor: pointer; z-index: 20; }
.tp-sheet-bg { position: fixed; inset: 0; z-index: 120; background: rgba(6,34,43,.4); display: flex; align-items: flex-end; justify-content: center; }
.tp-sheet { width: 100%; max-width: 600px; background: var(--surface); border-radius: 20px 20px 0 0; padding: 18px 16px calc(18px + env(safe-area-inset-bottom)); display: grid; gap: 10px; }
.tp-sheet-t { font-size: 16px; }
.tp-sheet label { display: grid; gap: 3px; font-size: 11.5px; font-weight: 800; color: var(--text-muted); }
.tp-in { width: 100%; min-height: 42px; border: 1px solid var(--border); border-radius: 10px; padding: 0 10px; font: inherit; font-size: 15px; background: var(--surface); color: var(--text); }
.tp-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.tp-row.end { display: flex; justify-content: flex-end; }
.tp-mini { min-height: 42px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text); font-weight: 700; padding: 0 14px; cursor: pointer; }
.tp-save { min-height: 42px; border: none; border-radius: 10px; background: var(--grad-btn); color: #08323c; font-weight: 800; padding: 0 22px; cursor: pointer; }
.tp-save:disabled { opacity: .5; }
</style>
