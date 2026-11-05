<script setup>
/**
 * やることを足す、ただ1つの入口（User決定 2026-11-05・モック docs/mocks/task-create.html）。
 * - まず種類を選ぶ（やること・チェック表・ルーティン・進行中・いつか）。次の画面はその種類に要る欄だけ
 * - 項目のあるものは全部チェック表（1回／繰り返す）。ルーティンは項目なし（押せば済む1件）
 * - ★ お気に入り（店で共有のひな形）から選ぶと、種類と中身が入った状態で開く。日付だけ選べばよい
 * - 「お気に入りにも入れる」で、足すのと一緒にお気に入りにも入る
 * - スタッフも作れる（やることを作れる人）。管理者は、やること・進行中・いつかを「管理者だけ」にもできる
 */
import { ref, computed, onUnmounted } from 'vue'
import { addTask, TASK_TEXT_MAX, TASK_NOTE_MAX } from '../composables/useTasks.js'
import { saveChecklist, newItemId, CL_NAME_MAX, CL_ITEM_MAX, CL_ITEMS_MAX, CL_TIMES_MAX } from '../composables/useChecklists.js'
import { templates, addTemplate, canAddTemplate, KIND_ICON, templateSummary } from '../composables/useTemplates.js'
import { monthDaysLabel } from '../services/checklistSchedule.js'
import { staffNames, isAdmin } from '../composables/useAuth.js'
import { isMeId } from '../composables/useDeviceId.js'
import { localDateKey } from '../utils/localDate.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

const props = defineProps({
  date: { type: String, default: '' },        // 1回のものの既定の日（空なら今日）
  startKind: { type: String, default: '' },   // 種類を決めて開く（'progress' など）
  template: { type: Object, default: null },  // お気に入りから開く
  presetTime: { type: String, default: '' },  // 予定ボードのマスから（始まりの時刻）
  presetWho: { type: String, default: '' },   // 予定ボードのマスから（'all' | 'p:<id>'）
})
const emit = defineEmits(['close', 'added', 'favorites'])

const KINDS = [
  { k: 'task', icon: '📅', label: 'やること', sub: '日付と時刻を決めて1回（揚げ油の交換）' },
  { k: 'checklist', icon: '📋', label: 'チェック表', sub: '項目に✓を付けていく。1回でも毎日でも（閉店チェック）' },
  { k: 'routine', icon: '🔁', label: 'ルーティン', sub: '決まった日に押せば済む1件（冷蔵庫の温度）' },
  { k: 'progress', icon: '⏳', label: '進行中', sub: '何日かかかる。済むまで毎日出る（修理の手配）' },
  { k: 'someday', icon: '📥', label: 'いつか', sub: '日付を決めずにしまっておく（棚の整理）' },
]
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const today = localDateKey()

const kind = ref('')
const kindInfo = computed(() => KINDS.find(x => x.k === kind.value))
const name = ref(''), day = ref(props.date && props.date >= today ? props.date : today), time = ref(''), note = ref(''), noteOpen = ref(false)
const deadline = ref('')
const who = ref('all')
const items = ref([])            // チェック表の項目 [{ id, text }]
const itemDraft = ref('')
const once = ref(true)           // チェック表: 1回（true）／繰り返す（false）
const repeat = ref('daily'), weekdays = ref([]), monthDays = ref(['1']), dayDraft = ref('1')
const times = ref([]), timeDraft = ref('')
const fav = ref(false)
// 予定ボード（2026-11-05）: 終わりの時刻（任意）と中身の種類（色）
const endTime = ref('')
const category = ref('')
const CATS = [['', 'やること'], ['prep', '仕込み'], ['clean', '清掃'], ['order', '発注・納品']]
const err = ref(''), busy = ref(false)

const people = computed(() => staffNames.value)
const hasStaff = computed(() => people.value.some(p => !p.owner))
// 担当は 全員／人（User決定 2026-10-28）。既定は自分、選べなければ全員。スタッフがいない店は担当の欄を出さない
function _defaultWho() {
  if (!hasStaff.value) return 'all'
  const me = people.value.find(p => isMeId(p.id))
  return me ? `p:${me.id}` : 'all'
}
who.value = _defaultWho()
if (props.presetTime) {
  time.value = props.presetTime
  const [h, m] = props.presetTime.split(':').map(Number)
  const e = h * 60 + m + 30
  if (e < 24 * 60) endTime.value = `${String(Math.floor(e / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`
}
if (props.presetWho && (props.presetWho === 'all' || people.value.some(p => `p:${p.id}` === props.presetWho))) who.value = props.presetWho

