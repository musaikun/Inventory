<script setup>
/**
 * 済みのやること1件の行（日誌のリスト「済み」。モック docs/mocks/task-report.html ①）。
 * - 誰が・いつ完了したか、期限内か何日遅れか。「全員」は何人そろったか
 * - ✓ を外すと未完了に戻る。外せるのは完了した人がその日のうち、それ以降は管理者（User決定 2026-10-14）。
 *   「全員」は自分の印を付けた日のうちだけ
 */
import { computed } from 'vue'
import { toggleTask, doneLateness, canToggleTask, toggleDenyReason, isMarkedByMe } from '../composables/useTasks.js'
import { staffNames } from '../composables/useAuth.js'
import { isMeId } from '../composables/useDeviceId.js'

const props = defineProps({ task: { type: Object, required: true } })
const t = computed(() => props.task)

// 「全員」は自分が印を付けたものだけ（付けていない人が押すと印を足すことになる）
const canUndo = computed(() => (t.value.assign !== 'all' || isMarkedByMe(t.value)) && canToggleTask(t.value))
const hm = iso => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
const md = d => { const [, m, dd] = d.split('-').map(Number); return `${m}/${dd}` }
const lateness = computed(() => doneLateness(t.value))

const note = computed(() => {
  const x = t.value
  if (x.assign === 'all') {
    const names = (x.doneList || []).map(y => y.name).filter(Boolean)
    const need = Math.max(staffNames.value.filter(p => !p.owner).length, names.length, 1)
    return `全員 ${names.length}/${need}人${names.length ? `（${names.join('・')}）` : ''}`
  }
  const who = isMeId(x.doneById) ? 'あなた' : `${x.doneBy || 'だれか'}さん`
  const due = x.dueTime || lateness.value?.late ? ` ・ 期限 ${md(x.date)}${x.dueTime ? ` ${x.dueTime}` : ''}` : ''
  return `${who}が ${hm(x.doneAt)} に完了${due}`
})
const tag = computed(() => {
  const l = lateness.value
  if (!l?.late) return { cls: 'ok', text: '期限内' }
  return { cls: 'late', text: l.days > 0 ? `${l.days}日遅れ` : '時刻より遅れ' }
})
</script>

<template>
  <div class="dt">
    <button
      type="button" class="dt-chk" aria-pressed="true" :disabled="!canUndo"
      :title="toggleDenyReason(t) || undefined"
      :aria-label="canUndo ? `${t.text}を未完了に戻す` : `${t.text}は完了`" @click="toggleTask(t.id)"
    >✓</button>
    <span class="dt-tx"><b>{{ t.text }}</b><small>{{ note }}</small></span>
    <span :class="['dt-tag', tag.cls]">{{ tag.text }}</span>
  </div>
</template>

<style scoped>
.dt { display: flex; align-items: center; gap: 10px; padding: 8px 6px; font-size: 14px; border-top: 1px solid var(--border); }
.dt-chk {
  flex: none; width: 28px; height: 28px; border-radius: 8px; border: none; background: var(--grad-btn);
  color: var(--on-grad); font-size: 14px; font-weight: 900; cursor: pointer; padding: 0; display: grid; place-items: center;
}
.dt-chk:disabled { cursor: default; opacity: .7; }
.dt-tx { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.dt-tx b { display: block; font-weight: 700; color: var(--text-muted); text-decoration: line-through; }
.dt-tx small { display: block; font-size: 11px; color: var(--text-muted); margin-top: 1px; }
.dt-tag { flex: none; font-size: 10.5px; font-weight: 900; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
.dt-tag.ok { background: #dcfce7; color: #047857; }
.dt-tag.late { background: #fee2e2; color: #b91c1c; }
</style>
