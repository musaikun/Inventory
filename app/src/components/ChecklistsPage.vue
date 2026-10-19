<script setup>
/**
 * 毎日のチェックの一覧・作る/直す・記録（全画面・User決定 2026-10-19・モック docs/mocks/journal-checklist-v3.html ⑤）。
 * - 一覧: 店で使っている表。見本（開店・退店）は押すだけで始まる。お休み中は薄く
 * - 作る・直す（管理者だけ）: 上に「毎日 22:00 に、誰でも チェックする」と文で出す。名前・いつ（なし／毎日／曜日／毎月◯日）・
 *   時刻（いくつでも＝1日に何回も。冷蔵庫の温度など）・誰が（誰でも／人）・確かめること（並べ替え・消す）
 *   直した表は、まだ✓を付けていない日から効く（今日すでに✓を付けた分は前の項目のまま）
 * - 記録: 日ごとに1行。未完了・手つかずは赤で残す（持ち越さない）。「今日はなし」は理由つき
 * - スタッフは一覧と記録を見るだけ
 */
import { ref, computed, onUnmounted } from 'vue'
import {
  checklists, checklistRuns, canEditChecklists, saveChecklist, setChecklistPaused, removeChecklist, newItemId, startFromSample,
  CHECKLIST_SAMPLES, CL_NAME_MAX, CL_ITEM_MAX, CL_ITEMS_MAX, CL_TIMES_MAX,
} from '../composables/useChecklists.js'
import { staffNames } from '../composables/useAuth.js'
import { isMeId } from '../composables/useDeviceId.js'
import { checklistHistory, whenLabel, slotsOf } from '../services/checklistSchedule.js'
import { localDateKey } from '../utils/localDate.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

const props = defineProps({
  historyOf: { type: Object, default: null },   // 開いたらすぐこの表の記録
  editOf:    { type: Object, default: null },   // 開いたらすぐこの表を直す
  create:    { type: Boolean, default: false }, // 開いたらすぐ作る
})
const emit = defineEmits(['close', 'open-run'])

const view = ref(props.historyOf ? 'history' : 'list')   // list | edit | history
const direct = !!(props.historyOf || props.editOf || props.create)   // 外から1つの画面を開いた（戻るで閉じる）
const target = ref(props.historyOf)
const err = ref('')
const busy = ref(false)
const lists = computed(() => [...checklists.value].sort((a, b) => (a.paused ? 1 : 0) - (b.paused ? 1 : 0) || (slotsOf(a)[0] || '99').localeCompare(slotsOf(b)[0] || '99')))
const people = computed(() => staffNames.value)
const WEEK = ['日', '月', '火', '水', '木', '金', '土']