function choose(k) { kind.value = k; err.value = '' }
function back() { kind.value = ''; err.value = '' }

// お気に入りから: 種類と中身を入れて、その種類の画面へ（日付は使うときに選ぶ）
function useTemplate(t) {
  const d = t.data ?? {}
  kind.value = t.kind
  name.value = t.name
  note.value = d.note ?? ''; noteOpen.value = !!d.note
  time.value = d.dueTime ?? ''
  items.value = (d.items ?? []).map(x => ({ id: newItemId(), text: x.text }))
  const rep = d.repeat ?? (t.kind === 'routine' ? 'daily' : 'none')
  once.value = rep === 'none'
  repeat.value = rep === 'none' ? 'daily' : rep
  weekdays.value = rep === 'weekly' ? String(d.repeatDays ?? '').split(',').filter(Boolean).map(Number) : []
  monthDays.value = rep === 'monthly' ? String(d.repeatDays ?? '').split(',').filter(Boolean) : ['1']
  times.value = [...(d.dueTimes ?? [])]
  if (t.kind === 'checklist' && once.value && times.value[0]) time.value = times.value[0]
  if (d.assign?.mode === 'person' && people.value.some(p => p.id === d.assign.id)) who.value = `p:${d.assign.id}`
  else if (d.assign) who.value = 'all'
  fav.value = false
  err.value = ''
}
if (props.template) useTemplate(props.template)
else if (props.startKind) kind.value = props.startKind

// ── チェック表の項目 ──
function addItem() {
  const t = itemDraft.value.trim().slice(0, CL_ITEM_MAX)
  if (!t || items.value.length >= CL_ITEMS_MAX) return
  items.value = [...items.value, { id: newItemId(), text: t }]
  itemDraft.value = ''
}
function removeItem(id) { items.value = items.value.filter(x => x.id !== id) }
function moveItem(i, d) {
  const a = [...items.value], j = i + d
  if (j < 0 || j >= a.length) return
  ;[a[i], a[j]] = [a[j], a[i]]
  items.value = a
}

// ── 繰り返す（チェック表の「繰り返す」とルーティン）──
const repeating = computed(() => kind.value === 'routine' || (kind.value === 'checklist' && !once.value))
const _mdSort = a => [...new Set(a)].sort((x, y) => (x === 'L' ? 99 : Number(x)) - (y === 'L' ? 99 : Number(y)))
function toggleWeekday(d) { weekdays.value = weekdays.value.includes(d) ? weekdays.value.filter(x => x !== d) : [...weekdays.value, d].sort() }
function addMonthDay() { monthDays.value = _mdSort([...monthDays.value, dayDraft.value]) }
function toggleMonthEnd() { monthDays.value = monthDays.value.includes('L') ? monthDays.value.filter(x => x !== 'L') : _mdSort([...monthDays.value, 'L']) }
function addTime() {
  const t = timeDraft.value
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t) || times.value.length >= CL_TIMES_MAX) return
  times.value = [...new Set([...times.value, t])].sort()
  timeDraft.value = ''
}
function removeTime(t) { times.value = times.value.filter(x => x !== t) }
const repeatDays = computed(() => (repeat.value === 'weekly' ? weekdays.value.join(',') : repeat.value === 'monthly' ? monthDays.value.join(',') : null))
const repeatOk = computed(() => repeat.value === 'daily' || (repeat.value === 'weekly' && weekdays.value.length) || (repeat.value === 'monthly' && monthDays.value.length))
const whoName = computed(() => {
  const v = who.value
  return v.startsWith('p:') ? (people.value.find(p => p.id === v.slice(2))?.name || '') : '全員'
})
// 決めた内容を一文で（繰り返すもの）
const sentence = computed(() => {
  if (!repeating.value) return ''
  const w = repeat.value === 'daily' ? '毎日' : repeat.value === 'weekly' ? (weekdays.value.length ? `毎週 ${weekdays.value.map(d => WEEK[d]).join('・')}` : '') : (monthDays.value.length ? `毎月${monthDaysLabel(monthDays.value.join(','))}` : '')
  if (!w) return '🔁 曜日・日を選んでください'
  const at = times.value.length ? ` ${times.value.join('・')} に` : ''
  const n = name.value.trim() || '（名前）'
  return `🔁 ${w}${at}、${whoName.value}が「${n}」${kind.value === 'checklist' ? `（${items.value.length}項目）` : ''}をする`
})

