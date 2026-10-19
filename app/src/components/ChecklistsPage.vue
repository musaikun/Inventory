<script setup>
/**
 * チェック表の一覧・作る/直す・記録（全画面・User決定 2026-10-19・モック docs/mocks/journal-checklist.html ①②⑤）。
 * - 一覧: 店で使っている表。見本（開店・退店）から作れる。お休み中は薄く
 * - 作る・直す（管理者だけ）: 名前・項目（並べ替え・消す）・繰り返し（なし／毎日／曜日／毎月◯日）・時刻・担当（誰でも／人）
 *   直した表は、まだ✓を付けていない日から効く（今日すでに✓を付けた分は前の項目のまま）
 * - 記録: 日ごとに1行。未完了・手つかずは赤で残す（持ち越さない）。「今日はなし」は理由つき
 * - スタッフは一覧と記録を見るだけ
 */
import { ref, computed, onUnmounted } from 'vue'
import {
  checklists, checklistRuns, canEditChecklists, saveChecklist, setChecklistPaused, removeChecklist, newItemId,
  CHECKLIST_SAMPLES, CL_NAME_MAX, CL_ITEM_MAX, CL_ITEMS_MAX,
} from '../composables/useChecklists.js'
import { staffNames } from '../composables/useAuth.js'
import { isMeId } from '../composables/useDeviceId.js'
import { checklistHistory, repeatLabel } from '../services/checklistSchedule.js'
import { localDateKey } from '../utils/localDate.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

const props = defineProps({
  historyOf: { type: Object, default: null },   // 開いたらすぐこの表の記録
})
const emit = defineEmits(['close', 'open-run'])

const view = ref(props.historyOf ? 'history' : 'list')   // list | edit | history
const target = ref(props.historyOf)
const err = ref('')
const busy = ref(false)
const lists = computed(() => [...checklists.value].sort((a, b) => (a.paused ? 1 : 0) - (b.paused ? 1 : 0) || (a.dueTime || '99').localeCompare(b.dueTime || '99')))
const people = computed(() => staffNames.value)
const WEEK = ['日', '月', '火', '水', '木', '金', '土']

// ── 作る・直す ──
const f = ref(null)
function _blank() { return { id: null, name: '', items: [{ id: newItemId(), text: '' }], repeat: 'daily', weekdays: [], monthDay: 1, startDate: localDateKey(), timed: false, dueTime: '', who: 'anyone', paused: false } }
function openNew(sample = null) {
  const b = _blank()
  if (sample) { b.name = sample.name; b.items = sample.items.map(text => ({ id: newItemId(), text })); b.timed = !!sample.dueTime; b.dueTime = sample.dueTime || '' }
  f.value = b; err.value = ''; view.value = 'edit'
}
function openEdit(cl) {
  f.value = {
    id: cl.id, name: cl.name, items: cl.items.map(x => ({ ...x })), repeat: cl.repeat,
    weekdays: cl.repeat === 'weekly' ? String(cl.repeatDays ?? '').split(',').filter(Boolean).map(Number) : [],
    monthDay: cl.repeat === 'monthly' ? Number(cl.repeatDays) || 1 : 1,
    startDate: cl.repeat === 'none' ? cl.startDate : localDateKey(),
    timed: !!cl.dueTime, dueTime: cl.dueTime || '', who: cl.assign === 'person' ? `p:${cl.assigneeId}` : 'anyone', paused: !!cl.paused,
  }
  err.value = ''; view.value = 'edit'
}
function addItem() { if (f.value.items.length < CL_ITEMS_MAX) f.value.items.push({ id: newItemId(), text: '' }) }
function moveItem(i, n) {
  const a = f.value.items, j = i + n
  if (j < 0 || j >= a.length) return
  ;[a[i], a[j]] = [a[j], a[i]]
}
function toggleDay(d) { const w = f.value.weekdays; f.value.weekdays = w.includes(d) ? w.filter(x => x !== d) : [...w, d].sort() }
const canSave = computed(() => {
  const x = f.value
  if (!x || !x.name.trim() || !x.items.some(it => it.text.trim())) return false
  if (x.repeat === 'weekly' && !x.weekdays.length) return false
  if (x.timed && !x.dueTime) return false
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
      dueTime: x.timed ? x.dueTime : null,
      assign: pid ? 'person' : 'anyone', assigneeId: pid, assigneeName: pid ? (people.value.find(p => p.id === pid)?.name || '') : null,
      paused: x.paused,
    })
    view.value = 'list'
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
function badge(h) {
  if (h.status === 'done') return h.skip ? `済（なし${h.skip}）` : `済 ${h.done}/${h.total}`
  if (h.status === 'open') return `途中 ${h.filled}/${h.total}`
  if (h.status === 'none') return `手つかず 0/${h.total}`
  return `未完了 ${h.filled}/${h.total}`
}
const missing = h => h.items.filter(it => !h.marks[it.id]).map(it => it.text)
const skips = h => h.items.filter(it => h.marks[it.id]?.s === 'skip').map(it => `${it.text}${h.marks[it.id].reason ? `（${h.marks[it.id].reason}）` : ''}`)

