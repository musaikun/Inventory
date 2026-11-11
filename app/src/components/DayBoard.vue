<script setup>
/**
 * 日誌の1日を予約台帳（レストランボード）の形で（User決定 2026-11-05・モック docs/mocks/journal-board.html）。
 * - 横が時間、縦が人（全員＋スタッフ）。斜線は見せる時間帯（日誌の時間帯の設定）の外、赤い線は「いま」
 * - 空いているマスを押す → その時間・その人で足す（親が追加の画面を開く）
 * - やることを掴んで横へ＝時間、縦へ＝担当、右の端を引く＝終わりの時刻（15分ごと）。直せる人のやることだけ
 * - 終わりのないやることは丸い形（「◯時までに」）。ルーティンは緑の点線（動かさない・押すと✓の画面）
 * - 時刻のないもの: 上の「終日」。進行中: その下の段（たためる）。いつか: 左下の箱（選んでからマスを押すと、その時間に入る）
 * - 棚卸・発注・入出庫の記録は動かせない点線の帯・札
 * 見せるだけの部品。書き換えは親（JournalPage）
 */
import LineIcon from './LineIcon.vue'
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { staffNames } from '../composables/useAuth.js'
import { canEditTask } from '../composables/useTasks.js'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

const props = defineProps({
  date: { type: String, required: true },
  today: { type: String, required: true },
  timeline: { type: Object, required: true },
  canAdd: { type: Boolean, default: false },
  zoom: { type: String, default: '3h' },   // '3h' | 'day'（切り替えは親の見出しの下の段）
})
const emit = defineEmits(['open', 'check', 'add-at', 'move', 'place'])

const SNAP = 15
const ROW_H = 68
// 見せる時間帯: 日誌の「1日」の設定（無ければ 8〜24時）
function _hours() {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEYS.journalHours) || 'null')
    const from = Math.max(0, Math.min(23, Number(v?.from))), to = Math.max(from + 1, Math.min(24, Number(v?.to)))
    if (Number.isFinite(from) && Number.isFinite(to)) return { from, to, set: true }
  } catch (_) {}
  return { from: 8, to: 24, set: false }
}
const H = _hours()
const START = Math.max(0, H.from - 1), END = Math.min(24, H.to + 1)
const OPEN = H.set ? H.from : 11, CLOSE = H.set ? H.to : 22

