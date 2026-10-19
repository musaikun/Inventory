<script setup>
/**
 * チェック表のある日の✓（下のシート・User決定 2026-10-19・モック docs/mocks/journal-checklist.html ④）。
 * - 項目を押すと✓。誰がいつ付けたかを項目ごとに出す（時刻はサーバーが刻む）
 * - 「今日はなし」: 理由は任意（小窓）。済みに数える
 * - 外せるのは付けた人がその日のうち（管理者はいつでも）。先の日は見るだけ
 */
import { ref, computed, onUnmounted } from 'vue'
import { runOf, markChecklistItem, canMarkChecklist, canUnmark, CL_ITEM_MAX } from '../composables/useChecklists.js'
import { localDateKey } from '../utils/localDate.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

const props = defineProps({
  cl:   { type: Object, required: true },
  date: { type: String, required: true },
})
const emit = defineEmits(['close', 'history'])

const run = computed(() => runOf(props.cl, props.date))
const items = computed(() => run.value?.items ?? props.cl.items ?? [])
const marks = computed(() => run.value?.marks ?? {})
const future = computed(() => props.date > localDateKey())
const canMark = computed(() => canMarkChecklist(props.cl) && !future.value)
const pct = computed(() => (run.value?.total ? Math.round(run.value.filled / run.value.total * 100) : 0))
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const dateLabel = computed(() => {
  const d = new Date(props.date + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）${props.date === localDateKey() ? ' 今日' : ''}`
})
const who = computed(() => (props.cl.assign === 'person' ? `担当 ${props.cl.assigneeName || ''}` : '誰でも'))
const hm = iso => { const d = new Date(iso); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` }

const err = ref('')
const skipping = ref('')
const reason = ref('')
async function _do(itemId, state, why = '') {
  err.value = ''
  try { await markChecklistItem(props.cl, props.date, itemId, state, why) } catch (e) { err.value = e?.message || '保存できませんでした。電波の届くところでもう一度押してください' }
}
function toggle(it) {
  if (!canMark.value) return
  const m = marks.value[it.id]
  if (!m) return _do(it.id, 'done')
  if (!canUnmark(m)) { err.value = '外せるのは、付けた人がその日のうちだけです（それ以降は管理者）'; return }
  _do(it.id, null)
}
function openSkip(it) { skipping.value = it.id; reason.value = '' }
function confirmSkip() { const id = skipping.value; skipping.value = ''; _do(id, 'skip', reason.value.trim()) }
onUnmounted(registerInnerLayerCloser(() => {
  if (skipping.value) { skipping.value = ''; return true }
  emit('close'); return true
}))
</script>

<template>
  <Teleport to="body">
    <div class="cr-bg" @click.self="emit('close')">
      <div class="cr" role="dialog" :aria-label="cl.name">
        <div class="cr-h"><b>{{ cl.name }}</b><small>{{ dateLabel }}{{ cl.dueTime ? ` ・ ${cl.dueTime}` : '' }} ・ {{ who }}</small></div>
        <div class="cr-bar" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100"><i :style="{ width: pct + '%' }"></i></div>
        <p v-if="future" class="cr-note">その日になったら✓を付けられます</p>
        <p v-else-if="!canMark" class="cr-note">✓を付けられるのは、担当の人と管理者だけです</p>
        <ul class="cr-list">
          <li v-for="it in items" :key="it.id" :class="['cr-li', marks[it.id]?.s]">
            <button type="button" class="cr-box" :disabled="!canMark" :aria-pressed="!!marks[it.id]" :aria-label="`${it.text}に✓`" @click="toggle(it)">
              <span class="cr-ck" aria-hidden="true">{{ marks[it.id]?.s === 'done' ? '✓' : marks[it.id]?.s === 'skip' ? '－' : '' }}</span>
              <span class="cr-t">{{ it.text }}</span>
            </button>
            <small v-if="marks[it.id]" class="cr-who">
              <template v-if="marks[it.id].s === 'skip'">今日はなし<template v-if="marks[it.id].reason">（{{ marks[it.id].reason }}）</template><br></template>
              {{ marks[it.id].by }} {{ hm(marks[it.id].at) }}
            </small>
            <button v-else-if="canMark" type="button" class="cr-skip" @click="openSkip(it)">今日はなし</button>
            <div v-if="skipping === it.id" class="cr-pop">
              <b>「{{ it.text }}」を今日はなしに</b>
              <input v-model="reason" type="text" :maxlength="CL_ITEM_MAX" class="cr-in" placeholder="理由（なくてもよい）例：漂白剤切れ" aria-label="理由" @keydown.enter.prevent="confirmSkip" />
              <div class="cr-row">
                <button type="button" class="cr-mini" @click="skipping = ''">やめる</button>
                <button type="button" class="cr-go" @click="confirmSkip">今日はなしにする</button>
              </div>
            </div>
          </li>
        </ul>
        <p v-if="err" class="cr-err" role="alert">{{ err }}</p>
        <div class="cr-row">
          <button type="button" class="cr-mini" @click="emit('history', cl)">記録を見る</button>
          <button type="button" class="cr-mini grow" @click="emit('close')">閉じる</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cr-bg { position: fixed; inset: 0; z-index: 125; background: rgba(6,34,43,.4); display: flex; align-items: flex-end; justify-content: center; }
.cr { width: 100%; max-width: 600px; max-height: 88vh; overflow-y: auto; background: var(--surface); border-radius: 20px 20px 0 0; padding: 16px 16px calc(16px + env(safe-area-inset-bottom)); display: grid; gap: 8px; box-sizing: border-box; }
.cr-h { display: grid; gap: 2px; }
.cr-h b { font-size: 17px; }
.cr-h small { font-size: 12px; color: var(--text-muted); font-weight: 700; }
.cr-bar { height: 5px; border-radius: 3px; background: #e0e7ff; overflow: hidden; }
.cr-bar i { display: block; height: 100%; background: #6366f1; transition: width .2s; }
.cr-note { margin: 0; font-size: 12px; color: var(--text-muted); }
.cr-list { list-style: none; margin: 0; padding: 0; }
.cr-li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; border-top: 1px solid #eef4f6; padding: 4px 0; }
.cr-box { flex: 1; min-width: 0; min-height: 46px; display: flex; align-items: center; gap: 10px; border: none; background: none; font: inherit; font-size: 15px; color: var(--text); text-align: left; cursor: pointer; padding: 0; }
.cr-box:disabled { cursor: default; }
.cr-ck { flex: none; width: 24px; height: 24px; border-radius: 7px; border: 2px solid #6366f1; display: grid; place-items: center; color: #fff; font-size: 14px; font-weight: 900; }
.cr-li.done .cr-ck { background: #22c55e; border-color: #22c55e; }
.cr-li.done .cr-t { color: #94a3b8; text-decoration: line-through; }
.cr-li.skip .cr-ck { background: #e2e8f0; border-color: #cbd5e1; color: #64748b; }
.cr-li.skip .cr-t { color: #64748b; }
.cr-who { flex: none; max-width: 45%; text-align: right; font-size: 11px; color: var(--text-muted); line-height: 1.35; }
.cr-skip { flex: none; border: 1px solid #cbd5e1; background: var(--surface); border-radius: 9px; padding: 5px 9px; font: inherit; font-size: 11.5px; font-weight: 800; color: #64748b; cursor: pointer; }
.cr-pop { flex-basis: 100%; display: grid; gap: 6px; background: #f8fafc; border: 1px solid var(--border); border-radius: 12px; padding: 10px; margin-bottom: 6px; }
.cr-pop b { font-size: 13px; }
.cr-in { min-height: 40px; border: 1px solid var(--border); border-radius: 10px; padding: 0 10px; font: inherit; font-size: 14px; background: var(--surface); color: var(--text); }
.cr-row { display: flex; gap: 8px; justify-content: flex-end; }
.cr-mini { min-height: 42px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text); font: inherit; font-weight: 700; padding: 0 14px; cursor: pointer; }
.cr-mini.grow { flex: 1; }
.cr-go { min-height: 42px; border: none; border-radius: 10px; background: #475569; color: #fff; font: inherit; font-weight: 800; padding: 0 14px; cursor: pointer; }
.cr-err { margin: 0; font-size: 12.5px; color: #b91c1c; font-weight: 700; }
</style>
