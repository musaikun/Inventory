<script setup>
/**
 * カレンダーの日の詳細の「予定」と「やること」（User決定 2026-10-04）。
 * - 予定（自動）: 発注日・締切の設定から、その曜日の発注を並べる
 * - やること: 店で共有するTODO（composables/useTasks）。1件の行は TaskRow（チェック・直す・消す）
 * - 担当（段 2-4）: 誰でも／全員（一人ひとりが印・全員そろって完了）／特定の人／未定
 * - 時刻（TODO 本格化 A）: 時刻の順に並ぶ。今日を開いたときは、過ぎた日の終わっていないものを「期限切れ」として上に出す
 */
import { ref, computed, onMounted } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { isOrderDay, scheduleName } from '../services/orderScheduleUtil.js'
import { tasksOn, overdueTasks, addTask, TASK_TEXT_MAX } from '../composables/useTasks.js'
import { can, staffNames, loadStaffNames } from '../composables/useAuth.js'
import { localDateKey } from '../utils/localDate.js'
import TaskRow from './TaskRow.vue'

const canCreate = () => can('task.create')

const props = defineProps({ date: { type: String, required: true } })   // YYYY-MM-DD
const { config } = useConfig()

const plans = computed(() => {
  const d = new Date(props.date + 'T00:00:00')
  return (config.orderSchedules || [])
    .map((s, i) => (isOrderDay(s, d) ? { id: s.id ?? i, name: scheduleName(s, i), deadline: s.deadline || '' } : null))
    .filter(Boolean)
})
const list = computed(() => tasksOn(props.date))
const isToday = computed(() => props.date === localDateKey())
const late = computed(() => (isToday.value ? overdueTasks(props.date) : []))
const draft = ref('')
const draftTime = ref('')

// 担当の選択肢。値は 'anyone' / 'all' / 'none' / 'p:<id>'
onMounted(() => { loadStaffNames() })
const assignSel = ref('anyone')
const _toAssign = v => {
  if (v.startsWith('p:')) {
    const id = v.slice(2)
    return { mode: 'person', id, name: staffNames.value.find(x => x.id === id)?.name || '' }
  }
  return { mode: v }
}
function onAdd() {
  if (addTask(props.date, draft.value, _toAssign(assignSel.value), draftTime.value || null)) { draft.value = ''; draftTime.value = '' }
}
// 担当の人が選べないとき（スタッフがいない店）は、全員・特定の人を出さない
const hasStaff = computed(() => staffNames.value.length > 0)
const people = computed(() => staffNames.value)
</script>

<template>
  <div class="dt">
    <template v-if="plans.length">
      <div class="dt-sec">予定</div>
      <div v-for="p in plans" :key="p.id" class="dt-row">
        <span class="dt-tm">{{ p.deadline || '終日' }}</span>
        <span class="dt-tx">発注の締切<small>{{ p.name }}</small></span>
        <span class="dt-auto">自動</span>
      </div>
    </template>

    <template v-if="late.length">
      <div class="dt-sec late">期限切れ（{{ late.length }}）</div>
      <TaskRow v-for="t in late" :key="t.id" :task="t" show-date />
    </template>

    <div class="dt-sec">やること</div>
    <div v-if="!list.length" class="dt-empty">この日のやることはありません</div>
    <TaskRow v-for="t in list" :key="t.id" :task="t" />
    <form v-if="canCreate()" class="dt-add" @submit.prevent="onAdd">
      <div class="dt-add-row">
        <input v-model="draft" type="text" :maxlength="TASK_TEXT_MAX" placeholder="やることを追加" aria-label="やることを追加" autocomplete="off" />
        <button type="submit" :disabled="!draft.trim()">追加</button>
      </div>
      <div class="dt-add-row opts">
        <input v-model="draftTime" type="time" class="dt-time" aria-label="時刻（なくてもよい）" />
        <select v-if="hasStaff" v-model="assignSel" class="dt-who" aria-label="担当">
          <option value="anyone">誰でも</option>
          <option value="all">全員</option>
          <option value="none">未定</option>
          <option v-for="p in people" :key="p.id" :value="`p:${p.id}`">{{ p.name }}</option>
        </select>
      </div>
    </form>
  </div>
</template>

<style scoped>
.dt { display: grid; gap: 2px; margin-bottom: 8px; }
.dt-sec { font-size: 11px; font-weight: 800; color: var(--text-muted); letter-spacing: .06em; padding: 8px 2px 2px; }
.dt-row { display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-radius: 10px; font-size: 14px; color: var(--text); }
.dt-row + .dt-row { border-top: 1px solid var(--border); border-radius: 0; }
.dt-row.fresh { background: #fff7ed; }
.dt-tm { flex: none; width: 44px; font-size: 12px; font-weight: 800; color: var(--text-muted); }
.dt-tx { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.dt-tx small { display: block; font-size: 11px; color: var(--text-muted); margin-top: 1px; }
.dt-row.done .dt-tx { color: var(--text-muted); text-decoration: line-through; }
.dt-row.done .dt-tx small { text-decoration: none; }
.dt-auto { flex: none; font-size: 10.5px; font-weight: 800; border-radius: 999px; padding: 2px 8px; background: #fff7ed; color: #c2410c; }
.dt-chk {
  flex: none; width: 28px; height: 28px; border-radius: 8px; border: 2px solid var(--primary); background: var(--surface);
  color: var(--on-grad); font-size: 14px; font-weight: 900; cursor: pointer; padding: 0; display: grid; place-items: center;
}
.dt-chk.on { background: var(--grad-btn); border-color: transparent; }
.dt-del { flex: none; width: 32px; height: 32px; border: none; background: none; color: var(--text-muted); opacity: .6; cursor: pointer; border-radius: 8px; }
.dt-del:hover, .dt-del:focus-visible { opacity: 1; }
.dt-row.mine { background: var(--primary-weak, #ecfeff); }
.dt-tx small.dt-assign { font-weight: 800; color: var(--primary, #0e7490); }
.dt-tx small.dt-assign.none { color: #b45309; }
.dt-who { flex: none; max-width: 92px; min-height: 32px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); font-size: 12px; padding: 0 4px; }
.dt-add .dt-who { min-height: 36px; max-width: 140px; }
.dt-empty { font-size: 12.5px; color: var(--text-muted); padding: 6px; }
.dt-add { display: grid; gap: 6px; padding-top: 6px; }
.dt-add-row { display: flex; gap: 8px; }
.dt-add-row.opts { justify-content: flex-start; }
.dt-time { flex: none; min-height: 36px; border: 1px solid var(--border); border-radius: 8px; padding: 0 6px; font: inherit; font-size: 13px; background: var(--surface); color: var(--text); }
.dt-sec.late { color: #b91c1c; }
.dt-add input { flex: 1; min-width: 0; border: 1px solid var(--border); border-radius: 10px; padding: 10px; font: inherit; font-size: 14px; background: var(--surface); color: var(--text); }
.dt-add button { flex: none; min-height: 42px; border: none; border-radius: 10px; padding: 0 16px; background: var(--btn-bg); color: var(--btn-fg); font-weight: 800; cursor: pointer; }
.dt-add button:disabled { opacity: .5; cursor: default; }
</style>
