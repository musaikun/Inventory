<script setup>
/**
 * 日誌を開いた最初の画面＝月のカレンダーを画面いっぱいに（User決定 2026-10-26・モック キャンバス「日誌カレンダー」①）。
 * 1マスに出すのは 日付・祝日の名前・大きな業務の札2つまで（棚卸・発注・予定の名前。先の日は点線。3つ以上は「ほかn」）・下の帯1本（緑＝全部済み・黄＝一部・赤＝やり残し）。
 * 前後の月の日は薄く。押した日は pick(date, { col, row, rows }) で知らせる（そのマスから広がる）
 * 月を送るときは横に滑らせる（User決定 2026-10-26。次の月は右から、前の月は左から）
 * info(date) → { st: 'y'|'p'|'x'|'f'|'', tags: [{ label, kind: 'stock'|'order'|'plan', future }] }
 * spans: 進行中（何日かかかるもの）を実施日〜締め切りの連日の帯で（User決定 2026-11-08・モック docs/mocks/calendar-progress.html）。
 *   [{ id, text, start, end, state: 'doing'|'wait'|'stale'|'over', future }]。1週に2本まで、あふれたら「ほかn」。押すと @span(id)
 */
import { ref, computed, watch } from 'vue'
import { localDateKey } from '../utils/localDate.js'
import { isHoliday, holidayName } from '../services/jpHolidays.js'
import { useHorizontalSwipe } from '../composables/useSwipe.js'

const props = defineProps({
  today: { type: String, required: true },
  focus: { type: String, default: '' },     // この日を含む月を出す
  selected: { type: String, default: '' },
  info: { type: Function, required: true },
  spans: { type: Array, default: () => [] },
})
const emit = defineEmits(['pick', 'span'])
const SPAN_MAX = 2
// 札は2つまで。入りきらなければ1つ目と「ほかn」（User 2026-11-08）
const shownTags = tags => (tags.length <= 2 ? tags : [tags[0], { label: `ほか${tags.length - 1}`, kind: 'more' }])
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const _d = k => new Date(k + 'T00:00:00')

const ym = ref({ y: 0, m: 0 })
function _sync() { const d = _d(props.focus || props.today); ym.value = { y: d.getFullYear(), m: d.getMonth() } }
_sync()
watch(() => props.focus, v => { if (v) { const d = _d(v); _go(d.getFullYear(), d.getMonth()) } })
const slide = ref('')   // 'next' | 'prev'
function _go(y, m) {
  const n = (y - ym.value.y) * 12 + (m - ym.value.m)
  if (!n) return
  slide.value = n > 0 ? 'next' : 'prev'
  ym.value = { y, m }
}
function step(n) { const d = new Date(ym.value.y, ym.value.m + n, 1); _go(d.getFullYear(), d.getMonth()) }
function goToday() { const d = _d(props.today); _go(d.getFullYear(), d.getMonth()) }
const isThisMonth = computed(() => { const d = _d(props.today); return d.getFullYear() === ym.value.y && d.getMonth() === ym.value.m })