// ── 足す ──
const canSubmit = computed(() => {
  if (!name.value.trim() || busy.value) return false
  if (kind.value === 'task') return !!day.value
  if (kind.value === 'checklist') return items.value.length > 0 && (once.value ? !!day.value : repeatOk.value)
  if (kind.value === 'routine') return repeatOk.value
  return true
})
const visibilityChoice = computed(() => isAdmin.value && ['task', 'progress', 'someday'].includes(kind.value))
function _assignTask() {
  const v = who.value
  return v.startsWith('p:') ? { mode: 'person', id: v.slice(2), name: whoName.value } : { mode: hasStaff.value ? 'all' : 'anyone' }
}
function _assignChecklist() {
  const v = who.value
  return v.startsWith('p:') ? { assign: 'person', assigneeId: v.slice(2), assigneeName: whoName.value } : { assign: 'anyone', assigneeId: null, assigneeName: null }
}
// お気に入りに入れる中身（日付は持たない）
function _templateData() {
  const v = who.value
  const assign = v.startsWith('p:') ? { mode: 'person', id: v.slice(2), name: whoName.value } : { mode: 'all' }
  if (kind.value === 'task') return { dueTime: time.value || undefined, note: note.value.trim() || undefined, assign }
  if (kind.value === 'checklist') return once.value
    ? { items: items.value, repeat: 'none', dueTimes: time.value ? [time.value] : [], assign }
    : { items: items.value, repeat: repeat.value, repeatDays: repeatDays.value, dueTimes: times.value, assign }
  if (kind.value === 'routine') return { repeat: repeat.value, repeatDays: repeatDays.value, dueTimes: times.value, assign }
  return { note: note.value.trim() || undefined, assign }
}
async function submit(adminsOnly = false) {
  if (!canSubmit.value) return
  err.value = ''
  const text = name.value.trim()
  busy.value = true
  try {
    const visibility = adminsOnly ? 'admins' : null
    if (kind.value === 'task') {
      if (!addTask(day.value, text, _assignTask(), time.value || null, { visibility, note: note.value, endTime: time.value && endTime.value > time.value ? endTime.value : null, category: category.value || null })) throw new Error('足せませんでした')
    } else if (kind.value === 'progress') {
      if (!addTask(today, text, _assignTask(), null, { visibility, progress: 'doing', deadline: deadline.value || null, note: note.value })) throw new Error('足せませんでした')
    } else if (kind.value === 'someday') {
      if (!addTask('', text, _assignTask(), null, { visibility, note: note.value })) throw new Error('足せませんでした')
    } else {
      await saveChecklist({
        name: text.slice(0, CL_NAME_MAX),
        items: kind.value === 'checklist' ? items.value : [],
        repeat: repeating.value ? repeat.value : 'none',
        repeatDays: repeating.value ? repeatDays.value : null,
        startDate: repeating.value ? undefined : day.value,
        dueTimes: repeating.value ? times.value : (time.value ? [time.value] : []),
        ..._assignChecklist(),
      })
    }
    if (fav.value && canAddTemplate.value) await addTemplate(kind.value, text, _templateData()).catch(() => {})
    emit('added', { kind: kind.value, name: text })
    emit('close')
  } catch (e) {
    err.value = e?.message || '保存できませんでした'
  } finally {
    busy.value = false
  }
}

onUnmounted(registerInnerLayerCloser(() => { if (kind.value && !props.startKind && !props.template) { back(); return true } emit('close'); return true }))
</script>

