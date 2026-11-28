<script setup>
/**
 * 日誌を開いた最初の画面＝月のカレンダーを画面いっぱいに（User決定 2026-10-26・モック キャンバス「日誌カレンダー」①）。
 * 1マスに出すのは 日付・祝日の名前・大きな業務の札2つまで（棚卸・発注・予定の名前。先の日は点線。3つ以上は「ほかn」）・下の帯1本（緑＝全部済み・黄＝一部・赤＝やり残し）。
 * 前後の月の日は薄く。押した日は pick(date, { col, row, rows }) で知らせる（そのマスから広がる）
 * 月を送るときは横に滑らせる（User決定 2026-10-26。次の月は右から、前の月は左から）
 * info(date) → { st: 'y'|'p'|'x'|'f'|'', tags: [{ label, kind: 'stock'|'order'|'plan', future }] }
 * spans: 進行中（何日かかかるもの）を実施日〜締め切りの連日の帯で（User決定 2026-11-08・モック docs/mocks/calendar-progress.html）。
 *   [{ id, text, start, end, state: 'doing'|'wait'|'stale'|'over'|'event', future }]。押すと @span(id)
 *   イベントは上に4段まで、進行中のやることはその下に3段まで（混ぜない）。週の高さは線の数に合わせて伸び、月は縦にスクロールする。
 *   入りきらないときは最後の段に「ほか〇件」を、件数が変わる日で区切って出す（区切り目＝隠れたものの始まり・終わりの日）。押すとその期間の一覧。
 *   段はその週に始まるもの → その週に終わるもの → 続いているだけのもの の順に取る（始まりを隠さない）。User 2026-11-25・モック docs/mocks/calendar-event-lines.html
 *   event はイベント: 塗りの帯ではなく細い線「[名前]────」で、やることと見分ける（User決定 2026-11-11）
 *   始まりの日は塗った名札、続きの週は「‹ …名前」の点線の札。終わりの日は止め線と「〜m/d」、次の週へ続くなら右端に「›」（User 2026-11-25）
 *   週や月をまたいだとき、どの線がどのイベントか分からなかった（User 2026-11-18）
 */
import { ref, computed, watch } from 'vue'
import { localDateKey } from '../utils/localDate.js'
import { isHoliday, holidayName } from '../services/jpHolidays.js'
import { useVerticalSwipe } from '../composables/useSwipe.js'

