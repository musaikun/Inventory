<script setup>
/**
 * やること1件の行（カレンダーの日の詳細・今日の画面で共通。TODO 本格化 A）。
 * - チェックで完了（「全員」は自分の印）、✕ で消す
 * - 作る権限のある人は、文面を押すと直せる（文面・日付・時刻・担当）。日付を変えると別の日へ移る
 * - showDate: 期限切れの一覧では時刻の代わりに日付を赤で出す
 */
import { ref, computed } from 'vue'
import {
  toggleTask, removeTask, editTask, setTaskAssign, isMyTask, isNewTask, isMarkedByMe, isAssignedToMe, TASK_TEXT_MAX,
} from '../composables/useTasks.js'
import { can, staffNames } from '../composables/useAuth.js'

const props = defineProps({
  task: { type: Object, required: true },
  showDate: { type: Boolean, default: false },
})
const t = computed(() => props.task)

// 作る・直す・消すは役割で（段 2-3）。完了の印は誰でも。自分が作ったものは消せる
const canEdit = computed(() => can('task.create'))
const canRemove = computed(() => can('task.deleteOthers') || (isMyTask(t.value) && can('task.create')))
const people = computed(() => staffNames.value)
const hasStaff = computed(() => people.value.length > 0)

// 「全員」は自分の印。全員そろって完了したものは、自分が付けていなくても済みに見せる
const checked = computed(() => (t.value.assign === 'all' ? isMarkedByMe(t.value) || !!t.value.doneAt : !!t.value.doneAt))
const md = d => { const [, m, dd] = d.split('-').map(Number); return `${m}/${dd}` }

/** 担当の一言（行の下に出す） */
const assignNote = computed(() => {
  const x = t.value
  if (x.assign === 'none') return '担当未定'
  if (x.assign === 'person') return isAssignedToMe(x) ? 'あなたの担当' : `担当 ${x.assigneeName || '（名前なし）'}`
  if (x.assign === 'all') {
    const need = Math.max(people.value.length, 1)
    const names = (x.doneList || []).map(y => y.name).filter(Boolean)
    return `全員 ${Math.min(names.length, need)}/${need}${names.length ? `（${names.join('・')}）` : ''}`
  }
  return ''
})

// ── 直す ──
const editing = ref(false)
const fText = ref(''), fDate = ref(''), fTime = ref(''), fWho = ref('anyone')
const _fromTask = x => (x.assign === 'person' ? `p:${x.assigneeId}` : (x.assign || 'anyone'))
function openEdit() {
  if (!canEdit.value) return
  fText.value = t.value.text; fDate.value = t.value.date; fTime.value = t.value.dueTime || ''; fWho.value = _fromTask(t.value)
  editing.value = true
}
function save() {
  if (!fText.value.trim() || !fDate.value) return
  editTask(t.value.id, { text: fText.value, date: fDate.value, dueTime: fTime.value || null })
  if (fWho.value !== _fromTask(t.value)) {
    const v = fWho.value
    const assign = v.startsWith('p:')
      ? { mode: 'person', id: v.slice(2), name: people.value.find(p => p.id === v.slice(2))?.name || t.value.assigneeName || '' }
      : { mode: v }
    setTaskAssign(t.value.id, assign)
  }
  editing.value = false
}
</script>

