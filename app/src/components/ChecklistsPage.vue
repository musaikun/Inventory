<script setup>
/**
 * 定期（以前のルーティン）の一覧・記録（全画面・User決定 2026-10-19 / 2026-10-22・モック docs/mocks/journal-routine.html ③④）。
 * - 一覧: 毎日・毎週・毎月・1回だけに分けて並べる。「1つだけ」か「◯項目」か。お休み中は薄く（見本はやめた・User決定 2026-11-07）
 * - 作る・直すは「＋」と同じ追加の画面（TaskAddSheet）。直す・お休み・消すもそこで（User決定 2026-11-11）。ここは emit('edit') するだけ
 * - 記録: 日ごとに1行。未完了・手つかずは赤で残す（持ち越さない）。「今日はなし」は理由つき
 * - スタッフも作れる（やることを作れる人・2026-11-05）。直すのは作った人と管理者
 */
import { ref, computed, onUnmounted } from 'vue'
import {
  checklists, checklistRuns, canEditChecklists, canEditChecklist,
} from '../composables/useChecklists.js'
import { checklistHistory, whenLabel, slotsOf, repeatKind, isSimple } from '../services/checklistSchedule.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

const props = defineProps({
  historyOf: { type: Object, default: null },   // 開いたらすぐこの表の記録
})
// 作るのは日誌の「＋」と同じ追加の画面（入口を1つに・2026-11-05）。親が TaskAddSheet を開く
const emit = defineEmits(['close', 'open-run', 'add', 'edit'])

const view = ref(props.historyOf ? 'history' : 'list')   // list | history
const direct = !!props.historyOf   // 外から1つの画面を開いた（戻るで閉じる）
const target = ref(props.historyOf)
const err = ref('')
const lists = computed(() => [...checklists.value].sort((a, b) => (a.paused ? 1 : 0) - (b.paused ? 1 : 0) || (slotsOf(a)[0] || '99').localeCompare(slotsOf(b)[0] || '99')))
const GROUPS = [['daily', '毎日'], ['weekly', '毎週'], ['monthly', '毎月'], ['none', '1回だけ']]
const groups = computed(() => GROUPS.map(([k, label]) => ({ k, label, items: lists.value.filter(cl => repeatKind(cl) === k) })).filter(g => g.items.length))
const WEEK = ['日', '月', '火', '水', '木', '金', '土']

// ── 直す: 作るのと同じ追加の画面（TaskAddSheet）で。親が開く（User決定 2026-11-11）──

// ── 記録 ──
function openHistory(cl) { target.value = cl; view.value = 'history' }
const history = computed(() => (target.value ? checklistHistory(target.value, checklistRuns.value, { days: 60 }) : []))
const md = date => { const d = new Date(date + 'T00:00:00'); return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）` }
const hm = iso => { const d = new Date(iso); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` }
// 1日に何回もの表は回の数（済み 2/3回）、1回の表は項目の数
function badge(h) {
  if (isSimple(h.cl) && h.totalSlots === 1) return h.status === 'done' ? '済' : h.status === 'open' ? 'まだ' : 'やっていない'
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
onUnmounted(registerInnerLayerCloser(() => { back(); return true }))
const title = computed(() => (view.value === 'history' ? `${target.value?.name ?? ''}の記録` : '定期'))
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
        <p class="cp-lead">毎日・毎週・毎月の決まった仕事です。その日の業務管理に出て、誰がいつ済ませたか残ります。</p>
        <template v-for="g in groups" :key="g.k">
        <div class="cp-grp">{{ g.label }}</div>
        <div v-for="cl in g.items" :key="cl.id" :class="['cp-card', { off: cl.paused }]">
          <div class="cp-card-h"><b>{{ cl.name }}</b>
            <button v-if="canEditChecklist(cl)" type="button" class="cp-link" @click="emit('edit', cl)">直す ›</button>
          </div>
          <div class="cp-meta">
            <span :class="['cp-pill', { off: cl.paused }]">{{ cl.paused ? 'お休み中' : whenLabel(cl) }}</span>
            <span v-if="!cl.paused && slotsOf(cl).length > 1">1日{{ slotsOf(cl).length }}回</span>
            <span v-else-if="!cl.paused && !slotsOf(cl)[0]">時刻なし</span>
            <span>{{ cl.assign === 'person' ? cl.assigneeName : '全員' }}</span>
            <span>{{ isSimple(cl) ? '1つだけ' : `${cl.items.length}項目` }}</span>
            <button type="button" class="cp-link" @click="openHistory(cl)">記録</button>
          </div>
        </div>
        </template>
        <p v-if="!lists.length" class="cp-empty">まだ定期はありません</p>
        <template v-if="canEditChecklists">
          <button type="button" class="cp-add" @click="emit('add')">＋ 自分で作る</button>
          <p v-if="err" class="cp-err" role="alert">{{ err }}</p>
        </template>
        <p v-else class="cp-empty">作る・直すのは管理者です</p>
      </div>


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
.cp-pill.off { background: #f1f5f9; color: #64748b; }
.cp-link { border: none; background: none; font: inherit; font-size: 12.5px; font-weight: 800; color: var(--primary); cursor: pointer; padding: 4px 2px; }
.cp-add { border: 2px dashed #a5f3fc; border-radius: 14px; padding: 12px; background: var(--surface); font: inherit; font-size: 14px; font-weight: 900; color: var(--primary); cursor: pointer; }
.cp-add.small { padding: 8px; font-size: 13px; border-width: 1px; border-radius: 10px; }
.cp-add:disabled { opacity: .5; }
.cp-empty { margin: 0; padding: 10px 4px; text-align: center; font-size: 12.5px; color: var(--text-muted); }
.cp-err { margin: 0; font-size: 12.5px; color: #b91c1c; font-weight: 700; }
.cp-grp { font-size: 11px; font-weight: 900; letter-spacing: .06em; color: var(--text-muted); padding: 6px 4px 0; }
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
