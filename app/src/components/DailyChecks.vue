<script setup>
/**
 * 日誌のリストの一番上「ルーティン」（毎日・毎週・毎月の決まった仕事。User決定 2026-10-19 → 2026-10-22 に
 * 「毎日のチェック」から改名・モック docs/mocks/journal-routine.html）。
 * - 今日の分をリングの丸で横に1段（2026-10-23・モック docs/mocks/journal-today-modern.html）。毎日・曜日・月末が重なっても
 *   丸が増えるだけで高さは変わらない。まだ → 済みの順（時刻のあるものは時刻順）。リングは進み具合、下の札は「毎日／土・日／月末／1日3回」
 *   丸を押すと: 項目なしの1件はその場で済む・取り消し、ほかは✓の画面（今やる回）
 * - 「すべて」で格子のシート: 内訳（毎日・毎週・毎月）・全部の丸・これから・記録へ
 * - まだ1つも無い店: 管理者にだけ「作りましょう」のカード（見本を押すだけで始まる）。
 *   ×で消すと、カードが縮んで上の入口へ吸い込まれ、「ここからいつでも作れます」と出て終わる（端末ごとに覚える・useHints）
 * - 以後は入口の1行だけ（押すと一覧・作る）。スタッフで表が1つも無いときは何も出さない
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { checklists, checklistsForDay, canEditChecklists, startFromSample, markChecklistItem, canMarkChecklist, canUnmark, CHECKLIST_SAMPLES } from '../composables/useChecklists.js'
import { currentSlot, repeatLabel, repeatKind, isSimple, upcoming, WHOLE } from '../services/checklistSchedule.js'
import { isHintShown, dismissHint } from '../composables/useHints.js'
import { localDateKey } from '../utils/localDate.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

const emit = defineEmits(['open-run', 'settings', 'create', 'records'])
const INTRO_HINT = 'daily-check-intro'

const today = localDateKey()
const nowHm = ref('')
let timer = null
function _tick() { const d = new Date(); nowHm.value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
onMounted(() => { _tick(); timer = setInterval(_tick, 60000) })
onUnmounted(() => { clearInterval(timer); clearTimeout(_t1); clearTimeout(_t2) })

const days = computed(() => checklistsForDay(today))
const doneCount = computed(() => days.value.filter(r => r.complete).length)
const later = computed(() => upcoming(checklists.value, today, { skip: new Set(days.value.map(r => r.cl.id)) }))
// リング: まだ（時刻の順のまま）→ 済み
const ordered = computed(() => [...days.value.filter(r => !r.complete), ...days.value.filter(r => r.complete)])
const pct = r => (r.complete ? 100 : r.totalSlots > 1 ? Math.round(r.doneSlots / r.totalSlots * 100) : r.total ? Math.round(r.filled / r.total * 100) : 0)
const _emojiRe = /^(\p{Extended_Pictographic}(\uFE0F)?)/u
const icon = cl => cl.name.match(_emojiRe)?.[1] ?? cl.name.slice(0, 1)
const label = cl => cl.name.replace(_emojiRe, '').trim()
const _wdays = cl => String(cl.repeatDays ?? '').split(',').filter(Boolean).length
// 札は丸の幅に収める（曜日が4つ以上なら「週5日」）
const ringBadge = r => (r.totalSlots > 1 ? `1日${r.totalSlots}回` : r.cl.repeat === 'monthly' ? repeatLabel(r.cl).replace('毎月', '')
  : r.cl.repeat === 'weekly' && _wdays(r.cl) > 3 ? `週${_wdays(r.cl)}日` : repeatLabel(r.cl))
onUnmounted(registerInnerLayerCloser(() => { if (!allOpen.value) return false; allOpen.value = false; return true }))
function tapRing(r) { if (isSimple(r.cl) && r.totalSlots === 1) toggleRow(r); else open(r) }
const allOpen = ref(false)
const counts = computed(() => ({ daily: days.value.filter(r => r.cl.repeat === 'daily').length, weekly: days.value.filter(r => r.cl.repeat === 'weekly').length, monthly: days.value.filter(r => r.cl.repeat === 'monthly').length }))
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
/** 札の色（種類ごと） */
const badge = cl => ({ cls: repeatKind(cl) })
const md = k => { const d = new Date(k + 'T00:00:00'); const diff = Math.round((d - new Date(today + 'T00:00:00')) / 86400000); return diff < 7 ? WEEK[d.getDay()] : `${d.getMonth() + 1}/${d.getDate()}` }
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

