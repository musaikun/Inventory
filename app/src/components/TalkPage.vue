<script setup>
/**
 * 連絡（店のトーク・User決定 2026-10-26・キャンバス「日誌カレンダー」③）。ホームの「連絡」カードから開く。
 * - 新しいものが下。日の区切り（昨日・今日・m/d）と「ここから未読」の線
 * - 吹き出しを押すと: ［タスク化］［確認］（ほかの人のもの）・読んだ人・消す（書いた人と管理者）
 * - タスク化したメッセージには「タスクになりました ・ 担当 ・ 済み／進行中／期限 m/d」の札。直後は［取り消す］
 */
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import TalkTaskSheet from './TalkTaskSheet.vue'
import {
  handoffs, pullHandoffs, tellHandoff, readHandoff, removeHandoff, undoHandoffTask, isReadByMe, isMine, canRemoveHandoff, HANDOFF_BODY_MAX,
} from '../composables/useHandoffs.js'
import { aliveTasks, pullTasks } from '../composables/useTasks.js'
import { storeName, can } from '../composables/useAuth.js'
import { localDateKey } from '../utils/localDate.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

const emit = defineEmits(['close'])
const today = localDateKey()
const yday = localDateKey(new Date(Date.now() - 86400_000))
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const _day = iso => localDateKey(new Date(iso))
const _hm = iso => { const d = new Date(iso); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` }
const _md = k => { const d = new Date(k + 'T00:00:00'); return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）` }
const COLORS = ['#b45309', '#7c3aed', '#0f766e', '#be185d', '#1d4ed8', '#4d7c0f']
const _color = id => COLORS[[...String(id || '')].reduce((n, c) => n + c.charCodeAt(0), 0) % COLORS.length]

let timer = null
const listEl = ref(null)
async function toBottom() { await nextTick(); if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight }
onMounted(async () => { pullTasks(); await pullHandoffs(); toBottom(); timer = setInterval(pullHandoffs, 30000) })
onMounted(toBottom)
onUnmounted(() => clearInterval(timer))

const taskOf = computed(() => new Map(aliveTasks.value.map(t => [t.id, t])))
function chip(h) {
  const t = h.taskId ? taskOf.value.get(h.taskId) : null
  if (!t) return null
  const who = t.assign === 'person' ? t.assigneeName : t.assign === 'none' ? '' : '誰でも'
  const state = t.doneAt ? '済み' : t.progress ? '進行中' : t.deadline ? `期限 ${_md(t.deadline)}` : t.date === today ? '今日' : t.date ? _md(t.date) : 'いつか'
  return { text: ['タスクになりました', who, state].filter(Boolean).join(' ・ '), done: !!t.doneAt }
}
// 古い順に並べ、日の区切りと「ここから未読」を差し込む
const items = computed(() => {
  const list = [...handoffs.value].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
  const out = []
  let day = '', unreadPut = false
  for (const h of list) {
    const d = _day(h.createdAt)
    if (d !== day) { day = d; out.push({ key: `d-${d}`, type: 'day', label: d === today ? '今日' : d === yday ? '昨日' : _md(d) }) }
    if (!unreadPut && !isMine(h) && !isReadByMe(h)) { unreadPut = true; out.push({ key: 'unread', type: 'unread' }) }
    out.push({ key: h.id, type: 'msg', h, mine: isMine(h), chip: chip(h), color: _color(h.byId) })
  }
  return out
})
const open = ref(null)
const draft = ref('')
const busy = ref(false)
const err = ref('')
async function send() {
  if (!draft.value.trim() || busy.value) return
  busy.value = true; err.value = ''
  try { await tellHandoff(draft.value); draft.value = ''; toBottom() } catch (e) { err.value = e?.message || '送れませんでした' } finally { busy.value = false }
}
async function del(h) { open.value = null; err.value = ''; try { await removeHandoff(h) } catch (e) { err.value = e?.message || '消せませんでした' } }
const canWrite = computed(() => can('task.create'))
// タスク化
const tasking = ref(null)
const undo = ref(null)    // { task, message }
let undoTimer = null
function onTasked(x) {
  tasking.value = null; open.value = null
  undo.value = x
  clearTimeout(undoTimer); undoTimer = setTimeout(() => { undo.value = null }, 5000)
}
async function doUndo() { const x = undo.value; undo.value = null; if (x) await undoHandoffTask({ ...x.message, taskId: x.task.id }, x.task.id) }
onUnmounted(() => clearTimeout(undoTimer))
onUnmounted(registerInnerLayerCloser(() => { if (tasking.value) return false; emit('close'); return true }))
</script>

