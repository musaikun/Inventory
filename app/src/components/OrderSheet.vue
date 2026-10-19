<script setup>
/**
 * 発注の1品目（User決定 2026-10-17・モック docs/mocks/order-type-first.html）。
 * トグルをやめ、「先に打って、何の数かは後で選ぶ」。
 *   発注数が分かる品目 → 打つ →「発注 N」（2手）
 *   分からない品目     → 数えた在庫を打つ →「在庫 N」＝あとで決める（在庫だけ残して次へ・User決定 2026-10-19）。
 *                        あとで開き直すと、在庫と参考の数（推奨など）が出るので、押して「発注」
 *   頼まない品目       →「発注なしで確定」（1手）
 *   完了するとき、発注数が決まっていない品目は「すべて発注なし（0）で保存しますか？」と訊く（App）
 * 在庫は強制しない（迷ったときの道具。打たれた分だけ分析にも使う）。
 * 参考の数（services/orderRefs.js）は何から出た数かを添え、欄へは自動で入れない。
 * いつもと桁が違う発注数（同じ曜日の平均の3倍以上か3分の1以下）は、確定の前に1回だけ訊く。
 *
 * 送る形は ConfirmModal の発注と同じ（App の _applyOrderConfirm）:
 *   { ingredient, orderMode:true, stock, orderQty, stockOnly, unit, lot }
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import NumPad from './NumPad.vue'
import CoachDemo from './CoachDemo.vue'
import { orderRefs, unusualOrder } from '../services/orderRefs.js'

const props = defineProps({
  ingredient:      { type: String, required: true },
  unit:            { type: String, default: '' },
  orderLot:        { type: Number, default: 1 },
  orders:          { type: Array,  default: () => [] },   // 発注の記録（参考の数を出す）
  today:           { type: String, required: true },     // 'YYYY-MM-DD'
  target:          { type: Object, default: null },      // 補充目標 { value, source }
  theoStock:       { type: Object, default: null },      // 理論在庫 { qty }
  existingStock:   { type: Number, default: null },      // この発注で入れた在庫
  initialOrderQty: { type: Number, default: null },      // この発注で入れた発注数
  decidedNone:     { type: Boolean, default: false },    // この発注で「発注なし」にした
  canPrev:         { type: Boolean, default: false },
  canNext:         { type: Boolean, default: false },
  typingUser:      { type: String, default: null },
  initialTyped:    { type: Number, default: null },      // 音声・文字検索で言った数（何の数かは人が選ぶ）
})
const emit = defineEmits(['confirm', 'cancel', 'navigate'])

const lotLabel = computed(() => (props.orderLot > 1 ? '口' : (props.unit || '')))
const typed = ref(props.initialTyped != null ? String(props.initialTyped) : '')   // いま打っている数
const confirmUnusual = ref(null)   // { qty, usual } いつもと違う数の確認中

const typedNum = computed(() => {
  const n = parseFloat(typed.value)
  return typed.value === '' || isNaN(n) ? null : n
})
const isInt = computed(() => typedNum.value !== null && Number.isInteger(typedNum.value))
const refs = computed(() => orderRefs(props.orders, props.ingredient, props.today, {
  target: props.target, lot: props.orderLot,
  stock: props.existingStock,
}))

// ── テンキー ──
function digit(d) { confirmUnusual.value = null; typed.value = typed.value === '0' ? d : typed.value + d }
function dot() { if (!typed.value.includes('.')) typed.value = (typed.value || '0') + '.' }
function back() { confirmUnusual.value = null; typed.value = typed.value.slice(0, -1) }
function clear() { confirmUnusual.value = null; typed.value = '' }
function useRef(r) { confirmUnusual.value = null; typed.value = String(r.qty) }

// ── 送る ──
const _payload = (orderQty, { stock = null, stockOnly = false } = {}) => ({
  ingredient: props.ingredient, orderMode: true,
  stock, orderQty, stockOnly, unit: props.unit, lot: props.orderLot,
})
function chooseOrder(force = false) {
  if (!isInt.value) return
  const q = typedNum.value
  const odd = !force && unusualOrder(q, refs.value)
  if (odd) { confirmUnusual.value = { qty: q, usual: odd.usual }; return }
  emit('confirm', _payload(q))
}
// 在庫を入れた＝発注はあとで決める（発注の下書きも「発注なし」も変えない・User決定 2026-10-19）
function chooseStock() {
  if (typedNum.value === null || typedNum.value < 0) return
  emit('confirm', _payload(0, { stock: typedNum.value, stockOnly: true }))
}
function chooseNone() { emit('confirm', _payload(0)) }
// 打ちかけの数は捨てて移る（何の数か決めていない）
function navigate(dir) { emit('navigate', { dir, skip: true }) }

// ── PCキーボード ──
function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); emit('cancel') }
  else if (e.key === 'Backspace') { e.preventDefault(); back() }
  else if (/^[0-9]$/.test(e.key)) digit(e.key)
  else if (e.key === '.') dot()
}
onMounted(() => document.addEventListener('keydown', onKey))
onUnmounted(() => document.removeEventListener('keydown', onKey))

const coach = ref(null)
const COACH_STEPS = [
  { caption: 'まず数を打ちます（発注数でも、数えた在庫でも）' },
  { caption: '発注数が分かっていれば「発注」を押して、次の品目へ' },
  { caption: '迷ったら、数えた在庫を打って「在庫」。発注はあとで決めます' },
  { caption: 'あとで開くと、在庫と参考の数（推奨など）が出ます。押して「発注」' },
]
</script>

<template>
  <div class="modal-overlay" @click.self="emit('cancel')">
    <div class="modal-sheet os">
      <div class="sheet-handle"></div>
      <div v-if="typingUser" class="os-typing">✏️ {{ typingUser }}が入力中…</div>

      <div class="os-head">
        <div class="os-name-row">
          <button class="os-nav" type="button" :disabled="!canPrev" aria-label="前の品目" @click="navigate('prev')">◀</button>
          <span class="os-name">{{ ingredient }}</span>
          <button class="os-help" type="button" aria-label="使い方を見る" @click="coach?.open()">？</button>
          <button class="os-nav" type="button" :disabled="!canNext" aria-label="次の品目" @click="navigate('next')">▶</button>
        </div>
        <!-- 参考（押せない札）。在庫を打たずに決められる品目を増やす -->
        <div class="os-facts">
          <span v-if="initialOrderQty > 0" class="os-fact now">いまの発注 {{ initialOrderQty }}{{ lotLabel }}</span>
          <span v-else-if="decidedNone" class="os-fact now">いまは発注なし</span>
          <span v-if="existingStock != null" class="os-fact stock">在庫 {{ existingStock }}{{ unit }} ✓</span>
          <span v-else-if="theoStock" class="os-fact" :title="'直近の棚卸と入出庫から'">理論在庫 約{{ theoStock.qty }}{{ unit }}</span>
          <span v-if="orderLot > 1" class="os-fact">1口 = {{ orderLot }}{{ unit }}</span>
        </div>
      </div>

      <div :class="['os-disp', { empty: typed === '' }]">{{ typed === '' ? '数を打つ' : typed }}</div>

      <!-- 参考の数（押すと入る。自動では入れない）。推奨は在庫が入っていて、補充目標が分かるときだけ -->
      <div v-if="refs.refs.length" class="os-refs">
        <button v-for="r in refs.refs" :key="r.key" type="button" :class="['os-ref', r.key]" @click="useRef(r)">
          {{ r.label }}{{ lotLabel }}<small>{{ r.sub }}</small>
        </button>
      </div>

      <div v-if="confirmUnusual" class="os-warn" role="alert">
        いつもの{{ confirmUnusual.usual }}{{ lotLabel }}に比べて <b>{{ confirmUnusual.qty }}{{ lotLabel }}</b> です。よいですか？
        <div class="os-warn-row">
          <button type="button" class="os-btn none" @click="clear">直す</button>
          <button type="button" class="os-btn order" @click="chooseOrder(true)">{{ confirmUnusual.qty }}{{ lotLabel }}で発注</button>
        </div>
      </div>

      <NumPad @digit="digit" @dot="dot" @backspace="back" @clear="clear" />

      <!-- 打った数を「発注」か「在庫」かここで選ぶ -->
      <div class="os-two">
        <button type="button" class="os-btn order" :disabled="!isInt" @click="chooseOrder()">
          {{ typedNum === null ? '発注' : `発注 ${typedNum}${lotLabel}` }}
          <small>{{ typedNum === null ? '数を打つと押せる' : isInt ? 'これで決まり → 次へ' : '発注は整数で' }}</small>
        </button>
        <button type="button" class="os-btn stock" :disabled="typedNum === null" @click="chooseStock">
          {{ typedNum === null ? '在庫' : `在庫 ${typedNum}${unit}` }}
          <small>{{ typedNum === null ? '数を打つと押せる' : '数えた数 → 発注はあとで' }}</small>
        </button>
      </div>

      <div class="os-foot">
        <button type="button" class="os-link" @click="emit('cancel')">キャンセル</button>
        <button v-if="typed === ''" type="button" class="os-btn none wide" @click="chooseNone">発注なしで確定</button>
      </div>

      <CoachDemo ref="coach" id="coach-order-type-first" title="発注の入れ方" :steps="COACH_STEPS">
        <template #scene="{ step: s }">
          <div class="cs">
            <div class="cs-name">キャベツ</div>
            <div v-if="s === 3" class="cs-chips"><span class="cs-st">在庫 3玉 ✓</span></div>
            <div :class="['cs-disp', { order: s === 3 }]">{{ s === 3 ? '2' : '3' }}</div>
            <div v-if="s === 3" class="cs-chips"><span class="cs-tap">推奨 2口</span><span>前回 3口</span></div>
            <div class="cs-two">
              <span :class="['cs-b', 'o', { hit: s === 1 || s === 3 }]">発注 {{ s === 3 ? 2 : 3 }}口</span>
              <span :class="['cs-b', 's', { hit: s === 2 }]">在庫 {{ s === 3 ? 2 : 3 }}玉</span>
            </div>
            <span v-if="s === 0" class="cs-finger f0">👆</span>
            <span v-if="s === 1" class="cs-finger f1">👆</span>
            <span v-if="s === 2" class="cs-finger f2">👆</span>
            <span v-if="s === 3" class="cs-finger f3">👆</span>
          </div>
        </template>
      </CoachDemo>
    </div>
  </div>
</template>

<style scoped>
.os { display: grid; gap: 10px; }
.os-typing { font-size: 12px; font-weight: 700; color: #92400e; background: #fffbeb; border-radius: 8px; padding: 6px 10px; }
.os-head { background: var(--primary-weak, #ecfeff); border-radius: 12px; padding: 10px; display: grid; gap: 6px; }
.os-name-row { display: flex; align-items: center; gap: 6px; }
.os-name { flex: 1; min-width: 0; text-align: center; font-size: 17px; font-weight: 900; color: var(--primary-deep, #155e75); }
.os-nav, .os-help { flex: none; width: 34px; height: 34px; border: none; border-radius: 9px; background: var(--primary-soft, #cffafe); color: var(--primary, #0e7490); font-weight: 900; cursor: pointer; }
.os-help { width: 28px; height: 28px; border-radius: 50%; font-size: 13px; }
.os-nav:disabled { opacity: .28; cursor: default; }
.os-facts { display: flex; justify-content: center; gap: 5px; flex-wrap: wrap; }
.os-fact { font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 999px; background: #fff; border: 1px solid var(--border, #d6e6ea); color: var(--text-muted, #4c6a72); }
.os-fact.rec { color: var(--primary, #0e7490); border-color: #a5f3fc; }
.os-fact.now { color: #047857; border-color: #86efac; }
.os-fact.stock { color: #0369a1; border-color: #7dd3fc; }
.os-disp { border: 2px solid var(--primary, #0e7490); border-radius: 12px; min-height: 60px; display: grid; place-items: center; font-size: 32px; font-weight: 900; color: var(--text, #12303a); font-variant-numeric: tabular-nums; }
.os-disp.empty { border-color: var(--border, #d6e6ea); color: #94a3b8; font-size: 20px; }
.os-refs { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
.os-ref { display: grid; justify-items: center; border: 1px solid #a5f3fc; background: #ecfeff; color: var(--primary, #0e7490); border-radius: 12px; padding: 6px 10px; font-size: 13px; font-weight: 800; cursor: pointer; }
.os-ref small { font-size: 10px; font-weight: 600; color: var(--text-muted, #4c6a72); }
.os-ref.rec { border-color: var(--primary, #0e7490); }
.os-warn { background: #fef3c7; border: 1px solid #fcd34d; color: #92400e; border-radius: 12px; padding: 10px; font-size: 13px; font-weight: 700; display: grid; gap: 8px; }
.os-warn-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.os-two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.os-btn { display: grid; justify-items: center; align-content: center; gap: 1px; min-height: 54px; border-radius: 12px; font-size: 15px; font-weight: 900; cursor: pointer; border: none; }
.os-btn small { font-size: 10.5px; font-weight: 700; opacity: .85; }
.os-btn.order { background: #16a34a; color: #fff; }
.os-btn.stock { background: #fff; color: #b45309; border: 2px solid #fdba74; }
.os-btn.none { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }
.os-btn:disabled { opacity: .38; cursor: not-allowed; }
.os-btn.wide { flex: 1; min-height: 44px; }
.os-foot { display: flex; gap: 8px; align-items: center; }
.os-link { border: none; background: none; color: var(--text-muted, #4c6a72); font-weight: 800; font-size: 13px; padding: 10px 8px; cursor: pointer; }
/* お手本 */
.cs { display: grid; gap: 8px; position: relative; }
.cs-name { text-align: center; font-weight: 900; color: var(--primary-deep, #155e75); }
.cs-disp { border: 2px solid var(--primary, #0e7490); border-radius: 10px; background: #fff; text-align: center; font-size: 26px; font-weight: 900; padding: 6px; }
.cs-disp.order { border-color: #16a34a; background: #f0fdf4; }
.cs-chips { display: flex; gap: 6px; justify-content: center; }
.cs-chips span { font-size: 11px; font-weight: 800; padding: 4px 8px; border-radius: 999px; border: 1px solid #a5f3fc; background: #ecfeff; color: var(--primary, #0e7490); }
.cs-chips .cs-tap { outline: 3px solid #fbbf24; }
.cs-chips .cs-st { color: #0369a1; border-color: #7dd3fc; background: #fff; }
.cs-two { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.cs-b { border-radius: 10px; padding: 10px 4px; text-align: center; font-weight: 900; font-size: 13px; transition: transform .2s, box-shadow .2s; }
.cs-b.o { background: #16a34a; color: #fff; }
.cs-b.s { background: #fff; color: #b45309; border: 2px solid #fdba74; }
.cs-b.n { background: #f1f5f9; color: #475569; }
.cs-b.hit { transform: scale(1.06); box-shadow: 0 0 0 3px #fbbf24; }
.cs-finger { position: absolute; font-size: 26px; animation: cs-tap 1.1s ease-in-out infinite; }
.cs-finger.f0 { left: 58%; top: 46px; }
.cs-finger.f1 { left: 18%; bottom: -6px; }
.cs-finger.f2 { right: 18%; bottom: -6px; }
.cs-finger.f3 { left: 47%; top: 116px; }
@keyframes cs-tap { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px) scale(.92); } }
@media (prefers-reduced-motion: reduce) { .cs-finger { animation: none; } .cs-b { transition: none; } }
</style>