// ── 作る・直す ──
const f = ref(null)
function _blank() { return { id: null, name: '', items: [{ id: newItemId(), text: '' }], repeat: 'daily', weekdays: [], monthDay: 1, startDate: localDateKey(), times: [], who: 'anyone', paused: false } }
function openNew() { f.value = _blank(); timeDraft.value = ''; err.value = ''; view.value = 'edit' }
async function useSample(sample) {
  busy.value = true; err.value = ''
  try { await startFromSample(sample) } catch (e) { err.value = e?.message || '作れませんでした' } finally { busy.value = false }
}
function openEdit(cl) {
  f.value = {
    id: cl.id, name: cl.name, items: cl.items.map(x => ({ ...x })), repeat: cl.repeat,
    weekdays: cl.repeat === 'weekly' ? String(cl.repeatDays ?? '').split(',').filter(Boolean).map(Number) : [],
    monthDay: cl.repeat === 'monthly' ? Number(cl.repeatDays) || 1 : 1,
    startDate: cl.repeat === 'none' ? cl.startDate : localDateKey(),
    times: slotsOf(cl).filter(Boolean), who: cl.assign === 'person' ? `p:${cl.assigneeId}` : 'anyone', paused: !!cl.paused,
  }
  timeDraft.value = ''; err.value = ''; view.value = 'edit'
}
function addItem() { if (f.value.items.length < CL_ITEMS_MAX) f.value.items.push({ id: newItemId(), text: '' }) }
function moveItem(i, n) {
  const a = f.value.items, j = i + n
  if (j < 0 || j >= a.length) return
  ;[a[i], a[j]] = [a[j], a[i]]
}
// 時刻（いくつでも＝1日に何回も）
const timeDraft = ref('')
function addTime() {
  const t = timeDraft.value
  if (!/^\d{2}:\d{2}$/.test(t) || f.value.times.includes(t) || f.value.times.length >= CL_TIMES_MAX) return
  f.value.times = [...f.value.times, t].sort(); timeDraft.value = ''
}
function removeTime(t) { f.value.times = f.value.times.filter(x => x !== t) }
const sentence = computed(() => {
  const x = f.value
  if (!x) return ''
  const when = x.repeat === 'daily' ? '毎日' : x.repeat === 'weekly' ? (x.weekdays.length ? `毎週 ${x.weekdays.map(d => WEEK[d]).join('・')}曜` : '毎週（曜日を選ぶ）')
    : x.repeat === 'monthly' ? `毎月${x.monthDay}日` : `${Number(x.startDate.slice(5, 7))}/${Number(x.startDate.slice(8))}だけ`
  const at = x.times.length ? ` ${x.times.join('・')}${x.times.length > 1 ? `（1日${x.times.length}回）` : ''}に` : '（時刻なし）'
  const pid = x.who.startsWith('p:') ? x.who.slice(2) : null
  const who = pid ? `${people.value.find(p => p.id === pid)?.name || ''}が` : '誰でも'
  return { name: x.name.trim() || 'このチェック', when, at, who }
})
function toggleDay(d) { const w = f.value.weekdays; f.value.weekdays = w.includes(d) ? w.filter(x => x !== d) : [...w, d].sort() }
const canSave = computed(() => {
  const x = f.value
  if (!x || !x.name.trim() || !x.items.some(it => it.text.trim())) return false
  if (x.repeat === 'weekly' && !x.weekdays.length) return false
  return true
})
async function save() {
  if (!canSave.value || busy.value) return
  const x = f.value
  const pid = x.who.startsWith('p:') ? x.who.slice(2) : null
  busy.value = true; err.value = ''
  try {
    await saveChecklist({
      id: x.id, name: x.name, items: x.items, repeat: x.repeat,
      repeatDays: x.repeat === 'weekly' ? x.weekdays.join(',') : x.repeat === 'monthly' ? String(x.monthDay) : null,
      startDate: x.repeat === 'none' ? x.startDate : undefined,
      dueTimes: x.times,
      assign: pid ? 'person' : 'anyone', assigneeId: pid, assigneeName: pid ? (people.value.find(p => p.id === pid)?.name || '') : null,
      paused: x.paused,
    })
    if (direct) emit('close'); else view.value = 'list'
  } catch (e) { err.value = e?.message || '保存できませんでした' } finally { busy.value = false }
}
async function togglePause() {
  busy.value = true; err.value = ''
  try { await setChecklistPaused(f.value.id, !f.value.paused); view.value = 'list' } catch (e) { err.value = e?.message || '保存できませんでした' } finally { busy.value = false }
}
async function remove() {
  if (!confirm(`「${f.value.name}」を消しますか？\n今までの記録も見られなくなります。使わない時期だけなら「お休み」にしてください。`)) return
  busy.value = true; err.value = ''
  try { await removeChecklist(f.value.id); view.value = 'list' } catch (e) { err.value = e?.message || '消せませんでした' } finally { busy.value = false }
}

