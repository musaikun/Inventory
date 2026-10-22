<script setup>
/**
 * 日誌のリストの一番上「ルーティン」（毎日・毎週・毎月の決まった仕事。User決定 2026-10-19 → 2026-10-22 に
 * 「毎日のチェック」から改名・モック docs/mocks/journal-routine.html）。
 * - 増えても日誌の上が長くならないように（User決定 2026-10-22）:
 *   出すのは今日の分だけ／済んだものは「済み N」にたたむ／大きなカードは中に項目のある表だけ、項目なしは押せば済む1行／
 *   今日は出ない毎週・毎月のものは「これから」の1行
 * - 項目のある表のカード: 進み具合・時刻・この7日の✓・「チェックを始める」。1日に何回もの表は回ごとの札（済み・今・まだ・これから）
 * - まだ1つも無い店: 管理者にだけ「作りましょう」のカード（見本を押すだけで始まる）。
 *   ×で消すと、カードが縮んで上の入口へ吸い込まれ、「ここからいつでも作れます」と出て終わる（端末ごとに覚える・useHints）
 * - 以後は入口の1行だけ（押すと一覧・作る）。スタッフで表が1つも無いときは何も出さない
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { checklists, checklistRuns, checklistsForDay, canEditChecklists, startFromSample, markChecklistItem, canMarkChecklist, canUnmark, CHECKLIST_SAMPLES } from '../composables/useChecklists.js'
import { weekMarks, currentSlot, repeatLabel, repeatKind, slotsOf, isSimple, upcoming, WHOLE } from '../services/checklistSchedule.js'
import { isHintShown, dismissHint } from '../composables/useHints.js'
import { localDateKey } from '../utils/localDate.js'

const emit = defineEmits(['open-run', 'settings', 'create'])
const INTRO_HINT = 'daily-check-intro'

const today = localDateKey()
const nowHm = ref('')
let timer = null
function _tick() { const d = new Date(); nowHm.value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
onMounted(() => { _tick(); timer = setInterval(_tick, 60000) })
onUnmounted(() => { clearInterval(timer); clearTimeout(_t1); clearTimeout(_t2) })

const days = computed(() => checklistsForDay(today))
const doneCount = computed(() => days.value.filter(r => r.complete).length)
// まだのもの: 項目のある表（と1日に何回もの1件）はカード、項目なしの1回は1行
const openCards = computed(() => days.value.filter(r => !r.complete && (!isSimple(r.cl) || r.totalSlots > 1)))
const openRows = computed(() => days.value.filter(r => !r.complete && isSimple(r.cl) && r.totalSlots === 1))
const doneList = computed(() => days.value.filter(r => r.complete))
const doneOpen = ref(false)
const later = computed(() => upcoming(checklists.value, today, { skip: new Set(days.value.map(r => r.cl.id)) }))
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const md = k => { const d = new Date(k + 'T00:00:00'); const diff = Math.round((d - new Date(today + 'T00:00:00')) / 86400000); return diff < 7 ? WEEK[d.getDay()] : `${d.getMonth() + 1}/${d.getDate()}` }
/** 札: 毎日／毎週 土・日／毎月1日（色は種類ごと） */
const badge = cl => ({ cls: repeatKind(cl), text: cl.repeat === 'weekly' ? `毎週 ${repeatLabel(cl)}` : repeatLabel(cl) })
const sub = (cl) => {
  const t = slotsOf(cl).filter(Boolean)
  return [t.length > 1 ? `1日${t.length}回` : t[0] || '', isSimple(cl) ? '' : `${cl.items.length}項目`, who(cl)].filter(Boolean).join(' ・ ')
}
const lastMark = r => r.slots.flatMap(s => Object.values(s.marks)).filter(m => m?.at).sort((a, b) => a.at.localeCompare(b.at)).pop()
// 項目なしの1件は、その場で済み・取り消し
const rowErr = ref('')
async function toggleRow(r) {
  rowErr.value = ''
  const s = r.slots[0]
  const m = s.marks[WHOLE]
  if (!canMarkChecklist(r.cl)) { rowErr.value = 'このルーティンを済ませられるのは、担当の人と管理者だけです'; return }
  if (m && !canUnmark(m)) { rowErr.value = '取り消せるのは、済ませた人がその日のうちだけです（それ以降は管理者）'; return }
  try { await markChecklistItem(r.cl, today, s.slot, WHOLE, m ? null : 'done') } catch (e) { rowErr.value = e?.message || '保存できませんでした' }
}
const hasAny = computed(() => checklists.value.length > 0)
const admin = computed(() => canEditChecklists.value)
const showIntro = computed(() => admin.value && !hasAny.value && isHintShown(INTRO_HINT))

