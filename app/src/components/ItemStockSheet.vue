<script setup>
/**
 * ホームの品目シート（User決定 2026-10-03・モックで確認）。
 *
 * 一覧の行をタップして開く。ここで入庫・出庫をその場で登録できる。
 * - 今の見込み（論理在庫）＝直近の棚卸＋入庫−出庫
 * - 入庫欄と出庫欄は別々。両方に入れたら差し引かず、入庫1件・出庫1件として記録する
 * - 登録ボタンは数を入れたときだけ出し、登録後の見込みも添える
 * - 品目の情報（写真・単位・入数・ジャンル・単価・商品コード）と「直す」
 * - この品目だけの月カレンダー（入庫 +n／出庫 −n の2段・棚卸した日は「棚n」）と、日の明細
 * - 棚卸の最中は入出庫を止める（数え直しの最中に見込みを動かさない）
 * - 明細の「取り消す」は記録を残して印を付ける。取り消してから24時間は「元に戻す」（migration 0019）
 * 発注点・目安・補充目標はここに出さない（発注点は管理タブへ移す）。
 */
import { ref, computed } from 'vue'
import { useEscapeKey } from '../composables/useEscapeKey.js'
import { itemDayLog } from '../services/itemDayLog.js'
import { itemImageUrl } from '../services/itemImages.js'
import { localDateKey } from '../utils/localDate.js'
import { canRestoreMovement } from '../composables/useMovements.js'
import MovementQtyModal from './MovementQtyModal.vue'

const props = defineProps({
  item:      { type: String, required: true },
  unit:      { type: String, default: '' },
  theo:      { type: Number, default: null },
  basis:     { type: String, default: '' },
  lot:       { type: [Number, String], default: null },
  price:     { type: [Number, String], default: null },
  category:  { type: String, default: '' },
  code:      { type: String, default: '' },
  imageRef:  { type: String, default: '' },
  movements: { type: Array, default: () => [] },
  snapshots: { type: Array, default: () => [] },
  editable:  { type: Boolean, default: true },    // 品目の情報を直せる（完了の確定待ちでは false）
  stocktakeOpen: { type: Boolean, default: false }, // 棚卸の最中（入出庫を止める）
})
const emit = defineEmits(['register', 'void', 'restore', 'edit', 'close'])
useEscapeKey(() => emit('close'))

const fmt = n => (Math.round(Number(n) * 1000) / 1000).toLocaleString('ja-JP')