// ── 記録 ──
function openHistory(cl) { target.value = cl; view.value = 'history' }
const history = computed(() => (target.value ? checklistHistory(target.value, checklistRuns.value, { days: 60 }) : []))
const md = date => { const d = new Date(date + 'T00:00:00'); return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）` }
const hm = iso => { const d = new Date(iso); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` }
// 1日に何回もの表は回の数（済み 2/3回）、1回の表は項目の数
function badge(h) {
  const n = h.totalSlots > 1 ? `${h.doneSlots}/${h.totalSlots}回` : `${h.filled}/${h.total}`
  if (h.status === 'done') { const skip = h.slots.reduce((k, s) => k + s.skip, 0); return h.totalSlots > 1 ? `済 ${n}` : skip ? `済（なし${skip}）` : `済 ${n}` }
  return `${h.status === 'open' ? '途中' : h.status === 'none' ? '手つかず' : '未完了'} ${n}`
}
const _slotName = s => (s.slot ? `${s.slot}の回` : '')
const missing = h => h.slots.flatMap(s => s.items.filter(it => !s.marks[it.id]).map(it => (h.totalSlots > 1 ? `${_slotName(s)}：${it.text}` : it.text)))
const skips = h => h.slots.flatMap(s => s.items.filter(it => s.marks[it.id]?.s === 'skip').map(it => `${it.text}${s.marks[it.id].reason ? `（${s.marks[it.id].reason}）` : ''}`))
const openSlot = h => (h.slots.find(s => !s.complete) ?? h.slots[0]).slot

function back() {
  if (view.value === 'list' || direct) emit('close')
  else view.value = 'list'
}
if (props.editOf) openEdit(props.editOf)
else if (props.create) openNew()
onUnmounted(registerInnerLayerCloser(() => { back(); return true }))
const title = computed(() => (view.value === 'edit' ? (f.value?.id ? f.value.name || '毎日のチェックを直す' : '毎日のチェックを作る') : view.value === 'history' ? `${target.value?.name ?? ''}の記録` : '毎日のチェック'))
</script>