<template>
  <Teleport to="body">
    <div class="tk" role="dialog" aria-label="連絡">
      <header class="tk-h">
        <button type="button" class="tk-back" aria-label="ホームにもどる" @click="emit('close')">‹</button>
        <div><h2>連絡</h2><small>{{ storeName }}</small></div>
      </header>

      <div ref="listEl" class="tk-list">
        <p v-if="!items.length" class="tk-empty">まだありません</p>
        <template v-for="x in items" :key="x.key">
          <span v-if="x.type === 'day'" class="tk-day">{{ x.label }}</span>
          <div v-else-if="x.type === 'unread'" class="tk-unread"><i></i><span>ここから未読</span><i></i></div>
          <div v-else :class="['tk-row', { mine: x.mine }]">
            <span v-if="!x.mine" class="tk-av" :style="{ background: x.color }">{{ (x.h.by || '?').slice(0, 1) }}</span>
            <div class="tk-col">
              <span v-if="!x.mine" class="tk-name">{{ x.h.by }}</span>
              <button type="button" :class="['tk-bub', { open: open === x.h.id }]" :aria-expanded="open === x.h.id" @click="open = open === x.h.id ? null : x.h.id">{{ x.h.body }}</button>
              <span v-if="x.chip" :class="['tk-chip', { done: x.chip.done }]">✓ {{ x.chip.text }}</span>
              <span class="tk-meta">{{ x.h.createdAt ? _hm(x.h.createdAt) : '' }}<template v-if="x.h.reads?.length"> ・ 既読 {{ x.h.reads.length }}</template><template v-if="x.h.pending"> ・ 送信中</template></span>
              <div v-if="open === x.h.id" class="tk-menu">
                <button v-if="!x.h.taskId && canWrite" type="button" class="main" @click="tasking = x.h">タスク化</button>
                <button v-if="!x.mine && !isReadByMe(x.h)" type="button" @click="readHandoff(x.h)">確認</button>
                <button v-if="canRemoveHandoff(x.h)" type="button" class="del" @click="del(x.h)">消す</button>
                <span v-if="x.h.reads?.length" class="tk-readers">読んだ人：{{ x.h.reads.map(r => r.name).filter(Boolean).join('・') }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>

      <div v-if="undo" class="tk-undo" role="status">タスクにしました<button type="button" @click="doUndo">取り消す</button></div>
      <p v-if="err" class="tk-err" role="alert">{{ err }}</p>
      <form v-if="canWrite" class="tk-in" @submit.prevent="send">
        <textarea v-model="draft" rows="1" :maxlength="HANDOFF_BODY_MAX" placeholder="メッセージ" aria-label="メッセージ"></textarea>
        <button type="submit" aria-label="送る" :disabled="!draft.trim() || busy">➤</button>
      </form>
    </div>
    <TalkTaskSheet v-if="tasking" :message="tasking" @close="tasking = null" @done="onTasked" />
  </Teleport>
</template>

<style scoped>
.tk { position: fixed; inset: 0; z-index: 110; display: flex; flex-direction: column; background: #eef3f5; max-width: 600px; margin: 0 auto; }
.tk-h { display: flex; align-items: center; gap: 10px; padding: 12px; background: var(--surface); border-bottom: 1px solid #e3ecef; }
.tk-h h2 { margin: 0; font-size: 19px; }
.tk-h small { font-size: 11.5px; font-weight: 700; color: var(--text-muted); }
.tk-back { width: 40px; height: 40px; border: none; border-radius: 12px; background: #eef4f6; font: inherit; font-size: 22px; font-weight: 800; color: var(--text); cursor: pointer; }
.tk-list { flex: 1; overflow-y: auto; padding: 12px 12px 8px; display: flex; flex-direction: column; gap: 10px; }
.tk-empty { margin: 40px 0; text-align: center; font-weight: 800; color: var(--text-muted); }
.tk-day { align-self: center; font-size: 11px; font-weight: 800; color: var(--text-muted); background: #dfe8ec; border-radius: 999px; padding: 3px 12px; }
.tk-unread { display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 900; color: #c2410c; }
.tk-unread i { flex: 1; height: 1px; background: #e8590c; }
.tk-row { display: flex; gap: 8px; align-items: flex-start; }
.tk-row.mine { justify-content: flex-end; }
.tk-av { flex: none; width: 32px; height: 32px; margin-top: 18px; border-radius: 50%; color: #fff; display: grid; place-items: center; font-size: 13px; font-weight: 900; }
.tk-col { display: flex; flex-direction: column; gap: 4px; max-width: 78%; align-items: flex-start; }
.tk-row.mine .tk-col { align-items: flex-end; }
.tk-name { font-size: 11px; font-weight: 800; color: var(--text-muted); }
.tk-bub { border: none; margin: 0; font: inherit; text-align: left; cursor: pointer; font-size: 14.5px; line-height: 1.55; padding: 9px 13px; border-radius: 6px 18px 18px 18px; background: var(--surface); color: var(--text); box-shadow: 0 1px 2px rgba(16,38,46,.08); white-space: pre-wrap; overflow-wrap: anywhere; }
.tk-row.mine .tk-bub { border-radius: 18px 6px 18px 18px; background: var(--primary, #0e7490); color: #fff; }
.tk-bub.open { box-shadow: 0 0 0 2.5px #f2c94c; }
.tk-chip { font-size: 11px; font-weight: 900; padding: 3px 9px; border-radius: 999px; background: #e0f4f8; color: #0b5f73; }
.tk-chip.done { background: #e3f6ea; color: #17663a; }
.tk-meta { font-size: 10.5px; font-weight: 700; color: #6a7f88; }
.tk-menu { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding-top: 2px; }
.tk-menu button { height: 36px; padding: 0 14px; border-radius: 999px; border: 1px solid #c9d6db; background: var(--surface); font: inherit; font-size: 13px; font-weight: 800; color: var(--text); cursor: pointer; }
.tk-menu button.main { border: none; background: var(--primary, #0e7490); color: #fff; font-weight: 900; }
.tk-menu button.del { color: #b91c1c; }
.tk-readers { font-size: 11.5px; font-weight: 700; color: var(--text-muted); }
.tk-undo { margin: 0 12px 8px; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; background: #0f2a33; color: #fff; font-size: 13.5px; font-weight: 800; }
.tk-undo button { margin-left: auto; border: none; background: none; color: #67e8f9; font: inherit; font-weight: 900; cursor: pointer; }
.tk-err { margin: 0 12px 8px; font-size: 12.5px; color: #b91c1c; font-weight: 700; }
.tk-in { display: flex; align-items: flex-end; gap: 8px; padding: 10px 12px calc(12px + env(safe-area-inset-bottom)); background: var(--surface); border-top: 1px solid #e3ecef; }
.tk-in textarea { flex: 1; resize: none; border: 1px solid #c9d6db; border-radius: 20px; padding: 10px 14px; font: inherit; font-size: 15px; background: #f7fafb; color: var(--text); max-height: 120px; }
.tk-in button { width: 44px; height: 44px; flex: none; border: none; border-radius: 50%; background: var(--primary, #0e7490); color: #fff; font-size: 18px; cursor: pointer; }
.tk-in button:disabled { opacity: .5; }
</style>