const hm = iso => { const d = new Date(iso); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` }
const who = cl => (cl.assign === 'person' ? cl.assigneeName || '担当' : '誰でも')
function status(r) {
  if (r.complete) { const last = r.slots.map(s => s.lastAt).filter(Boolean).sort().pop(); return { cls: 'ok', text: `✓ 済み${last ? ` ${hm(last)}` : ''}` } }
  if (r.totalSlots > 1) return { cls: 'now', text: `今日 ${r.doneSlots}/${r.totalSlots}回` }
  const s = r.slots[0]
  if (!s.started && s.slot && s.slot > nowHm.value) return { cls: '', text: `${s.slot}から` }
  return { cls: 'now', text: `${r.filled}/${r.total}` }
}
function slotState(r, s) {
  if (s.complete) return { cls: 'ok', sub: `✓ ${Object.values(s.marks).map(m => m?.by).filter(Boolean)[0] ?? ''} ${s.lastAt ? hm(s.lastAt) : ''}`.trim() }
  const cur = currentSlot(r, nowHm.value)
  if (cur?.slot === s.slot) return { cls: 'now', sub: s.started ? `途中 ${s.filled}/${s.total}` : '今やる' }
  if (s.slot && s.slot <= nowHm.value) return { cls: 'late', sub: s.started ? `途中 ${s.filled}/${s.total}` : 'まだ' }
  return { cls: 'later', sub: 'これから' }
}
function goLabel(r) {
  const cur = currentSlot(r, nowHm.value)
  if (r.totalSlots > 1) return `${cur.slot} の回を始める`
  return r.started ? 'チェックを続ける' : 'チェックを始める'
}
function open(r, slot = null) {
  const s = slot ?? currentSlot(r, nowHm.value)?.slot ?? r.slots[0].slot
  emit('open-run', { cl: r.cl, date: today, slot: s })
}
const week = r => weekMarks(r.cl, checklistRuns.value, today)
const WEEK_TXT = { y: '✓', n: '✕', t: '今', o: '' }

// ── はじめて ──
const err = ref('')
const busy = ref(false)
async function useSample(s) {
  busy.value = true; err.value = ''
  try { await startFromSample(s) } catch (e) { err.value = e?.message || '作れませんでした' } finally { busy.value = false }
}
// ×: 縮んで入口へ → 入口が光る → 「ここからいつでも作れます」
const leaving = ref(false)
const glow = ref(false)
const toast = ref(false)
let _t1 = null, _t2 = null
function closeIntro() {
  leaving.value = true
  _t1 = setTimeout(() => {
    dismissHint(INTRO_HINT)
    leaving.value = false; glow.value = true; toast.value = true
    _t2 = setTimeout(() => { glow.value = false; toast.value = false }, 2600)
  }, 450)
}
</script>

<template>
  <section class="dc" aria-label="ルーティン">
    <template v-if="days.length || later.length">
      <div class="dc-lh"><span>ルーティン ・ 今日</span><em v-if="days.length">{{ doneCount }} / {{ days.length }} 済み</em></div>
      <div v-for="r in openCards" :key="r.cl.id" class="dc-card">
        <button type="button" class="dc-h" @click="open(r)">
          <span class="dc-name"><b>{{ r.cl.name }}</b><small><i :class="['dc-b', badge(r.cl).cls]">{{ badge(r.cl).text }}</i>{{ sub(r.cl) }}</small></span>
          <span :class="['dc-st', status(r).cls]">{{ status(r).text }}</span>
        </button>
        <div v-if="r.totalSlots > 1" class="dc-slots">
          <button v-for="s in r.slots" :key="s.slot" type="button" :class="['dc-slot', slotState(r, s).cls]" @click="open(r, s.slot)">
            {{ s.slot || '時刻なし' }}<small>{{ slotState(r, s).sub }}</small>
          </button>
        </div>
        <div v-else class="dc-bar"><i :style="{ width: (r.total ? Math.round(r.filled / r.total * 100) : 0) + '%' }"></i></div>
        <div class="dc-week" aria-label="この7日">
          <span class="dc-wl">この7日</span>
          <span v-for="w in week(r)" :key="w.date" :class="['dc-w', w.mark]" :title="w.date">{{ WEEK_TXT[w.mark] }}</span>
        </div>
        <button type="button" class="dc-go" @click="open(r)">{{ goLabel(r) }}</button>
      </div>
      <div v-if="openRows.length" class="dc-rows">
        <button v-for="r in openRows" :key="r.cl.id" type="button" class="dc-row" :aria-label="`${r.cl.name}を済ませる`" @click="toggleRow(r)">
          <i class="dc-ck" aria-hidden="true"></i>
          <span class="dc-name"><b>{{ r.cl.name }}</b><small><i :class="['dc-b', badge(r.cl).cls]">{{ badge(r.cl).text }}</i>{{ sub(r.cl) }}</small></span>
          <em class="dc-today">今日</em>
        </button>
      </div>
      <p v-if="rowErr" class="dc-err" role="alert">{{ rowErr }}</p>
      <button v-if="doneList.length" type="button" class="dc-done-h" :aria-expanded="doneOpen" @click="doneOpen = !doneOpen">
        ✓ 済み {{ doneList.length }} {{ doneOpen ? '▲' : '▼' }}
      </button>
      <div v-if="doneOpen && doneList.length" class="dc-rows">
        <button v-for="r in doneList" :key="r.cl.id" type="button" class="dc-row ok" @click="isSimple(r.cl) && r.totalSlots === 1 ? toggleRow(r) : open(r, r.slots[0].slot)">
          <i class="dc-ck" aria-hidden="true">✓</i>
          <span class="dc-name"><b>{{ r.cl.name }}</b><small>{{ lastMark(r)?.by }} {{ lastMark(r) ? hm(lastMark(r).at) : '' }}</small></span>
          <em class="dc-today ok">済み</em>
        </button>
      </div>
      <p v-if="later.length" class="dc-later">これから：<template v-for="(x, i) in later" :key="x.cl.id"><template v-if="i"> ・ </template><b>{{ md(x.date) }}</b> {{ x.cl.name }}</template></p>
      <button type="button" class="dc-set" @click="emit('settings')">⚙ ルーティンを設定</button>
    </template>

    <div v-else-if="showIntro" :class="['dc-first', { leaving }]">
      <button type="button" class="dc-x" aria-label="閉じる（あとで上の入口から作れます）" @click="closeIntro">✕</button>
      <div class="dc-big" aria-hidden="true">🔁</div>
      <b>ルーティンを作りましょう</b>
      <p>毎日・毎週・毎月の決まった仕事です。開店チェックのような表も、「毎月1日に発注書」のような1つだけの仕事も。ここに出て、誰がいつ済ませたか残ります。</p>
      <div class="dc-samp">
        <div v-for="s in CHECKLIST_SAMPLES" :key="s.name" class="dc-samp-i">
          <span><b>{{ s.name }}</b><small>{{ s.summary }}</small></span>
          <button type="button" :disabled="busy" @click="useSample(s)">これで始める</button>
        </div>
      </div>
      <p v-if="err" class="dc-err" role="alert">{{ err }}</p>
      <button type="button" class="dc-own" @click="emit('create')">＋ 自分で作る</button>
    </div>

    <template v-else-if="hasAny || admin">
      <button type="button" :class="['dc-entry', { glow }]" @click="emit('settings')">
        🔁 ルーティン<em>{{ !hasAny ? '＋ 作る' : '今日はなし ・ 設定 ›' }}</em>
      </button>
      <div v-if="toast" class="dc-toast" role="status">☝ ルーティンは、ここからいつでも作れます<small>毎日・毎週・毎月の決まった仕事に</small></div>
    </template>
  </section>
</template>

<style scoped>
.dc { position: relative; display: grid; gap: 8px; padding-top: 8px; }
.dc:empty { display: none; }
.dc-lh { font-size: 11px; font-weight: 800; letter-spacing: .06em; color: var(--text-muted); padding: 4px 4px 0; display: flex; }
.dc-lh em { margin-left: auto; font-style: normal; color: #4f46e5; font-weight: 900; letter-spacing: 0; font-size: 12px; }
.dc-card { background: var(--surface); border: 1px solid #c7d2fe; border-radius: 16px; padding: 11px 12px; display: grid; gap: 8px; box-shadow: 0 2px 6px rgba(79,70,229,.08); }
.dc-card.ok { border-color: #86efac; }
.dc-h { display: flex; align-items: center; gap: 8px; border: none; background: none; padding: 0; font: inherit; color: var(--text); text-align: left; cursor: pointer; }
.dc-name { flex: 1; min-width: 0; display: grid; gap: 1px; }
.dc-name b { font-size: 15.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dc-name small { font-size: 11.5px; color: var(--text-muted); font-weight: 700; }
.dc-st { flex: none; font-size: 12px; font-weight: 900; padding: 4px 9px; border-radius: 999px; background: #eef2ff; color: #3730a3; white-space: nowrap; }
.dc-st.now { background: #fff7ed; color: #c2410c; }
.dc-st.ok { background: #dcfce7; color: #166534; }
.dc-bar { height: 7px; border-radius: 4px; background: #e0e7ff; overflow: hidden; }
.dc-bar i { display: block; height: 100%; background: #4f46e5; transition: width .2s; }
.dc-card.ok .dc-bar i { background: #22c55e; }
.dc-slots { display: flex; gap: 6px; flex-wrap: wrap; }
.dc-slot { flex: 1; min-width: 74px; border-radius: 11px; padding: 6px 4px; border: 1px solid #c7d2fe; background: var(--surface); color: #3730a3; font: inherit; font-size: 12.5px; font-weight: 900; line-height: 1.35; cursor: pointer; }
.dc-slot small { display: block; font-size: 10.5px; font-weight: 700; }
.dc-slot.ok { background: #dcfce7; border-color: #86efac; color: #166534; }
.dc-slot.late { background: #fee2e2; border-color: #fca5a5; color: #b91c1c; }
.dc-slot.now { background: #4f46e5; border-color: #4f46e5; color: #fff; box-shadow: 0 4px 10px rgba(79,70,229,.3); }
.dc-slot.later { background: #f8fafc; color: #94a3b8; border-style: dashed; }
.dc-week { display: flex; align-items: center; gap: 5px; white-space: nowrap; }
.dc-wl { font-size: 10.5px; color: var(--text-muted); font-weight: 700; margin-right: 2px; }
.dc-w { width: 20px; height: 20px; border-radius: 6px; display: grid; place-items: center; font-size: 10px; font-weight: 900; color: #fff; box-sizing: border-box; }
.dc-w.y { background: #22c55e; } .dc-w.n { background: #fca5a5; } .dc-w.o { background: #e2e8f0; }
.dc-w.t { background: var(--surface); border: 2px dashed #a5b4fc; color: #4f46e5; }
.dc-go { min-height: 44px; border: none; border-radius: 11px; background: #4f46e5; color: #fff; font: inherit; font-size: 14px; font-weight: 900; cursor: pointer; }
.dc-name small { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.dc-b { font-style: normal; font-size: 10.5px; font-weight: 900; color: #fff; background: #4f46e5; border-radius: 6px; padding: 1px 6px; }
.dc-b.weekly { background: #0e7490; } .dc-b.monthly { background: #c2410c; } .dc-b.none { background: #64748b; }
.dc-rows { background: var(--surface); border: 1px solid #c7d2fe; border-radius: 14px; padding: 0 12px; }
.dc-row { width: 100%; display: flex; align-items: center; gap: 10px; min-height: 54px; border: none; border-top: 1px solid #eef2ff; background: none; font: inherit; color: var(--text); text-align: left; cursor: pointer; padding: 6px 0; }
.dc-row:first-child { border-top: none; }
.dc-ck { flex: none; width: 26px; height: 26px; border-radius: 8px; border: 3px solid #a5b4fc; box-sizing: border-box; display: grid; place-items: center; font-style: normal; color: #fff; font-size: 14px; font-weight: 900; }
.dc-row.ok .dc-ck { background: #22c55e; border-color: #22c55e; }
.dc-row.ok b { color: #94a3b8; text-decoration: line-through; }
.dc-today { flex: none; font-style: normal; font-size: 11px; font-weight: 900; padding: 3px 8px; border-radius: 999px; background: #eef2ff; color: #3730a3; }
.dc-today.ok { background: #dcfce7; color: #166534; }
.dc-done-h { justify-self: start; border: none; background: none; font: inherit; font-size: 12.5px; font-weight: 800; color: #166534; padding: 2px 4px; cursor: pointer; }
.dc-later { margin: 0; font-size: 12px; font-weight: 700; color: var(--text-muted); padding: 0 4px; }
.dc-later b { color: #3730a3; }
.dc-set { justify-self: center; border: none; background: none; font: inherit; font-size: 12.5px; font-weight: 800; color: #4f46e5; padding: 4px 8px; cursor: pointer; }
.dc-first { position: relative; background: var(--surface); border: 2px dashed #a5b4fc; border-radius: 16px; padding: 14px; display: grid; gap: 9px; text-align: center; transform-origin: top center; transition: transform .45s ease-in, opacity .45s ease-in; }
.dc-first.leaving { transform: translateY(-20px) scale(.12, .08); opacity: 0; }
.dc-first > b { font-size: 16px; }
.dc-first > p { margin: 0; font-size: 12.5px; color: var(--text-muted); line-height: 1.6; }
.dc-big { font-size: 28px; color: #4f46e5; }
.dc-x { position: absolute; top: 8px; right: 8px; width: 32px; height: 32px; border-radius: 50%; border: none; background: #f1f5f9; color: #64748b; font-weight: 900; cursor: pointer; }
.dc-samp { display: grid; gap: 7px; }
.dc-samp-i { display: flex; align-items: center; gap: 8px; border: 1px solid #c7d2fe; background: #eef2ff; border-radius: 12px; padding: 10px 12px; text-align: left; }
.dc-samp-i span { flex: 1; display: grid; gap: 2px; color: #3730a3; font-size: 13.5px; }
.dc-samp-i small { font-size: 11.5px; color: var(--text-muted); font-weight: 600; }
.dc-samp-i button { flex: none; border: none; border-radius: 9px; background: #4f46e5; color: #fff; font: inherit; font-size: 12.5px; font-weight: 800; padding: 8px 10px; cursor: pointer; }
.dc-own { justify-self: center; border: none; background: none; font: inherit; font-size: 13px; font-weight: 800; color: #4f46e5; cursor: pointer; padding: 4px; }
.dc-err { margin: 0; font-size: 12.5px; color: #b91c1c; font-weight: 700; }
.dc-entry { display: flex; align-items: center; gap: 8px; background: var(--surface); border: 1px solid #c7d2fe; border-radius: 12px; padding: 10px 12px; font: inherit; font-size: 13.5px; font-weight: 800; color: #3730a3; cursor: pointer; transition: box-shadow .3s; }
.dc-entry em { margin-left: auto; font-style: normal; font-size: 12px; background: #eef2ff; border-radius: 999px; padding: 3px 10px; }
.dc-entry.glow { box-shadow: 0 0 0 4px rgba(99,102,241,.35), 0 0 18px rgba(99,102,241,.5); }
.dc-toast { position: absolute; left: 4px; right: 4px; top: calc(100% + 6px); z-index: 4; background: #1e1b4b; color: #fff; border-radius: 12px; padding: 11px 13px; font-size: 13px; font-weight: 800; line-height: 1.5; box-shadow: 0 8px 20px rgba(0,0,0,.25); animation: dc-in .25s ease-out; }
.dc-toast small { display: block; font-weight: 600; opacity: .8; font-size: 11.5px; }
@keyframes dc-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
</style>
