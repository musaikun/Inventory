<script setup>
/**
 * ホームの「店の今」（User決定 2026-11-08・モック docs/mocks/home-now.html の ①② だけ）。
 * ① 今日の流れ（人×時間の小さなガント・今の線）② 進行中（作った日→締め切りの棒・手順の進み）。
 * どちらも出すものが無ければカードごと出さない。並べ方は services/homeNow.js
 * 押したとき（User 2026-11-08）: 帯・進行中の行 → その業務の中身（@item）。見出し・帯の無い所 → 今日の予定ボード（@open）。
 * 今日のやることのカードは今日の一覧へ行くので、行き先を分けている
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { tasksOn, progressTasks, isStale } from '../composables/useTasks.js'
import { checklistsForDay } from '../composables/useChecklists.js'
import { todayFlow, progressBars } from '../services/homeNow.js'
import { localDateKey } from '../utils/localDate.js'

const emit = defineEmits(['open', 'item'])
const onItem = (ref, e) => { e.stopPropagation(); emit('item', ref) }

const nowHm = ref('')
const _tick = () => { const d = new Date(); nowHm.value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
_tick()
let timer = null
onMounted(() => { timer = setInterval(_tick, 60_000) })
onUnmounted(() => clearInterval(timer))

const today = computed(() => { nowHm.value; return localDateKey() })   // 日をまたいだら今日も変わる
const flow = computed(() => todayFlow({ tasks: tasksOn(today.value), checklists: checklistsForDay(today.value), now: nowHm.value }))
const prog = computed(() => progressBars(progressTasks.value, today.value, isStale))
const shown = computed(() => flow.value.rows.length || prog.value.items.length)

const pct = m => ((Math.min(flow.value.to, Math.max(flow.value.from, m)) - flow.value.from) / (flow.value.to - flow.value.from)) * 100
const hours = computed(() => {
  const out = []
  const step = flow.value.to - flow.value.from > 600 ? 180 : 120
  for (let m = flow.value.from; m <= flow.value.to; m += step) if (Math.abs(pct(m) - pct(flow.value.now)) > 7) out.push({ m, h: m / 60 })
  return out
})
const nowLabel = computed(() => nowHm.value.replace(/^0/, ''))
const STATE = { done: '済み', now: '今', late: '遅れ', plan: 'これから' }
const md = k => (k ? `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}` : '')
const initial = n => (n || '?').slice(0, 1)
</script>

<template>
  <section v-if="shown" class="hn" aria-label="店の今" @click="emit('open')">
    <button type="button" class="hn-h" aria-label="今日の予定ボードを開く" @click.stop="emit('open')"><b>店の今</b><i>予定ボード ›</i></button>

    <template v-if="flow.rows.length">
      <span class="hn-sec">今日の流れ</span>
      <span class="hn-gt">
        <span></span>
        <span class="hn-ax"><span v-for="x in hours" :key="x.m" :style="{ left: pct(x.m) + '%' }">{{ x.h }}</span><em :style="{ left: pct(flow.now) + '%' }">{{ nowLabel }}</em></span>
        <template v-for="r in flow.rows" :key="r.key">
          <span class="hn-who"><i class="av">{{ initial(r.name) }}</i>{{ r.name }}</span>
          <span class="hn-row">
            <button v-for="b in r.blocks" :key="b.key" type="button" :class="['hn-bar', b.state]" :data-state="b.state"
              :style="{ left: pct(b.start) + '%', width: Math.max(2.5, pct(b.end) - pct(b.start)) + '%' }"
              :title="`${b.text}（${STATE[b.state]}）`" :aria-label="`${b.text}（${STATE[b.state]}）を開く`" @click="onItem(b.ref, $event)">{{ pct(b.end) - pct(b.start) > 12 ? b.text : '' }}</button>
            <i class="hn-now" :style="{ left: pct(flow.now) + '%' }"></i>
          </span>
        </template>
      </span>
      <span v-if="flow.more" class="hn-more">ほか {{ flow.more }}人</span>
      <span class="hn-leg"><span><i class="done"></i>済み</span><span><i class="now"></i>今</span><span><i class="late"></i>遅れ</span><span><i class="plan"></i>これから</span></span>
    </template>

    <template v-if="prog.items.length">
      <span class="hn-sec">進行中</span>
      <button v-for="p in prog.items" :key="p.id" type="button" :class="['hn-pg', p.over ? 'over' : p.stale ? 'stale' : p.waiting ? 'wait' : 'doing', { fut: p.future }]" :data-id="p.id" :aria-label="`${p.text}を開く`" @click="onItem({ type: 'progress', id: p.id }, $event)">
        <span class="hn-pt">
          <span class="t">{{ p.text }}</span>
          <em v-if="p.over" class="r">締め切り過ぎ</em><em v-else-if="p.stale">止まっている</em><em v-else-if="p.waiting" class="w">待ち</em>
          <small>{{ [p.who, p.total ? `手順 ${p.done}/${p.total}` : ''].filter(Boolean).join('・') }}</small>
        </span>
        <span class="hn-pb"><i :style="{ width: (p.total ? p.done / p.total * 100 : 0) + '%' }"></i><b v-if="p.pos !== null" :style="{ left: p.pos * 100 + '%' }"></b></span>
        <span class="hn-pm"><span>{{ p.future ? `${md(p.start)}から` : md(p.start) }}</span><span>{{ p.deadline ? `${md(p.deadline)}まで` : '締め切りなし' }}</span></span>
      </button>
      <span v-if="prog.more" class="hn-more">ほか {{ prog.more }}件</span>
    </template>
  </section>
</template>

<style scoped>
.hn { position: relative; z-index: 1; width: calc(100% - 28px); margin: 12px 14px 0; border: none; border-radius: 20px; background: var(--surface, #fff); box-shadow: 0 8px 22px rgba(6,34,43,.1);
  padding: 14px; display: grid; gap: 8px; text-align: left; font: inherit; color: var(--text); cursor: pointer; box-sizing: border-box; }
.hn-h { display: flex; align-items: center; border: none; background: none; padding: 0; font: inherit; color: inherit; text-align: left; cursor: pointer; min-height: 32px; }
.hn-h b { flex: 1; font-size: 15px; }
.hn-h i { font-style: normal; font-size: 12px; font-weight: 800; color: var(--primary, #0e7490); }
.hn-sec { display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 900; color: var(--text-muted); padding-top: 2px; }
.hn-sec::after { content: ''; flex: 1; height: 1px; background: #e2ecef; }
.hn-gt { display: grid; grid-template-columns: 64px minmax(0, 1fr); column-gap: 4px; row-gap: 5px; }
.hn-ax { position: relative; height: 14px; font-size: 9.5px; font-weight: 800; color: #94a3b8; }
.hn-ax span, .hn-ax em { position: absolute; transform: translateX(-50%); white-space: nowrap; }
.hn-ax em { font-style: normal; font-weight: 900; color: #dc2626; }
.hn-who { display: flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.av { flex: none; width: 20px; height: 20px; border-radius: 50%; background: #e2e8f0; display: inline-flex; align-items: center; justify-content: center; font-style: normal; font-size: 10px; font-weight: 900; }
.hn-row { position: relative; height: 24px; border-radius: 6px; background: #f1f6f8; }
.hn-bar { position: absolute; top: 3px; bottom: 3px; border: none; font-family: inherit; cursor: pointer; min-width: 10px; border-radius: 6px; padding: 0 5px; display: flex; align-items: center; overflow: hidden; white-space: nowrap; font-size: 10px; font-weight: 800; color: #fff; box-sizing: border-box; }
.hn-bar.done { background: #16a34a; } .hn-bar.now { background: #0e7490; box-shadow: 0 0 0 2px #a5f3fc; } .hn-bar.late { background: #dc2626; } .hn-bar.plan { background: #3b82f6; }
.hn-now { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; background: #dc2626; z-index: 1; pointer-events: none; }
.hn-leg { display: flex; gap: 10px; flex-wrap: wrap; font-size: 10.5px; font-weight: 700; color: var(--text-muted); }
.hn-leg i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 3px; vertical-align: -1px; }
.hn-leg i.done { background: #16a34a; } .hn-leg i.now { background: #0e7490; } .hn-leg i.late { background: #dc2626; } .hn-leg i.plan { background: #3b82f6; }
.hn-more { font-size: 11px; font-weight: 800; color: var(--text-muted); }
.hn-pg { display: grid; gap: 4px; width: 100%; border: none; background: none; padding: 4px 0; margin: -4px 0; font: inherit; color: inherit; text-align: left; cursor: pointer; border-radius: 8px; }
.hn-pg:active { background: #f3f8fa; }
.hn-pt { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 13px; font-weight: 800; }
.hn-pt .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hn-pt em { flex: none; font-style: normal; font-size: 10px; font-weight: 900; border-radius: 6px; padding: 1px 6px; background: var(--c); color: #fff; }
.hn-pt small { flex: none; font-size: 11px; font-weight: 800; color: var(--text-muted); }
/* 色は業務管理のカレンダーの帯と同じ（User 2026-11-08）: 進行中 青・待ち 灰・止まっている 黄・締め切り過ぎ 赤。未開始は薄く。
   棒の地はその色を薄く、塗りは手順の進み。今日の印は濃い線 */
.hn-pg { --c: #3b82f6; --w: #dbeafe; }
.hn-pg.wait { --c: #64748b; --w: #e2e8f0; } .hn-pg.stale { --c: #d97706; --w: #fdecc8; } .hn-pg.over { --c: #dc2626; --w: #fde2e2; }
.hn-pg.fut .hn-pb { opacity: .55; }
.hn-pb { position: relative; height: 10px; border-radius: 5px; background: var(--w); }
.hn-pb i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 5px; background: var(--c); }
.hn-pb b { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; background: #12303a; }
.hn-pm { display: flex; justify-content: space-between; font-size: 10.5px; font-weight: 700; color: #94a3b8; }
</style>
