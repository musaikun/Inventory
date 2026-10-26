<script setup>
/**
 * 押した日のマスが広がって、その日の中身をタイムラインで見せる（User決定 2026-10-26・モック キャンバス「日誌カレンダー」①）。
 * 上: 日付・曜日・ひとこと・済みのリング・前後の日。時刻のないものは「終日」、ほかは縦の線に時刻の順。今日は「いま」の線
 * 丸を押すと済む（押せるものだけ）、行を押すと中身（✓の画面・直す・進行中・棚卸の詳細）。右下の＋でこの日に追加
 * 見せるだけの部品。行の組み立ては services/dayTimeline.js、押したあとは親（JournalPage）
 */
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

const props = defineProps({
  date: { type: String, required: true },
  today: { type: String, required: true },
  origin: { type: Object, default: null },   // { col, row, rows } 広がり始めるマス
  timeline: { type: Object, required: true },
  canAdd: { type: Boolean, default: false },
  closed: { type: Boolean, default: false },
})
const emit = defineEmits(['close', 'step', 'add', 'open', 'check', 'memo'])
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const d = computed(() => new Date(props.date + 'T00:00:00'))
const isToday = computed(() => props.date === props.today)
const future = computed(() => props.date > props.today)
const tl = computed(() => props.timeline)
const empty = computed(() => !tl.value.allDay.length && !tl.value.timed.length)
const sub = computed(() => {
  if (isToday.value) return '今日'
  if (future.value) return '予定'
  if (!tl.value.count) return empty.value ? '記録なし' : ''
  return tl.value.done === tl.value.count ? '全部済み' : tl.value.done ? '一部やり残し' : 'やり残しあり'
})
const pct = computed(() => (tl.value.count ? Math.round(tl.value.done / tl.value.count * 100) : 0))
const ringColor = computed(() => (tl.value.done === tl.value.count ? '#22a55a' : future.value ? '#9fb3ba' : '#e89b0c'))
const origin = computed(() => {
  const o = props.origin
  return o ? `${((o.col + 0.5) / 7 * 100).toFixed(1)}% ${((o.row + 0.5) / o.rows * 100).toFixed(1)}%` : '50% 30%'
})
const nowHm = ref('')
let timer = null
const _tick = () => { const n = new Date(); nowHm.value = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}` }
onMounted(() => { _tick(); timer = setInterval(_tick, 60000) })
onUnmounted(() => clearInterval(timer))
// 「いま」の線は、いまの時刻を過ぎた最後の行の下
const nowAfter = computed(() => (isToday.value ? tl.value.timed.reduce((n, x, i) => (x.time <= nowHm.value ? i : n), -1) : -2))
const DOT = { done: '✓', missed: '!', todo: '', live: '', plan: '', info: '' }
const canCheck = x => (x.ref.type === 'task' || x.ref.type === 'list') && x.state !== 'plan'
onUnmounted(registerInnerLayerCloser(() => { emit('close'); return true }))
</script>

<template>
  <section class="dt" :style="{ transformOrigin: origin }" :aria-label="`${d.getMonth() + 1}月${d.getDate()}日の中身`">
    <div class="dt-h">
      <button type="button" class="dt-b" aria-label="月にもどる" @click="emit('close')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"></rect><path d="M4 10h16"></path></svg>
      </button>
      <div class="dt-t">
        <div><b>{{ d.getMonth() + 1 }}月{{ d.getDate() }}日</b><span>（{{ WEEK[d.getDay()] }}）</span></div>
        <small>{{ closed ? '休み' : sub }}</small>
      </div>
      <button v-if="!tl.allDay.some(x => x.ref.type === 'note')" type="button" class="dt-b sm" aria-label="メモ" @click="emit('memo')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"></path></svg>
      </button>
      <span v-if="tl.count" class="dt-ring" :style="{ background: `conic-gradient(${ringColor} 0 ${pct}%, #e3ecef 0)` }"><i>{{ tl.done }}/{{ tl.count }}</i></span>
      <button type="button" class="dt-b sm" aria-label="前の日" @click="emit('step', -1)">‹</button>
      <button type="button" class="dt-b sm" aria-label="次の日" @click="emit('step', 1)">›</button>
    </div>

    <div class="dt-body">
      <div v-if="tl.allDay.length" class="dt-all">
        <span class="dt-lab">終日</span>
        <div v-for="x in tl.allDay" :key="x.key" :class="['dt-ad', x.state, x.ref.type]">
          <button type="button" class="dt-dot" :class="x.state" :disabled="!canCheck(x)" :aria-label="`${x.title}${x.state === 'done' ? ' 済み' : ''}`" @click="emit('check', x)">{{ DOT[x.state] }}</button>
          <button type="button" class="dt-ct" @click="emit('open', x)">
            <b>{{ x.title }}</b><small v-if="x.sub">{{ x.sub }}</small>
          </button>
          <span :class="['dt-k', x.kind]">{{ x.kind }}</span>
        </div>
      </div>

      <template v-for="(x, i) in tl.timed" :key="x.key">
        <div class="dt-row" :style="{ animationDelay: `${0.1 + i * 0.03}s` }">
          <span class="dt-tm">{{ x.time.replace(/^0/, '') }}</span>
          <div class="dt-rail"><button type="button" class="dt-dot" :class="x.state" :disabled="!canCheck(x)" :aria-label="`${x.title}${x.state === 'done' ? ' 済み' : ''}`" @click="emit('check', x)">{{ DOT[x.state] }}</button></div>
          <button type="button" :class="['dt-card', x.state]" @click="emit('open', x)">
            <span class="dt-l1"><span :class="['dt-k', x.kind]">{{ x.kind }}</span><b>{{ x.title }}</b></span>
            <small v-if="x.sub">{{ x.sub }}</small>
          </button>
        </div>
        <div v-if="i === nowAfter" class="dt-now"><span>{{ nowHm.replace(/^0/, '') }}</span><i></i><em></em></div>
      </template>
      <div v-if="isToday && nowAfter === -1 && tl.timed.length" class="dt-now first"><span>{{ nowHm.replace(/^0/, '') }}</span><i></i><em></em></div>

      <p v-if="empty" class="dt-empty">この日はなし</p>
    </div>

    <button v-if="canAdd" type="button" class="dt-fab" aria-label="この日に追加" @click="emit('add')">＋</button>
  </section>
</template>

<style scoped>
.dt { position: absolute; inset: 0; z-index: 8; display: flex; flex-direction: column; background: #f4f7f8; box-shadow: 0 10px 30px rgba(16,38,46,.18); overflow: hidden; animation: dtGrow .28s cubic-bezier(.2,.8,.2,1) both; }
@keyframes dtGrow { from { transform: scale(.14); opacity: .35; border-radius: 10px; } to { transform: scale(1); opacity: 1; border-radius: 0; } }
@keyframes dtIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .dt, .dt-row { animation: none !important; } }
.dt-h { display: flex; align-items: center; gap: 8px; padding: 12px 12px 10px; background: var(--surface); border-bottom: 1px solid #e3ecef; }
.dt-b { flex: none; width: 40px; height: 40px; border: none; border-radius: 12px; background: #eef4f6; color: var(--text); cursor: pointer; display: grid; place-items: center; font: inherit; font-size: 18px; font-weight: 800; }
.dt-b.sm { width: 36px; }
.dt-t { flex: 1; min-width: 0; display: grid; gap: 1px; }
.dt-t div { display: flex; align-items: baseline; gap: 6px; }
.dt-t b { font-size: 21px; font-weight: 900; line-height: 1.1; white-space: nowrap; }
.dt-t span { font-size: 12.5px; font-weight: 800; color: var(--text-muted); white-space: nowrap; }
.dt-t small { font-size: 11.5px; font-weight: 700; color: var(--text-muted); }
.dt-ring { flex: none; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; }
.dt-ring i { width: 34px; height: 34px; border-radius: 50%; background: var(--surface); display: grid; place-items: center; font-style: normal; font-size: 10.5px; font-weight: 900; }
.dt-body { flex: 1; overflow-y: auto; padding: 10px 12px 96px; }
.dt-all { display: grid; gap: 6px; padding-bottom: 10px; margin-bottom: 6px; border-bottom: 1px dashed #d5e2e6; }
.dt-lab { font-size: 10.5px; font-weight: 900; letter-spacing: .08em; color: var(--text-muted); }
.dt-ad { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 12px; background: var(--surface); box-shadow: 0 1px 3px rgba(16,38,46,.08); }
.dt-ad.missed { background: #fff1f1; box-shadow: inset 0 0 0 1.5px #f3b6b6; }
.dt-ad.note { background: #f5f3ff; }
.dt-ad.progress { background: #fffaf0; box-shadow: inset 0 0 0 1.5px #f0c27a; }
.dt-ct { flex: 1; min-width: 0; border: none; background: none; font: inherit; text-align: left; cursor: pointer; padding: 2px 0; display: grid; gap: 1px; color: var(--text); }
.dt-ct b, .dt-card b { font-size: 13.5px; font-weight: 700; line-height: 1.4; overflow-wrap: anywhere; }
.dt-ct small, .dt-card small { font-size: 11px; font-weight: 700; color: var(--text-muted); }
.dt-row { display: flex; gap: 6px; align-items: flex-start; animation: dtIn .3s both ease-out; }
.dt-tm { width: 38px; flex: none; padding-top: 11px; font-size: 12px; font-weight: 800; color: var(--text-muted); text-align: right; font-variant-numeric: tabular-nums; }
.dt-rail { width: 26px; flex: none; position: relative; display: flex; justify-content: center; align-self: stretch; }
.dt-rail::before { content: ''; position: absolute; top: 0; bottom: 0; width: 2px; background: #dde8ec; }
.dt-dot { position: relative; z-index: 1; flex: none; width: 24px; height: 24px; margin-top: 7px; box-sizing: border-box; border-radius: 50%; border: 2px solid #9fb3ba; background: #fff; color: #fff; display: grid; place-items: center; font: inherit; font-size: 11px; font-weight: 900; cursor: pointer; padding: 0; }
.dt-ad .dt-dot { margin-top: 0; }
.dt-dot:disabled { cursor: default; }
.dt-dot.done { background: #22a55a; border-color: #22a55a; }
.dt-dot.missed { color: #dc3b3b; border-color: #dc3b3b; }
.dt-dot.live { background: #0e7490; border-color: #b6e3ee; }
.dt-dot.plan { border-style: dashed; }
.dt-dot.info { border-color: #a78bfa; }
.dt-card { flex: 1; min-width: 0; border: none; font: inherit; text-align: left; cursor: pointer; display: grid; gap: 3px; padding: 8px 10px; border-radius: 12px; margin-bottom: 8px; background: var(--surface); color: var(--text); box-shadow: 0 1px 3px rgba(16,38,46,.08); }
.dt-card.done { opacity: .72; }
.dt-card.missed { background: #fff1f1; box-shadow: inset 0 0 0 1.5px #f3b6b6; }
.dt-card.live { background: #e6f5f8; box-shadow: inset 0 0 0 1.5px #7cc9da; }
.dt-card.plan { background: transparent; box-shadow: inset 0 0 0 1.5px #c9d6db; }
.dt-l1 { display: flex; align-items: center; gap: 6px; }
.dt-k { flex: none; font-size: 9.5px; font-weight: 900; padding: 2px 6px; border-radius: 6px; background: #e6f0f3; color: #21515e; }
.dt-k.ルーティン { background: #ece9fd; color: #4c35b5; }
.dt-k.棚卸 { background: #e0f4f8; color: #0b5f73; }
.dt-k.発注 { background: #fdeedd; color: #9a4a07; }
.dt-k.入庫, .dt-k.出庫 { background: #e8f5ec; color: #1f6b3a; }
.dt-k.進行中 { background: #fff1d6; color: #8a4b00; }
.dt-k.メモ { background: #efe9fd; color: #5b33b6; }
.dt-now { display: flex; align-items: center; gap: 6px; margin: 0 0 8px; }
.dt-now span { width: 38px; text-align: right; font-size: 11px; font-weight: 900; color: #e0457b; }
.dt-now i { width: 10px; height: 10px; border-radius: 50%; background: #e0457b; margin-left: 8px; flex: none; }
.dt-now em { flex: 1; height: 2px; background: #e0457b; }
.dt-empty { margin: 40px 0 0; text-align: center; font-size: 15px; font-weight: 800; color: var(--text-muted); }
.dt-fab { position: absolute; right: 16px; bottom: 16px; width: 56px; height: 56px; border: none; border-radius: 50%; background: var(--grad-btn, #0e7490); color: #08323c; font-size: 28px; display: grid; place-items: center; cursor: pointer; box-shadow: 0 8px 18px rgba(14,116,144,.35); }
</style>