const cells = computed(() => {
  const { y, m } = ym.value
  const first = new Date(y, m, 1).getDay()
  const last = new Date(y, m + 1, 0).getDate()
  const rows = Math.ceil((first + last) / 7)
  return Array.from({ length: rows * 7 }, (_, i) => {
    const dt = new Date(y, m, i - first + 1)
    const key = localDateKey(dt)
    const inMonth = dt.getMonth() === m
    const dow = dt.getDay()
    const hol = inMonth && isHoliday(dt) ? holidayName(dt) : ''
    const info = inMonth ? props.info(key) : { st: '', tags: [] }
    return { key, day: dt.getDate(), inMonth, hol, sun: dow === 0 || !!hol, sat: dow === 6, info, col: i % 7, row: Math.floor(i / 7), rows }
  })
})
const rowsN = computed(() => cells.value[0]?.rows ?? 5)
// 週ごとの帯（行の中の列の範囲）。締め切り過ぎを先に、次に始まりが早い順
const SPAN_RANK = { over: 0, stale: 1, doing: 2, wait: 3 }
const weekSpans = computed(() => {
  const out = []
  for (let r = 0; r < rowsN.value; r++) {
    const ks = cells.value.slice(r * 7, r * 7 + 7).map(c => c.key)
    const hit = props.spans.filter(s => s.start <= ks[6] && s.end >= ks[0])
      .sort((a, b) => (SPAN_RANK[a.state] ?? 9) - (SPAN_RANK[b.state] ?? 9) || a.start.localeCompare(b.start))
    const shown = hit.slice(0, SPAN_MAX).map((s, lane) => {
      const a = Math.max(0, ks.findIndex(k => k >= s.start)), bi = ks.findLastIndex(k => k <= s.end)
      return { ...s, row: r, lane, a, b: bi < 0 ? 6 : bi, contL: s.start < ks[0], contR: s.end > ks[6] }
    })
    out.push({ row: r, shown, more: hit.length - shown.length })
  }
  return out
})
const lanesOf = r => Math.min(SPAN_MAX, (weekSpans.value[r]?.shown.length ?? 0) + (weekSpans.value[r]?.more ? 1 : 0))
const SPAN_LABEL = { doing: '進行中', wait: '待ち', stale: '止まっている', over: '締め切り過ぎ' }
const md = k => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`
const swipe = useHorizontalSwipe({ onLeft: () => step(1), onRight: () => step(-1), threshold: 60 })
const ST_LABEL = { y: '全部済み', p: '一部', x: 'やり残し', f: '予定あり' }
</script>

<template>
  <div class="jm" @touchstart.passive="swipe.onTouchStart" @touchmove.passive="swipe.onTouchMove" @touchend.passive="swipe.onTouchEnd" @touchcancel.passive="swipe.onTouchCancel">
    <header class="jm-h">
      <h2><b>{{ ym.m + 1 }}月</b><small>{{ ym.y }}</small></h2>
      <button v-if="!isThisMonth" type="button" class="jm-today" @click="goToday">今日</button>
      <button type="button" class="jm-nav" aria-label="前の月" @click="step(-1)">‹</button>
      <button type="button" class="jm-nav" aria-label="次の月" @click="step(1)">›</button>
    </header>
    <div class="jm-w"><span v-for="(w, i) in WEEK" :key="w" :class="{ sun: i === 0, sat: i === 6 }">{{ w }}</span></div>
    <div :key="`${ym.y}-${ym.m}`" :class="['jm-grid', slide && `slide-${slide}`]" :style="{ gridTemplateRows: `repeat(${rowsN}, minmax(0, 1fr))` }">
      <button
        v-for="c in cells" :key="c.key" type="button"
        :class="['jm-c', { out: !c.inMonth, sun: c.sun, sat: c.sat, today: c.key === today, sel: c.key === selected }]"
        :style="{ gridRow: c.row + 1, gridColumn: c.col + 1 }"
        :aria-label="`${c.key}${ST_LABEL[c.info.st] ? ` ${ST_LABEL[c.info.st]}` : ''}`"
        @click="emit('pick', c.key, { col: c.col, row: c.row, rows: c.rows })"
      >
        <span class="dr"><span class="n">{{ c.day }}</span><span v-if="c.hol" class="hol">{{ c.hol }}</span></span>
        <span v-if="lanesOf(c.row)" class="lanes" :style="{ height: lanesOf(c.row) * 16 + 'px' }"></span>
        <span v-for="(t, i) in shownTags(c.info.tags)" :key="i" :class="['tag', t.kind, { fut: t.future }]">{{ t.label }}</span>
        <i :class="['st', c.info.st]"></i>
      </button>
      <!-- 進行中の帯（マスの上に重ねる。マスには帯の分の空きを取ってある） -->
      <template v-for="w in weekSpans" :key="`w${w.row}`">
        <button
          v-for="s in w.shown" :key="`${s.id}-${w.row}`" type="button"
          :class="['jm-span', s.state, { cl: s.contL, cr: s.contR, fut: s.future }]" :data-span="s.id"
          :style="{ gridRow: w.row + 1, gridColumn: `${s.a + 1} / ${s.b + 2}`, marginTop: 30 + s.lane * 16 + 'px' }"
          :aria-label="`${s.text}（${SPAN_LABEL[s.state]}）${md(s.start)}〜${md(s.end)}`"
          @click="emit('span', s.id)"
        >{{ s.contL ? '… ' : '' }}{{ s.text }}</button>
        <span v-if="w.more" class="jm-more" :style="{ gridRow: w.row + 1, gridColumn: 7, marginTop: 30 + w.shown.length * 16 + 'px' }">ほか{{ w.more }}</span>
      </template>
    </div>
    <div class="jm-leg"><span><i class="y"></i>全部済み</span><span><i class="p"></i>一部</span><span><i class="x"></i>やり残し</span><span><i class="f"></i>予定あり</span><span v-if="spans.length"><i class="pg"></i>進行中</span></div>
  </div>
</template>

<style scoped>
.jm { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--surface); touch-action: pan-y; }
.jm-h { display: flex; align-items: center; gap: 8px; padding: 14px 12px 8px; }
.jm-h h2 { margin: 0 auto 0 0; display: flex; align-items: baseline; gap: 6px; }
.jm-h h2 b { font-size: 26px; font-weight: 900; letter-spacing: .02em; }
.jm-h h2 small { font-size: 13px; font-weight: 700; color: var(--text-muted); }
.jm-today { height: 34px; padding: 0 14px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); font: inherit; font-size: 13px; font-weight: 800; color: var(--primary, #0e7490); cursor: pointer; }
.jm-nav { width: 42px; height: 34px; border: none; border-radius: 12px; background: #eef4f6; font: inherit; font-size: 18px; font-weight: 800; color: var(--text); cursor: pointer; }
.jm-w { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); padding: 4px 4px; border-bottom: 1px solid #e3ecef; }
.jm-w span { text-align: center; font-size: 11px; font-weight: 800; color: var(--text-muted); }
.jm-w .sun { color: #c62828; } .jm-w .sat { color: #1d4ed8; }
.jm-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 1px; background: #e3ecef; }
.jm-grid.slide-next { animation: jmNext .26s cubic-bezier(.2,.8,.2,1); }
.jm-grid.slide-prev { animation: jmPrev .26s cubic-bezier(.2,.8,.2,1); }
@keyframes jmNext { from { transform: translateX(40%); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes jmPrev { from { transform: translateX(-40%); opacity: 0; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .jm-grid.slide-next, .jm-grid.slide-prev { animation: none; } }
.jm { overflow: hidden; }
.jm-c { border: none; margin: 0; padding: 4px 3px 5px; font: inherit; text-align: left; cursor: pointer; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; min-height: 0; overflow: hidden; background: var(--surface); color: var(--text); }
.jm-c.out { background: #f7fafb; }
.jm-c.sel { background: #e6f5f8; }
.jm-c .dr { display: flex; align-items: center; gap: 2px; min-width: 0; max-width: 100%; }
.jm-c .lanes { flex: none; }
.jm-span { align-self: start; z-index: 1; height: 14px; margin-left: 2px; margin-right: 2px; padding: 0 5px; border: none; border-radius: 5px; font: inherit; font-size: 9.5px; font-weight: 800; line-height: 14px; color: #fff;
  text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; min-width: 0; }
.jm-span.doing { background: #3b82f6; } .jm-span.wait { background: #64748b; } .jm-span.stale { background: #d97706; } .jm-span.over { background: #dc2626; }
.jm-span.cl { border-top-left-radius: 0; border-bottom-left-radius: 0; margin-left: 0; }
.jm-span.cr { border-top-right-radius: 0; border-bottom-right-radius: 0; margin-right: 0; }
.jm-span.fut { opacity: .55; }
.jm-more { align-self: start; justify-self: end; z-index: 1; margin-right: 4px; font-size: 9px; font-weight: 900; color: var(--text-muted); pointer-events: none; }
.jm-c .n { display: grid; place-items: center; min-width: 22px; height: 22px; font-size: 13px; font-weight: 800; }
.jm-c.out .n { color: #a9b8bf; }
.jm-c.sun .n { color: #c62828; } .jm-c.sat .n { color: #1d4ed8; }
.jm-c.today .n { border-radius: 50%; background: var(--primary, #0e7490); color: #fff; }
.jm-c .hol { font-size: 8px; font-weight: 800; color: #c2410c; line-height: 1.1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.tag { font-size: 9.5px; font-weight: 800; line-height: 1.3; padding: 1px 4px; border-radius: 5px; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.tag.stock { background: #e0f4f8; color: #0b5f73; } .tag.order { background: #fdeedd; color: #9a4a07; } .tag.plan { background: #efe9fd; color: #5b33b6; } .tag.more { background: #eef2f4; color: #4c6a72; }
.tag.fut { background: transparent; border: 1px dashed currentColor; }
.st { margin-top: auto; align-self: stretch; height: 5px; border-radius: 3px; }
.st.y { background: #22a55a; } .st.p { background: #e89b0c; } .st.x { background: #dc3b3b; } .st.f { background: #3b82f6; }
.jm-leg { display: flex; justify-content: center; gap: 14px; padding: 7px 10px; border-top: 1px solid #e3ecef; font-size: 10.5px; font-weight: 700; color: var(--text-muted); }
.jm-leg span { display: flex; align-items: center; gap: 4px; }
.jm-leg i { width: 16px; height: 5px; border-radius: 3px; }
.jm-leg i.pg { height: 8px; background: #3b82f6; border-radius: 3px; }
.jm-leg { flex-wrap: wrap; row-gap: 3px; }
.jm-leg i.y { background: #22a55a; } .jm-leg i.p { background: #e89b0c; } .jm-leg i.x { background: #dc3b3b; } .jm-leg i.f { background: #3b82f6; }
</style>
