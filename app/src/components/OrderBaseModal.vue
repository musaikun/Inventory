<script setup>
/**
 * 発注基準（発注点・補充目標）の設定。
 *
 * 実績の無い品目にも値を付けるため、店舗の仮定3つ（届くまで・余裕・何日分置いているか）を
 * 先に訊き、直近の在庫から「仮」の値を出す（services/assumedOrderBase）。
 * 仮の値は保存しない。実績が貯まれば自動で替わり、人が入れた値だけが残る。
 */
import { ref, computed } from 'vue'
import { useEscapeKey } from '../composables/useEscapeKey.js'
import { defaultStockDays, DEFAULT_LEAD_DAYS, DEFAULT_SAFETY_DAYS } from '../services/assumedOrderBase.js'

const props = defineProps({
  // [{ item, category, reorder:{value,source,basis}|null, target:{value,source,basis}|null }]
  rows:         { type: Array, default: () => [] },
  unitOf:       { type: Function, default: () => '' },
  assumptions:  { type: Object, default: null },
  intervalDays: { type: Number, default: 7 },
})
const emit = defineEmits(['saveAssumptions', 'setReorder', 'close'])
useEscapeKey(() => emit('close'))

const LEAD_OPTIONS   = [{ v: 0, label: '当日' }, { v: 1, label: '1日' }, { v: 2, label: '2日' }, { v: 3, label: '3日' }]
const SAFETY_OPTIONS = [{ v: 0, label: 'なし' }, { v: 1, label: '1日' }, { v: 2, label: '2日' }]

// ── 仮定（保存するまで config へは書かない）──
const editing = ref(!props.assumptions)
const lead    = ref(props.assumptions?.leadDays ?? DEFAULT_LEAD_DAYS)
const safety  = ref(props.assumptions?.safetyDays ?? DEFAULT_SAFETY_DAYS)
const stock   = ref(props.assumptions?.stockDays ?? null)   // null = 発注間隔から出す
const byCat   = ref({ ...(props.assumptions?.stockDaysByCategory ?? {}) })
const showCats = ref(Object.keys(byCat.value).length > 0)

const autoStock = computed(() => defaultStockDays(props.intervalDays, safety.value))
const stockShown = computed(() => stock.value ?? autoStock.value)
function stepStock(d) { stock.value = Math.min(60, Math.max(1, stockShown.value + d)) }

const categories = computed(() => {
  const set = new Set(props.rows.map(r => r.category).filter(Boolean))
  return [...set]
})
function onCatInput(cat, e) {
  const v = Number(e.target.value)
  if (e.target.value === '' || !(v >= 1)) delete byCat.value[cat]
  else byCat.value[cat] = Math.min(60, v)
}

function save() {
  emit('saveAssumptions', {
    leadDays: lead.value, safetyDays: safety.value, stockDays: stock.value,
    stockDaysByCategory: { ...byCat.value },
  })
  editing.value = false
}
function turnOff() { emit('saveAssumptions', null); editing.value = true }

const summary = computed(() => {
  const a = props.assumptions
  if (!a) return ''
  const days = a.stockDays ?? defaultStockDays(props.intervalDays, a.safetyDays)
  const cats = Object.keys(a.stockDaysByCategory ?? {}).length
  return `届くまで${a.leadDays}日・余裕${a.safetyDays}日・${days}日分${cats ? `（ジャンル別 ${cats}件）` : ''}`
})

// ── 一覧 ──
const KIND = { manual: 'manual', assumed: 'assumed', consumption: 'actual', stocktakeMin: 'actual' }
const KIND_LABEL = { manual: '手動', assumed: '仮', actual: '実績', none: '未設定' }
const kindOf = (r) => KIND[r.reorder?.source] ?? 'none'

const filter = ref('all')
const counts = computed(() => {
  const c = { all: props.rows.length, none: 0, assumed: 0 }
  for (const r of props.rows) {
    const k = kindOf(r)
    if (k === 'none') c.none++
    if (k === 'assumed') c.assumed++
  }
  return c
})
const groups = computed(() => {
  const out = new Map()
  for (const r of props.rows) {
    if (filter.value !== 'all' && kindOf(r) !== filter.value) continue
    const g = r.category || '（ジャンルなし）'
    if (!out.has(g)) out.set(g, [])
    out.get(g).push(r)
  }
  return [...out.entries()]
})