function open(r, slot = null) {
  const s = slot ?? currentSlot(r, nowHm.value)?.slot ?? r.slots[0].slot
  emit('open-run', { cl: r.cl, date: today, slot: s })
}
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
      <div class="dc-lh"><span>🔁 ルーティン</span><em v-if="days.length">{{ doneCount }} / {{ days.length }}</em><button type="button" class="dc-all" @click="allOpen = true">すべて ›</button></div>
      <div v-if="days.length" class="dc-rings" role="list">
        <button v-for="r in ordered" :key="r.cl.id" type="button" role="listitem" :class="['dc-ring', { ok: r.complete }]"
          :aria-label="`${r.cl.name} ${r.complete ? '済み' : `${pct(r)}%`}`" @click="tapRing(r)">
          <span class="dc-c" :style="{ background: `conic-gradient(${r.complete ? '#22c55e' : '#4f46e5'} 0 ${pct(r)}%, #e2e8f0 0)` }">
            <span class="dc-ic">{{ r.complete ? '✓' : icon(r.cl) }}</span>
            <i :class="['dc-rb', badge(r.cl).cls]">{{ ringBadge(r) }}</i>
          </span>
          <span class="dc-rn">{{ label(r.cl) }}</span>
        </button>
      </div>
      <p v-else class="dc-later">今日はなし。これから：<template v-for="(x, i) in later" :key="x.cl.id"><template v-if="i"> ・ </template><b>{{ md(x.date) }}</b> {{ x.cl.name }}</template></p>
      <p v-if="rowErr" class="dc-err" role="alert">{{ rowErr }}</p>
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

    <Teleport to="body">
      <div v-if="allOpen" class="dc-sheet-bg" @click.self="allOpen = false">
        <div class="dc-sheet" role="dialog" aria-label="今日のルーティン">
          <div class="dc-sh"><b>🔁 今日のルーティン</b><em>{{ days.length - doneCount }} 残り / {{ days.length }}</em></div>
          <div class="dc-cnt">
            <span v-if="counts.daily" class="daily">毎日 {{ counts.daily }}</span><span v-if="counts.weekly" class="weekly">毎週 {{ counts.weekly }}</span><span v-if="counts.monthly" class="monthly">毎月 {{ counts.monthly }}</span>
          </div>
          <div class="dc-grid">
            <button v-for="r in ordered" :key="r.cl.id" type="button" :class="['dc-ring', { ok: r.complete }]" @click="tapRing(r)">
              <span class="dc-c" :style="{ background: `conic-gradient(${r.complete ? '#22c55e' : '#4f46e5'} 0 ${pct(r)}%, #e2e8f0 0)` }">
                <span class="dc-ic">{{ r.complete ? '✓' : icon(r.cl) }}</span>
                <i :class="['dc-rb', badge(r.cl).cls]">{{ ringBadge(r) }}</i>
              </span>
              <span class="dc-rn">{{ label(r.cl) }}</span>
            </button>
          </div>
          <p v-if="later.length" class="dc-later">これから：<template v-for="(x, i) in later" :key="x.cl.id"><template v-if="i"> ・ </template><b>{{ md(x.date) }}</b> {{ x.cl.name }}</template></p>
          <p class="dc-hint">丸を押すと✓の画面。項目なしは押すだけで済む</p>
          <div class="dc-sbtn">
            <button type="button" @click="allOpen = false; emit('records')">📅 記録を見る</button>
            <button type="button" @click="allOpen = false; emit('settings')">⚙ 設定</button>
          </div>
        </div>
      </div>
    </Teleport>
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
.dc-all { margin-left: 8px; border: none; background: none; font: inherit; font-size: 12px; font-weight: 800; color: #4f46e5; cursor: pointer; padding: 0; letter-spacing: 0; }
.dc-lh em { margin-left: 6px !important; color: var(--text-muted) !important; }
.dc-lh .dc-all { margin-left: auto; }
.dc-rings { display: flex; gap: 12px; overflow-x: auto; padding: 4px 2px 6px; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.dc-rings::-webkit-scrollbar { display: none; }
.dc-ring { flex: none; width: 66px; display: grid; justify-items: center; gap: 5px; border: none; background: none; padding: 0; font: inherit; cursor: pointer; color: var(--text); }
.dc-c { position: relative; width: 60px; height: 60px; border-radius: 50%; display: grid; place-items: center; }
.dc-ic { width: 50px; height: 50px; border-radius: 50%; background: var(--surface); display: grid; place-items: center; font-size: 22px; font-weight: 900; color: #4f46e5; }
.dc-ring.ok .dc-ic { background: #f0fdf4; color: #16a34a; }
.dc-rb { position: absolute; bottom: -4px; left: 50%; transform: translateX(-50%); font-style: normal; font-size: 9px; font-weight: 900; color: #fff; background: #4f46e5; border-radius: 6px; padding: 1px 5px; white-space: nowrap; max-width: 76px; overflow: hidden; text-overflow: ellipsis; }
.dc-rb.weekly { background: #0e7490; } .dc-rb.monthly { background: #c2410c; } .dc-rb.none { background: #64748b; }
.dc-rn { max-width: 66px; font-size: 10.5px; font-weight: 800; line-height: 1.2; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: #334155; }
.dc-ring.ok .dc-rn { color: #94a3b8; }
.dc-sheet-bg { position: fixed; inset: 0; z-index: 121; background: rgba(15,23,42,.38); display: flex; align-items: flex-end; justify-content: center; }
.dc-sheet { width: 100%; max-width: 600px; max-height: 86vh; overflow-y: auto; background: var(--surface); border-radius: 24px 24px 0 0; padding: 16px 16px calc(18px + env(safe-area-inset-bottom)); display: grid; gap: 12px; box-sizing: border-box; }
.dc-sh { display: flex; align-items: baseline; } .dc-sh b { font-size: 17px; } .dc-sh em { margin-left: auto; font-style: normal; font-size: 12px; font-weight: 800; color: var(--text-muted); }
.dc-cnt { display: flex; gap: 6px; } .dc-cnt span { font-size: 11px; font-weight: 900; padding: 3px 9px; border-radius: 999px; background: #eef2ff; color: #3730a3; }
.dc-cnt .weekly { background: #ccfbf1; color: #115e59; } .dc-cnt .monthly { background: #ffedd5; color: #9a3412; }
.dc-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px 6px; justify-items: center; }
.dc-hint { margin: 0; font-size: 11.5px; color: var(--text-muted); font-weight: 700; text-align: center; }
.dc-sbtn { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.dc-sbtn button { min-height: 44px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); font: inherit; font-size: 13.5px; font-weight: 800; color: var(--text); cursor: pointer; }
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
