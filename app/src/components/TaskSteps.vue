<script setup>
/**
 * 子タスク（やることの中の項目・User決定 2026-11-07・キャンバス「業務の追加」③）。
 * ✓ を付ける・足す・チェック表（ひな形）からまとめて足す。直せるのは、そのやることを直せる人か済みにできる人
 */
import LineIcon from './LineIcon.vue'
import { ref, computed } from 'vue'
import { updateProgress, canProgress, newStepId } from '../composables/useTasks.js'
import { checklistTemplates } from '../composables/useTemplates.js'

const props = defineProps({ task: { type: Object, required: true } })
const steps = computed(() => props.task.steps ?? [])
const can = computed(() => canProgress(props.task))
const done = computed(() => steps.value.filter(s => s.done).length)
const draft = ref('')
const picking = ref(false)

function _save(list) { updateProgress(props.task.id, { steps: list }) }
function toggle(s) { if (can.value) _save(steps.value.map(x => (x.id === s.id ? { ...x, done: !x.done } : x))) }
function add() {
  const text = draft.value.trim()
  if (!text || !can.value) return
  _save([...steps.value, { id: newStepId(), text, done: false }])
  draft.value = ''
}
function addFrom(t) {
  _save([...steps.value, ...(t.data?.items ?? []).map(x => ({ id: newStepId(), text: x.text, done: false }))])
  picking.value = false
}
</script>

<template>
  <div class="tst">
    <span v-if="steps.length" class="tst-h">子タスク {{ done }} / {{ steps.length }}</span>
    <button v-for="s in steps" :key="s.id" type="button" :class="['tst-s', { ok: s.done }]" :disabled="!can" :aria-pressed="s.done" @click="toggle(s)">
      <i aria-hidden="true">{{ s.done ? '✓' : '' }}</i><span>{{ s.text }}</span>
    </button>
    <form v-if="can" class="tst-add" @submit.prevent="add">
      <input v-model="draft" type="text" maxlength="100" aria-label="子タスク" placeholder="子タスク" />
      <button type="submit" :disabled="!draft.trim()" aria-label="子タスクを足す"><LineIcon name="plus" /></button>
      <button v-if="checklistTemplates.length" type="button" class="tst-from" :aria-expanded="picking" @click="picking = !picking"><LineIcon name="clipboard" /> チェック表から</button>
    </form>
    <div v-if="picking" class="tst-pick">
      <button v-for="t in checklistTemplates" :key="t.id" type="button" @click="addFrom(t)"><b>{{ t.name }}</b><small>{{ t.data.items.length }}項目</small></button>
    </div>
  </div>
</template>

<style scoped>
.tst { display: grid; gap: 6px; }
.tst-h { font-size: 12px; font-weight: 900; color: var(--text-muted); }
.tst-s { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 12px; border: none; border-radius: 12px; background: #f3f8fa; font: inherit; text-align: left; color: var(--text); cursor: pointer; }
.tst-s:disabled { cursor: default; }
.tst-s i { flex: none; width: 22px; height: 22px; border-radius: 7px; display: grid; place-items: center; font-style: normal; font-size: 13px; font-weight: 900; color: #fff; background: #fff; box-shadow: inset 0 0 0 2px #9ccfdb; }
.tst-s.ok i { background: var(--primary, #0e7490); box-shadow: none; }
.tst-s span { flex: 1; font-size: 14px; font-weight: 700; }
.tst-s.ok span { color: #8aa0a8; text-decoration: line-through; }
.tst-add { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.tst-add input { flex: 1; min-width: 120px; min-height: 40px; border: 1.5px solid #d6e6ea; border-radius: 12px; padding: 0 12px; font: inherit; font-size: 14px; background: var(--surface); color: var(--text); }
.tst-add button { min-width: 40px; min-height: 40px; border: none; border-radius: 12px; background: #e6f5f8; color: #0b5f73; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 4px; font: inherit; font-size: 13px; font-weight: 800; }
.tst-add button:disabled { opacity: .4; }
.tst-add .tst-from { padding: 0 12px; }
.tst-pick { display: grid; gap: 4px; }
.tst-pick button { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 12px; border: 1px solid #e3ecef; border-radius: 12px; background: var(--surface, #fff); font: inherit; text-align: left; cursor: pointer; color: var(--text); }
.tst-pick b { flex: 1; font-size: 14px; }
.tst-pick small { font-size: 12px; font-weight: 800; color: var(--text-muted); }
</style>