<template>
  <Teleport to="body">
    <div class="ta-bg" @click.self="emit('close')">
      <section class="ta" role="dialog" :aria-label="kind ? `${kindInfo?.label}を足す` : '何を足す？'">
        <!-- ① 種類を選ぶ -->
        <template v-if="!kind">
          <div class="ta-h"><b>何を足す？</b><button type="button" class="ta-x" @click="emit('close')">やめる</button></div>
          <div class="ta-kinds">
            <button v-for="x in KINDS" :key="x.k" type="button" class="ta-kind" :data-kind="x.k" @click="choose(x.k)">
              <em aria-hidden="true">{{ x.icon }}</em><span><b>{{ x.label }}</b><small>{{ x.sub }}</small></span>
            </button>
          </div>
          <div class="ta-favh"><span>★ お気に入りから</span><button v-if="templates.length" type="button" class="ta-link" @click="emit('favorites')">一覧 ›</button></div>
          <div v-if="templates.length" class="ta-favs">
            <button v-for="t in templates.slice(0, 8)" :key="t.id" type="button" :class="['ta-fav', t.kind]" :title="templateSummary(t)" @click="useTemplate(t)">
              <i aria-hidden="true">★</i>{{ KIND_ICON[t.kind] }} {{ t.name }}
            </button>
          </div>
          <p v-else class="ta-empty">足すときに「お気に入りにも入れる」を選ぶと、ここから押すだけで足せます</p>
        </template>

        <!-- ② 種類ごとの欄 -->
        <form v-else class="ta-form" @submit.prevent="!visibilityChoice && submit(false)">
          <div class="ta-h">
            <button v-if="!startKind" type="button" class="ta-back" aria-label="種類を選び直す" @click="back">‹</button>
            <b>{{ kindInfo?.icon }} {{ kindInfo?.label }}</b>
            <button type="button" class="ta-x" @click="emit('close')">やめる</button>
          </div>
          <input v-model="name" type="text" class="ta-in" :maxlength="kind === 'checklist' || kind === 'routine' ? CL_NAME_MAX : TASK_TEXT_MAX"
            :aria-label="kind === 'checklist' ? 'チェック表の名前' : 'やること'"
            :placeholder="{ task: '例：揚げ油の交換', checklist: '例：閉店チェック', routine: '例：冷蔵庫の温度', progress: '例：製氷機の修理の手配', someday: '例：倉庫の棚の整理' }[kind]" />

          <!-- チェック表: 確かめること -->
          <template v-if="kind === 'checklist'">
            <span class="ta-lbl">確かめること</span>
            <ol class="ta-items">
              <li v-for="(it, i) in items" :key="it.id">
                <span>{{ it.text }}</span>
                <button type="button" :aria-label="`${it.text}を上へ`" :disabled="i === 0" @click="moveItem(i, -1)">↑</button>
                <button type="button" :aria-label="`${it.text}を消す`" @click="removeItem(it.id)">✕</button>
              </li>
            </ol>
            <div class="ta-add">
              <input v-model="itemDraft" type="text" class="ta-in" :maxlength="CL_ITEM_MAX" aria-label="項目" placeholder="項目を足す（例：ガスの元栓）" @keydown.enter.prevent="addItem" />
              <button type="button" class="ta-mini" :disabled="!itemDraft.trim()" @click="addItem">足す</button>
            </div>
            <div class="ta-seg" role="radiogroup" aria-label="いつ">
              <button type="button" role="radio" :aria-checked="once" :class="{ on: once }" @click="once = true">1回</button>
              <button type="button" role="radio" :aria-checked="!once" :class="{ on: !once }" @click="once = false">繰り返す</button>
            </div>
          </template>

          <!-- 日付と時刻（1回のもの） -->
          <div v-if="kind === 'task' || (kind === 'checklist' && once)" class="ta-row">
            <label>日付<input v-model="day" type="date" class="ta-in" :min="today" /></label>
            <label>時刻（任意）<input v-model="time" type="time" class="ta-in" /></label>
          </div>
          <template v-if="kind === 'task'">
            <label v-if="time" class="ta-lb">終わり（任意・予定ボードで帯になる）<input v-model="endTime" type="time" class="ta-in" :min="time" aria-label="終わりの時刻" /></label>
            <div class="ta-seg" role="radiogroup" aria-label="種類（色）">
              <button v-for="c in CATS" :key="c[0]" type="button" role="radio" :aria-checked="category === c[0]" :class="['cat', c[0] || 'task', { on: category === c[0] }]" @click="category = c[0]">{{ c[1] }}</button>
            </div>
          </template>

          <!-- 繰り返す -->
          <template v-if="repeating">
            <div class="ta-seg" role="radiogroup" aria-label="繰り返し">
              <button v-for="r in [['daily', '毎日'], ['weekly', '曜日'], ['monthly', '毎月']]" :key="r[0]" type="button" role="radio"
                :aria-checked="repeat === r[0]" :class="{ on: repeat === r[0] }" @click="repeat = r[0]">{{ r[1] }}</button>
            </div>
            <div v-if="repeat === 'weekly'" class="ta-seg">
              <button v-for="(w, d) in WEEK" :key="d" type="button" :class="{ on: weekdays.includes(d) }" :aria-pressed="weekdays.includes(d)" @click="toggleWeekday(d)">{{ w }}</button>
            </div>
            <div v-if="repeat === 'monthly'" class="ta-seg">
              <button v-for="d in monthDays" :key="d" type="button" class="on" @click="monthDays = monthDays.filter(x => x !== d)">{{ d === 'L' ? '月末' : `${d}日` }} ✕</button>
              <select v-model="dayDraft" class="ta-in ta-sm" aria-label="足す日"><option v-for="n in 31" :key="n" :value="String(n)">{{ n }}日</option></select>
              <button type="button" @click="addMonthDay">＋ 日</button>
              <button type="button" :class="{ on: monthDays.includes('L') }" @click="toggleMonthEnd">月末</button>
            </div>
            <span class="ta-lbl">時刻（任意・1日に何回でも）</span>
            <div class="ta-seg">
              <button v-for="t in times" :key="t" type="button" class="on" :aria-label="`${t}を外す`" @click="removeTime(t)">{{ t }} ✕</button>
              <input v-model="timeDraft" type="time" class="ta-in ta-sm" aria-label="足す時刻" />
              <button type="button" :disabled="!timeDraft" @click="addTime">＋ 時刻</button>
            </div>
          </template>

          <!-- 進行中: 期限 -->
          <template v-if="kind === 'progress'">
            <label class="ta-lb">期限（任意）<input v-model="deadline" type="date" class="ta-in" :min="today" /></label>
            <p class="ta-note pg">⏳ 済むまで毎日「進行中」に出ます。止まったらアプリが知らせます</p>
          </template>

          <label v-if="hasStaff" class="ta-lb">担当
            <select v-model="who" class="ta-in">
              <option value="all">全員</option>
              <option v-for="p in people" :key="p.id" :value="`p:${p.id}`">{{ p.name }}{{ isMeId(p.id) ? '（自分）' : '' }}</option>
            </select>
          </label>

          <template v-if="kind === 'task' || kind === 'progress' || kind === 'someday'">
            <textarea v-if="noteOpen" v-model="note" rows="2" :maxlength="TASK_NOTE_MAX" class="ta-in ta-memo" aria-label="備考" placeholder="備考（細かいこと・手順・連絡先など）"></textarea>
            <button v-else type="button" class="ta-link" @click="noteOpen = true">＋ 備考</button>
          </template>

          <p v-if="sentence" class="ta-note">{{ sentence }}</p>
          <p v-if="kind === 'routine'" class="ta-sub">項目に✓を付けたいときは <b>📋 チェック表</b> で作ります</p>
          <label v-if="canAddTemplate" class="ta-fav-chk"><input v-model="fav" type="checkbox" /> ★ お気に入りにも入れる</label>
          <p v-if="err" class="ta-err" role="alert">{{ err }}</p>

          <div v-if="visibilityChoice" class="ta-acts">
            <button type="button" class="ta-save" :disabled="!canSubmit" @click="submit(false)">みんなに見せて追加</button>
            <button type="button" class="ta-save admins" :disabled="!canSubmit" @click="submit(true)">🔒 管理者だけで追加</button>
          </div>
          <button v-else type="submit" class="ta-save" :disabled="!canSubmit">
            {{ kind === 'progress' ? '進行中として追加' : kind === 'checklist' ? `追加（${items.length}項目）` : '追加' }}
          </button>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.ta-bg { position: fixed; inset: 0; z-index: 130; background: rgba(6,34,43,.4); display: flex; align-items: flex-end; justify-content: center; }
