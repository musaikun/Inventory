<script setup>
/**
 * ルーティンの1回分を✓する画面（全画面・User決定 2026-10-19・モック docs/mocks/journal-checklist-v2.html ③）。
 * - 上から順に✓。次に押す項目を枠で示し、下に「あと N つで済みます」。全部そろうと「済みました」
 * - 誰がいつ付けたかを項目ごとに出す（時刻はサーバーが刻む）
 * - 「今日はなし」: 理由は任意（その場の小窓）。済みに数える
 * - 外せるのは付けた人がその日のうち（管理者はいつでも）。先の日は見るだけ
 */
import { ref, computed, onUnmounted } from 'vue'
import { runOf, markChecklistItem, canMarkChecklist, canUnmark, CL_ITEM_MAX } from '../composables/useChecklists.js'
import { localDateKey } from '../utils/localDate.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

const props = defineProps({
  cl:   { type: Object, required: true },
  date: { type: String, required: true },
  slot: { type: String, default: '' },
})
const emit = defineEmits(['close', 'history'])

const run = computed(() => runOf(props.cl, props.date, props.slot))
const items = computed(() => run.value?.items ?? props.cl.items ?? [])
const marks = computed(() => run.value?.marks ?? {})
const filled = computed(() => items.value.filter(it => marks.value[it.id]).length)
const left = computed(() => items.value.length - filled.value)
const nextId = computed(() => items.value.find(it => !marks.value[it.id])?.id ?? null)
const future = computed(() => props.date > localDateKey())
const canMark = computed(() => canMarkChecklist(props.cl) && !future.value)
const pct = computed(() => (items.value.length ? Math.round(filled.value / items.value.length * 100) : 0))
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
  try { await markChecklistItem(props.cl, props.date, props.slot, itemId, state, why) } catch (e) { err.value = e?.message || '保存できませんでした。電波の届くところでもう一度押してください' }
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
    <div class="cr" role="dialog" :aria-label="cl.name">
      <div :class="['cr-top', { ok: !left }]">
        <div class="cr-nav">
          <button type="button" class="cr-back" @click="emit('close')">‹ 戻る</button>
          <span>{{ dateLabel }}{{ slot ? ` ・ ${slot}の回` : '' }} ・ {{ who }}</span>
        </div>
        <b>{{ cl.name }}</b>
        <div class="cr-bar" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100"><i :style="{ width: pct + '%' }"></i></div>
        <small>{{ filled }} / {{ items.length }}{{ left ? ` ・ あと${left}つ` : ' ・ 済み' }}</small>
      </div>
      <p v-if="future" class="cr-note">その日になったら✓を付けられます</p>
      <p v-else-if="!canMark" class="cr-note">✓を付けられるのは、担当の人と管理者だけです</p>
      <ul class="cr-list">
        <li v-for="it in items" :key="it.id" :class="['cr-li', marks[it.id]?.s, { next: canMark && it.id === nextId }]">
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
      <div class="cr-foot">
        <div :class="['cr-msg', { ok: !left }]">{{ left ? `あと${left}つで${cl.name}が済みます` : `✓ ${cl.name}が済みました` }}</div>
        <div class="cr-row">
          <button type="button" class="cr-mini" @click="emit('history', cl)">記録を見る</button>
          <button type="button" class="cr-mini grow" @click="emit('close')">{{ left ? 'あとで続ける' : '閉じる' }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cr { position: fixed; inset: 0; z-index: 125; background: var(--bg); display: flex; flex-direction: column; }
.cr-top { flex: none; background: #4f46e5; color: #fff; padding: calc(12px + env(safe-area-inset-top)) 16px 14px; display: grid; gap: 7px; }
.cr-top.ok { background: #16a34a; }
.cr-nav { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 700; }
.cr-nav span { margin-left: auto; opacity: .9; text-align: right; }
.cr-back { border: none; background: none; color: #fff; font: inherit; font-size: 14px; font-weight: 800; padding: 4px 0; cursor: pointer; }
.cr-top b { font-size: 21px; }
.cr-top small { font-size: 12.5px; opacity: .92; font-weight: 700; }
.cr-bar { height: 7px; border-radius: 4px; background: rgba(255,255,255,.3); overflow: hidden; }
.cr-bar i { display: block; height: 100%; background: #fff; transition: width .2s; }
.cr-note { margin: 10px 14px 0; font-size: 12.5px; color: var(--text-muted); }
.cr-list { flex: 1; overflow-y: auto; list-style: none; margin: 0; padding: 10px 12px; display: grid; gap: 8px; align-content: start; max-width: 600px; width: 100%; box-sizing: border-box; align-self: center; }
.cr-li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; background: var(--surface); border: 2px solid transparent; border-radius: 14px; padding: 6px 12px; box-shadow: 0 1px 4px rgba(0,0,0,.05); }
.cr-li.next { border-color: #4f46e5; box-shadow: 0 4px 12px rgba(79,70,229,.18); }
.cr-box { flex: 1; min-width: 0; min-height: 52px; display: flex; align-items: center; gap: 12px; border: none; background: none; font: inherit; font-size: 16px; font-weight: 800; color: var(--text); text-align: left; cursor: pointer; padding: 0; }
.cr-box:disabled { cursor: default; }
.cr-ck { flex: none; width: 30px; height: 30px; border-radius: 9px; border: 3px solid #a5b4fc; display: grid; place-items: center; color: #fff; font-size: 17px; font-weight: 900; box-sizing: border-box; }
.cr-li.done .cr-ck { background: #22c55e; border-color: #22c55e; }
.cr-li.done .cr-t { color: #94a3b8; text-decoration: line-through; }
.cr-li.skip .cr-ck { background: #e2e8f0; border-color: #cbd5e1; color: #64748b; }
.cr-li.skip .cr-t { color: #64748b; }
.cr-who { flex: none; max-width: 45%; text-align: right; font-size: 11px; color: var(--text-muted); line-height: 1.35; }
.cr-skip { flex: none; white-space: nowrap; border: 1px solid #cbd5e1; background: var(--surface); border-radius: 9px; padding: 5px 9px; font: inherit; font-size: 11.5px; font-weight: 800; color: #64748b; cursor: pointer; }
.cr-pop { flex-basis: 100%; display: grid; gap: 6px; background: #f8fafc; border: 1px solid var(--border); border-radius: 12px; padding: 10px; margin-bottom: 6px; }
.cr-pop b { font-size: 13px; }
.cr-in { min-height: 40px; border: 1px solid var(--border); border-radius: 10px; padding: 0 10px; font: inherit; font-size: 14px; background: var(--surface); color: var(--text); }
.cr-foot { flex: none; padding: 8px 12px calc(12px + env(safe-area-inset-bottom)); display: grid; gap: 8px; max-width: 600px; width: 100%; box-sizing: border-box; align-self: center; }
.cr-msg { background: #eef2ff; color: #3730a3; border-radius: 12px; padding: 11px; text-align: center; font-weight: 900; font-size: 14px; }
.cr-msg.ok { background: #dcfce7; color: #166534; }
.cr-row { display: flex; gap: 8px; justify-content: flex-end; }
.cr-mini { min-height: 44px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text); font: inherit; font-weight: 700; padding: 0 14px; cursor: pointer; }
.cr-mini.grow { flex: 1; }
.cr-go { min-height: 42px; border: none; border-radius: 10px; background: #475569; color: #fff; font: inherit; font-weight: 800; padding: 0 14px; cursor: pointer; }
.cr-err { margin: 0 14px; font-size: 12.5px; color: #b91c1c; font-weight: 700; }
</style>
