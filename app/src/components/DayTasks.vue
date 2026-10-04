<script setup>
/**
 * カレンダーの日の詳細の「予定」と「やること」（User決定 2026-10-04）。
 * - 予定（自動）: 発注日・締切の設定から、その曜日の発注を並べる
 * - やること: 店で共有するTODO（composables/useTasks）。チェックで完了、✕ で消す、その場で追加
 *   他の端末が追加したものには追加した人の名前を出し、まだ確認していないものは「新着」の色
 */
import { ref, computed } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { isOrderDay, scheduleName } from '../services/orderScheduleUtil.js'
import { tasksOn, addTask, toggleTask, removeTask, isMyTask, isNewTask, TASK_TEXT_MAX } from '../composables/useTasks.js'

const props = defineProps({ date: { type: String, required: true } })   // YYYY-MM-DD
const { config } = useConfig()

const plans = computed(() => {
  const d = new Date(props.date + 'T00:00:00')
  return (config.orderSchedules || [])
    .map((s, i) => (isOrderDay(s, d) ? { id: s.id ?? i, name: scheduleName(s, i), deadline: s.deadline || '' } : null))
    .filter(Boolean)
})
const list = computed(() => tasksOn(props.date))
const draft = ref('')
function onAdd() {
  if (addTask(props.date, draft.value)) draft.value = ''
}
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

    <div class="dt-sec">やること</div>
    <div v-if="!list.length" class="dt-empty">この日のやることはありません</div>
    <div v-for="t in list" :key="t.id" :class="['dt-row', { done: t.doneAt, fresh: isNewTask(t) }]">
      <button
        type="button" :class="['dt-chk', { on: t.doneAt }]" :aria-pressed="t.doneAt ? 'true' : 'false'"
        :aria-label="`${t.text}を${t.doneAt ? '未完了に戻す' : '完了にする'}`" @click="toggleTask(t.id)"
      >{{ t.doneAt ? '✓' : '' }}</button>
      <span class="dt-tx">{{ t.text }}
        <small v-if="!isMyTask(t) || t.doneAt">
          <template v-if="!isMyTask(t)">{{ t.createdBy || 'だれか' }}さんが追加<template v-if="isNewTask(t)"> ・ 新着</template></template>
          <template v-if="t.doneAt"><template v-if="!isMyTask(t)"> ・ </template>{{ t.doneBy ? `${t.doneBy}さんが完了` : '完了' }}</template>
        </small>
      </span>
      <button type="button" class="dt-del" :aria-label="`${t.text}を消す`" title="消す" @click="removeTask(t.id)">✕</button>
    </div>
    <form class="dt-add" @submit.prevent="onAdd">
      <input v-model="draft" type="text" :maxlength="TASK_TEXT_MAX" placeholder="やることを追加" aria-label="やることを追加" autocomplete="off" />
      <button type="submit" :disabled="!draft.trim()">追加</button>
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
.dt-empty { font-size: 12.5px; color: var(--text-muted); padding: 6px; }
.dt-add { display: flex; gap: 8px; padding-top: 6px; }
.dt-add input { flex: 1; min-width: 0; border: 1px solid var(--border); border-radius: 10px; padding: 10px; font: inherit; font-size: 14px; background: var(--surface); color: var(--text); }
.dt-add button { flex: none; min-height: 42px; border: none; border-radius: 10px; padding: 0 16px; background: var(--btn-bg); color: var(--btn-fg); font-weight: 800; cursor: pointer; }
.dt-add button:disabled { opacity: .5; cursor: default; }
</style>