<template>
  <Teleport to="body">
    <div class="cp" role="dialog" :aria-label="title">
      <div class="cp-top">
        <button type="button" class="cp-back" @click="back">‹ 戻る</button>
        <b>{{ title }}</b>
        <span class="cp-sp"></span>
      </div>

      <!-- ① 一覧 -->
      <div v-if="view === 'list'" class="cp-body">
        <p class="cp-lead">開店・退店のように、毎日同じことを確かめる表です。日誌の一番上に今日の分が出て、誰がいつ✓したか残ります。</p>
        <div v-for="cl in lists" :key="cl.id" :class="['cp-card', { off: cl.paused }]">
          <div class="cp-card-h"><b>{{ cl.name }}</b>
            <button v-if="canEditChecklists" type="button" class="cp-link" @click="openEdit(cl)">直す ›</button>
          </div>
          <div class="cp-meta">
            <span :class="['cp-pill', { off: cl.paused }]">{{ cl.paused ? 'お休み中' : whenLabel(cl) }}</span>
            <span v-if="!cl.paused && slotsOf(cl).length > 1">1日{{ slotsOf(cl).length }}回</span>
            <span v-else-if="!cl.paused && !slotsOf(cl)[0]">時刻なし</span>
            <span>{{ cl.assign === 'person' ? cl.assigneeName : '誰でも' }}</span>
            <span>{{ cl.items.length }}項目</span>
            <button type="button" class="cp-link" @click="openHistory(cl)">記録</button>
          </div>
        </div>
        <p v-if="!lists.length" class="cp-empty">まだ毎日のチェックはありません</p>
        <template v-if="canEditChecklists">
          <button type="button" class="cp-add" @click="openNew()">＋ 自分で作る</button>
          <div class="cp-samp">
            <div v-for="s in CHECKLIST_SAMPLES" :key="s.name" class="cp-samp-i">
              <span><b>{{ s.name }}</b><small>{{ s.summary }}</small></span>
              <button type="button" :disabled="busy" @click="useSample(s)">見本で始める</button>
            </div>
          </div>
          <p v-if="err" class="cp-err" role="alert">{{ err }}</p>
        </template>
        <p v-else class="cp-empty">作る・直すのは管理者です</p>
      </div>

      <!-- ② 作る・直す -->
      <form v-else-if="view === 'edit' && f" class="cp-body" @submit.prevent="save">
        <p class="cp-sentence"><b>{{ sentence.name }}</b>は<br><u>{{ sentence.when }}</u><u>{{ sentence.at }}</u>、<u>{{ sentence.who }}</u> チェックする</p>
        <label class="cp-f">名前<input v-model="f.name" type="text" :maxlength="CL_NAME_MAX" class="cp-in" placeholder="例：🌙 退店チェック" /></label>
        <div class="cp-f">確かめること
          <div v-for="(it, i) in f.items" :key="it.id" class="cp-it">
            <input v-model="it.text" type="text" :maxlength="CL_ITEM_MAX" class="cp-in" :placeholder="`項目 ${i + 1}`" :aria-label="`項目 ${i + 1}`" />
            <button type="button" class="cp-ic" :disabled="i === 0" aria-label="上へ" @click="moveItem(i, -1)">↑</button>
            <button type="button" class="cp-ic" :disabled="i === f.items.length - 1" aria-label="下へ" @click="moveItem(i, 1)">↓</button>
            <button type="button" class="cp-ic" :disabled="f.items.length === 1" aria-label="消す" @click="f.items.splice(i, 1)">✕</button>
          </div>
          <button type="button" class="cp-add small" :disabled="f.items.length >= CL_ITEMS_MAX" @click="addItem">＋ 項目を足す</button>
        </div>
        <div class="cp-f">いつ
          <div class="cp-seg">
            <button v-for="r in [['daily', '毎日'], ['weekly', '曜日を選ぶ'], ['monthly', '毎月◯日'], ['none', '1回だけ']]" :key="r[0]" type="button"
              :class="{ on: f.repeat === r[0] }" :aria-pressed="f.repeat === r[0]" @click="f.repeat = r[0]">{{ r[1] }}</button>
          </div>
          <div v-if="f.repeat === 'weekly'" class="cp-seg days">
            <button v-for="(w, d) in WEEK" :key="d" type="button" :class="{ on: f.weekdays.includes(d) }" :aria-pressed="f.weekdays.includes(d)" @click="toggleDay(d)">{{ w }}</button>
          </div>
          <label v-else-if="f.repeat === 'monthly'" class="cp-inline">毎月
            <select v-model.number="f.monthDay" class="cp-in sm"><option v-for="n in 31" :key="n" :value="n">{{ n }}</option></select>日（無い月は月末）
          </label>
          <label v-else-if="f.repeat === 'none'" class="cp-inline">日付<input v-model="f.startDate" type="date" class="cp-in sm" /></label>
        </div>
        <div class="cp-f">時刻（いくつでも。1日に何回も見るものは時刻を足す）
          <div class="cp-times">
            <button v-for="t in f.times" :key="t" type="button" class="cp-time" :aria-label="`${t}を外す`" @click="removeTime(t)">{{ t }} ✕</button>
            <span v-if="!f.times.length" class="cp-none">時刻なし（その日のうちならいつでも）</span>
          </div>
          <div v-if="f.times.length < CL_TIMES_MAX" class="cp-inline">
            <input v-model="timeDraft" type="time" class="cp-in sm" aria-label="足す時刻" />
            <button type="button" class="cp-addt" :disabled="!timeDraft" @click="addTime">＋ 時刻を足す</button>
          </div>
        </div>
        <label v-if="people.some(p => !p.owner)" class="cp-f">誰が
          <select v-model="f.who" class="cp-in">
            <option value="anyone">誰でも</option>
            <option v-for="p in people" :key="p.id" :value="`p:${p.id}`">{{ p.name }}{{ isMeId(p.id) ? '（自分）' : '' }}</option>
          </select>
        </label>
        <p v-if="f.id" class="cp-note">直した内容は、まだ✓を付けていない日から使います（今日すでに✓を付けた分は前の項目のまま）。</p>
        <p v-if="err" class="cp-err" role="alert">{{ err }}</p>
        <button type="submit" class="cp-save" :disabled="!canSave || busy">保存</button>
        <div v-if="f.id" class="cp-row">
          <button type="button" class="cp-mini" :disabled="busy" @click="togglePause">{{ f.paused ? 'お休みをやめる' : 'お休みにする' }}</button>
          <button type="button" class="cp-mini danger" :disabled="busy" @click="remove">消す</button>
        </div>
      </form>

      <!-- ⑤ 記録 -->
      <div v-else-if="view === 'history'" class="cp-body">
        <div v-for="h in history" :key="h.date" class="cp-rec" role="button" tabindex="0" @click="emit('open-run', { cl: target, date: h.date, slot: openSlot(h) })" @keydown.enter.prevent="emit('open-run', { cl: target, date: h.date, slot: openSlot(h) })">
          <div class="cp-rec-h">{{ md(h.date) }}<em :class="h.status">{{ badge(h) }}</em></div>
          <div v-if="h.totalSlots > 1" class="cp-rec-slots"><span v-for="s in h.slots" :key="s.slot" :class="{ ok: s.complete }">{{ s.slot }} {{ s.complete ? '✓' : s.started ? '途中' : '－' }}</span></div>
          <div class="cp-rec-s">
            <template v-if="h.names.length">{{ h.names.join('・') }} {{ hm(h.from) }}〜{{ h.to !== h.from ? hm(h.to) : '' }}</template>
            <template v-if="skips(h).length"> ・ 今日はなし：{{ skips(h).join('、') }}</template>
            <s v-if="h.status === 'none'">だれも✓を付けていない</s>
            <s v-else-if="h.status === 'partial'"> ・ 未：{{ missing(h).join('、') }}</s>
          </div>
        </div>
        <p v-if="!history.length" class="cp-empty">この60日の記録はありません</p>
        <p v-else class="cp-empty">直近60日まで</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cp { position: fixed; inset: 0; z-index: 115; background: var(--bg); display: flex; flex-direction: column; }