// ── 入庫・出庫 ─────────────────────────────
const inQty = ref('')
const outQty = ref('')
const done = ref('')
const _num = v => { const n = Number(String(v).replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : 0 }
const inN = computed(() => _num(inQty.value))
const outN = computed(() => _num(outQty.value))
const canInput = computed(() => props.editable && !props.stocktakeOpen)
const showRegister = computed(() => canInput.value && (inN.value > 0 || outN.value > 0))
const after = computed(() => (props.theo ?? 0) + inN.value - outN.value)
// 数は棚卸と同じテンキー（NumPad）のシートで入れる（User 2026-10-03）。OS キーボードは出さない
const pad = ref(null)   // null | 'in' | 'out'
const lotNum = computed(() => { const n = parseFloat(props.lot); return Number.isFinite(n) && n > 1 ? n : null })
// テンキーの「理論 → 記録後」は、もう片方の欄に入れた数も含めた見込みから出す
const padTheo = computed(() => {
  if (props.theo == null && !inN.value && !outN.value) return null
  const base = props.theo ?? 0
  return Math.round((pad.value === 'in' ? base - outN.value : base + inN.value) * 1000) / 1000
})
function onPad(v) {
  if (pad.value === 'in') inQty.value = v > 0 ? String(v) : ''
  else if (pad.value === 'out') outQty.value = v > 0 ? String(v) : ''
  pad.value = null
}
function register() {
  if (!showRegister.value) return
  const payload = { in: inN.value, out: outN.value }
  emit('register', payload)
  done.value = [payload.in ? `入庫 +${fmt(payload.in)}` : '', payload.out ? `出庫 −${fmt(payload.out)}` : ''].filter(Boolean).join('・')
  inQty.value = ''; outQty.value = ''
  selDay.value = localDateKey()
  month.value = _monthOf(selDay.value)
}

// ── カレンダー ─────────────────────────────
const log = computed(() => itemDayLog(props.item, props.movements, props.snapshots))
function _monthOf(key) { const [y, m] = key.split('-').map(Number); return { y, m } }
const selDay = ref(localDateKey())
const month = ref(_monthOf(selDay.value))
function moveMonth(d) {
  let { y, m } = month.value
  m += d
  if (m < 1) { m = 12; y-- } else if (m > 12) { m = 1; y++ }
  month.value = { y, m }
}
const cells = computed(() => {
  const { y, m } = month.value
  const first = new Date(y, m - 1, 1).getDay()
  const days = new Date(y, m, 0).getDate()
  const out = []
  for (let i = 0; i < first; i++) out.push({ blank: true, key: `b${i}` })
  for (let d = 1; d <= days; d++) {
    const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    out.push({ key, d, t: log.value.days[key] || null })
  }
  return out
})
const dayEntries = computed(() => log.value.entries[selDay.value] || [])
const dayLabel = computed(() => { const [, m, d] = selDay.value.split('-').map(Number); return `${m}月${d}日` })
const KIND = { in: '入庫', out: '出庫', st: '棚卸' }
// 取り消せるのは品目シートで登録した1品目の記録だけ（納品取込などは入出庫ページで扱う）
const canVoid = e => canInput.value && e.kind !== 'st' && !e.deleted && e.quick
const canRestore = e => canInput.value && e.deleted && canRestoreMovement(e)
function doVoid(e) {
  emit('void', e.movementId)
  done.value = ''
  note.value = `${KIND[e.kind]} ${fmt(e.qty)}${e.unit || props.unit} を取り消しました（24時間以内なら元に戻せます）`
}
function doRestore(e) {
  emit('restore', e.movementId)
  note.value = `${KIND[e.kind]} ${fmt(e.qty)}${e.unit || props.unit} を元に戻しました`
}
const note = ref('')
const imgSrc = computed(() => itemImageUrl(props.imageRef, 't'))
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-sheet is-sheet" role="dialog" aria-modal="true" :aria-label="item">
      <div class="sheet-handle"></div>

      <div class="is-head">
        <span class="is-av" aria-hidden="true">
          <img v-if="imgSrc" :src="imgSrc" alt="" />
          <span v-else class="is-noimg">no<br>image</span>
        </span>
        <span class="is-name">{{ item }}</span>
        <button class="is-x" type="button" aria-label="閉じる" @click="emit('close')">✕</button>
      </div>

      <div class="is-stock">
        <div>
          <div class="is-lbl">今の見込み（論理在庫）</div>
          <div class="is-val">
            <template v-if="theo != null">{{ fmt(theo) }}<small>{{ unit }}</small></template>
            <template v-else>—</template>
          </div>
        </div>
        <div v-if="basis" class="is-basis">{{ basis }}</div>
      </div>

      <div v-if="stocktakeOpen" class="is-locked" role="status">棚卸の最中は、ここで入庫・出庫できません。棚卸が終わると使えます。</div>
      <template v-else-if="editable">
        <div class="is-io">
          <label class="in" for="is-in">入庫（増やす）
            <button id="is-in" type="button" :class="['is-field', { on: inN > 0 }]" @click="pad = 'in'">{{ inN > 0 ? fmt(inN) : '0' }}</button>
          </label>
          <label class="out" for="is-out">出庫（減らす）
            <button id="is-out" type="button" :class="['is-field', { on: outN > 0 }]" @click="pad = 'out'">{{ outN > 0 ? fmt(outN) : '0' }}</button>
          </label>
        </div>
        <button v-if="showRegister" class="is-reg" type="button" @click="register">
          登録する
          <small>{{ [inN ? `入庫 +${fmt(inN)}` : '', outN ? `出庫 −${fmt(outN)}` : ''].filter(Boolean).join(' ・ ') }}　→　{{ theo != null ? fmt(theo) : 0 }} → {{ fmt(after) }}{{ unit }}</small>
        </button>
      </template>
      <div v-if="done" class="is-done" role="status">登録しました（{{ done }}）。履歴カレンダーにも残ります</div>
      <div v-if="note" class="is-done" role="status">{{ note }}</div>

      <section class="is-sec">
        <h3>品目の情報 <button v-if="editable" type="button" class="is-edit" @click="emit('edit')">直す</button></h3>
        <div class="is-info">
          <div><small>単位</small><b>{{ unit || '—' }}</b></div>
          <div><small>入数</small><b>{{ lot || '—' }}</b></div>
          <div><small>ジャンル</small><b>{{ category || '—' }}</b></div>
          <div><small>単価</small><b>{{ price != null && price !== '' ? `¥${Number(price).toLocaleString('ja-JP')}` : '—' }}</b></div>
          <div><small>商品コード</small><b>{{ code || '—' }}</b></div>
          <div><small>写真</small><b>{{ imageRef ? 'あり' : 'なし' }}</b></div>
        </div>
      </section>

      <section class="is-sec">
        <h3>この品目のカレンダー</h3>
        <div class="is-calbar">
          <button type="button" aria-label="前の月" @click="moveMonth(-1)">‹</button>
          <b>{{ month.y }}年{{ month.m }}月</b>
          <button type="button" aria-label="次の月" @click="moveMonth(1)">›</button>
        </div>
        <div class="is-cal">
          <span v-for="w in ['日','月','火','水','木','金','土']" :key="w" class="is-wd">{{ w }}</span>
          <template v-for="c in cells" :key="c.key">
            <span v-if="c.blank" class="is-cell blank"></span>
            <button v-else type="button" :class="['is-cell', { sel: c.key === selDay }]" :data-day="c.key" @click="selDay = c.key">
              <span class="is-d">{{ c.d }}</span>
              <span v-if="c.t" class="is-ns">
                <span v-if="c.t.st != null" class="n st">棚{{ fmt(c.t.st) }}</span>
                <span v-if="c.t.in" class="n in">+{{ fmt(c.t.in) }}</span>
                <span v-if="c.t.out" class="n out">−{{ fmt(c.t.out) }}</span>
              </span>
            </button>
          </template>
        </div>
        <div class="is-legend"><span class="l-in">入庫</span><span class="l-out">出庫</span><span class="l-st">棚卸の数</span></div>

        <div class="is-day">
          <div class="is-dh">{{ dayLabel }}</div>
          <div v-for="e in dayEntries" :key="e.key" :class="['is-ent', { del: e.deleted }]">
            <span class="is-t">{{ e.time }}</span>
            <span>
              <span :class="['is-k', e.kind]">{{ KIND[e.kind] }} {{ e.kind === 'out' ? '−' : e.kind === 'in' ? '+' : '' }}{{ fmt(e.qty) }}{{ e.unit || unit }}</span>
              <span v-if="e.by || e.deleted" class="is-who">{{ e.by }}{{ e.by && e.deleted ? '・' : '' }}{{ e.deleted ? '取り消し済み' : '' }}</span>
            </span>
            <button v-if="canVoid(e)" type="button" class="is-act" @click="doVoid(e)">取り消す</button>
            <button v-else-if="canRestore(e)" type="button" class="is-act restore" @click="doRestore(e)">元に戻す</button>
            <span v-else></span>
          </div>
          <div v-if="!dayEntries.length" class="is-empty">この日の入庫・出庫・棚卸はありません</div>
        </div>
      </section>
    </div>
    <MovementQtyModal
      v-if="pad"
      :item="item"
      :mode="pad"
      :qty="pad === 'in' ? inN : outN"
      :unit="unit"
      :lot="lotNum"
      :theo="padTheo"
      @confirm="onPad"
      @cancel="pad = null"
    />
  </div>
</template>

<style scoped>
.is-sheet { max-height: 92vh; overflow-y: auto; display: grid; gap: 12px; }
.is-head { display: grid; grid-template-columns: 52px 1fr auto; gap: 10px; align-items: center; }
.is-av { width: 52px; height: 52px; border-radius: 50%; overflow: hidden; border: 1px solid #e2e8f0; background: #f1f5f9; display: flex; align-items: center; justify-content: center; }
.is-av img { width: 100%; height: 100%; object-fit: cover; }
.is-noimg { font-size: 9px; font-weight: 700; color: #94a3b8; text-align: center; line-height: 1.1; }
.is-name { font-size: 18px; font-weight: 800; color: #0f172a; overflow-wrap: anywhere; }
.is-x { border: none; background: none; font-size: 20px; color: #94a3b8; cursor: pointer; }
.is-stock { background: #eff6ff; border-radius: 14px; padding: 12px 14px; display: flex; justify-content: space-between; align-items: flex-end; gap: 10px; }
.is-lbl { font-size: 12px; font-weight: 700; color: #64748b; }
.is-val { font-size: 30px; font-weight: 800; color: var(--primary, #2563eb); font-variant-numeric: tabular-nums; }
.is-val small { font-size: 14px; margin-left: 2px; }
.is-basis { font-size: 11px; color: #64748b; text-align: right; }
.is-locked { background: #fffbeb; color: #b45309; border-radius: 10px; padding: 9px 12px; font-size: 12.5px; font-weight: 700; }
.is-io { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.is-io label { display: grid; gap: 4px; font-size: 12px; font-weight: 800; }
.is-io label.in { color: #15803d; } .is-io label.out { color: #dc2626; }
.is-field { width: 100%; box-sizing: border-box; font-size: 22px; font-weight: 700; padding: 10px 12px; border-radius: 12px; border: 2px solid #e2e8f0; text-align: right; background: #fff; color: #cbd5e1; cursor: pointer; font-variant-numeric: tabular-nums; }
.is-field.on { color: #0f172a; }
.is-io label.in .is-field.on { border-color: #15803d; background: #f0fdf4; }
.is-io label.out .is-field.on { border-color: #dc2626; background: #fef2f2; }
.is-reg { border: none; border-radius: 12px; padding: 13px; font-size: 16px; font-weight: 800; background: var(--primary, #2563eb); color: #fff; cursor: pointer; }
.is-reg small { display: block; font-size: 12px; font-weight: 600; opacity: .9; margin-top: 2px; }
.is-done { background: #f0fdf4; color: #15803d; border-radius: 10px; padding: 8px 10px; font-size: 13px; font-weight: 700; }
.is-sec { display: grid; gap: 6px; }
.is-sec h3 { margin: 0; font-size: 13px; color: #64748b; display: flex; justify-content: space-between; align-items: center; }
.is-edit { border: 1.5px solid var(--primary, #2563eb); color: var(--primary, #2563eb); background: #fff; border-radius: 8px; padding: 3px 10px; font-weight: 800; font-size: 12px; cursor: pointer; }
.is-info { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.is-info div { background: #f8fafc; border-radius: 10px; padding: 7px 8px; min-width: 0; }
.is-info small { display: block; font-size: 10px; color: #94a3b8; }
.is-info b { font-size: 14px; color: #0f172a; overflow-wrap: anywhere; }
.is-calbar { display: flex; justify-content: space-between; align-items: center; }
.is-calbar button { border: none; background: #f1f5f9; border-radius: 8px; width: 34px; height: 28px; cursor: pointer; font-size: 14px; }
.is-cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
.is-wd { font-size: 10px; text-align: center; color: #94a3b8; }
.is-cell { min-height: 48px; border-radius: 8px; background: #f8fafc; padding: 3px; display: grid; grid-template-rows: auto 1fr; font-size: 10px; border: 2px solid transparent; cursor: pointer; text-align: left; }
.is-cell.blank { background: none; cursor: default; }
.is-cell.sel { border-color: var(--primary, #2563eb); }
.is-d { color: #94a3b8; }
.is-ns { display: grid; justify-items: center; align-content: center; line-height: 1.15; }
.n { font-weight: 800; font-size: 11px; font-variant-numeric: tabular-nums; }
.n.in { color: #15803d; } .n.out { color: #dc2626; } .n.st { color: #7c3aed; font-size: 10px; }
.is-legend { display: flex; gap: 12px; font-size: 11px; color: #64748b; }
.is-legend span::before { content: ''; display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
.is-legend .l-in::before { background: #15803d; } .is-legend .l-out::before { background: #dc2626; } .is-legend .l-st::before { background: #7c3aed; }
.is-day { border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
.is-dh { padding: 8px 10px; font-weight: 800; font-size: 13px; background: #f8fafc; }
.is-ent { display: grid; grid-template-columns: 46px 1fr auto; gap: 8px; align-items: center; padding: 8px 10px; border-top: 1px solid #e2e8f0; font-size: 13px; }
.is-ent.del .is-t, .is-ent.del .is-k, .is-ent.del .is-who { opacity: .55; } .is-ent.del .is-k { text-decoration: line-through; }
.is-act { border: 1px solid #e2e8f0; background: #fff; color: #64748b; border-radius: 8px; padding: 4px 9px; font-size: 11.5px; font-weight: 700; cursor: pointer; }
.is-act.restore { color: var(--primary, #2563eb); border-color: var(--primary, #2563eb); }
.is-t { color: #94a3b8; font-variant-numeric: tabular-nums; }
.is-k { font-weight: 800; } .is-k.in { color: #15803d; } .is-k.out { color: #dc2626; } .is-k.st { color: #7c3aed; }
.is-who { color: #94a3b8; font-size: 11px; margin-left: 6px; }
.is-empty { padding: 10px; font-size: 12px; color: #94a3b8; }
</style>
