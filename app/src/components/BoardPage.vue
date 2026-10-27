<script setup>
/**
 * 掲示板（以前の「連絡」のトーク。User決定 2026-10-27・キャンバス「日誌カレンダー」⑬）。
 * 返事のいらない貼り紙を置いておく場所。タスクにするかは後で決める。
 * - 付箋のように2列に貼る（新しいものが左上）。少しずつ傾け、浮いた影。新しいもの（まだ見ていない人のもの）は上の縁が光る
 * - 押すと下から開く: 本文・見た人とまだの人・［はがす］（書いた人と管理者）［タスク化］。開くと「見た」になる
 * - タスク化した貼り紙は「✓ タスクにした」。そのタスクが終わったら掲示板から外れる
 * - 2週間より前のものは下にたたむ
 * - はがすは5秒だけ元に戻せる（そのあとでサーバーから消す）
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import TalkTaskSheet from './TalkTaskSheet.vue'
import {
  handoffs, pullHandoffs, tellHandoff, readHandoff, removeHandoff, undoHandoffTask, isReadByMe, isMine, canRemoveHandoff, HANDOFF_BODY_MAX,
} from '../composables/useHandoffs.js'
import { aliveTasks, pullTasks } from '../composables/useTasks.js'
import { can, staffNames, loadStaffNames } from '../composables/useAuth.js'
import { isMeId } from '../composables/useDeviceId.js'
import { localDateKey } from '../utils/localDate.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

const emit = defineEmits(['close'])
const OLD_MS = 14 * 86400_000
const ROT = [-2, 1.5, -1, 2, -1.5, 1]
const today = localDateKey()
const yday = localDateKey(new Date(Date.now() - 86400_000))
const _hm = iso => { const d = new Date(iso); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` }
const _when = iso => {
  if (!iso) return ''
  const d = new Date(iso), k = localDateKey(d)
  return k === today ? _hm(iso) : k === yday ? `昨日 ${_hm(iso)}` : `${d.getMonth() + 1}/${d.getDate()}`
}

let timer = null
onMounted(() => { pullTasks(); pullHandoffs(); loadStaffNames(); timer = setInterval(pullHandoffs, 30000) })
onUnmounted(() => clearInterval(timer))

const taskOf = computed(() => new Map(aliveTasks.value.map(t => [t.id, t])))
const peeling = ref(new Set())   // はがした直後（元に戻せる間）は見せない
const visible = computed(() => handoffs.value.filter(h => {
  if (peeling.value.has(h.id)) return false
  const t = h.taskId ? taskOf.value.get(h.taskId) : null
  return !t?.doneAt   // タスクが終わったら外す
}))
const _old = h => Date.now() - Date.parse(h.createdAt || 0) > OLD_MS
const notes = computed(() => visible.value.filter(h => !_old(h)).map((h, i) => ({
  h, rot: ROT[i % ROT.length], fresh: !isMine(h) && !isReadByMe(h), tasked: !!h.taskId,
})))
const oldNotes = computed(() => visible.value.filter(_old))
const showOld = ref(false)

// 開いた貼り紙
const openId = ref(null)
const cur = computed(() => handoffs.value.find(h => h.id === openId.value) ?? null)
function openNote(h) {
  openId.value = h.id
  if (!isMine(h)) readHandoff(h)
}
const seen = computed(() => {
  const h = cur.value
  if (!h) return { read: [], unread: [] }
  const read = [...(h.reads ?? [])].sort((a, b) => (a.at || '').localeCompare(b.at || ''))
  const ids = new Set(read.map(r => r.id))
  const unread = staffNames.value.filter(p => p.id !== h.byId && !ids.has(p.id) && !(isMeId(p.id) && isMeId(h.byId)))
  return { read, unread }
})
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const _md = k => { const d = new Date(k + 'T00:00:00'); return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）` }
const taskLabel = computed(() => {
  const t = cur.value?.taskId ? taskOf.value.get(cur.value.taskId) : null
  if (!t) return ''
  const who = t.assign === 'person' ? t.assigneeName : t.assign === 'none' ? '' : '誰でも'
  const state = t.progress ? '進行中' : t.deadline ? `期限 ${_md(t.deadline)}` : t.date === today ? '今日' : t.date ? _md(t.date) : 'いつか'
  return [who, state].filter(Boolean).join(' ・ ')
})
const canWrite = computed(() => can('task.create'))

// はがす（5秒は元に戻せる）／タスク化の取り消し
const toast = ref(null)   // { text, undo }
let toastTimer = null
const err = ref('')
function _toast(text, undo, done = null) {
  if (toast.value?.done) toast.value.done()   // 前のはがすを確定させる
  clearTimeout(toastTimer)
  toast.value = { text, undo, done }
  toastTimer = setTimeout(() => { const t = toast.value; toast.value = null; t?.done?.() }, 5000)
}
function peel(h) {
  openId.value = null
  peeling.value = new Set([...peeling.value, h.id])
  const back = () => { const s = new Set(peeling.value); s.delete(h.id); peeling.value = s }
  _toast('はがしました', back, async () => {
    try { await removeHandoff(h) } catch (e) { err.value = e?.message || 'はがせませんでした' }
    back()
  })
}
function doUndo() { const t = toast.value; clearTimeout(toastTimer); toast.value = null; t?.undo?.() }
const tasking = ref(null)
function onTasked(x) {
  tasking.value = null; openId.value = null
  _toast('タスクにしました', () => undoHandoffTask({ ...x.message, taskId: x.task.id }, x.task.id))
}
onUnmounted(() => { clearTimeout(toastTimer); const t = toast.value; toast.value = null; t?.done?.() })

// 貼る
const composing = ref(false)
const draft = ref('')
const busy = ref(false)
async function post() {
  if (!draft.value.trim() || busy.value) return
  busy.value = true; err.value = ''
  try { await tellHandoff(draft.value); draft.value = ''; composing.value = false } catch (e) { err.value = e?.message || '貼れませんでした' } finally { busy.value = false }
}

onUnmounted(registerInnerLayerCloser(() => {
  if (tasking.value) return false
  if (composing.value) { composing.value = false; return true }
  if (openId.value) { openId.value = null; return true }
  emit('close'); return true
}))
</script>

<template>
  <Teleport to="body">
    <div class="bd" role="dialog" aria-label="掲示板">
      <header class="bd-h">
        <svg class="bd-ring" width="220" height="120" viewBox="0 0 220 120" aria-hidden="true">
          <defs><linearGradient id="bd-g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2563eb" /><stop offset=".55" stop-color="#22d3ee" /><stop offset="1" stop-color="#34d399" /></linearGradient></defs>
          <ellipse cx="110" cy="64" rx="96" ry="40" transform="rotate(-14 110 64)" fill="none" stroke="url(#bd-g)" stroke-width="3" />
        </svg>
        <button type="button" class="bd-back" aria-label="ホームにもどる" @click="emit('close')">‹</button>
        <h2>掲示板</h2>
        <small>{{ notes.length }}枚</small>
      </header>

      <div class="bd-list">
        <p v-if="!notes.length && !oldNotes.length" class="bd-empty">まだ貼り紙はありません<br><small>気づいたこと・あとで決めたいことを貼っておけます</small></p>
        <div class="bd-grid">
          <button
            v-for="n in notes" :key="n.h.id" type="button"
            :class="['bd-n', { fresh: n.fresh, tasked: n.tasked }]" :style="{ transform: `rotate(${n.rot}deg)` }"
            :aria-label="`${n.h.body}（${n.h.by}）を開く`" @click="openNote(n.h)"
          >
            <span class="bd-n-b">{{ n.h.body }}</span>
            <span v-if="n.tasked" class="bd-n-t">✓ タスクにした</span>
            <span class="bd-n-m"><span>{{ n.h.by }} ・ {{ _when(n.h.createdAt) }}<template v-if="n.h.pending"> ・ 送信中</template></span><span class="seen">見た {{ n.h.reads?.length ?? 0 }}</span></span>
          </button>
        </div>
        <template v-if="oldNotes.length">
          <button type="button" class="bd-old-t" :aria-expanded="showOld" @click="showOld = !showOld">{{ showOld ? '2週間より前をたたむ ▴' : `2週間より前 ${oldNotes.length}枚 ▾` }}</button>
          <div v-if="showOld" class="bd-old">
            <button v-for="h in oldNotes" :key="h.id" type="button" @click="openNote(h)"><span>{{ h.body }}</span><small>{{ _when(h.createdAt) }}</small></button>
          </div>
        </template>
      </div>

      <div v-if="toast" class="bd-toast" role="status">{{ toast.text }}<button type="button" @click="doUndo">元に戻す</button></div>
      <p v-if="err" class="bd-err" role="alert">{{ err }}</p>
      <button v-if="canWrite" type="button" class="bd-fab" @click="composing = true"><span aria-hidden="true">＋</span>貼る</button>
    </div>

    <div v-if="cur" class="bd-bg" @click.self="openId = null">
      <section class="bd-sh" role="dialog" aria-label="貼り紙">
        <div class="bd-sh-h"><span>{{ cur.by }} ・ {{ _when(cur.createdAt) }}</span><button type="button" aria-label="閉じる" @click="openId = null">✕</button></div>
        <p class="bd-sh-b">{{ cur.body }}</p>
        <div class="bd-seen">
          <span>見た：{{ seen.read.map(r => r.name || '名前なし').join('・') || 'まだだれも' }}</span>
          <span v-if="seen.unread.length" class="un">まだ：{{ seen.unread.map(p => p.name).join('・') }}</span>
        </div>
        <span v-if="cur.taskId" class="bd-sh-t">✓ タスクにした<template v-if="taskLabel">（{{ taskLabel }}）</template> ・ 終わったら掲示板から外れます</span>
        <div class="bd-sh-a">
          <button v-if="canRemoveHandoff(cur)" type="button" class="sub" @click="peel(cur)">はがす</button>
          <button v-if="!cur.taskId && canWrite" type="button" class="main" @click="tasking = cur">タスク化</button>
        </div>
      </section>
    </div>

    <div v-if="composing" class="bd-bg" @click.self="composing = false">
      <form class="bd-sh" aria-label="貼り紙を書く" @submit.prevent="post">
        <div class="bd-sh-h"><b>貼る</b><button type="button" aria-label="閉じる" @click="composing = false">✕</button></div>
        <textarea v-model="draft" rows="4" :maxlength="HANDOFF_BODY_MAX" placeholder="気づいたこと・あとで決めたいこと" aria-label="貼り紙の中身"></textarea>
        <button type="submit" class="bd-post" :disabled="!draft.trim() || busy">貼る</button>
      </form>
    </div>
    <TalkTaskSheet v-if="tasking" :message="tasking" @close="tasking = null" @done="onTasked" />
  </Teleport>
</template>

<style scoped>
.bd { position: fixed; inset: 0; z-index: 110; display: flex; flex-direction: column; background: #eef5f7; max-width: 600px; margin: 0 auto; }
.bd-h { position: relative; overflow: hidden; display: flex; align-items: center; gap: 10px; padding: 14px 12px 16px; color: #e6fbff;
  background: radial-gradient(120% 140% at 90% 0%, #0f4c5c 0%, #0a3340 50%, #06222b 100%); }
.bd-ring { position: absolute; right: -60px; top: -20px; opacity: .7; pointer-events: none; }
.bd-back { position: relative; width: 40px; height: 40px; border: none; border-radius: 12px; background: rgba(255,255,255,.1); color: #e6fbff; font: inherit; font-size: 22px; font-weight: 800; cursor: pointer; }
.bd-h h2 { position: relative; margin: 0; flex: 1; font-size: 20px; }
.bd-h small { position: relative; font-size: 12px; font-weight: 800; color: #a5d8e3; }
.bd-list { flex: 1; overflow-y: auto; padding: 18px 14px 100px; display: flex; flex-direction: column; gap: 14px; }
.bd-empty { margin: 48px 0; text-align: center; font-weight: 800; color: var(--text-muted); line-height: 1.8; }
.bd-empty small { font-weight: 700; }
.bd-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 14px; align-items: start; padding: 4px 2px 0; }
.bd-n { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 8px; min-height: 128px; padding: 14px 12px 10px; border: none; border-radius: 14px;
  background: var(--surface, #fff); text-align: left; font: inherit; color: var(--text); cursor: pointer; box-shadow: 0 8px 18px rgba(6,34,43,.12), 0 1px 3px rgba(6,34,43,.08); }
.bd-n.fresh { padding-top: 18px; box-shadow: 0 0 0 1.5px rgba(34,211,238,.5), 0 12px 24px rgba(14,116,144,.22); }
.bd-n.fresh::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 4px; background: linear-gradient(90deg, #2563eb, #22d3ee, #34d399); box-shadow: 0 0 12px #22d3ee; }
.bd-n.tasked { opacity: .8; }
.bd-n-b { font-size: 14.5px; font-weight: 700; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
.bd-n-t { align-self: flex-start; height: 24px; display: inline-flex; align-items: center; padding: 0 8px; border-radius: 999px; background: #e6f7f0; color: #17663a; font-size: 11px; font-weight: 900; }
.bd-n-m { margin-top: auto; display: flex; flex-direction: column; gap: 1px; font-size: 11px; font-weight: 800; color: var(--text-muted); }
.bd-n.fresh .bd-n-m { color: var(--primary, #0e7490); }
.bd-n-m .seen { color: #8aa0a8; }
.bd-old-t { align-self: center; height: 34px; padding: 0 14px; border: none; border-radius: 999px; background: var(--surface, #fff); font: inherit; font-size: 12.5px; font-weight: 800; color: var(--text-muted); cursor: pointer; box-shadow: 0 1px 4px rgba(6,34,43,.06); }
.bd-old { display: flex; flex-direction: column; border-radius: 14px; background: var(--surface, #fff); overflow: hidden; }
.bd-old button { display: flex; align-items: center; gap: 10px; padding: 11px 14px; border: none; border-top: 1px solid #eef4f6; background: none; font: inherit; text-align: left; cursor: pointer; color: #3d545d; }
.bd-old button span { flex: 1; font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bd-old button small { font-size: 11px; font-weight: 800; color: #8aa0a8; }
.bd-fab { position: absolute; right: 16px; bottom: calc(22px + env(safe-area-inset-bottom)); height: 52px; padding: 0 20px; border: none; border-radius: 999px; display: inline-flex; align-items: center; gap: 6px;
  background: linear-gradient(135deg, #0e7490, #0b3b48); color: #fff; font: inherit; font-size: 15px; font-weight: 900; cursor: pointer; box-shadow: 0 0 0 2px rgba(34,211,238,.35), 0 8px 20px rgba(14,116,144,.4); }
.bd-fab span { font-size: 20px; }
.bd-toast { position: absolute; left: 16px; right: 16px; bottom: calc(90px + env(safe-area-inset-bottom)); display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 14px; background: #0f2a33; color: #fff; font-size: 13.5px; font-weight: 800; }
.bd-toast button { margin-left: auto; border: none; background: none; color: #67e8f9; font: inherit; font-weight: 900; cursor: pointer; }
.bd-err { position: absolute; left: 16px; right: 16px; bottom: calc(150px + env(safe-area-inset-bottom)); margin: 0; font-size: 12.5px; color: #b91c1c; font-weight: 700; }
.bd-bg { position: fixed; inset: 0; z-index: 120; background: rgba(6,34,43,.5); display: flex; align-items: flex-end; justify-content: center; }
.bd-sh { width: 100%; max-width: 600px; box-sizing: border-box; max-height: 80vh; overflow-y: auto; background: var(--surface, #fff); border-radius: 22px 22px 0 0; padding: 14px 16px calc(20px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 12px; }
.bd-sh-h { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 800; color: var(--text-muted); }
.bd-sh-h span, .bd-sh-h b { flex: 1; }
.bd-sh-h b { font-size: 16px; color: var(--text); }
.bd-sh-h button { width: 40px; height: 40px; border: none; background: none; font-size: 16px; color: var(--text-muted); cursor: pointer; }
.bd-sh-b { margin: 0; font-size: 17px; font-weight: 700; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.bd-seen { display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; border-radius: 12px; background: #f3f8fa; font-size: 12px; font-weight: 700; color: #3d545d; }
.bd-seen .un { color: #8aa0a8; }
.bd-sh-t { align-self: flex-start; padding: 6px 10px; border-radius: 10px; background: #e6f7f0; color: #17663a; font-size: 12.5px; font-weight: 900; }
.bd-sh-a { display: flex; gap: 10px; }
.bd-sh-a button { flex: 1; height: 50px; border: none; border-radius: 14px; font: inherit; font-size: 15px; font-weight: 900; cursor: pointer; }
.bd-sh-a .sub { background: #eef4f6; color: #3d545d; }
.bd-sh-a .main { flex: 1.4; background: linear-gradient(135deg, #0e7490, #0b3b48); color: #fff; }
.bd-sh textarea { width: 100%; box-sizing: border-box; border: 1.5px solid #d6e6ea; border-radius: 14px; padding: 12px; font: inherit; font-size: 15px; line-height: 1.6; resize: none; background: #f7fafb; color: var(--text); }
.bd-post { height: 50px; border: none; border-radius: 14px; background: linear-gradient(135deg, #0e7490, #0b3b48); color: #fff; font: inherit; font-size: 15px; font-weight: 900; cursor: pointer; }
.bd-post:disabled { opacity: .5; }
</style>
