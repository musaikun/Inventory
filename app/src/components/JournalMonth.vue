<script setup>
/**
 * 日誌を開いた最初の画面＝月のカレンダーを画面いっぱいに（User決定 2026-10-26・モック キャンバス「日誌カレンダー」①）。
 * 1マスに出すのは 日付・祝日の名前・大きな業務の札2つまで（棚卸・発注・予定。先の日は点線）・下の帯1本（緑＝全部済み・黄＝一部・赤＝やり残し）。
 * 前後の月の日は薄く。押した日は pick(date, { col, row, rows }) で知らせる（そのマスから広がる）
 * info(date) → { st: 'y'|'p'|'x'|'', tags: [{ label, kind: 'stock'|'order'|'plan', future }] }
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
})
const emit = defineEmits(['pick', 'settings'])
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const _d = k => new Date(k + 'T00:00:00')

const ym = ref({ y: 0, m: 0 })
function _sync() { const d = _d(props.focus || props.today); ym.value = { y: d.getFullYear(), m: d.getMonth() } }
_sync()
watch(() => props.focus, _sync)
function step(n) { const d = new Date(ym.value.y, ym.value.m + n, 1); ym.value = { y: d.getFullYear(), m: d.getMonth() } }
function goToday() { const d = _d(props.today); ym.value = { y: d.getFullYear(), m: d.getMonth() } }
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
const swipe = useHorizontalSwipe({ onLeft: () => step(1), onRight: () => step(-1), threshold: 60 })
const ST_LABEL = { y: '全部済み', p: '一部', x: 'やり残し' }
</script>

<template>
  <div class="jm" @touchstart.passive="swipe.onTouchStart" @touchmove.passive="swipe.onTouchMove" @touchend.passive="swipe.onTouchEnd" @touchcancel.passive="swipe.onTouchCancel">
    <header class="jm-h">
      <h2><b>{{ ym.m + 1 }}月</b><small>{{ ym.y }}</small></h2>
      <button v-if="!isThisMonth" type="button" class="jm-today" @click="goToday">今日</button>
      <button type="button" class="jm-nav" aria-label="前の月" @click="step(-1)">‹</button>
      <button type="button" class="jm-nav" aria-label="次の月" @click="step(1)">›</button>
      <button type="button" class="jm-nav" aria-label="ルーティンの設定" @click="emit('settings')">🔁</button>
    </header>
    <div class="jm-w"><span v-for="(w, i) in WEEK" :key="w" :class="{ sun: i === 0, sat: i === 6 }">{{ w }}</span></div>
    <div class="jm-grid" :style="{ gridTemplateRows: `repeat(${rowsN}, minmax(0, 1fr))` }">
      <button
        v-for="c in cells" :key="c.key" type="button"
        :class="['jm-c', { out: !c.inMonth, sun: c.sun, sat: c.sat, today: c.key === today, sel: c.key === selected }]"
        :aria-label="`${c.key}${ST_LABEL[c.info.st] ? ` ${ST_LABEL[c.info.st]}` : ''}`"
        @click="emit('pick', c.key, { col: c.col, row: c.row, rows: c.rows })"
      >
        <span class="n">{{ c.day }}</span>
        <span v-if="c.hol" class="hol">{{ c.hol }}</span>
        <span v-for="t in c.info.tags.slice(0, 2)" :key="t.label" :class="['tag', t.kind, { fut: t.future }]">{{ t.label }}</span>
        <i :class="['st', c.info.st]"></i>
      </button>
    </div>
    <div class="jm-leg"><span><i class="y"></i>全部済み</span><span><i class="p"></i>一部</span><span><i class="x"></i>やり残し</span></div>
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
.jm-c { border: none; margin: 0; padding: 4px 3px 5px; font: inherit; text-align: left; cursor: pointer; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; min-height: 0; overflow: hidden; background: var(--surface); color: var(--text); }
.jm-c.out { background: #f7fafb; }
.jm-c.sel { background: #e6f5f8; }
.jm-c .n { display: grid; place-items: center; min-width: 22px; height: 22px; font-size: 13px; font-weight: 800; }
.jm-c.out .n { color: #a9b8bf; }
.jm-c.sun .n { color: #c62828; } .jm-c.sat .n { color: #1d4ed8; }
.jm-c.today .n { border-radius: 50%; background: var(--primary, #0e7490); color: #fff; }
.jm-c .hol { font-size: 8.5px; font-weight: 800; color: #c2410c; line-height: 1.1; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.tag { font-size: 9.5px; font-weight: 800; line-height: 1.3; padding: 1px 4px; border-radius: 5px; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.tag.stock { background: #e0f4f8; color: #0b5f73; } .tag.order { background: #fdeedd; color: #9a4a07; } .tag.plan { background: #efe9fd; color: #5b33b6; }
.tag.fut { background: transparent; border: 1px dashed currentColor; }
.st { margin-top: auto; align-self: stretch; height: 5px; border-radius: 3px; }
.st.y { background: #22a55a; } .st.p { background: #e89b0c; } .st.x { background: #dc3b3b; }
.jm-leg { display: flex; justify-content: center; gap: 14px; padding: 7px 10px; border-top: 1px solid #e3ecef; font-size: 10.5px; font-weight: 700; color: var(--text-muted); }
.jm-leg span { display: flex; align-items: center; gap: 4px; }
.jm-leg i { width: 16px; height: 5px; border-radius: 3px; }
.jm-leg i.y { background: #22a55a; } .jm-leg i.p { background: #e89b0c; } .jm-leg i.x { background: #dc3b3b; }
</style>
