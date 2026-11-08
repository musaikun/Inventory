<script setup>
/**
 * 業務を追加する、ただ1つの入口（User決定 2026-11-07・キャンバス「業務の追加」①。2026-11-05 の「まず種類を選ぶ」を置き換えた）。
 * 種類は選ばない。入れた中身で決まり、上に出す:
 *   日付なし → いつか ／ 今日 → 本日 ／ 先の日 → 予定 ／ 締め切りあり → 「m/dまで」（進行中・始める日から毎日。日付なしで締め切りだけなら今日から・User決定 2026-11-07）／ 繰り返しあり → 繰り返し
 * 欄は行で並べ、押すとその場で開く（日付・締め切りは月のカレンダー、繰り返しはつながった切り替え、担当・チェック表は一覧）。説明の文は置かない。
 * チェック表（項目のひな形）は別の入口で作り、ここでは選んで付けるだけ。付けると:
 *   本日・予定 → その日の1回きりのチェック表 ／ 繰り返し → 毎回その項目 ／ 締め切り・いつか → 子タスク
 */
import LineIcon from './LineIcon.vue'
import TimeGrid from './TimeGrid.vue'
import { useHorizontalSwipe } from '../composables/useSwipe.js'
import { ref, computed, onUnmounted } from 'vue'
import { addTask, TASK_TEXT_MAX, TASK_NOTE_MAX } from '../composables/useTasks.js'
import { saveChecklist, newItemId, CL_NAME_MAX } from '../composables/useChecklists.js'
import { checklistTemplates } from '../composables/useTemplates.js'
import { staffNames, isAdmin } from '../composables/useAuth.js'
import { isMeId } from '../composables/useDeviceId.js'
import { localDateKey } from '../utils/localDate.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'
import { useListDragReorder } from '../composables/useListDragReorder.js'

const props = defineProps({
  date: { type: String, default: '' },        // 既定の日（空なら今日）
  startKind: { type: String, default: '' },   // 'someday' | 'progress' | 'task'（開いたときの形）
  template: { type: Object, default: null },  // ★ お気に入りから開く
  checklist: { type: Object, default: null }, // チェック表（ひな形）を付けて開く
  presetTime: { type: String, default: '' },  // 予定ボードのマスから（始まりの時刻）
  presetWho: { type: String, default: '' },   // 予定ボードのマスから（'all' | 'p:<id>'）
})
const emit = defineEmits(['close', 'added', 'templates'])