const _min = hm => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + (m || 0) }
const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const hmShort = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`

// ── 行（人）──
const people = computed(() => staffNames.value)
const rows = computed(() => [{ id: 'all', name: '全員', sub: '' }, ...people.value.map(p => ({ id: p.id, name: p.name, sub: p.owner && p.name !== 'オーナー' ? 'オーナー' : '' }))])
const rowIdx = id => Math.max(0, rows.value.findIndex(r => r.id === id))
const _rowOf = (assign, id) => (assign === 'person' && rows.value.some(r => r.id === id) ? id : 'all')

// ── 縮尺 ──
const scrollEl = ref(null)
const hourW = ref(96)
function setZoom(z) {
  const el = scrollEl.value
  const center = el ? (el.scrollLeft + el.clientWidth / 2) / hourW.value : null
  hourW.value = z === 'day' && el ? Math.max(14, el.clientWidth / (END - START)) : 96
  nextTick(() => { if (el && center != null) el.scrollLeft = center * hourW.value - el.clientWidth / 2 })
}
watch(() => props.zoom, z => setZoom(z))
const xOf = m => (m / 60 - START) * hourW.value
const W = computed(() => (END - START) * hourW.value)

// ── 中身 ──
const tl = computed(() => props.timeline)
const lane = computed(() => tl.value.allDay.filter(x => x.ref.type === 'progress'))
const strip = computed(() => tl.value.allDay.filter(x => x.ref.type !== 'progress' && !x.someday && !x.event))
// イベント: ボードの上に細い線で（時刻のあるものも。マスには置かない・User 2026-11-11）
const evts = computed(() => [...tl.value.allDay, ...tl.value.timed].filter(x => x.event))
const someday = computed(() => tl.value.allDay.filter(x => x.someday))
const laneOpen = ref(true)
const drag = ref(null)   // { id, start, end, row } 掴んでいる間の見た目
const blocks = computed(() => {
  const out = []
  for (const x of tl.value.timed) {
    const r = x.ref
    if (x.event) continue
    if (r.type === 'task') {
      const t = r.task
      const d = drag.value?.id === t.id ? drag.value : null
      const start = d ? d.start : _min(t.dueTime)
      const end = d ? d.end : (t.endTime ? _min(t.endTime) : null)
      out.push({ key: x.key, x, kind: t.category || 'task', start, end, row: d ? d.row : _rowOf(t.assign, t.assigneeId), title: x.title, state: x.state, movable: canEditTask(t), task: t })
    } else if (r.type === 'list') {
      const cl = r.run.cl
      out.push({ key: x.key, x, kind: 'routine', start: _min(x.time), end: null, row: _rowOf(cl.assign, cl.assigneeId), title: x.title, sub: x.sub, state: x.state, movable: false })
    } else if (x.ev === 'start' || x.ev === 'end' || x.ev === 'pause' || x.ev === 'resume' || x.ev === 'join') {
      continue   // 棚卸の区間は下の帯で
    } else {
      out.push({ key: x.key, x, kind: 'rec', start: _min(x.time), end: null, row: 'all', title: x.title, sub: x.kind, state: x.state, movable: false })
    }
  }
  return out
})
// 棚卸の帯: 開始〜終了（中断は斜線のまま点線）
const bands = computed(() => {
  const by = new Map()
  for (const x of tl.value.timed) {
    if (!x.span) continue
    const b = by.get(x.span) ?? { key: x.span, x, from: null, to: null, title: '棚卸' }
    const t = _min(x.time)
    if (b.from == null || t < b.from) b.from = t
    if (b.to == null || t > b.to) b.to = t
    if (x.ev === 'end') { b.title = x.title; b.x = x }
    by.set(x.span, b)
  }
  return [...by.values()].filter(b => b.to > b.from)
})
const style = b => {
  const w = b.end != null ? Math.max(26, xOf(b.end) - xOf(b.start)) : Math.max(84, hourW.value * 1.1)
  return { left: `${xOf(b.start)}px`, top: `${rowIdx(b.row) * ROW_H + 7}px`, width: `${w}px`, height: `${ROW_H - 14}px` }
}

// ── いま ──
const nowM = ref(0)
let timer = null
const _tick = () => { const n = new Date(); nowM.value = n.getHours() * 60 + n.getMinutes() }
const isToday = computed(() => props.date === props.today)
onMounted(() => {
  _tick(); timer = setInterval(_tick, 60000)
  nextTick(() => { const el = scrollEl.value; if (el) el.scrollLeft = Math.max(0, xOf((isToday.value ? nowM.value : OPEN * 60) - 60)) })
})
onUnmounted(() => clearInterval(timer))

// ── 押す・掴む ──
const placing = ref(null)   // いつかの箱から選んだやること
let act = null
const canvasEl = ref(null)
function _pt(e) { const r = canvasEl.value.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top - 22 } }
function onDown(e) {
  const el = e.target.closest?.('[data-block]')
  if (el) {
    const b = blocks.value.find(z => z.key === el.dataset.block)
    if (!b) return
    act = { kind: e.target.dataset?.grip ? 'resize' : 'move', b, x0: e.clientX, y0: e.clientY, moved: false, pid: e.pointerId, el }
    return
  }
  if (e.target.closest?.('.db-rec, .db-band')) return
  act = { kind: 'tap', p: _pt(e), x0: e.clientX, y0: e.clientY }
}
const tip = ref(null)
function onMove(e) {
  if (!act || act.kind === 'tap' || !act.b.movable) return
  const dx = e.clientX - act.x0, dy = e.clientY - act.y0
  if (!act.moved && Math.hypot(dx, dy) < 6) return
  const b = act.b, t = b.task
  if (!act.moved) { act.moved = true; try { act.el.setPointerCapture(act.pid) } catch (_) {} }
  const s0 = _min(t.dueTime), e0 = t.endTime ? _min(t.endTime) : null
  if (act.kind === 'move') {
    const len = e0 == null ? null : e0 - s0
    let s = Math.round((s0 + dx / hourW.value * 60) / SNAP) * SNAP
    s = Math.max(START * 60, Math.min(END * 60 - (len ?? SNAP), s))
    const ri = Math.max(0, Math.min(rows.value.length - 1, rowIdx(_rowOf(t.assign, t.assigneeId)) + Math.round(dy / ROW_H)))
    drag.value = { id: t.id, start: s, end: len == null ? null : s + len, row: rows.value[ri].id }
  } else {
    let en = Math.round((e0 + dx / hourW.value * 60) / SNAP) * SNAP
    en = Math.max(s0 + SNAP, Math.min(END * 60, en))
    drag.value = { id: t.id, start: s0, end: en, row: _rowOf(t.assign, t.assigneeId) }
  }
  const d = drag.value
  tip.value = { left: xOf(d.start), top: rowIdx(d.row) * ROW_H, text: `${hmShort(d.start)}${d.end != null ? `〜${hmShort(d.end)}` : 'までに'} ・ ${rows.value[rowIdx(d.row)].name}` }
}
function onUp(e) {
  const a = act; act = null
  tip.value = null
  if (!a) return
  if (a.kind === 'tap') {
    if (Math.hypot(e.clientX - a.x0, e.clientY - a.y0) > 8) return   // 横にスクロールしただけ
    const ri = Math.floor(a.p.y / ROW_H)
    if (ri < 0 || ri >= rows.value.length) return
    const start = Math.floor((START * 60 + a.p.x / hourW.value * 60) / 30) * 30
    const row = rows.value[ri].id
    if (placing.value) { emit('place', placing.value, { row, start: hm(start) }); placing.value = null; return }
    if (props.canAdd) emit('add-at', { row, start: hm(start) })
    return
  }
  if (!a.moved) { emit('open', a.b.x); return }
  const d = drag.value
  drag.value = null
  if (!d) return
  try { navigator.vibrate?.(10) } catch (_) {}
  emit('move', a.b.task, { start: hm(d.start), end: d.end != null ? hm(d.end) : null, row: d.row })
}
function onCancel() { act = null; drag.value = null; tip.value = null }

const boxOpen = ref(false)
function pick(x) { placing.value = x; boxOpen.value = false }
const KIND_LABEL = { prep: '仕込み', clean: '清掃', order: '発注・納品' }
</script>

<template>
  <div class="db">
    <div v-if="evts.length" class="db-evts">
      <button v-for="x in evts" :key="x.key" type="button" class="db-evt" @click="emit('open', x)"><span>{{ x.title }}</span><i aria-hidden="true"></i><small v-if="x.sub">{{ x.sub }}</small></button>
    </div>

    <div v-if="strip.length" class="db-all">
      <span class="db-lab">終日</span>
      <button v-for="x in strip" :key="x.key" type="button" :class="['db-ad', x.state, x.ref.type]" @click="emit('open', x)">
        {{ x.state === 'done' ? '✓ ' : '' }}<LineIcon v-if="x.ref.type === 'list'" name="repeat" size="1em" />{{ x.ref.type === 'list' ? ' ' : '' }}{{ x.title }}<small v-if="x.ref.type === 'list' && x.sub"> {{ x.sub }}</small>
      </button>
    </div>
    <div v-if="lane.length" class="db-lane">
      <button type="button" class="db-lane-h" :aria-expanded="laneOpen" @click="laneOpen = !laneOpen"><LineIcon name="hourglass" /> 進行中 {{ lane.length }}（済むまで毎日出る）{{ laneOpen ? '▲' : '▼' }}</button>
      <template v-if="laneOpen">
        <button v-for="x in lane" :key="x.key" type="button" class="db-pbar" @click="emit('open', x)"><b>{{ x.title }}</b><small v-if="x.sub">{{ x.sub }}</small></button>
      </template>
    </div>

    <div class="db-board">
      <div class="db-rows">
        <div class="db-rh"></div>
        <div v-for="r in rows" :key="r.id" class="db-r" :style="{ height: ROW_H + 'px' }">
          <span class="db-av" aria-hidden="true"><LineIcon v-if="r.id === 'all'" name="users" size="1em" /><template v-else>{{ r.name.slice(0, 1) }}</template></span><span class="db-nm" :title="r.name">{{ r.name }}</span><small v-if="r.sub">{{ r.sub }}</small>
        </div>
      </div>
      <div ref="scrollEl" class="db-scroll">
        <div ref="canvasEl" class="db-canvas" :style="{ width: W + 'px', height: (22 + rows.length * ROW_H) + 'px' }"
          @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onCancel">
          <div class="db-axis">
            <template v-for="t in END - START + 1" :key="t">
              <span v-if="hourW > 30 || (START + t - 1) % 3 === 0" :style="{ left: xOf((START + t - 1) * 60) + 'px' }">{{ hourW > 30 ? `${START + t - 1}:00` : `${START + t - 1}時` }}</span>
            </template>
          </div>
          <div class="db-grid">
            <div class="db-off" :style="{ left: 0, width: xOf(OPEN * 60) + 'px' }"></div>
            <div class="db-off" :style="{ left: xOf(CLOSE * 60) + 'px', width: Math.max(0, W - xOf(CLOSE * 60)) + 'px' }"></div>
            <template v-for="t in END - START + 1" :key="`v${t}`">
              <div class="db-vl h" :style="{ left: xOf((START + t - 1) * 60) + 'px' }"></div>
              <div v-if="hourW > 30 && t <= END - START" class="db-vl" :style="{ left: xOf((START + t - 1) * 60 + 30) + 'px' }"></div>
            </template>
            <div v-for="(r, i) in rows" :key="`h${r.id}`" class="db-hl" :style="{ top: (i + 1) * ROW_H + 'px' }"></div>
            <div v-if="isToday && nowM >= START * 60 && nowM <= END * 60" class="db-now" :style="{ left: xOf(nowM) + 'px' }"><span>いま</span></div>
            <button v-for="b in bands" :key="b.key" type="button" class="db-band" :style="{ left: xOf(b.from) + 'px', width: Math.max(20, xOf(b.to) - xOf(b.from)) + 'px', top: '7px', height: (ROW_H - 14) + 'px' }" @click="emit('open', b.x)">
              <b>{{ b.title }}</b><small>{{ hmShort(b.from) }}〜{{ hmShort(b.to) }}</small>
            </button>
            <div v-for="b in blocks" :key="b.key" :data-block="b.key" role="button" tabindex="0"
              :class="['db-blk', `k-${b.kind}`, b.state, { pin: b.end == null, fixed: !b.movable, drag: drag && b.task && drag.id === b.task.id, thin: b.end != null && Math.max(26, xOf(b.end) - xOf(b.start)) < 56 }]"
              :style="style(b)" :aria-label="`${b.title} ${hmShort(b.start)}${b.end != null ? '〜' + hmShort(b.end) : ''}`"
              @keydown.enter="emit('open', b.x)">
              <span class="db-t">{{ b.state === 'done' ? '✓ ' : '' }}<LineIcon v-if="b.kind === 'routine'" name="repeat" size="1em" />{{ b.kind === 'routine' ? ' ' : '' }}{{ b.title }}</span>
              <small>{{ b.end != null ? `${hmShort(b.start)}〜${hmShort(b.end)}` : b.kind === 'task' || KIND_LABEL[b.kind] ? `${hmShort(b.start)}までに` : `${hmShort(b.start)}${b.sub ? ` ・ ${b.sub}` : ''}` }}</small>
              <span v-if="b.movable && b.end != null" class="db-grip" data-grip="1" aria-hidden="true"></span>
            </div>
            <div v-if="tip" class="db-tip" :style="{ left: tip.left + 'px', top: tip.top + 'px' }">{{ tip.text }}</div>
          </div>
        </div>
      </div>
    </div>

    <p v-if="placing" class="db-placing" role="status">「{{ placing.title }}」を置くマスを押してください<button type="button" @click="placing = null">やめる</button></p>
    <button v-if="someday.length && canAdd" type="button" class="db-box" @click="boxOpen = !boxOpen"><LineIcon name="inbox" /> いつか<b>{{ someday.length }}</b></button>
    <div v-if="boxOpen" class="db-boxlist" role="dialog" aria-label="いつか">
      <p>選んでからボードのマスを押すと、その時間・その人に入ります</p>
      <button v-for="x in someday" :key="x.key" type="button" @click="pick(x)">{{ x.title }}<small>置く ›</small></button>
    </div>
  </div>
</template>

<style scoped>
.db { position: relative; display: flex; flex-direction: column; min-height: 0; flex: 1; }
.db-evts { display: grid; gap: 2px; padding: 6px 12px 0; }
.db-evt { display: flex; align-items: center; gap: 8px; min-height: 26px; padding: 0; border: none; background: none; font: inherit; cursor: pointer; text-align: left; color: #c2410c; }
.db-evt span { flex: none; max-width: 70%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 900; padding: 0 7px; border: 1.5px solid currentColor; border-radius: 6px; background: #fff7ed; }
.db-evt i { flex: 1; min-width: 16px; border-top: 1.5px solid currentColor; opacity: .7; }
.db-evt small { flex: none; font-size: 11px; font-weight: 800; color: #9a3412; }
.db-all { display: flex; gap: 6px; align-items: center; padding: 6px 12px; overflow-x: auto; scrollbar-width: none; }
.db-lab { flex: none; font-size: 10.5px; font-weight: 800; color: var(--text-muted); }
.db-ad { flex: none; border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 5px 9px; font: inherit; font-size: 12px; font-weight: 800; color: var(--text); cursor: pointer; white-space: nowrap; }
.db-ad.done { color: #94a3b8; text-decoration: line-through; }
.db-ad.missed { border-color: #fca5a5; color: #b91c1c; }
.db-ad.list { border-style: dashed; border-color: #0d9488; }
.db-ad small { font-weight: 700; color: var(--text-muted); }
.db-lane { display: grid; gap: 4px; padding: 4px 12px 6px; }
.db-lane-h { justify-self: start; border: none; background: none; font: inherit; font-size: 11px; font-weight: 800; color: #b45309; cursor: pointer; padding: 2px 0; }
.db-pbar { display: flex; gap: 8px; align-items: center; text-align: left; border: 1.5px solid #fcd34d; background: #fffbeb; color: #78350f; border-radius: 8px; padding: 5px 9px; font: inherit; font-size: 12px; cursor: pointer; }
.db-pbar b { font-weight: 800; } .db-pbar small { margin-left: auto; font-size: 10.5px; color: #b45309; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 50%; }
.db-board { flex: 1; min-height: 0; display: grid; grid-template-columns: 62px 1fr; overflow-y: auto; border-top: 1px solid var(--border); background: var(--surface); }
.db-rows { border-right: 1px solid var(--border); }
.db-rh { height: 22px; border-bottom: 1px solid var(--border); }
.db-r { display: flex; flex-direction: column; justify-content: center; gap: 1px; padding: 0 8px; border-bottom: 1px solid #eef2f4; font-size: 12px; font-weight: 900; color: var(--text); box-sizing: border-box; overflow: hidden; }
.db-nm { max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }   /* 名前は1行（「オーナ／ー」と折れない・2026-11-09 触診） */
.db-r small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.db-r small { font-size: 9.5px; color: var(--text-muted); font-weight: 700; }
.db-av { width: 22px; height: 22px; border-radius: 50%; background: #f1f5f9; display: flex; align-items: center; justify-content: center; font-size: 11px; }
.db-scroll { overflow-x: auto; overflow-y: hidden; }
.db-canvas { position: relative; touch-action: pan-x pan-y; user-select: none; -webkit-user-select: none; }
.db-axis { height: 22px; border-bottom: 1px solid var(--border); position: relative; }
.db-axis span { position: absolute; top: 4px; font-size: 10px; font-weight: 800; color: var(--text-muted); transform: translateX(-50%); font-variant-numeric: tabular-nums; white-space: nowrap; }
.db-grid { position: absolute; left: 0; right: 0; top: 22px; bottom: 0; }
.db-off { position: absolute; top: 0; bottom: 0; background: repeating-linear-gradient(45deg, #f3f6f8, #f3f6f8 6px, #fff 6px, #fff 12px); }
.db-vl { position: absolute; top: 0; bottom: 0; width: 1px; background: #eef2f4; } .db-vl.h { background: #dbe6ea; }
.db-hl { position: absolute; left: 0; right: 0; height: 1px; background: #eef2f4; }
.db-now { position: absolute; top: 0; bottom: 0; width: 2px; background: #dc2626; z-index: 6; pointer-events: none; }
.db-now span { position: absolute; top: 2px; left: 3px; background: #dc2626; color: #fff; font-size: 9.5px; font-weight: 900; border-radius: 5px; padding: 1px 5px; white-space: nowrap; }
.db-blk { position: absolute; box-sizing: border-box; border-radius: 8px; padding: 3px 7px; font-size: 11.5px; font-weight: 800; overflow: hidden; cursor: grab; z-index: 4; display: flex; flex-direction: column; justify-content: center; line-height: 1.25; border: 1.5px solid; touch-action: none; }
.db-blk small { font-size: 9.5px; font-weight: 700; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* 帯の文字は1行。短い帯で文字が縦に積まれないように（2026-11-09 触診: 数分の棚卸の記録） */
.db-blk .db-t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.db-t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.db-blk.k-task { background: #cffafe; border-color: #0e7490; color: #0b4f61; }
.db-blk.k-prep { background: #ede9fe; border-color: #7c3aed; color: #4c1d95; }
.db-blk.k-clean { background: #dcfce7; border-color: #15803d; color: #14532d; }
.db-blk.k-order { background: #ffedd5; border-color: #c2410c; color: #7c2d12; }
.db-blk.k-routine { background: #f0fdfa; border-color: #0d9488; color: #134e4a; border-style: dashed; }
.db-blk.k-rec { background: #f1f5f9; border-color: #94a3b8; color: #334155; border-style: dashed; }
.db-blk.fixed { cursor: pointer; }
.db-blk.pin { border-radius: 999px; }
.db-blk.done { opacity: .55; } .db-blk.done .db-t { text-decoration: line-through; }
.db-blk.missed { box-shadow: inset 0 0 0 1.5px #fca5a5; }
.db-blk.thin .db-t, .db-blk.thin small { visibility: hidden; }
.db-blk.drag { z-index: 20; box-shadow: 0 10px 20px rgba(0,0,0,.22); cursor: grabbing; }
.db-grip { position: absolute; right: 0; top: 0; bottom: 0; width: 14px; cursor: ew-resize; }
.db-grip::after { content: ''; position: absolute; right: 5px; top: 30%; bottom: 30%; width: 2px; border-radius: 2px; background: currentColor; opacity: .45; }
.db-band { position: absolute; box-sizing: border-box; border: 1.5px dashed #0284c7; border-radius: 8px; background: repeating-linear-gradient(-45deg, #e0f2fe, #e0f2fe 5px, #f0f9ff 5px, #f0f9ff 10px); color: #075985; font: inherit; font-size: 11px; text-align: left; padding: 3px 7px; display: flex; flex-direction: column; justify-content: center; overflow: hidden; cursor: pointer; z-index: 2; }
.db-band b { font-weight: 800; white-space: nowrap; } .db-band small { font-size: 9.5px; font-weight: 700; }
.db-tip { position: absolute; z-index: 25; background: #12303a; color: #fff; font-size: 11px; font-weight: 800; border-radius: 7px; padding: 3px 7px; pointer-events: none; white-space: nowrap; font-variant-numeric: tabular-nums; transform: translateY(-2px); }
.db-placing { position: absolute; left: 12px; right: 12px; bottom: 86px; z-index: 12; margin: 0; background: var(--primary, #0e7490); color: #fff; border-radius: 12px; padding: 9px 12px; font-size: 12.5px; font-weight: 800; display: flex; align-items: center; gap: 8px; }
.db-placing button { margin-left: auto; border: none; background: rgba(255,255,255,.2); color: #fff; border-radius: 8px; padding: 5px 9px; font: inherit; font-weight: 800; cursor: pointer; }
.db-box { position: absolute; left: 12px; bottom: 22px; z-index: 10; border: 1.5px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--text); font: inherit; font-size: 12.5px; font-weight: 900; padding: 9px 13px; box-shadow: 0 4px 12px rgba(0,0,0,.16); cursor: pointer; }
.db-box b { background: var(--primary, #0e7490); color: #fff; border-radius: 999px; padding: 0 7px; margin-left: 5px; font-size: 11px; }
.db-boxlist { position: absolute; left: 12px; right: 12px; bottom: 70px; z-index: 11; background: var(--surface); border-radius: 14px; box-shadow: 0 10px 24px rgba(0,0,0,.2); padding: 10px; display: grid; gap: 6px; max-height: 50%; overflow-y: auto; }
.db-boxlist p { margin: 0; font-size: 11.5px; color: var(--text-muted); }
.db-boxlist button { display: flex; align-items: center; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 9px 10px; font: inherit; font-size: 13px; font-weight: 800; color: var(--text); text-align: left; cursor: pointer; }
.db-boxlist button small { margin-left: auto; color: var(--primary, #0e7490); font-size: 11px; }
@media (prefers-reduced-motion: reduce) { .db-blk { transition: none; } }
</style>