.ta { width: 100%; max-width: 600px; max-height: 92dvh; overflow-y: auto; background: var(--surface, #fff); border-radius: 20px 20px 0 0;
  padding: 16px 16px calc(18px + env(safe-area-inset-bottom)); display: grid; gap: 10px; box-sizing: border-box; }
.ta-form { display: grid; gap: 10px; }
.ta-h { display: flex; align-items: center; gap: 6px; }
.ta-h b { flex: 1; font-size: 16px; }
.ta-x { border: none; background: none; color: var(--text-muted); font-weight: 700; font-size: 13px; cursor: pointer; min-height: 40px; padding: 0 4px; }
.ta-back { border: none; background: var(--bg, #f3f6f8); border-radius: 8px; width: 34px; height: 34px; font-size: 18px; cursor: pointer; color: var(--text); }
.ta-kinds { display: grid; gap: 7px; }
.ta-kind { display: flex; gap: 10px; align-items: center; text-align: left; border: 1.5px solid var(--border); background: var(--surface); border-radius: 14px; padding: 10px 12px; cursor: pointer; font: inherit; color: var(--text); }
.ta-kind:active { background: var(--bg, #f3f6f8); }
.ta-kind em { font-style: normal; font-size: 22px; width: 32px; text-align: center; flex: none; }
.ta-kind b { display: block; font-size: 14.5px; }
.ta-kind small { font-size: 11.5px; color: var(--text-muted); font-weight: 700; line-height: 1.45; }
.ta-favh { display: flex; justify-content: space-between; align-items: center; font-size: 11.5px; font-weight: 800; color: var(--text-muted); }
.ta-favs { display: flex; flex-wrap: wrap; gap: 6px; }
.ta-fav { display: inline-flex; align-items: center; gap: 4px; border: 1.5px solid #fcd34d; background: #fffbeb; color: #78350f; border-radius: 999px; padding: 6px 11px; font: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer; }
.ta-fav i { font-style: normal; font-size: 10px; color: #d97706; }
.ta-fav.checklist { border-color: #c4b5fd; background: #f5f3ff; color: #4c1d95; }
.ta-fav.routine { border-color: #99f6e4; background: #f0fdfa; color: #134e4a; }
.ta-empty { margin: 0; font-size: 12px; color: var(--text-muted); line-height: 1.6; }
.ta-link { border: none; background: none; color: var(--primary, #0e7490); font: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer; padding: 4px 0; justify-self: start; }
.ta-in { width: 100%; min-height: 42px; border: 1px solid var(--border); border-radius: 10px; padding: 0 10px; font: inherit; font-size: 15px; background: var(--surface); color: var(--text); box-sizing: border-box; }
.ta-sm { width: auto; min-height: 36px; font-size: 13px; }
.ta-memo { padding: 8px 10px; min-height: 60px; resize: vertical; }
.ta-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.ta-row label, .ta-lb { display: grid; gap: 3px; font-size: 11.5px; font-weight: 800; color: var(--text-muted); }
.ta-lbl { font-size: 11.5px; font-weight: 800; color: var(--text-muted); }
.ta-items { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.ta-items li { display: flex; align-items: center; gap: 6px; border: 1px solid var(--border); border-radius: 9px; padding: 4px 6px 4px 10px; font-size: 13.5px; font-weight: 700; }
.ta-items li span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.ta-items li span::before { content: '☐ '; color: #7c3aed; }
.ta-items li button { border: none; background: none; color: var(--text-muted); font-size: 14px; min-width: 32px; min-height: 32px; cursor: pointer; }
.ta-items li button:disabled { opacity: .3; }
.ta-add { display: flex; gap: 6px; }
.ta-mini { flex: none; min-height: 42px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text); font-weight: 800; padding: 0 14px; cursor: pointer; }
.ta-mini:disabled { opacity: .5; }
.ta-seg { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.ta-seg button { border: 1px solid var(--border); background: var(--surface); border-radius: 9px; padding: 7px 11px; font: inherit; font-size: 12.5px; font-weight: 800; color: var(--text-muted); cursor: pointer; }
.ta-seg button.on { background: #4f46e5; border-color: #4f46e5; color: #fff; }
.ta-seg button:disabled { opacity: .5; }
.ta-seg button.cat.on.task { background: #0e7490; border-color: #0e7490; }
.ta-seg button.cat.on.prep { background: #7c3aed; border-color: #7c3aed; }
.ta-seg button.cat.on.clean { background: #15803d; border-color: #15803d; }
.ta-seg button.cat.on.order { background: #c2410c; border-color: #c2410c; }
.ta-note { margin: 0; font-size: 12.5px; font-weight: 800; color: var(--primary, #0e7490); background: var(--primary-weak, #ecfeff); border-radius: 10px; padding: 8px 10px; line-height: 1.55; }
.ta-note.pg { color: #b45309; background: #fffbeb; }
.ta-sub { margin: 0; font-size: 12px; color: var(--text-muted); }
.ta-sub b { color: #7c3aed; }
.ta-fav-chk { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 800; color: #78350f; }
.ta-err { margin: 0; font-size: 12.5px; font-weight: 700; color: #b91c1c; }
.ta-acts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ta-save { min-height: 46px; border: none; border-radius: 12px; background: var(--grad-btn); color: #08323c; font-weight: 800; font-size: 14.5px; cursor: pointer; }
.ta-save:disabled { opacity: .5; }
.ta-save.admins { background: #475569; color: #fff; }
</style>