function onReorderInput(item, e) { emit('setReorder', item, e.target.value) }
function resetReorder(item) { emit('setReorder', item, '') }
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-sheet ob-sheet" role="dialog" aria-modal="true">
      <div class="sheet-handle"></div>
      <div class="sheet-title">発注基準を設定</div>

      <!-- 仮定 -->
      <section v-if="editing" class="ob-card">
        <p class="ob-lead">
          まだ実績の無い品目は、直近の在庫と次の3つから<strong>仮の</strong>発注点を出します。
          だいたいで大丈夫です。
        </p>

        <div class="ob-q">
          <div class="ob-q-label">発注してから届くまで</div>
          <div class="ob-chips">
            <button v-for="o in LEAD_OPTIONS" :key="o.v" type="button"
              :class="['ob-chip', { on: lead === o.v }]" @click="lead = o.v">{{ o.label }}</button>
          </div>
        </div>

        <div class="ob-q">
          <div class="ob-q-label">欠品しないための余裕</div>
          <div class="ob-chips">
            <button v-for="o in SAFETY_OPTIONS" :key="o.v" type="button"
              :class="['ob-chip', { on: safety === o.v }]" @click="safety = o.v">{{ o.label }}</button>
          </div>
        </div>

        <div class="ob-q">
          <div class="ob-q-label">棚にはだいたい何日分置いている？</div>
          <div class="ob-stepper">
            <button type="button" class="ob-step" aria-label="減らす" @click="stepStock(-1)">−</button>
            <span class="ob-step-val">{{ stockShown }}日分</span>
            <button type="button" class="ob-step" aria-label="増やす" @click="stepStock(1)">＋</button>
          </div>
          <div class="ob-note">
            <template v-if="stock == null">発注間隔{{ intervalDays }}日から出した目安です</template>
            <button v-else type="button" class="ob-link" @click="stock = null">目安（{{ autoStock }}日分）に戻す</button>
          </div>
          <button v-if="categories.length" type="button" class="ob-link" @click="showCats = !showCats">
            {{ showCats ? '▴' : '▾' }} ジャンルごとに変える
          </button>
          <div v-if="showCats" class="ob-cats">
            <label v-for="c in categories" :key="c" class="ob-cat">
              <span class="ob-cat-name">{{ c }}</span>
              <input type="number" inputmode="numeric" min="1" class="ob-cat-input"
                :placeholder="String(stockShown)" :value="byCat[c] ?? ''"
                :aria-label="`${c} の在庫日数`" @input="e => onCatInput(c, e)" />
              <span class="ob-unit">日分</span>
            </label>
          </div>
        </div>

        <button class="btn btn-primary" type="button" @click="save">この仮定で出す</button>
        <button v-if="assumptions" class="ob-link ob-cancel" type="button" @click="editing = false">変えずに戻る</button>
      </section>

      <section v-else class="ob-summary">
        <span class="ob-summary-text">{{ summary }}</span>
        <button type="button" class="ob-link" @click="editing = true">仮定を変える</button>
      </section>

      <p class="ob-desc">
        <span class="ob-badge assumed">仮</span> は直近の在庫と仮定からの値で、棚卸や発注が重なると
        <span class="ob-badge actual">実績</span> に自動で替わります。数字を入れると
        <span class="ob-badge manual">手動</span> になり、自動では変わりません。
      </p>

      <div class="ob-filters">
        <button type="button" :class="['ob-chip', { on: filter === 'all' }]" @click="filter = 'all'">すべて {{ counts.all }}</button>
        <button type="button" :class="['ob-chip', { on: filter === 'none' }]" @click="filter = 'none'">未設定 {{ counts.none }}</button>
        <button type="button" :class="['ob-chip', { on: filter === 'assumed' }]" @click="filter = 'assumed'">仮 {{ counts.assumed }}</button>
      </div>

      <div v-if="groups.length === 0" class="ob-empty">表示できる品目がありません。</div>

      <div v-for="[g, list] in groups" :key="g" class="ob-group">
        <div class="ob-group-name">{{ g }}</div>
        <div v-for="r in list" :key="r.item" class="ob-row">
          <div class="ob-main">
            <span class="ob-item">
              <span :class="['ob-badge', kindOf(r)]">{{ KIND_LABEL[kindOf(r)] }}</span>
              {{ r.item }}
            </span>
            <span v-if="r.reorder?.basis && kindOf(r) !== 'manual'" class="ob-basis">{{ r.reorder.basis }}</span>
            <span v-else-if="kindOf(r) === 'none'" class="ob-basis none">{{ assumptions ? '在庫の記録が無いため出せません' : '上の3つを決めると仮の値を出せます' }}</span>
            <span v-if="r.target" class="ob-basis">補充目標 {{ r.target.value }}{{ unitOf(r.item) }}</span>
          </div>
          <button v-if="kindOf(r) === 'manual'" type="button" class="ob-link ob-reset"
            @click="resetReorder(r.item)">自動に戻す</button>
          <input
            :class="['ob-input', { manual: kindOf(r) === 'manual' }]"
            type="number" inputmode="numeric" min="0"
            :placeholder="r.reorder?.value != null ? String(r.reorder.value) : '—'"
            :value="kindOf(r) === 'manual' ? r.reorder.value : ''"
            :aria-label="`${r.item} の発注点`"
            @change="e => onReorderInput(r.item, e)"
          />
          <span class="ob-unit">{{ unitOf(r.item) || '個' }}</span>
        </div>
      </div>

      <button class="btn btn-secondary ob-close" type="button" @click="emit('close')">閉じる</button>
      <button v-if="assumptions" class="ob-link ob-off" type="button" @click="turnOff">仮の値を使わない</button>
    </div>
  </div>