.cp-top { flex: none; display: flex; align-items: center; gap: 8px; padding: 12px 14px; background: var(--surface); border-bottom: 1px solid var(--border); }
.cp-top b { flex: 1; text-align: center; font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-back { border: none; background: none; font: inherit; font-size: 14px; font-weight: 800; color: var(--primary); cursor: pointer; padding: 6px 0; min-width: 64px; text-align: left; }
.cp-sp { min-width: 64px; }
.cp-body { flex: 1; overflow-y: auto; padding: 12px 12px calc(40px + env(safe-area-inset-bottom)); display: grid; gap: 10px; align-content: start; max-width: 600px; width: 100%; margin: 0 auto; box-sizing: border-box; }
.cp-lead { margin: 0; font-size: 12.5px; color: var(--text-muted); line-height: 1.6; }
.cp-card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 12px; display: grid; gap: 6px; }
.cp-card.off { opacity: .6; }
.cp-card-h { display: flex; align-items: center; gap: 6px; } .cp-card-h b { flex: 1; font-size: 15px; }
.cp-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; font-size: 12px; color: var(--text-muted); }
.cp-meta .cp-link { margin-left: auto; }
.cp-pill { font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 999px; background: #eef2ff; color: #3730a3; }
.cp-seg button.on { background: #4f46e5; border-color: #4f46e5; color: #fff; }
.cp-pill.off { background: #f1f5f9; color: #64748b; }
.cp-link { border: none; background: none; font: inherit; font-size: 12.5px; font-weight: 800; color: var(--primary); cursor: pointer; padding: 4px 2px; }
.cp-add { border: 2px dashed #a5f3fc; border-radius: 14px; padding: 12px; background: var(--surface); font: inherit; font-size: 14px; font-weight: 900; color: var(--primary); cursor: pointer; }
.cp-add.small { padding: 8px; font-size: 13px; border-width: 1px; border-radius: 10px; }
.cp-add:disabled { opacity: .5; }
.cp-sample { margin: 0; text-align: center; font-size: 12px; color: var(--text-muted); }
.cp-empty { margin: 0; padding: 10px 4px; text-align: center; font-size: 12.5px; color: var(--text-muted); }
.cp-f { display: grid; gap: 6px; font-size: 12px; font-weight: 800; color: var(--text-muted); }
.cp-in { width: 100%; min-height: 42px; border: 1px solid var(--border); border-radius: 10px; padding: 0 10px; font: inherit; font-size: 15px; background: var(--surface); color: var(--text); box-sizing: border-box; }
.cp-in.sm { width: auto; min-width: 90px; }
.cp-it { display: flex; gap: 4px; align-items: center; }
.cp-ic { flex: none; width: 34px; height: 38px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface); color: var(--text-muted); font-size: 13px; cursor: pointer; }
.cp-ic:disabled { opacity: .35; }
.cp-seg { display: flex; flex-wrap: wrap; gap: 4px; }
.cp-seg button { border: 1px solid var(--border); background: var(--surface); border-radius: 9px; padding: 8px 11px; font: inherit; font-size: 13px; font-weight: 800; color: var(--text-muted); cursor: pointer; }
.cp-seg button.on { background: var(--primary); border-color: var(--primary); color: #fff; }
.cp-seg.days button { min-width: 40px; }
.cp-inline { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text); font-weight: 700; }
.cp-note { margin: 0; font-size: 12px; color: var(--text-muted); line-height: 1.6; }
.cp-err { margin: 0; font-size: 12.5px; color: #b91c1c; font-weight: 700; }
.cp-save { min-height: 48px; border: none; border-radius: 12px; background: var(--grad-btn); color: #08323c; font: inherit; font-size: 15px; font-weight: 900; cursor: pointer; }
.cp-save:disabled { opacity: .5; }
.cp-row { display: flex; gap: 8px; }
.cp-mini { flex: 1; min-height: 42px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text); font: inherit; font-weight: 700; cursor: pointer; }
.cp-mini.danger { color: #b91c1c; border-color: #fecaca; }
.cp-sentence { margin: 0; background: #eef2ff; color: #3730a3; border-radius: 12px; padding: 10px 12px; font-size: 14px; font-weight: 800; line-height: 1.7; }
.cp-sentence u { text-decoration-color: #a5b4fc; text-underline-offset: 3px; }
.cp-times { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.cp-time { border: none; border-radius: 10px; background: #4f46e5; color: #fff; font: inherit; font-size: 13.5px; font-weight: 900; padding: 8px 11px; cursor: pointer; }
.cp-none { font-size: 12.5px; font-weight: 700; color: var(--text-muted); }
.cp-addt { min-height: 40px; border: 1px dashed #a5b4fc; border-radius: 10px; background: var(--surface); color: #4f46e5; font: inherit; font-size: 13px; font-weight: 800; padding: 0 12px; cursor: pointer; }
.cp-addt:disabled { opacity: .5; }
.cp-samp { display: grid; gap: 7px; }
.cp-samp-i { display: flex; align-items: center; gap: 8px; border: 1px solid #c7d2fe; background: #eef2ff; border-radius: 12px; padding: 10px 12px; }
.cp-samp-i span { flex: 1; display: grid; gap: 2px; color: #3730a3; font-size: 13.5px; }
.cp-samp-i small { font-size: 11.5px; color: var(--text-muted); font-weight: 600; }
.cp-samp-i button { flex: none; border: none; border-radius: 9px; background: #4f46e5; color: #fff; font: inherit; font-size: 12.5px; font-weight: 800; padding: 8px 10px; cursor: pointer; }
.cp-rec-slots { display: flex; flex-wrap: wrap; gap: 4px; }
.cp-rec-slots span { font-size: 11px; font-weight: 800; padding: 2px 7px; border-radius: 999px; background: #fee2e2; color: #b91c1c; }
.cp-rec-slots span.ok { background: #dcfce7; color: #166534; }
.cp-rec { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; display: grid; gap: 4px; cursor: pointer; }
.cp-rec-h { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 800; }
.cp-rec-h em { margin-left: auto; font-style: normal; font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #dcfce7; color: #166534; }
.cp-rec-h em.partial, .cp-rec-h em.none { background: #fee2e2; color: #b91c1c; }
.cp-rec-h em.open { background: #eef2ff; color: #3730a3; }
.cp-rec-s { font-size: 11.5px; color: var(--text-muted); line-height: 1.5; }
.cp-rec-s s { color: #b91c1c; text-decoration: none; font-weight: 800; }
</style>