function back() {
  if (view.value === 'list' || (view.value === 'history' && props.historyOf)) emit('close')
  else view.value = 'list'
}
onUnmounted(registerInnerLayerCloser(() => { back(); return true }))
const title = computed(() => (view.value === 'edit' ? (f.value?.id ? 'チェック表を直す' : 'チェック表を作る') : view.value === 'history' ? `${target.value?.name ?? ''}の記録` : 'チェック表'))
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
        <p class="cp-lead">開店・退店など、毎回同じ項目を確かめる表です。日誌の「1日」に出て、項目ごとに✓を付けます。</p>
        <div v-for="cl in lists" :key="cl.id" :class="['cp-card', { off: cl.paused }]">
          <div class="cp-card-h"><b>{{ cl.name }}</b>
            <button v-if="canEditChecklists" type="button" class="cp-link" @click="openEdit(cl)">直す ›</button>
          </div>
          <div class="cp-meta">
            <span :class="['cp-pill', { off: cl.paused }]">{{ cl.paused ? 'お休み中' : repeatLabel(cl) }}{{ !cl.paused && cl.dueTime ? ` ${cl.dueTime}` : '' }}</span>
            <span v-if="!cl.dueTime && !cl.paused">時刻なし</span>
            <span>{{ cl.assign === 'person' ? cl.assigneeName : '誰でも' }}</span>
            <span>{{ cl.items.length }}項目</span>
            <button type="button" class="cp-link" @click="openHistory(cl)">記録</button>
          </div>
        </div>
        <p v-if="!lists.length" class="cp-empty">まだチェック表はありません</p>
        <template v-if="canEditChecklists">
          <button type="button" class="cp-add" @click="openNew()">＋ チェック表を作る</button>
          <p class="cp-sample">見本から作る：
            <button v-for="s in CHECKLIST_SAMPLES" :key="s.name" type="button" class="cp-link" @click="openNew(s)">{{ s.name }}</button>
          </p>
        </template>
        <p v-else class="cp-empty">チェック表を作る・直すのは管理者です</p>
      </div>

      <!-- ② 作る・直す -->
      <form v-else-if="view === 'edit' && f" class="cp-body" @submit.prevent="save">
        <label class="cp-f">名前<input v-model="f.name" type="text" :maxlength="CL_NAME_MAX" class="cp-in" placeholder="例：🌙 退店チェック" /></label>
        <div class="cp-f">項目
          <div v-for="(it, i) in f.items" :key="it.id" class="cp-it">
            <input v-model="it.text" type="text" :maxlength="CL_ITEM_MAX" class="cp-in" :placeholder="`項目 ${i + 1}`" :aria-label="`項目 ${i + 1}`" />
            <button type="button" class="cp-ic" :disabled="i === 0" aria-label="上へ" @click="moveItem(i, -1)">↑</button>
            <button type="button" class="cp-ic" :disabled="i === f.items.length - 1" aria-label="下へ" @click="moveItem(i, 1)">↓</button>
            <button type="button" class="cp-ic" :disabled="f.items.length === 1" aria-label="消す" @click="f.items.splice(i, 1)">✕</button>
          </div>
          <button type="button" class="cp-add small" :disabled="f.items.length >= CL_ITEMS_MAX" @click="addItem">＋ 項目を足す</button>
        </div>
        <div class="cp-f">繰り返し
          <div class="cp-seg">
            <button v-for="r in [['none', 'なし'], ['daily', '毎日'], ['weekly', '曜日'], ['monthly', '毎月◯日']]" :key="r[0]" type="button"
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
        <div class="cp-f">時刻
          <div class="cp-seg">
            <button type="button" :class="{ on: !f.timed }" :aria-pressed="!f.timed" @click="f.timed = false">なし（終日）</button>
            <button type="button" :class="{ on: f.timed }" :aria-pressed="f.timed" @click="f.timed = true">時刻を決める</button>
          </div>
          <input v-if="f.timed" v-model="f.dueTime" type="time" class="cp-in sm" aria-label="時刻" />
        </div>
        <label v-if="people.some(p => !p.owner)" class="cp-f">担当
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
        <div v-for="h in history" :key="h.date" class="cp-rec" role="button" tabindex="0" @click="emit('open-run', { cl: target, date: h.date })" @keydown.enter.prevent="emit('open-run', { cl: target, date: h.date })">
          <div class="cp-rec-h">{{ md(h.date) }}<em :class="h.status">{{ badge(h) }}</em></div>
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
.cp-rec { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; display: grid; gap: 4px; cursor: pointer; }
.cp-rec-h { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 800; }
.cp-rec-h em { margin-left: auto; font-style: normal; font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #dcfce7; color: #166534; }
.cp-rec-h em.partial, .cp-rec-h em.none { background: #fee2e2; color: #b91c1c; }
.cp-rec-h em.open { background: #eef2ff; color: #3730a3; }
.cp-rec-s { font-size: 11.5px; color: var(--text-muted); line-height: 1.5; }
.cp-rec-s s { color: #b91c1c; text-decoration: none; font-weight: 800; }
</style>