const props = defineProps({
  today: { type: String, required: true },
  focus: { type: String, default: '' },     // この日を含む月を出す
  selected: { type: String, default: '' },
  info: { type: Function, required: true },
  spans: { type: Array, default: () => [] },
})
const emit = defineEmits(['pick', 'span', 'history'])
const EV_MAX = 4   // イベントの段
const PG_MAX = 3   // 進行中のやることの段
const LANE = 16
const PG_GAP = 4   // イベントと進行中の間
// 札は2つまで。入りきらなければ1つ目と「ほかn」（User 2026-11-08）
const shownTags = tags => (tags.length <= 2 ? tags : [tags[0], { label: `ほか${tags.length - 1}`, kind: 'more' }])
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const _d = k => new Date(k + 'T00:00:00')
const _days = (a, b) => Math.round((_d(b) - _d(a)) / 86400_000) + 1   // 始まり〜終わりの日数（両端を含む）

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
// 週ごとの線（行の中の列の範囲）。イベントを上、進行中を下に分けて段を決める
const SPAN_RANK = { over: 0, stale: 1, doing: 2, wait: 3 }
// 空いている一番上の段へ。cap 段に入らなければ最後の段を「ほか〇件」にして、件数が変わる日で区切る
function fitLanes(items, max) {
  const fit = cap => {
    const occ = Array.from({ length: cap }, () => Array(7).fill(false)), shown = [], hidden = []
    for (const x of items) {
      const lane = occ.findIndex(row => row.slice(x.a, x.b + 1).every(v => !v))
      if (lane < 0) { hidden.push(x); continue }
      for (let c = x.a; c <= x.b; c++) occ[lane][c] = true
      shown.push({ ...x, lane })
    }
    return { shown, hidden }
  }
  let { shown, hidden } = fit(max)
  if (!hidden.length) return { shown, more: [], lanes: shown.length ? Math.max(...shown.map(x => x.lane)) + 1 : 0 }
  ;({ shown, hidden } = fit(max - 1))
  const on = Array.from({ length: 7 }, (_, c) => hidden.filter(x => x.a <= c && c <= x.b))
  const more = []
  for (let c = 0; c < 7;) {
    if (!on[c].length) { c++; continue }
    const ids = on[c].map(x => x.id).join()
    let e = c
    while (e + 1 < 7 && on[e + 1].map(x => x.id).join() === ids) e++
    more.push({ a: c, b: e, lane: max - 1, items: on[c] })
    c = e + 1
  }
  return { shown, more, lanes: max }
}
const weekSpans = computed(() => {
  const out = []
  for (let r = 0; r < rowsN.value; r++) {
    const ks = cells.value.slice(r * 7, r * 7 + 7).map(c => c.key)
    const hit = props.spans.filter(s => s.start <= ks[6] && s.end >= ks[0]).map(s => {
      const a = Math.max(0, ks.findIndex(k => k >= s.start)), bi = ks.findLastIndex(k => k <= s.end)
      const b = bi < 0 ? 6 : bi
      const oneDay = s.start === s.end
      const endHere = s.end <= ks[6]
      return { ...s, row: r, a, b, oneDay, contL: s.start < ks[0], contR: s.end > ks[6], endHere,
        // 終わりの日付: 1日だけのもの・この週の線が1日ぶんしか無いものは付けない（止め線だけ）
        endMark: s.state === 'event' && endHere && !oneDay && b - a >= 1 }
    })
    // イベント: その週に始まる → その週に終わる → 続いているだけ（始まりを隠さない・User 2026-11-25）
    const rank = s => (s.start >= ks[0] ? 0 : s.end <= ks[6] ? 1 : 2)
    const evs = hit.filter(s => s.state === 'event')
      .sort((x, y) => rank(x) - rank(y) || x.start.localeCompare(y.start) || y.end.localeCompare(x.end))
    const pgs = hit.filter(s => s.state !== 'event')
      .sort((x, y) => (SPAN_RANK[x.state] ?? 9) - (SPAN_RANK[y.state] ?? 9) || x.start.localeCompare(y.start))
    const ev = fitLanes(evs, EV_MAX), pg = fitLanes(pgs, PG_MAX)
    const pgTop = ev.lanes * LANE + (ev.lanes && pg.lanes ? PG_GAP : 0)
    const top = (base, lane) => 30 + base + lane * LANE
    out.push({
      row: r,
      shown: [...ev.shown.map(x => ({ ...x, top: top(0, x.lane) })), ...pg.shown.map(x => ({ ...x, top: top(pgTop, x.lane) }))],
      more: [...ev.more.map(m => ({ ...m, ev: true, top: top(0, m.lane) })), ...pg.more.map(m => ({ ...m, ev: false, top: top(pgTop, m.lane) }))]
        .map(m => ({ ...m, key: `${r}-${m.ev ? 'e' : 'p'}${m.a}`, from: ks[m.a], to: ks[m.b] })),
      height: pgTop + pg.lanes * LANE,
    })
  }
  return out
})
const lanesH = r => weekSpans.value[r]?.height ?? 0
// 「ほか〇件」を押したときの一覧
const moreOpen = ref(null)   // { from, to, ev, items }
const moreLabel = m => (m.ev ? (m.b > m.a ? `ほか${m.items.length}件のイベント` : `ほか${m.items.length}件`) : `ほか${m.items.length}件`)
function pickMore(id) { moreOpen.value = null; emit('span', id) }
const range = s => (s.start === s.end ? md(s.start) : `${md(s.start)}〜${md(s.end)}`)
const SPAN_LABEL = { doing: '進行中', wait: '待ち', stale: '止まっている', over: '締め切り過ぎ', event: 'イベント' }
const hasEvent = computed(() => props.spans.some(s => s.state === 'event'))
const hasProg = computed(() => props.spans.some(s => s.state !== 'event'))
const md = k => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`
// 月は上下で送る（User決定 2026-11-28。横の動きは「右へ引いてホームへ戻る」に使う）。
// 上へ払う＝次の月、下へ払う＝前の月。マスが多くて中がスクロールする月は、端まで来てから払ったときだけ送る
const gridEl = ref(null)
let _atTop = true, _atBottom = true
const _vs = useVerticalSwipe({ onUp: () => { if (_atBottom) step(1) }, onDown: () => { if (_atTop) step(-1) }, threshold: 60 })
const swipe = {
  onTouchStart(e) {
    const g = gridEl.value
    _atTop = !g || g.scrollTop <= 1
    _atBottom = !g || g.scrollTop + g.clientHeight >= g.scrollHeight - 2
    _vs.onTouchStart(e)
  },
  onTouchMove: _vs.onTouchMove, onTouchEnd: _vs.onTouchEnd, onTouchCancel: _vs.onTouchCancel,
}
const ST_LABEL = { y: '全部済み', p: '一部', x: 'やり残し', f: '予定あり' }
</script>

<template>
  <div class="jm" @touchstart.passive="swipe.onTouchStart" @touchmove.passive="swipe.onTouchMove" @touchend.passive="swipe.onTouchEnd" @touchcancel.passive="swipe.onTouchCancel">
    <header class="jm-h">
      <h2><b>{{ ym.m + 1 }}月</b><small>{{ ym.y }}</small></h2>
      <button type="button" class="jm-hist" aria-label="済んだ業務の履歴" @click="emit('history')">✓ 履歴</button>
      <button v-if="!isThisMonth" type="button" class="jm-today" @click="goToday">今日</button>
      <button type="button" class="jm-nav" aria-label="前の月" @click="step(-1)">⌃</button>
      <button type="button" class="jm-nav" aria-label="次の月" @click="step(1)">⌄</button>
    </header>
    <div class="jm-w"><span v-for="(w, i) in WEEK" :key="w" :class="{ sun: i === 0, sat: i === 6 }">{{ w }}</span></div>
    <div ref="gridEl" :key="`${ym.y}-${ym.m}`" :class="['jm-grid', slide && `slide-${slide}`]" :style="{ gridTemplateRows: `repeat(${rowsN}, minmax(min-content, 1fr))` }">
      <button
        v-for="c in cells" :key="c.key" type="button"
        :class="['jm-c', { out: !c.inMonth, sun: c.sun, sat: c.sat, today: c.key === today, sel: c.key === selected }]"
        :style="{ gridRow: c.row + 1, gridColumn: c.col + 1 }"
        :aria-label="`${c.key}${ST_LABEL[c.info.st] ? ` ${ST_LABEL[c.info.st]}` : ''}`"
        @click="emit('pick', c.key, { col: c.col, row: c.row, rows: c.rows })"
      >
        <span class="dr"><span class="n">{{ c.day }}</span><span v-if="c.hol" class="hol">{{ c.hol }}</span></span>
        <span v-if="lanesH(c.row)" class="lanes" :style="{ height: lanesH(c.row) + 'px' }"></span>
        <span v-for="(t, i) in shownTags(c.info.tags)" :key="i" :class="['tag', t.kind, { fut: t.future }]">{{ t.label }}</span>
        <i :class="['st', c.info.st]"></i>
      </button>
      <!-- 進行中の帯（マスの上に重ねる。マスには帯の分の空きを取ってある） -->
      <template v-for="w in weekSpans" :key="`w${w.row}`">
        <button
          v-for="s in w.shown" :key="`${s.id}-${w.row}`" type="button"
          :class="['jm-span', s.state, { cl: s.contL, cr: s.contR, fut: s.future }]" :data-span="s.id"
          :style="{ gridRow: w.row + 1, gridColumn: `${s.a + 1} / ${s.b + 2}`, marginTop: s.top + 'px' }"
          :aria-label="`${s.text}（${SPAN_LABEL[s.state]}）${md(s.start)}〜${md(s.end)}`"
          @click="emit('span', s.id)"
        ><template v-if="s.state === 'event'"><span v-if="s.contL" class="ar" aria-hidden="true">‹</span><span :class="['lb', { cont: s.contL }]">{{ s.contL ? '…' : '' }}{{ s.text }}</span><i v-if="!s.oneDay" aria-hidden="true"></i><span v-if="s.endMark" class="end">〜{{ md(s.end) }}</span><b v-if="s.endHere && !s.oneDay" class="cap" aria-hidden="true"></b><span v-if="s.contR" class="ar" aria-hidden="true">›</span></template><template v-else>{{ s.contL ? '… ' : '' }}{{ s.text }}</template></button>
        <button
          v-for="m in w.more" :key="m.key" type="button" :class="['jm-more', { ev: m.ev }]" :data-more="m.from"
          :style="{ gridRow: w.row + 1, gridColumn: `${m.a + 1} / ${m.b + 2}`, marginTop: m.top + 'px' }"
          :aria-label="`${md(m.from)}${m.b > m.a ? `〜${md(m.to)}` : ''} ${moreLabel(m)}。一覧を開く`"
          @click="moreOpen = { from: m.from, to: m.to, ev: m.ev, items: m.items }"
        >{{ moreLabel(m) }}</button>
      </template>
    </div>
    <!-- 「ほか〇件」の一覧（その期間に隠れているもの） -->
    <div v-if="moreOpen" class="jm-mo-bg" @click.self="moreOpen = null">
      <section class="jm-mo" :aria-label="`${md(moreOpen.from)}${moreOpen.from !== moreOpen.to ? `〜${md(moreOpen.to)}` : ''} のほかの${moreOpen.ev ? 'イベント' : '進行中'}`">
        <header><b>{{ md(moreOpen.from) }}<template v-if="moreOpen.from !== moreOpen.to">〜{{ md(moreOpen.to) }}</template> のほかの{{ moreOpen.ev ? 'イベント' : '進行中' }}</b><button type="button" aria-label="閉じる" @click="moreOpen = null">✕</button></header>
        <button v-for="s in moreOpen.items" :key="s.id" type="button" :class="['jm-mo-it', { ev: moreOpen.ev }]" :data-span="s.id" @click="pickMore(s.id)">
          <span class="t">{{ s.text }}</span><span class="d">{{ range(s) }}</span>
        </button>
      </section>
    </div>
    <div class="jm-leg"><span><i class="y"></i>全部済み</span><span><i class="p"></i>一部</span><span><i class="x"></i>やり残し</span><span><i class="f"></i>予定あり</span><span v-if="hasProg"><i class="pg"></i>進行中</span><span v-if="hasEvent"><i class="ev"></i>イベント</span></div>
  </div>
</template>

<style scoped>
.jm { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--surface); touch-action: pan-y; }
.jm-h { display: flex; align-items: center; gap: 8px; padding: 14px 12px 8px; }
.jm-h h2 { margin: 0 auto 0 0; display: flex; align-items: baseline; gap: 6px; }
.jm-h h2 b { font-size: 26px; font-weight: 900; letter-spacing: .02em; }
.jm-h h2 small { font-size: 13px; font-weight: 700; color: var(--text-muted); }
.jm-today { height: 34px; padding: 0 14px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); font: inherit; font-size: 13px; font-weight: 800; color: var(--primary, #0e7490); cursor: pointer; }
.jm-hist { height: 34px; padding: 0 12px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); font: inherit; font-size: 13px; font-weight: 800; color: var(--text); cursor: pointer; }
.jm-nav { width: 42px; height: 34px; border: none; border-radius: 12px; background: #eef4f6; font: inherit; font-size: 18px; font-weight: 800; color: var(--text); cursor: pointer; }
.jm-w { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); padding: 4px 4px; border-bottom: 1px solid #e3ecef; }
.jm-w span { text-align: center; font-size: 11px; font-weight: 800; color: var(--text-muted); }
.jm-w .sun { color: #c62828; } .jm-w .sat { color: #1d4ed8; }
.jm-grid { flex: 1; min-height: 0; overflow-y: auto; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 1px; background: #e3ecef; }
.jm-grid.slide-next { animation: jmNext .26s cubic-bezier(.2,.8,.2,1); }
.jm-grid.slide-prev { animation: jmPrev .26s cubic-bezier(.2,.8,.2,1); }
@keyframes jmNext { from { transform: translateY(24%); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes jmPrev { from { transform: translateY(-24%); opacity: 0; } to { transform: none; opacity: 1; } }
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
/* イベント: 細い線 [名前]──── （塗りの帯＝やることと違うと分かるように） */
.jm-span.event { background: none; color: #c2410c; padding: 0; display: flex; align-items: center; gap: 2px; border-radius: 0; }
.jm-span.event .lb { flex: none; max-width: 100%; overflow: hidden; text-overflow: ellipsis; padding: 0 3px; border: 1.2px solid currentColor; border-radius: 4px; background: #fff7ed; line-height: 11px; }
.jm-span.event i { flex: 1; min-width: 4px; border-top: 1.5px solid currentColor; opacity: .75; }
.jm-span.event .end { flex: none; padding-left: 2px; font-size: 9px; font-weight: 900; }
/* 続きの週: 名前の枠の左を開けて、前から続いていると分かるように */
.jm-span.event .lb.cont { border-style: dashed; background: none; opacity: .75; }
.jm-span.event .ar { flex: none; font-size: 10px; font-weight: 900; line-height: 1; opacity: .85; }
.jm-span.event .cap { flex: none; width: 2px; height: 12px; border-radius: 1px; background: currentColor; }
.jm-span.event.fut { opacity: 1; }
.jm-more { align-self: start; z-index: 1; height: 14px; margin: 0 2px; padding: 0 4px; border: 1.2px dashed #64748b; border-radius: 4px; background: #f1f5f9; font: inherit; font-size: 9px; font-weight: 900; line-height: 11px; color: #475569; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; min-width: 0; }
.jm-more.ev { border-color: #c2410c; background: #fff7ed; color: #c2410c; }
.jm-mo-bg { position: absolute; inset: 0; z-index: 5; display: flex; align-items: flex-end; background: rgba(15, 23, 42, .28); }
.jm-mo { width: 100%; max-height: 70%; overflow-y: auto; padding: 10px 14px calc(14px + env(safe-area-inset-bottom, 0px)); border-radius: 16px 16px 0 0; background: var(--surface); }
.jm-mo header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 6px; }
.jm-mo header button { width: 34px; height: 34px; border: none; background: none; font: inherit; font-size: 16px; color: var(--text-muted); cursor: pointer; }
.jm-mo-it { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 0; border: none; border-top: 1px solid #e3ecef; background: none; font: inherit; color: var(--text); text-align: left; cursor: pointer; }
.jm-mo-it .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 800; padding-left: 8px; border-left: 3px solid #3b82f6; }
.jm-mo-it.ev .t { border-left-color: #c2410c; }
.jm-mo-it .d { flex: none; font-size: 12px; color: var(--text-muted); }
.jm-c .n { display: grid; place-items: center; min-width: 22px; height: 22px; font-size: 13px; font-weight: 800; }
.jm-c.out .n { color: #a9b8bf; }
.jm-c.sun .n { color: #c62828; } .jm-c.sat .n { color: #1d4ed8; }
.jm-c.today .n { border-radius: 50%; background: var(--primary, #0e7490); color: #fff; }
.jm-c .hol { font-size: 8px; font-weight: 800; color: #c2410c; line-height: 1.1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.tag { font-size: 9.5px; font-weight: 800; line-height: 1.3; padding: 1px 4px; border-radius: 5px; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.tag.stock { background: #e0f4f8; color: #0b5f73; } .tag.order { background: #fdeedd; color: #9a4a07; } .tag.plan { background: #efe9fd; color: #5b33b6; } .tag.more { background: #eef2f4; color: #4c6a72; }
.tag.event { background: #fff7ed; color: #c2410c; border-left: 2.5px solid #c2410c; border-radius: 2px 5px 5px 2px; }
.tag.fut { background: transparent; border: 1px dashed currentColor; }
.st { margin-top: auto; align-self: stretch; height: 5px; border-radius: 3px; }
.st.y { background: #22a55a; } .st.p { background: #e89b0c; } .st.x { background: #dc3b3b; } .st.f { background: #3b82f6; }
.jm-leg { display: flex; justify-content: center; gap: 14px; padding: 7px 10px; border-top: 1px solid #e3ecef; font-size: 10.5px; font-weight: 700; color: var(--text-muted); }
.jm-leg span { display: flex; align-items: center; gap: 4px; }
.jm-leg i { width: 16px; height: 5px; border-radius: 3px; }
.jm-leg i.pg { height: 8px; background: #3b82f6; border-radius: 3px; }
.jm-leg i.ev { height: 0; border-top: 1.5px solid #c2410c; border-radius: 0; }
.jm-leg { flex-wrap: wrap; row-gap: 3px; }
.jm-leg i.y { background: #22a55a; } .jm-leg i.p { background: #e89b0c; } .jm-leg i.x { background: #dc3b3b; } .jm-leg i.f { background: #3b82f6; }
</style>