<template>
  <div v-if="!editing" :class="['tr', { done: t.doneAt, fresh: isNewTask(t), mine: isAssignedToMe(t) && !t.doneAt }]">
    <button
      type="button" :class="['tr-chk', { on: checked }]" :aria-pressed="checked ? 'true' : 'false'"
      :aria-label="`${t.text}を${checked ? '未完了に戻す' : '完了にする'}`" @click="toggleTask(t.id)"
    >{{ checked ? '✓' : '' }}</button>
    <span v-if="showDate" class="tr-tm late">{{ md(t.date) }}</span>
    <span v-else class="tr-tm">{{ t.dueTime || '' }}</span>
    <component
      :is="canEdit ? 'button' : 'span'" :type="canEdit ? 'button' : undefined" class="tr-tx"
      :aria-label="canEdit ? `${t.text}を直す` : undefined" @click="openEdit"
    >{{ t.text }}<template v-if="showDate && t.dueTime"> <span class="tr-sub-tm">{{ t.dueTime }}</span></template>
      <small v-if="assignNote" :class="['tr-assign', t.assign, { me: isAssignedToMe(t) }]">{{ assignNote }}</small>
      <small v-if="!isMyTask(t) || (t.doneAt && t.assign !== 'all')">
        <template v-if="!isMyTask(t)">{{ t.createdBy || 'だれか' }}さんが追加<template v-if="isNewTask(t)"> ・ 新着</template></template>
        <template v-if="t.doneAt && t.assign !== 'all'"><template v-if="!isMyTask(t)"> ・ </template>{{ t.doneBy ? `${t.doneBy}さんが完了` : '完了' }}</template>
      </small>
    </component>
    <button v-if="canRemove" type="button" class="tr-del" :aria-label="`${t.text}を消す`" title="消す" @click="removeTask(t.id)">✕</button>
  </div>

  <form v-else class="tr-edit" @submit.prevent="save">
    <input v-model="fText" type="text" :maxlength="TASK_TEXT_MAX" aria-label="やること" class="tr-in wide" />
    <div class="tr-edit-row">
      <label class="tr-lb">日付<input v-model="fDate" type="date" class="tr-in" /></label>
      <label class="tr-lb">時刻<input v-model="fTime" type="time" class="tr-in" /></label>
      <button v-if="fTime" type="button" class="tr-mini" @click="fTime = ''">時刻なし</button>
    </div>
    <label v-if="hasStaff" class="tr-lb">担当
      <select v-model="fWho" class="tr-in">
        <option value="anyone">誰でも</option>
        <option value="all">全員</option>
        <option value="none">未定</option>
        <option v-for="p in people" :key="p.id" :value="`p:${p.id}`">{{ p.name }}</option>
        <option v-if="t.assign === 'person' && !people.some(p => p.id === t.assigneeId)" :value="`p:${t.assigneeId}`">{{ t.assigneeName }}</option>
      </select>
    </label>
    <div class="tr-edit-row end">
      <button type="button" class="tr-mini" @click="editing = false">やめる</button>
      <button type="submit" class="tr-save" :disabled="!fText.trim() || !fDate">保存</button>
    </div>
  </form>
</template>

<style scoped>
.tr { display: flex; align-items: center; gap: 10px; padding: 8px 6px; font-size: 14px; color: var(--text); border-top: 1px solid var(--border); }
.tr.fresh { background: #fff7ed; }
.tr.mine { background: var(--primary-weak, #ecfeff); }
.tr-chk {
  flex: none; width: 28px; height: 28px; border-radius: 8px; border: 2px solid var(--primary); background: var(--surface);
  color: var(--on-grad); font-size: 14px; font-weight: 900; cursor: pointer; padding: 0; display: grid; place-items: center;
}
.tr-chk.on { background: var(--grad-btn); border-color: transparent; }
.tr-tm { flex: none; width: 40px; font-size: 12px; font-weight: 800; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.tr-tm.late { color: #b91c1c; }
.tr-tx { flex: 1; min-width: 0; overflow-wrap: anywhere; text-align: left; border: none; background: none; padding: 0; font: inherit; color: inherit; cursor: default; }
button.tr-tx { cursor: pointer; }
.tr-tx small { display: block; font-size: 11px; color: var(--text-muted); margin-top: 1px; }
.tr-sub-tm { margin-left: 6px; font-size: 11px; font-weight: 800; color: var(--text-muted); }
.tr.done .tr-tx { color: var(--text-muted); text-decoration: line-through; }
.tr.done .tr-tx small { text-decoration: none; }
small.tr-assign { font-weight: 800; color: var(--primary, #0e7490); }
small.tr-assign.none { color: #b45309; }
.tr-del { flex: none; width: 32px; height: 32px; border: none; background: none; color: var(--text-muted); opacity: .6; cursor: pointer; border-radius: 8px; }
.tr-del:hover, .tr-del:focus-visible { opacity: 1; }
.tr-edit { display: grid; gap: 8px; padding: 10px 6px; border-top: 1px solid var(--border); background: var(--surface-2, #f6fafb); border-radius: 10px; }
.tr-edit-row { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; }
.tr-edit-row.end { justify-content: flex-end; }
.tr-lb { display: grid; gap: 2px; font-size: 11px; font-weight: 800; color: var(--text-muted); }
.tr-in { min-height: 38px; border: 1px solid var(--border); border-radius: 8px; padding: 0 8px; font: inherit; font-size: 14px; background: var(--surface); color: var(--text); }
.tr-in.wide { width: 100%; }
.tr-mini { min-height: 36px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); font-size: 12.5px; font-weight: 700; padding: 0 10px; cursor: pointer; }
.tr-save { min-height: 36px; border: none; border-radius: 8px; background: var(--grad-btn); color: var(--on-grad); font-weight: 800; padding: 0 16px; cursor: pointer; }
.tr-save:disabled { opacity: .5; }
</style>