</template>

<style scoped>
.ob-sheet { max-height: 90vh; overflow-y: auto; }
.ob-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; margin-bottom: 12px; }
.ob-lead { font-size: 12.5px; color: #475569; line-height: 1.6; margin: 0 0 10px; }
.ob-q { margin-bottom: 12px; }
.ob-q-label { font-size: 13px; font-weight: 800; color: #334155; margin-bottom: 6px; }
.ob-chips, .ob-filters { display: flex; gap: 6px; flex-wrap: wrap; }
.ob-filters { margin-bottom: 8px; }
.ob-chip {
  border: 1.5px solid #cbd5e1; background: #fff; color: #475569;
  border-radius: 16px; min-height: 36px; padding: 4px 12px;
  font-size: 12.5px; font-weight: 700; cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.ob-chip.on { border-color: #2563eb; background: #eff6ff; color: #1d4ed8; }
.ob-stepper { display: flex; align-items: center; gap: 10px; }
.ob-step {
  width: 44px; height: 44px; border-radius: 10px; border: 1.5px solid #cbd5e1; background: #fff;
  font-size: 20px; font-weight: 800; color: #334155; cursor: pointer;
}
.ob-step-val { min-width: 64px; text-align: center; font-size: 16px; font-weight: 800; color: #1e293b; }
.ob-note { font-size: 11px; color: #94a3b8; margin-top: 4px; }
.ob-link {
  border: none; background: none; padding: 6px 0; min-height: 32px;
  color: #2563eb; font-size: 12px; font-weight: 700; cursor: pointer;
}
.ob-cats { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.ob-cat { display: flex; align-items: center; gap: 8px; }
.ob-cat-name { flex: 1; min-width: 0; font-size: 13px; color: #334155; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ob-cat-input, .ob-input {
  width: 72px; min-height: 44px; border: 1.5px solid #cbd5e1; border-radius: 9px; padding: 6px 8px;
  font-size: 15px; font-weight: 700; text-align: right; color: #1e293b; background: #fff;
}
.ob-input.manual { border-color: #fecaca; color: #b91c1c; }
.ob-input:focus, .ob-cat-input:focus { outline: none; border-color: #2563eb; }
.ob-cancel { display: block; margin: 6px auto 0; }

.ob-summary { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.ob-summary-text { flex: 1; min-width: 0; font-size: 12.5px; font-weight: 700; color: #334155; }
.ob-desc { font-size: 11.5px; color: #64748b; line-height: 1.8; margin: 0 0 10px; }

.ob-badge {
  display: inline-block; border-radius: 6px; padding: 0 5px; margin-right: 2px;
  font-size: 10.5px; font-weight: 800; line-height: 1.6; vertical-align: 1px;
}
.ob-badge.assumed { background: #fef3c7; color: #92400e; }
.ob-badge.actual  { background: #dcfce7; color: #166534; }
.ob-badge.manual  { background: #fee2e2; color: #b91c1c; }
.ob-badge.none    { background: #f1f5f9; color: #94a3b8; }

.ob-empty { padding: 24px 8px; text-align: center; color: #94a3b8; font-size: 13px; }
.ob-group-name { font-size: 11.5px; font-weight: 800; color: #64748b; padding: 10px 2px 2px; }
.ob-row { display: flex; align-items: center; gap: 8px; padding: 9px 2px; border-top: 1px solid #f1f5f9; }
.ob-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.ob-item { font-size: 13.5px; font-weight: 700; color: #334155; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ob-basis { font-size: 10.5px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ob-basis.none { color: #cbd5e1; }
.ob-reset { flex-shrink: 0; font-size: 11px; }
.ob-unit { flex-shrink: 0; font-size: 11px; color: #94a3b8; width: 26px; }

.btn { width: 100%; border: none; border-radius: 10px; padding: 13px; font-size: 14px; font-weight: 800; cursor: pointer; }
.btn-primary { background: var(--primary, #2563eb); color: #fff; }
.btn-secondary { background: #f1f5f9; color: #334155; }
.ob-close { margin-top: 14px; }
.ob-off { display: block; margin: 8px auto 0; color: #94a3b8; }
</style>
