<script setup>
/**
 * 進行中のやること1件（下のシート・User決定 2026-10-23・モック docs/mocks/journal-inprogress.html ②③）。
 * - 状態（進行中／待ち／済み）・待っているもの・次に見る日・期限・担当
 * - 手順（任意・小さなチェック）
 * - 経過: 1行ずつ、時刻と人つき（サーバーが刻む・足していくだけ）。ここを見れば引き継ぎがいらない
 * - 経過を書いたついでに「このまま／待ちにする／済みにする」と「次に見る日」をその場で
 * 変えられるのは担当の人・作った人・管理者（canProgress）。経過は見える人なら誰でも書ける
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { updateProgress, finishProgress, canProgress, loadNotes, addNote, newStepId, idleDays } from '../composables/useTasks.js'
import { localDateKey } from '../utils/localDate.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

const props = defineProps({ task: { type: Object, required: true } })
const emit = defineEmits(['close'])
const t = computed(() => props.task)
const can = computed(() => canProgress(t.value))
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const md = k => { if (!k) return ''; const d = new Date(k + 'T00:00:00'); return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）` }
const at = iso => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` }
const plus = n => { const d = new Date(); d.setDate(d.getDate() + n); return localDateKey(d) }
const PICKS = [['明日', 1], ['3日後', 3], ['1週間後', 7]]

const notes = ref([])
const loading = ref(true)
onMounted(async () => { notes.value = await loadNotes(t.value.id); loading.value = false })

const err = ref('')
function setState(p) {
  err.value = ''
  if (p === 'done') { finishProgress(t.value.id); emit('close'); return }
  updateProgress(t.value.id, { progress: p, waitNote: p === 'waiting' ? t.value.waitNote : null })
}
const waitDraft = ref(t.value.waitNote || '')
function saveWait() { updateProgress(t.value.id, { waitNote: waitDraft.value }) }
function setNext(k) { updateProgress(t.value.id, { date: k }) }
function setDeadline(k) { updateProgress(t.value.id, { deadline: k || null }) }

// 手順
const steps = computed(() => t.value.steps ?? [])
const stepDraft = ref('')
function toggleStep(s) { updateProgress(t.value.id, { steps: steps.value.map(x => (x.id === s.id ? { ...x, done: !x.done } : x)) }) }
function addStep() {
  const text = stepDraft.value.trim()
  if (!text) return
  updateProgress(t.value.id, { steps: [...steps.value, { id: newStepId(), text, done: false }] }); stepDraft.value = ''
}
function removeStep(s) { updateProgress(t.value.id, { steps: steps.value.filter(x => x.id !== s.id) }) }

// 経過を書く（ついでに状態・次に見る日）
const noteDraft = ref('')
const after = ref('keep')       // keep | waiting | done
const afterWait = ref('')
const nextPick = ref(null)      // 'YYYY-MM-DD' | null
const busy = ref(false)
async function send() {
  if (!noteDraft.value.trim() || busy.value) return
  busy.value = true; err.value = ''
  try {
    const n = await addNote(t.value.id, noteDraft.value)
    if (n) notes.value = [n, ...notes.value]
    noteDraft.value = ''
    if (can.value) {
      if (after.value === 'done') { finishProgress(t.value.id); emit('close'); return }
      const f = {}
      if (after.value === 'waiting') { f.progress = 'waiting'; f.waitNote = afterWait.value || t.value.waitNote }
      if (nextPick.value) f.date = nextPick.value
      if (Object.keys(f).length) updateProgress(t.value.id, f)
    }
    after.value = 'keep'; afterWait.value = ''; nextPick.value = null
  } catch (e) { err.value = e?.message || '書き込めませんでした。電波の届くところでもう一度' } finally { busy.value = false }
}
onUnmounted(registerInnerLayerCloser(() => { emit('close'); return true }))
</script>

<template>
  <Teleport to="body">
    <div class="ps-bg" @click.self="emit('close')">
      <div class="ps" role="dialog" :aria-label="t.text">
        <div class="ps-h"><b>{{ t.text }}</b><button type="button" class="ps-x" aria-label="閉じる" @click="emit('close')">✕</button></div>
        <div class="ps-seg" role="group" aria-label="状態">
          <button type="button" :class="['go', { on: t.progress === 'doing' }]" :disabled="!can" @click="setState('doing')">進行中</button>
          <button type="button" :class="['wait', { on: t.progress === 'waiting' }]" :disabled="!can" @click="setState('waiting')">待ち</button>
          <button type="button" class="done" :disabled="!can" @click="setState('done')">済みにする</button>
        </div>
        <input v-if="t.progress === 'waiting'" v-model="waitDraft" type="text" maxlength="60" class="ps-in" :disabled="!can"
          placeholder="待っているもの（例：業者の見積もり）" aria-label="待っているもの" @change="saveWait" />
        <dl class="ps-kv">
          <dt>次に見る</dt>
          <dd>
            <span class="ps-v">{{ md(t.date) }}</span>
            <template v-if="can">
              <button v-for="p in PICKS" :key="p[1]" type="button" class="ps-chip" @click="setNext(plus(p[1]))">{{ p[0] }}</button>
              <input type="date" class="ps-date" :value="t.date" aria-label="次に見る日" @change="e => e.target.value && setNext(e.target.value)" />
            </template>
          </dd>
          <dt>期限</dt>
          <dd><input type="date" class="ps-date" :value="t.deadline || ''" :disabled="!can" aria-label="期限" @change="e => setDeadline(e.target.value)" /><span v-if="!t.deadline" class="ps-muted">なし</span></dd>
          <dt>担当</dt><dd>{{ t.assign === 'person' ? t.assigneeName : t.assign === 'all' ? '全員' : '誰でも' }}</dd>
          <dt>動き</dt><dd :class="{ stale: idleDays(t) >= 5 }">{{ idleDays(t) ? `${idleDays(t)}日前` : '今日' }}</dd>
        </dl>

        <div class="ps-lab">手順（任意）</div>
        <ul class="ps-steps">
          <li v-for="s in steps" :key="s.id" :class="{ ok: s.done }">
            <button type="button" class="ps-ck" :disabled="!can" :aria-pressed="s.done" :aria-label="`${s.text}を済み`" @click="toggleStep(s)">{{ s.done ? '✓' : '' }}</button>
            <span>{{ s.text }}</span>
            <button v-if="can" type="button" class="ps-rm" aria-label="手順を消す" @click="removeStep(s)">✕</button>
          </li>
        </ul>
        <div v-if="can" class="ps-row">
          <input v-model="stepDraft" type="text" maxlength="100" class="ps-in" placeholder="手順を足す（例：業者に連絡）" aria-label="手順を足す" @keydown.enter.prevent="addStep" />
          <button type="button" class="ps-mini" :disabled="!stepDraft.trim()" @click="addStep">＋</button>
        </div>

        <div class="ps-lab">経過</div>
        <div class="ps-compose">
          <textarea v-model="noteDraft" rows="2" maxlength="300" class="ps-in" placeholder="経過を書く（例：業者に電話。見積もりは明後日）" aria-label="経過"></textarea>
          <template v-if="noteDraft.trim() && can">
            <div class="ps-chips">
              <span class="ps-cap">このあと</span>
              <button type="button" :class="['ps-chip', { on: after === 'keep' }]" @click="after = 'keep'">このまま</button>
              <button type="button" :class="['ps-chip', { on: after === 'waiting' }]" @click="after = 'waiting'">待ちにする</button>
              <button type="button" :class="['ps-chip', 'okc', { on: after === 'done' }]" @click="after = 'done'">済みにする</button>
            </div>
            <input v-if="after === 'waiting'" v-model="afterWait" type="text" maxlength="60" class="ps-in" placeholder="待っているもの" aria-label="待っているもの（経過）" />
            <div v-if="after !== 'done'" class="ps-chips">
              <span class="ps-cap">次に見る</span>
              <button v-for="p in PICKS" :key="p[1]" type="button" :class="['ps-chip', { on: nextPick === plus(p[1]) }]" @click="nextPick = plus(p[1])">{{ p[0] }}</button>
            </div>
          </template>
          <button type="button" class="ps-send" :disabled="!noteDraft.trim() || busy" @click="send">送る</button>
        </div>
        <p v-if="err" class="ps-err" role="alert">{{ err }}</p>
        <ol class="ps-tl">
          <li v-for="n in notes" :key="n.id">{{ n.body }}<small>{{ at(n.at) }} {{ n.by }}</small></li>
          <li v-if="!loading && !notes.length" class="none">まだ経過はありません<small>{{ at(t.createdAt) }} {{ t.createdBy }}（作った人）</small></li>
        </ol>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ps-bg { position: fixed; inset: 0; z-index: 125; background: rgba(15,23,42,.4); display: flex; align-items: flex-end; justify-content: center; }
.ps { width: 100%; max-width: 600px; max-height: 90vh; overflow-y: auto; background: var(--surface); border-radius: 22px 22px 0 0; padding: 16px 16px calc(18px + env(safe-area-inset-bottom)); display: grid; gap: 10px; box-sizing: border-box; }
.ps-h { display: flex; align-items: center; gap: 8px; } .ps-h b { flex: 1; font-size: 18px; }
.ps-x { width: 34px; height: 34px; border-radius: 50%; border: none; background: #f1f5f9; color: #64748b; font-weight: 900; cursor: pointer; }
.ps-seg { display: flex; gap: 4px; }
.ps-seg button { flex: 1; min-height: 40px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); font: inherit; font-size: 13px; font-weight: 800; color: var(--text-muted); cursor: pointer; }
.ps-seg button.go.on { background: #f59e0b; border-color: #f59e0b; color: #fff; }
.ps-seg button.wait.on { background: #4f46e5; border-color: #4f46e5; color: #fff; }
.ps-seg button.done { color: #166534; border-color: #86efac; }
.ps-seg button:disabled { opacity: .5; }
.ps-in { width: 100%; box-sizing: border-box; min-height: 40px; border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; font: inherit; font-size: 14px; background: var(--surface); color: var(--text); resize: vertical; }
.ps-kv { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 0; font-size: 13px; align-items: center; }
.ps-kv dt { color: var(--text-muted); font-weight: 800; }
.ps-kv dd { margin: 0; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-weight: 800; }
.ps-kv dd.stale { color: #b91c1c; }
.ps-v { margin-right: 4px; }
.ps-muted { color: var(--text-muted); font-weight: 600; font-size: 12px; }
.ps-date { border: 1px solid var(--border); border-radius: 8px; padding: 4px 6px; font: inherit; font-size: 12.5px; background: var(--surface); color: var(--text); }
.ps-chip { border: 1px solid var(--border); background: var(--surface); border-radius: 999px; padding: 5px 10px; font: inherit; font-size: 12px; font-weight: 800; color: #334155; cursor: pointer; }
.ps-chip.on { background: #4f46e5; border-color: #4f46e5; color: #fff; }
.ps-chip.okc.on { background: #16a34a; border-color: #16a34a; }
.ps-lab { font-size: 11.5px; font-weight: 900; color: var(--text-muted); letter-spacing: .04em; }
.ps-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.ps-steps li { display: flex; align-items: center; gap: 8px; min-height: 36px; font-size: 14px; }
.ps-steps li.ok span { color: #94a3b8; text-decoration: line-through; }
.ps-ck { flex: none; width: 24px; height: 24px; border-radius: 7px; border: 2px solid #f59e0b; background: var(--surface); color: #fff; font-weight: 900; cursor: pointer; padding: 0; }
.ps-steps li.ok .ps-ck { background: #22c55e; border-color: #22c55e; }
.ps-rm { margin-left: auto; border: none; background: none; color: #94a3b8; cursor: pointer; }
.ps-row { display: flex; gap: 6px; }
.ps-mini { flex: none; width: 44px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); font-size: 18px; font-weight: 900; color: #f59e0b; cursor: pointer; }
.ps-compose { display: grid; gap: 6px; }
.ps-chips { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.ps-cap { font-size: 11px; font-weight: 800; color: var(--text-muted); margin-right: 2px; }
.ps-send { min-height: 42px; border: none; border-radius: 11px; background: #f59e0b; color: #fff; font: inherit; font-size: 14px; font-weight: 900; cursor: pointer; }
.ps-send:disabled { opacity: .5; }
.ps-err { margin: 0; font-size: 12.5px; color: #b91c1c; font-weight: 700; }
.ps-tl { list-style: none; margin: 0 0 0 6px; padding: 0 0 0 12px; border-left: 2px solid #fde68a; display: grid; gap: 8px; }
.ps-tl li { position: relative; font-size: 13.5px; line-height: 1.45; }
.ps-tl li::before { content: ''; position: absolute; left: -18px; top: 6px; width: 9px; height: 9px; border-radius: 50%; background: #f59e0b; }
.ps-tl li.none { color: var(--text-muted); }
.ps-tl small { display: block; font-size: 11px; color: var(--text-muted); font-weight: 700; }
</style>