const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const today = localDateKey()
const _md = k => { const d = new Date(k + 'T00:00:00'); return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）` }
const _dayLabel = k => (k === today ? '今日' : k === localDateKey(new Date(Date.now() + 86400_000)) ? '明日' : _md(k))

const name = ref(''), note = ref('')
const day = ref(props.date && props.date >= today ? props.date : today)
const time = ref(''), endTime = ref('')
const deadline = ref('')
const repeat = ref('none'), weekdays = ref([]), monthDays = ref([])
const who = ref('all')
const items = ref([]), itemsName = ref('')   // 付けたチェック表の項目と名前
const adminsOnly = ref(false)
const open = ref('')                         // 開いている行
const err = ref(''), busy = ref(false)

const people = computed(() => staffNames.value)
const hasStaff = computed(() => people.value.some(p => !p.owner))
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
if (props.startKind === 'someday') day.value = ''
if (props.startKind === 'progress') open.value = 'deadline'

function _setItems(src, label) {
  items.value = (src ?? []).map(x => ({ id: newItemId(), text: x.text }))
  itemsName.value = items.value.length ? label : ''
}
if (props.checklist) _setItems(props.checklist.data?.items, props.checklist.name)
// ★ お気に入りから: 中身を入れる（日付は今の既定のまま）
if (props.template) {
  const t = props.template, d = t.data ?? {}
  name.value = t.name
  note.value = d.note ?? ''
  time.value = d.dueTime ?? d.dueTimes?.[0] ?? ''
  if (d.items?.length) _setItems(d.items, t.name)
  if (d.repeat && d.repeat !== 'none') {
    repeat.value = d.repeat
    if (d.repeat === 'weekly') weekdays.value = String(d.repeatDays ?? '').split(',').filter(Boolean).map(Number)
    if (d.repeat === 'monthly') monthDays.value = String(d.repeatDays ?? '').split(',').filter(Boolean)
  } else if (t.kind === 'routine') repeat.value = 'daily'
  if (t.kind === 'someday') day.value = ''
  if (t.kind === 'progress') open.value = 'deadline'
  if (d.assign?.mode === 'person' && people.value.some(p => p.id === d.assign.id)) who.value = `p:${d.assign.id}`
  else if (d.assign) who.value = 'all'
}

// ── 閉じる前の確認（入力中なら。外を触っただけで消えないように・User 2026-11-08）──
// 開いたときの中身を控えて、変わっていれば確かめる。担当は後から既定が入ることがあるので見ない
const _form = () => JSON.stringify([name.value.trim(), note.value.trim(), day.value, time.value, endTime.value, deadline.value,
  repeat.value, weekdays.value, monthDays.value, items.value.map(x => x.text), adminsOnly.value])
const _snap = _form()
function tryClose() {
  if (_form() !== _snap && !window.confirm('入力中の業務を捨てて閉じますか？')) return
  emit('close')
}

// ── 種類（入れた中身で決まる）──
const kind = computed(() => {
  if (repeat.value !== 'none') return { k: 'repeat', label: '繰り返し' }
  if (deadline.value) return { k: 'progress', label: `${_md(deadline.value).replace(/（.）/, '')}まで` }
  if (!day.value) return { k: 'someday', label: 'いつか' }
  if (day.value === today) return { k: 'today', label: '本日' }
  return { k: 'plan', label: '予定' }
})

// ── 月のカレンダー（日付・締め切り）──
const calYm = ref({ y: 0, m: 0 })
function openCal(id) {
  const base = (id === 'deadline' ? deadline.value || day.value : day.value) || today
  const d = new Date(base + 'T00:00:00')
  calYm.value = { y: d.getFullYear(), m: d.getMonth() }
}
// カレンダーは左右に払っても月が変わる（User決定 2026-11-07）
const calSwipe = useHorizontalSwipe({ onLeft: () => stepCal(1), onRight: () => stepCal(-1), threshold: 40 })
// 時刻は端末の時計を重ねず、このモーダルの中で 始まり／終わり を押して選ぶ（User決定 2026-11-07）
const timeEnd = ref('start')   // 'start' | 'end'
function onStartPicked() { if (endTime.value && endTime.value <= time.value) endTime.value = ''; timeEnd.value = 'end' }
function stepCal(n) { const d = new Date(calYm.value.y, calYm.value.m + n, 1); calYm.value = { y: d.getFullYear(), m: d.getMonth() } }
const calCells = computed(() => {
  const { y, m } = calYm.value
  const first = new Date(y, m, 1).getDay(), last = new Date(y, m + 1, 0).getDate()
  const sel = open.value === 'deadline' ? deadline.value : day.value
  const min = open.value === 'deadline' ? (day.value || today) : today
  const out = []
  for (let i = 0; i < first; i++) out.push({ key: `b${i}` })
  for (let d = 1; d <= last; d++) {
    const k = localDateKey(new Date(y, m, d))
    out.push({ key: k, d, on: k === sel, today: k === today, off: k < min || (open.value === 'deadline' && k === min) })
  }
  return out
})
function pickDay(c) {
  if (c.off) return
  if (open.value === 'deadline') deadline.value = c.key
  else {
    day.value = c.key
    if (deadline.value && deadline.value <= c.key) deadline.value = ''
    if (repeat.value === 'weekly' && !weekdays.value.length) weekdays.value = [new Date(c.key + 'T00:00:00').getDay()]
  }
  open.value = ''
}
function toggleRow(id) {
  open.value = open.value === id ? '' : id
  if (id === 'day' || id === 'deadline') openCal(id)
  if (id === 'time') timeEnd.value = 'start'
}
function clearDay() { day.value = ''; repeat.value = 'none'; time.value = ''; endTime.value = ''; open.value = '' }   // 締め切りは残す（締め切りだけの進行中）
function clearDeadline() { deadline.value = ''; open.value = '' }

// ── 繰り返し ──
function setRepeat(r) {
  repeat.value = r
  if (r !== 'none') deadline.value = ''
  const d = new Date((day.value || today) + 'T00:00:00')
  if (r === 'weekly' && !weekdays.value.length) weekdays.value = [d.getDay()]
  if (r === 'monthly' && !monthDays.value.length) monthDays.value = [String(d.getDate())]
}
function toggleWeekday(w) { weekdays.value = weekdays.value.includes(w) ? weekdays.value.filter(x => x !== w) : [...weekdays.value, w].sort() }
const _mdSort = a => [...new Set(a)].sort((x, y) => (x === 'L' ? 99 : Number(x)) - (y === 'L' ? 99 : Number(y)))
function toggleMonthDay(v) { monthDays.value = monthDays.value.includes(v) ? monthDays.value.filter(x => x !== v) : _mdSort([...monthDays.value, v]) }
const repeatDays = computed(() => (repeat.value === 'weekly' ? weekdays.value.join(',') : repeat.value === 'monthly' ? monthDays.value.join(',') : null))
const repeatOk = computed(() => repeat.value === 'daily' || (repeat.value === 'weekly' && weekdays.value.length) || (repeat.value === 'monthly' && monthDays.value.length))
const repeatLabel = computed(() => {
  if (repeat.value === 'daily') return '毎日'
  if (repeat.value === 'weekly') return weekdays.value.length ? `毎週 ${weekdays.value.map(d => WEEK[d]).join('・')}` : '毎週'
  if (repeat.value === 'monthly') return monthDays.value.length ? `毎月 ${monthDays.value.map(d => (d === 'L' ? '月末' : `${d}日`)).join('・')}` : '毎月'
  return 'しない'
})

// ── 行 ──
const whoName = computed(() => (who.value.startsWith('p:') ? (people.value.find(p => p.id === who.value.slice(2))?.name || '') : '全員'))
const rows = computed(() => [
  { id: 'day', icon: 'date', color: '#0e7490', label: '日付', value: day.value ? _dayLabel(day.value) : 'なし', set: !!day.value },
  ...(day.value ? [{ id: 'time', icon: 'timer', color: '#0369a1', label: '時刻', value: time.value ? `${time.value}${endTime.value ? `〜${endTime.value}` : ''}` : 'なし', set: !!time.value }] : []),
  ...(repeat.value === 'none' ? [{ id: 'deadline', icon: 'hourglass', color: '#ca8a04', label: '締め切り', value: deadline.value ? _dayLabel(deadline.value) : 'なし', set: !!deadline.value }] : []),
  ...(day.value && !deadline.value ? [{ id: 'repeat', icon: 'repeat', color: '#059669', label: '繰り返し', value: repeatLabel.value, set: repeat.value !== 'none' }] : []),
  ...(hasStaff.value ? [{ id: 'who', icon: 'user', color: '#7c3aed', label: '担当', value: whoName.value, set: true }] : []),
  { id: 'list', icon: 'clipboard', color: '#db2777', label: 'チェック表', value: itemsName.value || 'なし', set: !!itemsName.value },
  ...(isAdmin.value && repeat.value === 'none' && !(items.value.length && day.value && !deadline.value) ? [{ id: 'vis', icon: 'eye', color: '#475569', label: '見せる人', value: adminsOnly.value ? '管理者だけ' : 'みんな', set: adminsOnly.value }] : []),
])
const modalTitle = computed(() => rows.value.find(r => r.id === open.value)?.label || '')
function pickWho(v) { who.value = v; open.value = '' }
// 付けたチェック表の項目を、この業務の中だけで並べ替える（⋮⋮ を長押し・上下キー。ひな形は変えない・User 2026-11-08）
const itemsEl = ref(null)
const itemDrag = useListDragReorder({
  listEl: itemsEl,
  rowSelector: '.ta-it',
  keyAttr: 'id',
  currentOrder: () => items.value.map(x => x.id),
  commitOrder: ids => {
    const by = new Map(items.value.map(x => [x.id, x]))
    items.value = ids.map(id => by.get(id)).filter(Boolean)
  },
})
function onItemDown(e) { if (e.target.closest?.('.ta-handle')) itemDrag.onDown(e) }
onUnmounted(() => itemDrag.cleanup())
function pickList(t) { if (t) _setItems(t.data?.items, t.name); else _setItems([], ''); open.value = '' }

// ── 足す ──
const canSubmit = computed(() => !!name.value.trim() && !busy.value && (repeat.value === 'none' || repeatOk.value))
function _assignTask() {
  const v = who.value
  return v.startsWith('p:') ? { mode: 'person', id: v.slice(2), name: whoName.value } : { mode: hasStaff.value ? 'all' : 'anyone' }
}
function _assignChecklist() {
  const v = who.value
  return v.startsWith('p:') ? { assign: 'person', assigneeId: v.slice(2), assigneeName: whoName.value } : { assign: 'anyone', assigneeId: null, assigneeName: null }
}
async function submit() {
  if (!canSubmit.value) { if (!name.value.trim()) err.value = '名前を入れてください'; return }
  err.value = ''
  const text = name.value.trim()
  const k = kind.value.k
  const visibility = adminsOnly.value ? 'admins' : null
  busy.value = true
  try {
    if (k === 'repeat' || ((k === 'today' || k === 'plan') && items.value.length)) {
      await saveChecklist({
        name: text.slice(0, CL_NAME_MAX), items: items.value,
        repeat: k === 'repeat' ? repeat.value : 'none',
        repeatDays: k === 'repeat' ? repeatDays.value : null,
        startDate: k === 'repeat' ? undefined : day.value,
        dueTimes: time.value ? [time.value] : [],
        ..._assignChecklist(),
      })
    } else {
      const steps = items.value.map(x => ({ text: x.text }))
      const ok = k === 'someday'
        ? addTask('', text, _assignTask(), null, { visibility, note: note.value, steps })
        : k === 'progress'
          ? addTask(day.value || today, text, _assignTask(), null, { visibility, progress: 'doing', deadline: deadline.value, note: note.value, steps })
          : addTask(day.value, text, _assignTask(), time.value || null, { visibility, note: note.value, endTime: time.value && endTime.value > time.value ? endTime.value : null })
      if (!ok) throw new Error('足せませんでした')
    }
    emit('added', { kind: k, name: text })
    emit('close')
  } catch (e) {
    err.value = e?.message || '保存できませんでした'
  } finally {
    busy.value = false
  }
}

onUnmounted(registerInnerLayerCloser(() => { if (open.value) { open.value = ''; return true } tryClose(); return true }))
</script>

<template>
  <Teleport to="body">
    <div class="ta-bg" @click.self="tryClose">
      <form class="ta" role="dialog" aria-label="業務を追加" @submit.prevent="submit">
        <div class="ta-h">
          <button type="button" class="ta-x" @click="tryClose">やめる</button>
          <span :key="kind.label" :class="['ta-kind', kind.k]" data-test="kind">{{ kind.label }}</span>
          <button type="submit" class="ta-go" :disabled="!canSubmit">追加</button>
        </div>

        <div class="ta-card">
          <input v-model="name" type="text" class="ta-name" :maxlength="TASK_TEXT_MAX" aria-label="名前" placeholder="名前" />
          <i class="ta-hr"></i>
          <input v-model="note" type="text" class="ta-memo" :maxlength="TASK_NOTE_MAX" aria-label="メモ" placeholder="メモ" />
        </div>

        <div class="ta-card">
          <template v-for="r in rows" :key="r.id">
            <button type="button" class="ta-row" aria-haspopup="dialog" :data-row="r.id" @click="toggleRow(r.id)">
              <span class="ta-ic" :style="{ background: r.color }"><LineIcon :name="r.icon" size="17" /></span>
              <span class="ta-lb">{{ r.label }}</span>
              <span :class="['ta-v', { set: r.set }]">{{ r.value }}</span>
            </button>

            <ul v-if="r.id === 'list' && items.length" :ref="el => { itemsEl = el }" class="ta-items"
              @pointerdown="onItemDown" @pointermove="itemDrag.onMove" @pointerup="itemDrag.onUp"
              @pointercancel="itemDrag.onUp" @lostpointercapture="itemDrag.onUp" @touchmove="itemDrag.onTouchMove">
              <li v-for="(it, i) in items" :key="it.id" :data-id="it.id" :class="['ta-it', { many: items.length > 1 }]">
                <button v-if="items.length > 1" type="button" class="ta-handle" :aria-label="`${it.text} を運ぶ。現在 ${i + 1} 番目。上下矢印キーで移動`" @keydown="itemDrag.onKeydown($event, it.id)">⋮⋮</button>
                <span>{{ it.text }}</span>
              </li>
            </ul>
          </template>
        </div>

        <!-- 行の中身はモーダルで選ぶ（一覧の中で開くと見づらい・User決定 2026-11-07） -->
        <div v-if="open" class="ta-mbg" @click.self="open = ''">
          <section class="ta-modal" role="dialog" :aria-label="modalTitle">
            <div class="ta-mh"><b>{{ modalTitle }}</b><button type="button" class="ta-done" @click="open = ''">完了</button></div>
              <div v-if="open === 'day' || open === 'deadline'" class="ta-cal">
                <div class="ta-cal-h"><b>{{ calYm.y }}年{{ calYm.m + 1 }}月</b><button type="button" aria-label="前の月" @click="stepCal(-1)">‹</button><button type="button" aria-label="次の月" @click="stepCal(1)">›</button></div>
                <div class="ta-cal-g" @touchstart.passive="calSwipe.onTouchStart" @touchmove.passive="calSwipe.onTouchMove" @touchend.passive="calSwipe.onTouchEnd" @touchcancel.passive="calSwipe.onTouchCancel">
                  <span v-for="w in WEEK" :key="w" class="wd">{{ w }}</span>
                  <template v-for="c in calCells" :key="c.key">
                    <span v-if="!c.d"></span>
                    <button v-else type="button" :class="['d', { on: c.on, today: c.today }]" :disabled="c.off" :data-day="c.key" @click="pickDay(c)">{{ c.d }}</button>
                  </template>
                </div>
                <button v-if="open === 'day' && day" type="button" class="ta-clear" @click="clearDay">日付なし（いつか）にする</button>
                <button v-if="open === 'deadline' && deadline" type="button" class="ta-clear" @click="clearDeadline">締め切りを外す</button>
              </div>

              <div v-if="open === 'time'" class="ta-tm">
                <div class="ta-seg" role="tablist" aria-label="始まり・終わり">
                  <button type="button" role="tab" :aria-selected="timeEnd === 'start'" :class="{ on: timeEnd === 'start' }" data-time="start" @click="timeEnd = 'start'">始まり <b>{{ time || '—' }}</b></button>
                  <button type="button" role="tab" :aria-selected="timeEnd === 'end'" :class="{ on: timeEnd === 'end' }" :disabled="!time" data-time="end" @click="timeEnd = 'end'">終わり <b>{{ endTime || 'なし' }}</b></button>
                </div>
                <TimeGrid v-if="timeEnd === 'start'" v-model="time" @done="onStartPicked" />
                <TimeGrid v-else v-model="endTime" :min="time" @done="open = ''" />
                <div class="ta-tm-f">
                  <button v-if="timeEnd === 'end' && endTime" type="button" class="ta-clear" @click="endTime = ''">終わりを外す</button>
                  <button v-if="time" type="button" class="ta-clear" @click="time = ''; endTime = ''; open = ''">時刻を外す</button>
                </div>
              </div>

              <div v-if="open === 'repeat'" class="ta-sub">
                <div class="ta-seg" role="radiogroup" aria-label="繰り返し">
                  <button v-for="x in [['none', 'しない'], ['daily', '毎日'], ['weekly', '毎週'], ['monthly', '毎月']]" :key="x[0]" type="button" role="radio" :aria-checked="repeat === x[0]" :class="{ on: repeat === x[0] }" @click="setRepeat(x[0])">{{ x[1] }}</button>
                </div>
                <div v-if="repeat === 'weekly'" class="ta-seg">
                  <button v-for="(w, i) in WEEK" :key="w" type="button" :aria-pressed="weekdays.includes(i)" :class="{ on: weekdays.includes(i) }" @click="toggleWeekday(i)">{{ w }}</button>
                </div>
                <div v-if="repeat === 'monthly'" class="ta-mdays">
                  <button v-for="n in 31" :key="n" type="button" :aria-pressed="monthDays.includes(String(n))" :class="{ on: monthDays.includes(String(n)) }" @click="toggleMonthDay(String(n))">{{ n }}</button>
                  <button type="button" class="end" :aria-pressed="monthDays.includes('L')" :class="{ on: monthDays.includes('L') }" @click="toggleMonthDay('L')">月末</button>
                </div>
              </div>

              <div v-if="open === 'who'" class="ta-list">
                <button type="button" @click="pickWho('all')"><i class="av all">全</i><span>全員</span><b v-if="who === 'all'">✓</b></button>
                <button v-for="p in people" :key="p.id" type="button" @click="pickWho(`p:${p.id}`)"><i class="av">{{ (p.name || '?').slice(0, 1) }}</i><span>{{ p.name }}</span><b v-if="who === `p:${p.id}`">✓</b></button>
              </div>

              <div v-if="open === 'list'" class="ta-list">
                <button type="button" @click="pickList(null)"><span>なし</span><b v-if="!itemsName">✓</b></button>
                <button v-for="t in checklistTemplates" :key="t.id" type="button" @click="pickList(t)">
                  <span class="tl"><span>{{ t.name }}</span><small>{{ t.data.items.map(x => x.text).join('・') }}</small></span><b v-if="itemsName === t.name">✓</b>
                </button>
                <button type="button" class="ta-manage" @click="emit('templates')"><LineIcon name="pencil" size="15" /><span>チェック表を作る・直す</span></button>
              </div>
              <div v-if="open === 'vis'" class="ta-sub">
                <div class="ta-seg" role="radiogroup" aria-label="見せる人">
                  <button type="button" role="radio" :aria-checked="!adminsOnly" :class="{ on: !adminsOnly }" @click="adminsOnly = false; open = ''">みんな</button>
                  <button type="button" role="radio" :aria-checked="adminsOnly" :class="{ on: adminsOnly }" @click="adminsOnly = true; open = ''">管理者だけ</button>
                </div>
              </div>
          </section>
        </div>
        <p v-if="err" class="ta-err" role="alert">{{ err }}</p>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.ta-bg { position: fixed; inset: 0; z-index: 130; background: rgba(6,34,43,.45); display: flex; align-items: flex-end; justify-content: center; }
.ta { width: 100%; max-width: 600px; max-height: 92dvh; overflow-y: auto; background: #f3f7f9; border-radius: 22px 22px 0 0;
  padding: 12px 14px calc(18px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; }
.ta-h { display: flex; align-items: center; min-height: 44px; }
.ta-x, .ta-go { flex: none; min-width: 64px; min-height: 44px; border: none; background: none; font: inherit; font-size: 15px; cursor: pointer; }
.ta-x { color: var(--text-muted); font-weight: 700; text-align: left; }
.ta-go { color: var(--primary, #0e7490); font-weight: 900; text-align: right; }
.ta-go:disabled { opacity: .4; cursor: default; }
.ta-kind { margin: 0 auto; display: inline-flex; align-items: center; height: 30px; padding: 0 14px; border-radius: 999px; font-size: 13.5px; font-weight: 900; animation: ta-pop .2s ease-out; }
.ta-kind.someday { background: #eef2ff; color: #4338ca; }
.ta-kind.today { background: #e0f2fe; color: #0369a1; }
.ta-kind.plan { background: #e6f5f8; color: #0b5f73; }
.ta-kind.progress { background: #fef9c3; color: #a16207; }
.ta-kind.repeat { background: #ecfdf5; color: #047857; }
@keyframes ta-pop { from { transform: scale(.85); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .ta-kind { animation: none; } }
.ta-card { background: var(--surface, #fff); border-radius: 16px; overflow: hidden; }
.ta-name, .ta-memo { width: 100%; box-sizing: border-box; border: none; background: transparent; padding: 0 16px; font: inherit; color: var(--text); }
.ta-name { height: 54px; font-size: 17px; font-weight: 800; }
.ta-memo { height: 44px; font-size: 14px; }
.ta-name:focus, .ta-memo:focus { outline: none; }
.ta-hr { display: block; height: 1px; background: #eef2f4; margin-left: 16px; }
.ta-row { width: 100%; display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 0 16px; border: none; border-top: 1px solid #eef2f4; background: var(--surface, #fff); font: inherit; color: var(--text); cursor: pointer; text-align: left; }
.ta-card > .ta-row:first-child { border-top: none; }

.ta-ic { flex: none; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; color: #fff; }
.ta-lb { flex: 1; font-size: 15px; font-weight: 700; }
.ta-v { font-size: 14.5px; font-weight: 600; color: #8aa0a8; }
.ta-v.set { font-weight: 800; color: var(--primary, #0e7490); }
.ta-mbg { position: fixed; inset: 0; z-index: 140; background: rgba(6,34,43,.35); display: flex; align-items: flex-end; justify-content: center; }
.ta-modal { width: 100%; max-width: 600px; max-height: 80dvh; overflow-y: auto; box-sizing: border-box; background: var(--surface, #fff); border-radius: 20px 20px 0 0; padding: 8px 0 calc(16px + env(safe-area-inset-bottom)); animation: ta-up .2s ease-out; }
@keyframes ta-up { from { transform: translateY(30px); opacity: 0; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .ta-modal { animation: none; } }
.ta-mh { display: flex; align-items: center; min-height: 48px; padding: 0 8px 0 16px; border-bottom: 1px solid #eef2f4; margin-bottom: 6px; }
.ta-mh b { flex: 1; font-size: 16px; }
.ta-done { min-width: 64px; min-height: 44px; border: none; background: none; font: inherit; font-size: 15px; font-weight: 900; color: var(--primary, #0e7490); cursor: pointer; }
.ta-cal { padding: 4px 14px 12px; display: grid; gap: 6px; }
.ta-cal-h { display: flex; align-items: center; gap: 4px; }
.ta-cal-h b { flex: 1; font-size: 14px; }
.ta-cal-h button { width: 40px; height: 36px; border: none; background: none; font-size: 20px; font-weight: 800; color: var(--primary, #0e7490); cursor: pointer; }
.ta-cal-g { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; text-align: center; }
.ta-cal-g .wd { font-size: 11px; font-weight: 800; color: #8aa0a8; padding: 4px 0; }
.ta-cal-g .d { height: 38px; border: none; border-radius: 50%; background: none; font: inherit; font-size: 14px; font-weight: 600; color: var(--text); cursor: pointer; }
.ta-cal-g .d.today { color: var(--primary, #0e7490); font-weight: 900; }
.ta-cal-g .d.on { background: var(--primary, #0e7490); color: #fff; font-weight: 900; }
.ta-cal-g .d:disabled { color: #c9d6db; cursor: default; }
.ta-clear { justify-self: end; border: none; background: none; font: inherit; font-size: 13.5px; font-weight: 800; color: #b91c1c; cursor: pointer; min-height: 36px; }
.ta-tm { display: grid; gap: 10px; padding: 8px 16px 12px; }
.ta-tm .ta-seg button b { font-variant-numeric: tabular-nums; margin-left: 4px; }
.ta-tm .ta-seg button:disabled { opacity: .45; }
.ta-tm-f { display: flex; justify-content: flex-end; gap: 12px; }
.ta-cal-g { touch-action: pan-y; }
.ta-sub { padding: 4px 14px 12px; display: grid; gap: 10px; }
.ta-seg { display: flex; padding: 3px; border-radius: 11px; background: #eef2f4; }
.ta-seg button { flex: 1; min-height: 34px; border: none; border-radius: 9px; background: transparent; font: inherit; font-size: 13.5px; font-weight: 800; color: #5b6f78; cursor: pointer; }
.ta-seg button.on { background: #fff; color: var(--text); box-shadow: 0 1px 3px rgba(16,38,46,.15); }
.ta-mdays { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.ta-mdays button { height: 34px; border: none; border-radius: 50%; background: none; font: inherit; font-size: 13px; font-weight: 700; color: var(--text); cursor: pointer; }
.ta-mdays button.end { grid-column: span 2; border-radius: 999px; font-size: 12.5px; }
.ta-mdays button.on { background: #059669; color: #fff; }
.ta-list { padding-left: 16px; }
.ta-list button { width: 100%; display: flex; align-items: center; gap: 10px; min-height: 46px; padding: 6px 16px 6px 0; border: none; border-top: 1px solid #eef2f4; background: none; font: inherit; font-size: 14.5px; font-weight: 700; color: var(--text); cursor: pointer; text-align: left; }
.ta-list button span { flex: 1; min-width: 0; }
.ta-list .tl { display: flex; flex-direction: column; gap: 1px; }
.ta-list .tl small { font-size: 11.5px; font-weight: 700; color: #8aa0a8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ta-list b { color: var(--primary, #0e7490); }
.ta-list .av { flex: none; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; font-style: normal; font-size: 12px; font-weight: 900; color: #fff; background: #0e7490; }
.ta-list .av.all { background: #94a3b8; }
.ta-list .ta-manage { color: var(--primary, #0e7490); font-weight: 800; }
.ta-none { margin: 0; padding: 10px 16px 12px 0; font-size: 13px; color: #8aa0a8; }
.ta-items { list-style: none; margin: 0; padding: 0 16px 12px 56px; display: grid; gap: 4px; }
.ta-items li { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: #3d545d; }
.ta-items li::before { content: ''; width: 12px; height: 12px; border-radius: 4px; border: 2px solid #9ccfdb; flex: none; }
.ta-items li.many { margin-left: -36px; }
.ta-items li.many::before { display: none; }
.ta-items li.holding { color: var(--primary, #0e7490); }
.ta-items li.drag { background: #fff; border-radius: 10px; box-shadow: 0 8px 20px rgba(6,34,43,.18); position: relative; z-index: 2; }
.ta-handle { flex: none; width: 36px; min-height: 36px; border: none; background: none; color: #8aa0a8; font-size: 15px; letter-spacing: -3px; cursor: grab; touch-action: none; }
.ta-err { margin: 0; font-size: 12.5px; font-weight: 700; color: #b91c1c; }
</style>
